import { describe, expect, it } from 'vitest';
import { MEMORY_VERSION, markerText } from './folderLayout';
import {
  SYNC_BASE_FORMAT, SYNC_BASE_VERSION, emptySyncBase, hasRouteMemory, hasSyncMemory, isSyncId, markerTextWithId,
  markerTextWithPass, parseSyncBase, phoneDepositPaths, readMarkerDevice, readMarkerId, readMarkerPass, serializeSyncBase,
  syncAncestorPath, syncBaseLine, syncBasePath, syncFileRole, syncRefusal, syncRouteBaseLine, withRouteHeld, withRouteLine, withSyncDone,
  withSyncHeld, withSyncLine, withoutRouteLine, withoutRouteMemory, withoutSyncLine, withoutSyncMemory,
  type SyncBaseRoute, type SyncBaseSession, type SyncFiles,
} from './syncBase';

const files = (name: string, mtimeMs = 1000): SyncFiles => ({
  gpx: { name: `${name}.gpx`, size: 900, mtimeMs },
  record: { name: `${name}.json`, size: 300, mtimeMs: mtimeMs + 1 },
  imu: null,
});

const line = (startMs: number): SyncBaseSession => ({ startMs, computer: files(`pc-${startMs}`), phone: files(`tel-${startMs}`, 5000) });

const base = () => ({ ...emptySyncBase('ordinateur-0001', 'telephone-0001', 'Documents/Tracker'), sessions: [line(10), line(20)] });

describe('identifiant de l’appareil dans le marqueur de sa mémoire', () => {
  it('aucune version ne l’écrit encore : lu nul ; posé à la main, il se lit', () => {
    expect(readMarkerDevice(markerText())).toBeNull();
    expect(readMarkerDevice(JSON.stringify({ format: 'tracker-memoire', version: 1, appareil: 'appareil-1' }))).toBe('appareil-1');
    expect(readMarkerDevice(JSON.stringify({ format: 'tracker-memoire', version: 1, appareil: 12 }))).toBeNull();
    expect(readMarkerDevice('{ cassé')).toBeNull();
  });
});

describe('identifiant du dossier dans son marqueur', () => {
  it('un marqueur tel que l’application l’écrit n’a pas d’identifiant', () => {
    expect(readMarkerId(markerText())).toBeNull();
    expect(readMarkerId(null)).toBeNull();
  });

  it('l’identifiant s’ajoute sans rien retirer du marqueur, champs inconnus compris', () => {
    const text = markerTextWithId(JSON.stringify({ format: 'tracker-memoire', version: 1, futur: { a: 1 } }), 'abcdef-123456');
    expect(JSON.parse(text as string)).toEqual({ format: 'tracker-memoire', version: 1, futur: { a: 1 }, id: 'abcdef-123456' });
    expect(readMarkerId(text)).toBe('abcdef-123456');
  });

  it('un texte qui n’est pas un marqueur n’en devient pas un', () => {
    expect(markerTextWithId(null, 'abcdef-123456')).toBeNull();
    expect(markerTextWithId('{"format":"autre","version":1}', 'abcdef-123456')).toBeNull();
    expect(markerTextWithId('pas du json', 'abcdef-123456')).toBeNull();
  });

  it('le passage s’ajoute sans rien retirer ; mal formé, il vaut absent', () => {
    const before = JSON.stringify({ format: 'tracker-memoire', version: 1, id: 'abcdef-123456', futur: [1, 2] });
    expect(readMarkerPass(before)).toBeNull();
    const text = markerTextWithPass(before, 3);
    expect(JSON.parse(text as string)).toEqual({ format: 'tracker-memoire', version: 1, id: 'abcdef-123456', futur: [1, 2], passage: 3 });
    expect(readMarkerPass(text)).toBe(3);
    expect(readMarkerId(text)).toBe('abcdef-123456');
    expect(readMarkerPass(markerTextWithPass(text, 4))).toBe(4);
    for (const wrong of [-2, 2.5, 'trois']) expect(readMarkerPass(JSON.stringify({ format: 'tracker-memoire', version: 1, passage: wrong }))).toBeNull();
    expect(markerTextWithPass(JSON.stringify({ format: 'tracker-memoire', version: MEMORY_VERSION + 1 }), 3)).toBeNull();
    expect(markerTextWithPass(null, 3)).toBeNull();
  });

  it('un identifiant qui ne peut pas nommer un fichier est tenu pour absent', () => {
    expect(isSyncId('../ailleurs')).toBe(false);
    expect(isSyncId('court')).toBe(false);
    expect(isSyncId(42)).toBe(false);
    expect(isSyncId('3f2c9c1e-8a51-4a0e-9b7e-0d6c2b1a4f55')).toBe(true);
    expect(readMarkerId(JSON.stringify({ format: 'tracker-memoire', version: 1, id: '../ailleurs' }))).toBeNull();
  });
});

