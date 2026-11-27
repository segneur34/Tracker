import { describe, expect, it } from 'vitest';
import { ROUTE_FORMAT, ROUTE_VERSION, parseRouteRecord, serializeRouteRecord } from '../planning/routeRecord';
import { routePath } from './folderLayout';
import {
  emptySyncBase, otherSyncSide, phoneDepositPaths, withRouteHeld, withRouteLine, withSyncDone, withoutRouteLine,
  type SyncBase, type SyncSideName,
} from './syncBase';
import { SYNC_GUARD_LIMITS, SYNC_GUARD_MAX_REMOVALS, type SyncHeldChoice, type SyncScope } from './syncPlan';
import {
  planRouteSync, restrictRouteSyncPlan, routeRecordsToRead, syncRouteId, syncRouteLineOf, syncRouteListing, syncRouteSide, syncWholeGuard, routesDifferOnlyByPlace,
  type RouteSyncItem, type RouteSyncPlan,
} from './syncRoutes';
import { SYNC_NOW_MS, createSyncFolder, type SyncFolder } from '../test/syncFolder.fixture';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 1, 10, 0, 0);
/** Date ISO du jour de rang `k`. */
const iso = (k: number): string => new Date(T0 + k * DAY).toISOString();

interface TrashedCopy {
  id: string;
  origin: 'ordinateur' | 'telephone';
  base: string;
  json: string;
  gpx: string | null;
}

/** Deux dossiers, la base gardée par l'ordinateur et sa corbeille, réduite à ce que la synchronisation en lit. */
interface RoutePair {
  computer: SyncFolder;
  phone: SyncFolder;
  base: SyncBase | null;
  trash: TrashedCopy[];
}

const pairOf = (): RoutePair => ({
  computer: createSyncFolder({ clockMs: 1_800_000_000_000 }),
  phone: createSyncFolder({ phone: true, clockMs: 1_800_000_417_000 }),
  base: null,
  trash: [],
});

const folderOf = (pair: RoutePair, side: SyncSideName): SyncFolder => (side === 'computer' ? pair.computer : pair.phone);

/** Texte d'une fiche d'itinéraire ; `lat` change le tracé, donc le contenu. */
const recordText = (createdAt: string, updatedAt: string, { name = '', lat = 43.5, version = ROUTE_VERSION } = {}): string =>
  serializeRouteRecord({
    format: ROUTE_FORMAT, version, name, activityId: null, createdAt, updatedAt,
    waypoints: [{ lat, lon: 3.9 }, { lat: lat + 0.01, lon: 3.91 }], legs: [],
  });

/** Range un itinéraire comme l'application de l'appareil : GPX puis fiche. */
const putRoute = (folder: SyncFolder, base: string, createdAt: string, updatedAt: string, options: { name?: string; lat?: number; version?: number } = {}): void => {
  folder.put(routePath(`${base}.gpx`), `<gpx>${base} ${updatedAt} ${options.lat ?? 43.5}</gpx>`);
  folder.put(routePath(`${base}.json`), recordText(createdAt, updatedAt, options));
};

/** Le range de nouveau, changé : autre tracé, autre date de rangement. */
const editRoute = (folder: SyncFolder, base: string, updatedAt: string, lat: number): void => {
  const record = parseRouteRecord(folder.text(routePath(`${base}.json`)) as string);
  putRoute(folder, base, record?.createdAt as string, updatedAt, { lat });
};

/** Supprime un itinéraire comme le téléphone : pour de bon. */
const dropRoute = (folder: SyncFolder, base: string): void => {
  folder.drop(routePath(`${base}.json`));
  folder.drop(routePath(`${base}.gpx`));
};

/** Supprime un itinéraire comme l'ordinateur : sa copie passe à la corbeille. */
const trashRoute = (pair: RoutePair, base: string): void => {
  const json = pair.computer.text(routePath(`${base}.json`)) as string;
  const record = parseRouteRecord(json);
  pair.trash.push({ id: syncRouteId(record?.createdAt, base), origin: 'ordinateur', base, json, gpx: pair.computer.text(routePath(`${base}.gpx`)) });
  dropRoute(pair.computer, base);
};

/** Restaure de la corbeille, sous son nom d'origine, l'itinéraire de cette identité. */
const restoreRoute = (pair: RoutePair, id: string): void => {
  const entry = pair.trash.find((e) => e.id === id) as TrashedCopy;
  if (entry.gpx !== null) pair.computer.put(routePath(`${entry.base}.gpx`), entry.gpx);
  pair.computer.put(routePath(`${entry.base}.json`), entry.json);
  pair.trash = pair.trash.filter((e) => e !== entry);
};

const routesOf = async (folder: SyncFolder): Promise<string[]> =>
  syncRouteListing(await folder.list('itineraires')).routes.map((r) => r.base).sort();

const updatedOf = (folder: SyncFolder, base: string): string | undefined => parseRouteRecord(folder.text(routePath(`${base}.json`)) ?? '')?.updatedAt;

interface RunOptions {
  scope?: Partial<SyncScope>;
  heldOnPhone?: SyncHeldChoice;
  /** Faux : les suppressions au-delà du garde-fou ne sont pas confirmées (par défaut, elles le sont). */
  confirm?: boolean;
  /** Identités que l'utilisateur a dit garder (`RouteSyncInput.keep`). */
  keep?: readonly string[];
}

/**
 * Exécutant minimal du plan, pour éprouver le moteur de bout en bout : il lit ce que le plan demande, fait les
 * opérations dans l'ordre (GPX puis fiche à la copie, fiche puis GPX à la suppression), puis pose la base.
 */
