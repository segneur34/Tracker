import { describe, expect, it } from 'vitest';
import type { SessionTest } from '../recording/fitnessTest';
import { EMPTY_NOTES } from './notes';
import {
  RECORD_FORMAT,
  RECORD_VERSION,
  SUMMARY_CALC_VERSION,
  applyRecordPatch,
  completeRecord,
  dedupeSessions,
  findLegacyNotes,
  isSummaryStale,
  isWritableRecord,
  lightRecord,
  mergeLightRecord,
  parseRecord,
  parseRecordParts,
  parseRecordWithRaw,
  readNotes,
  recordFileName,
  serializeRecord,
  type LibrarySession,
  type SessionAnalysis,
  type SessionJumps,
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
  it('relisent la distance en action, le temps de vol et la réussite des manœuvres, et écartent ce qui est mal formé', () => {
    const maneuverResults = { tackSuccess: 5, tackFail: 2, jibeSuccess: 4, jibeFail: 0 };
    const r = record({ summary: { ...record().summary, movingDistanceM: 9000, flightS: null, maneuverResults } });
    const back = parseRecord(serializeRecord(r))!.summary;
    expect(back.movingDistanceM).toBe(9000);
    expect(back.flightS).toBeNull();
    expect(back.maneuverResults).toEqual(maneuverResults);
    const abimee = { ...record(), summary: { ...record().summary, movingDistanceM: 'x', maneuverResults: { ...maneuverResults, tackFail: -1 } } };
    const lue = parseRecord(JSON.stringify(abimee))!.summary;
    expect(lue.movingDistanceM).toBeNull();
    expect(lue.maneuverResults).toBeUndefined();
    // Fiche d'avant la version 5 : rien.
    expect('movingDistanceM' in parseRecord(serializeRecord(record()))!.summary).toBe(false);
  });

  it('relisent la FC du résumé, et écartent une FC mal formée', () => {
    const heartRate = { avgBpm: 148, maxBpm: 171, coveredS: 2400, histogram: { fromBpm: 120, seconds: [10, 20, 30] } };
    const r = record({ summary: { ...record().summary, heartRate } });
    expect(parseRecord(serializeRecord(r))?.summary.heartRate).toEqual(heartRate);
    const abimee = { ...record(), summary: { ...record().summary, heartRate: { avgBpm: 148, maxBpm: 171, coveredS: 2400, histogram: { fromBpm: 120, seconds: ['x'] } } } };
    expect(parseRecord(JSON.stringify(abimee))?.summary.heartRate).toBeUndefined();
  });

  it('relisent le test du résumé, et écartent un test mal formé', () => {
    const test = { hrMaxBpm: 189, lastStepSpeedMs: 3.9, steps: 12 };
    const r = record({ summary: { ...record().summary, test } });
    expect(parseRecord(serializeRecord(r))?.summary.test).toEqual(test);
    const sansFc = record({ summary: { ...record().summary, test: { ...test, hrMaxBpm: null } } });
    expect(parseRecord(serializeRecord(sansFc))?.summary.test?.hrMaxBpm).toBeNull();
    const abimee = { ...record(), summary: { ...record().summary, test: { hrMaxBpm: 189, steps: 'x' } } };
    expect(parseRecord(JSON.stringify(abimee))?.summary.test).toBeUndefined();
  });

  it('relisent une fiche à l\'identique', () => {
    const r = record({
      notes: {
        foil: 'Axis 900', mast: '75', wing: 'Duotone 5', gear1: '', gear2: '', conditions: '', windLevel: 'moyen', waterState: 'clapot',
        gear: [{ groupId: 'g1', groupName: 'Aile', itemId: 'i1', itemName: 'Duotone 5' }],
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
    const r = record({ analysis: { windDeg: 315, activeThreshold: 6.5, referenceSpeedMs: 2.3, speedRange: { minMs: 2, maxMs: 8 }, effortThresholdMs: 3.6, foil: null, pumping: null, waveThreshold: null, bikeWeightKg: null, loadKg: null, savedAt: START_MS + 20 } });
    expect(parseRecord(serializeRecord(r))?.analysis).toEqual(r.analysis);
  });

  it('relisent le poids du vélo et la charge, et écartent les valeurs hors bornes', () => {
    const base = { windDeg: null, activeThreshold: null, referenceSpeedMs: null, speedRange: null, effortThresholdMs: null, foil: null, pumping: null, waveThreshold: null, terrain: null, savedAt: 1 };
    const ok = record({ analysis: { ...base, bikeWeightKg: 14.5, loadKg: 0 } });
    expect(parseRecord(serializeRecord(ok))?.analysis).toMatchObject({ bikeWeightKg: 14.5, loadKg: 0 });
    const bad = record({ analysis: { ...base, bikeWeightKg: 1, loadKg: -3 } });
    expect(parseRecord(serializeRecord(bad))?.analysis).toMatchObject({ bikeWeightKg: null, loadKg: null });
    const { bikeWeightKg: _b, loadKg: _l, ...old } = ok.analysis!;
    expect(parseRecord(serializeRecord(record({ analysis: old as typeof ok.analysis })))?.analysis).toMatchObject({ bikeWeightKg: null, loadKg: null });
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

  it("donnent le foil de l'activité à une fiche d'avant le foil par session, ou qui en porte un mal formé", () => {
    const before = { ...record(), analysis: { windDeg: 90, activeThreshold: 4, referenceSpeedMs: null, speedRange: null, savedAt: START_MS } };
    expect(parseRecord(JSON.stringify(before))?.analysis?.foil).toBeNull();
    expect(parseRecord(JSON.stringify({ ...before, analysis: { ...before.analysis, foil: true } }))?.analysis?.foil).toBe(true);
    expect(parseRecord(JSON.stringify({ ...before, analysis: { ...before.analysis, foil: 'oui' } }))?.analysis?.foil).toBeNull();
    expect(parseRecord(JSON.stringify(before))?.analysis?.pumping).toBeNull();
    expect(parseRecord(JSON.stringify({ ...before, analysis: { ...before.analysis, pumping: true } }))?.analysis?.pumping).toBe(true);
    expect(parseRecord(JSON.stringify({ ...before, analysis: { ...before.analysis, pumping: 1 } }))?.analysis?.pumping).toBeNull();
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
      windDeg: 315, activeThreshold: null, referenceSpeedMs: null, speedRange: null, effortThresholdMs: null, foil: null, pumping: null, waveThreshold: null, bikeWeightKg: null, loadKg: null, savedAt: 0, futur: true,
    });
    const texte = { ...record(), analysis: { windDeg: 'nord', activeThreshold: '8', referenceSpeedMs: '3', effortThresholdMs: '4' } };
    expect(parseRecord(JSON.stringify(texte))?.analysis).toEqual({
      windDeg: null, activeThreshold: null, referenceSpeedMs: null, speedRange: null, effortThresholdMs: null, foil: null, pumping: null, waveThreshold: null, bikeWeightKg: null, loadKg: null, savedAt: 0,
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

describe('sauts de la fiche', () => {
  const jumps: SessionJumps = {
    version: 1,
    computedAt: '2026-10-08T14:00:00.000Z',
    jumps: [{
      takeoffMs: START_MS + 60_000, landingMs: START_MS + 61_250, flightS: 1.25, heightM: 1.13, takeoffVerticalMs: 3.9,
      speedMs: 7.82, lengthM: 9.8, doubts: ['verticale'], curve: { stepS: 0.05, startS: -0.5, heightsM: [-0.2, 0, 0.6, 1.13, 0.4, 0] },
    }],
  };

  it("sont relus à l'identique, absents d'une fiche qui n'en a pas", () => {
    expect(parseRecord(serializeRecord(record({ jumps })))?.jumps).toEqual(jumps);
    expect(parseRecord(serializeRecord(record()))).not.toHaveProperty('jumps');
  });

  it('sont écartés si un saut est mal formé : ils seront refaits depuis le .imu', () => {
    const bad = (patch: object) => ({ ...jumps, jumps: [{ ...jumps.jumps[0], ...patch }] });
    expect(parseRecord(JSON.stringify({ ...record(), jumps: 'dix' }))).not.toHaveProperty('jumps');
    expect(parseRecord(JSON.stringify({ ...record(), jumps: bad({ heightM: 'haut' }) }))).not.toHaveProperty('jumps');
    expect(parseRecord(JSON.stringify({ ...record(), jumps: bad({ doubts: ['inconnu'] }) }))).not.toHaveProperty('jumps');
    expect(parseRecord(JSON.stringify({ ...record(), jumps: bad({ curve: { stepS: 0, startS: 0, heightsM: [] } }) }))).not.toHaveProperty('jumps');
  });

  it("se rangent et se retirent sans recalcul du résumé, et restent quand l'activité change", () => {
    const added = applyRecordPatch(record(), { jumps });
    expect(added.record.jumps).toEqual(jumps);
    expect(added.resummarize).toBe(false);
    expect(applyRecordPatch(added.record, { activityId: 'kite' }).record.jumps).toEqual(jumps);
    expect(applyRecordPatch(added.record, { jumps: null }).record).not.toHaveProperty('jumps');
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

describe('fiche allégée du cache', () => {
  const terrainElevation: SessionTerrainElevation = {
    source: 'ign', resource: 'ign_rge_alti_wld', version: 1, stepM: 10,
    fetchedAt: '2026-10-07T09:00:00.000Z', startMs: START_MS, t: [0, 3333], z: [47.5, 46.9],
  };
  const surfaces: SessionSurfaces = {
    source: 'overpass', fetchedAt: '2026-10-04T15:00:00.000Z', matchVersion: 1, startMs: START_MS,
    tags: ['highway=residential'], runs: [[0, 0]],
  };
  const jumps: SessionJumps = { version: 1, computedAt: '2026-10-08T14:00:00.000Z', jumps: [] };
  const intervals = [{
    workout: { reps: 1, workS: 60, restS: 30 },
    laps: [{ kind: 'travail' as const, rep: 1, startMs: START_MS, endMs: START_MS + 60_000 }],
  }];
  const full = {
    ...record({ name: 'Sortie', elevationSource: 'gps', intervals, terrainElevation, surfaces, jumps }),
    venuDuFutur: { lourd: true },
  } as SessionRecord;

  it("ne garde que ce que la liste montre et ce que l'utilisateur saisit", () => {
    const light = lightRecord(full);
    expect(light).toEqual(record({ name: 'Sortie', elevationSource: 'gps', intervals }));
    for (const key of ['terrainElevation', 'surfaces', 'jumps', 'venuDuFutur']) expect(light).not.toHaveProperty(key);
  });

  it('se recompose avec la fiche du disque : champs lourds et inconnus gardés', () => {
    expect(mergeLightRecord(full, lightRecord(full))).toEqual(full);
  });

  it('garde les saisies de la mémoire, y compris un champ léger retiré', () => {
    const { elevationSource: _removed, ...edited } = { ...lightRecord(full), name: 'Nouveau nom', notes: null };
    const merged = mergeLightRecord(full, edited as SessionRecord);
    expect(merged.name).toBe('Nouveau nom');
    expect(merged).not.toHaveProperty('elevationSource');
    expect(merged.terrainElevation).toEqual(terrainElevation);
  });

  it("laisse l'emporter un champ lourd posé en mémoire depuis", () => {
    const newer = { ...terrainElevation, fetchedAt: '2026-10-09T09:00:00.000Z' };
    expect(mergeLightRecord(full, { ...lightRecord(full), terrainElevation: newer }).terrainElevation).toEqual(newer);
  });
});

describe('isSummaryStale', () => {
  it('repère un résumé calculé par une version antérieure', () => {
    expect(isSummaryStale(record())).toBe(false);
    expect(isSummaryStale(record({ summary: { ...record().summary, calcVersion: SUMMARY_CALC_VERSION - 1 } }))).toBe(true);
  });

  it('version 12 : une fiche de voile de la version 11 est recalculée, son temps en mouvement relu défensivement', () => {
    expect(SUMMARY_CALC_VERSION).toBe(12);
    expect(isSummaryStale(record({ summary: { ...record().summary, calcVersion: 11 } }))).toBe(true);
    const withMotion = record({ summary: { ...record().summary, inMotionS: 2005 } });
    expect(parseRecord(serializeRecord(withMotion))!.summary.inMotionS).toBe(2005);
    const broken = { ...record(), summary: { ...record().summary, inMotionS: 'x' } };
    expect('inMotionS' in parseRecord(JSON.stringify(broken))!.summary).toBe(false);
    expect('inMotionS' in parseRecord(serializeRecord(record()))!.summary).toBe(false);
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

describe('readNotes', () => {
  it("lit une fiche d'avant les champs génériques : matériel et conditions vides", () => {
    const notes = readNotes({ foil: 'Axis 900', mast: '75', wing: '5 m²', windLevel: 'fort', waterState: 'plat', rating: 3, comment: 'ok', savedAt: 5 });
    expect(notes).toEqual({ ...EMPTY_NOTES, foil: 'Axis 900', mast: '75', wing: '5 m²', windLevel: 'fort', waterState: 'plat', rating: 3, comment: 'ok', savedAt: 5 });
  });

  it('lit le matériel et les conditions hors voile, et vide un champ mal formé', () => {
    const notes = readNotes({ gear1: 'Pegasus 41', gear2: 42, conditions: 'Boue, 28 °C', savedAt: 5 });
    expect(notes).toEqual({ ...EMPTY_NOTES, gear1: 'Pegasus 41', gear2: '', conditions: 'Boue, 28 °C', savedAt: 5 });
  });

  it('lit le matériel enregistré choisi, sans les entrées abîmées', () => {
    const good = { groupId: 'g1', groupName: 'Mât', itemId: 'i1', itemName: '85 cm' };
    const notes = readNotes({
      gear: [good, { groupId: 'g2', groupName: 'Foil', itemId: '', itemName: 'Axis' }, { groupId: 'g3', itemId: 'i3', itemName: '  ' }, 'Axis', null, { ...good, extra: 1 }],
      savedAt: 5,
    });
    expect(notes?.gear).toEqual([good, good]);
  });

  it('rend `null` pour un matériel absent, vide ou mal formé', () => {
    expect(readNotes({ savedAt: 5 })?.gear).toBeNull();
    expect(readNotes({ gear: [], savedAt: 5 })?.gear).toBeNull();
    expect(readNotes({ gear: 'Axis 900', savedAt: 5 })?.gear).toBeNull();
    expect(readNotes({ gear: [{ groupId: 'g1' }], savedAt: 5 })?.gear).toBeNull();
  });
});

describe('dedupeSessions', () => {
  it('ne garde qu\'une session par identité, celle qui a des notes, et trie par date décroissante', () => {
    const notes = { ...EMPTY_NOTES, foil: 'Axis', savedAt: 1 };
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
  const analysis: SessionAnalysis = { windDeg: 20, activeThreshold: 9, referenceSpeedMs: 7, speedRange: { minMs: 4, maxMs: 14 }, effortThresholdMs: null, foil: null, pumping: null, waveThreshold: null, bikeWeightKg: null, loadKg: null, savedAt: 1 };
  const withAnalysis = record({ analysis, notes: { ...record().notes, comment: 'Belle session', savedAt: 2 } as SessionRecord['notes'] });

  it('rend la fiche telle quelle si rien ne change', () => {
    const r = record();
    expect(applyRecordPatch(r, {})).toEqual({ record: r, resummarize: false });
    expect(applyRecordPatch(r, { sport: 'wingfoil', activityId: null, name: '  ' }).record).toBe(r);
  });

  it("garde le terrain d'une fiche d'avant le 21/10, qui n'est plus lu", () => {
    const raw = { ...analysis, terrain: 'trail' };
    expect(parseRecord(JSON.stringify(record({ analysis: raw as unknown as SessionAnalysis })))?.analysis).toMatchObject({ terrain: 'trail' });
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
    const results = { tackSuccess: 5, tackFail: 2, jibeSuccess: 4, jibeFail: 1 };
    const scored = applyRecordPatch(record(), { maneuverCount: 12, maneuverResults: results });
    expect(scored.record.summary.maneuverResults).toEqual(results);
    expect(scored.resummarize).toBe(false);
    // Les mêmes nombres : la fiche d'origine, sans réécriture.
    expect(applyRecordPatch(scored.record, { maneuverCount: 12, maneuverResults: { ...results } }).record).toBe(scored.record);
  });
});

describe('repères de la fiche', () => {
  const marks = [
    { timeMs: START_MS + 60_000, lat: 43.5, lon: 3.9, label: 'Saut' },
    { timeMs: START_MS + 120_000, lat: 43.51, lon: 3.91, label: null },
  ];

  it("sont relus à l'identique, absents sans repère", () => {
    expect(parseRecord(serializeRecord(record({ marks })))?.marks).toEqual(marks);
    expect(parseRecord(serializeRecord(record()))).not.toHaveProperty('marks');
  });

  it("écartent un repère mal formé, rangent les autres dans l'ordre du temps", () => {
    const raw = [marks[1], { timeMs: 'midi', lat: 43, lon: 3 }, { ...marks[0], label: '  ' }, { timeMs: 1, lat: 200, lon: 3 }];
    expect(parseRecord(JSON.stringify({ ...record(), marks: raw }))?.marks).toEqual([{ ...marks[0], label: null }, marks[1]]);
    expect(parseRecord(JSON.stringify({ ...record(), marks: 'deux' }))).not.toHaveProperty('marks');
    expect(parseRecord(JSON.stringify({ ...record(), marks: [] }))).not.toHaveProperty('marks');
  });

  it('se complètent sans écraser, et se retirent par une liste vide', () => {
    expect(completeRecord(record(), record({ marks })).record.marks).toEqual(marks);
    const own = [marks[1]];
    expect(completeRecord(record({ marks: own }), record({ marks })).record.marks).toEqual(own);
    expect(applyRecordPatch(record({ marks }), { marks: [] }).record).not.toHaveProperty('marks');
    expect(applyRecordPatch(record({ marks }), { marks: own }).record.marks).toEqual(own);
  });

  it('restent dans la fiche allégée du cache', () => {
    expect(lightRecord(record({ marks })).marks).toEqual(marks);
  });
});

describe('test guidé de la fiche', () => {
  const TEST: SessionTest = {
    protocol: 'fc-max',
    version: 1,
    settings: { warmupS: 480, age: 35, ageSource: 'profil', lowBpm: 110, highBpm: 147, zoneMethod: 'max' },
    startMs: START_MS,
    rampStartMs: START_MS + 480_000,
    v0Ms: 2.5,
    steps: [{ startMs: START_MS + 480_000, targetMs: 2.5 }],
    rampEndMs: null,
    dropMs: null,
    endReason: null,
    endMs: null,
    signals: [{ t: START_MS, s: 'debut' }, { t: START_MS + 480_000, s: 'palier' }],
  };

  it("est relu à l'identique, absent sans test ou mal formé", () => {
    expect(parseRecord(serializeRecord(record({ test: TEST })))?.test).toEqual(TEST);
    expect(parseRecord(serializeRecord(record()))).not.toHaveProperty('test');
    expect(parseRecord(JSON.stringify({ ...record(), test: { ...TEST, protocol: 'vma' } }))).not.toHaveProperty('test');
  });

  it('complète une fiche sans test et fait refaire son résumé, sans écraser le sien', () => {
    const done = completeRecord(record(), record({ test: TEST }));
    expect(done.record.test).toEqual(TEST);
    expect(done.resummarize).toBe(true);
    const own = { ...TEST, v0Ms: 3 };
    expect(completeRecord(record({ test: own }), record({ test: TEST })).record.test).toEqual(own);
  });

  it('reste dans la fiche allégée du cache', () => {
    expect(lightRecord(record({ test: TEST })).test).toEqual(TEST);
  });
});

describe('fiches anciennes et abîmées', () => {
  /** Fiche telle que l'écrivait la première version de la mémoire (24/09, b8620ff). */
  const firstFormat = {
    format: RECORD_FORMAT,
    version: 1,
    gpx: '2026-09-23_14-00-00_wingfoil.gpx',
    sport: 'wingfoil',
    source: 'import',
    addedAt: '2026-09-24T10:00:00.000Z',
    title: 'Wingfoil',
    summary: record().summary,
    notes: { foil: 'Axis 900', mast: '', wing: '5 m', comment: '', windLevel: null, waterState: null, rating: 4, savedAt: 1 },
  };

  it("lit la première fiche : ce qu'elle ignorait reste nul ou absent", () => {
    const read = parseRecord(JSON.stringify(firstFormat));
    expect(read).not.toBeNull();
    expect(read?.activityId).toBeNull();
    expect(read?.name).toBeNull();
    expect(read?.analysis).toBeNull();
    for (const key of ['intervals', 'jumps', 'marks', 'surfaces', 'terrainElevation', 'elevationSource']) expect(read).not.toHaveProperty(key);
    expect(read?.notes?.foil).toBe('Axis 900');
    expect(read && isWritableRecord(read)).toBe(true);
  });

  it('un résumé abîmé ne rend pas la fiche illisible : le reste est gardé, le résumé est à refaire', () => {
    const damaged = { ...firstFormat, name: 'Sortie', summary: { ...firstFormat.summary, maxSpeedMs: null } };
    const text = JSON.stringify(damaged);
    expect(parseRecord(text)).toBeNull();
    const parts = parseRecordParts(text);
    expect(parts?.summary).toBeNull();
    expect(parts?.name).toBe('Sortie');
    expect(parts?.notes?.wing).toBe('5 m');
    expect(parts?.addedAt).toBe('2026-09-24T10:00:00.000Z');
    expect(parseRecordParts(JSON.stringify({ ...damaged, summary: undefined }))?.summary).toBeNull();
    expect(parseRecordParts('{ pas du JSON')).toBeNull();
    expect(parseRecordParts(JSON.stringify({ ...damaged, gpx: '' }))).toBeNull();
  });

  it('une fiche lisible se lit pareil par les deux lectures', () => {
    const text = serializeRecord(record({ name: 'Sortie' }));
    expect(parseRecordParts(text)).toEqual(parseRecord(text));
  });
});

describe('completeRecord', () => {
  const terrainElevation: SessionTerrainElevation = {
    source: 'ign', resource: 'ign_rge_alti_wld', version: 1, stepM: 10,
    fetchedAt: '2026-10-07T09:00:00.000Z', startMs: START_MS, t: [0, 3333], z: [47.5, 46.9],
  };
  const surfaces: SessionSurfaces = {
    source: 'overpass', fetchedAt: '2026-10-04T15:00:00.000Z', matchVersion: 1, startMs: START_MS,
    tags: ['highway=residential'], runs: [[0, 0]],
  };
  const jumps: SessionJumps = { version: 1, computedAt: '2026-10-08T14:00:00.000Z', jumps: [] };

  it("reprend sauts, voies et altitude qui manquent, et refait le résumé pour l'altitude", () => {
    const { record: done, resummarize } = completeRecord(record(), record({ jumps, surfaces, terrainElevation, elevationSource: 'gps' }));
    expect(done.jumps).toEqual(jumps);
    expect(done.surfaces).toEqual(surfaces);
    expect(done.terrainElevation).toEqual(terrainElevation);
    expect(done.elevationSource).toBe('gps');
    expect(resummarize).toBe(true);
    expect(completeRecord(record(), record({ jumps, surfaces })).resummarize).toBe(false);
  });

  it("n'écrase rien de ce que la fiche porte", () => {
    const own: SessionJumps = { ...jumps, computedAt: '2026-10-09T08:00:00.000Z' };
    const existing = record({ jumps: own, sport: 'kite', activityId: 'a-kite' });
    const { record: done, resummarize } = completeRecord(existing, record({ jumps, sport: 'wingfoil', activityId: 'a-wing' }));
    expect(done).toBe(existing);
    expect(resummarize).toBe(false);
  });

  it('donne support et activité à une session à classer, et refait le résumé', () => {
    const { record: done, resummarize } = completeRecord(record({ sport: null }), record({ sport: 'kite', activityId: 'a-kite' }));
    expect(done.sport).toBe('kite');
    expect(done.activityId).toBe('a-kite');
    expect(resummarize).toBe(true);
  });

  it("ne prend pas l'activité d'un autre calcul", () => {
    const { record: done } = completeRecord(record({ sport: 'kite' }), record({ sport: 'wingfoil', activityId: 'a-wing' }));
    expect(done.activityId).toBeNull();
  });

  it('accepte une fiche sans résumé', () => {
    const { summary: _unused, ...rest } = record({ name: 'Sortie' });
    expect(completeRecord(record(), { ...rest, summary: null }).record.name).toBe('Sortie');
  });
});

describe("fiche d'une version future relue puis réécrite (A1)", () => {
  const surfaces: SessionSurfaces = {
    source: 'overpass', fetchedAt: '2026-10-04T15:00:00.000Z', matchVersion: 1, startMs: START_MS,
    tags: ['highway=residential'], runs: [[0, 0], [125_000, -1]],
  };
  const terrainElevation: SessionTerrainElevation = {
    source: 'ign', resource: 'ign_rge_alti_wld', version: 1, stepM: 10,
    fetchedAt: '2026-10-07T09:00:00.000Z', startMs: START_MS, t: [0, 3333], z: [47.5, null],
  };
  const jumps: SessionJumps = {
    version: 1, computedAt: '2026-10-08T14:00:00.000Z',
    jumps: [{
      takeoffMs: START_MS + 60_000, landingMs: START_MS + 61_000, flightS: 1, heightM: 1.1, takeoffVerticalMs: 3.9,
      speedMs: 7.8, lengthM: 9.8, doubts: [], curve: { stepS: 0.05, startS: -0.5, heightsM: [0, 1.1, 0] },
    }],
  };
  const test: SessionTest = {
    protocol: 'fc-max', version: 1,
    settings: { warmupS: 480, age: 35, ageSource: 'profil', lowBpm: 110, highBpm: 147, zoneMethod: 'max' },
    startMs: START_MS, rampStartMs: START_MS + 480_000, v0Ms: 2.5, steps: [{ startMs: START_MS + 480_000, targetMs: 2.5 }],
    rampEndMs: null, dropMs: null, endReason: null, endMs: null, signals: [{ t: START_MS, s: 'debut' }],
  };
  const analysis: SessionAnalysis = {
    windDeg: 40, activeThreshold: 8, referenceSpeedMs: null, speedRange: null, effortThresholdMs: null, foil: true,
    pumping: null, waveThreshold: null, bikeWeightKg: null, loadKg: null, savedAt: 5,
  };
  const valid = record({
    name: 'Sortie', analysis, surfaces, terrainElevation, elevationSource: 'gps', jumps, test,
    marks: [{ timeMs: START_MS + 60_000, lat: 43.5, lon: 3.9, label: 'Saut' }],
    intervals: [{ workout: { reps: 1, workS: 60, restS: 30 }, laps: [{ kind: 'travail', rep: 1, startMs: START_MS, endMs: START_MS + 60_000 }] }],
    notes: { ...EMPTY_NOTES, comment: 'bien', rating: 4, savedAt: 3 },
  });

  /** Fiche écrite par une version plus récente : des champs connus sous une forme que celle-ci ne sait pas lire. */
  const future = {
    ...valid,
    surfaces: { source: 'overpass', format: 2, segments: [{ from: 0, kind: 'asphalte' }] },
    analysis: { ...analysis, windDeg: { from: 40, to: 60 } },
    test: { ...test, settings: { ...test.settings, zoneMethod: 'lactate' } },
    summary: { ...valid.summary, heartRate: { zones: [1, 2, 3] } },
  };
  const futureText = serializeRecord(future as unknown as SessionRecord);

  /** Texte d'un champ dans une fiche écrite, au caractère près. */
  const fieldText = (text: string, path: string[]): string =>
    JSON.stringify(path.reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], JSON.parse(text)), null, 2);

  it("une fiche valide n'a aucun champ illisible, et s'écrit comme avant", () => {
    const text = serializeRecord(valid);
    const parsed = parseRecordWithRaw(text)!;
    expect(parsed.unreadable).toEqual({});
    const read: SessionRecord = { ...parsed.parts, summary: parsed.parts.summary! };
    expect(serializeRecord(read, parsed.unreadable)).toBe(serializeRecord(read));
    expect(serializeRecord(valid, {})).toBe(text);
  });

  it('relue, renommée, réécrite : chaque champ de forme nouvelle revient identique au caractère près', () => {
    const parsed = parseRecordWithRaw(futureText)!;
    expect(Object.keys(parsed.unreadable).sort()).toEqual(['analysis.windDeg', 'summary.heartRate', 'surfaces', 'test']);
    const read: SessionRecord = { ...parsed.parts, summary: parsed.parts.summary! };
    expect(read.surfaces).toBeUndefined();
    expect(read.analysis?.windDeg).toBeNull();
    const renamed = applyRecordPatch(read, { name: 'Autre nom' }).record;
    const written = serializeRecord(renamed, parsed.unreadable);
    for (const path of [['surfaces'], ['analysis', 'windDeg'], ['test'], ['summary', 'heartRate']]) {
      expect(fieldText(written, path)).toBe(fieldText(futureText, path));
    }
    expect(JSON.parse(written).name).toBe('Autre nom');
    // Les champs valides n'ont pas bougé.
    for (const path of [['terrainElevation'], ['jumps'], ['marks'], ['intervals'], ['notes'], ['analysis', 'activeThreshold']]) {
      expect(fieldText(written, path)).toBe(fieldText(futureText, path));
    }
  });

  it('une valeur neuve valide l\'emporte sur le brut', () => {
    const parsed = parseRecordWithRaw(futureText)!;
    const read: SessionRecord = { ...parsed.parts, summary: parsed.parts.summary! };
    const changed = applyRecordPatch(read, { analysis: { ...read.analysis!, windDeg: 90 }, surfaces }).record;
    const written = JSON.parse(serializeRecord(changed, parsed.unreadable));
    expect(written.analysis.windDeg).toBe(90);
    expect(written.surfaces).toEqual(surfaces);
    // Les autres champs illisibles restent bruts.
    expect(written.test.settings.zoneMethod).toBe('lactate');
  });

  it("un résumé entier illisible n'est pas gardé : il se refait depuis le GPX", () => {
    const text = JSON.stringify({ ...valid, summary: { forme: 'nouvelle' } });
    expect(parseRecordWithRaw(text)!.unreadable).toEqual({});
  });

  it('un objet de réglages illisible en entier est gardé brut', () => {
    const text = JSON.stringify({ ...valid, analysis: ['nouvelle forme'] });
    const parsed = parseRecordWithRaw(text)!;
    expect(parsed.parts.analysis).toBeNull();
    const written = JSON.parse(serializeRecord({ ...parsed.parts, summary: parsed.parts.summary! }, parsed.unreadable));
    expect(written.analysis).toEqual(['nouvelle forme']);
  });
});
