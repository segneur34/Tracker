import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Les trois réalisations du dossier mémoire (lot 148) : `stat`, et l'absent distingué de l'illisible
 * dans le dossier privé. Greffons simulés : Filesystem de Capacitor et MemoryFolder.
 */

const native = vi.hoisted(() => ({ on: false }));
vi.mock('./runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./runtime')>()),
  isNativeApp: () => native.on,
}));

/**
 * Dossier privé simulé : chemin → octets en base64 ; `broken` : lecture en échec ; `statBroken` : `stat`
 * en échec, tous deux sans dire « introuvable » ; `missing` : l'erreur du greffon pour un fichier absent.
 */
const fs = vi.hoisted(() => ({
  files: new Map<string, { data: string; size: number; mtime: number; type?: string }>(),
  broken: new Set<string>(),
  statBroken: new Set<string>(),
  missing: (method: string, path: string): Error =>
    Object.assign(new Error(`'${method}' failed because file at '${path}' does not exist.`), { code: 'OS-PLUG-FILE-0008' }),
}));
vi.mock('./files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./files')>()),
  filesystem: async () => ({
    Directory: { Data: 'DATA' },
    Encoding: { UTF8: 'utf8' },
    Filesystem: {
      readFile: async ({ path }: { path: string }) => {
        if (fs.broken.has(path)) throw new Error('mémoire du pont');
        const file = fs.files.get(path);
        if (!file) throw fs.missing('readFile', path);
        return { data: file.data };
      },
      stat: async ({ path }: { path: string }) => {
        if (fs.statBroken.has(path)) throw new Error('stockage muet');
        const file = fs.files.get(path);
        if (!file) throw fs.missing('stat', path);
        return { type: file.type ?? 'file', size: file.size, mtime: file.mtime };
      },
    },
  }),
}));

/** Greffon MemoryFolder simulé. */
const plugin = vi.hoisted(() => ({ stat: null as ((options: { uri: string; path: string }) => Promise<unknown>) | null }));
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  registerPlugin: () => ({
    hasAccess: async () => ({ granted: true }),
    stat: (options: { uri: string; path: string }) => plugin.stat!(options),
  }),
}));
vi.mock('./storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./storage')>()),
  jsonStore: { read: () => ({ uri: 'content://arbre', base: 'Tracker', label: 'dossier' }), write: () => undefined },
}));

const loaded = () => import('./memoryFolder');

beforeEach(() => {
  vi.resetModules();
  native.on = false;
  fs.files.clear();
  fs.broken.clear();
  fs.statBroken.clear();
  plugin.stat = null;
});
afterEach(() => vi.unstubAllGlobals());

describe('readPrivateBytes : absent ou illisible (T2-1)', () => {
  it('rend les octets, et null pour un fichier absent', async () => {
    const { readPrivateBytes } = await loaded();
    fs.files.set('capture.imu', { data: 'AQID', size: 3, mtime: 5 });
    expect([...(await readPrivateBytes('capture.imu'))!]).toEqual([1, 2, 3]);
    expect(await readPrivateBytes('rien.imu')).toBeNull();
  });

  it('lève pour un fichier présent mais illisible : jamais pris pour absent', async () => {
    const { readPrivateBytes } = await loaded();
    fs.files.set('capture.imu', { data: 'AQID', size: 3, mtime: 5 });
    fs.broken.add('capture.imu');
    await expect(readPrivateBytes('capture.imu')).rejects.toThrow('mémoire du pont');
  });

  it('lecture et `stat` qui échouent sans dire « introuvable » : lève, jamais pris pour absent', async () => {
    const { readPrivateBytes } = await loaded();
    fs.broken.add('capture.imu');
    fs.statBroken.add('capture.imu');
    await expect(readPrivateBytes('capture.imu')).rejects.toThrow('mémoire du pont');
  });

  it('absent prouvé par la lecture seule (`stat` muet), ou par le `stat` seul (lecture muette)', async () => {
    const { readPrivateBytes } = await loaded();
    fs.statBroken.add('sans-stat.imu');
    expect(await readPrivateBytes('sans-stat.imu')).toBeNull();
    fs.broken.add('sans-lecture.imu');
    expect(await readPrivateBytes('sans-lecture.imu')).toBeNull();
  });

  it('privateFileSize : lève sans preuve, null sur une preuve', async () => {
    const { privateFileSize } = await loaded();
    fs.statBroken.add('capture.imu');
    await expect(privateFileSize('capture.imu')).rejects.toThrow('stockage muet');
    expect(await privateFileSize('rien.imu')).toBeNull();
  });
});

