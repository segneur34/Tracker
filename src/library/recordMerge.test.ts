import { describe, expect, it } from 'vitest';
import { addRecordEdits, conflictLabels, mergeChangedRecord, mergedPlace, sameStamp } from './recordMerge';
import { PLACE_VERSION, type SessionPlace } from './sessionPlace';
import { SUMMARY_CALC_VERSION, type SessionRecord, type StoredSessionNotes } from './record';
import { sessionRecord } from '../test/record.fixture';

const notes = (patch: Partial<StoredSessionNotes>): StoredSessionNotes => ({
  foil: '', mast: '', wing: '', gear1: '', gear2: '', conditions: '', gear: null, comment: '', windLevel: null, waterState: null, rating: null, savedAt: 100, ...patch,
});

/** Chemins changés ici entre la fiche lue et la fiche en mémoire. */
const editsOf = (before: SessionRecord, after: SessionRecord): Map<string, unknown> => {
  const edits = new Map<string, unknown>();
  addRecordEdits(edits, before, after);
  return edits;
};

describe('chemins changés ici', () => {
  it('nom, repères, un champ de notes, sans le savedAt', () => {
    const before = sessionRecord({ notes: notes({ comment: 'a' }) });
    const after = { ...before, name: 'X', notes: notes({ comment: 'b', savedAt: 200 }) };
    expect([...editsOf(before, after).keys()].sort()).toEqual(['name', 'notes.comment']);
  });

  it('garde la valeur d\'avant le premier changement', () => {
    const a = sessionRecord({ name: 'A' });
    const b = { ...a, name: 'B' };
    const edits = editsOf(a, b);
    addRecordEdits(edits, b, { ...b, name: 'C' });
    expect(edits.get('name')).toBe('A');
  });

  it('résumé refait ; manœuvres à part ; rien pour la même fiche', () => {
    const a = sessionRecord();
    expect([...editsOf(a, { ...a, summary: { ...a.summary, distanceM: 1 } }).keys()]).toEqual(['summary']);
    expect([...editsOf(a, { ...a, summary: { ...a.summary, maneuverCount: 3 } }).keys()]).toEqual(['summary.maneuverCount']);
    expect(editsOf(a, { ...a }).size).toBe(0);
  });
});

