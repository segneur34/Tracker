import { describe, expect, it } from 'vitest';
import {
  RECORD_FORMAT,
  RECORD_VERSION,
  SUMMARY_CALC_VERSION,
  applyRecordPatch,
  dedupeSessions,
  findLegacyNotes,
  isSummaryStale,
  isWritableRecord,
  parseRecord,
  recordFileName,
  serializeRecord,
  type LibrarySession,
  type SessionAnalysis,
  type SessionRecord,
  type SessionSurfaces,
  type SessionTerrainElevation,
} from './record';

const START_MS = Date.UTC(2026, 8, 23, 12, 0, 0);

const record = (patch: Partial<SessionRecord> = {}): SessionRecord => ({
  format: RECORD_FORMAT,
  version: RECORD_VERSION,
  gpx: '2026-09-23_14-00-00_wingfoil.gpx',
  sport: 'wingfoil',
  activityId: null,
  source: 'enregistrement',
  addedAt: '2026-09-23T13:00:00.000Z',
  title: 'Wingfoil, 23/09/2026 14:00',
  name: null,
  summary: {
    calcVersion: SUMMARY_CALC_VERSION,
    startMs: START_MS,
    endMs: START_MS + 3_600_000,
    distanceM: 25_000,
    movingTimeS: 3000,
    elevationGainM: null,
    maxSpeedMs: 12.4,
    pointCount: 3601,
    samplingS: 1,
  },
  notes: null,
  analysis: null,
  ...patch,
});

const session = (file: string, patch: Partial<SessionRecord> = {}): LibrarySession => ({
  file,
  record: record({ gpx: file, ...patch }),
  readOnly: false,
  warning: null,
});

describe('parseRecord et serializeRecord', () => {
  it('relisent une fiche à l\'identique', () => {
    const r = record({
      notes: {
        foil: 'Axis 900', mast: '75', wing: 'Duotone 5', windLevel: 'moyen', waterState: 'clapot',
        rating: 4, comment: 'Belle session', savedAt: START_MS + 10,
      },
      summary: { ...record().summary, maneuverCount: 12 },
    });
    expect(parseRecord(serializeRecord(r))).toEqual(r);
  });

  it('relisent le nom donné par l\'utilisateur', () => {
    const r = record({ name: 'Sortie du matin' });
    expect(parseRecord(serializeRecord(r))?.name).toBe('Sortie du matin');
    const { name: _absent, ...ancienne } = record();
    expect(parseRecord(JSON.stringify(ancienne))?.name).toBeNull();
    expect(parseRecord(JSON.stringify({ ...record(), name: '   ' }))?.name).toBeNull();
    expect(parseRecord(JSON.stringify({ ...record(), name: 42 }))?.name).toBeNull();
    expect(parseRecord(JSON.stringify({ ...record(), name: '  Foil  ' }))?.name).toBe('Foil');
  });

  it('conservent les champs inconnus, en tête comme dans le résumé', () => {
    const text = JSON.stringify({
      ...record(),
      windManual: 270,
      summary: { ...record().summary, vmgMaxMs: 7.1 },
    });
    const parsed = parseRecord(text)!;
    const again = JSON.parse(serializeRecord({ ...parsed, sport: 'kite' }));
    expect(again.windManual).toBe(270);
    expect(again.summary.vmgMaxMs).toBe(7.1);
    expect(again.sport).toBe('kite');
  });

  it('rendent `null` pour un texte qui n\'est pas une fiche', () => {
    expect(parseRecord('{ pas du json')).toBeNull();
    expect(parseRecord(JSON.stringify({ ...record(), format: 'autre' }))).toBeNull();
    expect(parseRecord(JSON.stringify({ ...record(), gpx: '' }))).toBeNull();
    const { startMs: _start, ...sansDebut } = record().summary;
    expect(parseRecord(JSON.stringify({ ...record(), summary: sansDebut }))).toBeNull();
  });

  it('remplacent un support inconnu par `null` et des notes partielles par leurs valeurs vides', () => {
    const parsed = parseRecord(JSON.stringify({ ...record(), sport: 'parapente', notes: { foil: 'Axis', rating: 9 } }))!;
    expect(parsed.sport).toBeNull();
    expect(parsed.notes).toMatchObject({ foil: 'Axis', mast: '', rating: null, windLevel: null, savedAt: 0 });
  });

  it("relisent l'activité, et la lisent `null` dans une fiche d'avant les activités", () => {
    expect(parseRecord(serializeRecord(record({ activityId: 'a-moth' })))!.activityId).toBe('a-moth');
    const { activityId: _absent, ...legacy } = record();
    expect(parseRecord(JSON.stringify(legacy))!.activityId).toBeNull();
    expect(parseRecord(JSON.stringify({ ...record(), activityId: 42 }))!.activityId).toBeNull();
  });

  it('lisent une fiche d\'une version future sans permettre de la réécrire', () => {
    const future = parseRecord(JSON.stringify({ ...record(), version: RECORD_VERSION + 1 }))!;
    expect(future).not.toBeNull();
    expect(isWritableRecord(future)).toBe(false);
    expect(isWritableRecord(record())).toBe(true);
  });
});

