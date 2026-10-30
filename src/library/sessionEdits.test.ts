import { describe, expect, it } from 'vitest';
import { EMPTY_NOTES } from './notes';
import { RECORD_FORMAT, RECORD_VERSION, SUMMARY_CALC_VERSION, type SessionRecord, type StoredSessionNotes } from './record';
import { changedParts, editsPatch, rebaseDraft, savedEdits } from './sessionEdits';

const START_MS = Date.UTC(2026, 8, 24, 10, 0, 0);

const record = (patch: Partial<SessionRecord> = {}): SessionRecord => ({
  format: RECORD_FORMAT,
  version: RECORD_VERSION,
  gpx: '2026-09-24_12-00-00_wingfoil.gpx',
  sport: 'wingfoil',
  activityId: null,
  source: 'import',
  addedAt: '2026-09-24T10:00:00.000Z',
  title: null,
  name: null,
  summary: {
    calcVersion: SUMMARY_CALC_VERSION,
    startMs: START_MS,
    endMs: START_MS + 3_600_000,
    distanceM: 20_000,
    movingTimeS: 3000,
    elevationGainM: null,
    maxSpeedMs: 11,
    pointCount: 3601,
    samplingS: 1,
  },
  notes: null,
  analysis: null,
  ...patch,
});

const notes = (patch: Partial<StoredSessionNotes> = {}): StoredSessionNotes => ({ ...EMPTY_NOTES, savedAt: START_MS, ...patch });

describe('savedEdits', () => {
  it("reprend le vent, le seuil, l'allure, les couleurs et les notes de la fiche", () => {
    const r = record({
      notes: notes({ comment: 'Belle session', rating: 4 }),
      analysis: { windDeg: 300, activeThreshold: 7, referenceSpeedMs: 2.5, speedRange: { minMs: 3, maxMs: 12 }, effortThresholdMs: 3.4, foil: null, pumping: null, waveThreshold: null, bikeWeightKg: null, loadKg: null, savedAt: START_MS },
    });
    const saved = savedEdits(r);
    expect(saved.windDeg).toBe(300);
    expect(saved.activeThreshold).toBe(7);
    expect(saved.referenceSpeedMs).toBe(2.5);
    expect(saved.speedRange).toEqual({ minMs: 3, maxMs: 12 });
    expect(saved.effortThresholdMs).toBe(3.4);
    expect(saved.notes).toEqual({ ...EMPTY_NOTES, comment: 'Belle session', rating: 4 });
  });

  it("ne reprend jamais le matériel d'une autre session : sans notes, tout est vide (décision du 27/10)", () => {
    expect(savedEdits(record({ source: 'enregistrement' })).notes).toEqual(EMPTY_NOTES);
    expect(savedEdits(record({ source: 'import' })).notes).toEqual(EMPTY_NOTES);
    expect(savedEdits(null).notes).toEqual(EMPTY_NOTES);
  });

  it('rend les valeurs par défaut sans fiche', () => {
    expect(savedEdits(null)).toEqual({ notes: EMPTY_NOTES, windDeg: null, activeThreshold: null, referenceSpeedMs: null, speedRange: null, effortThresholdMs: null, foil: null, pumping: null, waveThreshold: null, bikeWeightKg: null, loadKg: null, marks: [] });
  });
});

