import { median } from '../core/basics';
import { firstIndexAtOrAfter } from '../core/search';
import { pickTopWindows } from '../core/topSegments';
import type { PointData } from './pointData';
import { WIND_LOCAL_MAX_GAP_MIN, isDirected, windAt, type ManeuverKind, type ManeuverLocation, type ManeuverStats, type Tack, type WindReference } from './maneuvers';
import { VMG_MIN_WINDOW_RATIO, VMG_WINDOW_S, getDefaultThresholdKn } from './sailingConfig';
import { circularStats, interpolateDirection, type TimedDirection, type WindEstimate } from './wind';
import { angleDiff, circularMean, normalizeDeg } from '../core/angles';
import { formatDecimal, msToKnots } from '../core/units';
import { MAX_GAP_S } from '../core/sportProfiles';

/** Meilleure et moyenne VMG d'une allure et d'une amure, en nœuds, non arrondies : la page les formate dans son unité. */
export interface VmgCell {
  max: number;
  avg: number;
}

export interface VmgStats {
  upStbd: VmgCell;
  upPort: VmgCell;
  downStbd: VmgCell;
  downPort: VmgCell;
  /** Podiums, au format des meilleurs segments (`TopSegment`), valeur déjà arrondie. */
  topsUpwind: { val: string; path: [number, number][] }[];
  topsDownwind: { val: string; path: [number, number][] }[];
}

export interface WindGraphPoint {
  /** Point de la trace. */
  index: number;
  /** Temps écoulé depuis le début de la trace, en minutes : l'axe des graphes et de leur zoom. */
  minutes: number;
  /**
   * Valeur tracée, exprimée comme référence + écart à la référence, pour
   * rester continue autour de la moyenne sans dérouler la série. `null` loin
   * de toute manœuvre, ce qui interrompt la courbe.
   */
  angle: number | null;
  /**
   * Vrai sur la ligne affichée la plus proche d'une manœuvre : c'est là que se
   * trouve une vraie mesure, ailleurs la courbe est interpolée.
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
  /** Direction autour de laquelle la courbe est tracée sans se dérouler : la moyenne, en degrés. */
  referenceDeg: number;
  /** Points de trace des manœuvres mesurées, dans l'ordre du temps. */
  maneuverIndices: number[];
  /** Vent interpolé à un instant, ou `null` loin de toute manœuvre. */
  windAt: (timeMs: number) => number | null;
}

/** Trou maximal, en minutes, à travers lequel on interpole encore entre deux manœuvres : celui du classement. */
const MAX_INTERPOLATION_GAP_MIN = WIND_LOCAL_MAX_GAP_MIN;

/**
 * Manœuvres retenues pour suivre le vent : toutes celles que la détection a
 * classées, virements et empannages, réussis ou non, caps stabilisés ou non ;
 * jamais un sens incertain, dont le vent local n'est qu'une supposition
 * (`isDirected`).
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
  return maneuverStats.locations.filter(isDirected).sort((a, b) => a.timeMs - b.timeMs);
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

  // Arrondi puis normalisé : une moyenne à 359,7° s'affiche 0°, jamais 360°.
  return {
    avgWind: normalizeDeg(Math.round(stats.mean)),
    minWind: normalizeDeg(Math.round(stats.mean + stats.minDev)),
    maxWind: normalizeDeg(Math.round(stats.mean + stats.maxDev)),
    range: Math.round(stats.maxDev - stats.minDev),
    stdDev: Math.round(stats.stdDevDeg),
    slopePerHour: den !== 0 ? (num / den) * 60 : 0,
    count: maneuvers.length,
    stableShare: maneuvers.filter((m) => m.stableHeadings).length / maneuvers.length,
    referenceDeg: reference,
    maneuverIndices: maneuvers.map((m) => m.trackIndex),
    windAt,
  };
};

/**
 * Lignes du graphe du vent aux points `indices` de la trace (croissants, ceux
 * de la plage visible, `sampledIndices`). Chaque manœuvre de la plage marque
 * la ligne la plus proche d'elle ; zoomer en sépare deux qui se touchaient.
 */
