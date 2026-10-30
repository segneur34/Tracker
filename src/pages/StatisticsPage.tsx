import { dayMonthYear } from '../core/calendar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from 'recharts';
import PageBackdrop from '../components/PageBackdrop';
import ChartFold from '../components/ChartFold';
import { HelpText, HelpToggle } from '../components/Help';
import { useHelp } from '../components/helpContext';
import PanelTitle, { PanelHeading } from '../components/PanelTitle';
import ResizablePanel from '../components/ResizablePanel';
import SectionTabs, { type SectionDefinition } from '../components/SectionTabs';
import ZoomableChart, { ChartZoomProbe } from '../components/ZoomableChart';
import { IconChevronRight } from '../components/icons';
import CardioLoadHelp from '../components/CardioLoadHelp';
import { HEART_RATE_COLOR, HEART_ZONE_COLORS, zoneLabel } from '../components/heartRateColors';
import { ANALYSIS_PANEL_STYLE, CARD_STYLE, HALF_PANEL_STYLE } from '../components/styles';
import PageHeader from '../components/ui/PageHeader';
import SegmentedControl from '../components/ui/SegmentedControl';
import { FAMILY_ACCENT, FAMILY_LABEL, activitiesOfFamily, activityFamily, type Activity } from '../core/activities';
import { SPORT_FAMILIES, SPORT_PROFILES, getSportProfile, type SportFamily } from '../core/sportProfiles';
import {
  formatDistanceAuto, formatDecimal,
  DISTANCE_UNIT_SYMBOL, speedUnitLabel, formatDuration, formatShortDuration, formatSpeed, formatSpeedValue, isInverseUnit,
  toDisplayDistance, toDisplaySpeed, type DistanceUnit, type SpeedUnit,
} from '../core/units';
import { useChartZoom } from '../hooks/useChartZoom';
import { useThemedShade } from '../hooks/useTheme';
import { useNarrowScreen } from '../hooks/useNarrowScreen';
import { useNow } from '../hooks/useNow';
import { useOpenSession } from '../hooks/useLibraryNavigation';
import { useOpenSections } from '../hooks/useOpenSections';
import { runnerHeartRateZones, type RunnerProfile } from '../running/runnerProfile';
import { useRunnerProfile } from '../hooks/useRunnerProfile';
import { useFavoriteBackdrop } from '../hooks/useFavoriteBackdrop';
import { useLibraryFields } from '../hooks/useSessionLibrary';
import { readStoredRecord, useStoredRecord } from '../hooks/useStoredRecord';
import { useVisibleStatSessions, visibleStatSessions } from '../hooks/useVisibleStatSessions';
import { effectiveDistanceUnit, effectiveHrOffset, effectiveSpeedUnit, useGearGroups, useVisibility } from '../hooks/useSportSettings';
import {
  STATS_PERIODS, TREND_SESSIONS, averageMovingSpeedMs, cardioLoadBars, cardioTotals, dateTicks, defaultMetricKey, heartRatePoints, formatDateTick,
  gearFilterItems, groupTotals, inBounds, isStatsMetricKey, matchesGear, isStatsPeriod, metricSeries, metricsOf, recordKindsOf, regularity, statsMetric,
  statsPeriodBounds, statsTotals, topSessions, weeklyDurations, type MetricPoint, type StatSession, type StatsMetricKey, type StatsPeriod, type StatsRecordKind,
  type StatsTotals, type ZoneBoundsOf,
  groupByActivity,
} from '../library/stats';
import './analysisMobile.css';
import './StatisticsPage.css';
import { plural } from '../core/basics';
import StatTile from '../components/ui/StatTile';
import { CHART_GRID_PROPS, CHART_TICK, OTHERS_COLOR, chartTick, yAxisLabel } from '../components/chartStyle';

/**
 * Statistiques (lot 5, étape 1) : une vue d'ensemble, puis une famille, puis
 * une activité, sur une période au choix, tirées du résumé des fiches sans
 * relire un seul GPX (`library/stats.ts`). Le choix est dans l'adresse
 * (`?famille=&activite=&materiel=&periode=`) : le retour arrière remonte d'un niveau.
 * Le filtre « Matériel » (lot 20) garde les sessions d'une activité qui
 * portent une pièce de son matériel enregistré.
 * Le dernier choix est retenu sur l'appareil : une adresse sans paramètre le
 * reprend à l'ouverture.
 * Les sessions d'une activité ou d'une famille cachée n'y sont pas, ni celles
 * à classer ; une famille cachée ouverte par son adresse montre tout.
 *
 * Onglets et panneaux comme les pages d'analyse (`docs/MISE_EN_PAGE.md`),
 * sans carte. Le graphique trace une donnée au choix par session ; dans la vue
 * d'ensemble, la durée seule, et pas de records : mêlées, les unités ne se
 * comparent pas.
 */

type StatsSection = 'general' | 'vitesse' | 'regularite' | 'records' | 'cardio';

const STATS_SECTIONS: SectionDefinition<StatsSection>[] = [
  { key: 'general', label: 'général' },
  // Clé d'avant le choix de la donnée, gardée : elle porte l'état et la taille mémorisés du panneau.
  { key: 'vitesse', label: 'graphique' },
  { key: 'regularite', label: 'régularité' },
  { key: 'records', label: 'records' },
  // Seulement quand une session de la période a de la FC ; les bpm se comparent d'une famille à l'autre.
  { key: 'cardio', label: 'cardio' },
];

const STATS_SECTION_DEFAULTS: Record<StatsSection, boolean> = { general: true, vitesse: true, regularite: true, records: false, cardio: false };

/** Coefficients de la charge : les mêmes dans tous les calculs (`HeartRateProfile`). */
const LOAD_WEIGHTS = SPORT_PROFILES.running.heartRate.loadWeights;

/** Seuils et zones du pratiquant pour une activité (décalés pour elle), ceux de la course sans activité. */
const zonesFor = (runner: RunnerProfile, activity: Activity | null) => activity
  ? runnerHeartRateZones(runner, getSportProfile(activity.base).heartRate, effectiveHrOffset(activity))
  : runnerHeartRateZones(runner, SPORT_PROFILES.running.heartRate, 0);

const STORAGE_ID = 'statistiques';

/** Dernier affichage, retenu sur l'appareil (`tracker.statistiques`) ; `null` : « Tout », ou la donnée par défaut. */
interface StatsView {
  famille: SportFamily | null;
  activite: string | null;
  periode: StatsPeriod;
  /** Donnée du graphique ; absente de la sélection, celle par défaut est montrée sans l'oublier. */
  donnee: StatsMetricKey | null;
  /** Pièce du matériel enregistré de l'activité (son identifiant) ; `null` : tout le matériel. */
  materiel?: string | null;
}

