import { describe, expect, it } from 'vitest';
import {
  RECORD_FORMAT,
  RECORD_VERSION,
  SUMMARY_CALC_VERSION,
  dedupeSessions,
  findLegacyNotes,
  isSummaryStale,
  isWritableRecord,
  parseRecord,
  recordFileName,
  serializeRecord,
  type LibrarySession,
  type SessionRecord,
} from './record';

const START_MS = Date.UTC(2026, 8, 23, 12, 0, 0);

const record = (patch: Partial<SessionRecord> = {}): SessionRecord => ({
  format: RECORD_FORMAT,
  version: RECORD_VERSION,
  gpx: '2026-09-23_14-00-00_wingfoil.gpx',
  sport: 'wingfoil',
  source: 'enregistrement',
  addedAt: '2026-09-23T13:00:00.000Z',
  title: 'Wingfoil, 23/09/2026 14:00',
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

  it('lisent une fiche d\'une version future sans permettre de la réécrire', () => {
    const future = parseRecord(JSON.stringify({ ...record(), version: RECORD_VERSION + 1 }))!;
    expect(future).not.toBeNull();
    expect(isWritableRecord(future)).toBe(false);
    expect(isWritableRecord(record())).toBe(true);
  });
});

describe("réglages d'analyse de la fiche", () => {
  it("sont relus à l'identique", () => {
    const r = record({ analysis: { windDeg: 315, activeThreshold: 6.5, referenceSpeedMs: 2.3, savedAt: START_MS + 20 } });
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

  it('ramènent le vent dans [0, 360) et écartent les valeurs mal formées', () => {
    const raw = { ...record(), analysis: { windDeg: -45, activeThreshold: -2, referenceSpeedMs: 0, futur: true } };
    expect(parseRecord(JSON.stringify(raw))?.analysis).toEqual({
      windDeg: 315, activeThreshold: null, referenceSpeedMs: null, savedAt: 0, futur: true,
    });
    const texte = { ...record(), analysis: { windDeg: 'nord', activeThreshold: '8', referenceSpeedMs: '3' } };
    expect(parseRecord(JSON.stringify(texte))?.analysis).toEqual({
      windDeg: null, activeThreshold: null, referenceSpeedMs: null, savedAt: 0,
    });
    const negative = { ...record(), analysis: { windDeg: null, activeThreshold: null, referenceSpeedMs: -1.5 } };
    expect(parseRecord(JSON.stringify(negative))?.analysis?.referenceSpeedMs).toBeNull();
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
