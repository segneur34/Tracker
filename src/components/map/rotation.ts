import L from 'leaflet';
import { coverSquareSide, rotateAround, svgPaddingFor, unwrapDeg } from '../../core/screenRotation';
import './rotation.css';

/**
 * Rotation d'une carte Leaflet à l'écran (carte du direct orientée selon le
 * téléphone), écrite pour l'application : Leaflet 1.9 ne sait pas tourner une
 * carte, et les extensions essayées modifiaient Leaflet pour toutes les cartes.
 *
 * Un `div` à nous, le « rotor », est glissé entre le conteneur de la carte et
 * son calque principal (`mapPane`), puis tourné par CSS autour du centre du
 * cadre. Le conteneur et les commandes (+ et −, fond, mention OSM) ne bougent
 * pas ; tout ce qui est dessiné sur la carte tourne d'un bloc (tuiles, tracés,
 * calques nommés, repères). Leaflet calcule comme sur une carte droite ; trois
 * corrections, sur cette carte seule, sans toucher à aucun prototype de Leaflet :
 *  - le point touché (clic, molette, double toucher, pincer) est ramené dans
 *    le repère de la carte droite (`mouseEventToContainerPoint`, posée sur
 *    l'objet de la carte) ;
 *  - le glisser est tourné avant d'être appliqué (`predrag`), l'élan reste juste ;
 *  - en mode orienté, les tuiles (`BaseTileLayer`, par `coverSizeOf`) et les
 *    tracés (marge des moteurs SVG) couvrent le carré de la diagonale du cadre,
 *    quel que soit l'angle : tourner ne demande alors aucun travail à Leaflet.
 * Le zoom par rectangle (Maj + glisser) et les flèches du clavier, qui
 * suivraient les axes de l'écran, sont coupés en mode orienté.
 *
 * Champs internes de Leaflet 1.9.4 lus ici : `map.dragging._draggable` et,
 * pendant un glisser, ses `_startPos`, `_newPos` et `_parentScale` ;
 * `_getTiledPixelBounds` des couches de tuiles (`BaseTileLayer.tsx`). S'il en
 * manque un, la rotation refuse de s'activer et la carte reste nord en haut.
 *
 * Les éléments à garder droits à l'écran (chiffres des balises, fanions des
 * notes) portent la classe `map-upright` sur un élément intérieur de leur
 * icône, jamais sur l'icône que Leaflet place : la variable CSS
 * `--map-bearing` du rotor les redresse autour de leur point d'ancrage.
 */

export interface MapRotation {
  /**
   * Passe en mode orienté (vrai) ou nord en haut (faux). Rend vrai si le mode
   * orienté est actif après l'appel ; faux s'il est refusé (champ de Leaflet absent).
   */
  setEnabled(enabled: boolean): boolean;
  /** Cap à mettre en haut de l'écran, en degrés depuis le nord, sens horaire ; sans effet nord en haut. */
  setBearing(bearingDeg: number): void;
  /** Retire le rotor et rend à la carte son état d'origine. */
  dispose(): void;
}

/** Ce que la rotation lit du glisser de Leaflet (`L.Draggable`), champs internes compris. */
interface DraggableInternals {
  _startPos?: unknown;
  _newPos?: unknown;
  _parentScale?: { x?: unknown; y?: unknown };
  on(type: string, fn: () => void): unknown;
  off(type: string, fn: () => void): unknown;
}

/** Ce que la rotation lit et règle d'un moteur de dessin (SVG). */
interface RendererInternals {
  options: L.RendererOptions;
  _update?: () => void;
}

interface RotationState {
  /** Mode orienté actif (et la rotation en état de marche). */
  enabled: boolean;
}

const states = new WeakMap<L.Map, RotationState>();
const handles = new WeakMap<L.Map, MapRotation>();

/** Classe du rotor (`rotation.css`). */
const ROTOR_CLASS = 'map-rotor';