describe('findMotionCapture, seul autre lecteur de privateFileSize', () => {
  it('capture là : trouvée ; absente : aucune ; présence inconnue : retenue, sans lever', async () => {
    native.on = true;
    const { findMotionCapture, motionCapturePath } = await import('./motion');
    const path = motionCapturePath(1000);
    fs.files.set(path, { data: 'AQID', size: 3, mtime: 5 });
    expect((await findMotionCapture(1000))?.bytes).toBe(3);
    fs.files.delete(path);
    expect(await findMotionCapture(1000)).toBeNull();
    fs.statBroken.add(path);
    expect((await findMotionCapture(1000))?.path).toBe(path);
  });
});

describe('stat', () => {
  it('dossier privé : taille et date, null si absent ou dossier ; une lecture illisible lève', async () => {
    native.on = true;
    const { pendingFolder } = await loaded();
    const pending = pendingFolder()!;
    fs.files.set('en-attente/a.imu', { data: 'AQID', size: 3, mtime: 5 });
    fs.files.set('en-attente/sous', { data: '', size: 0, mtime: 5, type: 'directory' });
    expect(await pending.stat('a.imu')).toEqual({ size: 3, mtimeMs: 5 });
    expect(await pending.stat('b.imu')).toBeNull();
    expect(await pending.stat('sous')).toBeNull();
    fs.statBroken.add('en-attente/a.imu');
    await expect(pending.stat('a.imu')).rejects.toThrow('stockage muet');
    fs.statBroken.clear();
    fs.broken.add('en-attente/a.imu');
    await expect(pending.readBytes('a.imu')).rejects.toThrow('mémoire du pont');
    expect(await pending.readBytes('b.imu')).toBeNull();
  });

  it('téléphone : par le greffon, chemin complet ; absent : null ; date nulle gardée ; le code du rejet remonte', async () => {
    native.on = true;
    const { fileErrorCode, openMemoryFolder } = await loaded();
    const access = await openMemoryFolder();
    if (access.state !== 'ready') throw new Error(access.state);
    const asked: string[] = [];
    plugin.stat = async ({ path }) => {
      asked.push(path);
      return path.endsWith('a.json') ? { exists: true, size: 12, mtimeMs: 0 } : { exists: false };
    };
    expect(await access.folder.stat('sessions/a.json')).toEqual({ size: 12, mtimeMs: 0 });
    expect(await access.folder.stat('sessions/b.json')).toBeNull();
    expect(asked).toEqual(['Tracker/sessions/a.json', 'Tracker/sessions/b.json']);

    plugin.stat = async () => {
      throw Object.assign(new Error('Lecture du fichier impossible : EACCES'), { code: 'PERMISSION' });
    };
    const refused = await access.folder.stat('sessions/a.json').catch((err: unknown) => err);
    expect(fileErrorCode(refused)).toBe('PERMISSION');
  });

  it('navigateur : date du fichier, null si absent', async () => {
    const notFound = () => new DOMException('absent', 'NotFoundError');
    const file = { size: 8, lastModified: 42 };
    const dir: unknown = {
      getDirectoryHandle: async (name: string) => {
        if (name === 'sessions' || name === 'Tracker') return dir;
        throw notFound();
      },
      getFileHandle: async (name: string) => {
        if (name !== 'a.json') throw notFound();
        return { getFile: async () => file };
      },
    };
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => dir, persist: async () => true } });
    const { openMemoryFolder } = await loaded();
    const access = await openMemoryFolder();
    if (access.state !== 'ready') throw new Error(access.state);
    expect(access.folder.kind).toBe('browser');
    expect(await access.folder.stat('sessions/a.json')).toEqual({ size: 8, mtimeMs: 42 });
    expect(await access.folder.stat('sessions/b.json')).toBeNull();
    expect(await access.folder.stat('autre/a.json')).toBeNull();
  });
});