const VIEW_NAMESPACE = 'tracker.statistiques';
const VIEW_KEY = 'affichage';
const VIEW_DEFAULTS: StatsView = { famille: null, activite: null, periode: 'tout', donnee: null, materiel: null };
const panelId = (name: string) => `${STORAGE_ID}.${name}`;
/** Ce que disent les blocs de la page quand la période n'a aucune session. */
const NO_SESSION_TEXT = 'Aucune session sur la période.';
const chartPanelStyle = { ...CARD_STYLE, ...HALF_PANEL_STYLE, display: 'flex', flexDirection: 'column', overflow: 'hidden' } as const;
const noteStyle = { color: 'var(--muted)', fontSize: 'var(--text-xs)', marginTop: '8px' } as const;

const RECORD_LABEL: Record<StatsRecordKind, string> = {
  vitesse: 'Vitesse max',
  distance: 'Distance',
  duree: 'Durée',
  denivele: 'Dénivelé positif',
  manoeuvres: 'Manœuvres',
  vague: 'Plus longue vague',
  vol: 'Plus long vol',
};

const isFamily = (value: unknown): value is SportFamily => SPORT_FAMILIES.some((f) => f === value);

/** Familles qui comptent le dénivelé et la vitesse moyenne en action. */
const isLandFamily = (family: SportFamily | null): boolean => family === 'course' || family === 'velo' || family === 'fractionne';