describe('ce que la synchronisation regarde dans le dossier', () => {
  it('sessions, itinéraires, réglages, FC repos et journaux ; le marqueur pour son identifiant seul', () => {
    expect(syncFileRole('sessions/2026-11-01_10-00-00_wingfoil.gpx')).toBe('session');
    expect(syncFileRole('sessions/a.json')).toBe('session');
    expect(syncFileRole('sessions/a.IMU')).toBe('session');
    expect(syncFileRole('itineraires/Tour.json')).toBe('route');
    expect(syncFileRole('itineraires/Tour.gpx')).toBe('route');
    expect(syncFileRole('reglages/Pixel.json')).toBe('settings');
    expect(syncFileRole('fc-repos.json')).toBe('restingHr');
    expect(syncFileRole('journaux/enregistrement-2026-11-01.json')).toBe('journal');
    expect(syncFileRole('tracker.json')).toBe('marker');
  });

  it('ignorés : LISEZMOI.txt, la corbeille, la base, l’ancien reglages.json, les temporaires, l’inconnu', () => {
    for (const path of [
      'LISEZMOI.txt', 'reglages.json', 'corbeille/corbeille.json', 'corbeille/2026-11-01_123/a.gpx', 'synchro/telephone-0001.json',
      'synchro/telephone-0001/fiches/10-ordinateur.json', 'sessions/a.json.tracker-tmp', 'sessions/a.gpx.tracker-new', 'sessions/a.gpx.tmp',
      'reglages/Pixel.json.tracker-tmp', 'fc-repos.json.tracker-new', 'journaux/x.json.tracker-new', 'sessions/notes.txt', 'sessions/vieux/a.gpx',
      'itineraires/Tour.txt', 'reglages/lisez.txt', 'autre.json', 'sessions/',
    ]) expect(syncFileRole(path), path).toBe('ignored');
  });
});

describe('corbeille du téléphone', () => {
  it('un retrait va dans un dépôt de la corbeille de la mémoire, chaque fichier sous son nom, dans l’ordre donné', () => {
    const paths = ['sessions/a.gpx', 'sessions/a.json', 'sessions/a.imu'];
    const dir = '1795647914477-1795000000000';
    expect([...phoneDepositPaths(dir, paths).entries()]).toEqual(paths.map((p) => [p, `corbeille/${dir}/${p.slice('sessions/'.length)}`]));
    expect([...phoneDepositPaths(dir, ['itineraires/Tour.gpx', 'itineraires/Tour.json']).values()]).toEqual([`corbeille/${dir}/Tour.gpx`, `corbeille/${dir}/Tour.json`]);
  });
});

describe('refus avant tout listage', () => {
  const future = JSON.stringify({ format: 'tracker-memoire', version: MEMORY_VERSION + 1 });

  it('deux dossiers mémoire de cette version se synchronisent', () => {
    expect(syncRefusal(markerText(), markerText())).toBeNull();
  });

  it('un dossier sans marqueur n’est pas un dossier mémoire', () => {
    expect(syncRefusal(markerText(), null)).toBe('phoneNoMarker');
    expect(syncRefusal(null, markerText())).toBe('computerNoMarker');
    expect(syncRefusal(markerText(), '{"format":"autre"}')).toBe('phoneNoMarker');
  });

  it('un dossier d’une version plus récente n’est pas réécrit', () => {
    expect(syncRefusal(markerText(), future)).toBe('phoneNewer');
    expect(syncRefusal(future, markerText())).toBe('computerNewer');
  });
});

