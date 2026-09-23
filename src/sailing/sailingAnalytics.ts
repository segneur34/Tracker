import { CHART_MAX_POINTS } from '../core/displayConfig';
import type { PointData } from '../utils/kinematics';
import type { ManeuverLocation, ManeuverStats } from './maneuvers';
import { VMG_WINDOW_S, getDefaultThresholdKn } from './sailingConfig';
import {
  angleDiff,
  circularMean,
  circularStats,
  interpolateDirection,
  normalizeAngle,
  type TimedDirection,
} from './wind';

export interface VmgStats {
  upStbd: { max: string; avg: string };
  upPort: { max: string; avg: string };
  downStbd: { max: string; avg: string };
  downPort: { max: string; avg: string };
  topsUpwind: { val: string; path: [number, number][] }[];
  topsDownwind: { val: string; path: [number, number][] }[];
}

export interface WindGraphPoint {
  index: number;
  timeLabel: string;
  /**
   * Valeur tracée, exprimée comme référence + écart à la référence, pour
   * rester continue autour de la moyenne sans dérouler la série. `null` loin
   * de toute manœuvre, ce qui interrompt la courbe.
   */
  angle: number | null;
  /** Même valeur ramenée dans [0, 360[, pour l'info-bulle. */
  display: number | null;
  /**
   * Vrai sur le point d'échantillonnage le plus proche d'une manœuvre : c'est
   * là que se trouve une vraie mesure, ailleurs la courbe est interpolée.
   */
  isManeuver: boolean;
}

/**
 * Variations du vent au fil de la session, mesurées aux manœuvres.
 *
 * Chaque virement ou empannage réussi donne une lecture du vent local. Entre
 * deux manœuvres, la valeur est interpolée ; au-delà d'un trou trop long, la
 * courbe s'interrompt plutôt que d'inventer.
 *
 * Toutes les statistiques sont circulaires : moyenne vectorielle, écarts à
 * cette moyenne, écart-type circulaire. Aucun déroulement d'angles, qui
 * divergerait à la première inversion.
 */
export interface WindStats {
  /** Direction moyenne, moyenne vectorielle. */
  avgWind: number;
  /** Écart maximal vers la gauche et vers la droite de la moyenne. */
  minWind: number;
  maxWind: number;
  range: number;
  /** Écart-type circulaire, en degrés. */
  stdDev: number;
  slopePerHour: number;
  count: number;
  /** Part des manœuvres dont les caps sont stabilisés de part et d'autre : un indicateur de qualité, plus un filtre. */
  stableShare: number;
  graphData: WindGraphPoint[];
  /** Vent interpolé à un instant, ou `null` loin de toute manœuvre. */
  windAt: (timeMs: number) => number | null;
}

/**
 * Vent de référence pour la VMG : soit une valeur fixe, soit une fonction du
 * temps. Sur une session longue le vent bascule, et une VMG calculée contre un
 * vent figé perd son sens.
 */
export type WindSource = number | ((timeMs: number) => number);

const resolveWind = (wind: WindSource, timeMs: number): number =>
  typeof wind === 'function' ? wind(timeMs) : wind;

/** Trou maximal, en minutes, à travers lequel on interpole encore entre deux manœuvres. */
const MAX_INTERPOLATION_GAP_MIN = 30;

/**
 * Manœuvres retenues pour suivre le vent : toutes celles que la détection a
 * classées, virements et empannages, réussis ou non, caps stabilisés ou non.
 *
 * Exiger des caps stabilisés de part et d'autre, comme le fait encore
 * `windSamplesFrom` pour l'estimation globale, n'en laissait passer qu'une sur
 * cinq et laissait la courbe presque vide. Une manœuvre asymétrique donne un
 * angle biaisé, mais le biais change de signe selon que l'on ouvre à l'entrée
 * ou à la sortie : sur l'ensemble des manœuvres il se compense largement,
 * alors que sur une poignée il pèse de tout son poids. La symétrie sert
 * désormais de pondération, plus haut, au lieu d'exclure.
 */
const maneuverSamples = (maneuverStats: ManeuverStats | null): ManeuverLocation[] => {
  if (!maneuverStats) return [];
  return [...maneuverStats.locations].sort((a, b) => a.timeMs - b.timeMs);
};

/** Poids plancher d'une manœuvre très asymétrique : elle pèse peu, jamais rien. */
const MIN_SYMMETRY_WEIGHT = 0.2;
/** Écart d'angle au vent, en degrés, au-delà duquel une manœuvre tombe au plancher. */
const SYMMETRY_SPAN_DEG = 90;