describe("réglages d'analyse de la fiche", () => {
  it("sont relus à l'identique", () => {
    const r = record({ analysis: { windDeg: 315, activeThreshold: 6.5, referenceSpeedMs: 2.3, speedRange: { minMs: 2, maxMs: 8 }, effortThresholdMs: 3.6, savedAt: START_MS + 20 } });
    expect(parseRecord(serializeRecord(r))?.analysis).toEqual(r.analysis);
  });

  it('valent `null` dans une fiche écrite avant eux', () => {
    const { analysis: _omit, ...old } = record();
    expect(parseRecord(JSON.stringify(old))?.analysis).toBeNull();
  });

  it("donnent une allure déduite de la trace à une fiche d'avant l'allure imposée", () => {
    const raw = { ...record(), analysis: { windDeg: 90, activeThreshold: 4, savedAt: START_MS } };
    expect(parseRecord(JSON.stringify(raw))?.analysis?.referenceSpeedMs).toBeNull();
  });

  it("donnent les couleurs des Réglages à une fiche d'avant les couleurs par session", () => {
    const raw = { ...record(), analysis: { windDeg: 90, activeThreshold: 4, referenceSpeedMs: null, savedAt: START_MS } };
    expect(parseRecord(JSON.stringify(raw))?.analysis?.speedRange).toBeNull();
  });

  it("donnent le seuil d'effort tiré de la session à une fiche d'avant lui, ou qui en porte un mal formé", () => {
    const before = { ...record(), analysis: { windDeg: 90, activeThreshold: 4, referenceSpeedMs: null, speedRange: null, savedAt: START_MS } };
    expect(parseRecord(JSON.stringify(before))?.analysis?.effortThresholdMs).toBeNull();
    const broken = { ...before, analysis: { ...before.analysis, effortThresholdMs: -2 } };
    expect(parseRecord(JSON.stringify(broken))?.analysis?.effortThresholdMs).toBeNull();
  });

  it('écartent des bornes de couleur mal formées', () => {
    const read = (speedRange: unknown) =>
      parseRecord(JSON.stringify({ ...record(), analysis: { windDeg: null, speedRange } }))?.analysis?.speedRange;
    expect(read({ minMs: 5, maxMs: 5 })).toBeNull();
    expect(read({ minMs: -1, maxMs: 5 })).toBeNull();
    expect(read({ minMs: '1', maxMs: 5 })).toBeNull();
    expect(read([1, 5])).toBeNull();
    expect(read({ minMs: 1, maxMs: 5, futur: 1 })).toEqual({ minMs: 1, maxMs: 5 });
  });

  it('ramènent le vent dans [0, 360) et écartent les valeurs mal formées', () => {
    const raw = { ...record(), analysis: { windDeg: -45, activeThreshold: -2, referenceSpeedMs: 0, futur: true } };
    expect(parseRecord(JSON.stringify(raw))?.analysis).toEqual({
      windDeg: 315, activeThreshold: null, referenceSpeedMs: null, speedRange: null, effortThresholdMs: null, savedAt: 0, futur: true,
    });
    const texte = { ...record(), analysis: { windDeg: 'nord', activeThreshold: '8', referenceSpeedMs: '3', effortThresholdMs: '4' } };
    expect(parseRecord(JSON.stringify(texte))?.analysis).toEqual({
      windDeg: null, activeThreshold: null, referenceSpeedMs: null, speedRange: null, effortThresholdMs: null, savedAt: 0,
    });
    const negative = { ...record(), analysis: { windDeg: null, activeThreshold: null, referenceSpeedMs: -1.5 } };
    expect(parseRecord(JSON.stringify(negative))?.analysis?.referenceSpeedMs).toBeNull();
  });
});

