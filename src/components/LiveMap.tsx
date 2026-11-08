import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { divIcon, type Marker as LeafletMarker } from 'leaflet';
import { trackBounds } from '../core/displayConfig';
import MapContainer from './map/MapContainer';
import Marker from './map/Marker';
import Pane from './map/Pane';
import { Circle, CircleMarker, Polyline } from './map/paths';
import { useMap, useMapEvents } from './map/mapContext';
import { useCompassHeading } from '../hooks/useCompassHeading';
import type { LocationFix } from '../platform/location';
import { displayHeading, type TravelHeading } from '../recording/heading';
import { liveTail } from '../recording/livePath';
import type { CourseMark } from '../recording/markGuide';
import type { SessionMark } from '../core/sessionMarks';
import type { SportFamily } from '../core/sportProfiles';
import { useMapBase } from '../hooks/useMapBase';
import BaseTileLayer from './BaseTileLayer';
import { HoveredTrackMarker } from './HoverMarker';
import { SessionMarksLayer } from './SessionMarks';
import MapAutoResize from './MapAutoResize';
import { divIconCache, haloStyle } from './mapStyles';
import Button from './ui/Button';

interface LiveMapProps {
  /** Trace enregistrée, un tableau par segment continu : une pause coupe le trait. */
  segments: LocationFix[][];
  /** Position du moment, suivie par la carte. */
  position: LocationFix | null;
  /**
   * Rang, dans l'enregistrement, du segment de `position` (le dernier pour une position gardée) : le trait qui
   * prolonge la trace jusqu'à elle ne joint jamais deux segments (`liveTail`). Sans lui, aucun trait.
   */
  positionSegment?: number | null;
  /** Couleur de la trace, celle de la famille du support. */
  color: string;
  /** Famille de l'activité : son fond de carte, plan ou satellite (`BaseTileLayer`). */
  family: SportFamily;
  height: string;
  /** Trace suivie, ce qu'il en reste : en pointillé sous la trace en cours. */
  guide?: ReadonlyArray<{ lat: number; lon: number }>;
  /** Partie déjà faite de la trace suivie, en gris. */
  guideDone?: ReadonlyArray<{ lat: number; lon: number }>;
  /** Cap de la marche, pour orienter la flèche de position. */
  travel?: TravelHeading;
  /** Commande posée en haut à droite de la carte (« Réduire la carte »). */
  overlay?: ReactNode;
  /** Balises du parcours suivi (voile, surf), et rayon de validation autour de la balise visée, en mètres. */
  marks?: ReadonlyArray<CourseMark>;
  validationRadiusM?: number;
  /** Repères du bouton « Note » posés pendant l'enregistrement, en fanions numérotés comme dans l'analyse. */
  notes?: ReadonlyArray<SessionMark>;
  /** Points lus par le survol d'un graphe : le repère se pose sur celui survolé. Sans eux, aucun repère. */
  hoverPoints?: ReadonlyArray<{ lat: number; lon: number }>;
}

/** Couleurs de la trace suivie, reste et partie faite (données de carte, donc en dur). */
const GUIDE_WEIGHT = 6;
const GUIDE_DONE_WEIGHT = 4;
const GUIDE_STYLE = { color: '#263238', weight: GUIDE_WEIGHT, opacity: 1, dashArray: '12 8', lineCap: 'butt', interactive: false } as const;
const GUIDE_DONE_STYLE = { color: '#757575', weight: GUIDE_DONE_WEIGHT, opacity: 0.85, interactive: false } as const;
/** Épaisseur de la trace enregistrée. */
const TRACK_WEIGHT = 4;
/** Liseré blanc sous la trace, sur le fond satellite. */
const HALO_STYLE = haloStyle(TRACK_WEIGHT);
/** Le même liseré sous la trace suivie, à son épaisseur. */
const GUIDE_HALO_STYLE = haloStyle(GUIDE_WEIGHT);
const GUIDE_DONE_HALO_STYLE = haloStyle(GUIDE_DONE_WEIGHT);
/**
 * Calques de la trace suivie, sous celui des tracés (400 chez Leaflet) : la partie faite naît en cours de route et
 * le liseré au passage en satellite, et un tracé monté tard passerait sinon par-dessus la trace enregistrée.
 */
