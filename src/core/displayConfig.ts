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

/** Écart entre deux flèches de cap sur la carte de la voile, en secondes. */
export const ARROW_EVERY_S = 40;

/**
 * Points qui portent une flèche de cap : le premier point à `everyS`,
 * 2 × `everyS`… secondes du départ, si bien qu'une trace à 1 Hz et à 5 Hz a
 * ses flèches aux mêmes instants (règle 2). Après un trou plus long que
 * l'écart, une seule flèche, au point qui le suit.
 */
export const arrowIndices = (track: ReadonlyArray<{ timeMs: number }>, everyS: number): number[] => {
  if (track.length === 0 || !(everyS > 0)) return [];
  const stepMs = everyS * 1000;
  const startMs = track[0].timeMs;
  const indices: number[] = [];
  let nextMs = startMs + stepMs;
  for (let i = 1; i < track.length; i++) {
    if (track[i].timeMs < nextMs) continue;
    indices.push(i);
    nextMs = startMs + (Math.floor((track[i].timeMs - startMs) / stepMs) + 1) * stepMs;
  }
  return indices;
};
