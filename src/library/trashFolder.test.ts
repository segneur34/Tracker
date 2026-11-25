import { describe, expect, it } from 'vitest';
import type { FolderEntry } from '../platform/memoryFolder';
import { TRASH_INDEX_PATH, TRASH_KEEP_MS, parseTrashIndex, sessionRestorePlan, type TrashEntry } from './trash';
import {
  TRASH_LOCKED_MESSAGE, copyFromTrash, dropTrashEntries, emptyTrash, purgeTrash, readTrashIndex, stashInTrash, type TrashFolder,
  type TrashRequest,
} from './trashFolder';

const NOW = Date.UTC(2026, 10, 20, 12);
const DAY_MS = 86_400_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Dossier du disque en mémoire vive : octets, sous-dossiers, et effacement d'un sous-dossier vide seulement, comme
 * la coquille du programme Windows. `log` reçoit les écritures et les effacements, dans l'ordre. `slowWrites` fait
 * attendre chaque écriture d'octets, pour mêler deux opérations.
 */
const diskFolder = (initial: Record<string, string> = {}, { slowWrites = false } = {}) => {
  const files = new Map<string, Uint8Array>(Object.entries(initial).map(([p, text]) => [p, encoder.encode(text)]));
  const dirs = new Set<string>();
  const log: string[] = [];
  const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
  const addParents = (path: string) => {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  };
  for (const path of files.keys()) addParents(path);
  const put = async (path: string, bytes: Uint8Array) => {
    if (slowWrites) await new Promise((done) => setTimeout(done, 5));
    log.push(`write ${path}`);
    addParents(path);
    files.set(path, bytes);
  };
  const folder: TrashFolder = {
    list: async (dir) => {
      const entries: FolderEntry[] = [];
      for (const [path, bytes] of files) if (parentOf(path) === dir) entries.push({ name: path.slice(dir === '' ? 0 : dir.length + 1), kind: 'file', size: bytes.byteLength, mtimeMs: 1 });
      for (const d of dirs) if (parentOf(d) === dir) entries.push({ name: d.slice(dir === '' ? 0 : dir.length + 1), kind: 'directory', size: 0, mtimeMs: 1 });
      return entries;
    },
    readText: async (path) => (files.has(path) ? decoder.decode(files.get(path)) : null),
    readBytes: async (path) => files.get(path) ?? null,
    writeText: (path, text) => put(path, encoder.encode(text)),
    writeBytes: (path, bytes) => put(path, bytes),
    stat: async (path) => (files.has(path) ? { size: files.get(path)!.byteLength, mtimeMs: 1 } : null),
    remove: async (path) => {
      log.push(`remove ${path}`);
      files.delete(path);
    },
    removeDir: async (path) => {
      if ([...files.keys(), ...dirs].some((p) => p.startsWith(`${path}/`))) throw new Error(`${path} n'est pas vide`);
      log.push(`rmdir ${path}`);
      dirs.delete(path);
    },
  };
  return { folder, files, dirs, log, text: (path: string) => (files.has(path) ? decoder.decode(files.get(path)) : null) };
};

const GPX = 'sessions/2026-11-20_10-00-00_wing.gpx';
const sessionFiles = (stem = '2026-11-20_10-00-00_wing') => ({
  [`sessions/${stem}.gpx`]: '<gpx>trace</gpx>',
  [`sessions/${stem}.json`]: '{"fiche":1}',
  [`sessions/${stem}.imu`]: 'capteurs',
});

const request = (startMs = 1763632800000): TrashRequest => ({
  kind: 'session',
  paths: [GPX, GPX.replace('.gpx', '.json'), GPX.replace('.gpx', '.imu')],
  main: GPX,
  startMs,
  name: 'Wing · Carnon',
});

const entriesOf = async (folder: TrashFolder): Promise<TrashEntry[]> => (await readTrashIndex(folder)).entries;