/** Durée de la transition entre deux angles, en millisecondes (dite aussi dans `rotation.css`). */
export const ROTATION_TRANSITION_MS = 250;

/** Marge d'origine des moteurs de dessin de Leaflet, quand le moteur n'en dit pas. */
const LEAFLET_PADDING = 0.1;

/**
 * Taille du cadre à couvrir de tuiles : le carré de la diagonale de la carte en mode orienté, `null` sinon (et pour
 * toute carte sans rotation) : la couche de tuiles fait alors comme Leaflet.
 */
export const coverSizeOf = (map: L.Map): L.Point | null => {
  if (!states.get(map)?.enabled) return null;
  const size = map.getSize();
  const side = coverSquareSide(size.x, size.y);
  return side > 0 ? L.point(side, side) : null;
};

/** Rotation posée sur `map` par `attachRotation` ; `null` pour une carte qui ne tourne pas. */
export const rotationOf = (map: L.Map): MapRotation | null => handles.get(map) ?? null;

const isPoint = (value: unknown): value is L.Point => value instanceof L.Point;
const isScale = (value: DraggableInternals['_parentScale']): value is { x: number; y: number } =>
  typeof value?.x === 'number' && typeof value.y === 'number' && value.x > 0 && value.y > 0;

/**
 * Pose le rotor sur `map`, droite au départ ; à appeler juste après sa création. Rend `null`, sans rien toucher,
 * si la carte n'a pas ce que la rotation attend de Leaflet.
 */