describe('lecture et écriture de la base', () => {
  it('se relit telle qu’elle a été écrite', () => {
    const written = { ...base(), syncedAtMs: 123, removed: [5] };
    const text = serializeSyncBase(written);
    expect(JSON.parse(text)).toMatchObject({ format: SYNC_BASE_FORMAT, version: SYNC_BASE_VERSION });
    expect(parseSyncBase(text)).toEqual({ state: 'ok', base: written });
  });

  it('absente, illisible, d’un autre format, ou d’une version plus récente', () => {
    expect(parseSyncBase(null)).toEqual({ state: 'absent' });
    expect(parseSyncBase('{ coupé')).toEqual({ state: 'unreadable' });
    expect(parseSyncBase(JSON.stringify({ format: 'tracker-corbeille', version: 1 }))).toEqual({ state: 'unreadable' });
    expect(parseSyncBase(JSON.stringify({ ...JSON.parse(serializeSyncBase(base())), version: SYNC_BASE_VERSION + 1 }))).toEqual({ state: 'newer' });
    expect(parseSyncBase(JSON.stringify({ ...JSON.parse(serializeSyncBase(base())), phoneId: '../x' }))).toEqual({ state: 'unreadable' });
  });

  it('une ligne mal formée ou en double est écartée seule : sa session redevient une première rencontre', () => {
    const raw = JSON.parse(serializeSyncBase(base()));
    raw.sessions = [raw.sessions[0], { startMs: 20, computer: { gpx: { name: 'x.gpx' } }, phone: null }, raw.sessions[0], 'n’importe quoi'];
    raw.removed = [7, 'x', 10, 7];
    const read = parseSyncBase(JSON.stringify(raw));
    expect(read.state === 'ok' && read.base.sessions.map((s) => s.startMs)).toEqual([10]);
    // Une suppression retenue pour une session encore en ligne ne vaut rien.
    expect(read.state === 'ok' && read.base.removed).toEqual([7]);
  });

  it('une base sans date ni chemin se lit', () => {
    const raw = JSON.parse(serializeSyncBase(base()));
    delete raw.phonePath;
    delete raw.syncedAtMs;
    delete raw.removed;
    delete raw.phonePass;
    const read = parseSyncBase(JSON.stringify(raw));
    expect(read.state === 'ok' && read.base).toMatchObject({ phonePath: null, syncedAtMs: null, phonePass: null, removed: [], held: [] });
  });

  it('le passage du téléphone se relit dans la base ; mal formé, il vaut absent', () => {
    const read = parseSyncBase(serializeSyncBase({ ...base(), phonePass: 12 }));
    expect(read.state === 'ok' && read.base.phonePass).toBe(12);
    expect(read.state === 'ok' && read.base.unknownFields).toBeUndefined();
    for (const wrong of [-1, 1.5, 'douze']) {
      const raw = { ...JSON.parse(serializeSyncBase(base())), phonePass: wrong };
      const bad = parseSyncBase(JSON.stringify(raw));
      expect(bad.state === 'ok' && bad.base.phonePass).toBeNull();
    }
  });

  it('une session laissée sur le téléphone se relit, sauf si elle a retrouvé sa ligne', () => {
    const raw = JSON.parse(serializeSyncBase(base()));
    raw.held = [7, 10, 'x', 7];
    raw.removed = [7, 8];
    const read = parseSyncBase(JSON.stringify(raw));
    expect(read.state === 'ok' && read.base).toMatchObject({ held: [7], removed: [8] });
  });
});