const GUIDE_HALO_PANE = { name: 'traceSuivieLisere', style: { zIndex: 380 } };
const GUIDE_PANE = { name: 'traceSuivie', style: { zIndex: 390 } };
/**
 * Calque du liseré de la trace enregistrée et de son prolongement : au-dessus de la trace suivie, sous celui des
 * tracés (400) où reste la trace. Passer en satellite en cours de route crée le liseré après la trace : sans ce
 * calque, il se poserait par-dessus elle.
 */
const TRACK_HALO_PANE = { name: 'traceLisere', style: { zIndex: 395 } };

/** Balises : fond, bordure et chiffre selon leur état (données de carte, donc en dur). */
const MARK_STYLE: Record<CourseMark['state'], { fill: string; border: string; ink: string; dashed?: boolean }> = {
  validated: { fill: '#9e9e9e', border: '#ffffff', ink: '#ffffff' },
  skipped: { fill: '#ffffff', border: '#9e9e9e', ink: '#9e9e9e', dashed: true },
  target: { fill: '#e65100', border: '#ffffff', ink: '#ffffff' },
  next: { fill: '#ffffff', border: '#37474f', ink: '#37474f' },
};
const TARGET_CIRCLE_STYLE = { color: '#e65100', weight: 2, opacity: 0.8, fillOpacity: 0.08, interactive: false } as const;
const AIM_STYLE = { color: '#e65100', weight: 2, opacity: 0.8, dashArray: '4 6', interactive: false } as const;
const MARK_SIZE = 26;

/** Repères des balises, gardés d'un rendu à l'autre : Leaflet ne les redessine que s'ils changent. */
const markIcons = divIconCache();
const markIcon = (label: string, state: CourseMark['state']) => markIcons(`${label}|${state}`, () => {
  const { fill, border, ink, dashed } = MARK_STYLE[state];
  return {
    className: '',
    iconSize: [MARK_SIZE, MARK_SIZE],
    iconAnchor: [MARK_SIZE / 2, MARK_SIZE / 2],
    html: `<span style="display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:${MARK_SIZE}px;height:${MARK_SIZE}px;`
      + `border-radius:50%;background:${fill};color:${ink};border:2px ${dashed ? 'dashed' : 'solid'} ${border};`
      + `font-weight:700;font-size:13px;line-height:1;box-shadow:0 1px 4px rgba(0,0,0,0.35)">${label}</span>`,
  };
});

const ARROW_SIZE = 30;

