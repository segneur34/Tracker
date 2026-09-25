import { Fragment, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import L from 'leaflet';
import { CircleMarker, MapContainer, Marker, Polyline, useMapEvents } from 'react-leaflet';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import 'leaflet/dist/leaflet.css';
import './PlanningPage.css';
import MapAutoResize from '../components/MapAutoResize';
import OsmTileLayer from '../components/OsmTileLayer';
import PanelTitle from '../components/PanelTitle';
import ResizablePanel from '../components/ResizablePanel';
import { hoveredTrackIndex, type ChartHoverEvent } from '../components/chartHover';
import { gradeGradientDefs } from '../components/gradeGradientDefs';
import { IconChevronRight } from '../components/icons';
import { CARD_STYLE } from '../components/styles';
import Button from '../components/ui/Button';
import HelpButton from '../components/ui/HelpButton';
import PageHeader from '../components/ui/PageHeader';
import { findActivity, type Activity } from '../core/activities';
import { CHART_MAX_POINTS, DEFAULT_MAP_CENTER, trackBounds } from '../core/displayConfig';
import { ELEVATION_PRESETS } from '../core/sportProfiles';
import { SLOW_COLOR, gradientCss } from '../core/speedGradient';
import { DISTANCE_UNIT_SYMBOL, formatDistance, toDisplayDistance } from '../core/units';
import { useLeaveWarning } from '../hooks/leaveGuard';
import { useOpenSections } from '../hooks/useOpenSections';
import { usePlannedRoute } from '../hooks/usePlannedRoute';
import { getLastFix, useRecorder } from '../hooks/useRecorder';
import { useRouteLibrary, type SavedRoute } from '../hooks/useRouteLibrary';
import {
  effectiveDistanceUnit, effectiveElevationProfile, effectiveGradeRange, lastRecordActivity, readStoredActivities,
} from '../hooks/useSportSettings';
import { ROUTES_DIR } from '../library/folderLayout';
import { searchPlaces, type Place } from '../planning/geocoding';
import {
  EMPTY_ROUTE, ROUTE_MODES, ROUTE_MODE_LABEL, isLooped, isRouteMode, routePoints, routeProfileRows, routeTotals, waypointDistances,
  type PlannedRoute, type RouteMode, type Waypoint,
} from '../planning/route';
import { buildRouteGpx, waypointLabel } from '../planning/routeGpx';
import { recordToRoute } from '../planning/routeRecord';
import { gradeGradientStops } from '../running/runningAnalytics';
import { canDownloadFiles, downloadTextFile } from '../platform/files';
import { currentPosition } from '../platform/location';
import { jsonStore } from '../platform/storage';

/**
 * Planification d'un itinéraire : on pose des points sur la carte, chaque
 * tronçon entre deux points suit les chemins (à pied, à vélo, en VTT) ou va
 * en ligne droite. Distance, dénivelés et profil d'altitude se mettent à jour
 * à chaque calcul. L'itinéraire se range dans `itineraires/` du dossier
 * mémoire, avec son GPX.
 *
 * Le calcul demande du réseau (`planning/brouter.ts`) ; un itinéraire rangé se
 * rouvre sans. On y arrive depuis l'accueil (« Planifier ») et, sur
 * ordinateur, depuis la barre du haut.
 */

/** Préférences de la page sur l'appareil : derniers mode et activité choisis, dernière vue de la carte. */
const PREFS_KEY = 'tracker.planning';

interface PlanningPrefs {
  mode?: RouteMode;
  activityId?: string;
  view?: { lat: number; lon: number; zoom: number };
}

const readPrefs = (): PlanningPrefs => jsonStore.read<PlanningPrefs>(PREFS_KEY) ?? {};
const writePrefs = (patch: PlanningPrefs): void => jsonStore.write(PREFS_KEY, { ...readPrefs(), ...patch });

/** Tronçon en échec, sur la carte (donnée de carte, donc en dur). */
const ERROR_COLOR = '#c62828';
/** Couleur de repli si celle de l'activité n'est pas un code couleur. */
const FALLBACK_COLOR = '#6a1b9a';

const safeColor = (color: string): string => (/^#[0-9a-f]{3,8}$/i.test(color) ? color : FALLBACK_COLOR);

/** Repères des points, lettrés, gardés d'un rendu à l'autre : Leaflet ne les redessine que s'ils changent. */
const iconCache = new Map<string, L.DivIcon>();
const waypointIcon = (label: string, color: string, selected: boolean): L.DivIcon => {
  const key = `${label}|${color}|${selected}`;
  let icon = iconCache.get(key);
  if (!icon) {
    icon = L.divIcon({
      className: 'plan-marker',
      html: `<span class="plan-marker__dot${selected ? ' plan-marker__dot--selected' : ''}" style="background:${color}">${label}</span>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
    iconCache.set(key, icon);
  }
  return icon;
};

const toWaypoint = (latlng: L.LatLng): Waypoint => ({ lat: latlng.lat, lon: latlng.lng });

/** Toucher de la carte, et vue retenue pour la prochaine ouverture. */
function MapEvents({ onTap }: { onTap: (w: Waypoint) => void }) {
  useMapEvents({
    click: (e) => onTap(toWaypoint(e.latlng)),
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

/** Aucune action à mener en quittant : l'itinéraire non rangé est simplement abandonné. */
const noop = () => {};

interface ChartRow {
  index: number;
  dist: number;
  altitude: number | null;
  grade: number | null;
}

type PlanningSection = 'trace' | 'points' | 'ranger' | 'liste';

const PLANNING_SECTION_DEFAULTS: Record<PlanningSection, boolean> = {
  trace: true,
  points: true,
  ranger: true,
  liste: true,
};

/**
 * Bloc du panneau, replié ou déplié par son titre (état mémorisé). Ouvert, il
 * se redimensionne en hauteur sur ordinateur (`ResizablePanel`, taille
 * mémorisée sous `id`, à ne pas renommer) ; replié, il ne garde que son titre.
 */
function PlanBlock({ id, label, open, onToggle, aside, children }: {
  id: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const head = (
    <div className="plan-block__head">
      <PanelTitle label={label} open={open} onToggle={onToggle} />
      {aside}
    </div>
  );
  if (!open) return <section style={CARD_STYLE}>{head}</section>;
  return (
    <ResizablePanel id={id} direction="vertical" minHeight={80} style={CARD_STYLE}>
      {head}
      {children}
    </ResizablePanel>
  );
}

function PlanningPage() {
  const [activities] = useState<Activity[]>(readStoredActivities);
  const [activityId, setActivityIdState] = useState<string | null>(
    () => findActivity(activities, readPrefs().activityId)?.id ?? (lastRecordActivity() ?? activities[0])?.id ?? null
  );
  const setActivityId = (id: string) => {
    setActivityIdState(id);
    writePrefs({ activityId: id });
  };
  const activity = findActivity(activities, activityId) ?? activities[0] ?? null;
  const distanceUnit = activity ? effectiveDistanceUnit(activity) : 'km';
  const minGainM = (activity ? effectiveElevationProfile(activity) : ELEVATION_PRESETS.route).minGainM;
  const gradeRange = useMemo(() => (activity ? effectiveGradeRange(activity) : null), [activity]);
  const color = safeColor(activity?.color ?? FALLBACK_COLOR);

  const [mode, setModeChoice] = useState<RouteMode>(() => {
    const stored = readPrefs().mode;
    return isRouteMode(stored) ? stored : 'foot';
  });
  const chooseMode = (next: RouteMode) => {
    setModeChoice(next);
    writePrefs({ mode: next });
  };

  const planner = usePlannedRoute();
  const { route } = planner;
  const library = useRouteLibrary();

  const [map, setMap] = useState<L.Map | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const { open, toggle } = useOpenSections<PlanningSection>('planning', PLANNING_SECTION_DEFAULTS);

  // Itinéraire rangé en cours d'édition, et l'état rangé, pour savoir s'il a changé.
  const [current, setCurrent] = useState<SavedRoute | null>(null);
  const [savedRoute, setSavedRoute] = useState<PlannedRoute>(EMPTY_ROUTE);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

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

  const points = useMemo(() => routePoints(route), [route]);
  const totals = useMemo(() => routeTotals(route, minGainM), [route, minGainM]);
  const firstError = route.legs.find((l) => l.status === 'error')?.error ?? null;
  const distances = useMemo(() => waypointDistances(route), [route]);
  const looped = isLooped(route);
  /** Lettre d'un point ; sur une boucle, l'arrivée est le départ : A. */
  const pointLabel = (i: number) => waypointLabel(looped && i === route.waypoints.length - 1 ? 0 : i);

  const dirty = current !== null
    ? route !== savedRoute || name.trim() !== current.record.name || (activity?.id ?? null) !== current.record.activityId
    : route.waypoints.length > 0;
  useLeaveWarning(dirty ? { message: 'L\'itinéraire en cours n\'est pas rangé. Quitter quand même ?', discard: noop } : null);

  // --- Profil d'altitude ---

  /** Profil à pas régulier ; ses lignes portent la position du repère de survol sur la carte. */
  const profile = useMemo(() => routeProfileRows(points), [points]);
  const chartRows = useMemo<ChartRow[]>(() => {
    const step = Math.max(1, Math.ceil(profile.length / CHART_MAX_POINTS));
    const out: ChartRow[] = [];
    for (let i = 0; i < profile.length; i += step) {
      const row = profile[i];
      out.push({
        index: i,
        dist: parseFloat(toDisplayDistance(row.distM, distanceUnit).toFixed(2)),
        altitude: row.eleM !== null ? Math.round(row.eleM) : null,
        grade: row.grade,
      });
    }
    return out;
  }, [profile, distanceUnit]);
  const gradeStops = useMemo(
    () => (gradeRange ? gradeGradientStops(chartRows.filter((r) => r.altitude !== null), gradeRange) : []),
    [chartRows, gradeRange]
  );
  const gradientId = `${useId()}-profil`;
  const hasElevation = totals.gainM !== null && chartRows.some((r) => r.altitude !== null);
  const hovered = hoveredIndex !== null ? profile[hoveredIndex] : undefined;

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
    planner.add(w, mode);
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
    map?.setView([place.lat, place.lon], Math.max(map.getZoom(), 15));
  };

  const locate = async () => {
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

  // --- Rangement ---

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const finalName = name.trim() || defaultName();
      const saved = await library.save(route, { name: finalName, activityId: activity?.id ?? null }, current ?? undefined);
      setCurrent(saved);
      setSavedRoute(route);
      setName(finalName);
      setMessage(`Rangé dans ${ROUTES_DIR}/${saved.base}.json, avec son GPX.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Rangement impossible.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDiscard = () => !dirty || window.confirm('L\'itinéraire en cours n\'est pas rangé. L\'abandonner ?');

  const openSaved = (saved: SavedRoute) => {
    if (!confirmDiscard()) return;
    const opened = recordToRoute(saved.record);
    planner.replace(opened);
    setCurrent(saved);
    setSavedRoute(opened);
    setName(saved.record.name);
    if (saved.record.activityId && findActivity(activities, saved.record.activityId)) setActivityId(saved.record.activityId);
    setSelected(null);
    setMessage(null);
    fitTo(opened);
  };

  const startNew = () => {
    if (!confirmDiscard()) return;
    planner.replace(EMPTY_ROUTE);
    setCurrent(null);
    setSavedRoute(EMPTY_ROUTE);
    setName('');
    setSelected(null);
    setMessage(null);
  };

  /** Supprime un itinéraire rangé ; celui qui est ouvert laisse la place à une carte vide. */
  const deleteSaved = async (saved: SavedRoute) => {
    setConfirmingDelete(null);
    try {
      await library.remove(saved);
      if (current?.base === saved.base) {
        planner.replace(EMPTY_ROUTE);
        setCurrent(null);
        setSavedRoute(EMPTY_ROUTE);
        setName('');
        setSelected(null);
        setMessage('Itinéraire supprimé.');
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Suppression impossible.');
    }
  };

  const exportGpx = () => {
    const fileName = `${current?.base ?? (name.trim() || defaultName()).replace(/[\\/:*?"<>|]/g, ' ')}.gpx`;
    downloadTextFile(fileName, buildRouteGpx(route, name.trim() || defaultName()));
  };

  /** Distance de chaque itinéraire rangé, dans l'unité de l'activité en cours. */
  const savedDistances = useMemo(
    () => new Map(library.routes.map((s) => [s.base, routeTotals(recordToRoute(s.record), minGainM).distanceM])),
    [library.routes, minGainM]
  );

  const selectedLeg = selected !== null && selected > 0 ? route.legs[selected - 1] : undefined;
  const canSave = library.canSave && route.waypoints.length >= 2 && !saving && !current?.readOnly;

  return (
    <div className="ui-page ui-page--wide plan-page">
      <PageHeader
        title="Itinéraires"
        back={{ to: '/', label: 'Accueil' }}
        subtitle="Posez des points sur la carte : le tracé suit les chemins entre eux." />

      <div className="plan-layout">
        <div className="plan-map-col">
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
              <MapEvents onTap={onMapTap} />
              {route.legs.map((leg, i) => {
                const positions = leg.points.map((p) => [p.lat, p.lon] as [number, number]);
                const style = leg.status === 'ready'
                  // dashArray explicite : Leaflet garderait sinon le pointillé du tronçon en attente.
                  ? { color, weight: 5, opacity: 0.9, dashArray: undefined }
                  : { color: leg.status === 'error' ? ERROR_COLOR : color, weight: 4, opacity: leg.status === 'error' ? 0.9 : 0.55, dashArray: '6 8' };
                return (
                  <Fragment key={i}>
                    <Polyline positions={positions} pathOptions={{ ...style, interactive: false }} />
                    {/* Trait invisible et large : le toucher qui insère un point n'a pas à viser un trait de 5 px. */}
                    <Polyline
                      positions={positions}
                      pathOptions={{ color, weight: 24, opacity: 0, bubblingMouseEvents: false }}
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
                  icon={waypointIcon(waypointLabel(i), color, selected === i)}
                  eventHandlers={{
                    click: () => {
                      setCandidate(null);
                      setSelected(i);
                    },
                    dragend: (e) => planner.move(i, toWaypoint((e.target as L.Marker).getLatLng())),
                  }} />
              ))}
              {candidate && (
                <CircleMarker center={[candidate.lat, candidate.lon]} radius={9}
                  pathOptions={{ color: '#ffffff', weight: 3, fillColor: color, fillOpacity: 0.6 }} />
              )}
              {hovered && (
                <CircleMarker center={[hovered.lat, hovered.lon]} radius={7}
                  pathOptions={{ color: '#1b1f24', weight: 3, fillColor: '#ffffff', fillOpacity: 1 }} />
              )}
            </MapContainer>
            <Button size="s" className="plan-locate" onClick={() => void locate()} disabled={locating}>
              {locating ? 'Recherche…' : 'Ma position'}
            </Button>

            {selected !== null && route.waypoints[selected] && (
              <div className="plan-overlay">
                <strong>Point {pointLabel(selected)}</strong>
                {selectedLeg && (
                  <label className="plan-overlay__field">
                    <span>Pour y venir</span>
                    <select
                      className="ui-field ui-field--s"
                      value={selectedLeg.mode}
                      onChange={(e) => isRouteMode(e.target.value) && planner.setMode(selected - 1, e.target.value)}>
                      {ROUTE_MODES.map((m) => <option key={m} value={m}>{ROUTE_MODE_LABEL[m]}</option>)}
                    </select>
                  </label>
                )}
                {selected === 0 && route.waypoints.length >= 2 && !looped && (
                  <Button size="s" variant="primary" onClick={() => { planner.loop(mode); setSelected(null); }}>Boucler ici</Button>
                )}
                <Button size="s" variant="danger" onClick={() => { planner.remove(selected); setSelected(null); }}>Retirer</Button>
                <button type="button" className="plan-overlay__close" aria-label="Fermer" onClick={() => setSelected(null)}>×</button>
                {selectedLeg?.status === 'error' && <p className="plan-overlay__error">{selectedLeg.error}</p>}
              </div>
            )}
            {candidate && (
              <div className="plan-overlay">
                <span className="plan-overlay__place"><strong>{candidate.label}</strong>{candidate.detail && ` · ${candidate.detail}`}</span>
                <Button size="s" variant="primary" onClick={() => { planner.add(candidate, mode); setCandidate(null); }}>Ajouter ce point</Button>
                <button type="button" className="plan-overlay__close" aria-label="Fermer" onClick={() => setCandidate(null)}>×</button>
              </div>
            )}
          </ResizablePanel>
        </div>

        <div className="plan-panel">
          <PlanBlock id="planning.trace" label="Tracé" open={open.trace} onToggle={() => toggle('trace')}
            aside={<HelpButton open={helpOpen} onToggle={() => setHelpOpen((o) => !o)} label="Comment planifier ?" size="s" />}>
            {helpOpen && (
              <ul className="plan-help">
                <li>Touchez la carte pour poser un point : A, puis B, puis C…</li>
                <li>Touchez le tracé pour insérer un point entre deux autres.</li>
                <li>Faites glisser un point pour le déplacer : seuls ses deux tronçons sont recalculés.</li>
                <li>Touchez un point pour le retirer, ou changer la façon d'y venir ; touchez A pour boucler.</li>
                <li>La liste des points permet aussi de changer leur ordre.</li>
                <li>Le mode choisi ci-dessous vaut pour les points suivants. Le calcul demande du réseau.</li>
              </ul>
            )}
            <div className="ui-tabs plan-modes" role="group" aria-label="Mode de calcul"
              style={{ '--tab-accent': color } as React.CSSProperties}>
              {ROUTE_MODES.map((m) => (
                <button key={m} type="button" className="ui-tab" aria-pressed={mode === m} onClick={() => chooseMode(m)}>
                  {ROUTE_MODE_LABEL[m]}
                </button>
              ))}
            </div>
            <div className="plan-actions">
              <Button size="s" onClick={planner.undo} disabled={!planner.canUndo}>Annuler</Button>
              <Button size="s" onClick={planner.reverse} disabled={route.waypoints.length < 2}>Inverser</Button>
              <Button size="s" onClick={() => planner.loop(mode)} disabled={route.waypoints.length < 2 || looped}>Boucler</Button>
              <Button size="s" variant="ghost" onClick={() => { planner.clear(); setSelected(null); }} disabled={route.waypoints.length === 0}>Tout effacer</Button>
            </div>
            {totals.pendingLegs > 0 && (
              <div className="plan-status">Calcul du tracé… ({totals.pendingLegs} tronçon{totals.pendingLegs > 1 ? 's' : ''})</div>
            )}
            {firstError && (
              <div className="ui-alert ui-alert--warning plan-error">
                <span>{totals.errorLegs > 1 ? `${totals.errorLegs} tronçons en ligne droite. ` : ''}{firstError}</span>
                <Button size="s" onClick={planner.retry}>Réessayer</Button>
              </div>
            )}

            <div className="plan-stats">
              <div className="plan-stat"><span>Distance</span><strong className="num">{formatDistance(totals.distanceM, distanceUnit)}</strong></div>
              <div className="plan-stat"><span>D+</span><strong className="num">{formatMeters(totals.gainM)}</strong></div>
              <div className="plan-stat"><span>D−</span><strong className="num">{formatMeters(totals.lossM)}</strong></div>
            </div>

            {hasElevation && gradeRange && (
              <div className="plan-profile" onMouseLeave={() => setHoveredIndex(null)}>
                <div style={{ width: '100%', height: '160px' }}>
                  <ResponsiveContainer>
                    <AreaChart data={chartRows} onMouseMove={onChartHover} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
                      <XAxis dataKey="dist" type="number" domain={['dataMin', 'dataMax']}
                        tickFormatter={(v) => `${v} ${DISTANCE_UNIT_SYMBOL[distanceUnit]}`} tick={{ fill: '#555', fontSize: 11 }} />
                      <YAxis domain={['auto', 'auto']} width={44} tick={{ fill: '#e64a19', fontSize: 11 }} tickFormatter={(v) => `${v}`} />
                      <Tooltip
                        contentStyle={{ fontSize: '12px' }}
                        labelFormatter={(l) => `${l} ${DISTANCE_UNIT_SYMBOL[distanceUnit]}`}
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
                </div>
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
                </div>
              </div>
            )}
          </PlanBlock>

          <PlanBlock id="planning.points" label={`Points (${route.waypoints.length})`} open={open.points} onToggle={() => toggle('points')}>
            {route.waypoints.length === 0 ? (
              <p className="plan-note">Aucun point : touchez la carte pour poser le départ.</p>
            ) : (
              <ol className="plan-points">
                {route.waypoints.map((_, i) => {
                  const leg = i > 0 ? route.legs[i - 1] : undefined;
                  const last = route.waypoints.length - 1;
                  return (
                    <li key={i} className={selected === i ? 'plan-point plan-point--selected' : 'plan-point'}>
                      <button type="button" className="plan-point__main" onClick={() => selectPoint(i)}>
                        <span className="plan-point__dot" style={{ background: color }}>{pointLabel(i)}</span>
                        <span className="plan-point__text">
                          <strong>{i === 0 ? 'Départ' : i === last ? (looped ? 'Arrivée, retour au départ' : 'Arrivée') : `Point ${waypointLabel(i)}`}</strong>
                          <span className="num">
                            {i === 0
                              ? formatDistance(0, distanceUnit)
                              : `${formatDistance(distances[i].cumulativeM, distanceUnit)} · tronçon ${formatDistance(distances[i].legM, distanceUnit)}`}
                          </span>
                        </span>
                      </button>
                      <span className="plan-point__actions">
                        {leg && (
                          <select
                            className="ui-field ui-field--s"
                            aria-label={`Façon de venir au point ${waypointLabel(i)}`}
                            value={leg.mode}
                            onChange={(e) => isRouteMode(e.target.value) && planner.setMode(i - 1, e.target.value)}>
                            {ROUTE_MODES.map((m) => <option key={m} value={m}>{ROUTE_MODE_LABEL[m]}</option>)}
                          </select>
                        )}
                        <Button size="s" variant="ghost" className="plan-point__move" aria-label={`Monter le point ${waypointLabel(i)}`}
                          disabled={i === 0} onClick={() => { planner.reorder(i, i - 1); setSelected(null); }}>
                          <IconChevronRight size={16} style={{ transform: 'rotate(-90deg)' }} />
                        </Button>
                        <Button size="s" variant="ghost" className="plan-point__move" aria-label={`Descendre le point ${waypointLabel(i)}`}
                          disabled={i === last} onClick={() => { planner.reorder(i, i + 1); setSelected(null); }}>
                          <IconChevronRight size={16} style={{ transform: 'rotate(90deg)' }} />
                        </Button>
                        <Button size="s" variant="ghost" onClick={() => { planner.remove(i); setSelected(null); }}>Retirer</Button>
                      </span>
                      {leg?.status === 'error' && <p className="plan-point__error">{leg.error}</p>}
                      {leg?.status === 'pending' && <p className="plan-point__pending">Calcul du tronçon…</p>}
                    </li>
                  );
                })}
              </ol>
            )}
          </PlanBlock>

          <PlanBlock id="planning.ranger" label={current ? 'Itinéraire rangé' : 'Ranger l\'itinéraire'} open={open.ranger} onToggle={() => toggle('ranger')}>
            <div className="plan-form">
              <label className="plan-form__field">
                <span className="ui-eyebrow">Nom</span>
                <input className="ui-field" value={name} placeholder={defaultName()} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="plan-form__field">
                <span className="ui-eyebrow">Activité</span>
                <select className="ui-field" value={activity?.id ?? ''} onChange={(e) => setActivityId(e.target.value)}>
                  {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            </div>
            {!library.canSave && (
              <div className="ui-alert ui-alert--warning">Aucun dossier mémoire : choisissez-le dans Réglages pour ranger vos itinéraires.</div>
            )}
            {current?.readOnly && (
              <div className="ui-alert ui-alert--warning">Cet itinéraire vient d'une version plus récente de l'application : il se consulte sans se modifier.</div>
            )}
            <div className="plan-actions">
              <Button variant="primary" onClick={() => void handleSave()} disabled={!canSave || (current !== null && !dirty)}>
                {saving ? 'Rangement…' : current ? 'Ranger les modifications' : 'Ranger'}
              </Button>
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
              <p className="plan-note">Le GPX est rangé avec l'itinéraire, dans le dossier Tracker/{ROUTES_DIR}, pour l'emporter dans une autre application.</p>
            )}
          </PlanBlock>

          <PlanBlock id="planning.liste" label={`Mes itinéraires (${library.routes.length})`} open={open.liste} onToggle={() => toggle('liste')}>
            {library.error && <div className="ui-alert ui-alert--danger">{library.error}</div>}
            {library.routes.length === 0 ? (
              <p className="plan-note">Aucun itinéraire rangé pour l'instant.</p>
            ) : (
              <ul className="plan-saved">
                {library.routes.map((saved) => (
                  <li key={saved.base} className={current?.base === saved.base ? 'plan-saved__item plan-saved__item--current' : 'plan-saved__item'}>
                    <button type="button" className="plan-saved__open" onClick={() => openSaved(saved)}>
                      <strong>{saved.record.name}</strong>
                      <span className="num">
                        {formatDistance(savedDistances.get(saved.base) ?? 0, distanceUnit)}
                        {' · '}
                        {new Date(saved.record.updatedAt).toLocaleDateString('fr-FR')}
                      </span>
                    </button>
                    {confirmingDelete === saved.base ? (
                      <span className="plan-saved__confirm">
                        <Button size="s" variant="danger" onClick={() => void deleteSaved(saved)}>Supprimer</Button>
                        <Button size="s" variant="ghost" onClick={() => setConfirmingDelete(null)}>Garder</Button>
                      </span>
                    ) : (
                      <Button size="s" variant="ghost" onClick={() => setConfirmingDelete(saved.base)} aria-label={`Supprimer ${saved.record.name}`}>Supprimer</Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </PlanBlock>
        </div>
      </div>
    </div>
  );
}

export default PlanningPage;