describe('lignes de la base', () => {
  it('poser une ligne remplace celle de la même session et lève sa suppression retenue', () => {
    const next = withSyncLine({ ...base(), removed: [15, 30] }, line(15));
    expect(next.sessions.map((s) => s.startMs)).toEqual([10, 15, 20]);
    expect(next.removed).toEqual([30]);
    const again = withSyncLine(next, { ...line(15), computer: files('autre') });
    expect(again.sessions).toHaveLength(3);
    expect(syncBaseLine(again, 15)?.computer.gpx.name).toBe('autre.gpx');
  });

  it('oublier une ligne retient la suppression, une seule fois', () => {
    const next = withoutSyncLine(withoutSyncLine(base(), 10), 10);
    expect(next.sessions.map((s) => s.startMs)).toEqual([20]);
    expect(next.removed).toEqual([10]);
    expect(syncBaseLine(next, 10)).toBeNull();
    expect(syncBaseLine(null, 10)).toBeNull();
  });

  it('en fin de synchronisation, seules restent retenues les suppressions que la corbeille tient encore', () => {
    const next = withSyncDone({ ...base(), removed: [1, 2, 3], held: [4] }, 999, new Set([2]));
    expect(next.syncedAtMs).toBe(999);
    expect(next.removed).toEqual([2]);
    // Une session laissée sur le téléphone le reste quand la corbeille l'a purgée : c'est pour cela qu'on s'en souvient.
    expect(next.held).toEqual([4]);
  });

  it('une session laissée sur le téléphone est retenue une fois, et oubliée quand elle retrouve une ligne ou disparaît', () => {
    const held = withSyncHeld(withSyncHeld({ ...base(), removed: [15] }, 15), 15);
    expect(held).toMatchObject({ held: [15], removed: [] });
    expect(withSyncLine(held, line(15)).held).toEqual([]);
    expect(withoutSyncLine(held, 15)).toMatchObject({ held: [], removed: [15] });
  });

  it('oublier une session sans la tenir pour supprimée : ni ligne, ni suppression retenue, ni session laissée', () => {
    const start = { ...base(), removed: [15, 30], held: [25] };
    expect(hasSyncMemory(start, 10)).toBe(true);
    expect(hasSyncMemory(start, 15)).toBe(true);
    expect(hasSyncMemory(start, 25)).toBe(true);
    expect(hasSyncMemory(start, 99)).toBe(false);
    const followed = withoutSyncMemory(start, 10);
    expect(followed.sessions.map((s) => s.startMs)).toEqual([20]);
    // Rien dans `removed`, à l'inverse de `withoutSyncLine` : la session reviendra comme une session neuve.
    expect(followed).toMatchObject({ removed: [15, 30], held: [25] });
    expect(withoutSyncMemory(start, 15)).toMatchObject({ removed: [30], held: [25] });
    expect(withoutSyncMemory(start, 25)).toMatchObject({ removed: [15, 30], held: [] });
    expect(withoutSyncMemory(start, 99)).toEqual(start);
    expect(hasSyncMemory(withoutSyncMemory(withoutSyncMemory(start, 10), 15), 10)).toBe(false);
    // Les itinéraires et le reste de la base ne bougent pas.
    const withRoutes = { ...start, removedRoutes: ['a'], heldRoutes: ['b'] };
    expect(withoutSyncMemory(withRoutes, 10)).toMatchObject({ removedRoutes: ['a'], heldRoutes: ['b'], computerId: 'ordinateur-0001', phonePath: 'Documents/Tracker' });
  });

  it('chemins de la base et des fiches gardées, par téléphone', () => {
    expect(syncBasePath('telephone-0001')).toBe('synchro/telephone-0001.json');
    expect(syncAncestorPath('telephone-0001', 1234, 'computer')).toBe('synchro/telephone-0001/fiches/1234-ordinateur.json');
    expect(syncAncestorPath('telephone-0001', 1234, 'phone')).toBe('synchro/telephone-0001/fiches/1234-telephone.json');
  });
});