describe('voies suivies de la fiche', () => {
  const surfaces: SessionSurfaces = {
    source: 'overpass',
    fetchedAt: '2026-10-04T15:00:00.000Z',
    matchVersion: 1,
    startMs: START_MS,
    tags: ['highway=residential', 'highway=track tracktype=grade2'],
    runs: [[0, 0], [125_000, 1], [300_000, -1]],
  };

  it('sont relues à l\'identique, et absentes d\'une fiche qui n\'en a pas', () => {
    expect(parseRecord(serializeRecord(record({ surfaces })))?.surfaces).toEqual(surfaces);
    expect(parseRecord(serializeRecord(record()))).not.toHaveProperty('surfaces');
  });

  it('sont écartées si elles sont mal formées', () => {
    const broken = { ...record(), surfaces: { ...surfaces, runs: [[5, 0]] } };
    expect(parseRecord(JSON.stringify(broken))).not.toHaveProperty('surfaces');
    const otherSource = { ...record(), surfaces: { ...surfaces, source: 'ailleurs' } };
    expect(parseRecord(JSON.stringify(otherSource))).not.toHaveProperty('surfaces');
  });

  it('se rangent et se retirent sans recalcul, et restent quand l\'activité change', () => {
    const added = applyRecordPatch(record(), { surfaces });
    expect(added).toEqual({ record: { ...record(), surfaces }, resummarize: false });
    expect(applyRecordPatch(added.record, { activityId: 'trail' }).record.surfaces).toEqual(surfaces);
    expect(applyRecordPatch(added.record, { surfaces: null }).record).not.toHaveProperty('surfaces');
  });
});

describe('séances du compteur de la fiche', () => {
  const intervals = [{
    workout: { reps: 2, workS: 60, restS: 30 },
    laps: [
      { kind: 'travail' as const, rep: 1, startMs: START_MS, endMs: START_MS + 60_000 },
      { kind: 'repos' as const, rep: 1, startMs: START_MS + 60_000, endMs: START_MS + 90_000 },
    ],
  }];

  it('sont relues à l\'identique, absentes sans compteur', () => {
    expect(parseRecord(serializeRecord(record({ intervals })))?.intervals).toEqual(intervals);
    expect(parseRecord(serializeRecord(record()))).not.toHaveProperty('intervals');
  });

  it('sont écartées si elles sont mal formées', () => {
    expect(parseRecord(JSON.stringify({ ...record(), intervals: 'trois fois' }))).not.toHaveProperty('intervals');
    expect(parseRecord(JSON.stringify({ ...record(), intervals: [{ workout: {}, laps: intervals[0].laps }] }))).not.toHaveProperty('intervals');
  });

  it('restent quand l\'activité ou le support changent', () => {
    const changed = applyRecordPatch(record({ sport: 'run-intervals', intervals }), { sport: 'running', activityId: 'running' });
    expect(changed.record.intervals).toEqual(intervals);
  });
});

