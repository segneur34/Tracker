import { haversineDistance } from '../core/kinematics';
import { segmentDistanceM } from '../core/sessionStats';
import type { TrackPoint } from '../core/types';
import { WAY_TYPE_HIGHWAYS } from './brouterProfile';
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
 * Couleur de chaque catégorie, dans la barre et sur la carte (donnée de
 * graphe, donc en dur) : tons sourds, proches de ceux de Komoot.
 */
export const SURFACE_COLOR: Record<SurfaceCategory, string> = {
  asphalte: '#5b6270',
  pierresPlates: '#c4c7cc',
  paves: '#8f8a84',
  gravillon: '#d9c7a3',
  nonPave: '#a07850',
  terre: '#7b5534',
  herbe: '#9dbf7a',
  sable: '#e6d38f',
  alpin: '#7f9f86',
  autre: '#a99bb8',
  inconnu: '#dedbd5',
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
const ROAD_HIGHWAYS = new Set([...WAY_TYPE_HIGHWAYS.route, ...WAY_TYPE_HIGHWAYS.grandeRoute]);

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

/** Morceau de tracé d'une seule catégorie, pour la carte. */
export interface SurfacePath {
  category: SurfaceCategory;
  positions: [number, number][];
}

/**
 * Tracé découpé par revêtement, pour la carte : `stretches[k]` est le
 * revêtement du segment `k → k + 1` (`legSurfaceStretches`,
 * `trackSurfaceStretches`). Les segments voisins de même catégorie ne font
 * qu'un morceau ; deux morceaux qui se suivent partagent leur point de
 * jonction, pour que le tracé reste continu.
 */
export const surfacePaths = (
  points: ReadonlyArray<{ lat: number; lon: number }>,
  stretches: ReadonlyArray<SurfaceStretch>
): SurfacePath[] => {
  const paths: SurfacePath[] = [];
  let current: SurfacePath | null = null;
  for (let k = 0; k < stretches.length && k + 1 < points.length; k++) {
    const { category } = stretches[k];
    if (current === null || current.category !== category) {
      current = { category, positions: [[points[k].lat, points[k].lon]] };
      paths.push(current);
    }
    current.positions.push([points[k + 1].lat, points[k + 1].lon]);
  }
  return paths;
};

/** Longueur d'une ligne, en mètres (distance entre ses points). */
const lineLengthM = (positions: ReadonlyArray<[number, number]>): number => {
  let total = 0;
  for (let i = 1; i < positions.length; i++) {
    total += haversineDistance(positions[i - 1][0], positions[i - 1][1], positions[i][0], positions[i][1]);
  }
  return total;
};

/** Point à mi-longueur d'une ligne, interpolé sur le segment qui le contient. */
const midpoint = (positions: ReadonlyArray<[number, number]>): [number, number] => {
  let remaining = lineLengthM(positions) / 2;
  for (let i = 1; i < positions.length; i++) {
    const [a, b] = [positions[i - 1], positions[i]];
    const d = haversineDistance(a[0], a[1], b[0], b[1]);
    if (remaining <= d && d > 0) {
      const t = remaining / d;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    remaining -= d;
  }
  return positions[0];
};

/**
 * Part de la longueur totale sous laquelle un morceau en surbrillance reçoit
 * un repère : la carte montre d'ordinaire tout le tracé, et un trait plus
 * court s'y perd.
 */
export const SURFACE_MARK_MAX_SHARE = 0.02;

/**
 * Morceaux d'un revêtement choisi dans la barre, pour la surbrillance de la
 * carte : leurs lignes, et un repère au milieu de chaque morceau trop court
 * pour se voir seul (moins de `markMaxShare` de tout le tracé), quand il ne
 * fait que quelques mètres d'une grande boucle.
 */
export const surfaceHighlight = (
  paths: ReadonlyArray<SurfacePath>,
  category: SurfaceCategory,
  markMaxShare = SURFACE_MARK_MAX_SHARE
): { lines: [number, number][][]; marks: [number, number][] } => {
  const totalM = paths.reduce((sum, p) => sum + lineLengthM(p.positions), 0);
  const lines = paths.filter((p) => p.category === category && p.positions.length > 0).map((p) => p.positions);
  const marks = lines.filter((line) => lineLengthM(line) < markMaxShare * totalM).map(midpoint);
  return { lines, marks };
};

/** Tronçon que la carte calcule (type de voie), par opposition à une ligne droite ou une trace importée. */
const isComputedLeg = (leg: RouteLeg): boolean => leg.mode !== 'straight' && leg.mode !== 'imported';

/** Voies connues d'un tronçon : celles d'un tronçon calculé et prêt ; sinon aucune (« Inconnu »). */
const knownLegSurfaces = (leg: RouteLeg): SurfaceRuns | undefined =>
  leg.status === 'ready' && isComputedLeg(leg) ? leg.surfaces : undefined;

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
    const known = knownLegSurfaces(leg);
    if (leg.status === 'ready' && isComputedLeg(leg) && !known) missingLegs += 1;
    stretches.push(...legSurfaceStretches(leg.points, known));
  }
  return { totals: summarizeSurfaces(stretches), pendingLegs, missingLegs };
};

/**
 * Tracé de chaque tronçon découpé par revêtement, pour la carte ; `null` pour
 * un tronçon en calcul ou en échec, que la carte garde en pointillé.
 */
export const routeSurfacePaths = (legs: ReadonlyArray<RouteLeg>): (SurfacePath[] | null)[] =>
  legs.map((leg) => (leg.status === 'ready' ? surfacePaths(leg.points, legSurfaceStretches(leg.points, knownLegSurfaces(leg))) : null));