const run = async (pair: RoutePair, options: RunOptions = {}): Promise<RouteSyncPlan & { tripped: boolean }> => {
  const trash = pair.trash.map((e) => ({ id: e.id, text: e.json }));
  const alsoRead = new Set(trash.map((e) => e.id));
  const sideOf = async (side: SyncSideName) => {
    const folder = folderOf(pair, side);
    const listing = syncRouteListing(await folder.list('itineraires'));
    const texts = new Map<string, string | null>();
    for (const name of routeRecordsToRead(listing, pair.base, side, alsoRead)) texts.set(name, await folder.readText(routePath(name)));
    return syncRouteSide(listing, texts);
  };
  const full = planRouteSync({
    base: pair.base, computer: await sideOf('computer'), phone: await sideOf('phone'), trash, heldOnPhone: options.heldOnPhone, keep: options.keep,
  });
  const scope: SyncScope = { computer: true, phone: true, deletions: !full.guard.tripped || options.confirm !== false, ...options.scope };
  const plan = restrictRouteSyncPlan(full, scope);
  let base = pair.base ?? emptySyncBase('ordinateur-0001', 'telephone-0001', null);
  const keep = (side: SyncSideName, item: RouteSyncItem, files: { base: string }) => {
    const folder = folderOf(pair, side);
    pair.trash.push({
      id: item.id, origin: side === 'computer' ? 'ordinateur' : 'telephone', base: files.base,
      json: folder.text(routePath(`${files.base}.json`)) as string, gpx: folder.text(routePath(`${files.base}.gpx`)),
    });
  };
  for (const item of plan.items) {
    for (const op of item.ops) {
      if (op.kind === 'copy') {
        const from = folderOf(pair, otherSyncSide(op.to));
        const to = folderOf(pair, op.to);
        if (op.source.gpx) await to.writeText(routePath(`${op.base}.gpx`), from.text(routePath(op.source.gpx.name)) as string);
        await to.writeText(routePath(`${op.base}.json`), from.text(routePath(op.source.json.name)) as string);
      } else if (op.kind === 'trash') {
        keep('computer', item, op.files);
        dropRoute(pair.computer, op.files.base);
      } else if (op.kind === 'removeFromPhone') {
        if (op.keep) keep('phone', item, op.files);
        // Jamais effacé du téléphone : déposé dans sa corbeille, `depose.json` d'abord, puis GPX et fiche.
        const paths = [...(op.files.gpx ? [routePath(op.files.gpx.name)] : []), routePath(op.files.json.name)];
        const dir = `${SYNC_NOW_MS}-${op.moveTo}`;
        await pair.phone.writeText(`corbeille/${dir}/depose.json`, '{}');
        const targets = phoneDepositPaths(dir, paths);
        for (const path of paths) await pair.phone.moveAside(path, targets.get(path) as string);
      } else {
        keep(op.side, item, op.files);
      }
    }
    const step = item.base;
    if (step.kind === 'set') {
      const stamps = async (side: SyncSideName) => {
        const folder = folderOf(pair, side);
        const at = step[side].base;
        const stat = async (name: string) => {
          const s = await folder.stat(routePath(name));
          return s ? { name, size: s.size, mtimeMs: s.mtimeMs } : null;
        };
        return { json: await stat(`${at}.json`), gpx: await stat(`${at}.gpx`) };
      };
      const line = syncRouteLineOf(item.id, step, { computer: await stamps('computer'), phone: await stamps('phone') });
      if (line) base = withRouteLine(base, line);
    } else if (step.kind === 'forget') {
      base = withoutRouteLine(base, item.id);
    } else if (step.kind === 'hold') {
      base = withRouteHeld(base, item.id);
    }
  }
  pair.base = withSyncDone(base, 0, new Set(), new Set(pair.trash.map((e) => e.id)));
  // Le garde-fou du plan entier : celui du plan restreint ne compte plus que ce qui reste permis.
  return { ...plan, tripped: full.guard.tripped };
};

const itemOf = (plan: RouteSyncPlan, id: string): RouteSyncItem | undefined => plan.items.find((i) => i.id === id);
const opKinds = (plan: RouteSyncPlan): string[] => plan.items.flatMap((i) => i.ops.map((op) => op.kind));
const deletions = (plan: RouteSyncPlan): string[] => opKinds(plan).filter((k) => k === 'trash' || k === 'removeFromPhone');

/** Une paire déjà synchronisée, avec les itinéraires `r0`… des deux côtés (créés aux jours 0, 1…). */
const syncedPair = async (count: number): Promise<RoutePair> => {
  const pair = pairOf();
  for (let k = 0; k < count; k++) putRoute(pair.computer, `r${k}`, iso(k), iso(k));
  await run(pair);
  return pair;
};