describe('altitude du terrain de la fiche', () => {
  const terrainElevation: SessionTerrainElevation = {
    source: 'ign',
    resource: 'ign_rge_alti_wld',
    version: 1,
    stepM: 10,
    fetchedAt: '2026-10-07T09:00:00.000Z',
    startMs: START_MS,
    t: [0, 3333, 6667],
    z: [47.54, 46.87, null],
  };

  it('est relue à l\'identique, avec sa source', () => {
    const read = parseRecord(serializeRecord(record({ terrainElevation, elevationSource: 'gps' })));
    expect(read?.terrainElevation).toEqual(terrainElevation);
    expect(read?.elevationSource).toBe('gps');
    expect(parseRecord(serializeRecord(record()))).not.toHaveProperty('terrainElevation');
    expect(parseRecord(serializeRecord(record()))).not.toHaveProperty('elevationSource');
  });

  it('est écartée si elle est mal formée', () => {
    const cases = [
      { ...terrainElevation, t: [0, 3333] },
      { ...terrainElevation, t: [10, 3333, 6667] },
      { ...terrainElevation, t: [0, 6667, 3333] },
      { ...terrainElevation, z: [47.54, 'x', null] },
      { ...terrainElevation, stepM: 0 },
      { ...terrainElevation, source: 'gps' },
    ];
    for (const broken of cases) {
      expect(parseRecord(JSON.stringify({ ...record(), terrainElevation: broken }))).not.toHaveProperty('terrainElevation');
    }
    expect(parseRecord(JSON.stringify({ ...record(), elevationSource: 'ign' }))).not.toHaveProperty('elevationSource');
  });

  it('se range, se retire et change de source en recalculant le résumé, et reste quand l\'activité change', () => {
    const added = applyRecordPatch(record(), { terrainElevation });
    expect(added).toEqual({ record: { ...record(), terrainElevation }, resummarize: true });
    expect(applyRecordPatch(added.record, { terrainElevation }).resummarize).toBe(false);
    expect(applyRecordPatch(added.record, { activityId: 'trail' }).record.terrainElevation).toEqual(terrainElevation);
    const removed = applyRecordPatch(added.record, { terrainElevation: null });
    expect(removed.record).not.toHaveProperty('terrainElevation');
    expect(removed.resummarize).toBe(true);
    const gps = applyRecordPatch(added.record, { elevationSource: 'gps' });
    expect(gps).toEqual({ record: { ...added.record, elevationSource: 'gps' }, resummarize: true });
    expect(applyRecordPatch(gps.record, { elevationSource: null }).record).not.toHaveProperty('elevationSource');
    expect(applyRecordPatch(record(), { elevationSource: null })).toEqual({ record: record(), resummarize: false });
  });
});

describe('isSummaryStale', () => {
  it('repère un résumé calculé par une version antérieure', () => {
    expect(isSummaryStale(record())).toBe(false);
    expect(isSummaryStale(record({ summary: { ...record().summary, calcVersion: SUMMARY_CALC_VERSION - 1 } }))).toBe(true);
  });
});

describe('recordFileName', () => {
  it('remplace l\'extension du GPX, quelle que soit sa casse', () => {
    expect(recordFileName('2026-09-23_14-00-00_wingfoil.gpx')).toBe('2026-09-23_14-00-00_wingfoil.json');
    expect(recordFileName('Sortie.GPX')).toBe('Sortie.json');
  });
});

describe('findLegacyNotes', () => {
  it('retrouve les notes d\'avant le dossier par l\'instant du premier point, quel que soit le nom', () => {
    const legacy = {
      [`ancien-nom.gpx|${START_MS}`]: { foil: 'Axis', savedAt: 5 },
      [`autre|${START_MS + 1000}`]: { foil: 'Autre' },
    };
    expect(findLegacyNotes(legacy, START_MS)?.foil).toBe('Axis');
    expect(findLegacyNotes(legacy, START_MS + 2000)).toBeNull();
    expect(findLegacyNotes(null, START_MS)).toBeNull();
  });

  it('ne confond pas un instant avec un autre qui finit par les mêmes chiffres', () => {
    expect(findLegacyNotes({ [`x|1${START_MS}`]: { foil: 'Non' } }, START_MS)).toBeNull();
  });
});

describe('dedupeSessions', () => {
  it('ne garde qu\'une session par identité, celle qui a des notes, et trie par date décroissante', () => {
    const notes = { ...record().notes, foil: 'Axis', mast: '', wing: '', windLevel: null, waterState: null, rating: null, comment: '', savedAt: 1 };
    const older = session('a-old.gpx', { summary: { ...record().summary, startMs: START_MS - 86_400_000 } });
    const copieSansNotes = session('a.gpx');
    const avecNotes = session('b.gpx', { notes });
    const { kept, duplicates } = dedupeSessions([older, avecNotes, copieSansNotes]);
    expect(kept.map((s) => s.file)).toEqual(['b.gpx', 'a-old.gpx']);
    expect(duplicates.map((s) => s.file)).toEqual(['a.gpx']);
  });

  it('à notes égales, garde le premier nom dans l\'ordre alphabétique', () => {
    const { kept, duplicates } = dedupeSessions([session('z.gpx'), session('m.gpx')]);
    expect(kept.map((s) => s.file)).toEqual(['m.gpx']);
    expect(duplicates.map((s) => s.file)).toEqual(['z.gpx']);
  });
});

