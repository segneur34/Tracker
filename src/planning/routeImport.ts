import { parseGpx, parseGpxPath } from '../core/gpxParser';
import { routeFromTrack } from './route';
import { embeddedRouteRecord } from './routeGpx';
import { routeToRecord, type RouteRecord } from './routeRecord';

/**
 * Itinéraire reçu en GPX (lot 194) : partagé par un autre téléphone, reçu
 * d'une autre application (« Ouvrir avec », « Partager vers Tracker ») ou
 * choisi dans les fichiers depuis la page Itinéraires. Pur : la page et la
 * file des fichiers reçus rangent la fiche rendue (`hooks/routeFiles.ts`).
 */

/**
 * Vrai si le GPX est un itinéraire plutôt qu'une session : il porte la fiche
 * d'un itinéraire de Tracker, ou un tracé d'au moins deux points sans aucun
 * point daté (une `<rte>` seule, ou une trace sans heure, comme le GPX d'un
 * itinéraire de Tracker, de Komoot ou de Visorando). Une session a toujours
 * des points datés : elle reste une session. Un XML illisible n'est pas un
 * itinéraire : l'import des sessions dira pourquoi.
 */
export const isRouteGpx = (text: string): boolean => {
  if (embeddedRouteRecord(text)) return true;
  try {
    const timed = parseGpx(text);
    if (timed.rawPoints.length > 0 || timed.timedPoints.length > 0) return false;
    return parseGpxPath(text).points.length >= 2;
  } catch {
    return false;
  }
};

/**
 * Nom d'un itinéraire importé, sans doublon parmi `taken` (noms des
 * itinéraires déjà rangés) : `nom`, sinon `nom (2)`, `nom (3)`… La
 * comparaison ignore la casse et les espaces autour.
 */
export const uniqueRouteName = (name: string, taken: Iterable<string>): string => {
  const used = new Set([...taken].map((n) => n.trim().toLowerCase()));
  const base = name.trim() || 'Itinéraire';
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
};

export interface RouteImportOptions {
  /** Date ISO du rangement : création et dernier rangement d'un tracé sans fiche, dernier rangement d'une fiche reçue. */
  nowIso: string;
  /** Noms des itinéraires déjà rangés : le nom de l'importé ne les double pas. */
  takenNames: Iterable<string>;
  /** Activité devinée du type de la trace (`<trk><type>`), pour un GPX sans fiche ; `null` : aucune. */
  activityFor: (trackType: string | undefined) => string | null;
}

/**
 * Fiche d'un itinéraire tirée d'un GPX, `null` s'il n'en contient pas (moins
 * de deux points). Un GPX de Tracker rend sa fiche telle quelle (points de
 * passage ou balises, mode de chaque tronçon, activité, bips d'approche),
 * renommée si son nom est déjà pris. Un autre GPX devient une trace gardée
 * telle quelle (`routeFromTrack`), comme « Charger un GPX » de la
 * planification, nommée d'après le fichier s'il ne porte pas de nom.
 */
export const importedRouteRecord = (text: string, fileName: string, options: RouteImportOptions): RouteRecord | null => {
  const { nowIso, takenNames, activityFor } = options;
  const embedded = embeddedRouteRecord(text);
  if (embedded) return { ...embedded, name: uniqueRouteName(embedded.name, takenNames), updatedAt: nowIso };
  let parsed: ReturnType<typeof parseGpxPath>;
  try {
    parsed = parseGpxPath(text);
  } catch {
    return null;
  }
  const route = routeFromTrack(parsed.points);
  if (!route) return null;
  const name = uniqueRouteName(parsed.name ?? fileName.replace(/\.gpx$/i, ''), takenNames);
  return routeToRecord(route, { name, activityId: activityFor(parsed.trackType), createdAt: nowIso, updatedAt: nowIso });
};