describe('listage, identité et fiches à lire', () => {
  it('le listage apparie fiche et GPX par base, met à part un GPX seul, écarte temporaires et autres fichiers', () => {
    const entry = (name: string, kind: 'file' | 'directory' = 'file') => ({ name, kind, size: 10, mtimeMs: 5 });
    const listing = syncRouteListing([
      entry('a.json'), entry('A.gpx'), entry('b.json'), entry('c.gpx'), entry('d.json.tmp'), entry('e.gpx.tracker-new'), entry('notes.txt'), entry('vieux', 'directory'),
    ]);
    expect(listing.routes.map((r) => [r.base, r.json.name, r.gpx?.name ?? null])).toEqual([['a', 'a.json', 'A.gpx'], ['b', 'b.json', null]]);
    expect(listing.orphans.map((f) => f.name)).toEqual(['c.gpx']);
    expect(listing.names).toHaveLength(8);
  });

  it('identité : la date de création, sinon la base en minuscules', () => {
    expect(syncRouteId(iso(0), 'Tour')).toBe(iso(0));
    expect(syncRouteId(new Date(0).toISOString(), 'Tour')).toBe('nom:tour');
    expect(syncRouteId(null, 'Tour')).toBe('nom:tour');
    expect(syncRouteId('  ', 'Tour')).toBe('nom:tour');
  });

  it('une fiche n’est relue que si la base ne la connaît pas sous ce tampon, si sa date est nulle, ou si la corbeille tient son itinéraire', () => {
    const json = { name: 'a.json', size: 300, mtimeMs: 7 };
    const base = withRouteLine(emptySyncBase('ordinateur-0001', 'telephone-0001', null), {
      id: iso(0), computer: { json, gpx: null, updatedAt: iso(0) }, phone: { json, gpx: null, updatedAt: iso(0) },
    });
    const listing = (mtimeMs: number, size = 300) => syncRouteListing([{ name: 'a.json', kind: 'file', size, mtimeMs }, { name: 'b.json', kind: 'file', size: 1, mtimeMs: 1 }]);
    expect(routeRecordsToRead(listing(7), base, 'phone')).toEqual(['b.json']);
    expect(routeRecordsToRead(listing(8), base, 'phone')).toEqual(['a.json', 'b.json']);
    expect(routeRecordsToRead(listing(7, 301), base, 'phone')).toEqual(['a.json', 'b.json']);
    expect(routeRecordsToRead(listing(0), base, 'phone')).toEqual(['a.json', 'b.json']);
    expect(routeRecordsToRead(listing(7), base, 'phone', new Set([iso(0)]))).toEqual(['a.json', 'b.json']);
    expect(routeRecordsToRead(listing(7), null, 'phone')).toEqual(['a.json', 'b.json']);
  });
});

describe('première rencontre', () => {
  it('réunit sans rien supprimer, pose la base, puis plus rien à faire', async () => {
    const pair = pairOf();
    putRoute(pair.computer, 'ordi', iso(0), iso(0));
    putRoute(pair.phone, 'tel', iso(1), iso(1));
    putRoute(pair.computer, 'commun', iso(2), iso(3));
    putRoute(pair.phone, 'commun', iso(2), iso(3));
    const plan = await run(pair);
    expect(deletions(plan)).toEqual([]);
    expect(itemOf(plan, iso(2))).toMatchObject({ case: 'firstMeeting', ops: [], base: { kind: 'set' } });
    for (const folder of [pair.computer, pair.phone]) expect(await routesOf(folder)).toEqual(['commun', 'ordi', 'tel']);
    // Recopié à l'octet, GPX compris.
    expect(pair.computer.text(routePath('tel.json'))).toBe(pair.phone.text(routePath('tel.json')));
    expect(pair.phone.text(routePath('ordi.gpx'))).toBe(pair.computer.text(routePath('ordi.gpx')));
    expect(pair.base?.routes.map((r) => r.id)).toEqual([iso(0), iso(1), iso(2)]);
    expect((await run(pair)).items).toEqual([]);
  });

  it('même itinéraire, fiches différentes : la plus récente gagne, l’autre va à la corbeille ; à égalité, l’ordinateur', async () => {
    const pair = pairOf();
    putRoute(pair.computer, 'a', iso(0), iso(1), { lat: 44 });
    putRoute(pair.phone, 'a', iso(0), iso(2), { lat: 45 });
    putRoute(pair.computer, 'b', iso(5), iso(6), { lat: 44 });
    putRoute(pair.phone, 'b', iso(5), iso(6), { lat: 45 });
    const plan = await run(pair);
    expect(itemOf(plan, iso(0))).toMatchObject({ case: 'firstMeeting', conflict: true });
    expect(updatedOf(pair.computer, 'a')).toBe(iso(2));
    expect(pair.computer.text(routePath('b.json'))).toBe(pair.phone.text(routePath('b.json')));
    expect(parseRouteRecord(pair.phone.text(routePath('b.json')) as string)?.waypoints[0].lat).toBe(44);
    expect(pair.trash.map((e) => [e.id, e.origin])).toEqual([[iso(0), 'ordinateur'], [iso(5), 'telephone']]);
    expect((await run(pair)).items).toEqual([]);
  });
});

