import { haversineDistance } from '../core/kinematics';
import { segmentDistanceM } from '../core/sessionStats';
import type { TrackPoint } from '../core/types';
import { WAY_CATEGORY_HIGHWAYS } from './brouterProfile';
import type { RouteLeg, RoutePoint } from './route';

/**
 * Revêtement d'un itinéraire ou d'une session, en catégories à la Komoot
 * (Asphalte, Gravillon, Non pavé…), d'après les étiquettes OpenStreetMap des
 * voies suivies : celles que rend BRouter pour un tronçon calculé
 * (`brouter.ts`), ou celles des voies au plus près d'une trace enregistrée
 * (`overpass.ts`, `wayMatch.ts`).
 *
 * Seules les étiquettes qui décident du revêtement sont gardées
 * (`SURFACE_TAG_KEYS`), en texte `clé=valeur` séparé d'espaces, la forme de
 * BRouter : on peut ainsi changer le classement sans redemander les voies.
 */

/** Étiquettes OSM qui décident de la catégorie, dans l'ordre où elles sont écrites. */
export const SURFACE_TAG_KEYS = ['highway', 'surface', 'tracktype', 'sac_scale'] as const;

/**
 * Voies le long d'une suite de points, par morceaux. `runs[k] = [début, n°]` :
 * le morceau commence à `début` et va jusqu'au début du suivant ; `n°` est
 * l'indice de ses étiquettes dans `tags`, `-1` s'il ne suit aucune voie connue.
 * Le début est l'indice du point pour un tronçon d'itinéraire, le décalage en
 * millisecondes depuis le premier point pour une session.
 */
export interface SurfaceRuns {
  tags: string[];
  runs: [number, number][];
}

export type SurfaceCategory =
  | 'asphalte' | 'pierresPlates' | 'paves' | 'gravillon' | 'nonPave' | 'terre' | 'herbe' | 'sable' | 'alpin' | 'autre' | 'inconnu';

export const SURFACE_LABEL: Record<SurfaceCategory, string> = {
  asphalte: 'Asphalte',
  pierresPlates: 'Pierres plates',
  paves: 'Pavés',
  gravillon: 'Gravillon',
  nonPave: 'Non pavé',
  terre: 'Terre',
  herbe: 'Herbe',
  sable: 'Sable',
  alpin: 'Alpin',
  autre: 'Autre',
  inconnu: 'Inconnu',
};

/**
 * Valeurs de `surface`, sans leur précision après « : » (`concrete:plates`,
 * `paving_stones:30`). BRouter ramène certaines valeurs à une autre
 * (`bricks` → `paved`, `rocks` → `rock`) : les deux formes sont là.
 */
const SURFACE_VALUES: Record<string, SurfaceCategory> = {
  asphalt: 'asphalte', paved: 'asphalte', concrete: 'asphalte', cement: 'asphalte', chipseal: 'asphalte',
  paving_stones: 'pierresPlates',
  sett: 'paves', cobblestone: 'paves', unhewn_cobblestone: 'paves', bricks: 'paves', brick: 'paves',
  gravel: 'gravillon', fine_gravel: 'gravillon', pebblestone: 'gravillon', compacted: 'gravillon',
  unpaved: 'nonPave', unpaved_minor: 'nonPave',
  dirt: 'terre', earth: 'terre', ground: 'terre', mud: 'terre', soil: 'terre', clay: 'terre',
  grass: 'herbe', grass_paver: 'herbe', artificial_turf: 'herbe',
  sand: 'sable',
  rock: 'alpin', rocks: 'alpin', rocky: 'alpin', stone: 'alpin',
};

/** Difficulté de randonnée (`sac_scale`) au-delà de la simple randonnée : un sentier alpin. */
const ALPINE_SAC_SCALES = new Set([
  'mountain_hiking', 'demanding_mountain_hiking', 'alpine_hiking', 'demanding_alpine_hiking', 'difficult_alpine_hiking',
]);

/** `tracktype` : grade1 revêtu, grade2 empierré, grade3 à 5 de moins en moins tenu. */
const TRACKTYPE_VALUES: Record<string, SurfaceCategory> = {
  grade1: 'asphalte', grade2: 'gravillon', grade3: 'nonPave', grade4: 'nonPave', grade5: 'nonPave', 'grade3-5': 'nonPave',
};

/** Routes, petites et grandes : asphaltées quand rien ne dit le contraire, comme le veut l'usage d'OSM. */
const ROAD_HIGHWAYS = new Set([...WAY_CATEGORY_HIGHWAYS.route, ...WAY_CATEGORY_HIGHWAYS.grande]);