describe('changedParts', () => {
  const saved = savedEdits(record());

  it('ne voit aucun changement sur un état identique', () => {
    expect(changedParts(saved, { ...saved, notes: { ...saved.notes } })).toEqual([]);
  });

  it('voit le matériel et les conditions hors voile dans la partie « notes »', () => {
    expect(changedParts(saved, { ...saved, notes: { ...saved.notes, gear1: 'Pegasus' } })).toEqual(['notes']);
    expect(changedParts(saved, { ...saved, notes: { ...saved.notes, conditions: 'Boue' } })).toEqual(['notes']);
  });

  it("nomme chaque partie changée, dans l'ordre de l'écran", () => {
    expect(changedParts(saved, {
      notes: { ...saved.notes, rating: 5 }, windDeg: 90, activeThreshold: 6, referenceSpeedMs: 2, speedRange: { minMs: 1, maxMs: 5 },
      effortThresholdMs: 4, foil: true, pumping: true, waveThreshold: 20, bikeWeightKg: null, loadKg: null, marks: [],
    })).toEqual(['vent', 'seuil', 'allure', 'couleurs', 'effort', 'foil', 'pumping', 'vague', 'notes']);
  });

  it('range le foil de la session, et le relit', () => {
    const r = record({ analysis: { windDeg: null, activeThreshold: null, referenceSpeedMs: null, speedRange: null, effortThresholdMs: null, foil: null, pumping: null, waveThreshold: null, bikeWeightKg: null, loadKg: null, savedAt: 0 } });
    const before = savedEdits(r);
    expect(changedParts(before, { ...before, foil: false })).toEqual(['foil']);
    const patch = editsPatch(r, before, { ...before, foil: false }, START_MS + 3);
    expect(patch.analysis).toMatchObject({ foil: false, savedAt: START_MS + 3 });
    expect(savedEdits({ ...r, analysis: patch.analysis! }).foil).toBe(false);
  });

  it('range le pumping de la session, et le relit', () => {
    const r = record({ analysis: { windDeg: null, activeThreshold: null, referenceSpeedMs: null, speedRange: null, effortThresholdMs: null, foil: true, pumping: null, waveThreshold: null, bikeWeightKg: null, loadKg: null, savedAt: 0 } });
    const before = savedEdits(r);
    expect(changedParts(before, { ...before, pumping: true })).toEqual(['pumping']);
    const patch = editsPatch(r, before, { ...before, pumping: true }, START_MS + 4);
    expect(patch.analysis).toMatchObject({ foil: true, pumping: true, savedAt: START_MS + 4 });
    expect(savedEdits({ ...r, analysis: patch.analysis! }).pumping).toBe(true);
  });

  it('range le poids du vélo et la charge de la session, et les relit', () => {
    const r = record({ analysis: { windDeg: null, activeThreshold: null, referenceSpeedMs: null, speedRange: null, effortThresholdMs: null, foil: null, pumping: null, waveThreshold: null, bikeWeightKg: null, loadKg: null, savedAt: 0 } });
    const before = savedEdits(r);
    expect(changedParts(before, { ...before, bikeWeightKg: 14 })).toEqual(['charge']);
    expect(changedParts(before, { ...before, loadKg: 8 })).toEqual(['charge']);
    const patch = editsPatch(r, before, { ...before, bikeWeightKg: 14, loadKg: 8 }, START_MS + 6);
    expect(patch.analysis).toMatchObject({ bikeWeightKg: 14, loadKg: 8, savedAt: START_MS + 6 });
    const after = savedEdits({ ...r, analysis: patch.analysis! });
    expect([after.bikeWeightKg, after.loadKg]).toEqual([14, 8]);
  });

  it('compare les bornes de couleur par leurs valeurs', () => {
    const withRange = { ...saved, speedRange: { minMs: 1, maxMs: 5 } };
    expect(changedParts(withRange, { ...withRange, speedRange: { minMs: 1, maxMs: 5 } })).toEqual([]);
    expect(changedParts(withRange, { ...withRange, speedRange: { minMs: 1, maxMs: 6 } })).toEqual(['couleurs']);
    expect(changedParts(withRange, { ...withRange, speedRange: null })).toEqual(['couleurs']);
  });
});