/** Flèche de position, pointe vers le haut, tournée ensuite au cap. */
const arrowIcon = (color: string) => divIcon({
  className: '',
  iconSize: [ARROW_SIZE, ARROW_SIZE],
  iconAnchor: [ARROW_SIZE / 2, ARROW_SIZE / 2],
  html: `<svg class="live-arrow" width="${ARROW_SIZE}" height="${ARROW_SIZE}" viewBox="0 0 30 30" style="display:block">`
    + `<path d="M15 2 L26 27 L15 21 L4 27 Z" fill="${color}" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
});

/**
 * Position du moment : une flèche au cap affiché (marche, ou boussole à
 * l'arrêt), le rond sans cap connu. La flèche est tournée directement dans le
 * DOM, pour ne pas recréer l'icône à chaque mesure de la boussole.
 */
function PositionMarker({ position, color, travel }: { position: LocationFix; color: string; travel?: TravelHeading }) {
  // La boussole ne sert qu'à l'arrêt : en marche, le cap vient de la trace.
  const compass = useCompassHeading(travel?.moving === false);
  const heading = travel ? displayHeading(travel, compass) : null;
  const icon = useMemo(() => arrowIcon(color), [color]);
  const marker = useRef<LeafletMarker>(null);
  useEffect(() => {
    const arrow = marker.current?.getElement()?.querySelector<SVGElement>('.live-arrow');
    if (arrow && heading !== null) arrow.style.transform = `rotate(${heading}deg)`;
  }, [heading, icon]);

  // Le style ne change qu'avec la couleur : pas d'objet neuf à chaque position reçue.
  const dotStyle = useMemo(() => ({ color: '#ffffff', weight: 3, fillColor: color, fillOpacity: 1 }), [color]);

  if (heading === null) {
    return <CircleMarker center={[position.lat, position.lon]} radius={8} pathOptions={dotStyle} />;
  }
  return <Marker ref={marker} position={[position.lat, position.lon]} icon={icon} interactive={false} keyboard={false} />;
}

/** Recentre la carte sur la position tant que l'utilisateur ne l'a pas déplacée à la main. */
function FollowPosition({ position, following, onUserMove }: {
  position: LocationFix | null;
  following: boolean;
  onUserMove: () => void;
}) {
  const map = useMap();
  useMapEvents({ dragstart: onUserMove });
  useEffect(() => {
    if (following && position) map.panTo([position.lat, position.lon], { animate: false });
  }, [map, following, position]);
  return null;
}

/** Points d'un tracé, dans la forme de Leaflet. */
const latLngs = (points: ReadonlyArray<{ lat: number; lon: number }>): [number, number][] => points.map((p) => [p.lat, p.lon]);

/**
 * Tracés des segments, dans la forme de Leaflet, gardés d'un calcul à
 * l'autre et retrouvés par la première position de leur segment : un segment
 * fermé par une pause ne change plus et garde son tableau (Leaflet ne le
 * reprojette pas), le dernier n'est prolongé que de ses nouveaux points.
 */
const pathCache = new WeakMap<LocationFix, [number, number][]>();

const segmentPath = (segment: LocationFix[]): [number, number][] => {
  const first = segment[0];
  if (!first) return [];
  const kept = pathCache.get(first);
  const path = kept && kept.length === segment.length ? kept
    : kept && kept.length < segment.length ? kept.concat(latLngs(segment.slice(kept.length)))
    : latLngs(segment);
  pathCache.set(first, path);
  return path;
};

/**
 * Carte de l'enregistrement en cours : la trace d'une seule couleur (un
 * dégradé demanderait un trait par point, trop lourd à redessiner) et la
 * position du moment (une flèche au cap, `PositionMarker`), et la trace
 * suivie s'il y en a une, la partie faite en gris, et sur un parcours ses balises
 * (la visée en orange, avec son cercle de validation et un pointillé depuis
 * la position), et les notes posées en fanions numérotés. Sans position ni trace, la carte s'ouvre cadrée sur la trace
 * suivie. Sans réseau, le fond manque mais traces et position restent.
 */
function LiveMap({ segments, position, positionSegment = null, color, family, height, guide, guideDone, travel, overlay, marks, validationRadiusM, notes, hoverPoints }: LiveMapProps) {
  const [following, setFollowing] = useState(true);
  const halo = useMapBase(family)[0] === 'satellite';
  // Tracés mémorisés : `segments` ne change qu'au recalcul (toutes les 2 s, `useLiveRecording`), la position à chaque mesure.
  // Leaflet ne reprend un tracé que si son tableau de points change : les segments fermés gardent le leur.
  const paths = useMemo(() => segments.map(segmentPath), [segments]);
  const guidePath = useMemo(() => (guide && guide.length > 1 ? latLngs(guide) : null), [guide]);
  const guideDonePath = useMemo(() => (guideDone && guideDone.length > 1 ? latLngs(guideDone) : null), [guideDone]);
  const trackStyle = useMemo(() => ({ color, weight: TRACK_WEIGHT, opacity: 0.9 }), [color]);
  const numberedNotes = useMemo(() => (notes ?? []).map((mark, i) => ({ mark, n: i + 1 })), [notes]);
  // Le dernier segment, recalculé moins souvent que la position, est prolongé jusqu'à elle par un trait à part ;
  // juste après une reprise, la position est déjà dans un nouveau segment : pas de trait depuis le point de la pause.
  const tail = liveTail(segments, position, positionSegment);
  const target = marks?.find((m) => m.state === 'target');
  const start = position ?? segments[0]?.[0] ?? null;
  const guideBounds = !start && guide && guide.length > 1 ? trackBounds(guide) : null;
  if (!start && !guideBounds) return null;

  return (
    <div style={{ position: 'relative', height, borderRadius: 'var(--radius-m)', overflow: 'hidden', border: '1px solid var(--line-strong)', zIndex: 0 }}>
      <MapContainer
        {...(start ? { center: [start.lat, start.lon] as [number, number], zoom: 16 } : { bounds: guideBounds!, boundsOptions: { padding: [24, 24] } })}
        className="ui-fill">
        <MapAutoResize />
        <BaseTileLayer family={family} />
        {halo && (
          <Pane {...GUIDE_HALO_PANE}>
            {guideDonePath && <Polyline positions={guideDonePath} pathOptions={GUIDE_DONE_HALO_STYLE} />}
            {guidePath && <Polyline positions={guidePath} pathOptions={GUIDE_HALO_STYLE} />}
          </Pane>
        )}
        <Pane {...GUIDE_PANE}>
          {guideDonePath && <Polyline positions={guideDonePath} pathOptions={GUIDE_DONE_STYLE} />}
          {guidePath && <Polyline positions={guidePath} pathOptions={GUIDE_STYLE} />}
        </Pane>
        {target && validationRadiusM !== undefined && validationRadiusM > 0 && (
          <Circle center={[target.lat, target.lon]} radius={validationRadiusM} pathOptions={TARGET_CIRCLE_STYLE} />
        )}
        {target && position && (
          <Polyline positions={[[position.lat, position.lon], [target.lat, target.lon]]} pathOptions={AIM_STYLE} />
        )}
        {halo && (
          <Pane {...TRACK_HALO_PANE}>
            {paths.map((positions, i) => <Polyline key={`halo-${i}`} positions={positions} pathOptions={HALO_STYLE} />)}
            {tail && (
              <Polyline positions={[[tail[0].lat, tail[0].lon], [tail[1].lat, tail[1].lon]]} pathOptions={HALO_STYLE} />
            )}
          </Pane>
        )}
        {paths.map((positions, i) => <Polyline key={i} positions={positions} pathOptions={trackStyle} />)}
        {tail && (
          <Polyline positions={[[tail[0].lat, tail[0].lon], [tail[1].lat, tail[1].lon]]} pathOptions={trackStyle} />
        )}
        {marks?.map((m, i) => (
          <Marker key={i} position={[m.lat, m.lon]} icon={markIcon(m.label, m.state)} interactive={false} keyboard={false}
            zIndexOffset={m.state === 'target' ? 500 : 0} />
        ))}
        <SessionMarksLayer located={numberedNotes} shownMs={null} />
        {position && <PositionMarker position={position} color={color} travel={travel} />}
        {hoverPoints && <HoveredTrackMarker points={hoverPoints} />}
        <FollowPosition position={position} following={following} onUserMove={() => setFollowing(false)} />
      </MapContainer>
      {overlay && (
        <div className="theme-light" style={{ position: 'absolute', right: 'var(--space-3)', top: 'var(--space-3)', zIndex: 'var(--z-map-overlay)' }}>{overlay}</div>
      )}
      {!following && (
        <Button variant="secondary" className="theme-light" onClick={() => setFollowing(true)}
          style={{ position: 'absolute', right: 'var(--space-3)', bottom: 'var(--space-3)', zIndex: 'var(--z-map-overlay)' }}>
          Recentrer
        </Button>
      )}
    </div>
  );
}

export default LiveMap;