/** Étiquettes lues dans un texte `clé=valeur clé=valeur` (forme de BRouter). */
export const parseWayTags = (text: string): Record<string, string> => {
  const tags: Record<string, string> = {};
  for (const pair of text.split(' ')) {
    const at = pair.indexOf('=');
    if (at > 0) tags[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return tags;
};

/**
 * Étiquettes qui décident du revêtement, en texte `clé=valeur` séparé
 * d'espaces, dans l'ordre de `SURFACE_TAG_KEYS` ; les espaces d'une valeur
 * deviennent des soulignés. Vide si la voie n'en porte aucune.
 */
export const wayTagsText = (tags: Readonly<Record<string, string | undefined>>): string =>
  SURFACE_TAG_KEYS.flatMap((key) => {
    const value = tags[key]?.trim();
    return value ? [`${key}=${value.replace(/\s+/g, '_')}`] : [];
  }).join(' ');

/** Première valeur d'une liste OSM (`asphalt;gravel`), sans sa précision après « : ». */
const mainValue = (value: string | undefined): string | undefined => value?.split(';')[0].split(':')[0].trim().toLowerCase();

/**
 * Catégorie d'une voie, d'après ses étiquettes (`wayTagsText`) ; `null` : aucune
 * voie connue. Dans l'ordre : sentier alpin (`sac_scale`), revêtement déclaré
 * (une valeur inconnue donne « Autre »), état d'une piste (`tracktype`), route
 * sans précision comptée asphaltée ; sinon « Inconnu ».
 */
export const classifySurface = (tagsText: string | null): SurfaceCategory => {
  if (tagsText === null) return 'inconnu';
  const tags = parseWayTags(tagsText);
  const sac = mainValue(tags.sac_scale);
  if (sac !== undefined && ALPINE_SAC_SCALES.has(sac)) return 'alpin';
  const surface = mainValue(tags.surface);
  if (surface) return SURFACE_VALUES[surface] ?? 'autre';
  const tracktype = mainValue(tags.tracktype);
  if (tracktype && TRACKTYPE_VALUES[tracktype]) return TRACKTYPE_VALUES[tracktype];
  const highway = mainValue(tags.highway);
  return highway !== undefined && ROAD_HIGHWAYS.has(highway) ? 'asphalte' : 'inconnu';
};

/**
 * Morceaux tirés d'une suite de débuts croissants, chacun avec ses étiquettes
 * (`null` : aucune voie). Deux morceaux voisins aux mêmes étiquettes n'en font
 * qu'un ; les étiquettes ne sont écrites qu'une fois. Un début qui ne dépasse
 * pas le précédent (deux points au même instant) remplace ce dernier.
 */
export const buildSurfaceRuns = (entries: ReadonlyArray<{ start: number; tags: string | null }>): SurfaceRuns => {
  const tags: string[] = [];
  const runs: [number, number][] = [];
  for (const entry of entries) {
    let index = -1;
    if (entry.tags !== null) {
      index = tags.indexOf(entry.tags);
      if (index < 0) index = tags.push(entry.tags) - 1;
    }
    const last = runs[runs.length - 1];
    if (last && last[1] === index) continue;
    if (last && entry.start <= last[0]) {
      runs.pop();
      if (runs.length > 0 && runs[runs.length - 1][1] === index) continue;
      runs.push([last[0], index]);
      continue;
    }
    runs.push([entry.start, index]);
  }
  return { tags, runs };
};

/** Étiquettes du morceau qui couvre `position` ; `null` : aucune voie, ou avant le premier morceau. */
export const tagsAt = (surfaces: SurfaceRuns, position: number): string | null => {
  let index = -1;
  for (const [start, tag] of surfaces.runs) {
    if (start > position) break;
    index = tag;
  }
  return index >= 0 ? surfaces.tags[index] ?? null : null;
};

/**
 * Morceaux décalés de `shift` points, le premier gardé au début : un point
 * ajouté en tête prend la voie qui suit.
 */
export const shiftSurfaceRuns = (surfaces: SurfaceRuns, shift: number): SurfaceRuns => ({
  tags: surfaces.tags,
  runs: surfaces.runs.map(([start, tag], k) => [k === 0 ? start : start + shift, tag]),
});

const isIndex = (value: unknown, max: number, min = 0): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value < max;

/**
 * Morceaux relus d'une fiche, `null` s'ils sont mal formés : débuts entiers,
 * croissants, le premier à 0, sous `limit` ; étiquettes existantes.
 */
export const readSurfaceRuns = (raw: unknown, limit: number): SurfaceRuns | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const { tags, runs } = raw as Record<string, unknown>;
  if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string')) return null;
  if (!Array.isArray(runs) || runs.length === 0) return null;
  const out: [number, number][] = [];
  for (const run of runs) {
    if (!Array.isArray(run) || !isIndex(run[0], limit) || !isIndex(run[1], tags.length, -1)) return null;
    if (out.length === 0 ? run[0] !== 0 : run[0] <= out[out.length - 1][0]) return null;
    out.push([run[0], run[1]]);
  }
  return { tags: [...tags], runs: out };
};

/** Une longueur parcourue sur une catégorie. */
export interface SurfaceStretch {
  category: SurfaceCategory;
  distanceM: number;
}

/**
 * Longueurs le long des points d'un tronçon d'itinéraire : le segment
 * `i − 1 → i` prend la voie du point `i − 1`. Sans morceaux, tout est
 * « Inconnu ». Un itinéraire n'a pas de vitesse : la distance est celle entre
 * les points, comme pour sa longueur (`cumulativeDistances`).
 */
export const legSurfaceStretches = (points: ReadonlyArray<RoutePoint>, surfaces: SurfaceRuns | undefined): SurfaceStretch[] => {
  const stretches: SurfaceStretch[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    stretches.push({
      category: surfaces ? classifySurface(tagsAt(surfaces, i - 1)) : 'inconnu',
      distanceM: haversineDistance(a.lat, a.lon, b.lat, b.lon),
    });
  }
  return stretches;
};

/**
 * Longueurs le long d'une trace enregistrée : le segment `i − 1 → i` prend la
 * voie du point `i − 1`, retrouvé par son instant (`startMs` : origine des
 * débuts). Distance intégrée de la vitesse retenue (règle 6).
 */
export const trackSurfaceStretches = (track: ReadonlyArray<TrackPoint>, surfaces: SurfaceRuns, startMs: number): SurfaceStretch[] => {
  const stretches: SurfaceStretch[] = [];
  for (let i = 1; i < track.length; i++) {
    stretches.push({
      category: classifySurface(tagsAt(surfaces, track[i - 1].timeMs - startMs)),
      distanceM: segmentDistanceM(track as TrackPoint[], i),
    });
  }
  return stretches;
};

/** Longueur totale d'une catégorie. */
export interface SurfaceTotal {
  category: SurfaceCategory;
  distanceM: number;
}

/** Mètres par catégorie, de la plus longue à la plus courte, sans les catégories vides. */
export const summarizeSurfaces = (stretches: ReadonlyArray<SurfaceStretch>): SurfaceTotal[] => {
  const totals = new Map<SurfaceCategory, number>();
  for (const s of stretches) {
    if (s.distanceM > 0) totals.set(s.category, (totals.get(s.category) ?? 0) + s.distanceM);
  }
  return [...totals].map(([category, distanceM]) => ({ category, distanceM })).sort((a, b) => b.distanceM - a.distanceM);
};

/** Tronçon que la carte calcule (type de voie), par opposition à une ligne droite ou une trace importée. */
const isComputedLeg = (leg: RouteLeg): boolean => leg.mode !== 'straight' && leg.mode !== 'imported';

/** Revêtement d'un itinéraire, et ce qui manque pour qu'il soit complet. */
export interface RouteSurfaces {
  totals: SurfaceTotal[];
  /** Tronçons encore en calcul : ils ne comptent pas encore. */
  pendingLegs: number;
  /** Tronçons calculés sans revêtement (rangés avant qu'on le garde) : comptés « Inconnu », à recalculer. */
  missingLegs: number;
}

/**
 * Revêtement de tout l'itinéraire. Une ligne droite ou une trace importée
 * compte « Inconnu », comme un tronçon en échec ; un tronçon en calcul n'est
 * pas compté.
 */
export const routeSurfaces = (legs: ReadonlyArray<RouteLeg>): RouteSurfaces => {
  const stretches: SurfaceStretch[] = [];
  let pendingLegs = 0;
  let missingLegs = 0;
  for (const leg of legs) {
    if (leg.status === 'pending') {
      pendingLegs += 1;
      continue;
    }
    const known = leg.status === 'ready' && isComputedLeg(leg) ? leg.surfaces : undefined;
    if (leg.status === 'ready' && isComputedLeg(leg) && !known) missingLegs += 1;
    stretches.push(...legSurfaceStretches(leg.points, known));
  }
  return { totals: summarizeSurfaces(stretches), pendingLegs, missingLegs };
};
