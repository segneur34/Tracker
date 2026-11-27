import { isWritableRouteRecord, parseRouteRecord, routeFileBase } from '../planning/routeRecord';
import { sameStamp } from './recordMerge';
import { SYNC_SIDES, otherSyncSide, syncRouteBaseLine, type SyncBase, type SyncBaseRoute, type SyncSideName, type SyncStamp } from './syncBase';
import {
  SYNC_GUARD_LIMITS, SYNC_HELD_ON_PHONE, syncGuardOf,
  type SyncCase, type SyncGuard, type SyncGuardLimits, type SyncHeldChoice, type SyncListedEntry, type SyncScope,
} from './syncPlan';

/**
 * Plan d'une synchronisation des itinéraires (`itineraires/`) entre l'ordinateur et le téléphone, sur le modèle de
 * celui des sessions (`syncPlan.ts`) : des deux listages, des fiches lues et de la base, la liste de ce qu'il y a à
 * faire. Ce module ne lit ni n'écrit rien.
 *
 * Un itinéraire est sa fiche (`<base>.json`, qui fait foi) et le GPX exporté à côté (`<base>.gpx`). Il est reconnu à
 * sa date de création (`syncRouteId`), jamais à son nom de fichier, figé au premier rangement sur chaque appareil.
 * Il n'y a pas de fiche gardée : un itinéraire se recopie entier, GPX puis fiche, à l'octet, et la ligne de base
 * n'est posée que lorsque les deux côtés tiennent la même fiche. Un côté a changé l'itinéraire si sa fiche, relue,
 * porte une autre date de rangement (`updatedAt`) ou une autre taille que celles de la base.
 *
 *     ordinateur  téléphone  base
 *        oui         non      non    neuf sur l'ordinateur : recopié sur le téléphone
 *        non         oui      non    neuf sur le téléphone : recopié sur l'ordinateur (sauf s'il est dans la corbeille)
 *        oui         oui      non    première rencontre : même fiche, rien à faire ; sinon comme changé des deux côtés
 *        oui         oui      oui    suivi : changé d'un seul côté, recopié de l'autre ; des deux côtés, le plus grand
 *                                    `updatedAt` gagne (l'ordinateur à égalité), l'autre version à la corbeille
 *        oui         non      oui    supprimé sur le téléphone : la copie de l'ordinateur va à sa corbeille, sauf si
 *                                    l'ordinateur l'a changé depuis : il revient sur le téléphone
 *        non         oui      oui    supprimé sur l'ordinateur : retiré du téléphone, sauf s'il y a été changé depuis
 *        non         non      oui    supprimé des deux côtés : la base l'oublie
 *
 * Rien ne se supprime sans ligne dans la base. Un itinéraire n'est retiré du téléphone qu'une fois sa fiche tenue, au
 * contenu près, par la corbeille de l'ordinateur ; sinon sa copie y est rangée d'abord. Et il n'y est jamais effacé :
 * il est déposé dans la corbeille de la mémoire du téléphone (`phoneDepositPaths`). Un itinéraire revenu d'une
 * corbeille d'un côté (neuf de ce côté, et dans `removedRoutes`) est recopié de l'autre sans question. Une fiche d'une
 * version plus récente de l'application n'est jamais écrasée.
 *
 * Une suppression que l'utilisateur a refusée (`RouteSyncInput.keep`) ne se fait pas : l'itinéraire est traité comme
 * neuf du côté qui l'a encore, donc recopié de l'autre, et sa ligne reposée ; il n'est pas non plus retenu sur le
 * téléphone à cause de la corbeille. `keep` n'a d'effet que dans ces cas.
 */

/** Préfixe de l'identité d'un itinéraire sans date de création : la base de ses noms, en minuscules. */
export const ROUTE_NAME_ID_PREFIX = 'nom:';

/**
 * Identité d'un itinéraire : sa date de création (`RouteRecord.createdAt`), telle qu'écrite ; si elle manque, ou
 * vaut l'époque (fiche relue sans date), la base de ses noms de fichiers, en minuscules, préfixée.
 */
export const syncRouteId = (createdAt: string | null | undefined, base: string): string =>
  typeof createdAt === 'string' && createdAt.trim() !== '' && Date.parse(createdAt) !== 0
    ? createdAt
    : `${ROUTE_NAME_ID_PREFIX}${base.toLowerCase()}`;

/** Un itinéraire d'un côté, tel que le listage le donne. */
export interface SyncRouteListed {
  /** Nom de ses fichiers, sans extension. */
  base: string;
  json: SyncStamp;
  gpx: SyncStamp | null;
}