describe('applyRecordPatch', () => {
  const analysis: SessionAnalysis = { windDeg: 20, activeThreshold: 9, referenceSpeedMs: 7, speedRange: { minMs: 4, maxMs: 14 }, effortThresholdMs: null, savedAt: 1 };
  const withAnalysis = record({ analysis, notes: { ...record().notes, comment: 'Belle session', savedAt: 2 } as SessionRecord['notes'] });

  it('rend la fiche telle quelle si rien ne change', () => {
    const r = record();
    expect(applyRecordPatch(r, {})).toEqual({ record: r, resummarize: false });
    expect(applyRecordPatch(r, { sport: 'wingfoil', activityId: null, name: '  ' }).record).toBe(r);
  });

  it('un nom ou des notes ne demandent pas de recalcul', () => {
    const { record: named, resummarize } = applyRecordPatch(record(), { name: '  Sortie du soir ' });
    expect(named.name).toBe('Sortie du soir');
    expect(resummarize).toBe(false);
  });

  it('dans la même famille, le seuil est effacé, bornes, vent et allure gardés', () => {
    const { record: next, resummarize } = applyRecordPatch(withAnalysis, { sport: 'kite', activityId: 'kite' });
    expect(next.sport).toBe('kite');
    expect(next.activityId).toBe('kite');
    expect(next.analysis).toEqual({ ...analysis, activeThreshold: null });
    expect(resummarize).toBe(true);
  });

  it("d'une famille à l'autre, seuil et bornes de couleur effacés, le reste gardé", () => {
    const { record: next, resummarize } = applyRecordPatch(withAnalysis, { sport: 'running', activityId: 'running' });
    expect(next.sport).toBe('running');
    expect(next.analysis).toEqual({ ...analysis, activeThreshold: null, speedRange: null });
    expect(next.notes).toBe(withAnalysis.notes);
    expect(next.name).toBe(withAnalysis.name);
    expect(next.summary).toBe(withAnalysis.summary);
    expect(resummarize).toBe(true);
    // Retour en voile : le vent et l'allure sont toujours là.
    expect(applyRecordPatch(next, { sport: 'wingfoil' }).record.analysis?.windDeg).toBe(20);
  });

  it('de la course au fractionné à pied, même traitement : les bornes de couleur restent', () => {
    const running = record({ sport: 'running', analysis });
    const { record: next } = applyRecordPatch(running, { sport: 'run-intervals', activityId: 'run-intervals' });
    expect(next.analysis).toEqual({ ...analysis, activeThreshold: null });
    // Vers le fractionné vélo, l'échelle change.
    expect(applyRecordPatch(running, { sport: 'bike-intervals' }).record.analysis?.speedRange).toBeNull();
  });

  it('classer une session sans support ne touche pas à ses réglages', () => {
    const unclassified = record({ sport: null, analysis });
    const { record: next, resummarize } = applyRecordPatch(unclassified, { sport: 'running', activityId: 'running' });
    expect(next.analysis).toEqual({ ...analysis, activeThreshold: null });
    expect(resummarize).toBe(true);
  });

  it("un changement d'activité seule, de seuil ou d'allure demande un recalcul ; un nombre de manœuvres non", () => {
    expect(applyRecordPatch(record(), { activityId: 'a-moth' }).resummarize).toBe(true);
    expect(applyRecordPatch(withAnalysis, { analysis: { ...analysis, activeThreshold: 10 } }).resummarize).toBe(true);
    expect(applyRecordPatch(withAnalysis, { analysis: { ...analysis, referenceSpeedMs: 8 } }).resummarize).toBe(true);
    expect(applyRecordPatch(withAnalysis, { analysis: { ...analysis, windDeg: 40 } }).resummarize).toBe(false);
    const counted = applyRecordPatch(record(), { maneuverCount: 12 });
    expect(counted.record.summary.maneuverCount).toBe(12);
    expect(counted.resummarize).toBe(false);
  });
});
