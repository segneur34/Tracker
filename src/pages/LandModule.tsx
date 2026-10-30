import { roundTo, toFixedNumber } from '../core/basics';
import { Fragment, useCallback, useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import AnalysisBaseLayers from '../components/AnalysisBaseLayers';
import './analysisMobile.css';
import GradeLegendRow from '../components/GradeLegendRow';
import SessionActivityField from '../components/SessionActivityField';
import SessionSettingsHeader from '../components/SessionSettingsHeader';
import CardioTab from '../components/CardioTab';
import NotesTab from '../components/NotesTab';
import CadencePanel from '../components/CadencePanel';
import ChartFold, { GraphFoldHead } from '../components/ChartFold';
import { HoverReadout, type Readout, type ReadoutValue } from '../components/ChartReadout';
import { ANALYSIS_MAP_ANCHOR } from '../components/AnalysisMap';
import EffortThresholdEditor from '../components/EffortThresholdEditor';
import GradeGradientLegend from '../components/GradeGradientLegend';
import HeartRateChart from '../components/HeartRateChart';
import FitnessTestPanel, { FitnessTestCurves } from '../components/FitnessTestPanel';
import { CardioCompanion, type HeartRateEfficiency } from '../components/HeartRatePanel';
import { heartRateValue } from '../components/chartReadouts';
import { distanceX, elapsedX } from '../components/chartAxes';
import TrackChart, { type TrackSeries, type TrackYAxis } from '../components/TrackChart';
import { useTimeChartAxis } from '../hooks/useTimeChartAxis';
import IntervalAnalysis, { type IntervalSeriesView } from '../components/IntervalAnalysis';
import HighlightPath from '../components/HighlightPath';
import { useExclusiveToggles } from '../hooks/useExclusiveToggles';
import JumpMapLayer from '../components/JumpMapLayer';
import JumpsPanel from '../components/JumpsPanel';
import { HelpText } from '../components/Help';
import PanelTitle, { PanelHeading, SessionDate } from '../components/PanelTitle';
import EmptyTabPanel from '../components/EmptyTabPanel';
import ResizablePanel from '../components/ResizablePanel';
import { gearFieldsFor } from '../components/gearFields';
import { HIGHLIGHT_SHOWN_COLOR } from '../components/highlightColors';
import { HEART_RATE_COLOR } from '../components/heartRateColors';
import { CADENCE_COLOR } from '../components/cadenceColors';
import GeneralStats from '../components/GeneralStats';
import ElevationProfileMini, { type ElevationProfileRow } from '../components/ElevationProfileMini';
import type { ShareStat } from '../core/shareImage';
import SessionWeightField from '../components/SessionWeightField';
import { SessionMarksList } from '../components/SessionMarks';
import { markReferenceLines } from '../components/markReferenceLines';
import SpeedGradientLegend from '../components/SpeedGradientLegend';
import { SessionColorRangeField } from '../components/SpeedRangeEditor';
import SurfaceBar from '../components/SurfaceBar';
import SurfaceHighlight from '../components/SurfaceHighlight';
import SurfaceLayer from '../components/SurfaceLayer';
import TopsPanel, { TopsHighlight } from '../components/TopsPanel';
import TrackSegmentsLayer, { type TrackSegment } from '../components/TrackSegmentsLayer';
import { zoomHint } from '../components/zoomHint';
import { inChartView } from '../components/chartHover';
import { ANALYSIS_PANEL_STYLE, PANEL_BLOCK_STYLE } from '../components/styles';
import Button from '../components/ui/Button';
import { LAND_TABS, tabDefaults, type LandTab } from '../core/analysisTabs';
import { sampledIndices, visibleIndexRange } from '../core/chartZoom';
import { trackChartRows, type TrackChartRow } from '../core/chartRows';
import { CHART_MAX_POINTS, trackBounds } from '../core/displayConfig';
import { computeElevationStats } from '../core/elevation';
import { buildBaseSessionStats, thresholdActivityMask } from '../core/sessionStats';
import { nearestIndexAtTime } from '../core/search';
import { timeSpanHeartRate } from '../core/heartRate';
import { ELEVATION_PRESETS, getActiveThresholds, isTestSport, sportTreatment } from '../core/sportProfiles';
import { computeAllTopSegments } from '../core/topSegments';
import { meanFilterByTime } from '../core/speedFilter';
import { effectiveSpeedRange, trackColorSegments } from '../core/trackColor';
import {
  editSpeedUnit, CHART_PACE_MIN_SPEED_MS,
  DISTANCE_UNIT_SYMBOL, speedSourceText, speedUnitLabel, formatClockMinutes, formatDistance, formatSpeed, formatSpeedValue, fromDisplaySpeed,
  isInverseUnit, toDisplayDistance, toDisplaySpeed, commaDecimal
} from '../core/units';
import { useChartZoom, type ChartZoom } from '../hooks/useChartZoom';
import { useNarrowScreen } from '../hooks/useNarrowScreen';
import { useGpxSession } from '../hooks/useGpxSession';
import { useAnalysisSession } from '../hooks/useAnalysisSession';
import { useAnalysisTabs } from '../hooks/useAnalysisTabs';
import { useOpenSections } from '../hooks/useOpenSections';
import { useZoomOnMap } from '../hooks/useZoomOnMap';
import { useAnalysisHeart, useHeartRateZoneHighlight } from '../hooks/useAnalysisHeart';
import { useLibrarySession } from '../hooks/useSessionLibrary';
import { useShownJumps } from '../hooks/useSessionJumps';
import { useSessionMarks } from '../hooks/useSessionMarks';
import { useSessionSurfaces } from '../hooks/useSessionSurfaces';
import { useTerrainElevation, type TerrainElevationStatus } from '../hooks/useTerrainElevation';
import { useSportSettings } from '../hooks/useSportSettings';
import { computeGrades, gradeColorPaths, gradeGradientStops, type GradeZoneKey } from '../core/grade';
import { computeZoneStats, gradeZonePaths, ungradedMovingS } from '../running/runningAnalytics';
import { analyzeCadence, cadenceBandPaths, measuredCadenceSegments, sessionCadence, timeSpanCadence } from '../running/cadence';
import { isValidCarriedLoad, smoothMovingPower } from '../running/energy';
import { detectIntervals } from '../running/intervalDetection';
import { analyzeIntervals, type IntervalPhaseSpan } from '../running/intervalStats';
import type { BaseSessionStats } from '../core/types';
import { BIKE_TYPES, isValidBikeWeight } from '../cycling/energy';
import { seriesBlocks, type IntervalSeries, type IntervalWorkout } from '../recording/intervalTimer';
import type { SurfaceCategory } from '../planning/surface';
import { WAY_MATCH_DEFAULTS } from '../planning/wayMatch';
import { LAND_PAGES, LAND_TREATMENTS, type LandFamily, type LandTreatment } from './landModules';
import StatTile from '../components/ui/StatTile';
import MapToggle from '../components/ui/MapToggle';
import SegmentedControl from '../components/ui/SegmentedControl';
import { ALTITUDE_COLOR, ENERGY_COLOR, SPEED_COLOR } from '../components/chartStyle';
import AnalysisShell from '../components/AnalysisShell';

/** Lissage supplémentaire de la vitesse pour le graphe, en secondes. */
const CHART_SPEED_SMOOTHING_S = 10;
/** Lissage de la puissance du graphe d'énergie, en secondes. */
const ENERGY_POWER_SMOOTHING_S = 60;
/**
 * Hauteur du graphe d'énergie, celle d'un graphe de vitesse ou d'altitude : le
 * panneau suit son contenu. Agrandi à la poignée sur ordinateur, le graphe
 * prend la place gagnée.
 */
const ENERGY_CHART_HEIGHT_PX = 200;
/**
 * Hauteur de base d'un graphe de l'onglet « graphiques » et de celui des
 * zones de pente : le panneau suit le nombre de graphes dépliés. Une hauteur
 * tirée à la poignée se partage entre eux.
 */
const CHART_HEIGHT_PX = 170;
/** Hauteur de base du graphe superposé. */
const OVERLAY_CHART_HEIGHT_PX = 320;

/**
 * Sections du module, rangées dans `LAND_TABS` (`core/analysisTabs.ts`), où
 * chaque activité choisit dans Réglages celles qu'elle montre. Pour en ajouter
 * une : une entrée là (ouverte par défaut si elle est `primary`, `tabDefaults`),
 * et un bloc `{open.maCle && (...)}` dans le rendu. Le premier onglet, « général », porte la synthèse (repliable
 * pour gagner de la place, comme en voile), le dernier les réglages de la
 * session. La carte n'en fait pas partie : comme en voile, elle
 * s'affiche en permanence, jamais derrière un onglet qu'on pourrait fermer
 * et oublier rouvert. « tops » est natif à vélo ; à pied, il n'apparaît que
 * si l'activité le coche dans Réglages (course, marche). « surface » demande les voies à
 * OpenStreetMap à sa première ouverture : fermé par défaut, il ne coûte rien
 * tant qu'on ne l'ouvre pas. À vélo, elles sont demandées dès l'ouverture de
 * l'analyse, pour le roulement de l'énergie (`surfacesAtOpening`).
 * « fractionné » n'apparaît que pour une session qui a des répétitions du
 * compteur dans sa fiche, ou qui est de la famille Fractionné : ses
 * répétitions sont alors retrouvées dans la vitesse (§10, point 89).
 * « sauts » n'apparaît que pour une session aux sauts mesurés par les
 * capteurs du téléphone, comme en voile. « matériel et notes » porte le
 * matériel (deux champs nommés par activité dans Réglages), les conditions,
 * l'appréciation et le commentaire, comme « matos et conditions » en voile.
 */

/** Onglets ouverts à la première visite, les mêmes à pied et à vélo (« cadence » n'est qu'à pied). */
const LAND_SECTION_DEFAULTS = tabDefaults(LAND_TABS.course, LAND_TABS.velo);

type ChartMode = 'separate' | 'overlay';
type EnergyChartMode = 'power' | 'cumulative';

/** Une ligne du graphe d'énergie, en fonction du temps écoulé. */
interface EnergyChartRow {
  index: number;
  /** Temps écoulé depuis le départ, en minutes. */
  minutes: number;
  /** Puissance lissée, dans l'unité du modèle (`EnergyView.powerUnit`), `null` à l'arrêt. */
  power: number | null;
  /** Énergie totale dépensée depuis le départ, dans l'unité du modèle. */
  cumulative: number;
  speedMs: number;
  grade: number | null;
}

/**
 * Chiffres et tableau des zones du panneau Énergie, dépliés tant qu'on ne les
 * a pas repliés pour voir carte et graphe ensemble.
 */
const ENERGY_FIGURES_DEFAULT = { chiffres: true, zones: true };

/** Clés de surbrillance typées par onglet : une zone de pente, un revêtement. */
type LandHighlightKeys = { zones: GradeZoneKey; surface: SurfaceCategory };

/**
 * Graphes de l'onglet « graphiques » dépliés, chacun replié à part pour ne
 * comparer que ceux qui restent ouverts (demande du 16/10) ; un graphe replié
 * n'est pas non plus tracé dans le mode superposé. Choix gardé sur l'appareil.
 */
const GRAPH_FOLDS_DEFAULT = { vitesse: true, altitude: true, fc: true, cadence: true };
type GraphFold = keyof typeof GRAPH_FOLDS_DEFAULT;
/** Graphe d'altitude de l'onglet « zones de pente », déplié tant qu'on ne le replie pas. */
const ZONES_FOLDS_DEFAULT = { tableau: true, graphe: true };

/** Session sans séances du compteur : un tableau constant, pour ne pas relancer les calculs qui en dépendent. */
const NO_INTERVALS: IntervalSeries[] = [];


/** Vitesse moyenne montrée : `null` (« — ») sans distance ni temps. */
const positiveSpeed = (ms: number | null): number | null => (ms !== null && ms > 0 ? ms : null);

/** Meilleurs segments repris dans l'onglet « général », par traitement (22/10). */
const OVERVIEW_TOP_KEYS: Record<LandTreatment, readonly string[]> = { course: ['d1km'], velo: ['t5min', 'd10km'] };
/** Lignes du profil compact de l'onglet « général ». */
const PROFILE_MAX_POINTS = 400;

/** Ligne sous le graphe d'altitude : d'où vient l'altitude affichée. */
const elevationSourceText = (status: TerrainElevationStatus, stepM: number, error: string | null): string => {
  switch (status) {
    case 'ready':
      return `Altitude du terrain, un point tous les ${stepM} m (RGE ALTI). Source : IGN.`;
    case 'searching':
      return 'Altitude du GPS, en attendant celle de l\'IGN…';
    case 'outside':
      return 'Altitude du GPS : la trace est hors de la couverture de l\'IGN.';
    case 'error':
      return `Altitude du GPS. ${error ?? ''}`;
    case 'off':
      return 'Altitude enregistrée par le GPS (choisie dans les réglages de la session).';
  }
};

/**
 * Module des familles terrestres, course à pied, vélo et fractionné
 * (`landModules.tsx`) : trace colorée par la vitesse, graphes de vitesse et
 * d'altitude séparés ou superposés et zoomables, vitesses par zone de pente,
 * énergie, meilleurs segments. La page suit la famille, le modèle (énergie,
 * libellés) le calcul de l'activité courante.
 */
function LandModule({ family }: { family: LandFamily }) {
  const page = LAND_PAGES[family];
  const panelId = (name: string) => `${page.storageId}.${name}`;
  const {
    activity, setActivity, sport,
    profile, activeThreshold, terrainStepM,
    speedUnit, distanceUnit,
    speedRange, gradeRange, defaultSpeedRange, bikeType, bikeWeightKg: activityBikeKg, carriedLoadKg, energyModel, gearLabels, gearGroups, hrOffsetBpm,
  } = useSportSettings(family);
  const model = LAND_TREATMENTS[sportTreatment(sport) === 'velo' ? 'velo' : 'course'];
  const gpx = useGpxSession({ profile });
  /** FC de la session (ceinture, montre) et zones du pratiquant : l'onglet « cardio » et sa courbe dans les graphes. */
  const { runner, age, retainHr, heart, hrZones } = useAnalysisHeart(gpx.track, profile.heartRate, hrOffsetBpm);
  /** Cadence à pied (`cad` du GPX : capteurs du téléphone, montre) : sa courbe dans les graphes et l'onglet « cadence ». */
  const cadenceParams = profile.cadence;
  const cadence = useMemo(
    () => (cadenceParams && gpx.track.length > 1 ? sessionCadence(gpx.track, cadenceParams) : null),
    [cadenceParams, gpx.track]
  );
  const cadencePresent = cadence?.present === true;

  // Session de l'adresse, et brouillon de la session affichée (couleurs de la trace), écrit dans sa fiche
  // par « Enregistrer la session ». Changer d'activité l'écrit aussi dans la fiche de la session (comme en
  // voile) ; vers une activité de voile, la session part dans le module voile.
  const {
    sessionFile, requested: requestedFile, shownFile, error: sessionError, draft, allActivities, changeActivity: changeSessionActivity,
  } = useAnalysisSession({ family, activity, setActivity, load: gpx.loadGpxContent, loadedFile: gpx.fileName });
  /**
   * Répétitions du compteur rangées dans la fiche de la session affichée, s'il y en a, suivies en direct :
   * une fiche complétée par un import (« Télécharger la session » du téléphone) s'applique sans rouvrir l'analyse.
   */
  const shownRecord = useLibrarySession(shownFile)?.record;
  const sessionIntervals = shownRecord?.intervals ?? NO_INTERVALS;
  /** Test guidé de la fiche (Entraînement › Tests) : l'onglet « test ». */
  const sessionTest = shownRecord?.test ?? null;
  /** Poids du vélo et des bagages, charge portée : ceux de la session (brouillon, puis fiche), sinon ceux de l'activité. */
  const bikeWeightKg = draft.edits.bikeWeightKg ?? activityBikeKg;
  const loadKg = draft.edits.loadKg ?? carriedLoadKg;
  /** Lissage de l'altitude et plus petit dénivelé compté : le réglage « route », partout (21/10). */
  const elevationProfile = ELEVATION_PRESETS.route;

  // Onglets de l'activité, rangée « avancé », point survolé effacé à chaque session. Une seule surbrillance
  // sur la carte : un top, une zone de pente, une répétition ou un revêtement ; choisir l'une retire les
  // autres, fermer son onglet l'efface.
  const { open, toggle, toggleOf, advanced, shown, highlight } = useAnalysisTabs<LandTab, LandHighlightKeys>({
    storageId: page.storageId, tabs: LAND_TABS[model.treatment], defaults: LAND_SECTION_DEFAULTS, activity, sessionKey: gpx.sessionKey,
  });
  /** Répétitions retrouvées dans la vitesse : en famille Fractionné, pour une session faite sans le compteur. */
  const detectionOn = family === 'fractionne' && sessionIntervals.length === 0 && profile.intervals !== null;
  // Onglet « fractionné » en famille Fractionné seulement (19/10) : une sortie à pied ou à vélo faite avec le compteur
  // garde ses répétitions dans sa fiche, et les retrouve si elle passe en Fractionné.
  const hasIntervals = family === 'fractionne' && (sessionIntervals.length > 0 || detectionOn);
  // Sauts mesurés par les capteurs du téléphone : ceux de la fiche, sinon calculés depuis le `.imu`.
  const thresholdMs = fromDisplaySpeed(activeThreshold, profile.thresholdUnit);
  const jumps = useShownJumps({ file: shownFile, track: gpx.track, profile, activity, thresholdMs, highlight });
  const jumpsVisible = jumps.visible;
  const sections = useMemo(
    () => shown((s) => (s.key !== 'tops' || profile.topTargets.length > 0) && (s.key !== 'fractionne' || hasIntervals) && (s.key !== 'test' || isTestSport(profile.id))
      && (s.key !== 'sauts' || jumpsVisible) && (s.key !== 'cardio' || heart.present) && (s.key !== 'cadence' || cadencePresent)),
    [shown, profile.topTargets, profile.id, hasIntervals, jumpsVisible, heart.present, cadencePresent]
  );
  const selectedTop = highlight.shownIn('tops');
  const selectedZone = highlight.shownIn('zones');
  const selectedLap = highlight.shownIn('fractionne');
  const setSelectedTop = (key: string | null) => highlight.show('tops', key);
  const setSelectedZone = (key: GradeZoneKey | null) => highlight.show('zones', key);
  const setSelectedLap = (key: string | null) => highlight.show('fractionne', key);
  const selectedSurface = highlight.shownIn('surface');
  const setSelectedSurface = (key: SurfaceCategory | null) => highlight.show('surface', key);
  const shownCadenceBand = highlight.shownIn('cadence');
  const selectedCadenceBand = shownCadenceBand === null ? null : Number(shownCadenceBand);
  const setSelectedCadenceBand = (band: number | null) => highlight.show('cadence', band === null ? null : String(band));
  const [chartMode, setChartMode] = useState<ChartMode>('separate');
  const [energyMode, setEnergyMode] = useState<EnergyChartMode>('power');

  const narrow = useNarrowScreen();
  const unitLabel = speedUnitLabel(speedUnit, distanceUnit);
  const inverse = isInverseUnit(speedUnit);

  const { cumulative } = gpx;
  // Repères du bouton « Note » : fanions, liste de « Général », traits des graphes.
  const marks = useSessionMarks(draft, gpx.track, cumulative.cumDist);
  const shownMarkKey = highlight.shownIn('general');
  const shownMark = shownMarkKey === null ? null : Number(shownMarkKey);

  /**
   * Altitude du terrain (IGN), demandée à l'ouverture et gardée dans la fiche,
   * sauf si la session garde celle du GPS ; seule l'altitude des points change.
   */
  const terrainElevation = useTerrainElevation(
    gpx.track,
    cumulative.cumDist,
    shownFile,
    terrainStepM
  );

  const elevation = useMemo(
    () => computeElevationStats(terrainElevation.track, elevationProfile),
    [terrainElevation.track, elevationProfile]
  );

  // Seuil à 0 : aucun seuil réglé ; pauses de l'enregistrement, arrêts complets et trous immobiles ôtés d'office.
  const activityMask = useMemo(() => thresholdActivityMask(gpx.track, profile, activeThreshold), [gpx.track, profile, activeThreshold]);

  const stats: BaseSessionStats | null = useMemo(() => {
    if (gpx.track.length === 0) return null;
    const thresholds = getActiveThresholds(profile, activeThreshold);
    return buildBaseSessionStats(gpx.track, {
      enterThresholdMs: fromDisplaySpeed(thresholds.enter, profile.thresholdUnit),
      exitThresholdMs: fromDisplaySpeed(thresholds.exit, profile.thresholdUnit),
      minStateDurationS: profile.minStateDurationS,
      cumulative,
      activityMask,
      elevationStats: elevation,
    });
  }, [gpx.track, profile, activeThreshold, cumulative, activityMask, elevation]);

  const grades = useMemo(
    () => (stats?.hasElevation ? computeGrades(elevation.smoothed, cumulative, profile.grade.halfWindowM, gpx.track) : []),
    [stats, elevation, cumulative, profile.grade.halfWindowM, gpx.track]
  );

  /**
   * Revêtement des voies suivies, demandé à OpenStreetMap à la première
   * ouverture de l'onglet, ou dès l'ouverture de l'analyse à vélo (roulement
   * de l'énergie), puis gardé dans la fiche.
   */
  const surfaces = useSessionSurfaces(
    gpx.track,
    shownFile,
    open.surface || model.surfacesAtOpening
  );
  /**
   * « Voir sur la carte » de l'onglet surface, et celui de la pente sous le
   * graphe d'altitude : la trace prend les couleurs du revêtement ou de la
   * pente, tant que leur onglet est ouvert. Un seul à la fois : en allumer un
   * éteint l'autre.
   */
  const { first: surfaceOnMap, second: gradeOnMap, toggleFirst: toggleSurfaceOnMap, toggleSecond: toggleGradeOnMap } = useExclusiveToggles();
  /** Graphes dépliés de l'onglet « graphiques », et celui de l'onglet « zones de pente ». */
  const graphFolds = useOpenSections(`${page.storageId}.graphes`, GRAPH_FOLDS_DEFAULT);
  const zonesFold = useOpenSections(`${page.storageId}.zones`, ZONES_FOLDS_DEFAULT);
  /**
   * Un graphe d'altitude est montré, avec son « Voir sur la carte » : dans
   * « graphiques », altitude dépliée, ou dans « zones de pente », graphe déplié.
   */
  const altitudeChartShown = (open.graphiques && graphFolds.open.altitude) || (open.zones && zonesFold.open.graphe);
  const surfaceMapPaths = open.surface && surfaceOnMap ? surfaces.paths : null;

  /** Trace colorée par la pente, au palier près (`gradeColorPaths`), tant qu'un graphe d'altitude est montré. */
  const gradeMapPaths = useMemo(
    () => (gradeOnMap && altitudeChartShown && !surfaceMapPaths && grades.length > 0
      ? gradeColorPaths(gpx.track.map((p): [number, number] => [p.lat, p.lon]), grades, gradeRange)
      : null),
    [gradeOnMap, altitudeChartShown, surfaceMapPaths, grades, gpx.track, gradeRange]
  );

  /** Zones de pente ; vide si aucune n'a de temps (pentes toutes inconnues) : l'onglet dit alors pourquoi. */
  const zoneStats = useMemo(() => {
    if (grades.length === 0) return [];
    const zones = computeZoneStats(gpx.track, grades, activityMask, profile.grade);
    return zones.some((z) => z.timeMs > 0) ? zones : [];
  }, [gpx.track, grades, activityMask, profile.grade]);
  /** Temps en mouvement sans altitude : hors des zones, compté au plat par l'énergie ; dit sous le tableau (Q42). */
  const ungradedS = useMemo(
    () => (open.zones && zoneStats.length > 0 ? ungradedMovingS(gpx.track, grades, activityMask, profile.grade) : 0),
    [open.zones, zoneStats, gpx.track, grades, activityMask, profile.grade]
  );
  /** Onglet « cadence » : chiffres, tranches, selon la vitesse et la pente, dérive. */
  const cadenceAnalysis = useMemo(
    () => ((open.cadence || open.general) && cadencePresent && cadenceParams && cadence
      ? analyzeCadence(gpx.track, cadence.spm, activityMask, grades.length > 0 ? { values: grades, zones: profile.grade } : null, cadenceParams)
      : null),
    [open.cadence, open.general, cadencePresent, cadenceParams, cadence, gpx.track, activityMask, grades, profile.grade]
  );
  /** Passages de la tranche de cadence choisie, tracés sur la carte tant que l'onglet « cadence » est ouvert. */
  const cadencePaths = useMemo(
    () => (selectedCadenceBand !== null && cadenceAnalysis && cadence && cadenceParams
      ? cadenceBandPaths(gpx.track, cadence.spm, activityMask, cadenceAnalysis.bands.bounds, selectedCadenceBand, cadenceParams.gapS)
      : []),
    [selectedCadenceBand, cadenceAnalysis, cadence, cadenceParams, gpx.track, activityMask]
  );
  /** Passages de la zone cardiaque choisie, tracés sur la carte tant que l'onglet « cardio » est ouvert. */
  const hrZone = useHeartRateZoneHighlight(highlight, open.cardio, heart, hrZones, gpx.track, profile.heartRate.gapS);
  /** Passages de la zone de pente choisie, tracés sur la carte tant que son onglet est ouvert. */
  const zonePaths = useMemo(
    () => (selectedZone !== null && open.zones && grades.length > 0 ? gradeZonePaths(gpx.track, grades, activityMask, selectedZone, profile.grade) : []),
    [selectedZone, open.zones, gpx.track, grades, activityMask, profile.grade]
  );

  /**
   * Énergie dépensée, selon le modèle du traitement (`landModules.tsx`) :
   * pente, résistance de l'air, roulement selon le revêtement à vélo, et repos
   * sur toute la durée. Recalculée quand le revêtement arrive. Calculée
   * seulement onglet « énergie » ouvert, ou à vélo, dont « général » montre la
   * dépense totale.
   */
  const surfaceStatus = surfaces.status;
  const surfaceStretches = surfaces.stretches;
  const energyNeeded = open.energie || model.treatment === 'velo';
  const energy = useMemo(
    () => (energyNeeded && gpx.track.length > 1
      ? model.energy({
          track: gpx.track, grades, gradeZones: profile.grade, activityMask, runner, age, bikeType, bikeWeightKg, loadKg, energyModel,
          surfaces: { status: surfaceStatus, stretches: surfaceStretches },
        })
      : null),
    [energyNeeded, model, gpx.track, grades, profile.grade, activityMask, runner, age, bikeType, bikeWeightKg, loadKg, energyModel, surfaceStatus, surfaceStretches]
  );

  /** Chiffres du panneau Énergie repliés ou dépliés, choix gardé sur l'appareil. */
  const energyFold = useOpenSections(`${page.storageId}.energie`, ENERGY_FIGURES_DEFAULT);
  /** Temps écoulé de chaque point, en minutes : l'axe du graphe d'énergie (`energyZoom`), de la courbe « cardio » (`cardioZoom`) et des courbes du test. */
  const { minutes: trackMinutes, fullRange: timeRange, zoom: energyZoom, cardioZoom } = useTimeChartAxis(gpx.track, gpx.sessionKey);
  /** Puissance lissée, une fois pour toute la trace : zoomer ne la recalcule pas. */
  const smoothedPower = useMemo(
    () => (energy && open.energie ? smoothMovingPower(energy.power, gpx.track, ENERGY_POWER_SMOOTHING_S) : []),
    [energy, open.energie, gpx.track]
  );
  /** Lignes du graphe d'énergie sur la plage visible, au plus `CHART_MAX_POINTS`. */
  const energyChartData = useMemo(() => {
    if (!energy || smoothedPower.length === 0) return [];
    const [first, last] = visibleIndexRange(trackMinutes, energyZoom.view);
    return sampledIndices(first, last, CHART_MAX_POINTS, smoothedPower).map((i): EnergyChartRow => {
      const power = smoothedPower[i];
      return {
        index: i,
        minutes: toFixedNumber(trackMinutes[i], 3),
        power: isFinite(power) ? roundTo(power, 1) : null,
        cumulative: energy.cumulative[i],
        speedMs: gpx.track[i].smoothedSpeedMs,
        grade: isFinite(grades[i]) ? grades[i] : null,
      };
    });
  }, [energy, smoothedPower, trackMinutes, energyZoom.view, gpx.track, grades]);

  /** Meilleurs segments, dans l'unité affichée (km/h pour une allure). */
  const topUnit = editSpeedUnit(speedUnit);
  const tops = useMemo(
    () => (profile.topTargets.length > 0 && gpx.track.length > 1 && open.tops
      ? computeAllTopSegments(gpx.track, cumulative, profile.topTargets, (ms) => toDisplaySpeed(ms, topUnit), { decimals: 1 })
      : null),
    [profile.topTargets, gpx.track, cumulative, open.tops, topUnit]
  );

  /** Meilleurs segments de l'onglet « général », en m/s : ceux de `OVERVIEW_TOP_KEYS`, onglet « tops » caché compris. */
  const overviewTargets = useMemo(
    () => profile.topTargets.filter((t) => OVERVIEW_TOP_KEYS[model.treatment].includes(t.key)),
    [profile.topTargets, model.treatment]
  );
  const overviewTops = useMemo(
    () => (open.general && overviewTargets.length > 0 && gpx.track.length > 1
      ? computeAllTopSegments(gpx.track, cumulative, overviewTargets, (ms) => ms, { decimals: 3 })
      : null),
    [open.general, overviewTargets, gpx.track, cumulative]
  );

  /**
   * Répétitions retrouvées dans la vitesse (famille Fractionné, sans
   * compteur), au seuil d'effort de la session s'il est imposé (brouillon,
   * puis fiche), sinon à celui tiré de la session.
   */
  const effortOverrideMs = draft.edits.effortThresholdMs;
  const detected = useMemo(
    () => (detectionOn && profile.intervals && gpx.track.length > 1
      ? detectIntervals(gpx.track, cumulative, activityMask, profile.intervals.detection, effortOverrideMs)
      : null),
    [detectionOn, profile.intervals, gpx.track, cumulative, activityMask, effortOverrideMs]
  );
  /** Séances de la session : celles du compteur, sinon celles retrouvées dans la vitesse. */
  const intervalSeries = useMemo((): { workout: IntervalWorkout; laps: IntervalPhaseSpan[]; detected: boolean; name?: string }[] => {
    // Une séance à plusieurs blocs de séries : chaque bloc à part, comme une séance d'un seul bloc ; les blocs libres sont hors des répétitions.
    if (sessionIntervals.length > 0) {
      return sessionIntervals.flatMap((s) => seriesBlocks(s).map((b) => (
        { workout: b.workout, laps: b.laps, detected: false, ...(b.seriesCount > 1 ? { name: `Série ${b.series}` } : {}) }
      )));
    }
    return (detected?.series ?? []).map((s) => ({ workout: s.workout, laps: s.phases, detected: true }));
  }, [sessionIntervals, detected]);
  /** Segments où la cadence est mesurée, une fois pour toutes les répétitions de la session (lot 56). */
  const cadenceSegments = useMemo(
    () => (open.fractionne && cadencePresent && cadence && cadenceParams
      ? measuredCadenceSegments(gpx.track, cadence.spm, cadenceParams.gapS)
      : null),
    [open.fractionne, cadencePresent, cadence, cadenceParams, gpx.track]
  );
  /**
   * Séances mesurées sur la trace : chaque répétition avec le repos qui la
   * suit, son profil, et la synthèse. Clé d'une répétition : `séance-répétition`.
   */
  const intervalViews = useMemo(
    (): IntervalSeriesView[] => (open.fractionne && profile.intervals && gpx.track.length > 1
      ? intervalSeries.map((s) => {
        const analyzed = analyzeIntervals(gpx.track, cumulative, s.laps, profile.intervals!);
        // FC de chaque effort, si la session en a (ceinture, montre).
        const heartRates = heart.present
          ? analyzed.reps.map((r) => timeSpanHeartRate(gpx.track, heart.smoothed, r.work.startMs, r.work.endMs, profile.heartRate.gapS, profile.heartRate.recoveryS))
          : undefined;
        // Cadence et longueur de pas de chaque effort, à pied, si la session a de la cadence.
        const cadences = cadenceSegments
          ? analyzed.reps.map((r) => timeSpanCadence(cadenceSegments, gpx.track, r.work.startMs, r.work.endMs))
          : undefined;
        return { workout: s.workout, detected: s.detected, name: s.name, ...analyzed, heartRates, cadences };
      })
      : []),
    [open.fractionne, profile.intervals, intervalSeries, gpx.track, cumulative, heart, profile.heartRate, cadenceSegments]
  );
  /** Ce que dit l'onglet quand la vitesse ne livre aucune répétition. */
  const intervalEmptyText = (() => {
    if (intervalSeries.length > 0 || !detected) return null;
    switch (detected.miss) {
      case 'sans-contraste':
        return "Pas de fractionné reconnu : la vitesse ne se partage pas nettement entre efforts et récupérations. Un seuil d'effort imposé dans l'onglet réglages force la recherche.";
      case 'aucun-effort':
        return `Aucun effort au-dessus du seuil d'effort (${formatSpeed(detected.thresholdMs, editSpeedUnit(speedUnit))}) : il se baisse dans l'onglet réglages.`;
      default:
        return 'Trop peu de mouvement pour y chercher des répétitions.';
    }
  })();
  const selectedLapPath = useMemo(() => {
    if (selectedLap === null || !open.fractionne) return [];
    const [series, rep] = selectedLap.split('-').map(Number);
    return intervalViews[series]?.reps.find((r) => r.rep === rep)?.work.path ?? [];
  }, [selectedLap, open.fractionne, intervalViews]);

  /** Bornes du dégradé de couleur, en m/s : celles de la session, sinon de Réglages, sinon le défaut de l'activité. */
  const range = effectiveSpeedRange({ sessionRange: draft.edits.speedRange, activityRange: speedRange, suggested: null, fallback: defaultSpeedRange });

  /** Vitesse des graphes, lissée une fois pour toute la trace. */
  const chartSpeed = useMemo(
    () => meanFilterByTime(gpx.track.map((p) => p.smoothedSpeedMs), gpx.track.map((p) => p.timeMs), CHART_SPEED_SMOOTHING_S),
    [gpx.track]
  );
  /** Distance de chaque point dans l'unité choisie : l'axe des graphes et de leur zoom. */
  const trackDist = useMemo(() => cumulative.cumDist.map((m) => toDisplayDistance(m, distanceUnit)), [cumulative, distanceUnit]);
  /** Zoom des graphes de vitesse et d'altitude, qui partagent leur axe ; « tout voir » à chaque session. */
  const zoom = useChartZoom(trackDist.length > 1 ? { min: trackDist[0], max: trackDist[trackDist.length - 1] } : null, gpx.sessionKey);
  /** Zoom du profil de « général », à part : zoomer « général » ne zoome pas « graphiques ». */
  const profileZoom = useChartZoom(trackDist.length > 1 ? { min: trackDist[0], max: trackDist[trackDist.length - 1] } : null, gpx.sessionKey);
  /** Zoom des courbes de l'onglet « test », sur le temps. */
  const testZoom = useChartZoom(timeRange, gpx.sessionKey);
  /** Carte en plein écran (téléphone), seule ou avec les graphes d'un onglet. */
  const [mapExpanded, setMapExpanded] = useState(false);
  /** « +carte » des graphes zoomés : tronçon en violet, cadrage, plein écran carte + graphes au téléphone. */
  const zoomOnMap = useZoomOnMap({
    highlight,
    points: gpx.track,
    charts: {
      general: { zoom: profileZoom, axis: trackDist },
      graphiques: { zoom, axis: trackDist },
      zones: { zoom, axis: trackDist },
      energie: { zoom: energyZoom, axis: trackMinutes },
      cardio: { zoom: cardioZoom, axis: trackMinutes },
      test: { zoom: testZoom, axis: trackMinutes },
    },
    narrow,
    mapAnchorId: ANALYSIS_MAP_ANCHOR,
    mapExpanded,
    openMap: () => setMapExpanded(true),
  });

  /**
   * Lignes des graphes de « graphiques » et de « zones de pente », sur la plage
   * zoomée : calculées seulement quand l'un d'eux est ouvert, dans son panneau
   * ou sous la carte en plein écran.
   */
  const chartRowsNeeded = open.graphiques || open.zones
    || zoomOnMap.companionPanel === 'graphiques' || zoomOnMap.companionPanel === 'zones';
  const chartData = useMemo(
    () => (chartRowsNeeded
      ? trackChartRows({
          pointCount: gpx.track.length, dist: trackDist, view: zoom.view, speedMs: chartSpeed, altitude: elevation.smoothed,
          hasElevation: Boolean(stats?.hasElevation), grades, speedUnit, distanceUnit, inverse, heartRate: heart.smoothed,
          cadence: cadencePresent ? cadence!.smoothed : null,
        })
      : []),
    [chartRowsNeeded, gpx.track, trackDist, zoom.view, chartSpeed, elevation, stats, grades, speedUnit, distanceUnit, inverse, heart.smoothed, cadence, cadencePresent]
  );
  /** Dérive et nuage FC / vitesse de l'onglet « cardio » : vitesse des graphes, temps en mouvement. */
  /** Rappels de l'onglet « cardio », stables : le panneau, mémoïsé, ne se redessine pas au zoom d'un autre graphe. */
  const firstMs = gpx.track[0]?.timeMs ?? null;
  const retainSessionHrMax = useCallback((bpm: number) => retainHr('hrMax', bpm, { kind: 'seance', atMs: firstMs }), [retainHr, firstMs]);
  const { show: showZoomOnMap } = zoomOnMap;
  const showCardioOnMap = useCallback(() => showZoomOnMap('cardio'), [showZoomOnMap]);
  const heartEfficiency = useMemo((): HeartRateEfficiency => ({ speedsMs: chartSpeed, active: activityMask, speedUnit }), [chartSpeed, activityMask, speedUnit]);

  /** Arrêts du dégradé de pente, sur l'étendue des lignes qui portent une altitude (celle de l'aire tracée). */
  const gradeStops = useMemo(
    () => gradeGradientStops(chartData.filter((row) => row.altitude !== null), gradeRange),
    [chartData, gradeRange]
  );
  /** Profil compact de l'onglet « général » : sa plage zoomée, au plus `PROFILE_MAX_POINTS` lignes. */
  const profileRows = useMemo((): ElevationProfileRow[] => {
    if (!open.general || !stats?.hasElevation || gpx.track.length < 2) return [];
    const [first, last] = visibleIndexRange(trackDist, profileZoom.view);
    return sampledIndices(first, last, PROFILE_MAX_POINTS, elevation.smoothed).map((i) => {
      const altitude = elevation.smoothed[i];
      return {
        index: i,
        dist: toFixedNumber(trackDist[i], 3),
        altitude: isFinite(altitude) ? Math.round(altitude) : null,
        grade: isFinite(grades[i]) ? grades[i] : null,
      };
    });
  }, [open.general, stats, gpx.track, elevation, trackDist, grades, profileZoom.view]);
  const profileStops = useMemo(
    () => gradeGradientStops(profileRows.filter((row) => row.altitude !== null), gradeRange),
    [profileRows, gradeRange]
  );
  const gradientId = useId();
  const overlayGradientId = `${gradientId}-superpose`;
  const separateGradientId = `${gradientId}-separe`;
  const profileGradientId = `${gradientId}-profil`;
  const zonesGradientId = `${gradientId}-zones`;

  /** Traits de la trace colorée par la vitesse, mémorisés : le survol d'un graphe ne les redessine pas (`TrackSegmentsLayer`). */
  const treatment = sportTreatment(sport);
  const mapSegments = useMemo(
    (): TrackSegment[] => trackColorSegments(gpx.track, treatment, { minMs: range.minMs, maxMs: range.maxMs }),
    [gpx.track, treatment, range.minMs, range.maxMs]
  );

  const mapBounds = useMemo(() => trackBounds(gpx.track), [gpx.track]);

  /** Chiffres de l'onglet « général », proposés aussi pour l'image de partage. */
  const generalStats: ShareStat[] = stats ? [
    { key: 'distance', label: 'Distance', value: formatDistance(stats.distanceM, distanceUnit) },
    { key: 'activeDistance', label: 'Distance en mouvement', value: formatDistance(stats.activeDistanceM, distanceUnit) },
    { key: 'totalTime', label: 'Temps de parcours', value: stats.totalTime },
    { key: 'activeTime', label: `Temps en mouvement (${commaDecimal(stats.activeRatio)} %)`, value: stats.activeTime },
    { key: 'movingAverage', label: 'Moyenne en mouvement', value: formatSpeed(positiveSpeed(stats.activeAvgSpeedMs), speedUnit, distanceUnit) },
    { key: 'overallAverage', label: 'Moyenne sur le temps total', value: formatSpeed(positiveSpeed(stats.avgSpeedMs), speedUnit, distanceUnit) },
    { key: 'elevationGain', label: 'Dénivelé', value: stats.hasElevation ? `+${stats.elevationGain} / -${stats.elevationLoss} m` : '—' },
    { key: 'altitude', label: 'Altitude', value: stats.hasElevation ? `${stats.elevationMin} à ${stats.elevationMax} m` : '—' },
    ...(heart.present && heart.stats ? [{ key: 'heartRate', label: 'FC moyenne', value: `${Math.round(heart.stats.avgBpm)} bpm` }] : []),
  ] : [];

  /**
   * Chiffres de l'onglet « général » (22/10) : l'essentiel, le détail restant dans « avancé ».
   * L'image de partage garde la liste entière (`generalStats`).
   */
  const energyTotal = model.treatment === 'velo' ? energy?.stats.find((stat) => stat.key === 'total' && stat.value !== '—') ?? null : null;
  const overviewStats: ShareStat[] = stats ? [
    { key: 'distance', label: 'Distance', value: formatDistance(stats.distanceM, distanceUnit) },
    { key: 'totalTime', label: 'Temps de parcours', value: stats.totalTime },
    { key: 'activeTime', label: `Temps en mouvement (${commaDecimal(stats.activeRatio)} %)`, value: stats.activeTime },
    { key: 'movingAverage', label: 'Moyenne en mouvement', value: formatSpeed(positiveSpeed(stats.activeAvgSpeedMs), speedUnit, distanceUnit) },
    { key: 'elevationGain', label: 'Dénivelé', value: stats.hasElevation ? `+${stats.elevationGain} / -${stats.elevationLoss} m` : '—' },
    ...overviewTargets.map((target) => {
      const top = overviewTops?.[target.key]?.[0];
      return {
        key: `top-${target.key}`,
        label: `${target.kind === 'time' ? 'Meilleures' : 'Meilleur'} ${target.label}`,
        value: top && top.speed !== null ? formatSpeed(top.speed, speedUnit, distanceUnit) : '—',
      };
    }),
    ...(heart.present && heart.stats ? [{ key: 'heartRate', label: 'FC moyenne', value: `${Math.round(heart.stats.avgBpm)} bpm` }] : []),
    ...(cadenceAnalysis ? [{ key: 'cadence', label: 'Cadence moyenne', value: `${Math.round(cadenceAnalysis.averageSpm)} pas/min` }] : []),
    ...(energyTotal ? [{ key: 'energy', label: 'Dépense totale', value: energyTotal.value }] : []),
  ] : [];


  /** Point de trace le plus proche d'un instant : relie la courbe d'un saut à la carte. */
  const trackIndexAt = useCallback((ms: number): number => nearestIndexAtTime(gpx.track, ms), [gpx.track]);


  /** Pente lue en un point, « , pente 6 % », ou rien. */
  const gradeText = (i: number) => (isFinite(grades[i]) ? `, pente ${Math.round(grades[i] * 100)} %` : '');
  /** Valeur d'un graphe de « graphiques » au point de trace `i`, dans les tableaux complets : celle de sa courbe. */
  const graphValue = (key: GraphFold, i: number): ReadoutValue => {
    switch (key) {
      case 'vitesse': {
        const ms = chartSpeed[i];
        return { text: inverse && ms < CHART_PACE_MIN_SPEED_MS ? '—' : formatSpeed(ms, speedUnit, distanceUnit), color: SPEED_COLOR };
      }
      case 'altitude': {
        const altitude = elevation.smoothed[i];
        return { text: stats?.hasElevation && isFinite(altitude) ? `${Math.round(altitude)} m${gradeText(i)}` : '—', color: ALTITUDE_COLOR };
      }
      case 'fc': {
        return heartRateValue(heart.smoothed[i]);
      }
      case 'cadence': {
        const spm = cadence?.smoothed[i];
        return { text: spm === null || spm === undefined ? '—' : `${Math.round(spm)} pas/min`, color: CADENCE_COLOR };
      }
    }
  };
  /** Lecture des graphes sur la distance (`HoverReadout`) au point survolé, s'il est dans la plage zoomée de `chartZoom`. */
  const graphReadout = (keys: readonly GraphFold[], chartZoom: ChartZoom = zoom) => (hoveredIndex: number): Readout | null =>
    trackDist[hoveredIndex] !== undefined && inChartView(chartZoom.view, trackDist[hoveredIndex])
      ? { values: keys.map((key) => graphValue(key, hoveredIndex)), at: distanceLabel(trackDist[hoveredIndex]) }
      : null;
  /** Lecture du graphe d'énergie : puissance ou cumul, puis vitesse et pente. */
  const energyReadout = (hoveredIndex: number): Readout | null => energy && trackMinutes[hoveredIndex] !== undefined
    && inChartView(energyZoom.view, trackMinutes[hoveredIndex])
    ? (() => {
      const i = hoveredIndex;
      const power = smoothedPower[i];
      const main = energyMode === 'power'
        ? (power !== undefined && isFinite(power) ? `${roundTo(power, 1)} ${energy.powerUnit}` : '—')
        : `${energy.cumulative[i]} ${energy.cumulativeUnit}`;
      return {
        values: [{ text: main, color: ALTITUDE_COLOR }, { text: `${formatSpeed(gpx.track[i].smoothedSpeedMs, speedUnit, distanceUnit)}${gradeText(i)}` }],
        at: formatClockMinutes(trackMinutes[i]),
      };
    })()
    : null;

  const speedAxis: TrackYAxis = {
    id: 'speed',
    color: SPEED_COLOR,
    unit: unitLabel,
    domain: inverse ? ['auto', 'auto'] : [0, 'auto'],
    reversed: inverse,
    tickFormatter: (v) => formatSpeedValue(v, speedUnit),
    width: 46,
  };
  const altitudeAxis = (orientation: 'left' | 'right'): TrackYAxis => (
    { id: 'altitude', color: ALTITUDE_COLOR, unit: 'm', orientation, domain: ['auto', 'auto'], tickFormatter: (v) => `${v}`, width: 44 }
  );
  const distanceSymbol = DISTANCE_UNIT_SYMBOL[distanceUnit];
  /** Distance de l'infobulle, au centième. */
  const distanceLabel = (v: unknown) => `${commaDecimal(toFixedNumber(Number(v), 2))} ${distanceSymbol}`;
  /** Abscisse des graphes : la distance, graduations rondes zoom compris. */
  const distX = distanceX(distanceSymbol);
  /** Courbe de vitesse (ou d'allure), dans l'unité choisie. */
  const speedSeries: TrackSeries<TrackChartRow> = { kind: 'line', key: 'speed', name: 'Vitesse', yAxisId: 'speed', color: SPEED_COLOR, width: 2, activeDotR: 5 };

  /** Traits des repères sur les graphes, en abscisse de distance. */
  const markLines = (yAxisId: 'speed' | 'altitude' | 'hr' | 'cadence') =>
    markReferenceLines(marks.located, (m) => toDisplayDistance(m.distanceM, distanceUnit), shownMark, yAxisId);

  /** Graphes de l'onglet « graphiques » que la session peut montrer, dans l'ordre de la pile. */
  const graphCharts: { key: GraphFold; label: string; color: string }[] = [
    { key: 'vitesse', label: 'Vitesse', color: SPEED_COLOR },
    ...(stats?.hasElevation ? [{ key: 'altitude' as const, label: 'Altitude', color: ALTITUDE_COLOR }] : []),
    ...(heart.present ? [{ key: 'fc' as const, label: 'FC', color: HEART_RATE_COLOR }] : []),
    ...(cadencePresent ? [{ key: 'cadence' as const, label: 'Cadence', color: CADENCE_COLOR }] : []),
  ];
  /** Un seul graphe (ni altitude ni FC) : pas de repli, il reste montré. */
  const graphFoldable = graphCharts.length > 1;
  const graphOpen = (key: GraphFold) => !graphFoldable || graphFolds.open[key];
  const shownGraphs = graphCharts.filter((c) => graphOpen(c.key));
  const graphShown = (key: GraphFold) => shownGraphs.some((c) => c.key === key);
  /** Place d'un graphe de la pile : une hauteur de base, et sa part de la hauteur tirée à la poignée. */
  const chartBox = (heightPx: number): CSSProperties => ({ width: '100%', flex: `1 0 ${heightPx}px`, height: `${heightPx}px`, marginTop: '4px' });

  /** Graphe d'altitude coloré par la pente : onglet « graphiques » et onglet « zones de pente ». */
  const altitudeChart = (gradientKey: string, showReset: boolean, panel: 'graphiques' | 'zones') => (
    <TrackChart rows={chartData} zoom={zoom} x={distX} yAxes={[altitudeAxis('left')]}
      series={[{ kind: 'area', key: 'altitude', name: 'Altitude', yAxisId: 'altitude', color: ALTITUDE_COLOR, width: 2, activeDotR: 5, fillOpacity: 0.35, gradient: { id: gradientKey, stops: gradeStops } }]}
      syncId={page.storageId} showReset={showReset} onShowOnMap={() => zoomOnMap.show(panel)} style={chartBox(CHART_HEIGHT_PX)}>
      {markLines('altitude')}
    </TrackChart>
  );

  /** Sous le graphe d'altitude : légende de la pente et « Voir sur la carte ». */
  const gradeLegend = stats?.hasElevation ? (
    <GradeLegendRow label="Altitude colorée par la pente, montée ou descente :" gradeRange={gradeRange} onMap={gradeOnMap} onToggleMap={toggleGradeOnMap} />
  ) : null;

  /** D'où vient l'altitude affichée. */
  /** Pourquoi « zones de pente » n'a rien à montrer : d'où viendrait l'altitude, et ce qu'il en est (demande du 19/10). */
  const zonesEmptyText = (() => {
    if (stats?.hasElevation) return 'Pas assez de mouvement pour des zones de pente.';
    switch (terrainElevation.status) {
      case 'searching':
        return "Pas d'altitude dans le fichier : celle de l'IGN est en cours de chargement…";
      case 'outside':
        return "Pas d'altitude dans le fichier, et la trace est hors de la couverture de l'IGN (France).";
      case 'error':
        return `Pas d'altitude dans le fichier, et celle de l'IGN n'a pas pu être chargée. ${terrainElevation.error ?? ''}`.trim();
      case 'off':
        return "Pas d'altitude dans le fichier, et celle de l'IGN est écartée dans l'onglet réglages de la session.";
      case 'ready':
        return "L'altitude de l'IGN ne couvre pas assez de la trace pour des zones de pente.";
    }
  })();

  const elevationSource = gpx.track.length > 1 ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', color: terrainElevation.status === 'error' ? 'var(--danger)' : 'var(--muted)', fontSize: 'var(--text-xs)', marginTop: '6px', flexShrink: 0 }}>
      <span>{elevationSourceText(terrainElevation.status, terrainElevation.stepM, terrainElevation.error)}</span>
      {terrainElevation.status === 'error' && <Button size="s" onClick={terrainElevation.retry}>Réessayer</Button>}
    </div>
  ) : null;

  /** Bouton de repli d'un graphe de l'onglet « graphiques ». */
  const graphFold = (c: { key: GraphFold; label: string; color: string }, style?: CSSProperties) => graphFoldable && (
    <ChartFold key={`pli-${c.key}`} label={c.label} color={c.color} open={graphFolds.open[c.key]} onToggle={() => graphFolds.toggle(c.key)}
      title={graphFolds.open[c.key] ? `Replier le graphe ${c.label === 'FC' ? 'de FC' : `de ${c.label.toLowerCase()}`}` : `Montrer le graphe ${c.label === 'FC' ? 'de FC' : `de ${c.label.toLowerCase()}`}`}
      style={style} />
  );

  /** « +carte » des graphes de « graphiques ». */
  const showGraphsOnMap = () => zoomOnMap.show('graphiques');
  /** Un graphe de la pile, en mode séparé ; « Tout voir » sur le premier montré, « +carte » sur chacun. */
  const separateChart = (key: GraphFold, showReset: boolean, altitudeGradientId: string): ReactNode => {
    switch (key) {
      case 'vitesse':
        return (
          <TrackChart rows={chartData} zoom={zoom} x={distX} yAxes={[speedAxis]} series={[speedSeries]}
            syncId={page.storageId} showReset={showReset} onShowOnMap={showGraphsOnMap} style={chartBox(CHART_HEIGHT_PX)}>
            {markLines('speed')}
          </TrackChart>
        );
      case 'altitude':
        return (
          <>
            {altitudeChart(altitudeGradientId, showReset, 'graphiques')}
            {gradeLegend}
          </>
        );
      case 'fc':
        return (
          <HeartRateChart data={chartData} zoom={zoom} x={distX} zones={hrZones?.bounds ?? null} thresholds={hrZones ? { s1: hrZones.s1, s2: hrZones.s2 } : null}
            syncId={page.storageId} showReset={showReset} onShowOnMap={showGraphsOnMap}
            style={chartBox(CHART_HEIGHT_PX)}>
            {markLines('hr')}
          </HeartRateChart>
        );
      case 'cadence':
        return (
          <TrackChart rows={chartData} zoom={zoom} x={distX}
            yAxes={[{ id: 'cadence', color: CADENCE_COLOR, unit: 'pas/min', domain: ['dataMin - 5', 'dataMax + 5'], allowDecimals: false, width: 46, tickFormatter: (v) => `${Math.round(v)}` }]}
            series={[{ kind: 'line', key: 'cadence', name: 'Cadence', yAxisId: 'cadence', color: CADENCE_COLOR, width: 2, activeDotR: 5 }]}
            syncId={page.storageId} showReset={showReset} onShowOnMap={showGraphsOnMap} style={chartBox(CHART_HEIGHT_PX)}>
            {markLines('cadence')}
          </TrackChart>
        );
    }
  };

  /** Axe des repères du graphe superposé : celui de la première série montrée. */
  const overlayMarkAxis: 'speed' | 'altitude' | 'hr' | 'cadence' = graphShown('vitesse') ? 'speed' : graphShown('altitude') ? 'altitude' : graphShown('fc') ? 'hr' : 'cadence';

  /**
   * Axes du graphe superposé : vitesse à gauche, altitude à droite (à gauche
   * sans vitesse) ; FC et cadence sans axe à elles tant qu'elles ne sont pas
   * seules (leur valeur se lit au-dessus du graphe).
   */
  const overlayAxes: TrackYAxis[] = [];
  if (graphShown('vitesse')) overlayAxes.push(speedAxis);
  if (graphShown('altitude')) overlayAxes.push(altitudeAxis(graphShown('vitesse') ? 'right' : 'left'));
  if (graphShown('fc')) overlayAxes.push({ id: 'hr', color: HEART_RATE_COLOR, hide: shownGraphs.length > 1, domain: ['dataMin - 5', 'dataMax + 5'], width: 46 });
  if (graphShown('cadence')) overlayAxes.push({ id: 'cadence', color: CADENCE_COLOR, hide: shownGraphs.length > 1, domain: ['dataMin - 5', 'dataMax + 5'], width: 46 });
  /** Séries du graphe superposé, l'aire d'altitude dessous ; `idSuffix` distingue son dégradé. */
  const overlaySeries = (idSuffix: string): TrackSeries<TrackChartRow>[] => {
    const series: TrackSeries<TrackChartRow>[] = [];
    if (graphShown('altitude')) {
      series.push({
        kind: 'area', key: 'altitude', name: 'Altitude', yAxisId: 'altitude', color: ALTITUDE_COLOR, width: 1.5, activeDotR: 4, fillOpacity: 0.3,
        gradient: { id: `${overlayGradientId}${idSuffix}`, stops: gradeStops },
      });
    }
    if (graphShown('vitesse')) series.push(speedSeries);
    if (graphShown('fc')) series.push({ kind: 'line', key: 'hr', name: 'FC', yAxisId: 'hr', color: HEART_RATE_COLOR, width: 1.5, activeDotR: 4 });
    if (graphShown('cadence')) series.push({ kind: 'line', key: 'cadence', name: 'Cadence', yAxisId: 'cadence', color: CADENCE_COLOR, width: 1.5, activeDotR: 4 });
    return series;
  };

  /**
   * Pile des graphes de « graphiques », Séparés ou Superposés, replis
   * compris : dans le panneau, et sous la carte en plein écran (`idSuffix`
   * y distingue leurs dégradés).
   */
  const graphStack = (idSuffix: string): ReactNode => chartMode === 'overlay' ? (
    <>
      {/* Les mêmes replis : une série repliée n'est pas tracée. */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', flexShrink: 0 }}>
        {graphCharts.map((c) => graphFold(c))}
      </div>
      <HoverReadout line read={graphReadout(shownGraphs.map((c) => c.key))} />
      {shownGraphs.length > 0 && (
        <TrackChart rows={chartData} zoom={zoom} x={distX} yAxes={overlayAxes} series={overlaySeries(idSuffix)}
          syncId={page.storageId} onShowOnMap={showGraphsOnMap} style={chartBox(OVERLAY_CHART_HEIGHT_PX)}>
          {markLines(overlayMarkAxis)}
        </TrackChart>
      )}
      {graphShown('altitude') && gradeLegend}
    </>
  ) : graphCharts.map((c, k) => (
    <Fragment key={c.key}>
      {/* Nom du graphe (son repli) et sa lecture à droite. */}
      <div className="chart-head" style={{ marginTop: k > 0 ? '8px' : 0 }}>
        {graphFold(c)}
        {graphOpen(c.key) && <HoverReadout read={graphReadout([c.key])} label={graphFoldable ? undefined : c.label} color={c.color} />}
      </div>
      {graphOpen(c.key) && separateChart(c.key, shownGraphs[0]?.key === c.key, `${separateGradientId}${idSuffix}`)}
    </Fragment>
  ));

  /** Graphe de l'onglet énergie, avec sa lecture au-dessus : dans le panneau, et sous la carte en plein écran. */
  const energyChart = energy && energyChartData.length > 1 ? (
    <>
      <HoverReadout line read={energyReadout} label={energyMode === 'power' ? 'Puissance' : 'Énergie'} color={ENERGY_COLOR} />
      <TrackChart rows={energyChartData} zoom={energyZoom} x={elapsedX()}
        yAxes={[{ color: ENERGY_COLOR, unit: energyMode === 'power' ? energy.powerUnit : energy.cumulativeUnit, domain: [0, 'auto'], width: 50 }]}
        series={energyMode === 'power'
          ? [{ kind: 'line', key: 'power', name: 'Puissance', color: ENERGY_COLOR, width: 2, activeDotR: 5 }]
          : [{ kind: 'area', key: 'cumulative', name: 'Énergie dépensée', color: ENERGY_COLOR, width: 2, activeDotR: 5, fillOpacity: 0.15 }]}
        onShowOnMap={() => zoomOnMap.show('energie')} style={{ width: '100%', flex: `1 0 ${ENERGY_CHART_HEIGHT_PX}px`, height: `${ENERGY_CHART_HEIGHT_PX}px`, marginTop: '6px' }} />
    </>
  ) : null;

  /** Graphe d'altitude de l'onglet « zones de pente », et sa légende. */
  const zonesAltitude = (idSuffix: string) => (
    <>
      {altitudeChart(`${zonesGradientId}${idSuffix}`, true, 'zones')}
      {gradeLegend}
    </>
  );

  /** Profil d'altitude de « général », dans son panneau ou sous la carte en plein écran (`gradientSuffix`). */
  const generalProfile = (gradientSuffix: string) => (
    <ElevationProfileMini rows={profileRows} stops={profileStops} gradientId={`${profileGradientId}${gradientSuffix}`} distanceSymbol={distanceSymbol}
      zoom={profileZoom} read={graphReadout(['altitude'], profileZoom)}
      onShowOnMap={() => zoomOnMap.show('general')} />
  );

  const companionCharts = (panel: LandTab | null): ReactNode => {
    switch (panel) {
      case 'general':
        return profileRows.length > 1 ? generalProfile('-plein') : null;
      case 'graphiques':
        return graphStack('-plein');
      case 'zones':
        return (
          <>
            <HoverReadout line read={graphReadout(['altitude'])} label="Altitude" color={ALTITUDE_COLOR} />
            {zonesAltitude('-plein')}
          </>
        );
      case 'energie':
        return energyChart;
      case 'cardio':
        return <CardioCompanion minutes={trackMinutes} heart={heart} zoom={cardioZoom} zones={hrZones} onShowOnMap={() => zoomOnMap.show('cardio')} style={chartBox(CHART_HEIGHT_PX)} />;
      case 'test':
        return sessionTest ? (
          <FitnessTestCurves track={gpx.track} test={sessionTest} minutes={trackMinutes} speedsMs={chartSpeed} hrSmoothed={heart.smoothed}
            speedUnit={speedUnit} zoom={testZoom} 
            onShowOnMap={() => zoomOnMap.show('test')} />
        ) : null;
      default:
        return null;
    }
  };

  /** Couches de la carte, partagées par la carte compacte et sa vue agrandie (tap, écran étroit). */
  const mapLayers = (
    <AnalysisBaseLayers family={family} track={gpx.track} zonePaths={hrZone.paths} zonePathsKey={hrZone.selectedZone}
      zoomPath={zoomOnMap.path} marks={marks.located} shownMark={shownMark}>
      {/* Pente : ses tronçons colorés sur le même canevas que la vitesse, pas en milliers de traits SVG (27/10). */}
      {surfaceMapPaths ? <SurfaceLayer paths={surfaceMapPaths} /> : <TrackSegmentsLayer segments={gradeMapPaths ?? mapSegments} weight={5} family={family} />}
      {/* Surbrillances : une seule à la fois (`useMapHighlight`), leur ordre ne se voit pas. */}
      {zonePaths.map((path, idx) => (
        <HighlightPath key={`zone-${selectedZone}-${idx}`} positions={path} color={HIGHLIGHT_SHOWN_COLOR} />
      ))}
      {cadencePaths.map((path, idx) => (
        <HighlightPath key={`cadence-${selectedCadenceBand}-${idx}`} positions={path} color={HIGHLIGHT_SHOWN_COLOR} />
      ))}
      {selectedSurface && surfaces.paths && <SurfaceHighlight paths={surfaces.paths} category={selectedSurface} />}
      {selectedLapPath.length > 1 && (
        <HighlightPath key={`fractionne-${selectedLap}`} positions={selectedLapPath} color={HIGHLIGHT_SHOWN_COLOR} />
      )}
      <TopsHighlight tops={tops} selected={selectedTop} />
      {jumpsVisible && <JumpMapLayer track={gpx.track} jumps={jumps.jumps} shownJump={jumps.shownJump} podiumShown={jumps.podiumShown} />}
    </AnalysisBaseLayers>
  );

  return (
    <AnalysisShell title={isTestSport(profile.id) ? 'Analyse test' : page.title} family={family} backLabel={page.backLabel} file={gpx.fileName}
      share={{ segments: mapSegments, stats: generalStats }} error={sessionError} draft={draft} loadError={gpx.error}
      empty={!stats && !gpx.error && requestedFile === null}
      map={{
        panelId: panelId('carte'),
        expanded: mapExpanded,
        onExpandedChange: (next) => {
          setMapExpanded(next);
          if (!next) zoomOnMap.closeCompanion();
        },
        focus: zoomOnMap.focus,
        companion: companionCharts(zoomOnMap.companionPanel),
        sessionKey: gpx.sessionKey,
        bounds: mapBounds,
        layers: mapLayers,
        defaultHeight: 480,
        legend: gpx.track.length === 0 || surfaceMapPaths ? null
          : gradeMapPaths ? <GradeGradientLegend range={gradeRange} />
            : <SpeedGradientLegend unit={speedUnit} distanceUnit={distanceUnit} range={range} slowLabel={model.slowLabel} />,
      }}
      // Onglets sous la carte, et leurs panneaux deux par ligne sur ordinateur (`docs/MISE_EN_PAGE.md`).
      tabs={stats ? {
        sections, open, onToggle: toggle, advanced, accent: page.accent, panels: (
          <>
            {open.general && (
              <ResizablePanel id={panelId('general')} style={ANALYSIS_PANEL_STYLE}>
                <PanelHeading label="Général" extra={<SessionDate track={gpx.track} />} open={open.general} onToggle={toggleOf('general')} />
                <GeneralStats stats={overviewStats} />
                {profileRows.length > 1 && generalProfile('')}
                {!stats.hasElevation && (
                  <div style={{ color: 'var(--danger)', fontSize: 'var(--text-s)' }}>Le fichier ne porte pas d'altitude sur assez de points : pas de dénivelé ni de zones de pente.</div>
                )}
                <SessionMarksList view={marks} distanceUnit={distanceUnit} shownMs={shownMark} accent={page.accent}
                  onShow={(ms) => highlight.show('general', ms === null ? null : String(ms))} />
              </ResizablePanel>
            )}

            {open.fractionne && hasIntervals && profile.intervals && (intervalViews.length > 0 || intervalEmptyText !== null) && (
              <IntervalAnalysis
                series={intervalViews}
                stepS={profile.intervals.profileStepS}
                launchFraction={profile.intervals.launchFraction}
                samplingS={gpx.samplingS}
                speedUnit={speedUnit}
                distanceUnit={distanceUnit}
                panelId={panelId}
                open={open.fractionne}
                onToggle={toggleOf('fractionne')}
                selectedLap={selectedLap}
                onSelectLap={setSelectedLap}
                emptyText={intervalEmptyText}
                recoveryS={profile.heartRate.recoveryS}
                sessionKey={gpx.sessionKey} />
            )}

            {open.test && isTestSport(profile.id) && (sessionTest ? (
              <ResizablePanel id={panelId('test')} style={ANALYSIS_PANEL_STYLE}>
                <FitnessTestPanel track={gpx.track} test={sessionTest} minutes={trackMinutes} speedsMs={chartSpeed} hrSmoothed={heart.smoothed}
                  speedUnit={speedUnit} profileHrMax={runner.hrMax} onRetainHrMax={(bpm) => retainHr('hrMax', bpm, { kind: 'test', atMs: sessionTest.startMs })}
                  zoom={testZoom} 
                  onShowOnMap={() => zoomOnMap.show('test')} open={open.test} onToggle={toggleOf('test')} />
              </ResizablePanel>
            ) : (
              <EmptyTabPanel id={panelId('test.vide')} label="Test" open={open.test} onToggle={toggleOf('test')}>
                Cette session n'a pas de test guidé dans sa fiche : un test se lance depuis Entraînement › Tests, et ses résultats arrivent ici.
              </EmptyTabPanel>
            ))}

            {open.tops && tops && (
              <ResizablePanel id={panelId('tops')} style={ANALYSIS_PANEL_STYLE}>
                <TopsPanel targets={profile.topTargets} tops={tops} unit={topUnit} selected={selectedTop} onSelect={setSelectedTop}
                  accent={page.accent} open={open.tops} onToggle={toggleOf('tops')} />
              </ResizablePanel>
            )}

            {open.graphiques && chartData.length > 1 && (
              <ResizablePanel id={panelId('graphiques')} minHeight={120} direction="vertical"
                style={{ ...PANEL_BLOCK_STYLE, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '8px', paddingRight: '28px' }}>
                  <PanelTitle label="Graphiques" open={open.graphiques} onToggle={toggleOf('graphiques')} helpKey="analyse:graphiques" />
                  <span style={{ flex: 1 }} />
                  <SegmentedControl<ChartMode> label="Disposition des graphes" accent={page.accent} value={chartMode} onChange={setChartMode}
                    items={[{ key: 'separate', label: 'Séparés' }, { key: 'overlay', label: 'Superposés' }]} />
                </div>
                <HelpText helpKey="analyse:graphiques" note>
                  Vitesse lissée sur 10 s{inverse ? ', axe inversé : plus haut, plus vite' : ''}. Le survol d'un graphe déplace le repère sur l'autre graphe et sur la carte.
                  {graphFoldable && ' Chaque graphe se replie par son nom.'}
                  {` ${zoomHint(narrow)}${narrow ? '' : ' Poignée en bas à droite pour redimensionner.'}`}
                </HelpText>

                {graphStack('')}
                {(!stats?.hasElevation || graphShown('altitude')) && elevationSource}
              </ResizablePanel>
            )}

            {open.cardio && heart.present && (
              <CardioTab id={panelId('cardio')} track={gpx.track} minutes={trackMinutes} heart={heart} params={profile.heartRate} zones={hrZones} runner={runner}
                onRetainHrMax={retainSessionHrMax} zone={hrZone}
                efficiency={heartEfficiency}
                zoom={cardioZoom} onShowOnMap={showCardioOnMap}
                open={open.cardio} onToggle={toggleOf('cardio')} />
            )}

            {open.cadence && cadenceAnalysis && (
              <ResizablePanel id={panelId('cadence')} style={ANALYSIS_PANEL_STYLE}>
                <CadencePanel analysis={cadenceAnalysis} speedUnit={speedUnit} distanceUnit={distanceUnit} selectedBand={selectedCadenceBand} onSelectBand={setSelectedCadenceBand}
                  storagePrefix={page.storageId} open={open.cadence} onToggle={toggleOf('cadence')} />
              </ResizablePanel>
            )}

            {open.surface && (
              <ResizablePanel id={panelId('surface')} style={ANALYSIS_PANEL_STYLE}>
                <PanelHeading label="Surface" open={open.surface} onToggle={toggleOf('surface')} helpKey="analyse:surface" />
                <HelpText helpKey="analyse:surface" note>
                  Revêtement des voies d'OpenStreetMap à moins de {WAY_MATCH_DEFAULTS.radiusM} m de la trace, demandées à la première
                  ouverture de cet onglet puis gardées avec la session. Hors de toute voie : « Inconnu ». « Voir sur la carte » y colore
                  la trace selon le revêtement, à la place de la vitesse.
                </HelpText>
                {surfaces.totals && (
                  <SurfaceBar totals={surfaces.totals} distanceUnit={distanceUnit}
                    shownOnMap={surfaceOnMap} onToggleMap={toggleSurfaceOnMap}
                    selected={selectedSurface} onSelect={setSelectedSurface} />
                )}
                {surfaces.status === 'searching' && (
                  <div style={{ color: 'var(--muted)' }}>Recherche des voies sur OpenStreetMap…</div>
                )}
                {surfaces.status === 'error' && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: 'var(--danger)' }}>{surfaces.error}</span>
                    <Button size="s" onClick={surfaces.retry}>Réessayer</Button>
                  </div>
                )}
              </ResizablePanel>
            )}

            {open.energie && energy && (
              <ResizablePanel id={panelId('energie')} minHeight={320} direction="vertical"
                style={{ ...PANEL_BLOCK_STYLE, display: 'flex', flexDirection: 'column', overflow: 'auto', fontSize: 'var(--text-s)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '10px', paddingRight: '28px' }}>
                  <PanelTitle label={model.energyLabel} open={open.energie} onToggle={toggleOf('energie')} helpKey="analyse:energie" />
                  <span style={{ flex: 1 }} />
                  {energy.power.length > 0 && (
                    <SegmentedControl<EnergyChartMode> label="Courbe d'énergie" accent={page.accent} value={energyMode} onChange={setEnergyMode}
                      items={[{ key: 'power', label: 'Puissance' }, { key: 'cumulative', label: 'Cumulée' }]} />
                  )}
                  <ChartFold label="Chiffres" open={energyFold.open.chiffres} onToggle={() => energyFold.toggle('chiffres')}
                    title={energyFold.open.chiffres ? 'Replier les chiffres pour voir le graphe et la carte ensemble' : 'Montrer les chiffres'}
                    style={{ alignSelf: 'auto', padding: '4px 8px 4px 12px' }} />
                </div>
                <HelpText helpKey="analyse:energie" note>
                  {energy.note}
                  {' '}Puissance lissée sur {ENERGY_POWER_SMOOTHING_S} s, moins près du départ et des arrêts, interrompue aux pauses.
                  {stats?.hasElevation && ' Puissance d\'une zone : sa moyenne en mouvement, roue libre et arrêts courts compris.'}
                </HelpText>
                {energyFold.open.chiffres && (
                  <>
                    {energy.warning && (
                      <div className="ui-alert ui-alert--warning" style={{ marginBottom: '10px' }}>
                        {energy.warning}
                      </div>
                    )}
                    <div className="an-sheet__stats an-sheet__stats--always" style={{ flexShrink: 0 }}>
                      {energy.stats.map((stat) => (
                        <StatTile key={stat.label} label={stat.label} value={stat.value} detail={stat.detail} />
                      ))}
                    </div>
                    {!stats?.hasElevation && (
                      <div style={{ color: 'var(--danger)', fontSize: 'var(--text-s)', marginBottom: '6px' }}>{model.flatWarning}</div>
                    )}
                  </>
                )}

                {energyChart}

                {/* À la place du tableau : flèche vers le haut pour le replier, vers le bas pour le montrer. */}
                {stats?.hasElevation && energy.zones.length > 0 && (
                  <ChartFold label="Énergie par zone de pente" open={energyFold.open.zones} onToggle={() => energyFold.toggle('zones')}
                    title={energyFold.open.zones ? 'Replier le tableau des zones de pente' : 'Montrer le tableau des zones de pente'}
                    style={{ marginTop: '12px', padding: '4px 8px 4px 12px' }} />
                )}
                {stats?.hasElevation && energy.zones.length > 0 && energyFold.open.zones && (
                  <table className="ui-table" style={{ marginTop: '6px', flexShrink: 0 }}>
                    <thead>
                      <tr style={{ backgroundColor: 'var(--surface-sunken)' }}>
                        <th style={{ textAlign: 'left', padding: '0.4em 0.6em' }}>Zone</th>
                        <th style={{ padding: '0.4em 0.6em' }}>Énergie</th>
                        <th style={{ padding: '0.4em 0.6em' }}>Part</th>
                        <th style={{ padding: '0.4em 0.6em' }}>Par km</th>
                        <th style={{ padding: '0.4em 0.6em' }} title="Puissance mécanique moyenne en mouvement dans la zone">Puissance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {energy.zones.map((z) => (
                        <tr key={z.zone.key} className={z.distanceM > 0 ? 'ui-table__row' : 'ui-table__row ui-table__row--empty'}>
                          <td style={{ padding: '0.4em 0.6em', fontWeight: 700 }}>{z.zone.label} <span style={{ color: 'var(--muted)', fontWeight: 'normal', fontSize: 'var(--text-xs)' }}>{z.zone.range}</span></td>
                          <td style={{ padding: '0.4em 0.6em', textAlign: 'center' }}>{z.energy}</td>
                          <td style={{ padding: '0.4em 0.6em', textAlign: 'center' }}>{Math.round(z.share * 100)} %</td>
                          <td style={{ padding: '0.4em 0.6em', textAlign: 'center', fontWeight: 700 }}>{z.perKm}</td>
                          <td style={{ padding: '0.4em 0.6em', textAlign: 'center' }}>{z.power}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </ResizablePanel>
            )}

            {open.zones && zoneStats.length === 0 && stats && (
              <EmptyTabPanel id={panelId('zones.vide')} label={model.zonesTitle} open={open.zones} onToggle={toggleOf('zones')}
                action={!stats.hasElevation && terrainElevation.status === 'error'
                  ? <Button size="s" onClick={terrainElevation.retry}>Réessayer</Button>
                  : undefined}>
                {zonesEmptyText}
              </EmptyTabPanel>
            )}
            {open.zones && zoneStats.length > 0 && (
              <ResizablePanel id={panelId('zones')} direction="vertical"
                style={{ ...PANEL_BLOCK_STYLE, display: 'flex', flexDirection: 'column', overflow: 'auto', fontSize: 'var(--text-s)' }}>
                <div style={{ marginBottom: '10px' }}>
                  <PanelTitle
                    label={model.zonesTitle}
                    extra={<span style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)', fontWeight: 'normal' }}>(en mouvement)</span>}
                    open={open.zones}
                    onToggle={toggleOf('zones')}
                    helpKey="analyse:zones" />
                </div>
                <HelpText helpKey="analyse:zones" note>
                  Pente mesurée sur {2 * profile.grade.halfWindowM} m d'altitude lissée. Les pauses sont exclues de chaque zone. « Voir » montre ses passages sur la carte, en violet.
                </HelpText>
                {chartData.length > 1 && (
                  <ChartFold label="Tableau" open={zonesFold.open.tableau} onToggle={() => zonesFold.toggle('tableau')}
                    title={zonesFold.open.tableau ? 'Replier le tableau des zones de pente' : 'Montrer le tableau des zones de pente'}
                    style={{ marginBottom: '6px' }} />
                )}
                {(zonesFold.open.tableau || chartData.length <= 1) && (<>
                <table className="ui-table" style={{ flexShrink: 0 }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--surface-sunken)' }}>
                      <th style={{ textAlign: 'left', padding: '0.4em 0.6em' }}>Zone</th>
                      <th style={{ padding: '0.4em 0.6em', fontWeight: 'normal', color: 'var(--muted)' }}>Pente</th>
                      <th style={{ padding: '0.4em 0.6em' }}>Distance</th>
                      <th style={{ padding: '0.4em 0.6em' }}>Temps</th>
                      <th style={{ padding: '0.4em 0.6em' }}>Vitesse ({unitLabel})</th>
                      <th style={{ padding: '0.4em 0.6em' }}>Carte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zoneStats.map((z) => {
                      const reached = z.distanceM > 0;
                      const shown = selectedZone === z.zone.key;
                      return (
                        <tr key={z.zone.key} className={z.timeMs > 0 ? 'ui-table__row' : 'ui-table__row ui-table__row--empty'}>
                          <td style={{ padding: '0.4em 0.6em', fontWeight: 700 }}>{z.zone.label}</td>
                          <td style={{ padding: '0.4em 0.6em', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>{z.zone.range}</td>
                          <td style={{ padding: '0.4em 0.6em', textAlign: 'center' }}>{formatDistance(z.distanceM, distanceUnit)} <span style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>({Math.round(z.distanceShare * 100)} %)</span></td>
                          <td style={{ padding: '0.4em 0.6em', textAlign: 'center' }}>{z.time}</td>
                          <td style={{ padding: '0.4em 0.6em', textAlign: 'center', fontWeight: 700 }}>{formatSpeed(z.avgSpeedMs, speedUnit, distanceUnit)}</td>
                          <td style={{ padding: '0.4em 0.6em', textAlign: 'center' }}>
                            <MapToggle shown={shown} disabled={!reached} color={HIGHLIGHT_SHOWN_COLOR} onClick={() => setSelectedZone(shown ? null : z.zone.key)} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {ungradedS > 0 && (
                  <p style={{ margin: 'var(--space-1) 0 0', color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>
                    Passages sans altitude : hors des zones ; l'énergie les compte au plat.
                  </p>
                )}
                </>)}
                {/* Le graphe d'altitude de l'onglet « graphiques », avec ses options : même zoom, même survol, même « Voir sur la carte ». */}
                {chartData.length > 1 && (
                  <>
                    <GraphFoldHead label="Altitude" color={ALTITUDE_COLOR} open={zonesFold.open.graphe} onToggle={() => zonesFold.toggle('graphe')}
                      read={graphReadout(['altitude'])} style={{ marginTop: '12px' }}
                      title={zonesFold.open.graphe ? "Replier le graphe d'altitude" : "Montrer le graphe d'altitude"} />
                    {zonesFold.open.graphe && (
                      <>
                        {zonesAltitude('')}
                        {elevationSource}
                      </>
                    )}
                  </>
                )}
              </ResizablePanel>
            )}

            {open.sauts && jumpsVisible && (
              <JumpsPanel
                status={jumps.status}
                error={jumps.error}
                jumps={jumps.jumps}
                hiddenCount={jumps.hiddenCount}
                minHeightM={jumps.minHeightM}
                thresholdLabel={formatSpeed(thresholdMs, editSpeedUnit(speedUnit))}
                speedUnit={speedUnit}
                distanceUnit={distanceUnit}
                open={open.sauts}
                onToggle={toggleOf('sauts')}
                shownJump={jumps.shownJump}
                onShowJump={jumps.showJump}
                podiumShown={jumps.podiumShown}
                onTogglePodium={jumps.togglePodium}
                trackIndexAt={trackIndexAt}
                panelPrefix={page.storageId}
                accent={page.accent}
                sailing={false}
              />
            )}

            {stats && open.notes && (
              <NotesTab id={panelId('notes')} draft={draft} family={family} conditions="libre"
                gearFields={gearFieldsFor(gearLabels)} gearGroups={gearGroups} activityId={activity.id} open={open.notes} onToggle={toggleOf('notes')} />
            )}

            {stats && open.reglages && (
              <ResizablePanel id={panelId('reglages')} style={ANALYSIS_PANEL_STYLE}>
                <SessionSettingsHeader helpKey="analyse:reglages" open={open.reglages} onToggle={toggleOf('reglages')}>
                  Vitesse : {speedSourceText(gpx.hasDeviceSpeed, gpx.deviceSpeedUnit)}
                  {model.treatment === 'velo' && ` · Vélo : ${BIKE_TYPES[bikeType].noun} (Réglages)`}
                  {runner.weightKg !== null && ` · Poids : ${runner.weightKg} kg`}.
                </SessionSettingsHeader>
                <div style={{ display: 'flex', gap: '18px', alignItems: 'center', flexWrap: 'wrap', fontSize: 'var(--text-s)' }}>
                  <SessionActivityField activities={allActivities} activity={activity} withPositions families={sessionFile ? undefined : [family]}
                    onChange={(next) => changeSessionActivity(sessionFile, next)} />

                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }} title="Altitude du terrain (IGN), ou celle enregistrée par le GPS">
                    <strong>Altitude :</strong>
                    <select
                      value={terrainElevation.source}
                      disabled={!terrainElevation.canChangeSource}
                      onChange={(e) => terrainElevation.setSource(e.target.value === 'gps' ? 'gps' : 'ign')}
                      className="ui-field ui-field--s">
                      <option value="ign">IGN</option>
                      <option value="gps">GPS</option>
                    </select>
                  </label>
                </div>
                <div style={{ marginTop: '12px', fontSize: 'var(--text-s)' }}>
                  {model.treatment === 'velo' ? (
                    <SessionWeightField label="Poids du vélo et des bagages" valueKg={draft.edits.bikeWeightKg} activityKg={activityBikeKg}
                      isValid={isValidBikeWeight} onChange={(kg) => draft.update({ bikeWeightKg: kg })}
                      title={`Vélo ${BIKE_TYPES[bikeType].noun} ; pesanteur et roulement de l'énergie`} />
                  ) : (
                    <SessionWeightField label="Charge portée" valueKg={draft.edits.loadKg} activityKg={carriedLoadKg}
                      isValid={isValidCarriedLoad} onChange={(kg) => draft.update({ loadKg: kg })}
                      title="Sac, eau, affaires : ils augmentent le coût du déplacement dans l'énergie (pas le repos)" />
                  )}
                </div>
                {gpx.track.length > 0 && (
                  <div style={{ marginTop: '12px', fontSize: 'var(--text-s)' }}>
                    <SessionColorRangeField unit={speedUnit} range={range} isOverridden={draft.edits.speedRange !== null}
                      onChange={(next) => draft.update({ speedRange: next })} />
                  </div>
                )}
                {detected && (
                  <div style={{ marginTop: '12px', fontSize: 'var(--text-s)' }}>
                    <EffortThresholdEditor
                      unit={editSpeedUnit(speedUnit)}
                      valueMs={detected.thresholdMs}
                      suggestedMs={detected.suggestedThresholdMs}
                      isOverridden={draft.edits.effortThresholdMs !== null}
                      onChange={(next) => draft.update({ effortThresholdMs: next })} />
                  </div>
                )}
                {runner.weightKg === null && (
                  <div style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)', marginTop: '10px' }}>Poids non renseigné : voir Réglages › Pratiquant.</div>
                )}
              </ResizablePanel>
            )}
          </>
        ),
      } : null} />
  );
}

export default LandModule;
