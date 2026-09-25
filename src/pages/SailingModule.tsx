import { useCallback, useEffect, useState, useMemo, type ChangeEvent, type ReactNode } from 'react';
import { TileLayer, Polyline, Marker, CircleMarker, Popup } from 'react-leaflet';
import L from 'leaflet';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis, RadarChart, Radar,
  type DotItemDotProps, type TooltipPayloadEntry,
} from 'recharts';
import 'leaflet/dist/leaflet.css';
import './analysisMobile.css';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { analysisPath, libraryPath, useImportAndOpen, useSessionFromUrl } from '../hooks/useLibraryNavigation';
import { useSailingSession } from '../hooks/useSailingSession';
import { updateSessionRecord } from '../hooks/useSessionLibrary';
import { readStoredActivities } from '../hooks/useSportSettings';
import { useSessionDraft } from '../hooks/useSessionDraft';
import { useOpenSections } from '../hooks/useOpenSections';
import { trackBounds } from '../core/displayConfig';
import { sessionActivity } from '../core/activities';
import { isValidSpeedRange, speedGradientColor } from '../core/speedGradient';
import type { TopSegment } from '../core/types';
import type { LibrarySession } from '../library/record';
import { readPickedFile } from '../platform/files';
import { SPEED_UNIT_LABEL, knotsToMs, msToKnots } from '../core/units';
import { RATINGS, WATER_STATES, WIND_LEVELS } from '../sailing/sessionNotes';
import { MANEUVER_METRICS, type ManeuverMetric, type ManeuverTop, type WindGraphPoint } from '../sailing/sailingAnalytics';
import AnalysisMap from '../components/AnalysisMap';
import ResizablePanel from '../components/ResizablePanel';
import SectionTabs, { type SectionDefinition } from '../components/SectionTabs';
import { hoveredTrackIndex, type ChartHoverEvent } from '../components/chartHover';
import { CARD_STYLE } from '../components/styles';
import { IconFile } from '../components/icons';
import PanelTitle from '../components/PanelTitle';
import SessionNameEditor from '../components/SessionNameEditor';
import SessionSaveBar from '../components/SessionSaveBar';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';

/**
 * Sections du module. Pour en ajouter une : une entrée ici, une valeur par
 * défaut dans `SAILING_SECTION_DEFAULTS`, et un bloc `{open.maCle && (...)}`
 * dans le rendu.
 */
type SailingSection = 'global' | 'matos' | 'tops';

const SAILING_SECTIONS: SectionDefinition<SailingSection>[] = [
  { key: 'global', label: 'global' },
  { key: 'matos', label: 'matos et conditions' },
  { key: 'tops', label: 'tops' },
];

const SAILING_SECTION_DEFAULTS: Record<SailingSection, boolean> = {
  global: true,
  matos: false,
  tops: false,
};

/**
 * Second groupe d'onglets, ouvrables/fermables indépendamment du premier,
 * dans la colonne à droite de la carte. Manœuvres, VMG, graphiques et vent
 * ont tous été déplacés ici depuis les onglets du haut : ils n'existent
 * plus que là.
 */
type SailingCartePanel = 'manoeuvres' | 'vmg' | 'graphiques' | 'vent';

const SAILING_CARTE_PANELS: SectionDefinition<SailingCartePanel>[] = [
  { key: 'manoeuvres', label: 'manœuvres' },
  { key: 'vmg', label: 'vmg' },
  { key: 'graphiques', label: 'graphiques' },
  { key: 'vent', label: 'vent' },
];

const SAILING_CARTE_PANEL_DEFAULTS: Record<SailingCartePanel, boolean> = {
  manoeuvres: false,
  vmg: false,
  graphiques: false,
  vent: false,
};

// --- Utilitaires d'affichage ---

/** Courbe du vent : le trait et les points des manœuvres partagent la couleur. */
const WIND_COLOR = '#1565c0';

/**
 * Point visible aux seules manœuvres : ailleurs la courbe du vent n'est qu'une
 * interpolation, et le graphe compte jusqu'à 500 points.
 */
const maneuverDot = (props: DotItemDotProps): ReactNode => {
  // Recharts ne type pas la ligne derrière le point : c'est un `WindGraphPoint`.
  const point: WindGraphPoint | undefined = props.payload;
  if (!point?.isManeuver) return null;
  return <circle cx={props.cx} cy={props.cy} r={3} fill={WIND_COLOR} stroke="#fff" strokeWidth={1} />;
};

/** Infobulle des graphes de vitesse : la valeur suivie de l'unité. */
const knotsFormatter = (label: string) => (value: unknown): [string, string] => [`${value} nds`, label];