/**
 * Confiance accordée à la mesure d'une manœuvre, d'après sa symétrie.
 *
 * Un virage symétrique — entrée et sortie au même angle du vent — place son
 * milieu sur l'axe du vent, et sa mesure est juste. Entrer au largue pour
 * ressortir au près décale ce milieu d'autant. On ne peut pas corriger ce biais
 * sur une manœuvre isolée, l'information manquante étant précisément celle que
 * l'on cherche ; on peut en revanche lui faire moins confiance.
 */
const symmetryWeight = (m: ManeuverLocation, windDir: number): number => {
  const twaIn = Math.abs(angleDiff(m.entryHeading, windDir));
  const twaOut = Math.abs(angleDiff(m.exitHeading, windDir));
  const asymmetry = Math.abs(twaIn - twaOut);
  return Math.max(MIN_SYMMETRY_WEIGHT, 1 - asymmetry / SYMMETRY_SPAN_DEG);
};

/**
 * Variations du vent au fil de la session, mesurées aux manœuvres. Renvoie
 * `null` s'il y a moins de deux manœuvres.
 */
export const calculateWindStats = (
  trackData: PointData[],
  maneuverStats: ManeuverStats | null,
  referenceWind?: number | null
): WindStats | null => {
  if (trackData.length === 0) return null;

  const maneuvers = maneuverSamples(maneuverStats);
  if (maneuvers.length < 2) return null;

  const directions = maneuvers.map((m) => m.localWind);

  // Juger la symétrie d'une manœuvre demande de savoir d'où vient le vent. Le
  // vent global convient : c'est lui qui a servi à classer ces manœuvres, et
  // il est ancré sur la polaire de toute la session. À défaut, la moyenne
  // brute des mesures sert d'amorce, moins sûre car une série biaisée juge
  // alors sa propre symétrie par rapport à son propre biais.
  const rough = referenceWind ?? circularMean(directions).mean;
  const weights = maneuvers.map((m) => symmetryWeight(m, rough));

  const stats = circularStats(directions, weights);
  const reference = stats.mean;

  // Tendance : régression pondérée des écarts à la moyenne sur le temps.
  const timesMin = maneuvers.map((m) => (m.timeMs - maneuvers[0].timeMs) / 60000);
  const devs = directions.map((d) => angleDiff(d, reference));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const meanX = timesMin.reduce((a, x, i) => a + weights[i] * x, 0) / totalWeight;
  const meanY = devs.reduce((a, y, i) => a + weights[i] * y, 0) / totalWeight;
  let num = 0;
  let den = 0;
  for (let i = 0; i < maneuvers.length; i++) {
    num += weights[i] * (timesMin[i] - meanX) * (devs[i] - meanY);
    den += weights[i] * (timesMin[i] - meanX) ** 2;
  }

  const samples: TimedDirection[] = maneuvers.map((m) => ({
    timeMs: m.timeMs,
    direction: m.localWind,
  }));

  const maxGapMs = MAX_INTERPOLATION_GAP_MIN * 60 * 1000;
  const windAt = (timeMs: number) => interpolateDirection(samples, timeMs, reference, maxGapMs);

  const graphData: WindGraphPoint[] = [];
  const step = Math.ceil(trackData.length / CHART_MAX_POINTS);
  for (let i = 0; i < trackData.length; i += step) {
    const timeMs = trackData[i].timeMs;
    const date = new Date(timeMs);
    const direction = windAt(timeMs);
    graphData.push({
      index: i,
      timeLabel: `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`,
      angle: direction === null ? null : reference + angleDiff(direction, reference),
      display: direction === null ? null : Math.round(direction),
      isManeuver: false,
    });
  }

  for (const m of maneuvers) {
    const slot = Math.round(m.trackIndex / step);
    if (slot >= 0 && slot < graphData.length) graphData[slot].isManeuver = true;
  }

  return {
    avgWind: Math.round(stats.mean),
    minWind: Math.round(normalizeAngle(stats.mean + stats.minDev)),
    maxWind: Math.round(normalizeAngle(stats.mean + stats.maxDev)),
    range: Math.round(stats.maxDev - stats.minDev),
    stdDev: Math.round(stats.stdDevDeg),
    slopePerHour: den !== 0 ? (num / den) * 60 : 0,
    count: maneuvers.length,
    stableShare: maneuvers.filter((m) => m.stableHeadings).length / maneuvers.length,
    graphData,
    windAt,
  };
};

// ---------------------------------------------------------------------------
// Qualité des manœuvres : moyennes et podiums
// ---------------------------------------------------------------------------

export type ManeuverMetric = 'conservation' | 'relaunch' | 'headingChange' | 'distance';

