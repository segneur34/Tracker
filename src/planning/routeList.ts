import { activityFamily, type Activity } from '../core/activities';
import type { SportFamily } from '../core/sportProfiles';
import { estimateDurationFromProfile, type DurationSettings } from './duration';
import { routePoints, routeProfileRows, routeTotals, type PlannedRoute } from './route';
import { recordToRoute, type RouteRecord } from './routeRecord';
import { routeActivity, shownRoutes, type WithActivity } from './routeShown';

/**
 * Listes d'itinéraires rangés (point 68) : distance, tri, et vue depuis une
 * famille (vue « Planifiées » de la bibliothèque Voile ou Course). Un
 * itinéraire sans activité, ou d'une activité supprimée qui n'est pas un
 * calcul, n'appartient à aucune famille : il reste sur l'accueil et dans les
 * pages Itinéraires.
 */

// Écrits dans `routeShown.ts` (sans dépendance, pour l'accueil) ; repris ici pour les importeurs d'avant.
export { routeActivity, shownRoutes };

export const routesOfFamily = <T extends WithActivity>(routes: T[], activities: Activity[], family: SportFamily): T[] =>
  routes.filter((r) => {
    const activity = routeActivity(r, activities);
    return activity !== null && activityFamily(activity) === family;
  });

/**
 * Distance et temps déjà calculés pour une fiche : une fiche rangée ne change
 * pas tant que la liste n'est pas relue (une fiche relue est un autre objet).
 * Trier, changer d'onglet ou rouvrir une liste ne refait donc rien. Le temps
 * est gardé par réglage (niveau, poids, seuil de dénivelé).
 */
interface RecordFigures {
  distanceM?: number;
  durations: Map<string, number | null>;
}

const figures = new WeakMap<RouteRecord, RecordFigures>();

const figuresOf = (record: RouteRecord): RecordFigures => {
  let known = figures.get(record);
  if (!known) {
    known = { durations: new Map() };
    figures.set(record, known);
  }
  return known;
};

/** Distance d'un itinéraire rangé, en mètres ; elle ne dépend pas du seuil de dénivelé, d'où 0. Calculée une fois par fiche. */
export const routeDistanceM = (record: RouteRecord): number => {
  const known = figuresOf(record);
  known.distanceM ??= routeTotals(recordToRoute(record), 0).distanceM;
  return known.distanceM;
};

/**
 * Temps estimé d'un itinéraire rangé, en secondes, ou `null` sans réglage
 * (voile) ; `minGainM` : seuil de dénivelé du terrain de son activité.
 * Calculé une fois par fiche et par réglage.
 */
export const routeDurationS = (record: RouteRecord, minGainM: number, settings: DurationSettings | null): number | null => {
  if (!settings) return null;
  const known = figuresOf(record);
  const key = `${minGainM}|${JSON.stringify(settings)}`;
  if (!known.durations.has(key)) known.durations.set(key, estimateRouteDurationS(recordToRoute(record), minGainM, settings));
  return known.durations.get(key) ?? null;
};

export type RouteSort = 'recent' | 'ancien' | 'nom' | 'distance-croissante' | 'distance-decroissante';

export const ROUTE_SORTS: { id: RouteSort; label: string }[] = [
  { id: 'recent', label: 'Plus récents' },
  { id: 'ancien', label: 'Plus anciens' },
  { id: 'nom', label: 'Nom (A → Z)' },
  { id: 'distance-croissante', label: 'Plus courts' },
  { id: 'distance-decroissante', label: 'Plus longs' },
];

export const isRouteSort = (value: unknown): value is RouteSort => ROUTE_SORTS.some((s) => s.id === value);

interface Sortable {
  base: string;
  record: { name: string; updatedAt: string };
}

/** Itinéraires dans l'ordre demandé, sans toucher à la liste reçue ; à égalité, l'ordre reçu. */
export const sortRoutes = <T extends Sortable>(routes: T[], sort: RouteSort, distanceOf: (route: T) => number): T[] => {
  const time = (r: T) => Date.parse(r.record.updatedAt) || 0;
  const compare: Record<RouteSort, (a: T, b: T) => number> = {
    recent: (a, b) => time(b) - time(a),
    ancien: (a, b) => time(a) - time(b),
    nom: (a, b) => a.record.name.localeCompare(b.record.name, 'fr', { sensitivity: 'base' }),
    'distance-croissante': (a, b) => distanceOf(a) - distanceOf(b),
    'distance-decroissante': (a, b) => distanceOf(b) - distanceOf(a),
  };
  return [...routes].sort(compare[sort]);
};

/**
 * Temps estimé d'un itinéraire, en secondes, ou `null` sans réglage (voile)
 * ou sans tracé. `minGainM` : écart qui confirme une montée, celui du terrain
 * de l'activité, pour que le D+ compté soit celui affiché (`routeTotals`).
 */
export const estimateRouteDurationS = (
  route: PlannedRoute,
  minGainM: number,
  settings: DurationSettings | null
): number | null => {
  if (!settings) return null;
  const points = routePoints(route);
  if (points.length < 2) return null;
  return estimateDurationFromProfile(routeTotals(route, minGainM), routeProfileRows(points), settings);
};
