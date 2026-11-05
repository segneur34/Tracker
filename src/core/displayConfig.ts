import { haversineDistance } from './geo';

/**
 * Constantes d'affichage communes aux modules. Elles ne concernent pas les
 * calculs, seulement la quantité de données envoyée aux graphes et à la
 * carte.
 */

/** Nombre maximal de points tracés sur un graphe, pour rester fluide. */
export const CHART_MAX_POINTS = 500;

/**
 * Nombre maximal de points de la courbe de FC sur la vignette d'une session
 * sans trace, dans la liste de la bibliothèque (la trace d'une vignette carte
 * est réduite au pixel, `components/drawTrackPreview.ts`).
 */
export const PREVIEW_MAX_POINTS = 300;

/** Plage la plus étroite d'un graphe zoomé, en part de son étendue : 1 %. */
export const CHART_ZOOM_MIN_FRACTION = 0.01;

/** Zoom d'un double-clic ou d'un double toucher sur un graphe : la plage divisée par 2. */
export const CHART_TAP_ZOOM_FACTOR = 2;

/** Centre de la carte avant le chargement d'une trace : Montpellier. */
export const DEFAULT_MAP_CENTER: [number, number] = [43.6108, 3.8767];

/** Coins sud-ouest et nord-est d'une trace, au format de Leaflet. */
export type TrackBounds = [[number, number], [number, number]];

/**
 * Rectangle qui englobe une trace, pour y cadrer la carte ; `null` sans point.
 * Les points aux coordonnées non finies sont ignorés.
 */
export const trackBounds = (points: ReadonlyArray<{ lat: number; lon: number }>): TrackBounds | null => {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const { lat, lon } of points) {
    if (!isFinite(lat) || !isFinite(lon)) continue;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
  }
  return south === Infinity ? null : [[south, west], [north, east]];
};

/** Écart à l'écran entre deux flèches de sens sur la carte d'une analyse, en pixels (05/11). */
export const ARROW_SPACING_PX = 80;

/** Flèches de sens au plus sur la carte d'une analyse, quel que soit le zoom. */
export const ARROW_MAX = 400;

/** Rayon équatorial de la projection des tuiles (Web Mercator, WGS 84), en mètres. */
const WEB_MERCATOR_RADIUS_M = 6_378_137;

/** Mètres par pixel d'une carte en tuiles de 256 px (Web Mercator) au zoom `zoom`, à la latitude `latDeg`. */
export const metersPerPixel = (zoom: number, latDeg: number): number =>
  (2 * Math.PI * WEB_MERCATOR_RADIUS_M * Math.cos((latDeg * Math.PI) / 180)) / (256 * 2 ** zoom);

/**
 * Points qui portent une flèche de sens : une flèche dès que la corde depuis la
 * précédente (le départ pour la première) atteint `spacingM` mètres, si bien
 * que leur écart à l'écran reste le même à tout zoom. Le dépassement d'un pas
 * est repris sur l'écart suivant (sans descendre sous la moitié de `spacingM`) :
 * une trace à 1 Hz et à 5 Hz a ses flèches aux mêmes endroits, à un pas près,
 * sans que l'écart ne dérive avec la cadence (règle 2). Une
 * reprise après une pause (`segmentStart`) repart de son point, sans flèche
 * sur le pas qui l'enjambe. Au-delà de `maxCount`, `maxCount` flèches sont
 * gardées, également réparties.
 */
export const arrowIndicesBySpacing = (
  track: ReadonlyArray<{ lat: number; lon: number; segmentStart?: true }>,
  spacingM: number,
  maxCount: number
): number[] => {
  if (track.length < 2 || !(spacingM > 0) || !(maxCount >= 1)) return [];
  const indices: number[] = [];
  let anchor = track[0];
  let need = spacingM;
  for (let i = 1; i < track.length; i++) {
    const point = track[i];
    if (point.segmentStart) {
      anchor = point;
      need = spacingM;
      continue;
    }
    const chordM = haversineDistance(anchor.lat, anchor.lon, point.lat, point.lon);
    if (chordM < need) continue;
    indices.push(i);
    anchor = point;
    need = Math.max(spacingM - (chordM - need), spacingM / 2);
  }
  if (indices.length <= maxCount) return indices;
  const count = Math.floor(maxCount);
  return Array.from({ length: count }, (_, k) => indices[Math.floor(((k + 1) * indices.length) / count) - 1]);
};