/** Les fichiers de `itineraires/` d'un côté, rangés par itinéraire. */
export interface SyncRouteListing {
  routes: SyncRouteListed[];
  /** GPX sans fiche : reste d'une copie ou d'une suppression coupée, que l'application ignore. */
  orphans: SyncStamp[];
  /** Tous les noms du dossier, pour y choisir une base libre. */
  names: string[];
}

const stampOf = (entry: Pick<SyncListedEntry, 'name' | 'size' | 'mtimeMs'>): SyncStamp => ({ name: entry.name, size: entry.size, mtimeMs: entry.mtimeMs });

/**
 * Listage de `itineraires/` rangé par itinéraire : chaque fiche avec le GPX de même base (sans égard à la casse).
 * Seuls comptent les noms en `.json` et `.gpx` : les temporaires d'une écriture (`.tmp`, `.tracker-new`…) et tout
 * autre fichier sont écartés.
 */
export const syncRouteListing = (entries: readonly SyncListedEntry[]): SyncRouteListing => {
  const files = entries.filter((e) => e.kind === 'file');
  const gpxByName = new Map(files.filter((e) => /\.gpx$/i.test(e.name)).map((e) => [e.name.toLowerCase(), stampOf(e)]));
  const attached = new Set<string>();
  const routes = files.filter((e) => /\.json$/i.test(e.name)).map((e): SyncRouteListed => {
    const base = e.name.replace(/\.json$/i, '');
    const gpx = gpxByName.get(`${base}.gpx`.toLowerCase()) ?? null;
    if (gpx) attached.add(gpx.name);
    return { base, json: stampOf(e), gpx };
  });
  const orphans = [...gpxByName.values()].filter((g) => !attached.has(g.name));
  return { routes, orphans, names: entries.map((e) => e.name) };
};

/** Ligne de la base dont la fiche de ce côté porte ce nom. */
const lineOfJson = (base: SyncBase | null, side: SyncSideName, name: string): SyncBaseRoute | null =>
  base?.routes.find((r) => r[side].json.name === name) ?? null;

/**
 * Noms des fiches à lire d'un côté : celles que la base ne connaît pas, et celles dont la taille ou la date a changé
 * depuis (une date nulle ne prouve rien : la fiche est lue). `alsoRead` : identités dont la fiche est lue quand
 * même, celles que la corbeille de l'ordinateur tient, pour comparer leur contenu avant de retirer quoi que ce soit
 * du téléphone. `base` est celle de la paire (`SyncPair.base`).
 */
export const routeRecordsToRead = (
  listing: SyncRouteListing, base: SyncBase | null, side: SyncSideName, alsoRead: ReadonlySet<string> = new Set(),
): string[] =>
  listing.routes.flatMap((r) => {
    const line = lineOfJson(base, side, r.json.name);
    return line && sameStamp(line[side].json, r.json) && !alsoRead.has(line.id) ? [] : [r.json.name];
  });

/** Un itinéraire d'un côté, avec ce qu'on a lu de lui. */
export interface SyncRouteSideRoute extends SyncRouteListed {
  /** Texte de sa fiche ; `null` : lecture impossible ; absent : pas lue, son tampon étant celui de la base. */
  text?: string | null;
}

export interface SyncRouteSide {
  routes: SyncRouteSideRoute[];
  orphans: SyncStamp[];
  names: string[];
}

/** Un côté prêt pour le plan : son listage, et le texte des fiches lues, par nom de fiche. */
export const syncRouteSide = (listing: SyncRouteListing, texts: ReadonlyMap<string, string | null>): SyncRouteSide => ({
  ...listing,
  routes: listing.routes.map((r) => (texts.has(r.json.name) ? { ...r, text: texts.get(r.json.name) ?? null } : r)),
});

/** Un itinéraire que tient la corbeille de l'ordinateur : son identité, et le texte de sa fiche (`null` : illisible). */
export interface SyncTrashedRoute {
  id: string;
  text: string | null;
}

export interface RouteSyncInput {
  /** La base de la paire (`SyncPair.base`) : `null` à une première rencontre. */
  base: SyncBase | null;
  computer: SyncRouteSide;
  phone: SyncRouteSide;
  trash: readonly SyncTrashedRoute[];
  /** Par défaut `SYNC_HELD_ON_PHONE`, le même choix que pour les sessions. */
  heldOnPhone?: SyncHeldChoice;
  /**
   * Identités que l'utilisateur a dit garder, comme `SyncInput.keep` pour les sessions : un itinéraire suivi qui
   * manque d'un côté est recopié là où il manque au lieu d'être supprimé de l'autre, et un itinéraire du téléphone que
   * la corbeille ferait retenir est recopié sur l'ordinateur. Sans effet hors de ces cas.
   */
  keep?: readonly string[];
  /** Seuils du garde-fou ; par défaut `SYNC_GUARD_LIMITS`, ceux des sessions. */
  guardLimits?: SyncGuardLimits;
}