describe('mettre à la corbeille', () => {
  it('capteurs, fiche, GPX, puis l\'entrée de l\'index ; les originaux restent pour l\'appelant', async () => {
    const disk = diskFolder(sessionFiles());
    const entry = await stashInTrash(disk.folder, request(), NOW);
    const dir = `corbeille/${NOW}-1763632800000`;
    expect(disk.log).toEqual([
      `write ${dir}/2026-11-20_10-00-00_wing.imu`, `write ${dir}/2026-11-20_10-00-00_wing.json`, `write ${dir}/2026-11-20_10-00-00_wing.gpx`,
      `write ${TRASH_INDEX_PATH}`,
    ]);
    expect(disk.text(`${dir}/2026-11-20_10-00-00_wing.gpx`)).toBe('<gpx>trace</gpx>');
    expect(disk.files.has(GPX)).toBe(true);
    expect(entry).toMatchObject({
      dir: `${NOW}-1763632800000`, kind: 'session', startMs: 1763632800000, name: 'Wing · Carnon', deletedAtMs: NOW,
      origin: 'ordinateur', reason: 'supprimee', main: '2026-11-20_10-00-00_wing.gpx',
    });
    expect(entry?.files.map((f) => f.name)).toEqual(['2026-11-20_10-00-00_wing.gpx', '2026-11-20_10-00-00_wing.json', '2026-11-20_10-00-00_wing.imu']);
    expect(await entriesOf(disk.folder)).toEqual([entry]);
  });

  it('suppression reprise après une coupure : l\'entrée déjà faite sert, rien n\'est recopié ni doublé', async () => {
    const disk = diskFolder(sessionFiles());
    const first = await stashInTrash(disk.folder, request(), NOW);
    disk.log.length = 0;
    const again = await stashInTrash(disk.folder, request(), NOW + 60_000);
    expect(again).toEqual(first);
    expect(disk.log).toEqual([]);
    expect(await entriesOf(disk.folder)).toHaveLength(1);
  });

  it('capteurs absents : sautés ; GPX déjà parti : rien n\'entre', async () => {
    const files = sessionFiles();
    delete files['sessions/2026-11-20_10-00-00_wing.imu'];
    const disk = diskFolder(files);
    expect((await stashInTrash(disk.folder, request(), NOW))?.files.map((f) => f.name)).toEqual([
      '2026-11-20_10-00-00_wing.gpx', '2026-11-20_10-00-00_wing.json',
    ]);
    const empty = diskFolder({});
    expect(await stashInTrash(empty.folder, request(), NOW)).toBeNull();
    expect(empty.log).toEqual([]);
  });

  it('index illisible : refus, rien d\'écrit, la session reste', async () => {
    const disk = diskFolder({ ...sessionFiles(), [TRASH_INDEX_PATH]: '{abîmé' });
    await expect(stashInTrash(disk.folder, request(), NOW)).rejects.toThrow(TRASH_LOCKED_MESSAGE);
    expect(disk.log).toEqual([]);
  });

  it('itinéraire : GPX puis fiche copiés, la fiche fait l\'entrée', async () => {
    const disk = diskFolder({ 'itineraires/lac.json': '{"r":1}', 'itineraires/lac.gpx': '<gpx/>' });
    const entry = await stashInTrash(disk.folder, {
      kind: 'itineraire', paths: ['itineraires/lac.json', 'itineraires/lac.gpx'], main: 'itineraires/lac.json',
      routeBase: 'lac', createdAt: '2026-11-01T10:00:00.000Z', name: 'Tour du lac',
    }, NOW);
    expect(disk.log.slice(0, 2)).toEqual([`write corbeille/${NOW}-lac/lac.gpx`, `write corbeille/${NOW}-lac/lac.json`]);
    expect(entry).toMatchObject({ kind: 'itineraire', startMs: null, routeBase: 'lac', main: 'lac.json' });
  });

  it('session supprimée deux fois, fiche changée à taille égale : la seconde version entre dans une entrée neuve', async () => {
    const disk = diskFolder(sessionFiles());
    const first = await stashInTrash(disk.folder, request(), NOW);
    disk.files.set(GPX.replace('.gpx', '.json'), encoder.encode('{"fiche":2}'));
    const second = await stashInTrash(disk.folder, request(), NOW + 60_000);
    expect(second?.dir).not.toBe(first?.dir);
    expect(disk.text(`corbeille/${second?.dir}/2026-11-20_10-00-00_wing.json`)).toBe('{"fiche":2}');
    expect(disk.text(`corbeille/${first?.dir}/2026-11-20_10-00-00_wing.json`)).toBe('{"fiche":1}');
    expect(await entriesOf(disk.folder)).toHaveLength(2);
  });
});