describe('editsPatch', () => {
  it('écrit seulement les parties changées, datées', () => {
    const r = record({ notes: notes({ comment: 'avant' }) });
    const saved = savedEdits(r);
    expect(editsPatch(r, saved, { ...saved, windDeg: -90 }, START_MS + 5)).toEqual({
      analysis: { windDeg: 270, activeThreshold: null, referenceSpeedMs: null, speedRange: null, effortThresholdMs: null, foil: null, pumping: null, waveThreshold: null, bikeWeightKg: null, loadKg: null, savedAt: START_MS + 5 },
    });
    expect(editsPatch(r, saved, { ...saved, notes: { ...saved.notes, comment: 'après' } }, START_MS + 6)).toEqual({
      notes: { ...EMPTY_NOTES, comment: 'après', savedAt: START_MS + 6 },
    });
  });

  it("écrit l'allure imposée seule, le vent et le seuil de la fiche intacts", () => {
    const r = record({ analysis: { windDeg: 45, activeThreshold: 3, referenceSpeedMs: null, speedRange: null, effortThresholdMs: 3.8, foil: null, pumping: null, waveThreshold: null, bikeWeightKg: null, loadKg: null, savedAt: 0 } });
    const saved = savedEdits(r);
    expect(editsPatch(r, saved, { ...saved, referenceSpeedMs: 2.2 }, START_MS + 7)).toEqual({
      analysis: { windDeg: 45, activeThreshold: 3, referenceSpeedMs: 2.2, speedRange: null, effortThresholdMs: 3.8, foil: null, pumping: null, waveThreshold: null, bikeWeightKg: null, loadKg: null, savedAt: START_MS + 7 },
    });
  });

  it('écrit les bornes de couleur de la session', () => {
    const r = record();
    const saved = savedEdits(r);
    expect(editsPatch(r, saved, { ...saved, speedRange: { minMs: 2, maxMs: 9 } }, START_MS + 8)).toEqual({
      analysis: { windDeg: null, activeThreshold: null, referenceSpeedMs: null, speedRange: { minMs: 2, maxMs: 9 }, effortThresholdMs: null, foil: null, pumping: null, waveThreshold: null, bikeWeightKg: null, loadKg: null, savedAt: START_MS + 8 },
    });
  });

  it("écrit le seuil d'effort de la session", () => {
    const r = record();
    const saved = savedEdits(r);
    expect(changedParts(saved, { ...saved, effortThresholdMs: 3.9 })).toEqual(['effort']);
    expect(editsPatch(r, saved, { ...saved, effortThresholdMs: 3.9 }, START_MS + 9).analysis).toMatchObject({ effortThresholdMs: 3.9, foil: null, savedAt: START_MS + 9 });
  });

  it('garde les champs inconnus des notes et des réglages', () => {
    const r = record({
      notes: { ...notes(), futur: 1 } as StoredSessionNotes,
      analysis: { windDeg: 10, activeThreshold: null, referenceSpeedMs: null, speedRange: null, effortThresholdMs: null, foil: null, pumping: null, waveThreshold: null, bikeWeightKg: null, loadKg: null, savedAt: 0, futur: 2 } as SessionRecord['analysis'],
    });
    const saved = savedEdits(r);
    const patch = editsPatch(r, saved, { ...saved, activeThreshold: 6, notes: { ...saved.notes, rating: 3 } }, 9);
    expect(patch.notes).toMatchObject({ futur: 1, rating: 3, savedAt: 9 });
    expect(patch.analysis).toMatchObject({ futur: 2, windDeg: 10, activeThreshold: 6, savedAt: 9 });
  });

  it("n'écrit rien quand rien n'a changé", () => {
    const r = record();
    const saved = savedEdits(r);
    expect(editsPatch(r, saved, saved, 1)).toEqual({});
  });
});

describe('repères dans le brouillon', () => {
  const marks = [
    { timeMs: START_MS + 60_000, lat: 43.5, lon: 3.9, label: null },
    { timeMs: START_MS + 120_000, lat: 43.51, lon: 3.91, label: 'Bouée' },
  ];
  const r = record({ marks });
  const saved = savedEdits(r);

  it('sont repris de la fiche', () => {
    expect(saved.marks).toEqual(marks);
    expect(changedParts(saved, { ...saved, marks: marks.map((m) => ({ ...m })) })).toEqual([]);
  });

  it("nommer un repère le change seul, nom rogné à l'enregistrement", () => {
    const edits = { ...saved, marks: [{ ...marks[0], label: ' Saut ' }, marks[1]] };
    expect(changedParts(saved, edits)).toEqual(['reperes']);
    const patch = editsPatch(r, saved, edits, START_MS + 5);
    expect(patch).toEqual({ marks: [{ ...marks[0], label: 'Saut' }, marks[1]] });
  });

  it('supprimer un repère écrit la liste restante, vide comprise', () => {
    expect(editsPatch(r, saved, { ...saved, marks: [marks[1]] }, START_MS).marks).toEqual([marks[1]]);
    expect(editsPatch(r, saved, { ...saved, marks: [] }, START_MS)).toEqual({ marks: [] });
  });
});