describe('suivi', () => {
  it('changé d’un seul côté : recopié à l’octet de l’autre, dans les deux sens', async () => {
    const pair = await syncedPair(2);
    editRoute(pair.phone, 'r0', iso(10), 46);
    editRoute(pair.computer, 'r1', iso(11), 47);
    const plan = await run(pair);
    expect(opKinds(plan)).toEqual(['copy', 'copy']);
    expect(pair.computer.text(routePath('r0.json'))).toBe(pair.phone.text(routePath('r0.json')));
    expect(pair.phone.text(routePath('r1.gpx'))).toBe(pair.computer.text(routePath('r1.gpx')));
    expect(pair.trash).toEqual([]);
    expect((await run(pair)).items).toEqual([]);
  });

  it('changé des deux côtés : la plus récente date de rangement gagne, l’autre version est dans la corbeille', async () => {
    const pair = await syncedPair(1);
    editRoute(pair.computer, 'r0', iso(20), 46);
    editRoute(pair.phone, 'r0', iso(21), 47);
    const plan = await run(pair);
    expect(itemOf(plan, iso(0))).toMatchObject({ case: 'followed', conflict: true });
    expect(opKinds(plan)).toEqual(['loserToTrash', 'copy']);
    expect(updatedOf(pair.computer, 'r0')).toBe(iso(21));
    expect(pair.trash).toMatchObject([{ id: iso(0), origin: 'ordinateur' }]);
    expect(parseRouteRecord(pair.trash[0].json)?.updatedAt).toBe(iso(20));
    expect((await run(pair)).items).toEqual([]);
  });

  it('supprimé sur le téléphone : la copie de l’ordinateur va à sa corbeille, et la suppression est retenue', async () => {
    const pair = await syncedPair(2);
    dropRoute(pair.phone, 'r0');
    const plan = await run(pair);
    expect(itemOf(plan, iso(0))).toMatchObject({ case: 'deletedOnPhone', ops: [{ kind: 'trash', absent: 'r0.json' }] });
    expect(await routesOf(pair.computer)).toEqual(['r1']);
    expect(pair.trash).toMatchObject([{ id: iso(0), origin: 'ordinateur', base: 'r0' }]);
    expect(pair.base).toMatchObject({ removedRoutes: [iso(0)] });
    expect(pair.base?.routes.map((r) => r.id)).toEqual([iso(1)]);
    expect((await run(pair)).items).toEqual([]);
  });

  it('supprimé sur l’ordinateur : retiré du téléphone, sans rien de plus à la corbeille qui tient la même fiche', async () => {
    const pair = await syncedPair(2);
    trashRoute(pair, 'r1');
    const plan = await run(pair);
    expect(itemOf(plan, iso(1))).toMatchObject({ case: 'deletedOnComputer', ops: [{ kind: 'removeFromPhone', keep: false, absent: 'r1.json' }] });
    expect(await routesOf(pair.phone)).toEqual(['r0']);
    expect(pair.trash).toHaveLength(1);
    expect(itemOf(plan, iso(1))?.ops[0]).toMatchObject({ moveTo: 'r1' });
    expect([...pair.phone.aside().keys()]).toEqual([`corbeille/${SYNC_NOW_MS}-r1/r1.gpx`, `corbeille/${SYNC_NOW_MS}-r1/r1.json`]);
  });

  it('la corbeille ne tient pas la même fiche (même taille, autre contenu) : la copie du téléphone y est rangée d’abord', async () => {
    const pair = await syncedPair(1);
    trashRoute(pair, 'r0');
    // Même taille, autre tracé : seule la comparaison du contenu le voit.
    pair.trash[0].json = pair.trash[0].json.replace('"lat":43.5,', '"lat":43.6,');
    const plan = await run(pair);
    expect(itemOf(plan, iso(0))?.ops).toMatchObject([{ kind: 'removeFromPhone', keep: true }]);
    expect(pair.trash.map((e) => e.origin)).toEqual(['ordinateur', 'telephone']);
    expect(await routesOf(pair.phone)).toEqual([]);
  });

  it('changé d’un côté, supprimé de l’autre : la modification revient, dans les deux sens', async () => {
    const pair = await syncedPair(2);
    editRoute(pair.computer, 'r0', iso(30), 46);
    dropRoute(pair.phone, 'r0');
    editRoute(pair.phone, 'r1', iso(31), 47);
    trashRoute(pair, 'r1');
    const plan = await run(pair);
    expect(deletions(plan)).toEqual([]);
    expect(itemOf(plan, iso(0))).toMatchObject({ case: 'deletedOnPhone', revived: true });
    expect(itemOf(plan, iso(1))).toMatchObject({ case: 'deletedOnComputer', revived: true });
    expect(updatedOf(pair.phone, 'r0')).toBe(iso(30));
    expect(updatedOf(pair.computer, 'r1')).toBe(iso(31));
    expect((await run(pair)).items).toEqual([]);
  });

  it('supprimé des deux côtés : la base l’oublie', async () => {
    const pair = await syncedPair(1);
    trashRoute(pair, 'r0');
    dropRoute(pair.phone, 'r0');
    const plan = await run(pair);
    expect(itemOf(plan, iso(0))).toMatchObject({ case: 'deletedOnBoth', ops: [], base: { kind: 'forget' } });
    expect(pair.base?.routes).toEqual([]);
  });

  // Le nom de fichier d'un itinéraire vient de son nom affiché : un itinéraire créé au même lieu le même jour, sans
  // nom saisi, reprend celui d'un itinéraire supprimé juste avant.
  it('supprimé sur l’ordinateur puis un autre rangé sous le même nom : l’ancien est retiré du téléphone, le neuf y est copié sous un nom libre', async () => {
    const pair = await syncedPair(1);
    trashRoute(pair, 'r0');
    putRoute(pair.computer, 'r0', iso(5), iso(5), { lat: 44 });
    const plan = await run(pair);
    expect(itemOf(plan, iso(0))).toMatchObject({ case: 'deletedOnComputer', ops: [{ kind: 'removeFromPhone', files: { base: 'r0' }, absent: 'r0.json' }] });
    expect(itemOf(plan, iso(5))).toMatchObject({ case: 'newOnComputer', ops: [{ kind: 'copy', to: 'phone', base: 'r0-2' }] });
    expect(await routesOf(pair.phone)).toEqual(['r0-2']);
    expect(pair.phone.text(routePath('r0-2.json'))).toBe(pair.computer.text(routePath('r0.json')));
    expect(pair.base?.routes).toMatchObject([{ id: iso(5), computer: { json: { name: 'r0.json' } }, phone: { json: { name: 'r0-2.json' } } }]);
    expect((await run(pair)).items).toEqual([]);
  });

  it('supprimé sur le téléphone puis un autre rangé sous le même nom : l’ancien va à la corbeille de l’ordinateur, le neuf y est copié sous un nom libre', async () => {
    const pair = await syncedPair(1);
    dropRoute(pair.phone, 'r0');
    putRoute(pair.phone, 'r0', iso(5), iso(5), { lat: 44 });
    const plan = await run(pair);
    expect(itemOf(plan, iso(0))).toMatchObject({ case: 'deletedOnPhone', ops: [{ kind: 'trash', files: { base: 'r0' }, absent: 'r0.json' }] });
    expect(itemOf(plan, iso(5))).toMatchObject({ case: 'newOnPhone', ops: [{ kind: 'copy', to: 'computer', base: 'r0-2' }] });
    expect(await routesOf(pair.computer)).toEqual(['r0-2']);
    expect(pair.computer.text(routePath('r0-2.json'))).toBe(pair.phone.text(routePath('r0.json')));
    expect(pair.trash).toMatchObject([{ id: iso(0), origin: 'ordinateur', base: 'r0' }]);
    expect(pair.base?.routes).toMatchObject([{ id: iso(5), computer: { json: { name: 'r0-2.json' } }, phone: { json: { name: 'r0.json' } } }]);
    expect((await run(pair)).items).toEqual([]);
  });
});