export const windChartRows = (
  trackData: PointData[],
  wind: Pick<WindStats, 'referenceDeg' | 'maneuverIndices' | 'windAt'>,
  indices: readonly number[]
): WindGraphPoint[] => {
  if (trackData.length === 0 || indices.length === 0) return [];
  const startMs = trackData[0].timeMs;
  const reference = wind.referenceDeg;
  const rows = indices.map((i): WindGraphPoint => {
    const timeMs = trackData[i].timeMs;
    const direction = wind.windAt(timeMs);
    return {
      index: i,
      minutes: (timeMs - startMs) / 60000,
      angle: direction === null ? null : reference + angleDiff(direction, reference),
      isManeuver: false,
    };
  });
  const first = indices[0];
  const last = indices[indices.length - 1];
  for (const k of wind.maneuverIndices) {
    if (k < first || k > last) continue;
    // Première ligne au point k ou après, puis la plus proche des deux voisines.
    const lo = firstIndexAtOrAfter(indices, k);
    const slot = lo > 0 && k - indices[lo - 1] < indices[lo] - k ? lo - 1 : lo;
    rows[slot].isManeuver = true;
  }
  return rows;
};

// ---------------------------------------------------------------------------
// Qualité des manœuvres : moyennes et podiums
// ---------------------------------------------------------------------------

export type ManeuverMetric = 'conservation' | 'relaunch' | 'headingChange' | 'distance' | 'windwardGain';

type ManeuverType = ManeuverKind;

/** Nom d'une manœuvre, par genre, dans le tableau, la carte et les listes. */
export const MANEUVER_LABELS: Record<ManeuverKind, string> = {
  tack: 'Virement',
  jibe: 'Empannage',
  undecided: 'Sens incertain',
};

/** Nom d'une amure, dans le tableau par amure et le détail d'une manœuvre. */
export const TACK_LABELS: Record<Tack, string> = {
  starboard: 'Tribord',
  port: 'Bâbord',
};

/** L'autre amure : celle d'après un virement ou un empannage. */
export const oppositeTack = (tack: Tack): Tack => (tack === 'starboard' ? 'port' : 'starboard');

export const MANEUVER_METRICS: {
  key: ManeuverMetric;
  label: string;
  hint: string;
  /**
   * Types de manœuvre dont la métrique a un podium. Une métrique qui décrit
   * sans juger n'en a pas : le cap de sortie d'un empannage est un choix
   * d'allure, et son podium tombait au hasard.
   */
  ranked: ManeuverType[];
}[] = [
  {
    key: 'conservation',
    label: 'Conservation de vitesse',
    hint: 'Vitesse minimale sur vitesse d\'approche. Isole la technique de la force du vent.',
    ranked: ['tack', 'jibe'],
  },
  {
    key: 'relaunch',
    label: 'Temps de relance',
    hint: 'Du point le plus lent au retour à 90 % de la vitesse d\'approche. Long : relance laborieuse en archimédien. Sans retour dans la minute, la manœuvre est comptée à part.',
    ranked: ['tack', 'jibe'],
  },
  {
    key: 'headingChange',
    label: 'Changement de cap',
    hint: 'Du cap d\'approche au cap de sortie. Un virement qui s\'ouvre à 120° a perdu du cap pour reprendre le vol. Pas de podium pour les empannages : leur cap de sortie est un choix d\'allure.',
    ranked: ['tack'],
  },
  {
    key: 'distance',
    label: 'Distance de manœuvre',
    hint: 'Du début du virage à la relance. Empreinte spatiale de la manœuvre.',
    ranked: ['tack', 'jibe'],
  },
  {
    key: 'windwardGain',
    label: 'Gain au vent',
    hint: 'Pendant le virage : mètres parcourus vers le vent au virement, sous le vent à l\'empannage. Manœuvres réussies seulement.',
    ranked: ['tack', 'jibe'],
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
  /**
   * Manœuvres sans relance dans la minute : elles n'entrent ni dans la
   * moyenne ni dans le podium du temps de relance, qui paraîtraient sinon
   * meilleurs qu'ils ne sont sans que rien ne le dise.
   */
  withoutRelaunch: number;
  /** Vitesse minimale moyenne et meilleure, en nœuds, non arrondies. */
  vminAvg: number;
  vminMax: number;
  averages: Record<ManeuverMetric, string>;
  /** Podiums, vides pour une métrique qui n'en a pas pour ce type (`MANEUVER_METRICS[].ranked`). */
  tops: Record<ManeuverMetric, ManeuverTop[]>;
}

/** Virements ou empannages d'une amure : comptés, réussis, et leurs médianes. */
export interface ManeuverTackSummary {
  count: number;
  success: number;
  /** Vitesse minimale médiane, en nœuds, non arrondie. */
  vminMedian: number;
  /** Conservation de vitesse médiane (`MANEUVER_METRICS`, `conservation`), de 0 à 1. */
  conservationMedian: number;
}

/** Manœuvres d'un genre dirigé, par amure avant la manœuvre ; `null` sans manœuvre sur cette amure. */
export type ManeuversByTack = Record<Tack, ManeuverTackSummary | null>;

export interface ManeuverSummary {
  tack: ManeuverTypeSummary | null;
  jibe: ManeuverTypeSummary | null;
  /** Sens incertain : moyennes seulement, aucun podium (`MANEUVER_METRICS[].ranked`). */
  undecided: ManeuverTypeSummary | null;
  /** Virements et empannages par amure avant la manœuvre (HISTORIQUE, point 267). */
  byTack: Record<'tack' | 'jibe', ManeuversByTack>;
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
      return m.distanceM !== null && m.distanceM > 0 ? m.distanceM : null;
    case 'windwardGain':
      return m.windwardGainM;
  }
};