/**
 * Une opération. Les tampons qu'elle porte sont ceux du listage : l'exécutant les compare à l'état du moment (`stat`,
 * listage relu) et renonce si un fichier a changé depuis.
 */
export type RouteSyncOp =
  /**
   * Itinéraire recopié à l'octet, GPX puis fiche, sous `base` de l'autre côté. `replaces` : les fichiers qu'il
   * remplace là, tels que listés (`null` : rien ne doit y être ; un GPX seul, reste d'une copie coupée de ce même
   * itinéraire, est repris). Source sans GPX : seule la fiche est écrite.
   */
  | { kind: 'copy'; to: SyncSideName; source: SyncRouteListed; base: string; replaces: { json: SyncStamp | null; gpx: SyncStamp | null } }
  /**
   * Itinéraire de l'ordinateur mis à sa corbeille (origine `ordinateur`), fiche puis GPX : supprimé sur le téléphone.
   * `absent` : la fiche qui ne doit plus être sur le téléphone ; si elle y tient encore cet itinéraire (listage en
   * retard), ou ne se lit pas, ne rien faire. Un autre itinéraire rangé depuis sous ce nom n'empêche rien.
   */
  | { kind: 'trash'; files: SyncRouteListed; absent: string | null }
  /**
   * Itinéraire retiré du téléphone : supprimé sur l'ordinateur. Jamais effacé : déposé dans la corbeille du téléphone,
   * dans un sous-dossier neuf nommé d'après l'identité `moveTo` (la base de ses fichiers sur le téléphone,
   * `trashDirName`), GPX puis fiche. `keep` : sa copie doit d'abord être rangée dans la corbeille de
   * l'ordinateur (origine `telephone`), qui ne tient pas la même fiche. `absent` : la fiche qui ne doit plus être sur
   * l'ordinateur, même vérification.
   */
  | { kind: 'removeFromPhone'; files: SyncRouteListed; absent: string | null; keep: boolean; moveTo: string }
  /**
   * Version perdante d'un itinéraire changé des deux côtés, copiée dans la corbeille de l'ordinateur (origine de son
   * côté) sans être retirée : la copie qui suit l'écrase.
   */
  | { kind: 'loserToTrash'; side: SyncSideName; files: SyncRouteListed };

/** Ce que devient la ligne de base d'un itinéraire une fois toutes ses opérations faites. */
export type RouteSyncBaseStep =
  /** La ligne reste telle quelle (ou absente) : l'itinéraire sera repris la fois suivante. */
  | { kind: 'keep' }
  /** L'itinéraire n'est plus d'aucun côté : `withoutRouteLine`. */
  | { kind: 'forget' }
  /** Itinéraire du téléphone laissé où il est, dont la base doit se souvenir : `withRouteHeld`. */
  | { kind: 'hold' }
  /** Même fiche des deux côtés, sous ces bases : l'exécutant relit leurs tampons et pose la ligne (`syncRouteLineOf`). */
  | { kind: 'set'; computer: SyncRouteTarget; phone: SyncRouteTarget };

export interface SyncRouteTarget {
  base: string;
  updatedAt: string;
}

/** Pourquoi un itinéraire, ou un fichier, est laissé tel quel. */
export type RouteSyncLeftReason =
  /** Il faudrait écraser une fiche d'une version plus récente de l'application. */
  | 'newer'
  /** Fiche illisible : jamais recopiée, écrasée ni supprimée. */
  | 'unreadable'
  /** Seconde fiche du même itinéraire d'un même côté : elle ne voyage pas. */
  | 'duplicate'
  /** Sur le téléphone, et dans la corbeille de l'ordinateur sans que la synchronisation y soit pour rien. */
  | 'inTrash'
  /** Une de ses opérations est hors de ce que l'appelant a permis (`restrictRouteSyncPlan`). */
  | 'outOfScope';

