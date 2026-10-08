import { Fragment, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import L from 'leaflet';
import { CircleMarker, MapContainer, Marker, Polyline, useMapEvents } from 'react-leaflet';
import { Link, useSearchParams } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import 'leaflet/dist/leaflet.css';
import './PlanningPage.css';
import ActivitySelect from '../components/ActivitySelect';
import BeepCurveEditor from '../components/BeepCurveEditor';
import MapAutoResize from '../components/MapAutoResize';
import OsmTileLayer from '../components/OsmTileLayer';
import PanelTitle from '../components/PanelTitle';
import ResizablePanel from '../components/ResizablePanel';
import RouteList from '../components/RouteList';
import SectionTabs, { type SectionDefinition } from '../components/SectionTabs';
import SurfaceBar from '../components/SurfaceBar';
import SurfaceLayer from '../components/SurfaceLayer';
import WayTypeTabs from '../components/WayTypeTabs';
import ZoomableChart, { ChartZoomProbe } from '../components/ZoomableChart';
import { hoveredTrackIndex, type ChartHoverEvent } from '../components/chartHover';
import { gradeGradientDefs } from '../components/gradeGradientDefs';
import { IconChevronRight, IconFile, IconUndo } from '../components/icons';
import { CARD_STYLE } from '../components/styles';
import Button from '../components/ui/Button';
import HelpButton from '../components/ui/HelpButton';
import PageHeader from '../components/ui/PageHeader';
import { activityFamily, activityTreatment, findActivity, type Activity } from '../core/activities';
import { niceTicks, sampledIndices, visibleIndexRange } from '../core/chartZoom';
import { CHART_MAX_POINTS, DEFAULT_MAP_CENTER, trackBounds } from '../core/displayConfig';
import { parseGpxPath } from '../core/gpxParser';
import { ELEVATION_PRESETS } from '../core/sportProfiles';
import { SLOW_COLOR, gradientCss } from '../core/speedGradient';
import { DISTANCE_UNIT_SYMBOL, formatDistance, formatDuration, toDisplayDistance } from '../core/units';
import { useLeaveWarning } from '../hooks/leaveGuard';
import { useChartZoom } from '../hooks/useChartZoom';
import { useGoOnRoute } from '../hooks/useGoOnRoute';
import { useOpenSections } from '../hooks/useOpenSections';
import { usePlannedRoute } from '../hooks/usePlannedRoute';
import { getLastFix, useRecorder } from '../hooks/useRecorder';
import { useRouteLibrary, type SavedRoute } from '../hooks/useRouteLibrary';
import { useRunnerProfile } from '../hooks/useRunnerProfile';
import {
  effectiveDistanceUnit, effectiveDurationSettings, effectiveElevationProfile, effectiveGradeRange, effectiveLoopReturnRatio, effectiveMarkGuide,
  effectivePace, effectiveWayTypes, lastRecordActivity, readStoredActivities, PLANNING_FAMILIES,
} from '../hooks/useSportSettings';
import { ROUTES_DIR } from '../library/folderLayout';
import { guessSport } from '../library/naming';
import { PACE_LEVEL_LABEL, estimateRouteDurationS } from '../planning/duration';
import { searchPlaces, type Place } from '../planning/geocoding';
import { WAY_TYPES } from '../planning/brouterProfile';
import {
  DEFAULT_ROUTE_MODE, EMPTY_ROUTE, STRAIGHT_HINT, STRAIGHT_LABEL, WAY_TYPE_HINT, WAY_TYPE_LABEL, acceptLoopReturn, courseLegs, isLooped, isWaysMode,
  routeFromTrack,
  routeModeLabel, routePoints, routeProfileRows, routeTotals, routeVehicle, setRouteMode, straightenRoute, toggleWayType, wayTypesOf, waypointDistances,
  waysMode,
  type PlannedRoute, type RouteMode, type Waypoint,
} from '../planning/route';
import { buildRouteGpx, markLabel, waypointLabel } from '../planning/routeGpx';
import { recordToRoute, routeMarkGuide } from '../planning/routeRecord';
import { routeSurfacePaths, routeSurfaces } from '../planning/surface';
import { beepStartM, validationRadiusM, type MarkGuideSettings } from '../recording/markGuide';
import { gradeColorPaths, gradeGradientStops } from '../running/runningAnalytics';
import { canDownloadFiles, downloadTextFile, readPickedFile } from '../platform/files';
import { currentPosition, locationPermissionGranted } from '../platform/location';
import { isNativeApp } from '../platform/runtime';
import { jsonStore } from '../platform/storage';

/**
 * Planification d'un itinéraire : on pose des points sur la carte, chaque
 * tronçon entre deux points suit la carte, par les types de voie cochés, ou
 * va en ligne droite. L'activité et les types de voie se choisissent
 * au-dessus de la carte ; choisir une activité coche les siens (Réglages,
 * `effectiveWayTypes`), que l'on change ensuite pour cet itinéraire. Les
 * changer, directement ou par l'activité, recalcule tout l'itinéraire
 * (`setRouteMode`) ; dessous, des onglets ouvrent les blocs (général, surface, tracé,
 * points, enregistrer, mes itinéraires), comme dans les analyses. Distance, dénivelés et profil d'altitude se mettent à jour
 * à chaque calcul, avec le temps estimé en course et à vélo (niveau choisi
 * dans Réglages) et le revêtement des voies suivies (`planning/surface.ts`). L'itinéraire s'enregistre dans `itineraires/` du dossier
 * mémoire, avec son GPX.
 *
 * En voile, c'est un parcours : des balises numérotées, reliées en ligne
 * droite, que l'enregistrement fait valider une à une, avec des bips
 * d'approche (`recording/markGuide.ts`) : ceux de l'activité (Réglages), ou
 * ceux propres au parcours, rangés dans sa fiche.
 *
 * Le calcul demande du réseau (`planning/brouter.ts`) ; un itinéraire rangé se
 * rouvre sans. On y arrive depuis l'accueil (« Planifier ») et, sur
 * ordinateur, depuis la barre du haut ; `?itineraire=<base>` ouvre un
 * itinéraire rangé (listes de l'accueil et des bibliothèques).
 */

/**
 * Préférences de la page sur l'appareil : dernière activité choisie, dernière
 * vue de la carte, dernier état choisi du bouton « Boucle ». Le mode n'y est
 * plus écrit depuis que chaque activité a ses types de voie (§10, point 81) :
 * un ancien `mode` y reste, ignoré.
 */
const PREFS_KEY = 'tracker.planning';

interface PlanningPrefs {
  activityId?: string;
  view?: { lat: number; lon: number; zoom: number };
  loop?: boolean;
}

/** Centrage sur soi à l'ouverture : délai accordé au GPS, et zoom minimal une fois centré. */
const AUTO_LOCATE_TIMEOUT_MS = 15_000;
const AUTO_LOCATE_MIN_ZOOM = 14;

const readPrefs = (): PlanningPrefs => jsonStore.read<PlanningPrefs>(PREFS_KEY) ?? {};
const writePrefs = (patch: PlanningPrefs): void => jsonStore.write(PREFS_KEY, { ...readPrefs(), ...patch });

/** Tronçon en échec, sur la carte (donnée de carte, donc en dur). */
const ERROR_COLOR = '#c62828';
/** Couleur de repli si celle de l'activité n'est pas un code couleur. */
const FALLBACK_COLOR = '#6a1b9a';
/**
 * Tracé et points intermédiaires toujours en bleu, celui de la voile, quelle
 * que soit l'activité : une activité verte ou rouge se confondrait avec le
 * départ ou l'arrivée.
 */
const ROUTE_COLOR = '#1565c0';
/** Départ en vert, arrivée en rouge sombre (distinct du rouge des tronçons en échec). */
const START_COLOR = '#2e7d32';
const END_COLOR = '#b71c1c';
/** Sur une boucle, un seul repère au départ, qui est aussi l'arrivée : moitié vert, moitié rouge. */
const LOOP_FILL = `linear-gradient(90deg, ${START_COLOR} 50%, ${END_COLOR} 50%)`;

const safeColor = (color: string): string => (/^#[0-9a-f]{3,8}$/i.test(color) ? color : FALLBACK_COLOR);

/**
 * Repères des points, lettrés, gardés d'un rendu à l'autre : Leaflet ne les
 * redessine que s'ils changent. `fill` : fond CSS, couleur ou dégradé.
 */
const iconCache = new Map<string, L.DivIcon>();
const waypointIcon = (label: string, fill: string, selected: boolean): L.DivIcon => {
  const key = `${label}|${fill}|${selected}`;
  let icon = iconCache.get(key);
  if (!icon) {
    icon = L.divIcon({
      className: 'plan-marker',
      html: `<span class="plan-marker__dot${selected ? ' plan-marker__dot--selected' : ''}" style="background:${fill}">${label}</span>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
    iconCache.set(key, icon);
  }
  return icon;
};

const toWaypoint = (latlng: L.LatLng): Waypoint => ({ lat: latlng.lat, lon: latlng.lng });

/** Toucher de la carte, prise en main (toucher, glisser, zoomer), et vue retenue pour la prochaine ouverture. */
function MapEvents({ onTap, onTakeOver }: { onTap: (w: Waypoint) => void; onTakeOver: () => void }) {
  useMapEvents({
    click: (e) => {
      onTakeOver();
      onTap(toWaypoint(e.latlng));
    },
    dragstart: onTakeOver,
    zoomstart: onTakeOver,
    moveend: (e) => {
      const map = e.target as L.Map;
      const center = map.getCenter();
      writePrefs({ view: { lat: center.lat, lon: center.lng, zoom: map.getZoom() } });
    },
  });
  return null;
}

const formatMeters = (m: number | null): string => (m === null ? '—' : `${Math.round(m)} m`);

const defaultName = (): string => `Itinéraire du ${new Date().toLocaleDateString('fr-FR')}`;

const sameGuide = (a: MarkGuideSettings | null, b: MarkGuideSettings | null): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Aucune action à mener en quittant : l'itinéraire non enregistré est simplement abandonné. */
const noop = () => {};

interface ChartRow {
  index: number;
  dist: number;
  altitude: number | null;
  grade: number | null;
}

/**
 * Onglets sous la carte. `profil` : l'onglet « général » (ex-« Dénivelé »),
 * `ranger` : « enregistrer » ; clés gardées pour l'état mémorisé. Seul le
 * premier est ouvert au départ, comme dans les analyses.
 */
type PlanningSection = 'profil' | 'surface' | 'parcours' | 'trace' | 'points' | 'ranger' | 'liste';

const PLANNING_SECTION_DEFAULTS: Record<PlanningSection, boolean> = {
  profil: true,
  surface: false,
  parcours: true,
  trace: false,
  points: false,
  ranger: false,
  liste: false,
};

/**
 * Bloc d'un onglet, montré tant que l'onglet est ouvert (état mémorisé) ; son
 * titre le ferme. Il se redimensionne en hauteur sur ordinateur
 * (`ResizablePanel`, taille mémorisée sous `id`, à ne pas renommer).
 */
function PlanBlock({ id, label, open, onToggle, aside, children }: {
  id: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  aside?: ReactNode;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <ResizablePanel id={id} direction="vertical" minHeight={80} style={CARD_STYLE}>
      <div className="plan-block__head">
        <PanelTitle label={label} open={open} onToggle={onToggle} />
        {aside}
      </div>
      {children}
    </ResizablePanel>
  );
}

/**
 * Façon de relier les points : les types de voie cochés, et la ligne droite à
 * part. Toucher un type le coche ou le décoche (le dernier reste coché) ;
 * toucher « Ligne droite » la choisit seule. Sert à la barre au-dessus de la
 * carte (tout l'itinéraire et les points suivants) et au tronçon d'un point sélectionné ; sur
 * une trace importée, rien n'est coché, et choisir refait le tronçon. `children` suit la
 * ligne droite, dans la même rangée (le bouton « Boucle », au-dessus de la carte).
 */
function WayPicker({ mode, label, compact, className, style, onChange, children }: {
  mode: RouteMode;
  label: string;
  compact?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onChange: (mode: RouteMode) => void;
  children?: ReactNode;
}) {
  return (
    <WayTypeTabs checked={isWaysMode(mode) ? wayTypesOf(mode) : []} onToggle={(t) => onChange(toggleWayType(mode, t))} label={label}
      compact={compact} className={className} style={style}>
      <button type="button" className="ui-tab plan-modes__straight" aria-pressed={mode === 'straight'} title={STRAIGHT_HINT}
        onClick={() => onChange('straight')}>
        {STRAIGHT_LABEL}
      </button>
      {children}
    </WayTypeTabs>
  );
}

/** Types de voie cochés à l'arrivée sur une activité : les siens ; sans eux (voile), le mode par défaut. */
const activityMode = (activity: Activity | null): RouteMode => (activity ? waysMode(effectiveWayTypes(activity)) : null) ?? DEFAULT_ROUTE_MODE;

function PlanningPage() {
  const [activities] = useState<Activity[]>(readStoredActivities);
  // Le fractionné ne se planifie pas : ses activités ne sont ni proposées ni reprises.
  const plannable = (a: Activity | null): a is Activity => a !== null && PLANNING_FAMILIES.includes(activityFamily(a));
  const [activityId, setActivityIdState] = useState<string | null>(
    () => [findActivity(activities, readPrefs().activityId), lastRecordActivity(), ...activities].find(plannable)?.id ?? null
  );
  const setActivityId = (id: string) => {
    setActivityIdState(id);
    writePrefs({ activityId: id });
  };
  const activity = findActivity(activities, activityId) ?? activities.find(plannable) ?? null;
  /** Parcours de voile : balises numérotées, tronçons en ligne droite, bloc « Parcours » au lieu du dénivelé. */
  const sailing = activity !== null && activityFamily(activity) === 'voile';
  const distanceUnit = activity ? effectiveDistanceUnit(activity) : 'km';
  const minGainM = (activity ? effectiveElevationProfile(activity) : ELEVATION_PRESETS.route).minGainM;
  const gradeRange = useMemo(() => (activity ? effectiveGradeRange(activity) : null), [activity]);
  const color = safeColor(activity?.color ?? FALLBACK_COLOR);
  const riderKg = useRunnerProfile().profile.weightKg;
  /** Réglage du temps estimé : niveau de l'activité dans Réglages ; `null` en voile. */
  const durationSettings = useMemo(() => (activity ? effectiveDurationSettings(activity, riderKg) : null), [activity, riderKg]);
  const pace = useMemo(() => (activity ? effectivePace(activity) : null), [activity]);

  const vehicle = routeVehicle(activity ? activityTreatment(activity) : 'course');
  /** Retour d'une boucle : au plus tant de fois l'aller (Réglages) ; `null` en voile. */
  const loopRatio = useMemo(() => (activity ? effectiveLoopReturnRatio(activity) : null), [activity]);
  // Types de voie de l'activité à l'ouverture et à chaque changement d'activité, puis ceux que l'on coche ; mode « Boucle »
  // tel que laissé la dernière fois, jamais en voile.
  const planner = usePlannedRoute(vehicle, activityMode(activity), readPrefs().loop === true && !sailing, { maxReturnRatio: loopRatio });
  const { route, mode } = planner;
  /** Mode « Boucle » : l'itinéraire reste bouclé, le retour évite l'aller. */
  const loopOn = planner.loop && !sailing;
  /** Mode des éditions : en voile, toujours la ligne droite ; le type de voie choisi reste pour les autres activités. */
  const editMode: RouteMode = sailing ? 'straight' : mode;
  const library = useRouteLibrary();
  const { go, canGo } = useGoOnRoute();

  /** Types de voie cochés au-dessus de la carte : ceux de tout l'itinéraire, recalculé, et des points suivants (annulable). */
  const chooseMode = (next: RouteMode) => planner.chooseMode(next, (r) => setRouteMode(r, next, mode));

  /** Bouton « Boucle » : allumé, l'itinéraire se boucle ; éteint, le retour est retiré (annulable). Retenu pour la prochaine ouverture. */
  const toggleLoop = () => {
    planner.setLoop(!planner.loop);
    writePrefs({ loop: !planner.loop });
  };

  /**
   * Activité choisie dans le menu : ses types de voie, appliqués à tout
   * l'itinéraire avec ses règles d'accès ; passer à la voile redresse les
   * tronçons calculés et éteint la boucle, en revenir les recalcule (annulable).
   */
  const chooseActivity = (id: string) => {
    setActivityId(id);
    const next = findActivity(activities, id);
    const nextMode = activityMode(next);
    const nextFamily = next ? activityFamily(next) : 'course';
    const nextEdit = nextFamily === 'voile' ? 'straight' : nextMode;
    const nextVehicle = routeVehicle(next ? activityTreatment(next) : 'course');
    planner.chooseMode(nextMode, (r) => setRouteMode(r, nextEdit, editMode, nextVehicle !== vehicle),
      nextFamily === 'voile' ? false : undefined);
  };

  const [map, setMap] = useState<L.Map | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const { open, toggle } = useOpenSections<PlanningSection>('planning', PLANNING_SECTION_DEFAULTS);

  // Itinéraire enregistré en cours d'édition, et l'état enregistré, pour savoir s'il a changé.
  const [current, setCurrent] = useState<SavedRoute | null>(null);
  const [savedRoute, setSavedRoute] = useState<PlannedRoute>(EMPTY_ROUTE);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  /** Échec du chargement d'un GPX, montré dans le bloc Tracé. */
  const [loadError, setLoadError] = useState<string | null>(null);

  // Recherche d'un lieu.
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<Place | null>(null);

  // Ma position : celle de l'enregistrement s'il tourne (il tient le GPS), sinon une lecture unique.
  const recording = useRecorder().status !== 'idle';
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  const [initialView] = useState(() => readPrefs().view ?? { lat: DEFAULT_MAP_CENTER[0], lon: DEFAULT_MAP_CENTER[1], zoom: 13 });
  /** Vrai dès que l'utilisateur ou la page a déplacé la carte : le centrage sur soi à l'ouverture n'a plus lieu. */
  const tookOver = useRef(false);
  const takeOver = () => {
    tookOver.current = true;
  };

  const points = useMemo(() => routePoints(route), [route]);
  const totals = useMemo(() => routeTotals(route, minGainM), [route, minGainM]);
  const surfaces = useMemo(() => routeSurfaces(route.legs), [route.legs]);
  /**
   * « Voir sur la carte » du bloc Surface, et celui de la pente sous le graphe
   * du dénivelé : le tracé prend les couleurs du revêtement ou de la pente tant
   * que leur bloc est ouvert, à la place du bleu ; un tronçon en calcul ou en
   * échec garde son pointillé. Un seul à la fois : en allumer un éteint l'autre.
   */
  const [surfaceOnMap, setSurfaceOnMap] = useState(false);
  const [gradeOnMap, setGradeOnMap] = useState(false);
  const toggleSurfaceOnMap = () => {
    setSurfaceOnMap(!surfaceOnMap);
    if (!surfaceOnMap) setGradeOnMap(false);
  };
  const toggleGradeOnMap = () => {
    setGradeOnMap(!gradeOnMap);
    if (!gradeOnMap) setSurfaceOnMap(false);
  };
  const surfaceShown = !sailing && open.surface && surfaceOnMap;
  const legSurfacePaths = useMemo(() => (surfaceShown ? routeSurfacePaths(route.legs) : null), [surfaceShown, route.legs]);
  const firstError = route.legs.find((l) => l.status === 'error')?.error ?? null;
  const distances = useMemo(() => waypointDistances(route), [route]);
  const looped = isLooped(route);
  /** Retour de la boucle en mode « Boucle », quand il se calcule à part (`loopReturn`). */
  const returnLeg = loopOn && looped ? route.legs[route.legs.length - 1] : undefined;
  const returnMark = returnLeg?.loopReturn;
  const returnPending = returnLeg?.status === 'pending' && returnMark !== undefined;
  /** Tronçons de l'aller encore en calcul : le retour attend qu'ils le soient tous. */
  const tracePending = totals.pendingLegs - (returnPending ? 1 : 0);
  /** Ligne d'état du retour calculé : longueur, rapport à l'aller, part commune avec lui. */
  const returnStatus = (() => {
    if (!returnMark || returnLeg?.status !== 'ready') return null;
    if (!returnMark.outcome || returnMark.sharedM === undefined) return 'Retour enregistré avec l\'itinéraire.';
    const n = route.waypoints.length;
    const returnM = distances[n - 1].legM;
    const outboundM = distances[n - 2].cumulativeM;
    const km = (m: number) => formatDistance(m, distanceUnit, 1);
    const variant = returnMark.variant > 0 ? ` (variante ${returnMark.variant + 1})` : '';
    if (returnMark.outcome === 'avoided') {
      const ratio = outboundM > 0 ? ` (${parseFloat((returnM / outboundM).toFixed(2))} × l'aller)` : '';
      return `Retour par d'autres voies${variant} : ${km(returnM)}${ratio}, ${km(returnMark.sharedM)} sur l'aller.`;
    }
    const why = returnMark.tooLong
      ? 'Aller trop long pour éviter ses voies'
      : `Pas de retour par d'autres voies sous ${loopRatio ?? '—'} × l'aller`;
    return `${why} : retour le plus court${variant}, ${km(returnMark.sharedM)} sur l'aller. Posez des points sur le retour pour le modeler.`;
  })();
  /** Nom des points : numéros des balises en voile, lettres ailleurs. */
  const label = sailing ? markLabel : waypointLabel;
  /** Nom d'un point ; sur une boucle, l'arrivée est le départ : A, ou 1. */
  const pointLabel = (i: number) => label(looped && i === route.waypoints.length - 1 ? 0 : i);
  /** Nom d'un point au milieu du parcours, en toutes lettres. */
  const pointName = (i: number) => (sailing ? `Balise ${label(i)}` : `Point ${label(i)}`);
  const legs = useMemo(() => (sailing ? courseLegs(route) : []), [sailing, route]);
  /** Bips d'approche propres au parcours (`null` : ceux de l'activité), et l'éditeur ouvert ou non. */
  const [courseGuide, setCourseGuide] = useState<MarkGuideSettings | null>(null);
  const [beepsOpen, setBeepsOpen] = useState(false);
  const activityGuide = useMemo(() => (activity && sailing ? effectiveMarkGuide(activity) : null), [activity, sailing]);
  const guide = courseGuide ?? activityGuide;
  /** Fond d'un point de la liste : départ en vert, arrivée en rouge, les autres en bleu, comme le tracé. */
  const pointFill = (i: number) => (i === 0 ? START_COLOR : i === route.waypoints.length - 1 ? END_COLOR : ROUTE_COLOR);
  /** Fond d'un repère sur la carte : sur une boucle, le repère unique A porte départ et arrivée. */
  const markerFill = (i: number) => (i === 0 && looped ? LOOP_FILL : pointFill(i));
  const durationS = useMemo(() => estimateRouteDurationS(route, minGainM, durationSettings), [route, minGainM, durationSettings]);

  const dirty = current !== null
    ? route !== savedRoute || name.trim() !== current.record.name || (activity?.id ?? null) !== current.record.activityId
      || !sameGuide(courseGuide, routeMarkGuide(current.record))
    : route.waypoints.length > 0 || courseGuide !== null;
  useLeaveWarning(dirty ? { message: 'L\'itinéraire en cours n\'est pas enregistré. Quitter quand même ?', discard: noop } : null);

  // --- Profil d'altitude ---

  /** Profil à pas régulier ; ses lignes portent la position du repère de survol sur la carte. */
  const profile = useMemo(() => routeProfileRows(points), [points]);
  /** Distance de chaque ligne du profil, dans l'unité affichée : l'axe du graphe et de son zoom. */
  const profileDist = useMemo(() => profile.map((row) => toDisplayDistance(row.distM, distanceUnit)), [profile, distanceUnit]);
  const zoom = useChartZoom(profileDist.length > 1 ? { min: profileDist[0], max: profileDist[profileDist.length - 1] } : null);
  /** Lignes tracées : celles de la plage visible, au plus `CHART_MAX_POINTS` : zoomer montre plus de détail. */
  const chartRows = useMemo<ChartRow[]>(() => {
    const [first, last] = visibleIndexRange(profileDist, zoom.view);
    return sampledIndices(first, last, CHART_MAX_POINTS).map((i) => {
      const { eleM, grade } = profile[i];
      return { index: i, dist: parseFloat(profileDist[i].toFixed(3)), altitude: eleM !== null ? Math.round(eleM) : null, grade };
    });
  }, [profile, profileDist, zoom.view]);
  const gradeStops = useMemo(
    () => (gradeRange ? gradeGradientStops(chartRows.filter((r) => r.altitude !== null), gradeRange) : []),
    [chartRows, gradeRange]
  );
  const gradientId = `${useId()}-profil`;
  const hasElevation = totals.gainM !== null && chartRows.some((r) => r.altitude !== null);
  const hovered = hoveredIndex !== null ? profile[hoveredIndex] : undefined;
  /** Tracé coloré par la pente, sur les lignes du profil (tous les 10 m), tant que le bloc Général est ouvert. */
  const gradePaths = useMemo(
    () => (!sailing && open.profil && gradeOnMap && !surfaceShown && hasElevation && gradeRange
      ? gradeColorPaths(profile.map((row): [number, number] => [row.lat, row.lon]), profile.map((row) => row.grade), gradeRange)
      : null),
    [sailing, open.profil, gradeOnMap, surfaceShown, hasElevation, gradeRange, profile]
  );

  const onChartHover = (e: ChartHoverEvent) => {
    const index = hoveredTrackIndex(e, chartRows);
    if (index !== hoveredIndex) setHoveredIndex(index);
  };

  // --- Carte ---

  const onMapTap = (w: Waypoint) => {
    // Un toucher ferme d'abord ce qui est ouvert, sans poser de point par mégarde.
    if (selected !== null || candidate !== null || results !== null) {
      setSelected(null);
      setCandidate(null);
      setResults(null);
      return;
    }
    planner.add(w, editMode);
  };

  /** Point choisi dans la liste : même bandeau qu'au toucher sur la carte, carte centrée dessus. */
  const selectPoint = (index: number) => {
    const w = route.waypoints[index];
    if (!w) return;
    setCandidate(null);
    setResults(null);
    setSelected(index);
    map?.panTo([w.lat, w.lon]);
  };

  const fitTo = (r: PlannedRoute) => {
    const bounds = trackBounds(routePoints(r).length > 0 ? routePoints(r) : r.waypoints);
    takeOver();
    if (map && bounds) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
  };

  // --- Recherche ---

  const onSearch = async (e: FormEvent) => {
    e.preventDefault();
    const text = query.trim();
    if (text === '') return;
    setSearching(true);
    setSearchError(null);
    try {
      const center = map?.getCenter();
      const found = await searchPlaces(text, center ? { lat: center.lat, lon: center.lng } : undefined);
      setResults(found);
      if (found.length === 0) setSearchError('Aucun lieu trouvé.');
    } catch (err) {
      setResults(null);
      setSearchError(err instanceof Error ? err.message : 'Recherche impossible.');
    } finally {
      setSearching(false);
    }
  };

  const choosePlace = (place: Place) => {
    setResults(null);
    setSelected(null);
    setCandidate(place);
    takeOver();
    map?.setView([place.lat, place.lon], Math.max(map.getZoom(), 15));
  };

  const locate = async () => {
    takeOver();
    setLocating(true);
    setLocateError(null);
    try {
      const fix = recording ? getLastFix() : await currentPosition();
      if (!fix) throw new Error('Aucune position reçue pour l\'instant.');
      setSelected(null);
      setResults(null);
      setCandidate({ label: 'Votre position', detail: '', lat: fix.lat, lon: fix.lon });
      map?.setView([fix.lat, fix.lon], Math.max(map.getZoom(), 15));
    } catch (err) {
      setLocateError(err instanceof Error ? err.message : 'Position introuvable.');
    } finally {
      setLocating(false);
    }
  };

  // --- Enregistrement ---

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const finalName = name.trim() || defaultName();
      const saved = await library.save(route, { name: finalName, activityId: activity?.id ?? null, markGuide: courseGuide }, current ?? undefined);
      setCurrent(saved);
      setSavedRoute(route);
      setName(finalName);
      setMessage(`Enregistré dans ${ROUTES_DIR}/${saved.base}.json, avec son GPX.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDiscard = () => !dirty || window.confirm('L\'itinéraire en cours n\'est pas enregistré. L\'abandonner ?');

  const openSaved = (saved: SavedRoute) => {
    if (!confirmDiscard()) return;
    const known = findActivity(activities, saved.record.activityId);
    const openedActivity = known ?? activity;
    const openedSailing = openedActivity !== null && activityFamily(openedActivity) === 'voile';
    // Une boucle rouvre le mode « Boucle », son retour pris tel quel : rien à recalculer, rien à enregistrer.
    const read = recordToRoute(saved.record);
    const looping = !openedSailing && isLooped(read);
    const opened = looping ? acceptLoopReturn(read) : read;
    // Un parcours de voile va de balise en balise : un tronçon calculé d'avant est redressé, à enregistrer.
    // Les cases sont celles de l'activité de l'itinéraire ; rien n'est recalculé.
    planner.replace(openedSailing ? straightenRoute(opened) : opened, known ? activityMode(known) : undefined, looping);
    setCourseGuide(routeMarkGuide(saved.record));
    setCurrent(saved);
    setSavedRoute(opened);
    setName(saved.record.name);
    if (known) setActivityId(known.id);
    setSelected(null);
    setMessage(null);
    zoom.reset();
    fitTo(opened);
  };

  const startNew = () => {
    if (!confirmDiscard()) return;
    planner.replace(EMPTY_ROUTE);
    setCurrent(null);
    setSavedRoute(EMPTY_ROUTE);
    setName('');
    setCourseGuide(null);
    setSelected(null);
    setMessage(null);
    zoom.reset();
  };

  /**
   * Charge un GPX téléchargé ailleurs : sa trace devient un nouvel itinéraire,
   * gardée telle quelle entre le départ et l'arrivée (`routeFromTrack`), à
   * enregistrer pour la suivre pendant un enregistrement. L'activité est devinée du
   * type de la trace s'il en porte un.
   */
  const loadGpx = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    // Vidé, le champ accepte de recharger le même fichier.
    input.value = '';
    if (!file) return;
    setLoadError(null);
    try {
      const parsed = parseGpxPath(await readPickedFile(file));
      const loaded = routeFromTrack(parsed.points);
      if (!loaded) throw new Error(`${file.name} ne contient pas de trace : aucun point de trace ou de route.`);
      if (!confirmDiscard()) return;
      // La trace reste telle quelle : pas de mode « Boucle ».
      planner.replace(loaded, undefined, false);
      setCurrent(null);
      setSavedRoute(EMPTY_ROUTE);
      setCourseGuide(null);
      setName(parsed.name ?? file.name.replace(/\.gpx$/i, ''));
      const sport = guessSport(parsed.trackType);
      const guessed = sport ? activities.find((a) => a.base === sport) : undefined;
      if (guessed) setActivityId(guessed.id);
      setSelected(null);
      setCandidate(null);
      setResults(null);
      setMessage(null);
      zoom.reset();
      fitTo(loaded);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Lecture du fichier impossible.');
    }
  };

  /** Supprime un itinéraire enregistré ; celui qui est ouvert laisse la place à une carte vide. */
  const deleteSaved = async (saved: SavedRoute) => {
    setConfirmingDelete(null);
    try {
      await library.remove(saved);
      if (current?.base === saved.base) {
        planner.replace(EMPTY_ROUTE);
        setCurrent(null);
        setSavedRoute(EMPTY_ROUTE);
        setName('');
        setCourseGuide(null);
        setSelected(null);
        zoom.reset();
        setMessage('Itinéraire supprimé.');
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Suppression impossible.');
    }
  };

  const exportGpx = () => {
    const fileName = `${current?.base ?? (name.trim() || defaultName()).replace(/[\\/:*?"<>|]/g, ' ')}.gpx`;
    downloadTextFile(fileName, buildRouteGpx(route, name.trim() || defaultName(), label));
  };

  // Itinéraire demandé par l'adresse : ouvert une fois la liste lue et la carte prête, puis l'adresse est
  // nettoyée, pour qu'un retour sur la page ne le rouvre pas par-dessus un tracé en cours.
  const [params, setParams] = useSearchParams();
  const requestedBase = params.get('itineraire');
  useEffect(() => {
    if (!requestedBase || !map) return;
    const saved = library.routes.find((r) => r.base === requestedBase);
    if (!saved) return;
    openSaved(saved);
    setParams({}, { replace: true });
    // openSaved n'est pas stable ; seuls la demande, la liste et la carte comptent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedBase, map, library.routes]);

  // À l'ouverture, carte centrée sur soi si la position est déjà permise (jamais demandée ici) ; sans réponse,
  // en silence, la dernière vue reste. Rien si un itinéraire est demandé ou si la carte a bougé entre-temps.
  useEffect(() => {
    if (!map || requestedBase) return;
    let cancelled = false;
    void (async () => {
      try {
        const fix = recording
          ? getLastFix()
          : (await locationPermissionGranted()) ? await currentPosition(AUTO_LOCATE_TIMEOUT_MS) : null;
        if (!fix || cancelled || tookOver.current) return;
        map.setView([fix.lat, fix.lon], Math.max(map.getZoom(), AUTO_LOCATE_MIN_ZOOM));
      } catch {
        // Localisation coupée ou trop lente : la dernière vue suffit.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Une fois, quand la carte est prête.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  const selectedLeg = selected !== null && selected > 0 ? route.legs[selected - 1] : undefined;
  const canSave = library.canSave && route.waypoints.length >= 2 && !saving && !current?.readOnly;

  /** Onglets sous la carte : en voile, le parcours et ses balises ; ailleurs, le général, le revêtement et les points. */
  const pointCount = route.waypoints.length;
  const sections: SectionDefinition<PlanningSection>[] = [
    ...(sailing
      ? [{ key: 'parcours' as const, label: 'parcours' }]
      : [{ key: 'profil' as const, label: 'général' }, { key: 'surface' as const, label: 'surface' }]),
    { key: 'trace', label: 'tracé' },
    { key: 'points', label: `${sailing ? 'balises' : 'points'} (${pointCount})` },
    { key: 'ranger', label: 'enregistrer' },
    { key: 'liste', label: `mes itinéraires (${library.routes.length})` },
  ];

  return (
    <div className="ui-page ui-page--wide plan-page">
      <PageHeader
        title="Itinéraires"
        back={{ to: '/', label: 'Accueil' }}
        subtitle={sailing
          ? 'Posez les balises sur la carte : le parcours les relie en ligne droite.'
          : 'Posez des points sur la carte : le tracé suit les chemins entre eux.'} />

      <div className="plan-layout">
        <div className="plan-map-col">
          <div className="plan-toolbar">
            <ActivitySelect activities={activities} value={activity?.id ?? null} label="Activité" families={PLANNING_FAMILIES}
              onChange={(next) => chooseActivity(next.id)} />
            {sailing ? (
              <span className="plan-toolbar__note">Balises reliées en ligne droite</span>
            ) : (
              <WayPicker mode={mode} label="Types de voie" className="plan-modes" onChange={chooseMode}
                style={{ '--tab-accent': color } as React.CSSProperties}>
                <button type="button" className="ui-tab plan-modes__loop" aria-pressed={planner.loop} onClick={toggleLoop}
                  title="L'itinéraire revient toujours au départ, par un retour qui évite les voies de l'aller">
                  Boucle
                </button>
              </WayPicker>
            )}
          </div>
          <form className="plan-search" onSubmit={(e) => void onSearch(e)}>
            <input
              type="search"
              className="ui-field"
              placeholder="Chercher un lieu : commune, sommet, refuge…"
              aria-label="Chercher un lieu"
              value={query}
              onChange={(e) => setQuery(e.target.value)} />
            <Button type="submit" disabled={searching || query.trim() === ''}>{searching ? 'Recherche…' : 'Chercher'}</Button>
          </form>
          {searchError && <div className="ui-alert ui-alert--warning">{searchError}</div>}
          {locateError && <div className="ui-alert ui-alert--warning">{locateError}</div>}
          {results && results.length > 0 && (
            <ul className="plan-results">
              {results.map((place, i) => (
                <li key={i}>
                  <button type="button" onClick={() => choosePlace(place)}>
                    <strong>{place.label}</strong>
                    {place.detail && <span>{place.detail}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <ResizablePanel id="planning.carte" direction="vertical" minHeight={240} className="plan-map" style={{ overflow: 'hidden' }}>
            <MapContainer ref={setMap} center={[initialView.lat, initialView.lon]} zoom={initialView.zoom} style={{ height: '100%', width: '100%' }}>
              <MapAutoResize />
              <OsmTileLayer />
              <MapEvents onTap={onMapTap} onTakeOver={takeOver} />
              {/* Sous les tronçons : un tronçon en calcul ou en échec garde son pointillé par-dessus. */}
              {gradePaths?.map((path, idx) => (
                <Polyline key={`grade-${idx}`} positions={path.positions} pathOptions={{ color: path.color, weight: 5, opacity: 0.9, interactive: false }} />
              ))}
              {route.legs.map((leg, i) => {
                const positions = leg.points.map((p) => [p.lat, p.lon] as [number, number]);
                const style = leg.status === 'ready'
                  // dashArray explicite : Leaflet garderait sinon le pointillé du tronçon en attente.
                  ? { color: ROUTE_COLOR, weight: 5, opacity: 0.9, dashArray: undefined }
                  : { color: leg.status === 'error' ? ERROR_COLOR : ROUTE_COLOR, weight: 4, opacity: leg.status === 'error' ? 0.9 : 0.55, dashArray: '6 8' };
                const surfacePaths = legSurfacePaths?.[i];
                return (
                  <Fragment key={i}>
                    {surfacePaths
                      ? <SurfaceLayer paths={surfacePaths} />
                      : gradePaths && leg.status === 'ready' ? null
                        : <Polyline positions={positions} pathOptions={{ ...style, interactive: false }} />}
                    {/* Trait invisible et large : le toucher qui insère un point n'a pas à viser un trait de 5 px. */}
                    <Polyline
                      positions={positions}
                      pathOptions={{ color: ROUTE_COLOR, weight: 24, opacity: 0, bubblingMouseEvents: false }}
                      eventHandlers={{
                        click: (e) => {
                          setSelected(null);
                          setCandidate(null);
                          planner.insert(i, toWaypoint(e.latlng));
                        },
                      }} />
                  </Fragment>
                );
              })}
              {/* Sur une boucle, l'arrivée est au départ : un seul repère, A, qui les déplace ensemble. */}
              {(looped ? route.waypoints.slice(0, -1) : route.waypoints).map((w, i) => (
                <Marker
                  key={i}
                  position={[w.lat, w.lon]}
                  draggable
                  icon={waypointIcon(label(i), markerFill(i), selected === i)}
                  eventHandlers={{
                    click: () => {
                      setCandidate(null);
                      setSelected(i);
                    },
                    dragend: (e) => planner.move(i, toWaypoint((e.target as L.Marker).getLatLng()), editMode),
                  }} />
              ))}
              {candidate && (
                <CircleMarker center={[candidate.lat, candidate.lon]} radius={9}
                  pathOptions={{ color: '#ffffff', weight: 3, fillColor: ROUTE_COLOR, fillOpacity: 0.6 }} />
              )}
              {hovered && (
                <CircleMarker center={[hovered.lat, hovered.lon]} radius={7}
                  pathOptions={{ color: '#1b1f24', weight: 3, fillColor: '#ffffff', fillOpacity: 1 }} />
              )}
            </MapContainer>
            <div className="plan-map-tools">
              <Button size="s" onClick={() => void locate()} disabled={locating}>
                {locating ? 'Recherche…' : 'Ma position'}
              </Button>
              <Button size="s" onClick={planner.undo} disabled={!planner.canUndo} aria-label="Précédent : défaire la dernière modification">
                <IconUndo size={16} />
                Précédent
              </Button>
            </div>

            {selected !== null && route.waypoints[selected] && (
              <div className="plan-overlay">
                <strong>{sailing ? 'Balise' : 'Point'} {pointLabel(selected)}</strong>
                {selectedLeg && !sailing && (
                  <div className="plan-overlay__field">
                    <span>Pour y venir{selectedLeg.mode === 'imported' && ' (trace importée)'}</span>
                    <WayPicker mode={selectedLeg.mode} label={`Façon de venir au point ${pointLabel(selected)}`} compact
                      onChange={(m) => planner.setLegMode(selected - 1, m)} />
                  </div>
                )}
                {selected === 0 && route.waypoints.length >= 2 && !looped && !loopOn && (
                  <>
                    <Button size="s" variant="primary" onClick={() => { planner.closeLoop(editMode); setSelected(null); }}>Boucler ici</Button>
                    {editMode !== 'straight' && (
                      <Button size="s" onClick={() => { planner.closeLoop('straight'); setSelected(null); }}>En ligne droite</Button>
                    )}
                  </>
                )}
                <Button size="s" variant="danger" onClick={() => { planner.remove(selected, editMode); setSelected(null); }}>Retirer</Button>
                <button type="button" className="plan-overlay__close" aria-label="Fermer" onClick={() => setSelected(null)}>×</button>
                {selectedLeg?.status === 'error' && <p className="plan-overlay__error">{selectedLeg.error}</p>}
              </div>
            )}
            {candidate && (
              <div className="plan-overlay">
                <span className="plan-overlay__place"><strong>{candidate.label}</strong>{candidate.detail && ` · ${candidate.detail}`}</span>
                <Button size="s" variant="primary" onClick={() => { planner.add(candidate, editMode); setCandidate(null); }}>
                  {sailing ? 'Ajouter cette balise' : 'Ajouter ce point'}
                </Button>
                <button type="button" className="plan-overlay__close" aria-label="Fermer" onClick={() => setCandidate(null)}>×</button>
              </div>
            )}
          </ResizablePanel>
          {/* Hors des onglets : l'état du calcul se voit même onglet Tracé fermé. */}
          {loadError && <div className="ui-alert ui-alert--warning">{loadError}</div>}
          {tracePending > 0 && (
            <div className="plan-status">Calcul du tracé… ({tracePending} tronçon{tracePending > 1 ? 's' : ''})</div>
          )}
          {tracePending === 0 && returnPending && <div className="plan-status">Calcul du retour…</div>}
          {returnStatus && (
            <div className="plan-status plan-loop-status">
              <span>{returnStatus}</span>
              <Button size="s" onClick={planner.otherReturn}>Autre retour</Button>
            </div>
          )}
          {firstError && (
            <div className="ui-alert ui-alert--warning plan-error">
              <span>{totals.errorLegs > 1 ? `${totals.errorLegs} tronçons en ligne droite. ` : ''}{firstError}</span>
              <Button size="s" onClick={planner.retry}>Réessayer</Button>
            </div>
          )}
        </div>

        <div className="plan-panel">
          <SectionTabs sections={sections} open={open} onToggle={toggle} accent={color} />
          {sailing ? (
            <PlanBlock id="planning.parcours" label="Parcours" open={open.parcours} onToggle={() => toggle('parcours')}>
              <div className="plan-stats">
                <div className="plan-stat"><span>Distance</span><strong className="num">{formatDistance(totals.distanceM, distanceUnit, toDisplayDistance(totals.distanceM, distanceUnit) >= 100 ? 1 : 2)}</strong></div>
                <div className="plan-stat"><span>Balises</span><strong className="num">{route.waypoints.length - (looped ? 1 : 0)}</strong></div>
                <div className="plan-stat">
                  <span>Plus long bord</span>
                  <strong className="num">{legs.length > 0 ? formatDistance(Math.max(...legs.map((l) => l.distanceM)), distanceUnit) : '—'}</strong>
                </div>
              </div>
              {legs.length > 0 ? (
                <ol className="plan-course">
                  {legs.map((leg, i) => (
                    <li key={i} className="plan-course__leg">
                      <span>{pointLabel(i)} → {pointLabel(i + 1)}</span>
                      <span className="num">{formatDistance(leg.distanceM, distanceUnit)}</span>
                      <span className="num">{Math.round(leg.bearingDeg) % 360}°</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="plan-note">Touchez la carte pour poser le départ, puis les balises.</p>
              )}
              {guide && activity && (
                <div className="plan-beeps">
                  <div className="plan-beeps__head">
                    <p className="plan-note">
                      En navigation, chaque balise, départ compris, se valide à moins de {validationRadiusM(guide)} m. Bips dès{' '}
                      {beepStartM(guide)} m : {courseGuide
                        ? 'propres à ce parcours.'
                        : <>ceux de l'activité {activity.name}, réglés dans <Link to="/parametres">Réglages</Link>.</>}
                    </p>
                    <Button size="s" onClick={() => setBeepsOpen((o) => !o)} aria-expanded={beepsOpen}>
                      {beepsOpen ? 'Fermer' : 'Régler pour ce parcours'}
                    </Button>
                  </div>
                  {beepsOpen && activityGuide && (
                    <BeepCurveEditor value={guide} overridden={courseGuide !== null} fallback={activityGuide}
                      resetLabel="Comme l'activité" fallbackMark={`ceux de l'activité ${activity.name}`}
                      onChange={setCourseGuide} />
                  )}
                </div>
              )}
            </PlanBlock>
          ) : (
            <PlanBlock id="planning.profil" label="Général" open={open.profil} onToggle={() => toggle('profil')}>
              <div className={durationSettings ? 'plan-stats plan-stats--four' : 'plan-stats'}>
                {/* Au-delà de 100 km, une décimale : le chiffre tient dans sa case sur téléphone. */}
                <div className="plan-stat"><span>Distance</span><strong className="num">{formatDistance(totals.distanceM, distanceUnit, toDisplayDistance(totals.distanceM, distanceUnit) >= 100 ? 1 : 2)}</strong></div>
                <div className="plan-stat"><span>D+</span><strong className="num">{formatMeters(totals.gainM)}</strong></div>
                <div className="plan-stat"><span>D−</span><strong className="num">{formatMeters(totals.lossM)}</strong></div>
                {durationSettings && (
                  <div className="plan-stat">
                    <span>Temps</span>
                    <strong className="num">{durationS !== null ? `≈ ${formatDuration(durationS * 1000)}` : '—'}</strong>
                  </div>
                )}
              </div>

              {hasElevation && gradeRange ? (
                <div className="plan-profile" onMouseLeave={() => setHoveredIndex(null)}>
                  <ZoomableChart zoom={zoom} style={{ width: '100%', height: '170px' }}>
                    <ResponsiveContainer>
                      <AreaChart data={chartRows} onMouseMove={onChartHover} onTouchMove={onChartHover} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                        <ChartZoomProbe />
                        <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
                        <XAxis dataKey="dist" type="number" allowDataOverflow
                          domain={zoom.shown ? [zoom.shown.min, zoom.shown.max] : ['dataMin', 'dataMax']}
                          ticks={zoom.shown ? niceTicks(zoom.shown) : undefined}
                          tickFormatter={(v: number) => `${parseFloat(v.toFixed(3))} ${DISTANCE_UNIT_SYMBOL[distanceUnit]}`} tick={{ fill: '#555', fontSize: 11 }} />
                        <YAxis domain={['auto', 'auto']} width={44} tick={{ fill: '#e64a19', fontSize: 11 }} tickFormatter={(v) => `${v}`} />
                        <Tooltip
                          contentStyle={{ fontSize: '12px' }}
                          labelFormatter={(l) => `${parseFloat(Number(l).toFixed(2))} ${DISTANCE_UNIT_SYMBOL[distanceUnit]}`}
                          formatter={(value, _name, item) => {
                            const row: ChartRow | undefined = item.payload;
                            return [row?.grade != null ? `${value} m, pente ${Math.round(row.grade * 100)} %` : `${value} m`, 'Altitude'];
                          }} />
                        {gradeGradientDefs(gradientId, gradeStops)}
                        <Area type="monotone" dataKey="altitude" name="Altitude" stroke={`url(#${gradientId})`} strokeWidth={2}
                          fill={`url(#${gradientId})`} fillOpacity={0.35} dot={false} activeDot={{ r: 4 }} connectNulls={false}
                          isAnimationActive={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </ZoomableChart>
                  <div className="plan-legend">
                    <span>Pente, montée ou descente :</span>
                    {gradeRange.min > 0 && (
                      <>
                        <span className="plan-legend__swatch" style={{ backgroundColor: SLOW_COLOR }} />
                        <span>sous {Math.round(gradeRange.min * 100)} %,</span>
                      </>
                    )}
                    <span>{Math.round(gradeRange.min * 100)} %</span>
                    <span className="plan-legend__bar" style={{ background: gradientCss() }} />
                    <span>{Math.round(gradeRange.max * 100)} % et plus</span>
                    <Button size="s" aria-pressed={gradeOnMap} onClick={toggleGradeOnMap} style={{ marginLeft: 'auto' }}>
                      {gradeOnMap ? 'Masquer de la carte' : 'Voir sur la carte'}
                    </Button>
                  </div>
                  <div className="plan-legend">Pour zoomer : écartez deux doigts sur la courbe, ou tirez une zone à la souris.</div>
                </div>
              ) : (
                route.waypoints.length >= 2 && totals.pendingLegs === 0 && (
                  <p className="plan-note">Pas d'altitude sur ce tracé (lignes droites seulement) : pas de courbe de dénivelé.</p>
                )
              )}
              {durationSettings && pace && (
                <p className="plan-note">
                  Temps estimé au niveau {PACE_LEVEL_LABEL[pace.level].toLowerCase()}, {parseFloat((pace.flatSpeedMs * 3.6).toFixed(1))} km/h sur le plat
                  {durationSettings.family === 'course' ? ', chaque 100 m de D+ comptant 1 km' : ''} : à régler dans <Link to="/parametres">Réglages</Link>.
                </p>
              )}
            </PlanBlock>
          )}

          {!sailing && (
            <PlanBlock id="planning.surface" label="Surface" open={open.surface} onToggle={() => toggle('surface')}>
              {surfaces.totals.length > 0 ? (
                <SurfaceBar totals={surfaces.totals} distanceUnit={distanceUnit}
                  shownOnMap={surfaceOnMap} onToggleMap={toggleSurfaceOnMap} />
              ) : (
                <p className="plan-note">Le revêtement s'affiche dès le premier tronçon calculé.</p>
              )}
              {surfaces.pendingLegs > 0 && (
                <p className="plan-note">Tronçons en calcul : ils s'ajouteront une fois calculés.</p>
              )}
              {surfaces.missingLegs > 0 && (
                <div className="plan-surface__missing">
                  <p className="plan-note">
                    {surfaces.missingLegs > 1 ? `${surfaces.missingLegs} tronçons enregistrés` : 'Un tronçon enregistré'} avant
                    qu'on garde le revêtement : compté « Inconnu ». Le calculer de nouveau le donne, mais le tracé peut
                    changer si la carte a changé depuis.
                  </p>
                  <Button size="s" onClick={planner.recomputeSurfaces}>Calculer</Button>
                </div>
              )}
              <p className="plan-note">
                Revêtement des voies d'OpenStreetMap. Lignes droites et traces importées : « Inconnu ». « Voir sur la carte » y colore
                le tracé selon le revêtement.
              </p>
            </PlanBlock>
          )}

          <PlanBlock id="planning.trace" label="Tracé" open={open.trace} onToggle={() => toggle('trace')}
            aside={<HelpButton open={helpOpen} onToggle={() => setHelpOpen((o) => !o)} label="Comment planifier ?" size="s" />}>
            {helpOpen && sailing && (
              <ul className="plan-help">
                <li>Touchez la carte pour poser les balises : 1, puis 2, puis 3… Le départ est en vert, l'arrivée en rouge.</li>
                <li>Les balises sont reliées en ligne droite : sur l'eau, pas de chemin à suivre.</li>
                <li>Touchez le parcours pour insérer une balise entre deux autres ; faites glisser une balise pour la déplacer.</li>
                <li>Touchez une balise pour la retirer ; touchez la 1 pour boucler, retour au départ.</li>
                <li>« Précédent », sur la carte, défait la dernière modification. La liste des balises permet aussi de changer leur ordre.</li>
                <li>
                  En navigation (« Partir »), chaque balise, départ compris, se valide en passant près d'elle, avec des bips de plus en plus
                  rapides à l'approche ; « Passer » saute une balise. Distances, rythme et vibration se règlent dans Réglages.
                </li>
                <li>« Charger un GPX » reprend telle quelle une trace téléchargée ailleurs ; touchez-la pour y poser des balises.</li>
              </ul>
            )}
            {helpOpen && !sailing && (
              <ul className="plan-help">
                <li>Touchez la carte pour poser un point : A, puis B, puis C… Le départ est en vert, l'arrivée en rouge.</li>
                <li>Touchez le tracé pour insérer un point entre deux autres.</li>
                <li>Faites glisser un point pour le déplacer : seuls ses deux tronçons sont recalculés.</li>
                <li>Touchez un point pour le retirer, ou changer la façon d'y venir ; touchez A pour boucler, par les chemins ou en ligne droite.</li>
                <li>
                  « Boucle », au-dessus de la carte : posez l'aller, l'itinéraire revient toujours au départ. Le retour évite les voies de
                  l'aller tant qu'il ne dépasse pas {loopRatio ?? '—'} fois sa longueur (réglable dans Réglages) ; sinon, c'est le retour le
                  plus court. « Autre retour » en propose une variante ; touchez le retour pour y poser un point et le modeler. A reste le
                  départ : faites-le glisser pour le déplacer.
                </li>
                <li>« Précédent », sur la carte, défait la dernière modification.</li>
                <li>La liste des points permet aussi de changer leur ordre.</li>
                <li>
                  Les types de voie cochés au-dessus de la carte valent pour tout l'itinéraire, recalculé dès qu'on les change, et pour les points
                  suivants ; on peut en cocher plusieurs. Choisir une activité coche les siens, réglés dans sa carte de Réglages. Une trace importée
                  garde son tracé. Le calcul demande du réseau.
                </li>
                <li>
                  {WAY_TYPES.map((t, i) => (
                    <Fragment key={t}>
                      « {WAY_TYPE_LABEL[t]} » : {WAY_TYPE_HINT[t]}{i < WAY_TYPES.length - 1 ? ' ; ' : '. '}
                    </Fragment>
                  ))}
                  Une voie est rangée selon ce qu'elle est : une route en terre ou en gravier compte comme piste, une piste goudronnée comme route.
                </li>
                <li>
                  Le calcul suit les types cochés et prend les autres quand ils évitent un détour. À vélo, un type plus facile reste permis
                  (une route pour rejoindre une piste), un plus dur est évité d'autant plus qu'il est dur ; à pied, tous se valent.
                  Les grandes routes non cochées sont toujours évitées.
                </li>
                <li>
                  Les règles d'accès suivent l'activité : à pied, escaliers permis et sens interdits ignorés ; à vélo, sens interdits respectés,
                  et voies notées difficiles sur la carte (difficulté VTT 3 ou plus, randonnée T3 ou plus, escaliers) évitées même cochées.
                </li>
                <li>« Charger un GPX » reprend telle quelle une trace téléchargée ailleurs. Touchez-la pour y poser un point ; un point déplacé refait ses tronçons dans le mode choisi.</li>
              </ul>
            )}
            <div className="plan-actions">
              <Button size="s" onClick={planner.undo} disabled={!planner.canUndo}>
                <IconUndo size={16} />
                Précédent
              </Button>
              <Button size="s" onClick={planner.reverse} disabled={route.waypoints.length < 2}>Inverser</Button>
              {/* En mode « Boucle », l'itinéraire est toujours bouclé. */}
              {!loopOn && (
                <Button size="s" onClick={() => planner.closeLoop(editMode)} disabled={route.waypoints.length < 2 || looped}>Boucler</Button>
              )}
              {!loopOn && editMode !== 'straight' && (
                <Button size="s" onClick={() => planner.closeLoop('straight')} disabled={route.waypoints.length < 2 || looped}>
                  Boucler en ligne droite
                </Button>
              )}
              <label className="ui-btn ui-btn--secondary ui-btn--s">
                <IconFile size={16} />
                Charger un GPX
                {/* Sur le téléphone, pas de filtre : Android grise parfois les GPX. Le contenu est vérifié à la lecture. */}
                <input type="file" accept={isNativeApp() ? undefined : '.gpx'} hidden onChange={(e) => void loadGpx(e)} />
              </label>
              <Button size="s" variant="ghost" onClick={() => { planner.clear(); setSelected(null); }} disabled={route.waypoints.length === 0}>Tout effacer</Button>
            </div>
          </PlanBlock>

          <PlanBlock id="planning.points" label={`${sailing ? 'Balises' : 'Points'} (${route.waypoints.length})`} open={open.points} onToggle={() => toggle('points')}>
            {route.waypoints.length === 0 ? (
              <p className="plan-note">Aucun point : touchez la carte pour poser le départ.</p>
            ) : (
              <ol className="plan-points">
                {route.waypoints.map((_, i) => {
                  const leg = i > 0 ? route.legs[i - 1] : undefined;
                  const last = route.waypoints.length - 1;
                  // En mode « Boucle », A reste le départ et le retour, le dernier tronçon : ni l'un ni l'autre ne change de place.
                  const fixedLoop = loopOn && looped;
                  return (
                    <li key={i} className={selected === i ? 'plan-point plan-point--selected' : 'plan-point'}>
                      <button type="button" className="plan-point__main" onClick={() => selectPoint(i)}>
                        <span className="plan-point__dot" style={{ background: pointFill(i) }}>{pointLabel(i)}</span>
                        <span className="plan-point__text">
                          <strong>{i === 0 ? 'Départ' : i === last ? (looped ? 'Arrivée, retour au départ' : 'Arrivée') : pointName(i)}</strong>
                          <span className="num">
                            {i === 0
                              ? formatDistance(0, distanceUnit)
                              : `${formatDistance(distances[i].cumulativeM, distanceUnit)} · tronçon ${formatDistance(distances[i].legM, distanceUnit)}`}
                          </span>
                          {leg && !sailing && <span className="plan-point__mode">{routeModeLabel(leg.mode)}</span>}
                        </span>
                      </button>
                      {!(fixedLoop && i === last) && (
                        <span className="plan-point__actions">
                          <Button size="s" variant="ghost" className="plan-point__move" aria-label={`Monter : ${pointName(i)}`}
                            disabled={i === 0 || (fixedLoop && i === 1)} onClick={() => { planner.reorder(i, i - 1, editMode); setSelected(null); }}>
                            <IconChevronRight size={16} style={{ transform: 'rotate(-90deg)' }} />
                          </Button>
                          <Button size="s" variant="ghost" className="plan-point__move" aria-label={`Descendre : ${pointName(i)}`}
                            disabled={i === last || (fixedLoop && (i === 0 || i === last - 1))}
                            onClick={() => { planner.reorder(i, i + 1, editMode); setSelected(null); }}>
                            <IconChevronRight size={16} style={{ transform: 'rotate(90deg)' }} />
                          </Button>
                          <Button size="s" variant="ghost" onClick={() => { planner.remove(i, editMode); setSelected(null); }}>Retirer</Button>
                        </span>
                      )}
                      {leg?.status === 'error' && <p className="plan-point__error">{leg.error}</p>}
                      {leg?.status === 'pending' && <p className="plan-point__pending">Calcul du tronçon…</p>}
                    </li>
                  );
                })}
              </ol>
            )}
          </PlanBlock>

          <PlanBlock id="planning.ranger" label={current ? 'Itinéraire enregistré' : 'Enregistrer l\'itinéraire'} open={open.ranger} onToggle={() => toggle('ranger')}>
            <div className="plan-form">
              <label className="plan-form__field">
                <span className="ui-eyebrow">Nom</span>
                <input className="ui-field" value={name} placeholder={defaultName()} onChange={(e) => setName(e.target.value)} />
              </label>
            </div>
            {!library.canSave && (
              <div className="ui-alert ui-alert--warning">Aucun dossier mémoire : choisissez-le dans Réglages pour enregistrer vos itinéraires.</div>
            )}
            {current?.readOnly && (
              <div className="ui-alert ui-alert--warning">Cet itinéraire vient d'une version plus récente de l'application : il se consulte sans se modifier.</div>
            )}
            <div className="plan-actions">
              <Button variant="primary" onClick={() => void handleSave()} disabled={!canSave || (current !== null && !dirty)}>
                {saving ? 'Enregistrement…' : current ? 'Enregistrer les modifications' : 'Enregistrer'}
              </Button>
              {current !== null && (
                <Button variant="record" onClick={() => go(current)} disabled={dirty || !canGo}
                  title={dirty ? "Enregistrez d'abord les modifications" : canGo ? undefined : 'Un enregistrement est en cours'}>
                  Partir
                </Button>
              )}
              {canDownloadFiles() && (
                <Button onClick={exportGpx} disabled={route.waypoints.length < 2}>Exporter le GPX</Button>
              )}
              {(current !== null || route.waypoints.length > 0) && <Button variant="ghost" onClick={startNew}>Nouvel itinéraire</Button>}
              {current !== null && (confirmingDelete === current.base ? (
                <>
                  <Button variant="danger" onClick={() => void deleteSaved(current)}>Supprimer définitivement</Button>
                  <Button variant="ghost" onClick={() => setConfirmingDelete(null)}>Garder</Button>
                </>
              ) : (
                <Button variant="danger" onClick={() => setConfirmingDelete(current.base)}>Supprimer l'itinéraire</Button>
              ))}
            </div>
            {message && <p className="plan-note">{message}</p>}
            {!canDownloadFiles() && (
              <p className="plan-note">Le GPX est enregistré avec l'itinéraire, dans le dossier Tracker/{ROUTES_DIR}, pour l'emporter dans une autre application.</p>
            )}
          </PlanBlock>

          <PlanBlock id="planning.liste" label={`Mes itinéraires (${library.routes.length})`} open={open.liste} onToggle={() => toggle('liste')}>
            {library.error && <div className="ui-alert ui-alert--danger">{library.error}</div>}
            {library.routes.length === 0 ? (
              <p className="plan-note">Aucun itinéraire enregistré pour l'instant.</p>
            ) : (
              <RouteList
                routes={library.routes}
                activities={activities}
                onOpen={openSaved}
                currentBase={current?.base ?? null}
                go={false}
                actions={(saved) => (confirmingDelete === saved.base ? (
                  <span className="plan-saved__confirm">
                    <Button size="s" variant="danger" onClick={() => void deleteSaved(saved)}>Supprimer</Button>
                    <Button size="s" variant="ghost" onClick={() => setConfirmingDelete(null)}>Garder</Button>
                  </span>
                ) : (
                  <Button size="s" variant="ghost" onClick={() => setConfirmingDelete(saved.base)} aria-label={`Supprimer ${saved.record.name}`}>Supprimer</Button>
                ))} />
            )}
          </PlanBlock>
        </div>
      </div>
    </div>
  );
}

export default PlanningPage;
