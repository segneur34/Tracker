import { activityFamily, findActivity } from '../core/activities';
import { usesMarkCourse } from '../core/sportProfiles';
import { plainError } from '../platform/errorText';
import { ROUTES_DIR, routePath } from '../library/folderLayout';
import { guessSport } from '../library/naming';
import type { PlannedRoute } from '../planning/route';
import type { MarkGuideSettings } from '../recording/markGuide';
import { buildRouteGpx, markLabel, waypointLabel } from '../planning/routeGpx';
import { importedRouteRecord } from '../planning/routeImport';
import {
  isWritableRouteRecord, parseRouteRecord, recordToRoute, routeFileBase, routeToRecord, serializeRouteRecord,
  type RouteRecord,
} from '../planning/routeRecord';
import { createLoadedListStore } from './loadedListStore';
import { currentMemoryFolder } from './useSessionLibrary';
import { readStoredActivities } from './useSportSettings';

/**
 * Itinéraires rangés dans `itineraires/` du dossier mémoire, à côté des
 * sessions : une fiche JSON qui fait foi et son GPX, réécrits ensemble. Le
 * nom de fichier est tiré du nom de l'itinéraire à son premier rangement et
 * ne change plus. Hors de React : la page (`useRouteLibrary`) et la file des
 * fichiers reçus (`sessionLibrary/incoming.ts`, lot 194, qui reçoit
 * `importRouteGpx` de `main.tsx`) y rangent l'une et l'autre.
 */

export interface SavedRoute {
  /** Nom des fichiers, sans extension : la clé de stockage. */
  base: string;
  record: RouteRecord;
  /** Fiche d'une version plus récente de l'application : lue, jamais réécrite. */
  readOnly: boolean;
}

/** Noms des points dans le GPX : numéros des balises (voile, surf), lettres ailleurs. */
const gpxLabel = (activityId: string | null): ((index: number) => string) => {
  const activity = findActivity(readStoredActivities(), activityId);
  return activity && usesMarkCourse(activityFamily(activity)) ? markLabel : waypointLabel;
};

const NO_FOLDER = 'Aucun dossier mémoire accessible : choisissez-le dans Réglages pour enregistrer vos itinéraires.';

const requireFolder = async () => {
  const folder = await currentMemoryFolder();
  if (!folder) throw new Error(NO_FOLDER);
  return folder;
};

/** Itinéraires du dossier, du plus récemment rangé au plus ancien. Une fiche illisible est ignorée. */
const listRoutes = async (): Promise<SavedRoute[]> => {
  const folder = await currentMemoryFolder();
  if (!folder) return [];
  const entries = await folder.list(ROUTES_DIR);
  const routes: SavedRoute[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'file' || !/\.json$/i.test(entry.name)) continue;
    const text = await folder.readText(routePath(entry.name));
    const record = text === null ? null : parseRouteRecord(text);
    if (record) routes.push({ base: entry.name.replace(/\.json$/i, ''), record, readOnly: !isWritableRouteRecord(record) });
  }
  return routes.sort((a, b) => (a.record.updatedAt < b.record.updatedAt ? 1 : a.record.updatedAt > b.record.updatedAt ? -1 : 0));
};

/** Itinéraires de la mémoire ouverte, lus une fois pour toutes les pages (lot 158) et relus après chaque rangement ou suppression. */
export const routeStore = createLoadedListStore(listRoutes, (err) => plainError(err, 'Lecture des itinéraires impossible.'));

/** GPX rangé d'une fiche, et partagé : le tracé pour les autres applications, la fiche en extension pour Tracker. */
const routeGpxOf = (route: PlannedRoute, record: RouteRecord): string =>
  buildRouteGpx(route, record.name, gpxLabel(record.activityId), record);