/** Rangée de pastilles : la donnée du graphique. */
function Chips<K extends string>({ label, items, value, onChoose, accent, className }: {
  label: string;
  items: { key: K; label: string }[];
  value: K;
  onChoose: (key: K) => void;
  accent: string;
  className?: string;
}) {
  return (
    <div className={`ui-tabs ui-tabs--compact stats-chips${className ? ` ${className}` : ''}`} role="group" aria-label={label} style={{ '--tab-accent': accent } as React.CSSProperties}>
      {items.map((item) => (
        <button key={item.key} type="button" className="ui-tab" aria-pressed={value === item.key} onClick={() => onChoose(item.key)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** Ligne d'un groupe (famille, activité) qui descend d'un niveau. */
const GroupRow = ({ color, name, totals, distanceUnit, onOpen }: {
  color: string; name: string; totals: StatsTotals; distanceUnit: DistanceUnit; onOpen: () => void;
}) => (
  <li>
    <button type="button" className="stats-row" onClick={onOpen}>
      <span className="ui-swatch" style={{ background: color }} />
      <span className="stats-row__name">{name}</span>
      <span className="stats-row__meta num">
        {plural(totals.sessions, 'session')} · {formatDuration(totals.durationS * 1000)} · {formatDistanceAuto(totals.distanceM, distanceUnit)}
      </span>
      <IconChevronRight size={16} className="stats-row__chevron" />
    </button>
  </li>
);

/** Ligne du graphique : un point par session et par série, valeur et ligne grise dans l'unité de l'axe. */
interface ChartRow extends MetricPoint {
  y: number;
  lineY: number;
  /** Clé de la série (virements, empannages). */
  serieKey: string;
}

/**
 * Forme des points, pointillé de la tendance et mot de la légende de chaque série, par sa clé : l'empannage
 * (jibe) en rond, le virement (tack) en triangle (23/10). Une série sans entrée prend celle d'une série seule.
 */
const SERIE_STYLE: Record<string, { shape: 'circle' | 'triangle'; dash: string; legend: string }> = {
  empannages: { shape: 'circle', dash: '4 3', legend: 'empannage (jibe)' },
  virements: { shape: 'triangle', dash: '1 3', legend: 'virement (tack)' },
};
/** Ligne des heures totales par semaine (donnée « Durée »). */
const WEEK_LINE_COLOR = '#5f6b76';
const SINGLE_SERIE_STYLE = { shape: 'circle' as const, dash: '4 3', legend: '' };
const serieStyle = (key: string) => SERIE_STYLE[key] ?? SINGLE_SERIE_STYLE;
/** Ordre de la légende et du détail d'un point : les ronds d'abord. */
const serieRank = (key: string) => (serieStyle(key).shape === 'circle' ? 0 : 1);

/** Forme d'une série dans la légende, dessinée comme sur le graphe. */
const SerieShape = ({ shape }: { shape: 'circle' | 'triangle' }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
    {shape === 'circle' ? <circle cx="5" cy="5" r="4" fill="currentColor" /> : <path d="M5 1 L9.5 9 L0.5 9 Z" fill="currentColor" />}
  </svg>
);

/** Point de la ligne des heures par semaine : posé au milieu de la semaine, `y` dans l'unité de l'axe. */
interface WeekRow {
  startMs: number;
  y: number;
  weekStartMs: number;
  durationS: number;
}

const isWeekRow = (row: ChartRow | WeekRow): row is WeekRow => 'weekStartMs' in row;

/** Trait de la ligne des heures par semaine dans la légende. */
const WeekLineShape = () => (
  <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden>
    <line x1="0" y1="5" x2="14" y2="5" stroke={WEEK_LINE_COLOR} strokeWidth="2" />
  </svg>
);

const CHOICE_DEFAULT = { choix: false };

/**
 * Aide de la charge, sous les chiffres du cardio : seul ce petit composant lit l'état des aides, pour qu'un « ? »
 * ouvert ou fermé ailleurs ne redessine pas toute la page et ses graphes.
 */
function CardioLoadHelpSlot({ bounds }: { bounds: Parameters<typeof CardioLoadHelp>[0]['bounds'] }) {
  const help = useHelp('stats:charge');
  return help?.open ? <CardioLoadHelp bounds={bounds} weights={LOAD_WEIGHTS} period /> : null;
}

function StatisticsPage() {
  const [params, setParams] = useSearchParams();
  const { status, sessions, scanning } = useLibraryFields('status', 'sessions', 'scanning');
  const favoriteBackdrop = useFavoriteBackdrop();
  const { activities, families, isShown, shownActivities } = useVisibility();
  const openSession = useOpenSession();
  const narrow = useNarrowScreen();
  const nowMs = useNow();
  const [picked, setPicked] = useState<string | null>(null);
  const { open, toggle } = useOpenSections<StatsSection>(STORAGE_ID, STATS_SECTION_DEFAULTS);
  /** Boutons glissants de famille, d'activité et de période : repliés sous « Sélection » au départ, état retenu. */
  const choice = useOpenSections(`${STORAGE_ID}.choix`, CHOICE_DEFAULT);
  const { value: view, update: rememberView } = useStoredRecord<StatsView>(VIEW_NAMESPACE, VIEW_KEY, VIEW_DEFAULTS);

  // À l'ouverture sans paramètre (barre, accueil), reprendre le dernier affichage, si sa famille est visible.
  useEffect(() => {
    if (params.toString() !== '') return;
    const last = readStoredRecord<StatsView>(VIEW_NAMESPACE, VIEW_KEY, VIEW_DEFAULTS);
    const p = new URLSearchParams();
    if (isFamily(last.famille) && families.includes(last.famille)) {
      p.set('famille', last.famille);
      if (typeof last.activite === 'string' && last.activite !== '') {
        p.set('activite', last.activite);
        if (typeof last.materiel === 'string' && last.materiel !== '') p.set('materiel', last.materiel);
      }
    }
    if (isStatsPeriod(last.periode) && last.periode !== 'tout') p.set('periode', last.periode);
    if (p.toString() !== '') setParams(p, { replace: true });
    // Une seule fois, à l'ouverture de la page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Le choix, lu dans l'adresse.
  const familyParam = params.get('famille');
  const family: SportFamily | null = isFamily(familyParam) ? familyParam : null;
  const familyHidden = family !== null && !families.includes(family);
  const periodParam = params.get('periode');
  const period: StatsPeriod = isStatsPeriod(periodParam) ? periodParam : 'tout';
  // Sessions classées et visibles ; celles d'une famille cachée ouverte par son adresse aussi. Une session
  // peut tenir d'une activité de base, hors de la liste (son calcul sans activité créée, activité supprimée) :
  // elle est gardée avec les activités de la liste, pour avoir sa pastille, son nom et sa couleur.
  const visible = useVisibleStatSessions();
  const { all, activityById } = useMemo(
    () => (familyHidden ? visibleStatSessions(sessions, activities, isShown, family) : visible),
    [visible, familyHidden, sessions, activities, isShown, family]
  );
  const activityParam = params.get('activite');
  const activity: Activity | null =
    family !== null && activityParam !== null && activityById.get(activityParam) && activityFamily(activityById.get(activityParam)!) === family
      ? activityById.get(activityParam)!
      : null;

  // Matériel : les pièces de l'activité choisie (Réglages), et celle de l'adresse si elle en est une.
  const gearGroups = useGearGroups(activity);
  const gearItems = useMemo(() => gearFilterItems(gearGroups ?? []), [gearGroups]);
  const gearParam = params.get('materiel');
  const gearItem = gearItems.find((it) => it.key === gearParam) ?? null;

  // Une adresse changée hors de `go` (touche retour d'Android, qui remonte d'un cran) est retenue aussi. Pas tant
  // que la page, ouverte sans paramètre, attend la reprise du dernier affichage : elle l'effacerait.
  const awaitingResume = useRef(params.toString() === '');
  useEffect(() => {
    if (awaitingResume.current) {
      if (params.toString() === '') return;
      awaitingResume.current = false;
    }
    const activite = family ? activityParam : null;
    const materiel = activite ? gearParam : null;
    if (view.famille === family && view.activite === activite && view.periode === period && (view.materiel ?? null) === materiel) return;
    rememberView({ famille: family, activite, periode: period, materiel });
    // Seule l'adresse compte : la mémoire la suit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  /**
   * Change l'adresse : famille, activité et matériel s'empilent dans l'historique, la période le remplace.
   * Une autre famille ou une autre activité remet le matériel à « Tout ».
   */
  const go = (next: { famille?: SportFamily | null; activite?: string | null; materiel?: string | null; periode?: StatsPeriod }, replace = false) => {
    const p = new URLSearchParams();
    const f = next.famille !== undefined ? next.famille : family;
    const a = next.activite !== undefined ? next.activite : activity?.id ?? null;
    const m = next.materiel !== undefined ? next.materiel : next.famille !== undefined || next.activite !== undefined ? null : gearItem?.key ?? null;
    const per = next.periode ?? period;
    if (f) p.set('famille', f);
    if (f && a) p.set('activite', a);
    if (f && a && m) p.set('materiel', m);
    if (per !== 'tout') p.set('periode', per);
    rememberView({ famille: f, activite: f ? a : null, periode: per, materiel: f && a ? m : null });
    setPicked(null);
    setParams(p, { replace });
  };

  const scoped = useMemo(() => {
    const known = new Set(gearItems.map((it) => it.key));
    return all.filter((s) => (family === null || s.family === family) && (activity === null || s.activityId === activity.id)
      && (gearItem === null || matchesGear(s, gearItem, known)));
  }, [all, family, activity, gearItems, gearItem]);
  const bounds = useMemo(() => statsPeriodBounds(period, nowMs), [period, nowMs]);
  const inPeriod = useMemo(() => scoped.filter((s) => inBounds(s.startMs, bounds)), [scoped, bounds]);
  const totals = useMemo(() => statsTotals(inPeriod), [inPeriod]);
  const activityOrder = useMemo(() => activities.map((a) => a.id), [activities]);
  const regular = useMemo(() => regularity(scoped, bounds, nowMs, activityOrder), [scoped, bounds, nowMs, activityOrder]);

  // Unités : celles de l'activité, sinon de la première activité visible de la famille.
  const unitActivityOf = (f: SportFamily): Activity | null => shownActivities(f)[0] ?? activitiesOfFamily(activities, f)[0] ?? null;
  const unitActivity = activity ?? (family ? unitActivityOf(family) : null);
  const speedUnit: SpeedUnit = unitActivity ? effectiveSpeedUnit(unitActivity) : 'kmh';
  const distanceUnit: DistanceUnit = unitActivity ? effectiveDistanceUnit(unitActivity) : 'km';
  const accent = family ? FAMILY_ACCENT[family] : 'var(--ink-2)';
  /** Fond des onglets et pastilles allumés, sous du texte blanc : sans famille, le gris neutre du thème. */
  const tabAccent = family ? FAMILY_ACCENT[family] : 'var(--neutral-accent)';

  // Boutons glissants : les familles visibles (et celle ouverte par l'adresse), puis toutes les activités visibles de la
  // famille, avec ou sans session, et celles de base qui en ont.
  const familyItems: { key: SportFamily | 'tout'; label: string }[] = [
    { key: 'tout', label: 'Tout' },
    ...SPORT_FAMILIES.filter((f) => families.includes(f) || f === family).map((f) => ({ key: f, label: FAMILY_LABEL[f] })),
  ];
  const activityItems = useMemo(() => {
    if (family === null) return [];
    const withSessions = new Set(all.filter((s) => s.family === family).map((s) => s.activityId));
    const listed = activitiesOfFamily(activities, family).filter((a) => isShown(a) || familyHidden || withSessions.has(a.id) || a.id === activity?.id);
    const extra = [...withSessions].filter((id) => !listed.some((a) => a.id === id)).map((id) => activityById.get(id)!);
    return [...listed, ...extra].map((a) => ({ key: a.id, label: a.name }));
  }, [all, family, activities, isShown, familyHidden, activity, activityById]);

  // Cardio : la FC du résumé, zones et charge recalculées avec le profil du moment.
  const { profile: runner } = useRunnerProfile();
  // Zones montrées : celles de l'activité choisie, de la course sinon ; chaque session compte avec celles de son activité.
  const hrZones = useMemo(() => zonesFor(runner, activity), [runner, activity]);
  const zoneBoundsOf = useMemo((): ZoneBoundsOf | null => {
    if (!hrZones) return null;
    const byActivity = new Map<string, readonly number[]>();
    return (s) => {
      let bounds = byActivity.get(s.activityId);
      if (!bounds) {
        bounds = zonesFor(runner, activityById.get(s.activityId) ?? null)?.bounds ?? hrZones.bounds;
        byActivity.set(s.activityId, bounds);
      }
      return bounds;
    };
  }, [hrZones, runner, activityById]);
  const hasCardio = inPeriod.some((s) => s.heartRate !== null);
  const cardio = useMemo(() => cardioTotals(inPeriod, zoneBoundsOf, LOAD_WEIGHTS), [inPeriod, zoneBoundsOf]);
  const loadBars = useMemo(() => (zoneBoundsOf ? cardioLoadBars(regular.bars, inPeriod, zoneBoundsOf, LOAD_WEIGHTS) : []), [zoneBoundsOf, regular.bars, inPeriod]);
  const hrPoints = useMemo(() => heartRatePoints(inPeriod), [inPeriod]);
  const hrSeries = useMemo(() => groupByActivity(hrPoints), [hrPoints]);
  const hrTicks = useMemo(
    () => (hrPoints.length > 0 ? dateTicks(hrPoints[0].startMs - 86_400_000, hrPoints[hrPoints.length - 1].startMs + 86_400_000, narrow ? 4 : 6) : null),
    [hrPoints, narrow]
  );

  const sections = STATS_SECTIONS.filter((s) => (family !== null || s.key !== 'records') && (s.key !== 'cardio' || hasCardio));

  // Graphique : une donnée au choix, un point par session de la sélection (période comprise) et par série ; en
  // pointillé, le record en escalier (vitesse max) ou la tendance. Le choix retenu, s'il n'existe pas ici, cède
  // la place à la donnée par défaut sans être oublié.
  const metrics = useMemo(() => metricsOf(family, inPeriod), [family, inPeriod]);
  const metricKey: StatsMetricKey = isStatsMetricKey(view.donnee) && metrics.some((m) => m.key === view.donnee)
    ? view.donnee
    : metrics.some((m) => m.key === defaultMetricKey(family)) ? defaultMetricKey(family) : metrics[0]?.key ?? defaultMetricKey(family);
  const metric = statsMetric(metricKey);
  const series = useMemo(() => metricSeries(inPeriod, metric), [inPeriod, metric]);
  // Durée en heures dès qu'une session atteint 2 h, sinon en minutes.
  // Heures totales de chaque semaine de la sélection, pour la seule donnée « Durée ».
  const weekly = useMemo(() => (metric.unit === 'duree' ? weeklyDurations(inPeriod) : []), [inPeriod, metric]);
  const inHours = metric.unit === 'duree'
    && (series.some((serie) => serie.points.some((p) => p.value >= 7200)) || weekly.some((w) => w.durationS >= 7200));
  const toAxis = (v: number): number => {
    switch (metric.unit) {
      case 'vitesse': return toDisplaySpeed(v, speedUnit, distanceUnit);
      case 'duree': return inHours ? v / 3600 : v / 60;
      case 'distance': return toDisplayDistance(v, distanceUnit);
      default: return v;
    }
  };
  const axisLabel = metric.unit === 'vitesse' ? speedUnitLabel(speedUnit, distanceUnit)
    : metric.unit === 'duree' ? (inHours ? 'h' : 'min')
    : metric.unit === 'distance' ? DISTANCE_UNIT_SYMBOL[distanceUnit]
    : metric.unit === 'pourcent' ? '%'
    : metric.unit === 'metres' ? 'm'
    : metric.unit === 'secondes' ? 's'
    : metric.unit === 'cadence' ? 'pas/min'
    : '';
  const axisTick = (v: number): string =>
    metric.unit === 'vitesse' ? formatSpeedValue(v, speedUnit) : v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  /** Valeur d'une session en clair, dans l'unité de la sélection. */
  const metricText = (value: number): string => {
    switch (metric.unit) {
      case 'vitesse': return formatSpeed(value, speedUnit, distanceUnit);
      case 'duree': return formatDuration(value * 1000);
      case 'distance': return formatDistanceAuto(value, distanceUnit);
      case 'pourcent': return `${Math.round(value)} %`;
      case 'nombre': return String(value);
      case 'metres': return `${Math.round(value)} m`;
      case 'secondes': return formatShortDuration(value);
      case 'cadence': return `${Math.round(value)} pas/min`;
    }
  };
  const chartSeries = useMemo(
    () => series.map((serie) => {
      const rows: ChartRow[] = serie.points.map((p) => ({ ...p, y: toAxis(p.value), lineY: toAxis(p.line), serieKey: serie.key }));
      return { key: serie.key, label: serie.label, rows, byActivity: groupByActivity(rows) };
    }),
    // `toAxis` ne dépend que de l'unité, des unités de la sélection et de l'échelle des durées.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, speedUnit, distanceUnit, inHours]
  );
  const weekRows = useMemo<WeekRow[]>(
    () => weekly.map((w) => ({ startMs: w.midMs, y: w.durationS / (inHours ? 3600 : 60), weekStartMs: w.weekStartMs, durationS: w.durationS })),
    [weekly, inHours]
  );
  const chartFull = useMemo(() => {
    const starts = series.flatMap((serie) => serie.points.map((p) => p.startMs));
    if (starts.length === 0) return null;
    // Une journée de marge de chaque côté : un point seul reste au milieu.
    const pad = 86_400_000;
    return { min: Math.min(...starts) - pad, max: Math.max(...starts) + pad };
  }, [series]);
  const zoom = useChartZoom(chartFull, `${family}|${activity?.id}|${period}|${metricKey}`);
  const chartTicks = zoom.shown ? dateTicks(zoom.shown.min, zoom.shown.max, narrow ? 4 : 6) : null;
  const pickedSession = picked ? inPeriod.find((s) => s.file === picked) ?? null : null;
  const pickedPoints = pickedSession
    ? [...series].sort((a, b) => serieRank(a.key) - serieRank(b.key)).flatMap((serie) => serie.points.filter((p) => p.file === pickedSession.file).map((p) => ({ label: serie.label, point: p })))
    : [];
  const inverse = metric.unit === 'vitesse' && isInverseUnit(speedUnit);
  const twoSeries = series.length > 1;
  const legendSeries = [...series].sort((a, b) => serieRank(a.key) - serieRank(b.key));
  /** Valeur d'une session pour une série, avec le détail des manœuvres. */
  const pointText = (serieLabel: string, p: MetricPoint): string => {
    const s = metric.key === 'reussite' ? inPeriod.find((x) => x.file === p.file) : undefined;
    const r = s?.maneuverResults;
    const detail = r
      ? serieLabel === 'Virements' ? ` (${r.tackSuccess} / ${r.tackSuccess + r.tackFail})` : ` (${r.jibeSuccess} / ${r.jibeSuccess + r.jibeFail})`
      : '';
    return `${twoSeries ? `${serieLabel.toLowerCase()} ` : ''}${metricText(p.value)}${detail}`;
  };
  const voileWithoutResults = metric.key === 'reussite' ? inPeriod.filter((s) => s.family === 'voile' && s.maneuverResults === null).length : 0;

  // Régularité : une colonne par activité, empilées.
  const barRows = useMemo(
    () => regular.bars.map((b, i) => ({ i, ...Object.fromEntries(b.stacks.map((s) => [s.activityId, s.count])) })),
    [regular.bars]
  );
  const barActivities = useMemo(() => {
    const ids = new Set(regular.bars.flatMap((b) => b.stacks.map((s) => s.activityId)));
    return activityOrder.filter((id) => ids.has(id));
  }, [regular.bars, activityOrder]);

  const activityName = (id: string) => activityById.get(id)?.name ?? id;
  const shown = useThemedShade();
  const activityColor = (id: string) => shown(activityById.get(id)?.color ?? '#888');

  const recordValue = (kind: StatsRecordKind, value: number, s: StatSession): string => {
    const a = activityById.get(s.activityId);
    switch (kind) {
      case 'vitesse': return formatSpeed(value, a ? effectiveSpeedUnit(a) : speedUnit, a ? effectiveDistanceUnit(a) : distanceUnit);
      case 'distance': return formatDistanceAuto(value, a ? effectiveDistanceUnit(a) : distanceUnit);
      case 'duree': return formatDuration(value * 1000);
      case 'denivele': return `${Math.round(value)} m`;
      case 'manoeuvres': return String(value);
      case 'vague': return `${Math.round(value)} m`;
      case 'vol': return formatShortDuration(value);
    }
  };

  const title = activity ? activity.name : family ? FAMILY_LABEL[family] : 'Toutes les activités';
  const periodLabel = STATS_PERIODS.find((p) => p.id === period)!.label;
  /** Le choix en cours, dans le bouton « Sélection » : lisible bloc replié. */
  const choiceSummary = [family ? FAMILY_LABEL[family] : 'Toutes les familles', ...(activity ? [activity.name] : []), ...(gearItem ? [gearItem.label] : []), periodLabel === 'Tout' ? 'depuis le début' : periodLabel].join(' · ');
  const empty = inPeriod.length === 0;
  const lastText = regular.weeksSinceLast === null ? '—'
    : regular.weeksSinceLast === 0 ? 'cette semaine'
    : regular.weeksSinceLast === 1 ? 'la semaine dernière'
    : `il y a ${regular.weeksSinceLast} semaines`;

  return (
    <div className="ui-page ui-page--wide ui-page--backdrop an-page stats-page">
      {/* Le motif de la famille choisie ; dans « Tout », celui du sport préféré. */}
      <PageBackdrop variant={family ?? favoriteBackdrop} />
      <PageHeader title="Statistiques" subtitle={`${title} · ${periodLabel === 'Tout' ? 'depuis le début' : periodLabel}`} />

      <div className="stats-choice">
        <ChartFold open={choice.open.choix} onToggle={() => choice.toggle('choix')}
          title={choice.open.choix ? 'Replier la sélection' : 'Choisir la famille, l’activité et la période'}
          style={{ padding: '6px 10px 6px 12px', fontSize: 'var(--text-s)' }}
          label={<>
            <strong>Sélection</strong>
            <span className="stats-choice__summary">{choiceSummary}</span>
          </>} />
        {choice.open.choix && (<>
        <SegmentedControl fit label="Famille" items={familyItems} value={family ?? 'tout'} accent={accent}
          onChange={(key) => go({ famille: key === 'tout' ? null : key, activite: null })} />
        {family !== null && activityItems.length > 0 && (
          <SegmentedControl label="Activité" items={[{ key: '', label: 'Toutes' }, ...activityItems]} value={activity?.id ?? ''} accent={accent}
            onChange={(key) => go({ activite: key === '' ? null : key })} />
        )}
        {activity !== null && gearItems.length > 0 && (
          <SegmentedControl label="Matériel" items={[{ key: '', label: 'Tout' }, ...gearItems.map((it) => ({ key: it.key, label: it.label }))]}
            value={gearItem?.key ?? ''} accent={accent} className="stats-gear"
            onChange={(key) => go({ materiel: key === '' ? null : key })} />
        )}
        <SegmentedControl fit label="Période" items={STATS_PERIODS.map((p) => ({ key: p.id, label: p.label }))} value={period}
          onChange={(key) => go({ periode: key }, true)} />
        </>)}
        {familyHidden && <p style={noteStyle}>Cette famille est cachée dans Réglages : elle n'apparaît ici que par son adresse.</p>}
      </div>

      {status === 'opening' ? (
        <p className="ui-hint">Lecture de la mémoire…</p>
      ) : (
        <div className="stats-col">
          <SectionTabs sections={sections} open={open} onToggle={toggle} accent={tabAccent} />
          {scanning && (
            <p className="ui-hint">Fiches en cours de calcul ({scanning.done} / {scanning.total}) : chiffres provisoires.</p>
          )}
          <div className="an-carte-panels stats-panels">
            {open.general && (
              <ResizablePanel id={panelId('general')} style={ANALYSIS_PANEL_STYLE}>
                <PanelHeading label="Général" open={open.general} onToggle={() => toggle('general')}
                    helpKey={family === 'voile' && totals.maneuverSessions < totals.sessions ? 'stats:general' : undefined} />
                <HelpText helpKey="stats:general" note>
                  Manœuvres comptées sur les {plural(totals.maneuverSessions, 'session')} déjà ouverte{totals.maneuverSessions > 1 ? 's' : ''} dans l'analyse
                  ({totals.sessions - totals.maneuverSessions} jamais ouverte{totals.sessions - totals.maneuverSessions > 1 ? 's' : ''}).
                </HelpText>
                {empty ? (
                  <p className="ui-hint">{NO_SESSION_TEXT}</p>
                ) : (
                  <>
                    <div className="an-sheet__stats an-sheet__stats--always">
                      <StatTile label="Sessions" value={totals.sessions} />
                      <StatTile label="Durée totale" value={formatDuration(totals.durationS * 1000)} title="Du premier au dernier point de chaque session" />
                      {totals.movingTimeS > 0 && <StatTile label="Temps en action" value={formatDuration(totals.movingTimeS * 1000)} />}
                      {family !== null && <StatTile label="Distance" value={formatDistanceAuto(totals.distanceM, distanceUnit)} />}
                      {isLandFamily(family) && averageMovingSpeedMs(totals) !== null && (
                        <StatTile label="Vitesse moyenne en action" value={formatSpeed(averageMovingSpeedMs(totals), speedUnit, distanceUnit)} />
                      )}
                      {isLandFamily(family) && totals.elevationSessions > 0 && <StatTile label="Dénivelé positif" value={`${Math.round(totals.elevationGainM)} m`} />}
                      {family !== null && totals.maxSpeedMs !== null && <StatTile label="Vitesse max" value={formatSpeed(totals.maxSpeedMs, speedUnit, distanceUnit)} />}
                      {family === 'voile' && totals.maneuverSessions > 0 && (
                        <>
                          <StatTile label="Manœuvres" value={totals.maneuvers} />
                          <StatTile label="Manœuvres par session" value={formatDecimal(totals.maneuvers / totals.maneuverSessions)} />
                        </>
                      )}
                      {family === 'surf' && totals.waveSessions > 0 && (
                        <>
                          <StatTile label="Vagues" value={totals.waves} />
                          <StatTile label="Vagues par session" value={formatDecimal(totals.waves / totals.waveSessions)} />
                        </>
                      )}
                      {family === 'surf' && totals.longestWaveM !== null && <StatTile label="Plus longue vague" value={`${Math.round(totals.longestWaveM)} m`} />}
                      {family === 'surf' && totals.longestFlightS !== null && <StatTile label="Plus long vol" value={formatShortDuration(totals.longestFlightS)} />}
                      {totals.reps > 0 && <StatTile label="Répétitions du compteur" value={totals.reps} />}
                    </div>
                    {family === null && (
                      <ul className="stats-rows">
                        {groupTotals(inPeriod, (s) => s.family, SPORT_FAMILIES).map(({ key, totals: t }) => {
                          const unit = unitActivityOf(key);
                          return (
                            <GroupRow key={key} color={FAMILY_ACCENT[key]} name={FAMILY_LABEL[key]} totals={t}
                              distanceUnit={unit ? effectiveDistanceUnit(unit) : 'km'} onOpen={() => go({ famille: key, activite: null })} />
                          );
                        })}
                      </ul>
                    )}
                    {family !== null && activity === null && (
                      <ul className="stats-rows">
                        {groupTotals(inPeriod, (s) => s.activityId, activityOrder).map(({ key, totals: t }) => {
                          const a = activityById.get(key);
                          return (
                            <GroupRow key={key} color={activityColor(key)} name={activityName(key)} totals={t}
                              distanceUnit={a ? effectiveDistanceUnit(a) : distanceUnit} onOpen={() => go({ activite: key })} />
                          );
                        })}
                      </ul>
                    )}
                  </>
                )}
              </ResizablePanel>
            )}

            {open.vitesse && (
              <ResizablePanel id={panelId('vitesse')} defaultHeight={380} minHeight={220} direction="vertical" style={chartPanelStyle}>
                <div style={{ marginBottom: '8px', paddingRight: '28px' }}>
                  <PanelTitle label="Graphique" open={open.vitesse} onToggle={() => toggle('vitesse')} helpKey={chartFull === null ? undefined : 'stats:graphique'} />
                </div>
                <HelpText helpKey="stats:graphique" note>
                  Un point par session, à la couleur de son activité ;
                  {metric.record ? ' en pointillé, le record établi jusque-là.' : ` en pointillé, la moyenne des ${TREND_SESSIONS} dernières sessions.`}
                  {narrow ? ' Toucher un point pour le détail, écarter deux doigts pour zoomer.' : ' Cliquer un point pour le détail, tirer une zone pour zoomer.'}
                </HelpText>
                {metrics.length > 1 && (
                  <Chips label="Donnée" items={metrics.map((m) => ({ key: m.key, label: m.label }))} value={metricKey} accent={tabAccent}
                    className="stats-metric-chips" onChoose={(key) => { rememberView({ donnee: key }); setPicked(null); }} />
                )}
                {chartFull === null ? (
                  <p className="ui-hint">{NO_SESSION_TEXT}</p>
                ) : (
                  <>
                    {(twoSeries || weekRows.length > 0) && (
                      <div className="stats-legend" aria-label="Légende">
                        {twoSeries && legendSeries.map((serie) => (
                          <span key={serie.key} className="stats-legend__item">
                            <SerieShape shape={serieStyle(serie.key).shape} /> {serieStyle(serie.key).legend || serie.label.toLowerCase()}
                          </span>
                        ))}
                        {weekRows.length > 0 && (
                          <span className="stats-legend__item"><WeekLineShape /> heures par semaine</span>
                        )}
                      </div>
                    )}
                    <ZoomableChart zoom={zoom} style={{ width: '100%', flex: 1, minHeight: 0 }}>
                      <ResponsiveContainer>
                        <ComposedChart accessibilityLayer={false} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                          <ChartZoomProbe />
                          <CartesianGrid {...CHART_GRID_PROPS} />
                          <XAxis dataKey="startMs" type="number" allowDataOverflow
                            domain={zoom.shown ? [zoom.shown.min, zoom.shown.max] : ['dataMin', 'dataMax']}
                            ticks={chartTicks?.ticks}
                            tickFormatter={(v: number) => formatDateTick(v, chartTicks?.unit ?? 'jour')}
                            tick={CHART_TICK} />
                          <YAxis type="number" reversed={inverse}
                            domain={inverse ? ['auto', 'auto'] : metric.unit === 'pourcent' ? [0, 100] : [0, 'auto']}
                            allowDecimals={metric.unit !== 'nombre'}
                            tickFormatter={axisTick} width={46}
                            tick={CHART_TICK}
                            label={yAxisLabel(axisLabel, 'var(--chart-axis)')} />
                          <Tooltip cursor={false} isAnimationActive={false}
                            content={({ active, payload }) => {
                              const row = active ? (payload?.[0]?.payload as ChartRow | WeekRow | undefined) : undefined;
                              if (!row || row.y === undefined) return null;
                              if (isWeekRow(row)) {
                                const monday = new Date(row.weekStartMs).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
                                return (
                                  <div className="stats-tooltip">
                                    <strong>Semaine du {monday}</strong>
                                    <span>{formatDuration(row.durationS * 1000)}</span>
                                  </div>
                                );
                              }
                              return (
                                <div className="stats-tooltip">
                                  <strong>{dayMonthYear(row.startMs)}</strong>
                                  <span>{activityName(row.activityId)} · {pointText(series.find((serie) => serie.key === row.serieKey)?.label ?? '', row)}</span>
                                </div>
                              );
                            }} />
                          {chartSeries.map((serie) => (
                            <Line key={`ligne-${serie.key}`} data={serie.rows} dataKey="lineY" type={metric.record ? 'stepAfter' : 'linear'}
                              stroke={OTHERS_COLOR} strokeDasharray={serieStyle(serie.key).dash} strokeWidth={1.5}
                              dot={false} activeDot={false} isAnimationActive={false} name={metric.record ? 'Record' : 'Tendance'} />
                          ))}
                          {weekRows.length > 0 && (
                            <Line key="heures-semaine" data={weekRows} dataKey="y" type="linear" stroke={WEEK_LINE_COLOR} strokeWidth={2}
                              dot={false} activeDot={{ r: 3 }} isAnimationActive={false} name="Heures par semaine" />
                          )}
                          {chartSeries.flatMap((serie) => serie.byActivity.map(([activityId, rows]) => (
                            <Scatter key={`${serie.key}-${activityId}`} data={rows} dataKey="y" fill={activityColor(activityId)} isAnimationActive={false}
                              shape={serieStyle(serie.key).shape} name={activityName(activityId)}
                              onClick={(_, index) => setPicked(rows[index]?.file ?? null)} style={{ cursor: 'pointer' }} />
                          )))}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </ZoomableChart>
                    <div className="stats-picked">
                      {pickedSession && pickedPoints.length > 0 ? (
                        <button type="button" className="stats-row" onClick={() => openSession(pickedSession.file, pickedSession.family)}>
                          <span className="ui-swatch" style={{ background: activityColor(pickedSession.activityId) }} />
                          <span className="stats-row__name">{dayMonthYear(pickedSession.startMs)}</span>
                          <span className="stats-row__meta num">
                            {pickedSession.name ?? activityName(pickedSession.activityId)} · {pickedPoints.map(({ label, point }) => pointText(label, point)).join(' · ')}
                            {pickedPoints.some(({ point }) => point.isRecord) ? ' · record' : ''}
                          </span>
                          <span className="stats-row__open">Ouvrir</span>
                          <IconChevronRight size={16} className="stats-row__chevron" />
                        </button>
                      ) : voileWithoutResults > 0 && (
                        <span style={noteStyle}>
                          Réussite connue des sessions rouvertes dans l'analyse depuis la version 0.3.5 : {plural(voileWithoutResults, 'session')} à rouvrir.
                        </span>
                      )}
                    </div>
                  </>
                )}
              </ResizablePanel>
            )}

            {open.regularite && (
              <ResizablePanel id={panelId('regularite')} defaultHeight={380} minHeight={220} direction="vertical" style={chartPanelStyle}>
                <div style={{ marginBottom: '10px', paddingRight: '28px' }}>
                  <PanelTitle label="Régularité" open={open.regularite} onToggle={() => toggle('regularite')} helpKey={regular.weeks === 0 ? undefined : 'stats:regularite'} />
                </div>
                <HelpText helpKey="stats:regularite" note>Sessions par {regular.barUnit}, empilées par activité.</HelpText>
                {regular.weeks === 0 ? (
                  <p className="ui-hint">{NO_SESSION_TEXT}</p>
                ) : (
                  <>
                    <div className="an-sheet__stats an-sheet__stats--always">
                      <StatTile label="Sessions par semaine" value={formatDecimal(regular.perWeek)} title="En moyenne sur les semaines de la période" />
                      <StatTile label="Semaines actives" value={`${regular.activeWeeks} / ${regular.weeks}`} />
                      <StatTile label="Plus longue série" value={plural(regular.longestStreak, 'semaine')} title="Semaines actives consécutives sur la période" />
                      <StatTile label="Série en cours" value={plural(regular.currentStreak, 'semaine')} title="Jusqu'à cette semaine, ou à la précédente si celle-ci est vide" />
                      <StatTile label="Dernière session" value={lastText} />
                    </div>
                    <div style={{ flex: 1, minHeight: 140 }}>
                      <ResponsiveContainer>
                        <BarChart data={barRows} accessibilityLayer={false} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid {...CHART_GRID_PROPS} vertical={false} />
                          <XAxis dataKey="i" tickFormatter={(i: number) => regular.bars[i]?.label ?? ''} interval="preserveStartEnd" minTickGap={16}
                            tick={CHART_TICK} />
                          <YAxis allowDecimals={false} width={30} tick={CHART_TICK} />
                          <Tooltip isAnimationActive={false} cursor={{ fill: 'var(--chart-cursor)' }}
                            labelFormatter={(i) => regular.bars[Number(i)]?.title ?? ''}
                            formatter={(value, name) => [value, activityName(String(name))]}
                            contentStyle={{ fontSize: 'var(--text-xs)' }} />
                          {barActivities.map((id) => (
                            <Bar key={id} dataKey={id} stackId="sessions" fill={activityColor(id)} isAnimationActive={false} />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                )}
              </ResizablePanel>
            )}

            {open.cardio && hasCardio && (
              <ResizablePanel id={panelId('cardio')} style={ANALYSIS_PANEL_STYLE}>
                <PanelHeading label="Cardio" open={open.cardio} onToggle={() => toggle('cardio')} helpKey={hrZones ? 'stats:cardio' : undefined} />
                <HelpText helpKey="stats:cardio" note>
                  Zones et charge recalculées avec les seuils de Réglages › Pratiquant, décalés pour l'activité de chaque session. Un point par session, à la couleur de son activité ; le toucher ouvre la session.
                </HelpText>
                <div className="an-sheet__stats an-sheet__stats--always">
                  <StatTile label="Sessions avec FC" value={`${cardio.sessions} / ${totals.sessions}`} />
                  <StatTile label="Temps mesuré" value={formatDuration(cardio.coveredS * 1000)} />
                  {cardio.avgBpm !== null && <StatTile label="FC moyenne" value={`${Math.round(cardio.avgBpm)} bpm`} title="Pondérée par le temps mesuré de chaque session" />}
                  {cardio.maxBpm !== null && <StatTile label="FC max" value={`${cardio.maxBpm} bpm`} />}
                  {cardio.load !== null && <StatTile label={<>Charge <HelpToggle helpKey="stats:charge" label="Qu'est-ce que la charge ?" /></>} value={Math.round(cardio.load)} />}
                  {cardio.load !== null && regular.weeks > 0 && <StatTile label="Charge par semaine" value={Math.round(cardio.load / regular.weeks)} />}
                </div>
                {hrZones && <CardioLoadHelpSlot bounds={hrZones.bounds} />}

                {cardio.zoneTimesS && cardio.coveredS > 0 && (
                  <div style={{ marginTop: '10px' }}>
                    <div className="stats-records__title">Temps par zone</div>
                    <div style={{ display: 'flex', height: '14px', borderRadius: '4px', overflow: 'hidden', margin: '6px 0' }}>
                      {cardio.zoneTimesS.map((s, z) => s > 0 && (
                        <div key={z} title={`${zoneLabel(z)} : ${formatShortDuration(s)}`} style={{ width: `${(s / cardio.coveredS) * 100}%`, backgroundColor: HEART_ZONE_COLORS[z] }} />
                      ))}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 'var(--text-xs)' }}>
                      {cardio.zoneTimesS.map((s, z) => (
                        <span key={z} style={{ opacity: s > 0 ? 1 : 0.45 }}>
                          <span style={{ display: 'inline-block', width: '9px', height: '9px', borderRadius: '2px', backgroundColor: HEART_ZONE_COLORS[z], marginRight: '4px' }} />
                          {zoneLabel(z)} {formatDuration(s * 1000)} ({Math.round((s / cardio.coveredS) * 100)} %)
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {loadBars.length > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <div className="stats-records__title">Charge par {regular.barUnit}</div>
                    <div style={{ height: '160px' }}>
                      <ResponsiveContainer>
                        <BarChart data={loadBars.map((b, i) => ({ i, load: Math.round(b.load) }))} accessibilityLayer={false} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid {...CHART_GRID_PROPS} vertical={false} />
                          <XAxis dataKey="i" tickFormatter={(i: number) => loadBars[i]?.label ?? ''} interval="preserveStartEnd" minTickGap={16} tick={CHART_TICK} />
                          <YAxis allowDecimals={false} width={36} tick={CHART_TICK} />
                          <Tooltip isAnimationActive={false} cursor={{ fill: 'var(--chart-cursor)' }}
                            labelFormatter={(i) => loadBars[Number(i)]?.title ?? ''} formatter={(value) => [value, 'Charge']} contentStyle={{ fontSize: 'var(--text-xs)' }} />
                          <Bar dataKey="load" fill={HEART_RATE_COLOR} isAnimationActive={false} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {hrPoints.length > 0 && hrTicks && (
                  <div style={{ marginTop: '12px' }}>
                    <div className="stats-records__title">FC moyenne par session</div>
                    <div style={{ height: '160px' }}>
                      <ResponsiveContainer>
                        <ComposedChart accessibilityLayer={false} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid {...CHART_GRID_PROPS} />
                          <XAxis dataKey="startMs" type="number" domain={[hrTicks.ticks[0] ?? 'dataMin', hrTicks.ticks[hrTicks.ticks.length - 1] ?? 'dataMax']}
                            ticks={hrTicks.ticks} tickFormatter={(v: number) => formatDateTick(v, hrTicks.unit)} tick={CHART_TICK} />
                          <YAxis type="number" domain={['dataMin - 5', 'dataMax + 5']} allowDecimals={false} width={40} tick={chartTick(HEART_RATE_COLOR)} />
                          <Tooltip cursor={false} isAnimationActive={false}
                            content={({ active, payload }) => {
                              const row = active ? (payload?.[0]?.payload as (typeof hrPoints)[number] | undefined) : undefined;
                              if (!row) return null;
                              return (
                                <div className="stats-tooltip">
                                  <strong>{dayMonthYear(row.startMs)}</strong>
                                  <span>{activityName(row.activityId)} · moy. {row.avgBpm} bpm · max {row.maxBpm} bpm</span>
                                </div>
                              );
                            }} />
                          {hrSeries.map(([activityId, rows]) => (
                            <Scatter key={activityId} data={rows} dataKey="avgBpm" fill={activityColor(activityId)} isAnimationActive={false}
                              name={activityName(activityId)} onClick={(_, index) => { const r = rows[index]; const s = r ? inPeriod.find((x) => x.file === r.file) : undefined; if (r && s) openSession(r.file, s.family); }}
                              style={{ cursor: 'pointer' }} />
                          ))}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {!hrZones && <p style={noteStyle}>Pour les zones et la charge, saisir la FC max ou l'année de naissance dans Réglages › Pratiquant.</p>}
              </ResizablePanel>
            )}

            {open.records && family !== null && (
              <ResizablePanel id={panelId('records')} style={ANALYSIS_PANEL_STYLE}>
                <PanelHeading label="Records" open={open.records} onToggle={() => toggle('records')} />
                {empty ? (
                  <p className="ui-hint">{NO_SESSION_TEXT}</p>
                ) : (
                  <div className="stats-records">
                    {recordKindsOf(family).map((kind) => {
                      const top = topSessions(inPeriod, kind);
                      if (top.length === 0) return null;
                      return (
                        <div key={kind}>
                          <div className="stats-records__title">{RECORD_LABEL[kind]}</div>
                          <ol className="stats-rows">
                            {top.map(({ session: s, value }, rank) => (
                              <li key={s.file}>
                                <button type="button" className="stats-row" onClick={() => openSession(s.file, s.family)}>
                                  <span className="stats-row__rank num">{rank + 1}</span>
                                  <span className="ui-swatch" style={{ background: activityColor(s.activityId) }} />
                                  <span className="stats-row__name num">{recordValue(kind, value, s)}</span>
                                  <span className="stats-row__meta">
                                    {dayMonthYear(s.startMs)} · {s.name ?? activityName(s.activityId)}
                                  </span>
                                  <IconChevronRight size={16} className="stats-row__chevron" />
                                </button>
                              </li>
                            ))}
                          </ol>
                        </div>
                      );
                    })}
                  </div>
                )}
              </ResizablePanel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default StatisticsPage;
