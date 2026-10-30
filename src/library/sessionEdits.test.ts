import { describe, expect, it } from 'vitest';
import { normalizeDeg } from '../core/angles';
import type { SessionMark } from '../core/sessionMarks';
import type { SpeedRangeMs } from '../core/speedGradient';
import { EMPTY_NOTES, type GearChoice, type SailingSessionNotes } from './notes';
import { applyRecordPatch, parseRecordWithRaw, serializeRecord, type SessionRecord, type StoredSessionNotes } from './record';
import { changedParts, editsPatch, rebaseDraft, savedEdits, type EditedPart, type EditsPatch, type SessionEdits } from './sessionEdits';
import { familyRecords, sessionRecord } from '../test/record.fixture';

const START_MS = Date.UTC(2026, 8, 24, 10, 0, 0);

const record = (patch: Partial<SessionRecord> = {}): SessionRecord =>
  sessionRecord({
    gpx: '2026-09-24_12-00-00_wingfoil.gpx',
    source: 'import',
    addedAt: '2026-09-24T10:00:00.000Z',
    title: null,
    ...patch,
  }, { startMs: START_MS, endMs: START_MS + 3_600_000, distanceM: 20_000, maxSpeedMs: 11 });

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

/*
 * Lot 80 : copies gelées des fonctions d'avant la table des réglages
 * (`ANALYSIS_FIELDS`), comparées aux nouvelles, valeur et ordre des clés compris.
 */
const OLD_NOTE_FIELDS = Object.keys(EMPTY_NOTES) as (keyof SailingSessionNotes)[];
const oldSameGear = (a: readonly GearChoice[] | null, b: readonly GearChoice[] | null): boolean =>
  a === b || ((a?.length ?? 0) === 0 && (b?.length ?? 0) === 0) || (a !== null && b !== null && a.length === b.length && a.every((g, i) => {
    const o = b[i];
    return g.groupId === o.groupId && g.groupName === o.groupName && g.itemId === o.itemId && g.itemName === o.itemName;
  }));
const oldSameNoteField = <F extends keyof SailingSessionNotes>(field: F, a: SailingSessionNotes[F], b: SailingSessionNotes[F]): boolean =>
  field === 'gear' ? oldSameGear(a as GearChoice[] | null, b as GearChoice[] | null) : a === b;
const oldSameNotes = (a: SailingSessionNotes, b: SailingSessionNotes): boolean =>
  OLD_NOTE_FIELDS.every((field) => oldSameNoteField(field, a[field], b[field]));
const OLD_NO_MARKS: SessionMark[] = [];
const oldPickNotes = (n: SailingSessionNotes): SailingSessionNotes =>
  Object.fromEntries(OLD_NOTE_FIELDS.map((field) => [field, n[field]])) as unknown as SailingSessionNotes;
const oldSavedEdits = (r: SessionRecord | null): SessionEdits => ({
  notes: r?.notes ? oldPickNotes(r.notes) : EMPTY_NOTES,
  windDeg: r?.analysis?.windDeg ?? null,
  activeThreshold: r?.analysis?.activeThreshold ?? null,
  referenceSpeedMs: r?.analysis?.referenceSpeedMs ?? null,
  speedRange: r?.analysis?.speedRange ?? null,
  effortThresholdMs: r?.analysis?.effortThresholdMs ?? null,
  foil: r?.analysis?.foil ?? null,
  pumping: r?.analysis?.pumping ?? null,
  waveThreshold: r?.analysis?.waveThreshold ?? null,
  bikeWeightKg: r?.analysis?.bikeWeightKg ?? null,
  loadKg: r?.analysis?.loadKg ?? null,
  marks: r?.marks ?? OLD_NO_MARKS,
});
const oldSameRange = (a: SpeedRangeMs | null, b: SpeedRangeMs | null): boolean =>
  a === b || (a !== null && b !== null && a.minMs === b.minMs && a.maxMs === b.maxMs);
const oldSameMarks = (a: readonly SessionMark[], b: readonly SessionMark[]): boolean =>
  a === b || (a.length === b.length && a.every((m, i) => {
    const o = b[i];
    return m.timeMs === o.timeMs && m.lat === o.lat && m.lon === o.lon && m.label === o.label;
  }));