describe('rebaseDraft (E-B3)', () => {
  const analysis = { windDeg: null, activeThreshold: 15, referenceSpeedMs: null, speedRange: null, effortThresholdMs: null, foil: null, pumping: null, waveThreshold: null, bikeWeightKg: null, loadKg: null, savedAt: 0 };
  const before = savedEdits(record({ analysis }));
  // Brouillon : un commentaire saisi, le seuil hérité de la fiche.
  const draft = { ...before, notes: { ...before.notes, comment: 'Rafales' } };

  it("suit la fiche pour un champ que le brouillon n'a pas changé, garde ceux qu'il a changés", () => {
    // Changement d'activité : la fiche perd son seuil.
    const after = savedEdits(record({ analysis: { ...analysis, activeThreshold: null } }));
    const rebased = rebaseDraft(before, after, draft);
    expect(rebased.activeThreshold).toBeNull();
    expect(rebased.notes.comment).toBe('Rafales');
    expect(changedParts(after, rebased)).toEqual(['notes']);
  });

  it('garde un seuil saisi dans le brouillon, et fusionne les notes champ par champ', () => {
    const edited = { ...draft, activeThreshold: 12 };
    const after = savedEdits(record({ analysis: { ...analysis, activeThreshold: null }, notes: notes({ foil: 'Axis 900' }) }));
    const rebased = rebaseDraft(before, after, edited);
    expect(rebased.activeThreshold).toBe(12);
    expect(rebased.notes).toEqual({ ...EMPTY_NOTES, foil: 'Axis 900', comment: 'Rafales' });
  });

  it('rend le brouillon tel quel quand la fiche ne change pas', () => {
    expect(rebaseDraft(before, before, draft)).toBe(draft);
  });
});

describe('matériel enregistré dans le brouillon (lot 20)', () => {
  const wing = { groupId: 'g-aile', groupName: 'Aile', itemId: 'i-5', itemName: 'Duotone 5' };
  const mast = { groupId: 'g-mat', groupName: 'Mât', itemId: 'i-85', itemName: '85 cm' };

  it('voit un matériel changé dans la partie « notes », pas une copie identique', () => {
    const r = record({ notes: notes({ gear: [wing] }) });
    const saved = savedEdits(r);
    expect(saved.notes.gear).toEqual([wing]);
    expect(changedParts(saved, { ...saved, notes: { ...saved.notes, gear: [{ ...wing }] } })).toEqual([]);
    expect(changedParts(saved, { ...saved, notes: { ...saved.notes, gear: [wing, mast] } })).toEqual(['notes']);
    expect(changedParts(saved, { ...saved, notes: { ...saved.notes, gear: null } })).toEqual(['notes']);
    expect(changedParts(saved, { ...saved, notes: { ...saved.notes, gear: [{ ...wing, itemName: 'Duotone 6' }] } })).toEqual(['notes']);
  });

  it('écrit le matériel choisi dans la fiche, et le relit', () => {
    const r = record();
    const saved = savedEdits(r);
    expect(saved.notes.gear).toBeNull();
    const patch = editsPatch(r, saved, { ...saved, notes: { ...saved.notes, gear: [wing, mast] } }, START_MS + 7);
    expect(patch.notes).toMatchObject({ gear: [wing, mast], savedAt: START_MS + 7 });
    expect(savedEdits({ ...r, notes: patch.notes! }).notes.gear).toEqual([wing, mast]);
  });

  it("ne reprend pas le matériel d'une autre session : une session neuve part vide", () => {
    expect(savedEdits(record({ source: 'enregistrement' })).notes.gear).toBeNull();
  });

  it('suit la fiche relue pour un matériel inchangé dans le brouillon, garde celui qui a été choisi', () => {
    const before = savedEdits(record({ notes: notes({ gear: [wing] }) }));
    const after = savedEdits(record({ notes: notes({ gear: [{ ...wing }, mast] }) }));
    const untouched = { ...before, notes: { ...before.notes, gear: [{ ...wing }], comment: 'Rafales' } };
    expect(rebaseDraft(before, after, untouched).notes.gear).toEqual([wing, mast]);
    const chosen = { ...before, notes: { ...before.notes, gear: null } };
    expect(rebaseDraft(before, after, chosen).notes.gear).toBeNull();
  });
});