/** Écrit le GPX puis la fiche sous `base`, et fait relire la liste. */
const writeRoute = async (base: string, route: PlannedRoute, record: RouteRecord): Promise<SavedRoute> => {
  const folder = await requireFolder();
  await folder.writeText(routePath(`${base}.gpx`), routeGpxOf(route, record));
  await folder.writeText(routePath(`${base}.json`), serializeRouteRecord(record));
  routeStore.reload();
  return { base, record, readOnly: !isWritableRouteRecord(record) };
};

/**
 * Range un itinéraire : sous ses fichiers s'il en a (`existing`), sinon sous
 * un nouveau nom. Rend l'itinéraire rangé.
 */
export const saveRoute = async (
  route: PlannedRoute,
  meta: { name: string; activityId: string | null; markGuide?: MarkGuideSettings | null },
  existing?: SavedRoute
): Promise<SavedRoute> => {
  if (existing?.readOnly) throw new Error('Cet itinéraire vient d\'une version plus récente de l\'application : rangez-le sous un autre nom.');
  const folder = await requireFolder();
  const base = existing?.base ?? routeFileBase(meta.name, (await folder.list(ROUTES_DIR)).map((e) => e.name));
  const now = new Date().toISOString();
  const record = routeToRecord(
    route,
    { ...meta, createdAt: existing?.record.createdAt ?? now, updatedAt: now },
    existing?.record
  );
  return writeRoute(base, route, record);
};

export const removeRoute = async (saved: SavedRoute): Promise<void> => {
  const folder = await requireFolder();
  await folder.remove(routePath(`${saved.base}.json`));
  await folder.remove(routePath(`${saved.base}.gpx`));
  routeStore.reload();
};

/** Activité d'un GPX sans fiche, devinée du type de sa trace : la première de ce calcul. */
const activityFor = (trackType: string | undefined): string | null => {
  const sport = guessSport(trackType);
  return sport ? readStoredActivities().find((a) => a.base === sport)?.id ?? null : null;
};

/**
 * Range dans `itineraires/` l'itinéraire d'un GPX (`importedRouteRecord`),
 * sous un nom ni de fichier ni d'itinéraire déjà pris. Lève, message en
 * clair, sans mémoire ou si le GPX ne contient pas de tracé.
 */
export const importRouteGpx = async (text: string, fileName: string): Promise<SavedRoute> => {
  const folder = await requireFolder();
  const taken = await listRoutes();
  const record = importedRouteRecord(text, fileName, {
    nowIso: new Date().toISOString(),
    takenNames: taken.map((r) => r.record.name),
    activityFor,
  });
  if (!record) throw new Error(`${fileName} ne contient pas d'itinéraire : aucun point de trace ou de route.`);
  const base = routeFileBase(record.name, (await folder.list(ROUTES_DIR)).map((e) => e.name));
  if (!isWritableRouteRecord(record)) {
    // Fiche d'une version plus récente : rangée telle quelle, jamais réécrite (son GPX est celui reçu).
    await folder.writeText(routePath(`${base}.gpx`), text);
    await folder.writeText(routePath(`${base}.json`), serializeRouteRecord(record));
    routeStore.reload();
    return { base, record, readOnly: true };
  }
  return writeRoute(base, recordToRoute(record), record);
};

/**
 * Fichier partagé d'un itinéraire : le GPX tel que rangé (`routeGpxOf`), refait
 * de la fiche, qui fait foi (un itinéraire rangé avant le lot 194 gagne ainsi
 * sa fiche en extension) ; celui d'une version plus récente, relu tel quel.
 */
export const routeShareFile = async (saved: SavedRoute): Promise<{ fileName: string; text: string }> => {
  const fileName = `${saved.base}.gpx`;
  if (saved.readOnly) {
    const text = await (await requireFolder()).readText(routePath(fileName));
    if (text === null) throw new Error(`${fileName} est introuvable dans la mémoire.`);
    return { fileName, text };
  }
  return { fileName, text: routeGpxOf(recordToRoute(saved.record), saved.record) };
};