describe('corbeille', () => {
  it('restauré depuis la corbeille de l’ordinateur après sa suppression : il revient sur les deux', async () => {
    const pair = await syncedPair(1);
    trashRoute(pair, 'r0');
    await run(pair);
    expect(await routesOf(pair.phone)).toEqual([]);
    restoreRoute(pair, iso(0));
    const plan = await run(pair);
    expect(itemOf(plan, iso(0))).toMatchObject({ case: 'newOnComputer' });
    expect(await routesOf(pair.phone)).toEqual(['r0']);
    expect(pair.base).toMatchObject({ removedRoutes: [], routes: [{ id: iso(0) }] });
  });

  it('remis sur le téléphone après une suppression menée au bout : il revient sur l’ordinateur', async () => {
    const pair = await syncedPair(1);
    const saved = pair.phone.text(routePath('r0.json')) as string;
    trashRoute(pair, 'r0');
    await run(pair);
    pair.phone.put(routePath('r0.json'), saved);
    const plan = await run(pair);
    expect(itemOf(plan, iso(0))).toMatchObject({ case: 'newOnPhone', left: null });
    expect(await routesOf(pair.computer)).toEqual(['r0']);
  });

  it('dans la corbeille de l’ordinateur sans ligne de base, encore sur le téléphone : laissé et retenu, ou retiré au choix', async () => {
    const pair = pairOf();
    putRoute(pair.computer, 'a', iso(0), iso(0));
    putRoute(pair.phone, 'a', iso(0), iso(0));
    trashRoute(pair, 'a');
    const plan = await run(pair);
    expect(itemOf(plan, iso(0))).toMatchObject({ case: 'newOnPhone', left: 'inTrash', ops: [], base: { kind: 'hold' } });
    expect(pair.base).toMatchObject({ heldRoutes: [iso(0)] });
    // La corbeille purgée ne le ramène pas.
    pair.trash = [];
    expect(itemOf(await run(pair), iso(0))).toMatchObject({ left: 'inTrash' });
    const removed = await run(pair, { heldOnPhone: 'remove' });
    expect(removed.guard).toMatchObject({ tripped: true, fromPhone: 1 });
    expect(itemOf(removed, iso(0))).toMatchObject({ case: 'deletedOnComputer', ops: [{ kind: 'removeFromPhone', keep: true }] });
    expect(await routesOf(pair.phone)).toEqual([]);
    expect(pair.base).toMatchObject({ heldRoutes: [] });
  });

  it('retenu sur le téléphone puis remis sur l’ordinateur : une rencontre sans ligne, dite restaurée ; une suppression refusée non', async () => {
    const pair = pairOf();
    putRoute(pair.computer, 'a', iso(0), iso(0));
    putRoute(pair.phone, 'a', iso(0), iso(0));
    trashRoute(pair, 'a');
    await run(pair);
    expect(pair.base).toMatchObject({ heldRoutes: [iso(0)] });
    putRoute(pair.computer, 'a', iso(0), iso(0));
    pair.trash = [];
    const back = await run(pair);
    expect(itemOf(back, iso(0))).toMatchObject({ case: 'firstMeeting', restored: true, revived: false, left: null });
    expect(deletions(back)).toEqual([]);
    expect(pair.base).toMatchObject({ heldRoutes: [], routes: [{ id: iso(0) }] });

    const other = await syncedPair(2);
    dropRoute(other.phone, 'r1');
    expect(itemOf(await run(other, { keep: [iso(1)] }), iso(1))).toMatchObject({ case: 'newOnComputer', restored: false });
  });

  it('supprimé sur l’ordinateur puis restauré sur le téléphone : recopié sur l’ordinateur sans question, dit restauré', async () => {
    const pair = await syncedPair(2);
    trashRoute(pair, 'r1');
    await run(pair);
    expect(pair.base).toMatchObject({ removedRoutes: [iso(1)] });
    putRoute(pair.phone, 'r1', iso(1), iso(1));
    const back = await run(pair);
    expect(itemOf(back, iso(1))).toMatchObject({ case: 'newOnPhone', restored: true, left: null, ops: [{ kind: 'copy', to: 'computer' }] });
    expect(back.guard.tripped).toBe(false);
    expect(await routesOf(pair.computer)).toEqual(['r0', 'r1']);
  });
});