const oldChangedParts = (saved: SessionEdits, edits: SessionEdits): EditedPart[] => {
  const parts: EditedPart[] = [];
  if (saved.windDeg !== edits.windDeg) parts.push('vent');
  if (saved.activeThreshold !== edits.activeThreshold) parts.push('seuil');
  if (saved.referenceSpeedMs !== edits.referenceSpeedMs) parts.push('allure');
  if (!oldSameRange(saved.speedRange, edits.speedRange)) parts.push('couleurs');
  if (saved.effortThresholdMs !== edits.effortThresholdMs) parts.push('effort');
  if (saved.foil !== edits.foil) parts.push('foil');
  if (saved.pumping !== edits.pumping) parts.push('pumping');
  if (saved.waveThreshold !== edits.waveThreshold) parts.push('vague');
  if (saved.bikeWeightKg !== edits.bikeWeightKg || saved.loadKg !== edits.loadKg) parts.push('charge');
  if (!oldSameNotes(saved.notes, edits.notes)) parts.push('notes');
  if (!oldSameMarks(saved.marks, edits.marks)) parts.push('reperes');
  return parts;
};
const OLD_SAME: { [K in Exclude<keyof SessionEdits, 'notes'>]: (a: SessionEdits[K], b: SessionEdits[K]) => boolean } = {
  windDeg: (a, b) => a === b,
  activeThreshold: (a, b) => a === b,
  referenceSpeedMs: (a, b) => a === b,
  speedRange: oldSameRange,
  effortThresholdMs: (a, b) => a === b,
  foil: (a, b) => a === b,
  pumping: (a, b) => a === b,
  waveThreshold: (a, b) => a === b,
  bikeWeightKg: (a, b) => a === b,
  loadKg: (a, b) => a === b,
  marks: oldSameMarks,
};
const oldRebaseDraft = (prevSaved: SessionEdits, nextSaved: SessionEdits, draft: SessionEdits): SessionEdits => {
  if (prevSaved === nextSaved) return draft;
  const next: SessionEdits = { ...draft };
  let changed = false;
  for (const key of Object.keys(OLD_SAME) as (keyof typeof OLD_SAME)[]) {
    const same = OLD_SAME[key] as (a: unknown, b: unknown) => boolean;
    if (same(draft[key], prevSaved[key]) && !same(draft[key], nextSaved[key])) {
      (next as unknown as Record<string, unknown>)[key] = nextSaved[key];
      changed = true;
    }
  }
  const n: SailingSessionNotes = { ...draft.notes };
  for (const field of OLD_NOTE_FIELDS) {
    if (oldSameNoteField(field, draft.notes[field], prevSaved.notes[field]) && !oldSameNoteField(field, draft.notes[field], nextSaved.notes[field])) {
      (n as unknown as Record<string, unknown>)[field] = nextSaved.notes[field];
      changed = true;
    }
  }
  return changed ? { ...next, notes: n } : draft;
};
const oldEditsPatch = (r: SessionRecord, saved: SessionEdits, edits: SessionEdits, now: number): EditsPatch => {
  const parts = oldChangedParts(saved, edits);
  const patch: EditsPatch = {};
  if (parts.includes('notes')) patch.notes = { ...r.notes, ...edits.notes, savedAt: now };
  if (parts.includes('reperes')) patch.marks = edits.marks.map((m) => ({ ...m, label: m.label?.trim() || null }));
  if (parts.some((part) => part !== 'notes' && part !== 'reperes')) {
    patch.analysis = {
      ...r.analysis,
      windDeg: edits.windDeg === null ? null : normalizeDeg(edits.windDeg),
      activeThreshold: edits.activeThreshold,
      referenceSpeedMs: edits.referenceSpeedMs,
      speedRange: edits.speedRange,
      effortThresholdMs: edits.effortThresholdMs,
      foil: edits.foil,
      pumping: edits.pumping,
      waveThreshold: edits.waveThreshold,
      bikeWeightKg: edits.bikeWeightKg,
      loadKg: edits.loadKg,
      savedAt: now,
    };
  }
  return patch;
};

/** Pareil que la copie gelée : valeur et texte JSON (ordre des clés). */
const expectSame = (actual: unknown, expected: unknown) => {
  expect(actual).toEqual(expected);
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
};

