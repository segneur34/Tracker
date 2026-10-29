import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { MAP_BASES, type MapBase } from '../core/mapBase';
import type { SportFamily } from '../core/sportProfiles';
import { useMapBase } from '../hooks/useMapBase';
import { IconLayers } from './icons';
import { resolveTile } from './mapTiles';
// La feuille de Leaflet vient avec le fond, posé dans toutes les cartes (analyses, enregistrement, planification,
// vignettes) : aucune page chargée à la demande ne peut l'oublier (27/10).
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
 * change ; sans famille (vignettes de la bibliothèque), le plan seul, sans
 * bouton.
 *
 * Cartes sans réseau : chaque tuile affichée en ligne est gardée sur
 * l'appareil (`platform/tileCache.ts`) et relue ensuite, même sans réseau ;
 * une tuile gardée qui a vieilli est montrée aussitôt, puis redemandée en
 * arrière-plan. Une tuile jamais vue, hors réseau, ou que le serveur n'a pas
 * (la photo au large), est remplacée par l'agrandissement d'une tuile des
 * zooms inférieurs, floue mais lisible, plutôt que par une case vide. Les
 * règles d'OSM interdisent de télécharger une zone à l'avance : rien n'est
 * demandé au serveur qui n'ait été affiché.
 */

class CachedTileLayer extends L.TileLayer {
  private readonly base: MapBase;

  constructor(base: MapBase) {
    super(MAP_BASES[base].url, { attribution: MAP_BASES[base].attribution });
    this.base = base;
  }

  override createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement('img');
    tile.alt = '';
    tile.setAttribute('role', 'presentation');
    const size = this.getTileSize().x;
    void resolveTile({ z: coords.z, x: coords.x, y: coords.y }, this.base, size).then((content) => {
      if (content === null) {
        done(new Error('tuile absente'), tile);
        return;
      }
      const src = typeof content === 'string' ? content : URL.createObjectURL(content);
      const release = () => { if (typeof content !== 'string') URL.revokeObjectURL(src); };
      tile.onload = () => { release(); done(undefined, tile); };
      tile.onerror = () => { release(); done(new Error('tuile illisible'), tile); };
      tile.src = src;
    });
    return tile;
  }
}

function TileLayer({ base }: { base: MapBase }) {
  const map = useMap();
  useEffect(() => {
    map.attributionControl?.setPrefix(false);
    const layer = new CachedTileLayer(base).addTo(map);
    return () => {
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
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!container.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, container]);
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