describe('fiche changée sur le disque', () => {
  const read = sessionRecord({ notes: notes({ comment: 'lu', conditions: 'lu' }) }, { maneuverCount: 5, distanceM: 1000 });

  it('rien saisi ici : le disque, partout, champs inconnus compris', () => {
    const disk = { ...read, name: 'Autre', notes: notes({ comment: 'là-bas', savedAt: 300 }), futur: { a: 1 } };
    const { record, conflicts } = mergeChangedRecord(disk, read, new Map());
    expect(record).toEqual(disk);
    expect(conflicts).toEqual([]);
  });

  it('champs différents des deux côtés : les deux gardés, sans message', () => {
    const mine = { ...read, notes: notes({ comment: 'ici', conditions: 'lu', savedAt: 150 }) };
    const disk = { ...read, name: 'Autre', notes: notes({ comment: 'lu', conditions: 'là-bas', savedAt: 300 }) };
    const { record, conflicts } = mergeChangedRecord(disk, mine, editsOf(read, mine));
    expect(record.name).toBe('Autre');
    expect(record.notes?.comment).toBe('ici');
    expect(record.notes?.conditions).toBe('là-bas');
    expect(record.notes?.savedAt).toBe(300);
    expect(conflicts).toEqual([]);
  });

  it('même champ de notes des deux côtés : le bloc le plus récent, et c\'est dit', () => {
    const mine = { ...read, notes: notes({ comment: 'ici', conditions: 'lu', savedAt: 150 }) };
    const newerDisk = { ...read, notes: notes({ comment: 'là-bas', conditions: 'lu', savedAt: 300 }) };
    const older = mergeChangedRecord(newerDisk, mine, editsOf(read, mine));
    expect(older.record.notes?.comment).toBe('là-bas');
    expect(conflictLabels(older.conflicts)).toEqual(['notes']);

    const oldDisk = { ...read, notes: notes({ comment: 'là-bas', conditions: 'lu', savedAt: 120 }) };
    const newer = mergeChangedRecord(oldDisk, mine, editsOf(read, mine));
    expect(newer.record.notes?.comment).toBe('ici');
    expect(newer.conflicts).toEqual(['notes.comment']);
  });

  it('deux appareils (`datedByClock` faux) : même champ de notes, la mémoire l’emporte quelle que soit la date, et le bloc garde celle du disque', () => {
    const mine = { ...read, notes: notes({ comment: 'ici', conditions: 'lu', savedAt: 150 }) };
    const newerDisk = { ...read, notes: notes({ comment: 'là-bas', conditions: 'lu', savedAt: 300 }) };
    const merged = mergeChangedRecord(newerDisk, mine, editsOf(read, mine), { datedByClock: false });
    expect(merged.record.notes).toMatchObject({ comment: 'ici', savedAt: 300 });
    expect(merged.conflicts).toEqual(['notes.comment']);
    // Bloc né de ce côté seulement : il arrive sans date de l'autre appareil.
    const noNotes = { ...read, notes: null };
    expect(mergeChangedRecord(noNotes, mine, editsOf(noNotes, mine), { datedByClock: false }).record.notes?.savedAt).toBe(0);
  });

  it('même valeur des deux côtés : pas de message', () => {
    const mine = { ...read, name: 'Pareil' };
    expect(mergeChangedRecord({ ...read, name: 'Pareil' }, mine, editsOf(read, mine)).conflicts).toEqual([]);
  });

  it('nom changé des deux côtés : la mémoire, et c\'est dit', () => {
    const mine = { ...read, name: 'Ici' };
    const { record, conflicts } = mergeChangedRecord({ ...read, name: 'Là-bas' }, mine, editsOf(read, mine));
    expect(record.name).toBe('Ici');
    expect(conflictLabels(conflicts)).toEqual(['nom']);
  });

  it('notes vidées ici, inchangées là-bas : vidées', () => {
    const mine = { ...read, notes: null };
    expect(mergeChangedRecord(read, mine, editsOf(read, mine)).record.notes).toBeNull();
  });

  it('champ calculé des deux côtés (sauts) : la mémoire, sans message', () => {
    const before = sessionRecord();
    const jumps = { version: 1, computedAt: 'x', jumps: [] };
    const mine = { ...before, jumps };
    const { record, conflicts } = mergeChangedRecord({ ...before, jumps: { ...jumps, computedAt: 'y' } }, mine, editsOf(before, mine));
    expect(record.jumps?.computedAt).toBe('x');
    expect(conflicts).toEqual([]);
  });

  describe('lieu changé des deux côtés (lot 215)', () => {
    const place = (name: string, source: SessionPlace['source'], fetchedAt: string, over: Partial<SessionPlace> = {}): SessionPlace => ({
      name, kind: 'eau', search: 'eau', source, version: PLACE_VERSION, fetchedAt, ...over,
    });
    const merge = (diskPlace: SessionPlace, minePlace: SessionPlace) => {
      const before = sessionRecord();
      const mine = { ...before, place: minePlace };
      return mergeChangedRecord({ ...before, place: diskPlace }, mine, editsOf(before, mine));
    };

    it('même lieu trouvé sur deux appareils : pas de conflit, le plus ancien gardé des deux côtés', () => {
      const early = place('Carnon-Plage', 'osm', '2026-11-21T08:00:00.000Z');
      const late = place('Carnon-Plage', 'osm', '2026-11-21T09:00:00.000Z');
      expect(merge(early, late)).toEqual({ record: expect.objectContaining({ place: early }), conflicts: [] });
      expect(merge(late, early)).toEqual({ record: expect.objectContaining({ place: early }), conflicts: [] });
      // Lieux appris de même nom : de même.
      expect(merge(place('Travers', 'appris', 'b'), place('Travers', 'appris', 'a')).conflicts).toEqual([]);
      // À égalité de date : celui du disque.
      const disk = place('Carnon-Plage', 'osm', 'x', { kind: 'commune' });
      expect(mergedPlace(disk, place('Carnon-Plage', 'osm', 'x')).place).toBe(disk);
    });

    it('un lieu corrigé à la main l\'emporte sur un lieu trouvé ou appris, sans conflit', () => {
      const user = place('Le Grand Travers', 'user', '2026-11-21T10:00:00.000Z');
      expect(merge(place('Carnon-Plage', 'osm', 'a'), user)).toEqual({ record: expect.objectContaining({ place: user }), conflicts: [] });
      expect(merge(user, place('Carnon-Plage', 'appris', 'z'))).toEqual({ record: expect.objectContaining({ place: user }), conflicts: [] });
      // Un lieu appris passe devant un lieu trouvé.
      const learned = place('Travers', 'appris', 'z');
      expect(mergedPlace(place('Carnon-Plage', 'osm', 'a'), learned)).toEqual({ place: learned, conflict: false });
    });

    it('deux lieux corrigés à la main différents : la mémoire, et c\'est dit ; les mêmes : rien', () => {
      const mine = place('Ici', 'user', 'a');
      const { record, conflicts } = merge(place('Là-bas', 'user', 'b'), mine);
      expect(record.place).toEqual(mine);
      expect(conflictLabels(conflicts)).toEqual(['lieu']);
      expect(merge(place('Ici', 'user', 'b'), mine).conflicts).toEqual([]);
      expect(merge(place('Ici', 'user', 'b', { to: 'Sète' }), mine).conflicts).toEqual(['place']);
    });
  });

  describe('résumé', () => {
    it('refait ici : le nôtre, avec les manœuvres du disque', () => {
      const mine = { ...read, summary: { ...read.summary, distanceM: 2000 } };
      const disk = { ...read, summary: { ...read.summary, maneuverCount: 9 } };
      const { summary } = mergeChangedRecord(disk, mine, editsOf(read, mine)).record;
      expect(summary.distanceM).toBe(2000);
      expect(summary.maneuverCount).toBe(9);
    });

    it('refait ici, mais le disque vient d\'un calcul plus récent : le disque', () => {
      const mine = { ...read, summary: { ...read.summary, distanceM: 2000 } };
      const disk = { ...read, summary: { ...read.summary, calcVersion: SUMMARY_CALC_VERSION + 1, distanceM: 3000 } };
      expect(mergeChangedRecord(disk, mine, editsOf(read, mine)).record.summary.distanceM).toBe(3000);
    });

    it('pas refait ici : celui du disque', () => {
      const mine = { ...read, name: 'Ici' };
      const disk = { ...read, summary: { ...read.summary, distanceM: 3000 } };
      expect(mergeChangedRecord(disk, mine, editsOf(read, mine)).record.summary.distanceM).toBe(3000);
    });

    it('manœuvres comptées ici : les nôtres, sur le résumé du disque', () => {
      const mine = { ...read, summary: { ...read.summary, maneuverCount: 8 } };
      const disk = { ...read, summary: { ...read.summary, distanceM: 3000 } };
      const { summary } = mergeChangedRecord(disk, mine, editsOf(read, mine)).record;
      expect(summary.maneuverCount).toBe(8);
      expect(summary.distanceM).toBe(3000);
    });

    it('résumé du disque illisible : celui de la mémoire', () => {
      const { summary } = mergeChangedRecord({ ...read, summary: null }, read, new Map()).record;
      expect(summary).toEqual(read.summary);
    });
  });
});

describe('tampon d’une fiche (lot 113)', () => {
  it('ne tient pour inchangé qu’un fichier de même taille et de même date, connues', () => {
    expect(sameStamp({ size: 10, mtimeMs: 5 }, { size: 10, mtimeMs: 5 })).toBe(true);
    expect(sameStamp({ size: 10, mtimeMs: 5 }, { size: 11, mtimeMs: 5 })).toBe(false);
    expect(sameStamp({ size: 10, mtimeMs: 5 }, { size: 10, mtimeMs: 4 })).toBe(false);
  });

  it('ne prouve rien sans tampon, sans fichier ni date (fournisseur du téléphone qui ne la donne pas)', () => {
    expect(sameStamp(undefined, { size: 10, mtimeMs: 5 })).toBe(false);
    expect(sameStamp({ size: 10, mtimeMs: 5 }, null)).toBe(false);
    expect(sameStamp({ size: 10, mtimeMs: 0 }, { size: 10, mtimeMs: 0 })).toBe(false);
  });
});