export function attachRotation(map: L.Map): MapRotation | null {
  if (handles.has(map)) return handles.get(map) ?? null;
  const container = map.getContainer();
  const mapPane = map.getPane('mapPane');
  const draggable = (map.dragging as unknown as { _draggable?: DraggableInternals } | undefined)?._draggable;
  const tiledBounds = (L.GridLayer.prototype as unknown as { _getTiledPixelBounds?: unknown })._getTiledPixelBounds;
  if (!mapPane || mapPane.parentElement !== container || !draggable
    || typeof draggable.on !== 'function' || typeof draggable.off !== 'function' || typeof tiledBounds !== 'function') {
    return null;
  }

  const state: RotationState = { enabled: false };
  states.set(map, state);
  /** Angle du rotor à l'écran, déroulé (sens horaire) : l'opposé du cap montré en haut. */
  let angleDeg = 0;
  /** Une fois vrai (champ du glisser absent), la carte reste nord en haut. */
  let broken = false;

  const rotor = L.DomUtil.create('div', ROTOR_CLASS);
  container.insertBefore(rotor, mapPane);
  rotor.appendChild(mapPane);

  const center = (): { x: number; y: number } => ({ x: container.clientWidth / 2, y: container.clientHeight / 2 });

  // 1. Le point touché, ramené dans le repère de la carte droite ; propre à cet objet, retiré au démontage.
  const own = map as unknown as { mouseEventToContainerPoint: (e: MouseEvent) => L.Point };
  own.mouseEventToContainerPoint = (e: MouseEvent): L.Point => {
    const p = L.DomEvent.getMousePosition(e, container);
    if (!state.enabled) return p;
    const q = rotateAround(p, center(), -angleDeg);
    return L.point(q.x, q.y);
  };

  // 2. Le glisser : déplacement brut à l'écran, tourné dans le repère de la carte.
  let corrected: unknown = null;
  let containerScale = { x: 1, y: 1 };
  const onDown = (): void => {
    const scale = L.DomUtil.getScale(container);
    containerScale = { x: scale.x, y: scale.y };
  };
  const onPreDrag = (): void => {
    if (!state.enabled) return;
    const { _startPos: start, _newPos: next, _parentScale: parentScale } = draggable;
    // Même position déjà corrigée (Leaflet n'a pas bougé entre deux images) : ne pas la tourner deux fois.
    if (next === corrected) return;
    if (!isPoint(start) || !isPoint(next) || !isScale(parentScale)) {
      broken = true;
      setEnabled(false);
      return;
    }
    // Leaflet a divisé le déplacement par l'échelle du rotor tourné (son cadre à l'écran, agrandi) : on la remet.
    const raw = { x: (next.x - start.x) * parentScale.x, y: (next.y - start.y) * parentScale.y };
    const turned = rotateAround(raw, { x: 0, y: 0 }, -angleDeg);
    const fixed = start.add(L.point(turned.x / containerScale.x, turned.y / containerScale.y));
    draggable._newPos = fixed;
    corrected = fixed;
  };
  draggable.on('down', onDown);
  draggable.on('predrag', onPreDrag);

  // 3. Marge des moteurs de dessin : celle d'origine, ou celle qui couvre le carré de la diagonale.
  const originalPadding = new Map<RendererInternals, number>();
  const tune = (renderer: RendererInternals, refresh: boolean): void => {
    if (!originalPadding.has(renderer)) originalPadding.set(renderer, renderer.options.padding ?? LEAFLET_PADDING);
    const original = originalPadding.get(renderer) ?? LEAFLET_PADDING;
    const size = map.getSize();
    const padding = state.enabled ? svgPaddingFor(size.x, size.y, original) : original;
    if (renderer.options.padding === padding) return;
    L.Util.setOptions(renderer, { padding });
    if (refresh) renderer._update?.();
  };
  const tuneAll = (refresh: boolean): void => {
    map.eachLayer((layer) => {
      if (layer instanceof L.Renderer) tune(layer as unknown as RendererInternals, refresh);
    });
  };
  const onLayerAdd = (e: L.LayerEvent): void => {
    if (e.layer instanceof L.Renderer) tune(e.layer as unknown as RendererInternals, true);
  };
  const onResize = (): void => tuneAll(true);
  map.on('layeradd', onLayerAdd);
  map.on('resize', onResize);

  // Commandes qui suivraient les axes de l'écran : coupées en mode orienté, rendues ensuite si elles marchaient.
  const screenAxisHandlers = [map.boxZoom, map.keyboard].filter((h): h is L.Handler => Boolean(h));
  const wereEnabled = new Map<L.Handler, boolean>();

  const show = (): void => {
    if (state.enabled) {
      rotor.style.transform = `rotate(${angleDeg}deg)`;
      rotor.style.setProperty('--map-bearing', `${angleDeg}deg`);
    } else {
      rotor.style.removeProperty('transform');
      rotor.style.removeProperty('--map-bearing');
    }
  };

  function setEnabled(enabled: boolean): boolean {
    const next = enabled && !broken;
    if (next === state.enabled) return state.enabled;
    state.enabled = next;
    rotor.classList.toggle(`${ROTOR_CLASS}--on`, next);
    if (next) {
      for (const handler of screenAxisHandlers) {
        wereEnabled.set(handler, handler.enabled());
        handler.disable();
      }
    } else {
      angleDeg = 0;
      for (const handler of screenAxisHandlers) if (wereEnabled.get(handler)) handler.enable();
      wereEnabled.clear();
    }
    show();
    // Tuiles et tracés reprennent leur emprise (carré de la diagonale, ou cadre de la carte).
    tuneAll(false);
    map.fire('moveend');
    return state.enabled;
  }

  const handle: MapRotation = {
    setEnabled,
    setBearing(bearingDeg: number): void {
      if (!state.enabled || !Number.isFinite(bearingDeg)) return;
      angleDeg = unwrapDeg(angleDeg, -bearingDeg);
      show();
    },
    dispose(): void {
      if (state.enabled) setEnabled(false);
      draggable.off('down', onDown);
      draggable.off('predrag', onPreDrag);
      map.off('layeradd', onLayerAdd);
      map.off('resize', onResize);
      delete (own as Partial<typeof own>).mouseEventToContainerPoint;
      if (mapPane.parentElement === rotor) container.insertBefore(mapPane, rotor);
      rotor.remove();
      states.delete(map);
      handles.delete(map);
    },
  };
  handles.set(map, handle);
  return handle;
}