export interface RouteSyncItem {
  id: string;
  /** Date de création, pour l'entrée de la corbeille ; `null` pour une identité tirée du nom. */
  createdAt: string | null;
  case: SyncCase;
  /** Base de ses fichiers de chaque côté, pour le compte rendu. */
  files: Record<SyncSideName, string | null>;
  ops: RouteSyncOp[];
  base: RouteSyncBaseStep;
  left: RouteSyncLeftReason | null;
  /** Changé des deux côtés : la version la plus récente gagne, l'autre est dans la corbeille. */
  conflict: boolean;
  /** Changé d'un côté, supprimé de l'autre : la modification revient. */
  revived: boolean;
  /**
   * Revenu d'une corbeille : neuf d'un côté (restauré sur l'ordinateur ou sur le téléphone) alors que la
   * synchronisation avait mené sa suppression au bout (`removedRoutes`), ou retrouvé des deux côtés sans ligne alors
   * que le téléphone le tenait pendant qu'il était à la corbeille (`heldRoutes`). Absent : faux.
   */
  restored?: boolean;
}

export interface RouteSyncPlan {
  /** Une entrée par itinéraire qui demande quelque chose, par identité. */
  items: RouteSyncItem[];
  /** Fiches laissées sans être rattachées à un itinéraire : doublons, et fiches illisibles inconnues de la base. */
  aside: { side: SyncSideName; base: string; reason: RouteSyncLeftReason }[];
  guard: SyncGuard;
}

type SeenState = 'ok' | 'future' | 'unreadable';

/** Un itinéraire d'un côté, sa fiche interprétée. */
interface Seen {
  files: SyncRouteListed;
  id: string | null;
  state: SeenState;
  updatedAt: string | null;
  /** Texte de la fiche, s'il a été lu. */
  text: string | null;
  read: boolean;
  /** Ligne de la base qui nomme cette fiche de ce côté. */
  line: SyncBaseRoute | null;
}

const listedOf = (r: SyncRouteListed): SyncRouteListed => ({ base: r.base, json: r.json, gpx: r.gpx });

const interpret = (r: SyncRouteSideRoute, side: SyncSideName, base: SyncBase | null): Seen => {
  const line = lineOfJson(base, side, r.json.name);
  const files = listedOf(r);
  if (r.text === undefined) {
    // Pas relue : son tampon est celui de la base, qui en sait l'identité et la date.
    return line
      ? { files, id: line.id, state: 'ok', updatedAt: line[side].updatedAt, text: null, read: false, line }
      : { files, id: null, state: 'unreadable', updatedAt: null, text: null, read: false, line };
  }
  const record = r.text === null ? null : parseRouteRecord(r.text);
  if (!record) return { files, id: line?.id ?? null, state: 'unreadable', updatedAt: null, text: null, read: true, line };
  return {
    files, id: syncRouteId(record.createdAt, r.base), state: isWritableRouteRecord(record) ? 'ok' : 'future',
    updatedAt: record.updatedAt, text: r.text, read: true, line,
  };
};

const dateOf = (iso: string | null): number => {
  const ms = iso === null ? Number.NaN : Date.parse(iso);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
};

/** Celle des fiches d'un même itinéraire qui compte : celle que la base nomme, puis une lisible, la plus récente, puis par nom. */
const chosenCopy = (id: string, copies: readonly Seen[]): Seen => [...copies].sort((a, b) => {
  const named = Number(b.line?.id === id) - Number(a.line?.id === id);
  if (named !== 0) return named;
  const readable = Number(b.state !== 'unreadable') - Number(a.state !== 'unreadable');
  if (readable !== 0) return readable;
  const [da, db] = [dateOf(a.updatedAt), dateOf(b.updatedAt)];
  if (da !== db) return db > da ? 1 : -1;
  return a.files.base < b.files.base ? -1 : a.files.base > b.files.base ? 1 : 0;
})[0];

interface SideRoutes {
  kept: Map<string, Seen>;
  copies: Map<string, Seen[]>;
  duplicates: Seen[];
}

const oneByIdentity = (seen: readonly Seen[]): SideRoutes => {
  const copies = new Map<string, Seen[]>();
  for (const s of seen) if (s.id !== null) copies.set(s.id, [...(copies.get(s.id) ?? []), s]);
  const kept = new Map<string, Seen>();
  const duplicates: Seen[] = [];
  for (const [id, group] of copies) {
    const chosen = chosenCopy(id, group);
    kept.set(id, chosen);
    duplicates.push(...group.filter((s) => s !== chosen));
  }
  return { kept, copies, duplicates };
};

/** Vrai si ce côté a changé l'itinéraire depuis la ligne : fiche relue d'une autre date de rangement ou d'une autre taille. */
const changedSince = (s: Seen, side: SyncSideName, line: SyncBaseRoute): boolean =>
  s.read && (s.updatedAt !== line[side].updatedAt || s.files.json.size !== line[side].json.size);

