import { describe, expect, it } from 'vitest';
import type { FolderEntry } from '../platform/memoryFolder';
import { sessionRecord } from '../test/record.fixture';
import { folderId, nextCacheEntries, storedCache, storedCacheFor, type StoredCache } from './libraryCache';
import { RECORD_LIGHT_FIELDS_KEY, RECORD_READER_VERSION, lightRecord, type LibrarySession } from './record';

const entry = (name: string, size = 10, mtimeMs = 5): FolderEntry => ({ name, kind: 'file', size, mtimeMs });
const session = (file: string, readOnly = false): LibrarySession => ({ file, record: sessionRecord({ gpx: file }), readOnly, warning: null });
const cached = () => ({ size: 1, mtimeMs: 1, record: sessionRecord() });

describe('cache des fiches (lot 113)', () => {
  it('identifie le dossier par sa sorte et son nom', () => {
    expect(folderId({ kind: 'browser', label: 'Mémoire du navigateur' })).toBe('browser:Mémoire du navigateur');
  });

  it('ignore un cache d’un autre dossier, d’une autre liste de champs ou d’un autre lecteur', () => {
    const cache: StoredCache = { folder: 'f:1', light: true, fields: RECORD_LIGHT_FIELDS_KEY, reader: RECORD_READER_VERSION, entries: { 'a.json': cached() } };
    expect(storedCacheFor(cache, 'f:1')).toEqual({ entries: cache.entries, light: true });
    expect(storedCacheFor(cache, 'f:2')).toEqual({ entries: {}, light: false });
    expect(storedCacheFor({ ...cache, fields: 'autre' }, 'f:1').entries).toEqual({});
    expect(storedCacheFor({ ...cache, reader: RECORD_READER_VERSION + 1 }, 'f:1').entries).toEqual({});
    expect(storedCacheFor(null, 'f:1')).toEqual({ entries: {}, light: false });
    // Lecteur absent : la version 1.
    expect(storedCacheFor({ ...cache, reader: undefined }, 'f:1').light).toBe(RECORD_READER_VERSION === 1);
    expect(storedCacheFor({ ...cache, light: undefined }, 'f:1').light).toBe(false);
  });

  it('range un cache allégé, avec l’empreinte de ses champs et la version du lecteur', () => {
    expect(storedCache('f:1', {})).toEqual({ folder: 'f:1', light: true, fields: RECORD_LIGHT_FIELDS_KEY, reader: RECORD_READER_VERSION, entries: {} });
  });

  it('refait les entrées des sessions données, sous le nom réel de la fiche, et recopie les autres d’un cache allégé', () => {
    const kept = { light: true, entries: { 'b.json': cached() } };
    const a = session('a.gpx');
    const { entries, stillDirty } = nextCacheEntries([entry('a.gpx'), entry('a.JSON', 20, 7), entry('b.json')], kept, [a], () => false);
    expect(Object.keys(entries).sort()).toEqual(['a.JSON', 'b.json']);
    expect(entries['a.JSON']).toEqual({ size: 20, mtimeMs: 7, record: lightRecord(a.record) });
    expect(stillDirty).toEqual([]);
  });

  it('repart de rien sur un cache non allégé ; retire une session sortie ou en lecture seule ; garde à refaire une écriture en attente', () => {
    expect(nextCacheEntries([entry('z.json')], { light: false, entries: { 'z.json': cached() } }, [], () => false).entries).toEqual({});
    const kept = { light: true, entries: { 'a.json': cached(), 'b.json': cached(), 'c.json': cached() } };
    const listed = [entry('a.json'), entry('b.json'), entry('c.json')];
    const result = nextCacheEntries(listed, kept, ['a.gpx', session('b.gpx', true), session('c.gpx')], (file) => file === 'c.gpx');
    expect(result.entries).toEqual({});
    expect(result.stillDirty).toEqual(['c.gpx']);
  });
});