const createArrowIcon = (bearing: number) => {
  return L.divIcon({
    className: 'custom-arrow',
    html: `<svg width="12" height="12" viewBox="0 0 24 24" style="transform: rotate(${bearing}deg); display: block;">
             <path d="M12 0L24 24L12 18L0 24Z" fill="#222" stroke="#fff" stroke-width="2"/>
           </svg>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6]
  });
};

const hoverIcon = L.divIcon({
  className: 'custom-hover-icon',
  html: `<div style="width:16px;height:16px;background-color:#ff0000;border:3px solid #ffffff;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.6);"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

// --- Composants UI locaux ---

const Compass = ({ windAngle }: { windAngle: number }) => {
  const size = 120;
  const center = size / 2;
  return (
    <div style={{ position: 'relative', width: `${size}px`, height: `${size}px`, background: '#fff', borderRadius: '50%', border: '2px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', flexShrink: 0 }}>
      <span style={{position:'absolute', top: 3, fontSize: '10px', fontWeight: 'bold', color: 'var(--muted)', left: '50%', transform: 'translateX(-50%)'}}>N(0°)</span>
      <span style={{position:'absolute', bottom: 3, fontSize: '10px', fontWeight: 'bold', color: 'var(--muted)', left: '50%', transform: 'translateX(-50%)'}}>S(180°)</span>
      <span style={{position:'absolute', right: 3, fontSize: '10px', fontWeight: 'bold', color: 'var(--muted)', top: '50%', transform: 'translateY(-50%)'}}>E(90°)</span>
      <span style={{position:'absolute', left: 3, fontSize: '10px', fontWeight: 'bold', color: 'var(--muted)', top: '50%', transform: 'translateY(-50%)'}}>O(270°)</span>
      <svg width={size} height={size} style={{ position: 'absolute', transform: `rotate(${windAngle}deg)`, transition: 'transform 0.3s ease' }}>
        <line x1={center} y1={25} x2={center} y2={center} stroke="red" strokeWidth="3" />
        <polygon points={`${center - 5},${center - 10} ${center + 5},${center - 10} ${center},${center + 2}`} fill="red" />
      </svg>
    </div>
  );
};

/** Parties d'une session modifiées, en clair. */
function SailingModule() {
  // Session de la mémoire désignée par l'URL, et son brouillon : vent saisi, seuil
  // d'activité, allure imposée, couleurs et notes, écrits dans sa fiche par « Enregistrer la session ».
  const [searchParams] = useSearchParams();
  const requestedFile = searchParams.get('session');
  const draft = useSessionDraft(requestedFile);
  const { edits } = draft;

  const {
    trackData,
    stats,
    currentWindValue,
    autoWind,
    loadGpxContent,
    fileName,
    maneuverStats,
    maneuverSummary,
    vmgStats,
    windStats,
    speedGraphData,
    polarGraphData,
    windEstimate,
    windInputRequired,
    hasDeviceSpeed,
    loadError,
    sessionKey,
    activity,
    activityOptions,
    setActivity,
    profile,
    activeThresholdKn,
    defaultActiveThresholdKn,
    speedRange,
    suggestedSpeedRangeMs,
    referenceSpeedMs,
    samplingS,
    pointCount,
    maneuverThresholds,
  } = useSailingSession({
    windDeg: edits.windDeg,
    activeThresholdKn: edits.activeThreshold,
    referenceSpeedMs: edits.referenceSpeedMs,
  });

  // Session de la mémoire désignée par l'URL : son activité devient celle du module.
  const receiveSession = useCallback((content: string, session: LibrarySession) => {
    const recorded = sessionActivity(readStoredActivities(), session.record.activityId, session.record.sport);
    if (recorded && recorded.id !== activity.id) setActivity(recorded.id);
    loadGpxContent(content, session.file);
  }, [activity.id, setActivity, loadGpxContent]);
  const { file: sessionFile, error: sessionError } = useSessionFromUrl(receiveSession);

  // Un GPX ouvert ici entre d'abord dans la mémoire ; faute de mémoire, il est lu directement.
  const importAndOpen = useImportAndOpen('voile');
  const navigate = useNavigate();
  const openFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (await importAndOpen(file)) return;
    // Lu hors de la mémoire : ni la session de l'URL, ni le brouillon d'une autre trace (§10, point 31).
    if (requestedFile === null) draft.cancel();
    else navigate(analysisPath('voile'), { replace: true });
    loadGpxContent(await readPickedFile(file), file.name);
  };

  /**
   * Changer d'activité l'écrit aussi dans la fiche de la session. L'activité
   * de base d'un calcul n'est pas une activité de la liste : la fiche n'en
   * garde que le calcul.
   */
  const changeActivity = (id: string) => {
    const next = activityOptions.find((a) => a.id === id);
    if (!next) return;
    setActivity(next.id);
    const listed = readStoredActivities().some((a) => a.id === next.id);
    if (sessionFile) updateSessionRecord(sessionFile, { sport: next.base, activityId: listed ? next.id : null });
  };

  // Nombre de manœuvres recopié dans la fiche, pour la liste des sessions. Seulement quand un
  // vent est connu (sinon l'analyse des manœuvres est suspendue), et pour la trace de ce fichier.
  const maneuverCount = maneuverStats
    ? maneuverStats.tackSuccess + maneuverStats.tackFail + maneuverStats.jibeSuccess + maneuverStats.jibeFail
    : null;
  // Pas pendant un brouillon : la liste doit refléter l'état enregistré.
  const loadedFromMemory = sessionFile !== null && fileName === sessionFile && trackData.length > 0;
  const { dirty } = draft;
  useEffect(() => {
    if (loadedFromMemory && sessionFile && !dirty && currentWindValue !== null && maneuverCount !== null) {
      updateSessionRecord(sessionFile, { maneuverCount });
    }
  }, [loadedFromMemory, sessionFile, dirty, currentWindValue, maneuverCount]);

  const notes = edits.notes;
  const setNotes = draft.updateNotes;
  const { open, toggle } = useOpenSections<SailingSection>('sailing', SAILING_SECTION_DEFAULTS);
  const { open: carteOpen, toggle: toggleCarte } =
    useOpenSections<SailingCartePanel>('sailing-carte', SAILING_CARTE_PANEL_DEFAULTS);

  /** Bornes du dégradé de couleur de la trace, en m/s : celles de la session, sinon de Réglages, sinon la suggestion. */
  const colorRange = edits.speedRange ?? speedRange ?? suggestedSpeedRangeMs;

  const [showTacksOnMap, setShowTacksOnMap] = useState<boolean>(false);
  const [showJibesOnMap, setShowJibesOnMap] = useState<boolean>(false);
  const [selectedTopMap, setSelectedTopMap] = useState<string>('none');
  /** Podium de manœuvres affiché sur la carte : `tack:conservation`, `jibe:distance`, ou `none`. */
  const [selectedManeuverTop, setSelectedManeuverTop] = useState<string>('none');
  const [showManeuverDetails, setShowManeuverDetails] = useState<boolean>(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  /** Podium de manœuvres sélectionné pour la carte. */
  const maneuverTopArray = useMemo((): ManeuverTop[] => {
    if (selectedManeuverTop === 'none') return [];
    const [type, metric] = selectedManeuverTop.split(':') as ['tack' | 'jibe', ManeuverMetric];
    return maneuverSummary[type]?.tops[metric] ?? [];
  }, [selectedManeuverTop, maneuverSummary]);

  const staticMapLayers = useMemo(() => {
    if (trackData.length === 0) return null;

    const mapSegments = trackData.slice(1).map((point, index) => {
      const prevPoint = trackData[index];
      return {
        id: index,
        positions: [[prevPoint.lat, prevPoint.lon], [point.lat, point.lon]] as [[number, number], [number, number]],
        color: speedGradientColor(knotsToMs(point.smoothedSpeed), colorRange.minMs, colorRange.maxMs)
      };
    });

    const arrowMarkers = trackData.filter((_, index) => index % 40 === 0 && index !== 0);

    let topArray: TopSegment[] | undefined;
    if (selectedTopMap === 'vmgUpwind') topArray = vmgStats?.topsUpwind;
    else if (selectedTopMap === 'vmgDownwind') topArray = vmgStats?.topsDownwind;
    else topArray = stats?.tops[selectedTopMap as keyof typeof stats.tops];

    return (
      <>
        {mapSegments.map(segment => (
          <Polyline key={`track-${segment.id}`} positions={segment.positions} pathOptions={{ color: segment.color, weight: 5 }} />
        ))}

        {arrowMarkers.map((point, idx) => (
          <Marker key={`arrow-${idx}`} position={[point.lat, point.lon]} icon={createArrowIcon(point.bearing)} />
        ))}

        {maneuverStats?.locations.map((loc, idx) => {
          if ((loc.type === 'tack' && !showTacksOnMap) || (loc.type === 'jibe' && !showJibesOnMap)) return null;
          return (
            <CircleMarker
              key={`maneuver-${idx}`}
              center={[loc.lat, loc.lon]}
              radius={6}
              pathOptions={{
                color: loc.success ? '#388e3c' : '#d32f2f',
                fillColor: loc.type === 'tack' ? '#fff' : '#000',
                fillOpacity: 1,
                weight: 3
              }}>
              <Popup>{loc.type === 'tack' ? 'Virement' : 'Empannage'} {loc.success ? 'Réussi' : 'Raté'} - Vmin: {loc.vmin.toFixed(1)} nds</Popup>
            </CircleMarker>
          );
        })}

        {topArray?.map((top, idx) => {
          if (top.path.length === 0) return null;
          const highlightColor = idx === 0 ? '#d32f2f' : idx === 1 ? '#f57c00' : '#388e3c';
          return (
            <Polyline
              key={`top-${selectedTopMap}-${idx}`}
              positions={top.path}
              pathOptions={{ color: highlightColor, weight: 10, opacity: 0.8 }}
            />
          );
        })}

        {maneuverTopArray.map((top, idx) => {
          if (top.path.length < 2) return null;
          const highlightColor = idx === 0 ? '#d32f2f' : idx === 1 ? '#f57c00' : '#388e3c';
          return (
            <Polyline
              key={`maneuver-top-${selectedManeuverTop}-${idx}`}
              positions={top.path}
              pathOptions={{ color: highlightColor, weight: 10, opacity: 0.85 }}>
              <Popup>{idx + 1}{idx === 0 ? 'er' : 'e'} : {top.label}</Popup>
            </Polyline>
          );
        })}
      </>
    );
  }, [trackData, colorRange, maneuverStats, showTacksOnMap, showJibesOnMap, selectedTopMap, stats, vmgStats, maneuverTopArray, selectedManeuverTop]);

  const mapBounds = useMemo(() => trackBounds(trackData), [trackData]);

  /** Survol d'un graphe : déplace le marqueur de la carte sur le point de trace correspondant. */
  const onChartHover = (data: ReadonlyArray<{ index: number }>) => (e: ChartHoverEvent) => {
    const index = hoveredTrackIndex(e, data);
    if (index !== null && index !== hoveredIndex) setHoveredIndex(index);
  };

  const renderTop3 = (title: string, topKey: string, values: TopSegment[]) => (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
        <strong>{title}</strong>
        <button
          onClick={() => setSelectedTopMap(selectedTopMap === topKey ? 'none' : topKey)}
          style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer', backgroundColor: selectedTopMap === topKey ? 'var(--voile)' : 'var(--surface-sunken)', color: selectedTopMap === topKey ? '#fff' : 'var(--ink)', border: '1px solid var(--line-strong)', borderRadius: '4px' }}>
          {selectedTopMap === topKey ? 'Masquer (Carte)' : 'Voir (Carte)'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: '10px', fontSize: '13px', marginTop: '4px' }}>
        <span style={{ color: '#d32f2f', fontWeight: 'bold' }}>1er: {values[0]?.val || "-"}</span>
        <span style={{ color: '#f57c00', fontWeight: 'bold' }}>2e: {values[1]?.val || "-"}</span>
        <span style={{ color: '#388e3c', fontWeight: 'bold' }}>3e: {values[2]?.val || "-"}</span>
      </div>
    </div>
  );

  /** Panneaux VMG et manœuvres de la colonne à droite de la carte. */
  const renderVmgPanel = (v: NonNullable<typeof vmgStats>) => (
    <ResizablePanel id="sailing.carte.vmg" style={{ ...CARD_STYLE, flex: '1 1 500px' }}>
      <div style={{ marginBottom: '10px' }}>
        <PanelTitle label="Analyse VMG" open={carteOpen.vmg} onToggle={() => toggleCarte('vmg')} />
      </div>
      <table style={{ width: '100%', textAlign: 'center', borderCollapse: 'collapse', fontSize: '13px', backgroundColor: 'var(--surface)', border: '1px solid var(--line)' }}>
        <thead>
          <tr style={{ backgroundColor: 'var(--surface-sunken)', borderBottom: '1px solid var(--line-strong)' }}>
            <th>Allure</th>
            <th style={{ color: '#d32f2f' }}>Bâbord (Moy/Max)</th>
            <th style={{ color: '#388e3c' }}>Tribord (Moy/Max)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ textAlign: 'left', padding: '4px' }}>Près</td>
            <td>{v.upPort.avg} / <strong>{v.upPort.max}</strong></td>
            <td>{v.upStbd.avg} / <strong>{v.upStbd.max}</strong></td>
          </tr>
          <tr>
            <td style={{ textAlign: 'left', padding: '4px' }}>Portant</td>
            <td>{v.downPort.avg} / <strong>{v.downPort.max}</strong></td>
            <td>{v.downStbd.avg} / <strong>{v.downStbd.max}</strong></td>
          </tr>
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: '30px', marginTop: '15px', flexWrap: 'wrap' }}>
        <div>
          {renderTop3("Tops Près (10s)", "vmgUpwind", v.topsUpwind)}
        </div>
        <div>
          {renderTop3("Tops Portant (10s)", "vmgDownwind", v.topsDownwind)}
        </div>
      </div>
    </ResizablePanel>
  );

  const renderManeuversPanel = (m: NonNullable<typeof maneuverStats>) => (
    <ResizablePanel id={showManeuverDetails ? 'sailing.carte.manoeuvres.details' : 'sailing.carte.manoeuvres'} style={{ ...CARD_STYLE, flex: showManeuverDetails ? '1 1 100%' : '0 1 auto', padding: '12px 15px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <PanelTitle label="Manœuvres" open={carteOpen.manoeuvres} onToggle={() => toggleCarte('manoeuvres')} />
        <span style={{ color: 'var(--muted)', fontSize: '12px' }}>réussie si Vmin &ge; {activeThresholdKn} nds</span>
      </div>

      <div className="an-man-scroll">
      <table className="an-man-summary" style={{ borderCollapse: 'collapse', fontSize: '14px', backgroundColor: 'var(--surface)', border: '1px solid var(--line)', marginBottom: '10px' }}>
        <thead>
          <tr style={{ backgroundColor: 'var(--surface-sunken)' }}>
            <th style={{ textAlign: 'left', padding: '7px 14px' }}>Type</th>
            <th style={{ padding: '7px 14px' }}>Réussis</th>
            <th style={{ padding: '7px 14px' }}>Ratés</th>
            <th style={{ padding: '7px 14px' }} title="Vitesse minimale pendant la manœuvre, moyenne sur toutes les manœuvres">Vmin moy. (nds)</th>
            <th style={{ padding: '7px 14px' }} title="Meilleure vitesse minimale conservée sur une manœuvre">Vmin max (nds)</th>
            <th style={{ padding: '7px 10px' }}>Carte</th>
          </tr>
        </thead>
        <tbody>
          {([
            ['Virements', maneuverSummary.tack, showTacksOnMap, () => setShowTacksOnMap(!showTacksOnMap)],
            ['Empannages', maneuverSummary.jibe, showJibesOnMap, () => setShowJibesOnMap(!showJibesOnMap)],
          ] as const).map(([label, summary, shown, toggle]) => (
            <tr key={label} style={{ borderTop: '1px solid var(--line-soft)' }}>
              <td style={{ padding: '7px 14px', fontWeight: 'bold' }}>{label}</td>
              <td style={{ padding: '7px 14px', textAlign: 'center', color: '#388e3c', fontWeight: 'bold', fontSize: '16px' }}>{summary?.success ?? 0}</td>
              <td style={{ padding: '7px 14px', textAlign: 'center', color: '#d32f2f', fontSize: '16px' }}>{summary?.fail ?? 0}</td>
              <td style={{ padding: '7px 14px', textAlign: 'center' }}>{summary ? summary.vminAvg : '-'}</td>
              <td style={{ padding: '7px 14px', textAlign: 'center', fontWeight: 'bold' }}>{summary ? summary.vminMax : '-'}</td>
              <td style={{ padding: '4px 10px', textAlign: 'center' }}>
                <button onClick={toggle} title={`Afficher les ${label.toLowerCase()} sur la carte`} style={{ padding: '3px 10px', cursor: 'pointer', backgroundColor: shown ? 'var(--voile)' : 'var(--surface-sunken)', color: shown ? '#fff' : 'var(--ink)', border: 'none', borderRadius: '4px', fontSize: '12px' }}>
                  {shown ? 'Masquer' : 'Voir'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <p style={{ margin: '0 0 10px', padding: '8px', backgroundColor: 'var(--bg)', borderLeft: '3px solid var(--line-strong)', borderRadius: '4px', color: 'var(--ink-2)', fontSize: '12px', lineHeight: '1.6' }}>
        <strong>Enregistrement :</strong> {pointCount} points, un toutes les {samplingS < 10 ? samplingS.toFixed(1) : Math.round(samplingS)} s en médiane. Entrée de virage retenue au-dessus de {maneuverThresholds.minEntrySpeedKn.toFixed(1)} nds, d'après l'allure de la session.
        {samplingS > 10 && (
          <>
            {' '}Cadence économique : les manœuvres se lisent encore, mais leur qualité
            (Vmin, relance) et les tops courts reposent sur des moyennes de plusieurs
            dizaines de secondes.
          </>
        )}
      </p>

      {(m.rejected.unclassified > 0 ||
        m.rejected.slowEntry > 0 ||
        m.rejected.incoherent > 0 ||
        m.rejected.tooShort > 0) && (
        <p style={{ margin: '0 0 10px', padding: '8px', backgroundColor: 'var(--bg)', borderLeft: '3px solid var(--line-strong)', borderRadius: '4px', color: 'var(--ink-2)', fontSize: '12px', lineHeight: '1.6' }}>
          <strong>{m.locations.length} virage{m.locations.length > 1 ? 's' : ''} retenu{m.locations.length > 1 ? 's' : ''}</strong>, et d'autres écartés en chemin :
          {m.rejected.unclassified > 0 && (
            <>
              <br />
              <strong>{m.rejected.unclassified}</strong> franc{m.rejected.unclassified > 1 ? 's' : ''} et net{m.rejected.unclassified > 1 ? 's' : ''}, mais ni face au vent ni au vent arrière : ce sont des abattées ou des remontées — ou le vent retenu est faux, ce qui range tous les demi-tours au travers.
            </>
          )}
          {m.rejected.slowEntry > 0 && (
            <>
              <br />
              <strong>{m.rejected.slowEntry}</strong> entamé{m.rejected.slowEntry > 1 ? 's' : ''} trop lentement (moins de {maneuverThresholds.minEntrySpeedKn.toFixed(1)} nds à l'entrée).
            </>
          )}
          {m.rejected.incoherent > 0 && (
            <>
              <br />
              <strong>{m.rejected.incoherent}</strong> dont le cap partait dans tous les sens : chute ou hésitation.
            </>
          )}
          {m.rejected.tooShort > 0 && (
            <>
              <br />
              <strong>{m.rejected.tooShort}</strong> sur place, moins de 10 m parcourus : à cette distance le cap n'est que du bruit de position.
            </>
          )}
        </p>
      )}

      <button
        onClick={() => setShowManeuverDetails(!showManeuverDetails)}
        style={{ padding: '4px 10px', cursor: 'pointer', backgroundColor: showManeuverDetails ? 'var(--voile)' : 'var(--surface-sunken)', color: showManeuverDetails ? '#fff' : 'var(--ink)', border: 'none', borderRadius: '4px', fontSize: '12px' }}>
        {showManeuverDetails ? 'Replier les détails ▲' : 'Détails des manœuvres ▼'}
      </button>

      {showManeuverDetails && (
      <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', marginTop: '12px' }}>
        {([
          ['tack', 'Virements', maneuverSummary.tack],
          ['jibe', 'Empannages', maneuverSummary.jibe],
        ] as const).map(([type, title, summary]) => (
          <div key={type} className="an-man-detail" style={{ flex: '1 1 380px', backgroundColor: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '6px', padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
              <strong style={{ fontSize: '15px' }}>{title}</strong>
              {summary ? (
                <span style={{ fontSize: '13px' }}>
                  <span style={{ color: '#388e3c', fontWeight: 'bold' }}>{summary.success} réussi{summary.success > 1 ? 's' : ''}</span>
                  {' · '}
                  <span style={{ color: '#d32f2f' }}>{summary.fail} raté{summary.fail > 1 ? 's' : ''}</span>
                  {' · Vmin moy. '}{summary.vminAvg}{' nds, max '}<strong>{summary.vminMax}</strong>{' nds'}
                </span>
              ) : (
                <span style={{ color: 'var(--muted)', fontSize: '13px' }}>aucun</span>
              )}
            </div>

            {summary && (
              <table className="an-man-podium" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ color: 'var(--muted)', borderBottom: '1px solid var(--line)' }}>
                    <th style={{ textAlign: 'left', padding: '3px 4px', fontWeight: 'normal' }}>Métrique</th>
                    <th style={{ padding: '3px 4px', fontWeight: 'normal' }}>Moyenne</th>
                    <th style={{ padding: '3px 4px', fontWeight: 'normal', color: '#d32f2f' }}>1er</th>
                    <th style={{ padding: '3px 4px', fontWeight: 'normal', color: '#f57c00' }}>2e</th>
                    <th style={{ padding: '3px 4px', fontWeight: 'normal', color: '#388e3c' }}>3e</th>
                    <th style={{ padding: '3px 4px' }} />
                  </tr>
                </thead>
                <tbody>
                  {MANEUVER_METRICS.map((metric) => {
                    const key = `${type}:${metric.key}`;
                    const active = selectedManeuverTop === key;
                    const tops = summary.tops[metric.key];
                    return (
                      <tr key={metric.key} title={metric.hint} style={{ borderBottom: '1px solid var(--line-soft)', backgroundColor: active ? 'var(--voile-soft)' : 'transparent' }}>
                        <td style={{ padding: '4px', textAlign: 'left' }}>{metric.label}</td>
                        <td style={{ padding: '4px', textAlign: 'center', fontWeight: 'bold' }}>{summary.averages[metric.key]}</td>
                        {[0, 1, 2].map((rank) => (
                          <td key={rank} style={{ padding: '4px', textAlign: 'center' }}>{tops[rank]?.label ?? '-'}</td>
                        ))}
                        <td style={{ padding: '2px 4px', textAlign: 'right' }}>
                          <button
                            disabled={tops.length === 0}
                            onClick={() => setSelectedManeuverTop(active ? 'none' : key)}
                            style={{ padding: '2px 7px', fontSize: '11px', cursor: tops.length === 0 ? 'default' : 'pointer', backgroundColor: active ? 'var(--voile)' : 'var(--surface-sunken)', color: active ? '#fff' : 'var(--ink)', border: '1px solid var(--line-strong)', borderRadius: '4px', opacity: tops.length === 0 ? 0.5 : 1 }}>
                            {active ? 'Masquer' : 'Carte'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
      )}
      {showManeuverDetails && (
        <div style={{ color: 'var(--muted)', fontSize: '11px', marginTop: '8px' }}>
          Survolez une ligne pour la définition. Le podium retient la meilleure valeur : conservation la plus haute, relance la plus courte, cap et distance les plus faibles.
        </div>
      )}
    </ResizablePanel>
  );

  /** Contenu partagé par la carte compacte et sa vue agrandie (tap, écran étroit). */
  const mapLayers = (
    <>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

      {staticMapLayers}

      {hoveredIndex !== null && trackData[hoveredIndex] && (
        <Marker
          position={[trackData[hoveredIndex].lat, trackData[hoveredIndex].lon]}
          icon={hoverIcon}
          zIndexOffset={1000}
        />
      )}
    </>
  );

  return (
    <div className="an-page" style={{ padding: '20px' }}>
      <div className="an-sheet">
        <div style={{ marginBottom: '15px' }}>
          <PageHeader title="Analyse voile" subtitle={requestedFile ? <SessionNameEditor file={requestedFile} /> : undefined} back={{ to: libraryPath('voile'), label: 'Sessions voile' }} />
          {sessionError && <div className="ui-alert ui-alert--warning" style={{ marginTop: '10px' }}>{sessionError}</div>}
        </div>

        {stats && (
          <div className="an-sheet__stats">
            <div className="an-sheet__stat"><span className="an-sheet__stat-label">Distance</span><strong className="an-sheet__stat-value">{stats.distance} km</strong></div>
            <div className="an-sheet__stat"><span className="an-sheet__stat-label">Temps total</span><strong className="an-sheet__stat-value">{stats.totalTime}</strong></div>
            <div className="an-sheet__stat"><span className="an-sheet__stat-label">Temps actif (&ge;{activeThresholdKn} nds)</span><strong className="an-sheet__stat-value">{stats.activeTime}</strong></div>
            <div className="an-sheet__stat"><span className="an-sheet__stat-label">{profile.activeRatioLabel}</span><strong className="an-sheet__stat-value">{stats.activeRatio}%</strong></div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '20px', alignItems: 'center', marginBottom: '15px', flexWrap: 'wrap' }}>
          <label className="ui-btn ui-btn--secondary">
            <IconFile size={18} />
            Ouvrir un fichier GPX
            <input type="file" accept=".gpx" onChange={openFile} hidden />
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}>
            <strong>Activité :</strong>
            <select
              value={activity.id}
              onChange={(e) => changeActivity(e.target.value)}
              className="ui-field ui-field--s">
              {activityOptions.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}>
            <strong>Seuil d'activité :</strong>
            <input
              type="number"
              min={0}
              step={0.5}
              value={activeThresholdKn}
              onChange={(e) => {
                const parsed = parseFloat(e.target.value);
                if (!isNaN(parsed) && parsed >= 0) draft.update({ activeThreshold: parsed });
              }}
              title="Seuil propre à cette session, enregistré avec elle. Celui du support se règle dans Réglages."
              className="ui-field ui-field--s num"
              style={{ width: '70px' }} />
            {SPEED_UNIT_LABEL[profile.thresholdUnit]}
            {edits.activeThreshold !== null && (
              <Button
                size="s"
                onClick={() => draft.update({ activeThreshold: null })}
                title={`Revenir au seuil du support (${defaultActiveThresholdKn} ${SPEED_UNIT_LABEL[profile.thresholdUnit]})`}>
                Défaut
              </Button>
            )}
          </label>

          {trackData.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}>
              <strong>Allure de la session :</strong>
              <input
                type="number"
                min={0}
                step={0.5}
                value={msToKnots(referenceSpeedMs).toFixed(1)}
                onChange={(e) => {
                  const parsed = parseFloat(e.target.value);
                  if (!isNaN(parsed) && parsed > 0) draft.update({ referenceSpeedMs: knotsToMs(parsed) });
                }}
                title="Vitesse de croisière de la session, dont dépendent les seuils de filtrage. Déduite de la trace ; imposée si elle la décrit mal, et alors enregistrée avec la session."
                className="ui-field ui-field--s num"
                style={{ width: '70px' }} />
              nds
              {edits.referenceSpeedMs === null ? (
                <span style={{ color: 'var(--muted)', fontSize: '12px' }}>(déduite de la trace)</span>
              ) : (
                <Button size="s" onClick={() => draft.update({ referenceSpeedMs: null })} title="Revenir à l'allure déduite de la trace">
                  Défaut
                </Button>
              )}
            </label>
          )}
        </div>
      </div>

      {loadedFromMemory && (
        <SessionSaveBar draft={draft} kept="vent, seuil d'activité, allure, couleurs et notes sont gardés dans sa fiche" />
      )}

      {loadError && (
        <div style={{ padding: '10px 15px', backgroundColor: '#fdecea', border: '1px solid #d32f2f', borderRadius: '8px', color: '#b71c1c', marginBottom: '10px' }}>
          {loadError}
        </div>
      )}

      {windInputRequired && (
        <div style={{ padding: '10px 15px', backgroundColor: '#fff8e1', border: '1px solid #f9a825', borderRadius: '8px', marginBottom: '10px' }}>
          <strong>Vent non fiable.</strong> L'estimation automatique donne {autoWind}° avec un indice de confiance
          de {windEstimate ? Math.round(windEstimate.confidence * 100) : 0}%, trop faible pour être utilisée.
          C'est typique d'un aller simple ou d'un plan d'eau à courant. Saisissez le vent ci-dessous pour
          débloquer les manœuvres, la VMG et la polaire.
        </div>
      )}

      {stats && (
        <div style={{ marginBottom: '10px' }}>

          <SectionTabs sections={SAILING_SECTIONS} open={open} onToggle={toggle} />

          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '15px' }}>

            {open.global && (
              <ResizablePanel id="sailing.global" style={{ ...CARD_STYLE, flex: '1 1 100%', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 200px', minWidth: '250px' }}>
                  <div style={{ marginBottom: '10px' }}>
                    <PanelTitle label="Global" open={open.global} onToggle={() => toggle('global')} />
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '20px' }}>
                    <li><strong>Distance totale :</strong> {stats.distance} km</li>
                    <li><strong>Distance active :</strong> {stats.activeDistance} km</li>
                    <li><strong>Temps total :</strong> {stats.totalTime}</li>
                    <li><strong>Temps actif (&ge;{activeThresholdKn} nds) :</strong> {stats.activeTime}</li>
                    <li><strong>{profile.activeRatioLabel} :</strong> {stats.activeRatio}%</li>
                    <li style={{ color: 'var(--muted)', fontSize: '12px', marginTop: '6px' }}>
                      Vitesse : {hasDeviceSpeed ? 'Doppler de l\'appareil' : 'dérivée des positions, filtrée'}
                    </li>
                  </ul>
                </div>

                <div style={{ flex: '1 1 350px', display: 'flex', gap: '20px', borderLeft: '2px solid var(--line)', paddingLeft: '20px' }}>
                  <div>
                    <strong style={{ display: 'block', marginBottom: '10px', fontSize: '16px' }}>Axe du Vent Global (Polaire)</strong>
                    <div style={{ marginBottom: '10px' }}>
                      Calculé : {autoWind}°
                      {windEstimate && (
                        <span style={{ color: windEstimate.reliable ? '#388e3c' : '#d32f2f', fontSize: '12px', marginLeft: '6px' }}>
                          (confiance {Math.round(windEstimate.confidence * 100)}%, angle mort de la polaire{windEstimate.maneuverCount > 0 ? ` affiné par ${windEstimate.maneuverCount} manœuvres` : ''}, sens donné par {windEstimate.orientedBy === 'virages' ? 'les virages' : 'la polaire'})
                        </span>
                      )}
                      <br/>
                      <div style={{ marginTop: '5px' }}>
                        Saisie : <input
                          type="number"
                          value={edits.windDeg ?? ''}
                          onChange={(e) => {
                            if (e.target.value === '') {
                              draft.update({ windDeg: null });
                              return;
                            }
                            const parsed = parseInt(e.target.value, 10);
                            if (!isNaN(parsed)) draft.update({ windDeg: parsed });
                          }}
                          className="ui-field ui-field--s num"
                          style={{ width: '64px' }} /> °
                        <Button
                          size="s"
                          onClick={() => draft.update({ windDeg: ((currentWindValue ?? autoWind ?? 0) + 180) % 360 })}
                          style={{ marginLeft: '6px' }}>
                          Inverser
                        </Button>
                        {edits.windDeg !== null && (
                          <Button
                            size="s"
                            onClick={() => draft.update({ windDeg: null })}
                            title="Revenir au vent calculé"
                            style={{ marginLeft: '6px' }}>
                            Calculé
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                  <Compass windAngle={currentWindValue ?? autoWind ?? 0} />
                </div>
              </ResizablePanel>
            )}

            {open.matos && (
              <ResizablePanel id="sailing.matos" style={{ ...CARD_STYLE, flex: '1 1 100%', display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 260px' }}>
                  <div style={{ marginBottom: '10px' }}>
                    <PanelTitle label="Matériel" open={open.matos} onToggle={() => toggle('matos')} />
                  </div>
                  {([
                    ['foil', 'Foil'],
                    ['mast', 'Mât'],
                    ['wing', 'Aile / voile'],
                  ] as const).map(([field, label]) => (
                    <label key={field} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '14px' }}>
                      <span style={{ width: '90px' }}>{label}</span>
                      <input
                        type="text"
                        value={notes[field]}
                        onChange={(e) => setNotes({ [field]: e.target.value })}
                        placeholder={field === 'foil' ? 'ex. 1100 cm²' : field === 'mast' ? 'ex. 85 cm' : 'ex. 5 m²'}
                        style={{ flex: 1, padding: '4px 6px' }} />
                    </label>
                  ))}
                </div>

                <div style={{ flex: '1 1 260px' }}>
                  <strong style={{ display: 'block', marginBottom: '10px', fontSize: '16px' }}>Conditions</strong>
                  <div style={{ marginBottom: '10px' }}>
                    <span style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>Vent</span>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {WIND_LEVELS.map((w) => (
                        <button key={w.value} onClick={() => setNotes({ windLevel: notes.windLevel === w.value ? null : w.value })}
                          style={{ padding: '5px 10px', cursor: 'pointer', border: '1px solid var(--line-strong)', borderRadius: '4px', fontSize: '12px', backgroundColor: notes.windLevel === w.value ? 'var(--voile)' : '#fff', color: notes.windLevel === w.value ? '#fff' : 'var(--ink)' }}>
                          {w.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>Plan d'eau</span>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {WATER_STATES.map((s) => (
                        <button key={s.value} onClick={() => setNotes({ waterState: notes.waterState === s.value ? null : s.value })}
                          style={{ padding: '5px 10px', cursor: 'pointer', border: '1px solid var(--line-strong)', borderRadius: '4px', fontSize: '12px', backgroundColor: notes.waterState === s.value ? 'var(--voile)' : '#fff', color: notes.waterState === s.value ? '#fff' : 'var(--ink)' }}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ flex: '1 1 260px' }}>
                  <strong style={{ display: 'block', marginBottom: '10px', fontSize: '16px' }}>Appréciation de la séance</strong>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                    {RATINGS.map((r) => (
                      <button key={r.value} onClick={() => setNotes({ rating: notes.rating === r.value ? null : r.value })}
                        title={r.label} aria-label={r.label}
                        style={{ fontSize: '26px', lineHeight: 1, padding: '6px', cursor: 'pointer', border: notes.rating === r.value ? '2px solid var(--voile)' : '1px solid var(--line-strong)', borderRadius: '8px', backgroundColor: notes.rating === r.value ? 'var(--voile-soft)' : '#fff', opacity: notes.rating === null || notes.rating === r.value ? 1 : 0.5 }}>
                        {r.emoji}
                      </button>
                    ))}
                  </div>
                  {notes.rating !== null && (
                    <div style={{ fontSize: '13px', marginBottom: '8px' }}>{RATINGS.find((r) => r.value === notes.rating)?.label}</div>
                  )}
                  <textarea
                    value={notes.comment}
                    onChange={(e) => setNotes({ comment: e.target.value })}
                    placeholder="Commentaire libre"
                    rows={3}
                    style={{ width: '100%', padding: '6px', fontFamily: 'inherit', fontSize: '13px', boxSizing: 'border-box' }} />
                  <div style={{ color: 'var(--muted)', fontSize: '12px', marginTop: '6px' }}>
                    {!draft.savable
                      ? 'Notes indisponibles : cette trace n\'est pas dans la mémoire.'
                      : draft.changed.includes('notes')
                        ? 'Non enregistrées : « Enregistrer la session », en haut de la page.'
                        : draft.hasSavedNotes
                          ? 'Enregistrées dans la fiche de la session, dans le dossier mémoire.'
                          : 'Enregistrées avec la session, par « Enregistrer la session ».'}
                  </div>
                </div>
              </ResizablePanel>
            )}

            {open.tops && (
              <ResizablePanel id="sailing.tops" style={{ ...CARD_STYLE, flex: '1 1 400px', display: 'flex', gap: '30px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ marginBottom: '10px' }}>
                    <PanelTitle label="Tops Temps" open={open.tops} onToggle={() => toggle('tops')} />
                  </div>
                  {renderTop3("2 Secondes", "t2s", stats.tops.t2s)}
                  {renderTop3("5 Secondes", "t5s", stats.tops.t5s)}
                  {renderTop3("10 Secondes", "t10s", stats.tops.t10s)}
                </div>
                <div>
                  <strong style={{ display: 'block', marginBottom: '10px', fontSize: '16px' }}>Tops Distance</strong>
                  {renderTop3("100 Mètres", "d100m", stats.tops.d100m)}
                  {renderTop3("500 Mètres", "d500m", stats.tops.d500m)}
                  {renderTop3("1000 Mètres", "d1000m", stats.tops.d1000m)}
                  {renderTop3("1 Mille Nautique", "d1NM", stats.tops.d1NM)}
                </div>
              </ResizablePanel>
            )}

          </div>
        </div>
      )}

      <div id="map-view" className="an-map-row" style={{ width: '100%', marginTop: '10px', zIndex: 0, display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        <AnalysisMap
          panelId="sailing.carte"
          sessionKey={sessionKey}
          bounds={mapBounds}
          layers={mapLayers}
          defaultHeight={660}
          legend={trackData.length > 0 ? {
            unit: 'kn',
            range: colorRange,
            isOverridden: edits.speedRange !== null,
            onChange: (next) => { if (next === null || isValidSpeedRange(next)) draft.update({ speedRange: next }); },
            slowLabel: `sous ${Math.round(msToKnots(colorRange.minMs))} nds`,
          } : null}
          style={{ flex: '0 1 60%' }} />

        {stats && (
          <div className="an-carte-col" style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <SectionTabs sections={SAILING_CARTE_PANELS} open={carteOpen} onToggle={toggleCarte} />
            <div className="an-carte-panels" style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
              {carteOpen.manoeuvres && maneuverStats && renderManeuversPanel(maneuverStats)}
              {carteOpen.vmg && vmgStats && renderVmgPanel(vmgStats)}

              {carteOpen.graphiques && (
                <div
                  style={{ ...CARD_STYLE, flex: '1 1 100%', display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-start' }}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  <div style={{ flex: '1 1 100%' }}>
                    <PanelTitle label="Graphiques" open={carteOpen.graphiques} onToggle={() => toggleCarte('graphiques')} />
                  </div>

                  <ResizablePanel id="sailing.graph.vitesse" defaultHeight={350} minWidth={250} minHeight={200} style={{ flex: 'none', width: '500px', overflow: 'hidden', border: '1px dashed var(--line-strong)', padding: '10px', backgroundColor: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
                    <strong style={{ display: 'block', marginBottom: '10px', fontSize: '14px', textAlign: 'center' }}>Historique de Vitesse (Cliquer pour défiler vers la carte)</strong>
                    <div style={{ flexGrow: 1, width: '100%', position: 'relative' }}>
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={speedGraphData}
                            onMouseMove={onChartHover(speedGraphData)}
                            onClick={() => {
                              document.getElementById('map-view')?.scrollIntoView({ behavior: 'smooth' });
                            }}
                            margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ccc" />
                            <XAxis dataKey="index" hide />
                            <YAxis domain={[0, 'auto']} tick={{fill: '#111', fontSize: 11, fontWeight: 'bold'}} />
                            <Tooltip formatter={knotsFormatter('Vitesse')} labelFormatter={() => ''} />
                            <Line type="monotone" dataKey="vitesse" stroke="#1976d2" dot={false} strokeWidth={2} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </ResizablePanel>

                  <ResizablePanel id="sailing.graph.polaire" defaultHeight={350} minWidth={250} minHeight={250} style={{ flex: 'none', width: '350px', overflow: 'hidden', border: '1px dashed var(--line-strong)', padding: '10px', backgroundColor: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
                    <strong style={{ display: 'block', marginBottom: '10px', fontSize: '14px', textAlign: 'center' }}>Polaire de Vitesse (TWA)</strong>
                    <div style={{ position: 'absolute', top: 35, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 10, pointerEvents: 'none' }}>
                      <span style={{ fontSize: 9, fontWeight: 'bold', color: '#d32f2f', marginBottom: -2 }}>VENT</span>
                      <svg width="12" height="16" viewBox="0 0 24 24">
                        <path d="M12 24L0 12h8V0h8v12h8z" fill="#d32f2f" />
                      </svg>
                    </div>
                    <div style={{ flexGrow: 1, width: '100%', position: 'relative' }}>
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart cx="50%" cy="50%" outerRadius="80%" data={polarGraphData}>
                            <PolarGrid />
                            <PolarAngleAxis dataKey="angle" tick={{ fill: '#333', fontSize: 11 }} />
                            <PolarRadiusAxis angle={30} domain={[0, 'auto']} tick={{ fill: '#000', fontSize: 11, fontWeight: 'bold' }} />
                            <Radar name="Vitesse Max" dataKey="vitesse" stroke="#e64a19" fill="#e64a19" fillOpacity={0.4} />
                            <Tooltip formatter={knotsFormatter('Vmax')} />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </ResizablePanel>
                </div>
              )}

              {carteOpen.vent && windStats && (
                <div
                  style={{ ...CARD_STYLE, flex: '1 1 100%', display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-start' }}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  <div style={{ flex: '1 1 300px', minWidth: '250px' }}>
                    <div style={{ marginBottom: '10px' }}>
                      <PanelTitle
                        label="Variations du Vent"
                        open={carteOpen.vent}
                        onToggle={() => toggleCarte('vent')}
                        extra={<span style={{ color: 'var(--muted)', fontSize: '12px', fontWeight: 'normal' }}> (mesurées sur {windStats.count} manœuvres)</span>} />
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.8' }}>
                      <li><strong>Moyenne :</strong> {windStats.avgWind}°</li>
                      <li><strong>Plage de variation :</strong> {windStats.range}° (de {windStats.minWind}° à {windStats.maxWind}°)</li>
                      <li><strong>Régularité (écart-type circulaire) :</strong> ± {windStats.stdDev}° <em>(faible = vent laminaire, élevé = vent oscillant)</em></li>
                      <li><strong>Tendance temporelle :</strong> {Math.abs(windStats.slopePerHour).toFixed(1)}°/heure ({windStats.slopePerHour > 0 ? 'rotation droite / horaire' : 'rotation gauche / anti-horaire'})</li>
                      <li style={{ color: 'var(--muted)', fontSize: '12px' }}>
                        {Math.round(windStats.stableShare * 100)}% des manœuvres ont des caps stabilisés avant et après : ce sont les mesures les plus nettes, mais toutes comptent.
                      </li>
                    </ul>
                    <p style={{ margin: '10px 0 0', color: 'var(--muted)', fontSize: '12px', lineHeight: '1.5' }}>
                      Chaque virement et chaque empannage donne une lecture du vent local, sans exception. Une manœuvre
                      symétrique, entrée et sortie au même angle du vent, place son milieu sur l'axe du vent et mesure
                      juste ; entrer au largue pour ressortir au près décale ce milieu d'autant. Ce biais ne peut pas se
                      corriger manœuvre par manœuvre, mais il change de signe d'une fois sur l'autre : les manœuvres les
                      plus symétriques pèsent davantage dans la moyenne et l'écart-type, et l'ensemble compense. Entre
                      deux manœuvres la courbe est interpolée ; avant la première et après la dernière, elle garde la
                      valeur la plus proche. Elle s'interrompt au-delà de 30 minutes sans manœuvre. Sur le graphe, les
                      points marquent les manœuvres : c'est là, et là seulement, que le vent est mesuré.
                    </p>
                  </div>

                  <ResizablePanel id="sailing.graph.vent" defaultHeight={250} minWidth={300} minHeight={180} style={{ flex: '2 1 500px', overflow: 'hidden', border: '1px dashed var(--line-strong)', padding: '10px', backgroundColor: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
                    <strong style={{ display: 'block', marginBottom: '10px', fontSize: '14px', textAlign: 'center' }}>Évolution du Vent (Cliquer pour défiler vers la carte)</strong>
                    <div style={{ flexGrow: 1, width: '100%', position: 'relative' }}>
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={windStats.graphData}
                            onMouseMove={onChartHover(windStats.graphData)}
                            onClick={() => {
                              document.getElementById('map-view')?.scrollIntoView({ behavior: 'smooth' });
                            }}
                            margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ccc" />
                            <XAxis dataKey="index" hide />
                            <YAxis domain={['dataMin - 15', 'dataMax + 15']} tickFormatter={(val) => `${((val % 360) + 360) % 360}°`} tick={{fill: '#111', fontSize: 11, fontWeight: 'bold'}} />
                            <Tooltip
                              formatter={(_val, _name, item: TooltipPayloadEntry): [string, string] => {
                                // Recharts ne type pas la ligne derrière l'entrée : c'est un `WindGraphPoint`.
                                const point: WindGraphPoint | undefined = item.payload;
                                const angle = point?.display;
                                return [angle === null || angle === undefined ? '-' : `${angle}°`, 'Vent local'];
                              }}
                              labelFormatter={(_label, payload) => {
                                const point: WindGraphPoint | undefined = payload?.[0]?.payload;
                                return point ? `Heure: ${point.timeLabel}` : '';
                              }} />
                            <Line type="monotone" dataKey="angle" stroke={WIND_COLOR} strokeWidth={2} dot={maneuverDot} activeDot={{ r: 6 }} connectNulls={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </ResizablePanel>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SailingModule;