describe('purge', () => {
  it('plus de 30 jours : fichiers, sous-dossier, puis l\'index ; restes effacés ; dossier à la main et date future gardés', async () => {
    const disk = diskFolder({
      ...sessionFiles('a'), ...sessionFiles('b'), ...sessionFiles('c'), 'corbeille/photos/x.jpg': 'photo',
      'corbeille/2024-vacances/plage.gpx': 'à moi',
    });
    const old = await stashInTrash(disk.folder, { ...request(1), paths: ['sessions/a.gpx'], main: 'sessions/a.gpx' }, NOW - TRASH_KEEP_MS - DAY_MS);
    const recent = await stashInTrash(disk.folder, { ...request(2), paths: ['sessions/b.gpx'], main: 'sessions/b.gpx' }, NOW - DAY_MS);
    const future = await stashInTrash(disk.folder, { ...request(3), paths: ['sessions/c.gpx'], main: 'sessions/c.gpx' }, NOW + 5 * DAY_MS);
    // Copie coupée avant l'index : un reste.
    disk.files.set('corbeille/1763000000000-4/d.gpx', encoder.encode('<gpx/>'));
    disk.dirs.add('corbeille/1763000000000-4');
    disk.log.length = 0;
    const left = await purgeTrash(disk.folder, NOW);
    expect(left.entries.map((e) => e.dir)).toEqual([recent!.dir, future!.dir]);
    expect(disk.log).toEqual([
      `remove corbeille/${old!.dir}/a.gpx`, `rmdir corbeille/${old!.dir}`, `write ${TRASH_INDEX_PATH}`,
      'remove corbeille/1763000000000-4/d.gpx', 'rmdir corbeille/1763000000000-4',
    ]);
    expect(disk.text('corbeille/photos/x.jpg')).toBe('photo');
    // Un dossier posé à la main dont le nom commence par des chiffres et un tiret n'est pas un reste.
    expect(disk.text('corbeille/2024-vacances/plage.gpx')).toBe('à moi');
    expect(disk.dirs.has('corbeille/2024-vacances')).toBe(true);
    expect((await entriesOf(disk.folder)).map((e) => e.dir)).toEqual([recent!.dir, future!.dir]);
  });

  it('index illisible : rien n\'est purgé, pas même un reste', async () => {
    const disk = diskFolder({ [TRASH_INDEX_PATH]: '{abîmé', 'corbeille/1-2/a.gpx': 'x' });
    expect((await purgeTrash(disk.folder, NOW)).state).toBe('unreadable');
    expect(disk.log).toEqual([]);
  });

  it('la durée de garde se passe en paramètre : sans elle, 30 jours', async () => {
    const disk = diskFolder({ ...sessionFiles('a'), ...sessionFiles('b') });
    const twoDays = await stashInTrash(disk.folder, { ...request(1), paths: ['sessions/a.gpx'], main: 'sessions/a.gpx' }, NOW - 2 * DAY_MS);
    const today = await stashInTrash(disk.folder, { ...request(2), paths: ['sessions/b.gpx'], main: 'sessions/b.gpx' }, NOW);
    expect((await purgeTrash(disk.folder, NOW)).entries.map((e) => e.dir)).toEqual([twoDays!.dir, today!.dir]);
    expect((await purgeTrash(disk.folder, NOW, DAY_MS)).entries.map((e) => e.dir)).toEqual([today!.dir]);
    expect(disk.text(`corbeille/${twoDays!.dir}/a.gpx`)).toBeNull();
  });

  it('une purge lancée pendant une mise à la corbeille attend son tour : le sous-dossier neuf n\'est pas pris pour un reste', async () => {
    const disk = diskFolder(sessionFiles(), { slowWrites: true });
    const [entry] = await Promise.all([stashInTrash(disk.folder, request(), NOW), purgeTrash(disk.folder, NOW)]);
    expect(disk.text(`corbeille/${entry!.dir}/2026-11-20_10-00-00_wing.gpx`)).toBe('<gpx>trace</gpx>');
    expect((await entriesOf(disk.folder)).map((e) => e.dir)).toEqual([entry!.dir]);
  });
});

