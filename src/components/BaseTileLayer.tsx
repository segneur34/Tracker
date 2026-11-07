import { useEffect, useState } from 'react';
import { useCloseOnOutsideOrEscape } from '../hooks/useDismiss';
import { createPortal } from 'react-dom';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { MAP_BASES, type MapBase } from '../core/mapBase';
import type { SportFamily } from '../core/sportProfiles';
import { TILE_CACHE_DEFAULTS, tilesToRetry, tileViewOf, type TileCoord, type TileView } from '../core/tiles';
import { useMapBase } from '../hooks/useMapBase';
import { onNetworkBack, resolveExactTile, resolveTile } from '../platform/mapTiles';
import { isForeground, onForeground } from '../platform/screen';
import { IconLayers } from './icons';
// La feuille de Leaflet vient avec le fond, posé dans toutes les cartes (analyses, enregistrement, planification) :
// aucune page chargée à la demande ne peut l'oublier (27/10).
import 'leaflet/dist/leaflet.css';
import './BaseTileLayer.css';

/**
 * Fond de carte commun à toutes les cartes de l'application : le plan
 * d'OpenStreetMap, ou la photo satellite d'Esri (`core/mapBase.ts`), avec la
 * mention qu'exigent les conditions d'usage de chacun (et celles du calcul
 * d'itinéraire, qui repose sur OSM). La mention de Leaflet, facultative, est
 * retirée pour qu'elle tienne même sur l'aperçu de la bibliothèque.
 *
 * Avec une famille (analyses, enregistrement, planification), le fond est
 * celui qu'elle a retenu (`useMapBase`) et un bouton, sous le + et le −, le
 * change ; sans famille, le plan seul, sans bouton. Les vignettes de la
 * bibliothèque ne sont pas des cartes : des images fixes
 * (`drawTrackPreview.ts`), sur les mêmes tuiles (`platform/mapTiles.ts`).
 *
 * Cartes sans réseau : chaque tuile affichée en ligne est gardée sur
 * l'appareil (`platform/tileCache.ts`) et relue ensuite, même sans réseau ;
 * une tuile gardée qui a vieilli est montrée aussitôt, puis redemandée en
 * arrière-plan. Une tuile jamais vue, hors réseau, ou que le serveur n'a pas
 * (la photo au large), est remplacée par l'agrandissement d'une tuile des
 * zooms inférieurs, floue mais lisible, plutôt que par une case vide. Les
 * règles d'OSM interdisent de télécharger une zone à l'avance : rien n'est
 * demandé au serveur qui n'ait été affiché. Une case que Leaflet retire avant
 * qu'elle soit prête (zoom ou déplacement rapides) abandonne sa demande : la
 * requête est coupée si aucune autre case ni image ne l'attend.
 *
 * Leaflet marque une case chargée même en erreur et ne redemande que les cases
 * qu'il n'a plus : sans reprise, une case échouée (réseau endormi au
 * déverrouillage) resterait vide jusqu'à ce qu'un zoom la retire. La couche
 * retient donc ses cases et reprend celles qui manquent, vides, agrandies ou
 * en attente trop longue : trois fois après un retour au premier plan ou du
 * réseau, une fois par minute au plus au déplacement de la carte. Seulement
 * les cases visibles, le téléphone allumé, sur une carte qui a une taille ;
 * une case déjà chargée n'est pas touchée (pas de `redraw`, qui clignote) et
 * une tuile que le serveur n'a pas ne repart jamais (`platform/mapTiles.ts`).
 */

/** Demande en cours d'une case, et l'adresse d'objet de son image tant qu'elle est posée. */
interface TileLoad {
  controller: AbortController;
  objectUrl: string | null;
  /** Agrandissement à remettre si la vraie tuile, posée par-dessus, ne se lit pas. */
  fallbackSrc: string | null;
}

/** Une case tenue par Leaflet, de sa création à son retrait. */
interface TileSlot {
  tile: HTMLImageElement;
  coords: TileCoord;
  done: L.DoneCallback;
  /** `done` déjà appelé : un nouvel échec n'a plus rien à lui apprendre. */
  told: boolean;
  shows: 'rien' | 'agrandie' | 'tuile';
  load: TileLoad | null;
  triedAtMs: number;
}

/** Vrai pour une image finie et sans contenu : jamais posée, en erreur, ou perdue. */
const isBlank = (tile: HTMLImageElement): boolean => tile.complete && tile.naturalWidth === 0;

class CachedTileLayer extends L.TileLayer {
  private readonly base: MapBase;
  private readonly slots = new Map<HTMLElement, TileSlot>();

