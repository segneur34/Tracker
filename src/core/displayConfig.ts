/**
 * Constantes d'affichage communes aux modules. Elles ne concernent pas les
 * calculs, seulement la quantité de données envoyée aux graphes et à la
 * carte.
 */

/** Nombre maximal de points tracés sur un graphe, pour rester fluide. */
export const CHART_MAX_POINTS = 500;

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
