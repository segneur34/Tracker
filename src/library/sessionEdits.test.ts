import { describe, expect, it } from 'vitest';
import { EMPTY_NOTES } from '../sailing/sessionNotes';
import { RECORD_FORMAT, RECORD_VERSION, SUMMARY_CALC_VERSION, type SessionRecord, type StoredSessionNotes } from './record';
import { changedParts, editsPatch, latestGearNotes, savedEdits } from './sessionEdits';

const START_MS = Date.UTC(2026, 8, 24, 10, 0, 0);

const record = (patch: Partial<SessionRecord> = {}): SessionRecord => ({
  format: RECORD_FORMAT,
  version: RECORD_VERSION,
  gpx: '2026-09-24_12-00-00_wingfoil.gpx',
  sport: 'wingfoil',
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
  it("reprend le vent, le seuil, l'allure et les notes de la fiche", () => {
    const r = record({
      notes: notes({ comment: 'Belle session', rating: 4 }),
      analysis: { windDeg: 300, activeThreshold: 7, referenceSpeedMs: 2.5, savedAt: START_MS },
    });
    const saved = savedEdits(r, null);
    expect(saved.windDeg).toBe(300);
    expect(saved.activeThreshold).toBe(7);
    expect(saved.referenceSpeedMs).toBe(2.5);
    expect(saved.notes).toEqual({ ...EMPTY_NOTES, comment: 'Belle session', rating: 4 });
  });

  it('propose le matériel de la dernière session notée à une session sans notes', () => {
    const gear = latestGearNotes([
      record({ notes: notes({ foil: 'Axis 900', savedAt: START_MS }) }),
      record({ notes: notes({ foil: 'Axis 1100', wing: '5 m²', comment: 'x', savedAt: START_MS + 1 }) }),
      record({ notes: notes({ comment: 'sans matériel', savedAt: START_MS + 2 }) }),
    ]);
    expect(savedEdits(record(), gear).notes).toEqual({ ...EMPTY_NOTES, foil: 'Axis 1100', wing: '5 m²' });
  });

  it('rend les valeurs par défaut sans fiche', () => {
    expect(savedEdits(null, null)).toEqual({ notes: EMPTY_NOTES, windDeg: null, activeThreshold: null, referenceSpeedMs: null });
  });
});

describe('changedParts', () => {
  const saved = savedEdits(record(), null);

  it('ne voit aucun changement sur un état identique', () => {
    expect(changedParts(saved, { ...saved, notes: { ...saved.notes } })).toEqual([]);
  });

  it("nomme chaque partie changée, dans l'ordre de l'écran", () => {
    expect(changedParts(saved, { notes: { ...saved.notes, rating: 5 }, windDeg: 90, activeThreshold: 6, referenceSpeedMs: 2 }))
      .toEqual(['vent', 'seuil', 'allure', 'notes']);
  });
});

describe('editsPatch', () => {
  it('écrit seulement les parties changées, datées', () => {
    const r = record({ notes: notes({ comment: 'avant' }) });
    const saved = savedEdits(r, null);
    expect(editsPatch(r, saved, { ...saved, windDeg: -90 }, START_MS + 5)).toEqual({
      analysis: { windDeg: 270, activeThreshold: null, referenceSpeedMs: null, savedAt: START_MS + 5 },
    });
    expect(editsPatch(r, saved, { ...saved, notes: { ...saved.notes, comment: 'après' } }, START_MS + 6)).toEqual({
      notes: { ...EMPTY_NOTES, comment: 'après', savedAt: START_MS + 6 },
    });
  });

  it("écrit l'allure imposée seule, le vent et le seuil de la fiche intacts", () => {
    const r = record({ analysis: { windDeg: 45, activeThreshold: 3, referenceSpeedMs: null, savedAt: 0 } });
    const saved = savedEdits(r, null);
    expect(editsPatch(r, saved, { ...saved, referenceSpeedMs: 2.2 }, START_MS + 7)).toEqual({
      analysis: { windDeg: 45, activeThreshold: 3, referenceSpeedMs: 2.2, savedAt: START_MS + 7 },
    });
  });

  it('garde les champs inconnus des notes et des réglages', () => {
    const r = record({
      notes: { ...notes(), futur: 1 } as StoredSessionNotes,
      analysis: { windDeg: 10, activeThreshold: null, referenceSpeedMs: null, savedAt: 0, futur: 2 } as SessionRecord['analysis'],
    });
    const saved = savedEdits(r, null);
    const patch = editsPatch(r, saved, { ...saved, activeThreshold: 6, notes: { ...saved.notes, rating: 3 } }, 9);
    expect(patch.notes).toMatchObject({ futur: 1, rating: 3, savedAt: 9 });
    expect(patch.analysis).toMatchObject({ futur: 2, windDeg: 10, activeThreshold: 6, savedAt: 9 });
  });

  it("n'écrit rien quand rien n'a changé", () => {
    const r = record();
    const saved = savedEdits(r, null);
    expect(editsPatch(r, saved, saved, 1)).toEqual({});
  });
});