describe('suppressions refusées (`keep`)', () => {
  it('supprimé sur le téléphone, refusé : recopié sur le téléphone, sa ligne reposée', async () => {
    const pair = await syncedPair(2);
    dropRoute(pair.phone, 'r1');
    const plan = await run(pair, { keep: [iso(1)] });
    expect(itemOf(plan, iso(1))).toMatchObject({ case: 'newOnComputer', left: null, revived: false, ops: [{ kind: 'copy', to: 'phone' }], base: { kind: 'set' } });
    expect(plan.guard).toMatchObject({ toTrash: 0, fromPhone: 0 });
    expect(await routesOf(pair.phone)).toEqual(['r0', 'r1']);
    expect(await routesOf(pair.computer)).toEqual(['r0', 'r1']);
    expect(pair.trash).toEqual([]);
    expect(pair.base).toMatchObject({ removedRoutes: [], routes: [{ id: iso(0) }, { id: iso(1) }] });
    expect((await run(pair)).items).toEqual([]);
  });

  it('supprimé sur l’ordinateur, refusé : recopié du téléphone sur l’ordinateur, rien n’est retiré du téléphone', async () => {
    const pair = await syncedPair(2);
    trashRoute(pair, 'r1');
    const plan = await run(pair, { keep: [iso(1)] });
    expect(itemOf(plan, iso(1))).toMatchObject({ case: 'newOnPhone', left: null, ops: [{ kind: 'copy', to: 'computer' }], base: { kind: 'set' } });
    expect(deletions(plan)).toEqual([]);
    expect(await routesOf(pair.phone)).toEqual(['r0', 'r1']);
    expect(await routesOf(pair.computer)).toEqual(['r0', 'r1']);
    expect(pair.base?.routes.map((r) => r.id)).toEqual([iso(0), iso(1)]);
    expect((await run(pair)).items).toEqual([]);
  });

  it('dans la corbeille de l’ordinateur et encore sur le téléphone, gardé : il revient sur l’ordinateur et n’est plus retenu', async () => {
    const pair = pairOf();
    putRoute(pair.computer, 'a', iso(0), iso(0));
    putRoute(pair.phone, 'a', iso(0), iso(0));
    trashRoute(pair, 'a');
    await run(pair);
    expect(pair.base).toMatchObject({ heldRoutes: [iso(0)] });
    const plan = await run(pair, { keep: [iso(0)], heldOnPhone: 'remove' });
    expect(itemOf(plan, iso(0))).toMatchObject({ case: 'newOnPhone', left: null, ops: [{ kind: 'copy', to: 'computer' }] });
    expect(await routesOf(pair.computer)).toEqual(['a']);
    expect(await routesOf(pair.phone)).toEqual(['a']);
    expect(pair.base).toMatchObject({ heldRoutes: [], routes: [{ id: iso(0) }] });
  });

  it('`keep` n’agit que sur une suppression : un itinéraire suivi ou inconnu suit le plan ordinaire, une autre suppression reste comptée', async () => {
    const pair = await syncedPair(3);
    editRoute(pair.phone, 'r0', iso(9), 44);
    dropRoute(pair.phone, 'r1');
    dropRoute(pair.phone, 'r2');
    const plan = await run(pair, { keep: [iso(0), iso(1), iso(42)], confirm: false });
    expect(plan.tripped).toBe(true);
    expect(itemOf(plan, iso(0))).toMatchObject({ case: 'followed', ops: [{ kind: 'copy', to: 'computer' }] });
    expect(itemOf(plan, iso(1))).toMatchObject({ case: 'newOnComputer', ops: [{ kind: 'copy', to: 'phone' }] });
    expect(itemOf(plan, iso(2))).toMatchObject({ case: 'deletedOnPhone', left: 'outOfScope', ops: [] });
    expect(itemOf(plan, iso(42))).toBeUndefined();
    expect(await routesOf(pair.computer)).toEqual(['r0', 'r1', 'r2']);
    expect(await routesOf(pair.phone)).toEqual(['r0', 'r1']);
  });
});

describe('ce qui est laissé tel quel', () => {
  it('une fiche d’une version plus récente n’est jamais écrasée, mais se recopie là où rien ne l’attend', async () => {
    const pair = pairOf();
    putRoute(pair.computer, 'a', iso(0), iso(5));
    putRoute(pair.phone, 'a', iso(0), iso(1), { version: ROUTE_VERSION + 1 });
    putRoute(pair.phone, 'b', iso(2), iso(2), { version: ROUTE_VERSION + 1 });
    const plan = await run(pair);
    expect(itemOf(plan, iso(0))).toMatchObject({ left: 'newer', ops: [] });
    expect(parseRouteRecord(pair.phone.text(routePath('a.json')) as string)?.version).toBe(ROUTE_VERSION + 1);
    expect(pair.computer.text(routePath('b.json'))).toBe(pair.phone.text(routePath('b.json')));
  });

  it('une fiche illisible n’est ni recopiée, ni écrasée, ni tenue pour supprimée', async () => {
    const pair = await syncedPair(1);
    pair.phone.put(routePath('r0.json'), '{ coupé');
    pair.phone.put(routePath('perdu.json'), 'pas une fiche');
    const plan = await run(pair);
    expect(itemOf(plan, iso(0))).toMatchObject({ left: 'unreadable', ops: [], base: { kind: 'keep' } });
    expect(plan.aside).toEqual([{ side: 'phone', base: 'perdu', reason: 'unreadable' }]);
    expect(await routesOf(pair.computer)).toEqual(['r0']);
    expect(pair.trash).toEqual([]);
  });

  it('deux fiches du même itinéraire d’un côté : une seule voyage, l’autre est signalée', async () => {
    const pair = pairOf();
    putRoute(pair.phone, 'a', iso(0), iso(1));
    putRoute(pair.phone, 'a copie', iso(0), iso(3), { lat: 46 });
    const plan = await run(pair);
    expect(plan.aside).toEqual([{ side: 'phone', base: 'a', reason: 'duplicate' }]);
    expect(await routesOf(pair.computer)).toEqual(['a copie']);
    expect((await run(pair)).items).toEqual([]);
  });

  it('GPX exporté puis réimporté (même date de création, autre itinéraire) : la suppression de l’original ne l’emporte pas', async () => {
    const pair = await syncedPair(1);
    putRoute(pair.computer, 'importe', iso(0), iso(4), { lat: 46 });
    putRoute(pair.phone, 'importe tel', iso(0), iso(5), { lat: 47 });
    dropRoute(pair.phone, 'r0');
    const plan = await run(pair);
    expect(itemOf(plan, iso(0))).toMatchObject({ case: 'deletedOnPhone', ops: [{ kind: 'trash', files: { base: 'r0' } }] });
    expect(plan.aside).toEqual([{ side: 'computer', base: 'importe', reason: 'duplicate' }, { side: 'phone', base: 'importe tel', reason: 'duplicate' }]);
    expect(pair.trash.map((e) => e.base)).toEqual(['r0']);
    expect(await routesOf(pair.computer)).toEqual(['importe']);
    expect(await routesOf(pair.phone)).toEqual(['importe tel']);

    const other = await syncedPair(1);
    putRoute(other.phone, 'importe', iso(0), iso(4), { lat: 46 });
    trashRoute(other, 'r0');
    const removal = await run(other);
    expect(itemOf(removal, iso(0))).toMatchObject({ case: 'deletedOnComputer', ops: [{ kind: 'removeFromPhone', files: { base: 'r0' } }] });
    expect(await routesOf(other.phone)).toEqual(['importe']);
    // Seul de son identité, il voyage ensuite comme un itinéraire neuf, sans rien retirer.
    const next = await run(other);
    expect(deletions(next)).toEqual([]);
    expect(await routesOf(other.computer)).toEqual(['importe']);
  });

  it('base déjà prise de l’autre côté par un autre itinéraire : la copie en prend une libre ; un GPX seul de la même copie est repris', async () => {
    const pair = pairOf();
    putRoute(pair.computer, 'Tour', iso(0), iso(0));
    putRoute(pair.phone, 'tour', iso(1), iso(1), { lat: 46 });
    putRoute(pair.phone, 'coupe', iso(2), iso(2));
    pair.computer.put(routePath('coupe.gpx'), pair.phone.text(routePath('coupe.gpx')) as string);
    const plan = await run(pair);
    expect(itemOf(plan, iso(1))?.ops).toMatchObject([{ kind: 'copy', to: 'computer', base: 'tour-2' }]);
    expect(itemOf(plan, iso(2))?.ops).toMatchObject([{ kind: 'copy', to: 'computer', base: 'coupe', replaces: { json: null, gpx: { name: 'coupe.gpx' } } }]);
    expect(await routesOf(pair.computer)).toEqual(['coupe', 'Tour', 'tour-2'].sort());
    expect(await routesOf(pair.phone)).toEqual(['coupe', 'tour', 'Tour-2'].sort());
    expect((await run(pair)).items).toEqual([]);
  });
});