export const MANEUVER_METRICS: { key: ManeuverMetric; label: string; hint: string }[] = [
  {
    key: 'conservation',
    label: 'Conservation de vitesse',
    hint: 'Vitesse minimale sur vitesse d\'entrée. Isole la technique de la force du vent.',
  },
  {
    key: 'relaunch',
    label: 'Temps de relance',
    hint: 'Du point le plus lent au retour à 90 % de la vitesse d\'entrée. Long : relance laborieuse en archimédien.',
  },
  {
    key: 'headingChange',
    label: 'Changement de cap',
    hint: 'Entre les caps stabilisés avant et après. Un virement qui s\'ouvre à 120° a perdu du cap pour reprendre le vol.',
  },
  {
    key: 'distance',
    label: 'Distance de manœuvre',
    hint: 'De l\'entrée du virage à la relance. Empreinte spatiale de la manœuvre.',
  },
];

export interface ManeuverTop {
  /** Indice dans `ManeuverStats.locations`. */
  index: number;
  value: number;
  label: string;
  timeMs: number;
  path: [number, number][];
}

export interface ManeuverTypeSummary {
  count: number;
  success: number;
  fail: number;
  vminAvg: string;
  vminMax: string;
  averages: Record<ManeuverMetric, string>;
  tops: Record<ManeuverMetric, ManeuverTop[]>;
}

export interface ManeuverSummary {
  tack: ManeuverTypeSummary | null;
  jibe: ManeuverTypeSummary | null;
}

const metricValue = (m: ManeuverLocation, metric: ManeuverMetric): number | null => {
  switch (metric) {
    case 'conservation':
      return m.conservation;
    case 'relaunch':
      return m.relaunchS;
    case 'headingChange':
      return m.headingChange;
    case 'distance':
      return m.distanceM > 0 ? m.distanceM : null;
  }
};

export const formatMetric = (metric: ManeuverMetric, value: number | null): string => {
  if (value === null || !isFinite(value)) return '-';
  switch (metric) {
    case 'conservation':
      return `${Math.round(value * 100)} %`;
    case 'relaunch':
      return `${value.toFixed(1)} s`;
    case 'headingChange':
      return `${Math.round(value)}°`;
    case 'distance':
      return `${Math.round(value)} m`;
  }
};

/** Vrai si, pour cette métrique, une valeur plus grande est meilleure. */
const higherIsBetter: Record<ManeuverMetric, boolean> = {
  conservation: true,
  relaunch: false,
  headingChange: false,
  distance: false,
};

const summarizeType = (
  locations: ManeuverLocation[],
  type: 'tack' | 'jibe'
): ManeuverTypeSummary | null => {
  const indexed = locations
    .map((m, index) => ({ m, index }))
    .filter(({ m }) => m.type === type);
  if (indexed.length === 0) return null;

  const vmins = indexed.map(({ m }) => m.vmin);
  const averages = {} as Record<ManeuverMetric, string>;
  const tops = {} as Record<ManeuverMetric, ManeuverTop[]>;

  for (const { key } of MANEUVER_METRICS) {
    const valued = indexed
      .map(({ m, index }) => ({ m, index, value: metricValue(m, key) }))
      .filter((e): e is { m: ManeuverLocation; index: number; value: number } => e.value !== null);

    averages[key] =
      valued.length > 0
        ? formatMetric(key, valued.reduce((a, e) => a + e.value, 0) / valued.length)
        : '-';

    const sorted = [...valued].sort((a, b) =>
      higherIsBetter[key] ? b.value - a.value : a.value - b.value
    );
    tops[key] = sorted.slice(0, 3).map((e) => ({
      index: e.index,
      value: e.value,
      label: formatMetric(key, e.value),
      timeMs: e.m.timeMs,
      path: e.m.path,
    }));
  }

  return {
    count: indexed.length,
    success: indexed.filter(({ m }) => m.success).length,
    fail: indexed.filter(({ m }) => !m.success).length,
    vminAvg: (vmins.reduce((a, b) => a + b, 0) / vmins.length).toFixed(1),
    vminMax: Math.max(...vmins).toFixed(1),
    averages,
    tops,
  };
};

/** Moyennes et podiums des métriques de qualité, par type de manœuvre. */
export const summarizeManeuvers = (maneuverStats: ManeuverStats | null): ManeuverSummary => {
  if (!maneuverStats) return { tack: null, jibe: null };
  return {
    tack: summarizeType(maneuverStats.locations, 'tack'),
    jibe: summarizeType(maneuverStats.locations, 'jibe'),
  };
};

/**
 * VMG par allure et par bord, sur fenêtre temporelle glissante.
 */