export const formatMetric = (metric: ManeuverMetric, value: number | null): string => {
  if (value === null || !isFinite(value)) return '-';
  switch (metric) {
    case 'conservation':
      return `${Math.round(value * 100)} %`;
    case 'relaunch':
      return `${formatDecimal(value, 1)} s`;
    case 'headingChange':
      return `${Math.round(value)}°`;
    case 'distance':
      return `${Math.round(value)} m`;
    case 'windwardGain': {
      const rounded = Math.round(value);
      return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded)} m`;
    }
  }
};

/** Vrai si, pour cette métrique, une valeur plus grande est meilleure. */
const higherIsBetter: Record<ManeuverMetric, boolean> = {
  conservation: true,
  relaunch: false,
  headingChange: false,
  distance: false,
  windwardGain: true,
};

/**
 * Départage de deux manœuvres de même valeur. Sans lui, le tri stable mettait
 * devant la plus ancienne, ce qui arrive souvent à 1 Hz, où les relances
 * tombent sur des secondes entières. La meilleure conservation départage ; pour
 * la conservation elle-même, la relance la plus courte, une manœuvre sans
 * relance passant après.
 */
const tieBreak = (metric: ManeuverMetric, a: ManeuverLocation, b: ManeuverLocation): number => {
  if (metric !== 'conservation') return b.conservation - a.conservation;
  if (a.relaunchS === b.relaunchS) return 0;
  if (a.relaunchS === null) return 1;
  if (b.relaunchS === null) return -1;
  return a.relaunchS - b.relaunchS;
};

const summarizeType = (
  locations: ManeuverLocation[],
  type: ManeuverType
): ManeuverTypeSummary | null => {
  const indexed = locations
    .map((m, index) => ({ m, index }))
    .filter(({ m }) => m.type === type);
  if (indexed.length === 0) return null;

  const vmins = indexed.map(({ m }) => m.vmin);
  const averages = {} as Record<ManeuverMetric, string>;
  const tops = {} as Record<ManeuverMetric, ManeuverTop[]>;

  for (const { key, ranked } of MANEUVER_METRICS) {
    const valued = indexed
      .map(({ m, index }) => ({ m, index, value: metricValue(m, key) }))
      .filter((e): e is { m: ManeuverLocation; index: number; value: number } => e.value !== null);

    averages[key] =
      valued.length > 0
        ? formatMetric(key, valued.reduce((a, e) => a + e.value, 0) / valued.length)
        : '-';

    if (!ranked.includes(type)) {
      tops[key] = [];
      continue;
    }
    const sorted = [...valued].sort(
      (a, b) => (higherIsBetter[key] ? b.value - a.value : a.value - b.value) || tieBreak(key, a.m, b.m)
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
    withoutRelaunch: indexed.filter(({ m }) => m.relaunchS === null).length,
    vminAvg: vmins.reduce((a, b) => a + b, 0) / vmins.length,
    vminMax: Math.max(...vmins),
    averages,
    tops,
  };
};

/**
 * Manœuvres d'un genre dirigé sur une amure : comptées, réussies, vitesse
 * minimale et conservation médianes, la conservation lue par `metricValue`,
 * jamais par une seconde formule.
 */
const summarizeTack = (locations: ManeuverLocation[], type: 'tack' | 'jibe', tack: Tack): ManeuverTackSummary | null => {
  const onTack = locations.filter((m) => m.type === type && m.tack === tack);
  if (onTack.length === 0) return null;
  const conservations = onTack
    .map((m) => metricValue(m, 'conservation'))
    .filter((value): value is number => value !== null);
  return {
    count: onTack.length,
    success: onTack.filter((m) => m.success).length,
    vminMedian: median(onTack.map((m) => m.vmin)),
    conservationMedian: median(conservations),
  };
};

const byTackOf = (locations: ManeuverLocation[], type: 'tack' | 'jibe'): ManeuversByTack => ({
  starboard: summarizeTack(locations, type, 'starboard'),
  port: summarizeTack(locations, type, 'port'),
});

const EMPTY_BY_TACK: ManeuversByTack = { starboard: null, port: null };

/** Écart, en degrés, au-delà duquel un vent saisi loin du vent calculé fiable est signalé (`windInputWarning`). */
export const WIND_INPUT_WARNING_DEG = 45;

/** Ce que la phrase d'avertissement sous le tableau des manœuvres dit : vent saisi, vent calculé, virages écartés. */
export interface WindInputWarning {
  manualDeg: number;
  autoDeg: number;
  /** Virages francs que le vent saisi range « ni virement ni empannage » (`rejected.unclassified`). */
  unclassified: number;
}

/**
 * Avertissement d'un vent saisi probablement faux (HISTORIQUE, point 268) : avec des
 * bords à ±45° du vent, un vent saisi à plus de 45° du vent calculé met
 * l'approche et la sortie d'un virement du même côté de l'axe, et toutes les
 * manœuvres tombent en « sens incertain » sans qu'aucun chiffre ne le relie
 * au vent saisi. Levé quand le vent est saisi, que le vent calculé est fiable,
 * que l'écart dépasse `WIND_INPUT_WARNING_DEG` et que les virages écartés
 * dépassent les virements et empannages comptés ; `null` sinon.
 */
export const windInputWarning = (
  { manualDeg, autoWind, stats }: { manualDeg: number | null; autoWind: WindEstimate | null; stats: ManeuverStats | null }
): WindInputWarning | null => {
  if (manualDeg === null || !autoWind?.reliable || !stats) return null;
  if (Math.abs(angleDiff(manualDeg, autoWind.direction)) <= WIND_INPUT_WARNING_DEG) return null;
  const counted = stats.tackSuccess + stats.tackFail + stats.jibeSuccess + stats.jibeFail;
  if (!(stats.rejected.unclassified > counted)) return null;
  return { manualDeg, autoDeg: autoWind.direction, unclassified: stats.rejected.unclassified };
};

/** Moyennes et podiums des métriques de qualité, par type de manœuvre, et le détail par amure. */
export const summarizeManeuvers = (maneuverStats: ManeuverStats | null): ManeuverSummary => {
  if (!maneuverStats) return { tack: null, jibe: null, undecided: null, byTack: { tack: EMPTY_BY_TACK, jibe: EMPTY_BY_TACK } };
  return {
    tack: summarizeType(maneuverStats.locations, 'tack'),
    jibe: summarizeType(maneuverStats.locations, 'jibe'),
    undecided: summarizeType(maneuverStats.locations, 'undecided'),
    byTack: { tack: byTackOf(maneuverStats.locations, 'tack'), jibe: byTackOf(maneuverStats.locations, 'jibe') },
  };
};

/** Bornes d'une manœuvre, tous types confondus, en indices de la trace (`ManeuverLocation`). */
export type ManeuverSpan = Pick<ManeuverLocation, 'entryIndex' | 'exitIndex'>;

/**
 * Ce que la VMG écarte d'une manœuvre : sa rotation seule (décidé le 05/11), la
 * relance pouvant durer jusqu'à une minute sans être encore la manœuvre. Les
 * mêmes bornes pour les chiffres, la courbe et les trous qu'elle franchit.
 */
export const vmgManeuverSpans = (locations: readonly ManeuverLocation[]): ManeuverSpan[] =>
  locations.map((m) => ({ entryIndex: m.entryIndex, exitIndex: m.rotationEndIndex }));

/**
 * Sommes cumulées de la VMG, sur les intervalles : l'intervalle k arrive au
 * point k (k ≥ 1). Un seul passage lit chaque point une fois (durée du pas,
 * vitesse, VMG, bord, sous le minimum), et chaque fenêtre se lit ensuite en
 * O(1) : à 5 Hz sur 3 h, le vent local n'est plus relu 51 fois par point. Un
 * pas de reprise de pause (`segmentStart`) pèse zéro. Pour les chiffres
 * (`calculateVmgStats`) et la courbe (`vmgSeries`).
 *
 * Le temps en manœuvre et les trous se comptent en intervalles, non en
 * secondes : un pas de reprise de pause, qui pèse zéro, y compte quand même.
 */
const vmgSums = (trackData: PointData[], wind: WindReference, minSpeedKn: number, maxGapS: number, maneuvers: readonly ManeuverSpan[]) => {
  const n = trackData.length;
  const cumDt = new Float64Array(n);
  const cumSpeedDt = new Float64Array(n);
  const cumVmgDt = new Float64Array(n);
  const cumStbdDt = new Float64Array(n);
  // Nombre de points sous le minimum parmi les points 0..k.
  const cumBelow = new Int32Array(n);
  // Nombre d'intervalles en manœuvre, et d'intervalles plus longs que `maxGapS`, parmi les intervalles 1..k.
  const cumManeuver = new Int32Array(n);
  const cumGap = new Int32Array(n);
  const inManeuver = new Uint8Array(n);
  for (const { entryIndex, exitIndex } of maneuvers) {
    // Du début de la rotation à la relance : les intervalles entry+1..exit. Tenue en un point (règle 10), l'intervalle
    // qui y arrive porte le virage : une fenêtre qui passe par ce point ne le manque pas.
    const from = exitIndex > entryIndex ? entryIndex + 1 : Math.max(1, entryIndex);
    const to = Math.min(n - 1, Math.max(from, exitIndex));
    for (let k = from; k <= to; k++) inManeuver[k] = 1;
  }
  cumBelow[0] = trackData[0].smoothedSpeed < minSpeedKn ? 1 : 0;
  for (let k = 1; k < n; k++) {
    const p = trackData[k];
    const stepS = (p.timeMs - trackData[k - 1].timeMs) / 1000;
    const dt = p.segmentStart ? 0 : Math.max(0, stepS);
    const diff = angleDiff(p.bearing, windAt(wind, p.timeMs));
    // Trou de trace (règle 6, comme les manœuvres : HISTORIQUE, point 225) : vitesse moyenne du pas = distance retenue (bornée par
    // la corde, nulle si immobile) / durée. Hors trou, la vitesse lissée du point, inchangée.
    const speed = dt > maxGapS && p.stepDistanceM !== undefined ? msToKnots(p.stepDistanceM / dt) : p.smoothedSpeed;
    const vmg = speed * Math.cos(diff * (Math.PI / 180));
    cumDt[k] = cumDt[k - 1] + dt;
    cumSpeedDt[k] = cumSpeedDt[k - 1] + speed * dt;
    cumVmgDt[k] = cumVmgDt[k - 1] + vmg * dt;
    cumStbdDt[k] = cumStbdDt[k - 1] + (diff < 0 ? dt : 0);
    cumBelow[k] = cumBelow[k - 1] + (p.smoothedSpeed < minSpeedKn ? 1 : 0);
    cumManeuver[k] = cumManeuver[k - 1] + inManeuver[k];
    cumGap[k] = cumGap[k - 1] + (stepS > maxGapS ? 1 : 0);
  }
  return { cumDt, cumSpeedDt, cumVmgDt, cumStbdDt, cumBelow, cumManeuver, cumGap };
};

/**
 * VMG par allure et par bord, sur fenêtre temporelle glissante, en sommes
 * cumulées (`vmgSums`). La fenêtre `[i, j]` couvre les intervalles `i+1..j`,
 * chacun pesant sa durée (règle 2 : une portion dense de points ne pèse pas
 * plus qu'une portion creuse de même durée ; le point `i` apportait le cap de
 * l'intervalle d'avant la fenêtre). Une fenêtre qui touche une manœuvre ne
 * compte ni dans les moyennes, ni dans les max, ni dans les podiums.
 */
export const calculateVmgStats = (
  trackData: PointData[],
  wind: WindReference | null,
  /** Vitesse minimale, en nœuds, pour qu'une fenêtre compte dans la VMG. */
  minSpeedKn: number = getDefaultThresholdKn(),
  windowSeconds: number = VMG_WINDOW_S,
  /** Un pas plus long est un trou de la trace (règle 6) : il pèse par sa distance, pas par la vitesse lissée du point de reprise. */
  maxGapS: number = MAX_GAP_S,
  /** Manœuvres de la session, écartées des chiffres. */
  maneuvers: readonly ManeuverSpan[] = []
): VmgStats | null => {
  if (trackData.length === 0 || wind === null) return null;

  const windowMs = windowSeconds * 1000;
  const n = trackData.length;
  const { cumDt, cumSpeedDt, cumVmgDt, cumStbdDt, cumBelow, cumManeuver } = vmgSums(trackData, wind, minSpeedKn, maxGapS, maneuvers);

  let maxUpStbd = 0, maxUpPort = 0, maxDownStbd = 0, maxDownPort = 0;
  let sumUpStbd = 0, sumUpPort = 0, sumDownStbd = 0, sumDownPort = 0;
  let cUpStbd = 0, cUpPort = 0, cDownStbd = 0, cDownPort = 0;

  // Fenêtres candidates au podium (toutes au-dessus du minimum), au près et au portant, en tableaux typés (HISTORIQUE, point 197).
  const up = { starts: new Int32Array(n), ends: new Int32Array(n), vals: new Float64Array(n), size: 0 };
  const down = { starts: new Int32Array(n), ends: new Int32Array(n), vals: new Float64Array(n), size: 0 };
  let j = 0;

  for (let i = 0; i < n; i++) {
    if (j < i) j = i;
    while (j + 1 < n && trackData[j + 1].timeMs - trackData[i].timeMs <= windowMs) j++;
    // Fenêtre trop courte : fin de trace, ou trou d'enregistrement juste après i.
    // Dans le second cas on continue, la session reprend plus loin.
    if (trackData[j].timeMs - trackData[i].timeMs < windowMs * VMG_MIN_WINDOW_RATIO) {
      if (j === n - 1) break;
      continue;
    }

    if (cumManeuver[j] - cumManeuver[i] > 0) continue;
    const durationS = cumDt[j] - cumDt[i];
    if (durationS <= 0) continue;
    const avgSpeed = (cumSpeedDt[j] - cumSpeedDt[i]) / durationS;
    const avgVmg = (cumVmgDt[j] - cumVmgDt[i]) / durationS;
    const isStarboard = cumStbdDt[j] - cumStbdDt[i] > durationS / 2;
    const allAboveMin = cumBelow[j] - (i > 0 ? cumBelow[i - 1] : 0) === 0;
    // Ni NaN ni zéro : ni au près ni au portant.
    const side = avgVmg > 0 ? up : avgVmg < 0 ? down : null;
    if (allAboveMin && side) {
      side.starts[side.size] = i;
      side.ends[side.size] = j;
      side.vals[side.size] = Math.abs(avgVmg);
      side.size++;
    }

    if (avgSpeed >= minSpeedKn) {
      // Moyenne pondérée par la durée (règle 2) : chaque fenêtre pèse le pas de son point de départ, borné à la
      // fenêtre, pour qu'un passage dense en points ne pèse pas plus qu'un passage clairsemé de même durée.
      const w = Math.min((trackData[i + 1].timeMs - trackData[i].timeMs) / 1000, windowSeconds);
      if (avgVmg > 0) {
        if (isStarboard) { if (avgVmg > maxUpStbd) maxUpStbd = avgVmg; sumUpStbd += avgVmg * w; cUpStbd += w; }
        else { if (avgVmg > maxUpPort) maxUpPort = avgVmg; sumUpPort += avgVmg * w; cUpPort += w; }
      } else {
        const absVmg = -avgVmg;
        if (isStarboard) { if (absVmg > maxDownStbd) maxDownStbd = absVmg; sumDownStbd += absVmg * w; cDownStbd += w; }
        else { if (absVmg > maxDownPort) maxDownPort = absVmg; sumDownPort += absVmg * w; cDownPort += w; }
      }
    }
  }

  // Podium : les trois meilleures fenêtres qui ne se chevauchent pas, comme les meilleurs segments.
  const getTopVmg = (isUpwind: boolean) => {
    const side = isUpwind ? up : down;
    const tops: { val: string; path: [number, number][] }[] = pickTopWindows(side.starts, side.ends, side.vals, side.size, 3).map((k) => ({
      val: side.vals[k].toFixed(1),
      path: trackData.slice(side.starts[k], side.ends[k] + 1).map((p) => [p.lat, p.lon] as [number, number]),
    }));
    while (tops.length < 3) tops.push({ val: '-', path: [] });
    return tops;
  };

  return {
    upStbd: { max: maxUpStbd, avg: cUpStbd > 0 ? sumUpStbd / cUpStbd : 0 },
    upPort: { max: maxUpPort, avg: cUpPort > 0 ? sumUpPort / cUpPort : 0 },
    downStbd: { max: maxDownStbd, avg: cDownStbd > 0 ? sumDownStbd / cDownStbd : 0 },
    downPort: { max: maxDownPort, avg: cDownPort > 0 ? sumDownPort / cDownPort : 0 },
    topsUpwind: getTopVmg(true),
    topsDownwind: getTopVmg(false),
  };
};

/**
 * Courbe de la VMG, en nœuds par point de la trace : positive au près, négative
 * au portant, moyennée sur `windowSeconds` centrées sur le point (règle 2 : les
 * sommes cumulées des chiffres, `vmgSums`), `null` là où les chiffres ne
 * comptent pas : fenêtre qui touche une manœuvre, allure moyenne sous le
 * minimum, fenêtre trop courte (bouts de la trace). Pas de fenêtre à travers
 * un trou : elle ne dirait rien de ce qui s'y est passé.
 *
 * La fenêtre est la plus petite suite de points qui couvre l'intervalle centré :
 * sur une trace économique (règle 10), un point garde ses deux voisins plutôt
 * que de rester seul dans sa fenêtre.
 */
export const vmgSeries = (
  trackData: PointData[],
  wind: WindReference | null,
  /** Vitesse minimale, en nœuds, de la moyenne de la fenêtre. */
  minSpeedKn: number = getDefaultThresholdKn(),
  /** Manœuvres de la session : un trou dans la courbe. */
  maneuvers: readonly ManeuverSpan[] = [],
  windowSeconds: number = VMG_WINDOW_S,
  maxGapS: number = MAX_GAP_S
): (number | null)[] => {
  if (trackData.length === 0 || wind === null) return [];

  const windowMs = windowSeconds * 1000;
  const n = trackData.length;
  const { cumDt, cumSpeedDt, cumVmgDt, cumManeuver, cumGap } = vmgSums(trackData, wind, minSpeedKn, maxGapS, maneuvers);
  const series = new Array<number | null>(n).fill(null);
  let i = 0;
  let j = 0;
  for (let c = 0; c < n; c++) {
    const timeMs = trackData[c].timeMs;
    while (i + 1 < n && trackData[i + 1].timeMs <= timeMs - windowMs / 2) i++;
    while (j + 1 < n && trackData[j].timeMs < timeMs + windowMs / 2) j++;
    if (trackData[j].timeMs - trackData[i].timeMs < windowMs * VMG_MIN_WINDOW_RATIO) continue;
    if (cumManeuver[j] - cumManeuver[i] > 0 || cumGap[j] - cumGap[i] > 0) continue;
    const durationS = cumDt[j] - cumDt[i];
    if (durationS <= 0 || !((cumSpeedDt[j] - cumSpeedDt[i]) / durationS >= minSpeedKn)) continue;
    const avgVmg = (cumVmgDt[j] - cumVmgDt[i]) / durationS;
    if (Number.isFinite(avgVmg)) series[c] = avgVmg;
  }
  return series;
};

/**
 * Points de la courbe de VMG que le trait franchit d'un seul tenant (05/11,
 * demande de l'utilisateur : une courbe coupée à chaque manœuvre devient
 * illisible) : les trous qui contiennent une manœuvre, entre deux valeurs. Un
 * autre trou (arrêt, passage sous le seuil, trace coupée) reste un trou, il dit
 * que rien de comparable ne s'est passé là. La manœuvre reste écartée : aucune
 * valeur n'y est tracée, le trait va droit d'un bord à l'autre.
 */
export const vmgBridgedHoles = (series: readonly (number | null)[], maneuvers: readonly ManeuverSpan[]): Uint8Array => {
  const n = series.length;
  const bridged = new Uint8Array(n);
  const inManeuver = new Uint8Array(n);
  for (const { entryIndex, exitIndex } of maneuvers) {
    for (let k = Math.max(0, entryIndex); k <= exitIndex && k < n; k++) inManeuver[k] = 1;
  }
  let start = -1;
  let touches = false;
  for (let k = 0; k < n; k++) {
    if (series[k] === null) {
      if (start < 0) { start = k; touches = false; }
      if (inManeuver[k]) touches = true;
    } else {
      // Un trou au tout début n'a pas de valeur avant lui : rien à relier ; à la toute fin, la boucle ne passe jamais ici.
      if (start > 0 && touches) bridged.fill(1, start, k);
      start = -1;
    }
  }
  return bridged;
};

/** Ligne du graphe de la VMG. */
export interface VmgGraphPoint {
  /** Point de la trace. */
  index: number;
  /** Temps écoulé depuis le début de la trace, en minutes : l'axe des graphes et de leur zoom. */
  minutes: number;
  /** VMG dans l'unité du graphe, `null` dans un trou. */
  vmg: number | null;
  /** Morceau de courbe réduit à cette ligne : le trait ne la montrerait pas, elle reçoit un point. */
  alone: boolean;
}

/**
 * Lignes du graphe de la VMG aux points `indices` de la trace (croissants, ceux
 * de la plage visible). Une ligne représente aussi les points sautés depuis la
 * précédente : l'un d'eux dans un trou, elle est un trou. Sans cela, un arrêt
 * tomberait entre deux lignes sur une longue session et la courbe passerait
 * dessus sans le montrer. Un trou franchi (`bridged`, `vmgBridgedHoles`) ne
 * donne aucune ligne : le trait relie ses deux bords, y compris quand l'un est
 * hors de la plage zoomée.
 */
export const vmgChartRows = (
  series: readonly (number | null)[],
  minutes: ArrayLike<number>,
  indices: readonly number[],
  /** Nœuds vers l'unité du graphe. */
  toChartValue: (kn: number) => number,
  /** Points des trous que le trait franchit, sinon aucun. */
  bridged?: ArrayLike<number>
): VmgGraphPoint[] => {
  if (series.length === 0) return [];
  const isBridged = (k: number): boolean => bridged !== undefined && bridged[k] === 1;
  const drawn = indices.filter((k) => !isBridged(k));
  if (indices.length > 0) {
    // Plage qui commence ou finit dans un trou franchi : le bord de ce trou, hors de la plage, tient le trait.
    let before = indices[0];
    while (before > 0 && isBridged(before)) before--;
    if (before !== indices[0]) drawn.unshift(before);
    let after = indices[indices.length - 1];
    while (after < series.length - 1 && isBridged(after)) after++;
    if (after !== indices[indices.length - 1]) drawn.push(after);
  }
  const rows = drawn.map((index, k): VmgGraphPoint => {
    let vmg = series[index];
    for (let p = k > 0 ? drawn[k - 1] + 1 : index; p < index && vmg !== null; p++) if (series[p] === null && !isBridged(p)) vmg = null;
    return { index, minutes: minutes[index], vmg: vmg === null ? null : toChartValue(vmg), alone: false };
  });
  rows.forEach((row, k) => {
    row.alone = row.vmg !== null && (rows[k - 1]?.vmg ?? null) === null && (rows[k + 1]?.vmg ?? null) === null;
  });
  return rows;
};