describe('sortir de la corbeille', () => {
  it('retirer une entrée : l\'index d\'abord, puis ses fichiers et son sous-dossier', async () => {
    const disk = diskFolder(sessionFiles());
    const entry = await stashInTrash(disk.folder, request(), NOW);
    disk.log.length = 0;
    expect(await dropTrashEntries(disk.folder, [entry!.dir, 'inconnue'])).toEqual([]);
    expect(disk.log[0]).toBe(`write ${TRASH_INDEX_PATH}`);
    expect(disk.log[disk.log.length - 1]).toBe(`rmdir corbeille/${entry!.dir}`);
    expect(disk.dirs.has(`corbeille/${entry!.dir}`)).toBe(false);
  });

  it('vider : index vide, chaque sous-dossier d\'entrée effacé, un dossier posé à la main gardé', async () => {
    const disk = diskFolder({
      ...sessionFiles(), 'corbeille/photos/x.jpg': 'photo', 'corbeille/1763000000000-6/x.gpx': 'reste', 'corbeille/2024-vacances/plage.gpx': 'à moi',
    });
    await stashInTrash(disk.folder, request(), NOW);
    await emptyTrash(disk.folder);
    expect(parseTrashIndex(disk.text(TRASH_INDEX_PATH))).toEqual({ state: 'ok', entries: [] });
    expect([...disk.files.keys()].filter((p) => p.startsWith('corbeille/')).sort()).toEqual([
      'corbeille/2024-vacances/plage.gpx', TRASH_INDEX_PATH, 'corbeille/photos/x.jpg',
    ]);
  });

  it('restaurer : les octets reviennent tels quels, GPX en dernier, sous un nom libre', async () => {
    const disk = diskFolder(sessionFiles());
    const entry = await stashInTrash(disk.folder, request(), NOW);
    for (const path of request().paths) await disk.folder.remove(path);
    disk.files.set('sessions/2026-11-20_10-00-00_wing.json', encoder.encode('{"orpheline":1}'));
    disk.log.length = 0;
    const plan = sessionRestorePlan(entry!, (await disk.folder.list('sessions')).map((e) => e.name));
    await copyFromTrash(disk.folder, plan.copies);
    expect(plan.gpx).toBe('2026-11-20_10-00-00_wing-2.gpx');
    expect(disk.log).toEqual([
      'write sessions/2026-11-20_10-00-00_wing-2.imu', 'write sessions/2026-11-20_10-00-00_wing-2.json', 'write sessions/2026-11-20_10-00-00_wing-2.gpx',
    ]);
    expect(disk.text('sessions/2026-11-20_10-00-00_wing-2.json')).toBe('{"fiche":1}');
    expect(disk.text('sessions/2026-11-20_10-00-00_wing.json')).toBe('{"orpheline":1}');
  });
});