  constructor(base: MapBase) {
    super(MAP_BASES[base].url, { attribution: MAP_BASES[base].attribution });
    this.base = base;
    // Case retirée (hors de la vue, autre zoom) ou abandonnée en cours de chargement : sa demande aussi.
    const release = (e: L.TileEvent) => this.release(e.tile);
    this.on('tileunload', release);
    this.on('tileabort', release);
  }

  private release(tile: HTMLElement): void {
    const slot = this.slots.get(tile);
    if (!slot) return;
    this.slots.delete(tile);
    // Leaflet a déjà vidé l'image : rien à lui remettre.
    if (slot.load) slot.load.fallbackSrc = null;
    this.cut(slot);
  }

  private startLoad(slot: TileSlot): TileLoad {
    const load: TileLoad = { controller: new AbortController(), objectUrl: null, fallbackSrc: null };
    slot.load = load;
    slot.triedAtMs = Date.now();
    return load;
  }

  /** Demande finie : l'image ne l'attend plus, son adresse d'objet est rendue. */
  private endLoad(slot: TileSlot, load: TileLoad): void {
    slot.tile.onload = null;
    slot.tile.onerror = null;
    if (load.objectUrl) URL.revokeObjectURL(load.objectUrl);
    load.objectUrl = null;
    slot.load = null;
  }

  /** Coupe la demande en cours de la case : celle-ci ne touchera plus à l'image. */
  private cut(slot: TileSlot): void {
    const load = slot.load;
    if (!load) return;
    this.endLoad(slot, load);
    load.controller.abort();
    if (load.fallbackSrc) slot.tile.src = load.fallbackSrc;
  }

  /** Remplit la case, même image à chaque reprise ; `done` n'est rappelé que pour une image neuve, que Leaflet fait entrer en fondu. */
  private fill(slot: TileSlot): void {
    const { tile } = slot;
    const load = this.startLoad(slot);
    const settle = (shows: TileSlot['shows'], error?: Error): void => {
      this.endLoad(slot, load);
      slot.shows = shows;
      if (error && slot.told) return;
      slot.told = true;
      slot.done(error, tile);
    };
    void resolveTile(slot.coords, this.base, this.getTileSize().x, load.controller.signal).then((content) => {
      if (slot.load !== load) return;
      if (content === null) {
        settle('rien', new Error('tuile absente'));
        return;
      }
      const src = typeof content === 'string' ? content : URL.createObjectURL(content);
      if (typeof content !== 'string') load.objectUrl = src;
      tile.onload = () => settle(typeof content === 'string' ? 'agrandie' : 'tuile');
      tile.onerror = () => settle('rien', new Error('tuile illisible'));
      tile.src = src;
    });
  }

  /** Remplace l'agrandissement par la vraie tuile, si elle arrive : ni `done` ni fondu, l'ancienne image reste jusqu'à la nouvelle. */
  private upgrade(slot: TileSlot): void {
    const { tile } = slot;
    const load = this.startLoad(slot);
    void resolveExactTile(slot.coords, this.base, load.controller.signal).then((blob) => {
      if (slot.load !== load) return;
      if (!blob) {
        this.endLoad(slot, load);
        return;
      }
      load.fallbackSrc = tile.getAttribute('src');
      load.objectUrl = URL.createObjectURL(blob);
      tile.onload = () => {
        this.endLoad(slot, load);
        slot.shows = 'tuile';
      };
      tile.onerror = () => {
        this.endLoad(slot, load);
        if (load.fallbackSrc) tile.src = load.fallbackSrc;
      };
      tile.src = load.objectUrl;
    });
  }

  override createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement('img');
    tile.alt = '';
    tile.setAttribute('role', 'presentation');
    const slot: TileSlot = {
      tile,
      coords: { z: coords.z, x: coords.x, y: coords.y },
      done,
      told: false,
      shows: 'rien',
      load: null,
      triedAtMs: 0,
    };
    this.slots.set(tile, slot);
    this.fill(slot);
    return tile;
  }

  /** Vrai pour une case à reprendre : sans vraie tuile, ou dont la demande traîne. */
  private isMissing(slot: TileSlot, nowMs: number): boolean {
    if (slot.load) return nowMs - slot.triedAtMs >= TILE_CACHE_DEFAULTS.stuckLoadMs;
    return slot.shows !== 'tuile' || isBlank(slot.tile);
  }

  /** Cases que Leaflet montre pour cette carte, au même arrondi du zoom et du centre que lui. */
  private viewOf(map: L.Map): TileView {
    const zoom = map.getZoom();
    const z = Math.round(zoom);
    const center = map.project(map.getCenter(), z).floor();
    const half = map.getSize().divideBy(map.getZoomScale(zoom, z) * 2);
    return tileViewOf(z, center.subtract(half), center.add(half), this.getTileSize().x);
  }

  /**
   * Reprend les cases manquantes de la vue, dont la dernière demande date d'au moins `minIntervalMs`. Une carte
   * repliée ou sans taille ne demande rien.
   */
  retryMissing(map: L.Map, minIntervalMs: number): void {
    if (this.slots.size === 0) return;
    const container = map.getContainer();
    if (container.clientWidth === 0 || container.clientHeight === 0) return;
    const nowMs = Date.now();
    const missing = [...this.slots.values()].filter((slot) => this.isMissing(slot, nowMs));
    for (const slot of tilesToRetry(missing, this.viewOf(map), nowMs, minIntervalMs)) {
      const keepsImage = slot.shows === 'agrandie' && !isBlank(slot.tile);
      this.cut(slot);
      if (keepsImage) this.upgrade(slot);
      else this.fill(slot);
    }
  }
}