export const calculateVmgStats = (
  trackData: PointData[],
  wind: WindSource | null,
  /** Vitesse minimale, en nœuds, pour qu'une fenêtre compte dans la VMG. */
  minSpeedKn: number = getDefaultThresholdKn(),
  windowSeconds: number = VMG_WINDOW_S
): VmgStats | null => {
  if (trackData.length === 0 || wind === null) return null;

  const windowMs = windowSeconds * 1000;

  let maxUpStbd = 0, maxUpPort = 0, maxDownStbd = 0, maxDownPort = 0;
  let sumUpStbd = 0, sumUpPort = 0, sumDownStbd = 0, sumDownPort = 0;
  let cUpStbd = 0, cUpPort = 0, cDownStbd = 0, cDownPort = 0;

  /** Fenêtre [i, j] : moyenne de vitesse, de VMG et bord dominant. */
  const evaluateWindow = (i: number, j: number) => {
    let sumVmg = 0;
    let sumSpeed = 0;
    let portCount = 0;
    let stbdCount = 0;
    let allAboveMin = true;

    for (let k = i; k <= j; k++) {
      const p = trackData[k];
      if (p.smoothedSpeed < minSpeedKn) allAboveMin = false;
      sumSpeed += p.smoothedSpeed;
      const diff = angleDiff(p.bearing, resolveWind(wind, p.timeMs));
      sumVmg += p.smoothedSpeed * Math.cos(diff * (Math.PI / 180));
      if (diff < 0) stbdCount++; else portCount++;
    }

    const n = j - i + 1;
    return {
      avgSpeed: sumSpeed / n,
      avgVmg: sumVmg / n,
      isStarboard: stbdCount > portCount,
      allAboveMin,
    };
  };

  const windows: { start: number; end: number; avgSpeed: number; avgVmg: number; isStarboard: boolean; allAboveMin: boolean }[] = [];
  let j = 0;

  for (let i = 0; i < trackData.length; i++) {
    if (j < i) j = i;
    while (j + 1 < trackData.length && trackData[j + 1].timeMs - trackData[i].timeMs <= windowMs) j++;
    // Fenêtre trop courte : fin de trace, ou trou d'enregistrement juste après i.
    // Dans le second cas on continue, la session reprend plus loin.
    if (trackData[j].timeMs - trackData[i].timeMs < windowMs * 0.8) {
      if (j === trackData.length - 1) break;
      continue;
    }

    const w = evaluateWindow(i, j);
    windows.push({ start: i, end: j, ...w });

    if (w.avgSpeed >= minSpeedKn) {
      if (w.avgVmg > 0) {
        if (w.isStarboard) { if (w.avgVmg > maxUpStbd) maxUpStbd = w.avgVmg; sumUpStbd += w.avgVmg; cUpStbd++; }
        else { if (w.avgVmg > maxUpPort) maxUpPort = w.avgVmg; sumUpPort += w.avgVmg; cUpPort++; }
      } else {
        const absVmg = -w.avgVmg;
        if (w.isStarboard) { if (absVmg > maxDownStbd) maxDownStbd = absVmg; sumDownStbd += absVmg; cDownStbd++; }
        else { if (absVmg > maxDownPort) maxDownPort = absVmg; sumDownPort += absVmg; cDownPort++; }
      }
    }
  }

  const getTopVmg = (isUpwind: boolean) => {
    const candidates = windows
      .filter(w => w.allAboveMin && (isUpwind ? w.avgVmg > 0 : w.avgVmg < 0))
      .map(w => ({ start: w.start, end: w.end, val: Math.abs(w.avgVmg) }))
      .sort((a, b) => b.val - a.val);

    const tops: { val: string; path: [number, number][] }[] = [];
    const selected: { start: number; end: number }[] = [];
    for (const w of candidates) {
      if (tops.length >= 3) break;
      const overlap = selected.some(s => Math.max(w.start, s.start) <= Math.min(w.end, s.end));
      if (!overlap) {
        const path = trackData.slice(w.start, w.end + 1).map(p => [p.lat, p.lon] as [number, number]);
        tops.push({ val: w.val.toFixed(1), path });
        selected.push({ start: w.start, end: w.end });
      }
    }
    while (tops.length < 3) tops.push({ val: "-", path: [] });
    return tops;
  };

  return {
    upStbd: { max: maxUpStbd.toFixed(1), avg: cUpStbd > 0 ? (sumUpStbd / cUpStbd).toFixed(1) : "0.0" },
    upPort: { max: maxUpPort.toFixed(1), avg: cUpPort > 0 ? (sumUpPort / cUpPort).toFixed(1) : "0.0" },
    downStbd: { max: maxDownStbd.toFixed(1), avg: cDownStbd > 0 ? (sumDownStbd / cDownStbd).toFixed(1) : "0.0" },
    downPort: { max: maxDownPort.toFixed(1), avg: cDownPort > 0 ? (sumDownPort / cDownPort).toFixed(1) : "0.0" },
    topsUpwind: getTopVmg(true),
    topsDownwind: getTopVmg(false)
  };
};
