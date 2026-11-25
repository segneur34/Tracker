import { describe, expect, it } from 'vitest';
import { savedEdits, type SessionEdits } from './sessionEdits';
import {
  draftsOfMissingSessions, mergedSessionDrafts, parseSessionDrafts, readSessionEdits, sessionDraftsDocument, withSessionDraft,
  withoutSessionDrafts, type KeptDraft,
} from './sessionDrafts';

const base = savedEdits(null);
const draft = (comment: string, patch: Partial<SessionEdits> = {}, memory: string | null = 'navigateur:'): KeptDraft => ({
  base,
  edits: { ...base, ...patch, notes: { ...base.notes, comment } },
  memory,
});
const viaJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('brouillons gardés sur l’appareil (lot 234)', () => {
  it('relus tels qu’écrits, après un passage par JSON : réglages, repères, poids du vélo et charge compris', () => {
    const marks = [{ timeMs: 1000, lat: 45, lon: -1, label: 'bouée' }, { timeMs: 2000, lat: null, lon: null, label: null }];
    const a = draft('Rafales', { windDeg: 270, speedRange: { minMs: 3, maxMs: 12 }, foil: true, bikeWeightKg: 11.5, loadKg: 6, marks });
    const read = parseSessionDrafts(viaJson(sessionDraftsDocument(new Map([['a.gpx', a]]))));
    expect([...read.keys()]).toEqual(['a.gpx']);
    expect(read.get('a.gpx')).toEqual(a);
  });

  it('forme illisible : rien, ou seulement les entrées bien formées', () => {
    expect(parseSessionDrafts(null).size).toBe(0);
    expect(parseSessionDrafts('texte').size).toBe(0);
    expect(parseSessionDrafts([draft('x')]).size).toBe(0);
    const read = parseSessionDrafts(viaJson({
      'bon.gpx': draft('Rafales'),
      'sans-notes.gpx': { base, edits: { ...base, notes: 'pas un objet' } },
      'sans-base.gpx': { edits: draft('x').edits },
      'reperes.gpx': { base, edits: { ...draft('y').edits, marks: 'aucun' } },
      'rien.gpx': 42,
      '': draft('sans nom'),
    }));
    expect([...read.keys()]).toEqual(['bon.gpx']);
  });

  it('un champ mal formé revient au défaut, chacun par la lecture de la fiche ; un brouillon qui ne change rien est jeté', () => {
    const edits = readSessionEdits({
      ...draft('Rafales').edits, windDeg: 'nord', activeThreshold: -3, bikeWeightKg: 5000, loadKg: 'lourd', pumping: 'oui',
      notes: { ...base.notes, comment: 'Rafales', windLevel: 'ouragan', waterState: 42, rating: 9, gear: 'aile' },
      marks: [{ timeMs: 1, lat: 200, lon: 0 }, { timeMs: 2, lat: 45, lon: 3, label: '  bouée ' }],
    });
    expect(edits?.windDeg).toBeNull();
    expect(edits?.activeThreshold).toBeNull();
    expect(edits?.bikeWeightKg).toBeNull();
    expect(edits?.loadKg).toBeNull();
    expect(edits?.pumping).toBeNull();
    expect(edits?.notes).toEqual({ ...base.notes, comment: 'Rafales' });
    expect(edits?.marks).toEqual([{ timeMs: 2, lat: 45, lon: 3, label: 'bouée' }]);
    // Champs étrangers ignorés.
    expect(readSessionEdits({ ...draft('x').edits, intrus: true })).not.toHaveProperty('intrus');
    expect(parseSessionDrafts(viaJson({ 'pareil.gpx': { base, edits: base } })).size).toBe(0);
  });

  it('ajout, retrait, sessions disparues, sans toucher la liste reçue', () => {
    const start = new Map([['a.gpx', draft('A')]]);
    const added = withSessionDraft(start, 'b.gpx', draft('B'));
    expect([...added.keys()]).toEqual(['a.gpx', 'b.gpx']);
    expect([...start.keys()]).toEqual(['a.gpx']);
    expect([...withSessionDraft(added, 'a.gpx', null).keys()]).toEqual(['b.gpx']);
    expect([...withSessionDraft(added, 'a.gpx', { base, edits: base, memory: null }).keys()]).toEqual(['b.gpx']);
    expect([...withoutSessionDrafts(added, ['b.gpx', 'c.gpx']).keys()]).toEqual(['a.gpx']);
    expect(draftsOfMissingSessions(added, 'navigateur:', new Set(['a.gpx', 'a.json']))).toEqual(['b.gpx']);
  });

  it('seule la mémoire où la session a été vue peut jeter son brouillon', () => {
    const drafts = new Map([
      ['a.gpx', draft('A', {}, 'navigateur:')],
      ['b.gpx', draft('B', {}, 'dossier:Voile')],
      ['c.gpx', draft('C', {}, null)],
    ]);
    expect(draftsOfMissingSessions(drafts, 'dossier:Voile', new Set(['x.gpx']))).toEqual(['b.gpx']);
    expect(draftsOfMissingSessions(drafts, 'navigateur:', new Set(['x.gpx']))).toEqual(['a.gpx']);
    // Relu sans mémoire notée : jamais jeté.
    const read = parseSessionDrafts(viaJson({ 'd.gpx': { base, edits: draft('D').edits } }));
    expect(read.get('d.gpx')?.memory).toBeNull();
    expect(parseSessionDrafts(viaJson({ 'a.gpx': draft('A') })).get('a.gpx')?.memory).toBe('navigateur:');
  });

  it('fusion : seules les entrées changées ici prennent leur valeur, les autres restent celles du document', () => {
    const stored = new Map([['x.gpx', draft('X')], ['y.gpx', draft('Y d’un autre onglet')]]);
    const own = new Map([['x.gpx', draft('X modifié')], ['z.gpx', draft('ancien')]]);
    const merged = mergedSessionDrafts(stored, own, ['x.gpx', 'w.gpx']);
    expect([...merged].map(([file, d]) => [file, d.edits.notes.comment])).toEqual([['x.gpx', 'X modifié'], ['y.gpx', 'Y d’un autre onglet']]);
    expect(mergedSessionDrafts(stored, new Map(), ['y.gpx']).has('y.gpx')).toBe(false);
  });
});