describe('brouillon tiré de la table des réglages (lot 80), comme avant', () => {
  const families = familyRecords();
  const records: [string, SessionRecord | null][] = [
    ['sans fiche', null],
    ['fiche nue', record()],
    ['réglages avec un champ inconnu', record({ analysis: { ...families.voile.analysis!, futur: { a: 1 } } as SessionRecord['analysis'] })],
    ['notes partielles', record({ notes: { comment: 'x', savedAt: 1 } as StoredSessionNotes })],
    ...Object.entries(families),
  ];
  /** Brouillons tirés de `saved` : chaque champ changé seul, les deux de « charge » ensemble, tout à la fois. */
  const variants = (saved: SessionEdits): SessionEdits[] => [
    saved,
    { ...saved, speedRange: saved.speedRange && { ...saved.speedRange }, notes: { ...saved.notes }, marks: saved.marks.map((m) => ({ ...m })) },
    { ...saved, windDeg: 405 },
    { ...saved, windDeg: saved.windDeg === null ? 10 : null },
    { ...saved, activeThreshold: 5.5 },
    { ...saved, referenceSpeedMs: 3.3 },
    { ...saved, speedRange: { minMs: 1, maxMs: 9 } },
    { ...saved, speedRange: null },
    { ...saved, effortThresholdMs: 2.2 },
    { ...saved, foil: !saved.foil },
    { ...saved, pumping: saved.pumping === null ? true : null },
    { ...saved, waveThreshold: 11 },
    { ...saved, bikeWeightKg: 12 },
    { ...saved, loadKg: 7 },
    { ...saved, bikeWeightKg: 13, loadKg: 2 },
    { ...saved, notes: { ...saved.notes, comment: 'neuf' } },
    { ...saved, marks: [{ timeMs: 5, lat: null, lon: null, label: '  a  ' }] },
    {
      notes: { ...saved.notes, rating: 2 }, windDeg: -30, activeThreshold: 1, referenceSpeedMs: 2, speedRange: { minMs: 0, maxMs: 4 }, effortThresholdMs: 3,
      foil: false, pumping: false, waveThreshold: 4, bikeWeightKg: 20, loadKg: 0, marks: [],
    },
  ];

  it.each(records)('savedEdits : %s', (_, r) => {
    expectSame(savedEdits(r), oldSavedEdits(r));
  });

  it.each(records)('changedParts et editsPatch : %s', (_, r) => {
    const saved = savedEdits(r);
    const base = r ?? record();
    for (const edits of variants(saved)) {
      expectSame(changedParts(saved, edits), oldChangedParts(saved, edits));
      expectSame(editsPatch(base, saved, edits, 77), oldEditsPatch(base, saved, edits, 77));
    }
  });

  it.each(records)('rebaseDraft : %s', (_, r) => {
    const prevSaved = savedEdits(r);
    for (const nextSaved of variants(prevSaved)) {
      for (const draft of variants(prevSaved)) {
        const actual = rebaseDraft(prevSaved, nextSaved, draft);
        const expected = oldRebaseDraft(prevSaved, nextSaved, draft);
        expectSame(actual, expected);
        expect(actual === draft).toBe(expected === draft);
      }
    }
  });
});

describe("champ illisible d'une fiche compacte, autre réglage enregistré (lot 54, lot 80)", () => {
  it('le vent de forme nouvelle revient brut, au caractère près, quand le seuil change', () => {
    const valid = familyRecords().voile;
    const future = { ...valid, analysis: { ...valid.analysis, windDeg: { from: 40, to: [60, 70.5] } } };
    const futureText = serializeRecord(future as unknown as SessionRecord);
    const parsed = parseRecordWithRaw(futureText)!;
    expect(Object.keys(parsed.unreadable)).toEqual(['analysis.windDeg']);
    const read: SessionRecord = { ...parsed.parts, summary: parsed.parts.summary! };
    const saved = savedEdits(read);
    expect(saved.windDeg).toBeNull();
    const patch = editsPatch(read, saved, { ...saved, activeThreshold: 9 }, 99);
    expect(patch.analysis?.windDeg).toBeNull();
    const written = serializeRecord(applyRecordPatch(read, patch).record, parsed.unreadable);
    const windText = /\n {4}"windDeg": \{[\s\S]*?\n {4}\}/.exec(futureText)![0];
    expect(windText).toContain('"to": [60,70.5]');
    expect(written).toContain(windText);
    expect(JSON.parse(written).analysis.activeThreshold).toBe(9);
  });
});