describe('garde-fou et restrictions', () => {
  it('au-delà du seuil, aucune suppression sans confirmation ; confirmée, elles se font', async () => {
    const count = SYNC_GUARD_MAX_REMOVALS + 1;
    const pair = await syncedPair(count);
    for (let k = 0; k < count; k++) dropRoute(pair.phone, `r${k}`);
    const held = await run(pair, { confirm: false });
    expect(held.tripped).toBe(true);
    expect(held.guard).toMatchObject({ tripped: false, toTrash: 0 });
    expect(held.items.every((i) => i.left === 'outOfScope' && i.base.kind === 'keep')).toBe(true);
    expect(await routesOf(pair.computer)).toHaveLength(count);
    await run(pair);
    expect(await routesOf(pair.computer)).toEqual([]);
    expect(pair.trash).toHaveLength(count);
  });

  it('plus du quart d’un côté déclenche aussi le garde-fou', async () => {
    const pair = await syncedPair(3);
    dropRoute(pair.phone, 'r0');
    const plan = await run(pair, { confirm: false });
    expect(plan.tripped).toBe(true);
    expect(plan.guard).toMatchObject({ toTrash: 0, count: { computer: 3, phone: 2 } });
  });

  it('téléphone en lecture seule : seule la moitié de l’ordinateur se fait', async () => {
    const pair = await syncedPair(3);
    putRoute(pair.computer, 'neuf', iso(9), iso(9));
    putRoute(pair.phone, 'du-tel', iso(8), iso(8));
    // Conflit gagné par le téléphone : tout se fait sur l'ordinateur.
    editRoute(pair.computer, 'r0', iso(20), 46);
    editRoute(pair.phone, 'r0', iso(21), 47);
    // Conflit gagné par l'ordinateur : il attend, la version du téléphone n'étant ni rangée ni écrasée.
    editRoute(pair.computer, 'r2', iso(23), 49);
    editRoute(pair.phone, 'r2', iso(22), 50);
    editRoute(pair.computer, 'r1', iso(24), 48);
    trashRoute(pair, 'r1');
    pair.trash = [];
    const plan = await run(pair, { scope: { phone: false } });
    expect(itemOf(plan, iso(9))).toMatchObject({ left: 'outOfScope', ops: [], base: { kind: 'keep' } });
    expect(itemOf(plan, iso(8))?.ops).toMatchObject([{ kind: 'copy', to: 'computer' }]);
    expect(itemOf(plan, iso(0))).toMatchObject({ conflict: true, left: null, ops: [{ kind: 'loserToTrash', side: 'computer' }, { kind: 'copy', to: 'computer' }] });
    expect(itemOf(plan, iso(2))).toMatchObject({ conflict: true, left: 'outOfScope', ops: [] });
    expect(itemOf(plan, iso(1))).toMatchObject({ left: 'outOfScope', ops: [] });
    expect(await routesOf(pair.phone)).toEqual(['du-tel', 'r0', 'r1', 'r2']);
    expect(updatedOf(pair.computer, 'r0')).toBe(iso(21));
    expect(updatedOf(pair.phone, 'r2')).toBe(iso(22));
    expect(pair.trash).toMatchObject([{ id: iso(0), origin: 'ordinateur' }]);
  });

  it('lieu trouvé des deux côtés, sans autre changement : ni conflit ni corbeille, le lieu de l’ordinateur gagne', async () => {
    const pair = await syncedPair(2);
    // Le lieu est rangé dans la fiche sans changer `updatedAt` (lot 236), chacun le sien.
    const withPlace = (folder: SyncFolder, base: string, place: unknown): void => {
      const record = JSON.parse(folder.text(routePath(`${base}.json`)) as string) as Record<string, unknown>;
      folder.put(routePath(`${base}.json`), `${JSON.stringify({ ...record, place })}\n`);
    };
    withPlace(pair.computer, 'r0', { name: 'Montpellier', fetchedAt: 1 });
    withPlace(pair.phone, 'r0', { name: 'Montpellier-Centre', fetchedAt: 2 });
    // Un seul côté l'a trouvé, l'autre non, et les deux fiches ont été relues : le lieu passe, sans conflit.
    withPlace(pair.phone, 'r1', { name: 'Sète', fetchedAt: 3 });
    withPlace(pair.computer, 'r1', undefined);
    const plan = await run(pair);
    expect(itemOf(plan, iso(0))).toMatchObject({ conflict: false, ops: [{ kind: 'copy', to: 'phone' }] });
    expect(itemOf(plan, iso(1))).toMatchObject({ conflict: false, ops: [{ kind: 'copy', to: 'computer' }] });
    expect(opKinds(plan)).not.toContain('loserToTrash');
    expect(pair.trash).toEqual([]);
    expect(JSON.parse(pair.phone.text(routePath('r0.json')) as string).place).toEqual({ name: 'Montpellier', fetchedAt: 1 });
    expect(JSON.parse(pair.computer.text(routePath('r1.json')) as string).place).toEqual({ name: 'Sète', fetchedAt: 3 });
    // Autre chose changé que le lieu : c'est bien un conflit, la perdante passe à la corbeille.
    editRoute(pair.computer, 'r0', iso(20), 46);
    editRoute(pair.phone, 'r0', iso(21), 47);
    expect(itemOf(await run(pair), iso(0))).toMatchObject({ conflict: true, ops: [{ kind: 'loserToTrash' }, { kind: 'copy', to: 'computer' }] });
    expect(routesDifferOnlyByPlace('{"a":1,"place":{"n":1}}', '{"place":{"n":2},"a":1}')).toBe(true);
    expect(routesDifferOnlyByPlace('{"a":1}', '{"a":2}')).toBe(false);
    expect(routesDifferOnlyByPlace('pas du json', '{"a":1}')).toBe(false);
  });

  it('une version perdante n’est jamais écrasée sans avoir été rangée : un conflit à moitié permis attend entier', () => {
    const json = (name: string) => ({ name, size: 1, mtimeMs: 1 });
    const files = { base: 'a', json: json('a.json'), gpx: null };
    const plan: RouteSyncPlan = {
      items: [{
        id: iso(0), createdAt: iso(0), case: 'followed', files: { computer: 'a', phone: 'a' }, conflict: true, revived: false, left: null,
        ops: [{ kind: 'loserToTrash', side: 'phone', files }, { kind: 'copy', to: 'phone', source: files, base: 'a', replaces: { json: json('a.json'), gpx: null } }],
        base: { kind: 'set', computer: { base: 'a', updatedAt: iso(1) }, phone: { base: 'a', updatedAt: iso(1) } },
      }],
      aside: [],
      guard: { tripped: false, limits: SYNC_GUARD_LIMITS, toTrash: 0, fromPhone: 0, count: { computer: 1, phone: 1 } },
    };
    expect(restrictRouteSyncPlan(plan, { computer: false, phone: true, deletions: true }).items[0]).toMatchObject({ ops: [], left: 'outOfScope', base: { kind: 'keep' } });
    expect(restrictRouteSyncPlan(plan, { computer: true, phone: true, deletions: false }).items[0].ops).toHaveLength(2);
  });
});