/** Vrai si les fichiers d'un côté sont ceux de la ligne : même fiche au tampon près, même GPX au nom et à la taille près. */
const sameAsLine = (s: Seen, side: SyncSideName, line: SyncBaseRoute): boolean => {
  const { json, gpx } = line[side];
  const now = s.files;
  return now.json.name === json.name && now.json.size === json.size && now.json.mtimeMs === json.mtimeMs
    && (gpx === null ? now.gpx === null : now.gpx !== null && now.gpx.name === gpx.name && now.gpx.size === gpx.size);
};

/** Valeur JSON aux clés triées, pour comparer deux fiches sans égard à l'ordre de leurs champs. */
const canonical = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(canonical)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]))
      : value;

/** Le lieu d'une fiche d'itinéraire (`place`), `undefined` s'il n'y en a pas ou si elle ne se lit pas. */
const placeOf = (text: string): unknown => {
  try {
    const record: unknown = JSON.parse(text);
    return record !== null && typeof record === 'object' ? (record as Record<string, unknown>).place ?? undefined : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Vrai si deux fiches d'itinéraire ne diffèrent que par leur lieu (`place`, trouvé en fond après le rangement et écrit
 * sans changer `updatedAt`, lot 236) : deux appareils qui l'ont trouvé chacun de leur côté n'ont rien changé l'un
 * contre l'autre.
 */
export const routesDifferOnlyByPlace = (a: string, b: string): boolean => {
  try {
    const [ra, rb]: unknown[] = [JSON.parse(a), JSON.parse(b)];
    if (ra === null || rb === null || typeof ra !== 'object' || typeof rb !== 'object') return false;
    const { place: _pa, ...restA } = ra as Record<string, unknown>;
    const { place: _pb, ...restB } = rb as Record<string, unknown>;
    return JSON.stringify(canonical(restA)) === JSON.stringify(canonical(restB));
  } catch {
    return false;
  }
};

/** Vrai si cet itinéraire part d'un appareil : mis à la corbeille de l'ordinateur, ou retiré du téléphone. */
export const isRouteDeletion = (item: RouteSyncItem): boolean => item.ops.some((op) => op.kind === 'trash' || op.kind === 'removeFromPhone');

/** Le garde-fou de toute une synchronisation : sessions et itinéraires comptés ensemble. */
export interface SyncWholeGuard {
  /** Vrai : trop de retraits pour les faire sans demander. */
  tripped: boolean;
  /** Retraits de l'ordinateur (à sa corbeille) et du téléphone, sessions et itinéraires additionnés. */
  toTrash: number;
  fromPhone: number;
  sessions: SyncGuard;
  routes: SyncGuard | null;
}

/**
 * Garde-fou de la synchronisation entière, d'après celui des sessions et celui des itinéraires (`null` : pas
 * synchronisés) : déclenché si l'un l'est (la part de chaque sorte est jugée sur ses propres nombres, ainsi un
 * listage d'itinéraires vide d'un côté le déclenche à lui seul), ou si sessions et itinéraires ensemble dépassent
 * le nombre de retraits permis (`maxRemovals` des sessions).
 */
export const syncWholeGuard = (sessions: SyncGuard, routes: SyncGuard | null): SyncWholeGuard => {
  const toTrash = sessions.toTrash + (routes?.toTrash ?? 0);
  const fromPhone = sessions.fromPhone + (routes?.fromPhone ?? 0);
  const tripped = sessions.tripped || routes?.tripped === true || toTrash + fromPhone > sessions.limits.maxRemovals;
  return { tripped, toTrash, fromPhone, sessions, routes };
};

/** Suppressions comptées : itinéraires de l'ordinateur à mettre à la corbeille, et itinéraires à retirer du téléphone. */
export const routeGuardOf = (items: readonly RouteSyncItem[], count: Record<SyncSideName, number>, limits: SyncGuardLimits = SYNC_GUARD_LIMITS): SyncGuard =>
  syncGuardOf(
    items.filter((i) => i.ops.some((op) => op.kind === 'trash')).length, items.filter((i) => i.ops.some((op) => op.kind === 'removeFromPhone')).length,
    count, limits,
  );

/** Le plan entier, sans restriction : à passer par `restrictRouteSyncPlan` quand tout n'est pas permis. */
export const planRouteSync = (input: RouteSyncInput): RouteSyncPlan => {
  const { base, trash } = input;
  const seen = {
    computer: input.computer.routes.map((r) => interpret(r, 'computer', base)),
    phone: input.phone.routes.map((r) => interpret(r, 'phone', base)),
  };
  const computer = oneByIdentity(seen.computer);
  const phone = oneByIdentity(seen.phone);
  const taken: Record<SyncSideName, string[]> = { computer: [...input.computer.names], phone: [...input.phone.names] };
  const refused = new Set(input.keep ?? []);

  const itemOf = (id: string, kind: SyncCase, o: Seen | null, t: Seen | null): RouteSyncItem => ({
    id, createdAt: id.startsWith(ROUTE_NAME_ID_PREFIX) ? null : id, case: kind,
    files: { computer: o?.files.base ?? null, phone: t?.files.base ?? null },
    ops: [], base: { kind: 'keep' }, left: null, conflict: false, revived: false,
    restored: ((kind === 'newOnComputer' || kind === 'newOnPhone') && base?.removedRoutes.includes(id) === true)
      || (kind === 'firstMeeting' && base?.heldRoutes.includes(id) === true),
  });

  /**
   * Base d'arrivée d'une copie de l'autre côté, libre (`routeFileBase`), et ce qu'elle remplace : un GPX seul de
   * même base et de même taille, reste d'une copie coupée de ce même itinéraire, est repris au lieu d'en prendre une
   * autre à côté.
   */
  const arrivalOf = (s: Seen, to: SyncSideName): { base: string; replaces: { json: SyncStamp | null; gpx: SyncStamp | null } } => {
    const own = s.files.gpx === null ? null
      : input[to].orphans.find((f) => f.name.toLowerCase() === `${s.files.base}.gpx`.toLowerCase() && f.size === s.files.gpx?.size) ?? null;
    const free = routeFileBase(s.files.base, own ? taken[to].filter((name) => name.toLowerCase() !== own.name.toLowerCase()) : taken[to]);
    taken[to].push(`${free}.json`, `${free}.gpx`);
    return { base: free, replaces: { json: null, gpx: own && free.toLowerCase() === s.files.base.toLowerCase() ? own : null } };
  };

  /** Copie vers l'autre côté sous une base libre ; la ligne posée nomme les deux bases. */
  const copyAcross = (item: RouteSyncItem, from: SyncSideName, s: Seen): RouteSyncItem => {
    const to = otherSyncSide(from);
    const arrival = arrivalOf(s, to);
    const updatedAt = s.updatedAt as string;
    const targets = { [from]: { base: s.files.base, updatedAt }, [to]: { base: arrival.base, updatedAt } } as Record<SyncSideName, SyncRouteTarget>;
    return {
      ...item,
      files: { ...item.files, [to]: arrival.base },
      ops: [{ kind: 'copy', to, source: s.files, base: arrival.base, replaces: arrival.replaces }],
      base: { kind: 'set', computer: targets.computer, phone: targets.phone },
    };
  };

  /** Faux seulement si la corbeille de l'ordinateur tient déjà cette fiche, au contenu près. */
  const keepOf = (id: string, copy: Seen): boolean =>
    copy.text === null || !trash.some((entry) => entry.id === id && entry.text === copy.text);

  /**
   * Fiches d'un côté que vise une suppression : celle que la ligne suit (même nom de fiche), jamais une autre fiche
   * de même identité, qui peut être un autre itinéraire (GPX exporté puis réimporté, qui garde la date de création) ;
   * sans ligne, la seule fiche retenue pour cette identité. Les autres restent, laissées comme doublons.
   */
  const followedCopies = (side: SyncSideName, id: string, line: SyncBaseRoute | null): Seen[] => {
    const routes = side === 'computer' ? computer : phone;
    if (!line) return routes.kept.has(id) ? [routes.kept.get(id) as Seen] : [];
    return (routes.copies.get(id) ?? []).filter((copy) => copy.files.json.name === line[side].json.name);
  };

  /** Supprimé sur l'ordinateur : la fiche du téléphone que la ligne suit en est retirée. */
  const removedFromPhone = (id: string, line: SyncBaseRoute | null): RouteSyncItem => ({
    ...itemOf(id, 'deletedOnComputer', null, phone.kept.get(id) ?? null),
    ops: followedCopies('phone', id, line).map((copy): RouteSyncOp =>
      ({ kind: 'removeFromPhone', files: copy.files, absent: line?.computer.json.name ?? null, keep: keepOf(id, copy), moveTo: copy.files.base })),
    base: { kind: 'forget' },
  });

  /** D'un seul côté, inconnu de la base, ou suivi mais que l'utilisateur a dit garder (`keep`) : recopié de l'autre côté. */
  const fresh = (id: string, from: SyncSideName, s: Seen): RouteSyncItem => {
    const item = from === 'computer' ? itemOf(id, 'newOnComputer', s, null) : itemOf(id, 'newOnPhone', null, s);
    // Supprimé sur l'ordinateur sans que la synchronisation l'ait su : il ne revient de lui-même que si elle avait
    // mené sa suppression au bout et qu'il a été remis depuis sur le téléphone. Gardé par l'utilisateur, il revient.
    const inTrash = trash.some((entry) => entry.id === id);
    const heldBack = from === 'phone' && !refused.has(id) && (base?.heldRoutes.includes(id) || (inTrash && !base?.removedRoutes.includes(id)));
    if (heldBack) {
      // Première rencontre (pas de base) : rien ne se retire, quel que soit le choix.
      const remove = base !== null && (input.heldOnPhone ?? SYNC_HELD_ON_PHONE) === 'remove';
      return remove ? removedFromPhone(id, null) : { ...item, left: 'inTrash', base: { kind: 'hold' } };
    }
    if (s.state === 'unreadable') return { ...item, left: 'unreadable' };
    return copyAcross(item, from, s);
  };

  /** Des deux côtés : rien si c'est la même fiche, sinon la version changée, ou la plus récente, remplace l'autre. */
  const both = (id: string, o: Seen, t: Seen, line: SyncBaseRoute | null): RouteSyncItem | null => {
    const item = itemOf(id, line ? 'followed' : 'firstMeeting', o, t);
    if (o.state === 'unreadable' || t.state === 'unreadable') return { ...item, left: 'unreadable' };
    const sides = { computer: o, phone: t };
    const changed = { computer: line ? changedSince(o, 'computer', line) : true, phone: line ? changedSince(t, 'phone', line) : true };
    const same = !changed.computer && !changed.phone ? true : changed.computer && changed.phone && o.text !== null && o.text === t.text;
    if (same) {
      if (line && sameAsLine(o, 'computer', line) && sameAsLine(t, 'phone', line)) return null;
      // Mêmes fiches, autres tampons (fiche relue sans changement, GPX refait) : la ligne est reposée.
      return { ...item, base: { kind: 'set', computer: { base: o.files.base, updatedAt: o.updatedAt as string }, phone: { base: t.files.base, updatedAt: t.updatedAt as string } } };
    }
    // Changées des deux côtés, mais seulement par le lieu, trouvé de chaque côté : ni conflit ni copie à la corbeille ;
    // le lieu de l'ordinateur est gardé (celui du téléphone s'il n'y en a qu'un), et il passe à l'autre fiche.
    const onlyPlace = changed.computer && changed.phone && o.text !== null && t.text !== null && routesDifferOnlyByPlace(o.text, t.text);
    const conflict = changed.computer && changed.phone && !onlyPlace;
    const from: SyncSideName = onlyPlace ? (placeOf(o.text as string) === undefined && placeOf(t.text as string) !== undefined ? 'phone' : 'computer')
      : conflict ? (dateOf(o.updatedAt) >= dateOf(t.updatedAt) ? 'computer' : 'phone') : changed.computer ? 'computer' : 'phone';
    const to = otherSyncSide(from);
    const source = sides[from];
    const target = sides[to];
    if (target.state === 'future') return { ...item, left: 'newer', conflict };
    const updatedAt = source.updatedAt as string;
    const ops: RouteSyncOp[] = [
      ...(conflict ? [{ kind: 'loserToTrash', side: to, files: target.files } as const] : []),
      { kind: 'copy', to, source: source.files, base: target.files.base, replaces: { json: target.files.json, gpx: target.files.gpx } },
    ];
    return {
      ...item, ops, conflict,
      base: { kind: 'set', computer: { base: o.files.base, updatedAt }, phone: { base: t.files.base, updatedAt } },
    };
  };

  /** Présent d'un seul côté, et suivi : supprimé de l'autre côté, sauf s'il a été changé ici depuis. */
  const deletedOn = (id: string, gone: SyncSideName, s: Seen, line: SyncBaseRoute): RouteSyncItem => {
    const here = otherSyncSide(gone);
    const kind: SyncCase = gone === 'phone' ? 'deletedOnPhone' : 'deletedOnComputer';
    const item = here === 'computer' ? itemOf(id, kind, s, null) : itemOf(id, kind, null, s);
    if (s.state === 'unreadable') return { ...item, left: 'unreadable' };
    if (changedSince(s, here, line)) return { ...copyAcross(item, here, s), revived: true };
    // Suppression refusée : il retourne là où il manque, au lieu de partir de là où il est encore.
    if (refused.has(id)) return fresh(id, here, s);
    if (gone === 'computer') return removedFromPhone(id, line);
    return {
      ...item,
      ops: followedCopies('computer', id, line).map((copy): RouteSyncOp => ({ kind: 'trash', files: copy.files, absent: line.phone.json.name })),
      base: { kind: 'forget' },
    };
  };

  const identities = new Set([...computer.kept.keys(), ...phone.kept.keys(), ...(base?.routes.map((r) => r.id) ?? []), ...(base?.heldRoutes ?? [])]);
  const items: RouteSyncItem[] = [];
  const unfollowed: RouteSyncPlan['aside'] = [];
  for (const id of [...identities].sort()) {
    const line = syncRouteBaseLine(base, id);
    // Suivi, un itinéraire n'est présent d'un côté que par la fiche que la ligne nomme : une autre fiche de même
    // identité est un autre itinéraire, laissé comme doublon, jamais recopié par-dessus ni supprimé à sa place.
    const presentOn = (side: SyncSideName): Seen | null => {
      const kept = (side === 'computer' ? computer : phone).kept.get(id) ?? null;
      if (!line || !kept) return kept;
      const followed = followedCopies(side, id, line)[0] ?? null;
      if (!followed) unfollowed.push({ side, base: kept.files.base, reason: 'duplicate' });
      return followed;
    };
    const o = presentOn('computer');
    const t = presentOn('phone');
    const item = o && t ? both(id, o, t, line)
      : !line ? (o ? fresh(id, 'computer', o) : t ? fresh(id, 'phone', t) : { ...itemOf(id, 'deletedOnBoth', null, null), base: { kind: 'forget' } as const })
        : o ? deletedOn(id, 'phone', o, line)
          : t ? deletedOn(id, 'computer', t, line)
            : { ...itemOf(id, 'deletedOnBoth', null, null), base: { kind: 'forget' } as const };
    if (item) items.push(item);
  }

  const aside = SYNC_SIDES.flatMap((side) => [
    ...unfollowed.filter((a) => a.side === side),
    ...(side === 'computer' ? computer : phone).duplicates.map((s) => ({ side, base: s.files.base, reason: 'duplicate' as const })),
    ...seen[side].filter((s) => s.id === null).map((s) => ({ side, base: s.files.base, reason: 'unreadable' as const })),
  ]);
  return { items, aside, guard: routeGuardOf(items, { computer: computer.kept.size, phone: phone.kept.size }, input.guardLimits ?? SYNC_GUARD_LIMITS) };
};

const opAllowed = (op: RouteSyncOp, scope: SyncScope): boolean => {
  switch (op.kind) {
    case 'copy':
      return scope[op.to];
    case 'trash':
      return scope.deletions && scope.computer;
    case 'removeFromPhone':
      return scope.deletions && scope.phone && (!op.keep || scope.computer);
    case 'loserToTrash':
      return scope.computer && scope[op.side];
  }
};

/**
 * Le plan réduit à ce que `scope` permet, comme `restrictSyncPlan` : un itinéraire dont une opération est retirée
 * garde sa ligne telle quelle (`keep`) et sera repris. Une version perdante n'est jamais écrasée sans avoir été
 * rangée : si l'une des deux opérations d'un conflit est retirée, les deux le sont.
 */
export const restrictRouteSyncPlan = (plan: RouteSyncPlan, scope: SyncScope): RouteSyncPlan => {
  const items = plan.items.map((item): RouteSyncItem => {
    const allowed = item.ops.filter((op) => opAllowed(op, scope));
    const ops = item.conflict && allowed.length < item.ops.length ? [] : allowed;
    const cut = ops.length < item.ops.length;
    return { ...item, ops, base: cut ? { kind: 'keep' } : item.base, left: item.left ?? (cut ? 'outOfScope' : null) };
  });
  return { ...plan, items, guard: routeGuardOf(items, plan.guard.count, plan.guard.limits) };
};

/**
 * Ligne de base d'une étape `set`, d'après les tampons relus de chaque côté (`stat` de `<base>.json` et
 * `<base>.gpx`, `null` : absent) ; `null` si une fiche manque : la ligne n'est alors pas posée.
 */
export const syncRouteLineOf = (
  id: string,
  step: Extract<RouteSyncBaseStep, { kind: 'set' }>,
  stamps: Record<SyncSideName, { json: SyncStamp | null; gpx: SyncStamp | null }>,
): SyncBaseRoute | null => {
  const { computer, phone } = stamps;
  if (!computer.json || !phone.json) return null;
  return {
    id,
    computer: { json: computer.json, gpx: computer.gpx, updatedAt: step.computer.updatedAt },
    phone: { json: phone.json, gpx: phone.gpx, updatedAt: step.phone.updatedAt },
  };
};