function TileLayer({ base }: { base: MapBase }) {
  const map = useMap();
  useEffect(() => {
    map.attributionControl?.setPrefix(false);
    const layer = new CachedTileLayer(base).addTo(map);
    // Écran éteint, aucune reprise : la position qui déplace la carte ne demande que les cases neuves, comme Leaflet.
    const retry = (minIntervalMs: number): void => {
      if (isForeground()) layer.retryMissing(map, minIntervalMs);
    };
    let timers: number[] = [];
    const clearTimers = (): void => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers = [];
    };
    const scheduleRetries = (): void => {
      clearTimers();
      if (!isForeground()) return;
      timers = TILE_CACHE_DEFAULTS.retryDelaysMs.map((delayMs) =>
        window.setTimeout(() => retry(TILE_CACHE_DEFAULTS.retryGapMs), delayMs));
    };
    const onMoveEnd = (): void => retry(TILE_CACHE_DEFAULTS.moveRetryGapMs);
    const stopForeground = onForeground(scheduleRetries);
    const stopNetwork = onNetworkBack(scheduleRetries);
    map.on('moveend', onMoveEnd);
    return () => {
      stopForeground();
      stopNetwork();
      map.off('moveend', onMoveEnd);
      clearTimers();
      layer.remove();
    };
  }, [map, base]);
  return null;
}

/** Choix du menu, dans l'ordre. */
const BASE_CHOICES: ReadonlyArray<{ base: MapBase; label: string }> = [
  { base: 'plan', label: 'Plan' },
  { base: 'satellite', label: 'Satellite' },
];

/**
 * Bouton du coin haut gauche, sous le + et le −, qui ouvre le choix du fond
 * (plan ou satellite) à sa droite. Un choix le ferme ; un toucher ailleurs ou
 * Échap aussi, sans rien changer.
 */
function BaseSwitch({ base, onChange }: { base: MapBase; onChange: (base: MapBase) => void }) {
  const map = useMap();
  const [open, setOpen] = useState(false);
  const [container] = useState(() => {
    const element = L.DomUtil.create('div', 'leaflet-bar map-base-switch');
    // Un toucher sur le bouton ou le menu ne va pas à la carte : ni plein écran, ni point posé.
    L.DomEvent.disableClickPropagation(element);
    L.DomEvent.disableScrollPropagation(element);
    return element;
  });
  useEffect(() => {
    const control = new L.Control({ position: 'topleft' });
    control.onAdd = () => container;
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map, container]);
  useCloseOnOutsideOrEscape(open, () => container, () => setOpen(false));
  return createPortal(
    <>
      <button type="button" className="map-base-switch__button" aria-expanded={open} aria-haspopup="menu"
        aria-label="Fond de carte" title="Fond de carte" onClick={() => setOpen((o) => !o)}>
        <IconLayers size={18} />
      </button>
      {open && (
        <div className="map-base-switch__menu" role="menu" aria-label="Fond de carte">
          {BASE_CHOICES.map((choice) => (
            <button key={choice.base} type="button" role="menuitemradio" aria-checked={choice.base === base}
              className="map-base-switch__choice"
              onClick={() => {
                onChange(choice.base);
                setOpen(false);
              }}>
              {choice.label}
            </button>
          ))}
        </div>
      )}
    </>,
    container
  );
}

function BaseTileLayer({ family }: { family?: SportFamily }) {
  const [base, setBase] = useMapBase(family ?? null);
  return (
    <>
      <TileLayer base={base} />
      {family && <BaseSwitch base={base} onChange={setBase} />}
    </>
  );
}

export default BaseTileLayer;