describe('garde-fou de toute la synchronisation', () => {
  it('itinéraires absents du listage du téléphone : jamais pris pour « tout supprimé » sans que le garde-fou le dise', async () => {
    const pair = await syncedPair(3);
    for (const base of ['r0', 'r1', 'r2']) dropRoute(pair.phone, base);
    const plan = await run(pair, { confirm: false });
    expect(plan.tripped).toBe(true);
    expect(await routesOf(pair.computer)).toEqual(['r0', 'r1', 'r2']);
    const noSessionRemoved = { tripped: false, limits: SYNC_GUARD_LIMITS, toTrash: 0, fromPhone: 0, count: { computer: 50, phone: 50 } };
    const routesGuard = { tripped: true, limits: SYNC_GUARD_LIMITS, toTrash: 3, fromPhone: 0, count: { computer: 3, phone: 0 } };
    expect(syncWholeGuard(noSessionRemoved, routesGuard)).toMatchObject({ tripped: true, toTrash: 3, fromPhone: 0 });
  });

  it('sessions et itinéraires additionnés au-delà du nombre permis, chacun en dessous seul', () => {
    const guard = (toTrash: number, fromPhone: number) => ({ tripped: false, limits: SYNC_GUARD_LIMITS, toTrash, fromPhone, count: { computer: 100, phone: 100 } });
    expect(syncWholeGuard(guard(6, 0), guard(0, 5))).toMatchObject({ tripped: true, toTrash: 6, fromPhone: 5 });
    expect(syncWholeGuard(guard(5, 0), guard(0, 5)).tripped).toBe(false);
    expect(syncWholeGuard(guard(5, 0), null).tripped).toBe(false);
    // Seuils abaissés pour les sessions : ils valent pour l'ensemble.
    expect(syncWholeGuard({ ...guard(1, 0), limits: { maxRemovals: 1, maxShare: 1 } }, guard(1, 0)).tripped).toBe(true);
  });
});