describe('itinéraires dans la base', () => {
  const route = (id: string, updatedAt = '2026-11-02T10:00:00.000Z'): SyncBaseRoute => ({
    id,
    computer: { json: { name: `${id}.json`, size: 300, mtimeMs: 7 }, gpx: { name: `${id}.gpx`, size: 900, mtimeMs: 8 }, updatedAt },
    phone: { json: { name: `${id}.json`, size: 300, mtimeMs: 70 }, gpx: null, updatedAt },
  });

  it('se relisent tels qu’écrits ; une base sans ces champs se lit, sans aucun itinéraire', () => {
    const written = { ...base(), routes: [route('a'), route('b')], removedRoutes: ['c'], heldRoutes: ['d'] };
    expect(parseSyncBase(serializeSyncBase(written))).toEqual({ state: 'ok', base: written });
    const raw = JSON.parse(serializeSyncBase(base()));
    delete raw.routes;
    delete raw.removedRoutes;
    delete raw.heldRoutes;
    const read = parseSyncBase(JSON.stringify(raw));
    expect(read.state === 'ok' && read.base).toMatchObject({ routes: [], removedRoutes: [], heldRoutes: [] });
  });

  it('une ligne mal formée ou en double est écartée seule ; une identité en ligne n’est ni retenue ni laissée', () => {
    const raw = JSON.parse(serializeSyncBase({ ...base(), routes: [route('a')] }));
    raw.routes = [raw.routes[0], { id: 'b', computer: { json: { name: 'b.json' } }, phone: null }, raw.routes[0], { ...raw.routes[0], id: '' }, 5];
    raw.heldRoutes = ['a', 'h', 'h', 3];
    raw.removedRoutes = ['a', 'h', 'r'];
    const read = parseSyncBase(JSON.stringify(raw));
    expect(read.state === 'ok' && read.base).toMatchObject({ heldRoutes: ['h'], removedRoutes: ['r'] });
    expect(read.state === 'ok' && read.base.routes.map((r) => r.id)).toEqual(['a']);
  });

  it('les champs inconnus de cette version sont gardés à la réécriture', () => {
    const raw = { ...JSON.parse(serializeSyncBase(base())), avenir: { a: 1 }, notes: [1, 2] };
    const read = parseSyncBase(JSON.stringify(raw));
    expect(read.state === 'ok' && read.base.unknownFields).toEqual({ avenir: { a: 1 }, notes: [1, 2] });
    const again = read.state === 'ok' ? JSON.parse(serializeSyncBase(read.base)) : null;
    expect(again).toMatchObject({ format: SYNC_BASE_FORMAT, version: SYNC_BASE_VERSION, avenir: { a: 1 }, notes: [1, 2] });
    expect(again).not.toHaveProperty('unknownFields');
    expect(parseSyncBase(serializeSyncBase(base()))).toEqual({ state: 'ok', base: base() });
  });

  it('poser, oublier et retenir un itinéraire', () => {
    const start = { ...base(), removedRoutes: ['b', 'z'], heldRoutes: ['c'] };
    const set = withRouteLine(withRouteLine(start, route('b')), route('a'));
    expect(set.routes.map((r) => r.id)).toEqual(['a', 'b']);
    expect(set).toMatchObject({ removedRoutes: ['z'], heldRoutes: ['c'] });
    expect(syncRouteBaseLine(withRouteLine(set, route('a', 'autre')), 'a')?.computer.updatedAt).toBe('autre');
    expect(syncRouteBaseLine(null, 'a')).toBeNull();
    const forgotten = withoutRouteLine(withoutRouteLine(set, 'a'), 'a');
    expect(forgotten).toMatchObject({ removedRoutes: ['a', 'z'] });
    expect(forgotten.routes.map((r) => r.id)).toEqual(['b']);
    const held = withRouteHeld(withRouteHeld(forgotten, 'a'), 'a');
    expect(held).toMatchObject({ removedRoutes: ['z'], heldRoutes: ['a', 'c'] });
    expect(withRouteLine(held, route('c')).heldRoutes).toEqual(['a']);
    expect(withoutRouteLine(held, 'c')).toMatchObject({ heldRoutes: ['a'], removedRoutes: ['c', 'z'] });
  });

  it('oublier un itinéraire sans le tenir pour supprimé', () => {
    const start = { ...base(), routes: [route('a'), route('b')], removedRoutes: ['c', 'z'], heldRoutes: ['d'], removed: [15], held: [25] };
    expect(['a', 'c', 'd', 'x'].map((id) => hasRouteMemory(start, id))).toEqual([true, true, true, false]);
    const followed = withoutRouteMemory(start, 'a');
    expect(followed.routes.map((r) => r.id)).toEqual(['b']);
    expect(followed).toMatchObject({ removedRoutes: ['c', 'z'], heldRoutes: ['d'], removed: [15], held: [25] });
    expect(followed.sessions).toEqual(start.sessions);
    expect(withoutRouteMemory(start, 'c')).toMatchObject({ removedRoutes: ['z'], heldRoutes: ['d'] });
    expect(withoutRouteMemory(start, 'd')).toMatchObject({ removedRoutes: ['c', 'z'], heldRoutes: [] });
    expect(withoutRouteMemory(start, 'x')).toEqual(start);
  });

  it('en fin de synchronisation, les suppressions d’itinéraires retenues se réduisent à la corbeille, si on la donne', () => {
    const start = { ...base(), removedRoutes: ['a', 'b'], heldRoutes: ['h'] };
    expect(withSyncDone(start, 1, new Set(), new Set(['b']))).toMatchObject({ removedRoutes: ['b'], heldRoutes: ['h'] });
    expect(withSyncDone(start, 1, new Set()).removedRoutes).toEqual(['a', 'b']);
  });
});