describe('index disparu, dossiers imbriqués', () => {
  it("index absent à côté de sous-dossiers : rien n'est effacé, les entrées sont refaites et purgées à 30 jours seulement", async () => {
    const recent = `${NOW - DAY_MS}-1763632800000`;
    const old = `${NOW - TRASH_KEEP_MS - DAY_MS}-1763632900000`;
    const route = `${NOW - DAY_MS}-Tour du lac`;
    const disk = diskFolder({
      [`corbeille/${recent}/a.gpx`]: '<gpx/>', [`corbeille/${recent}/a.json`]: '{"name":"Sortie du matin","notes":{"comment":"à garder"}}',
      [`corbeille/${old}/b.gpx`]: '<gpx/>',
      [`corbeille/${route}/Tour du lac.json`]: '{"name":"Tour du lac"}', [`corbeille/${route}/Tour du lac.gpx`]: '<gpx/>',
      'corbeille/2024-vacances/plage.gpx': 'à moi',
    });
    const left = await purgeTrash(disk.folder, NOW);
    expect(left.state).toBe('ok');
    expect(left.entries.map((e) => [e.dir, e.kind, e.name]).sort()).toEqual([[recent, 'session', 'Sortie du matin'], [route, 'itineraire', 'Tour du lac']]);
    expect(disk.text(`corbeille/${recent}/a.json`)).toContain('à garder');
    expect(disk.text(`corbeille/${route}/Tour du lac.gpx`)).toBe('<gpx/>');
    expect(disk.text(`corbeille/${old}/b.gpx`)).toBeNull();
    expect(disk.text('corbeille/2024-vacances/plage.gpx')).toBe('à moi');
    expect((await entriesOf(disk.folder)).map((e) => e.dir).sort()).toEqual([recent, route].sort());
  });

  it('index absent : une mise à la corbeille garde les sous-dossiers déjà là, une purge suivante aussi', async () => {
    const before = `${NOW - DAY_MS}-1763632900000`;
    const disk = diskFolder({ ...sessionFiles(), [`corbeille/${before}/b.gpx`]: '<gpx/>', [`corbeille/${before}/b.json`]: '{}' });
    const entry = await stashInTrash(disk.folder, request(), NOW);
    expect((await entriesOf(disk.folder)).map((e) => e.dir)).toEqual([before, entry!.dir]);
    await purgeTrash(disk.folder, NOW);
    expect(disk.text(`corbeille/${before}/b.gpx`)).toBe('<gpx/>');
  });

  it("un dossier posé dans une entrée n'empêche plus de l'effacer, et « Vider » va jusqu'au bout", async () => {
    const disk = diskFolder(sessionFiles());
    const entry = (await stashInTrash(disk.folder, request(), NOW - TRASH_KEEP_MS - DAY_MS))!;
    disk.files.set(`corbeille/${entry.dir}/photos/x.jpg`, encoder.encode('photo'));
    disk.dirs.add(`corbeille/${entry.dir}/photos`);
    expect((await purgeTrash(disk.folder, NOW)).entries).toEqual([]);
    expect([...disk.files.keys()].filter((p) => p.startsWith(`corbeille/${entry.dir}`))).toEqual([]);
    expect(disk.dirs.has(`corbeille/${entry.dir}`)).toBe(false);

    const again = diskFolder(sessionFiles('a'));
    const kept = (await stashInTrash(again.folder, { ...request(1), paths: ['sessions/a.gpx'], main: 'sessions/a.gpx' }, NOW))!;
    again.files.set(`corbeille/${kept.dir}/sous/x.txt`, encoder.encode('x'));
    again.dirs.add(`corbeille/${kept.dir}/sous`);
    await emptyTrash(again.folder);
    expect(parseTrashIndex(again.text(TRASH_INDEX_PATH)).entries).toEqual([]);
    expect([...again.files.keys()].filter((p) => p.startsWith('corbeille/') && p !== TRASH_INDEX_PATH)).toEqual([]);
  });
});
