import type { LatLngExpression, LeafletEventHandlerFnMap, PathOptions } from 'leaflet';

/**
 * Calculs purs des composants de carte (`components/map/`) : options données
 * à Leaflet à la création d'une couche, et ce qui a changé d'un rendu à
 * l'autre. `leaflet` n'y entre qu'en types : il touche `window` à l'import.
 */

/**
 * Les seules clés renseignées de `options`. Leaflet recopie toutes les clés
 * d'un objet d'options, `undefined` compris : `icon: undefined` écraserait
 * l'icône par défaut d'un repère, `pane: undefined` son calque.
 */
export const definedOptions = <T extends object>(options: T): Partial<T> => {
  const kept: Partial<T> = {};
  for (const key of Object.keys(options) as Array<keyof T>) {
    if (options[key] !== undefined) kept[key] = options[key];
  }
  return kept;
};

/**
 * Options de création d'un trait ou d'un rond : son style (`pathOptions`),
 * le calque où il se pose (celui du `Pane` qui l'entoure, sinon celui de
 * Leaflet) et son rayon (en pixels pour un rond, en mètres pour un cercle).
 * Le style est donné dès la création : `interactive: false` ne vaut qu'à ce
 * moment, Leaflet ne le relit pas ensuite.
 */
export const pathLayerOptions = (
  pathOptions: PathOptions | undefined, pane: string | undefined, radius?: number,
): PathOptions & { radius?: number } => definedOptions({ ...pathOptions, pane, radius });

/** Ce qu'un repère (`Marker`) reprend d'un rendu à l'autre. */
export interface MarkerState<Icon = unknown> {
  position: LatLngExpression;
  icon: Icon | undefined;
  zIndexOffset: number | undefined;
  draggable: boolean | undefined;
}

const MARKER_KEYS = ['position', 'icon', 'zIndexOffset', 'draggable'] as const;

/** Ce qui a changé d'un rendu à l'autre, comparé à la référence (un tableau de position neuf compte pour un changement). */
export const markerChanges = <Icon>(prev: MarkerState<Icon>, next: MarkerState<Icon>): Array<keyof MarkerState<Icon>> =>
  MARKER_KEYS.filter((key) => prev[key] !== next[key]);

/**
 * Noms des événements écoutés, triés et joints par une espace : la carte
 * n'est rebranchée que si cette liste change, pas à chaque nouvel objet de
 * gestionnaires. Un nom sans gestionnaire ne compte pas.
 */
export const eventNamesKey = (handlers: LeafletEventHandlerFnMap): string =>
  Object.entries(handlers).filter(([, handler]) => typeof handler === 'function').map(([name]) => name).sort().join(' ');
