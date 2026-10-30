import { bandIndex, upperMedianOfSorted } from '../core/basics';
import type { ImuRecording } from '../core/imuFile';
import { kmhToMs } from '../core/units';
import { segmentDistanceM } from '../core/sessionStats';
import { pathsWhere } from '../core/trackPaths';
import type { TrackPoint } from '../core/types';
import type { GradeProfile } from '../core/sportProfiles';
import { classifyGrade, gradeZones, type GradeZone } from '../core/grade';

/**
 * Cadence à pied : pas par minute, mesurés par l'accéléromètre du téléphone
 * porté sur soi (poche, main, brassard, ceinture), pour la course, la marche
 * et le fractionné à pied (demande du 16/10).
 *
 * Le module de l'accélération ne dépend pas de la façon dont le téléphone est
 * tenu : chaque appui y laisse un choc. On lui retire sa moyenne glissante
 * (la pesanteur, et le biais du capteur), on le moyenne sur une grille fixe
 * (même résultat à 50 et à 100 Hz, règle 2), puis, sur une fenêtre centrée
 * sur chaque instant, on cherche sa période par autocorrélation :
 * - la première crête assez haute au regard de la plus haute, pas la plus
 *   haute elle-même, qui peut tomber sur deux ou trois pas d'un signal très
 *   régulier ;
 * - pas ou foulée : un téléphone dans une poche marque plus l'appui de sa
 *   jambe que celui de l'autre, et la période qui ressort est celle de la
 *   foulée (deux pas). Si la demi-période corrèle encore assez, c'est elle
 *   qu'on retient. Sinon, en poche de pantalon, le téléphone ne sent souvent
 *   que sa jambe : la crête est une foulée si elle est trop longue pour un pas
 *   (marche), ou si elle pourrait être l'un ou l'autre mais que les secousses
 *   sont celles de la course (`strideRmsMs2`) ; marche du 17/10 ;
 * - interpolation parabolique de la crête, pour une cadence au dixième.
 *
 * Pas de cadence (`null`) à l'arrêt (secousses trop faibles), sur un signal
 * sans régularité, ou dans un trou de la capture.
 *
 * La cadence part dans le GPX de la session, en foulées par minute dans
 * `gpxtpx:cad` (convention de Garmin et de Strava : pas ÷ 2) ; à la lecture,
 * `stepCadenceSpm` la remet en pas par minute.
 */

/** Constantes de la mesure (`SPORT_PROFILES.running.cadence`). */
export interface CadenceDetection {
  /** Pas de la grille de calcul, en secondes. */
  gridStepS: number;
  /** Écart entre deux mesures au-delà duquel la capture a un trou, en secondes. */
  maxGapS: number;
  /** Moyenne glissante retirée au module (pesanteur, biais), en secondes. */
  gravityWindowS: number;
  /** Fenêtre de l'autocorrélation, centrée sur l'instant mesuré, en secondes. */
  windowS: number;
  /** Écart entre deux mesures de cadence, en secondes. */
  stepS: number;
  /** Cadence la plus basse et la plus haute cherchées, en pas par minute. */
  minSpm: number;
  maxSpm: number;
  /** Corrélation de la crête retenue sous laquelle le signal n'est pas régulier. */
  minCorrelation: number;
  /** Une crête plus tôt est prise si elle atteint cette part de la plus haute. */
  peakFraction: number;
  /** La demi-période d'une crête est le pas si elle en atteint cette part. */
  halfPeriodFraction: number;
  /**
   * Écart type du module, sans pesanteur, au-dessus duquel une crête sans
   * demi-période, qui pourrait être un pas lent ou une foulée de course, est
   * une foulée, en m/s².
   */
  strideRmsMs2: number;
  /** Écart type du module, sans pesanteur, sous lequel on est à l'arrêt, en m/s². */
  minRmsMs2: number;
  /** Part de la fenêtre que la capture doit couvrir. */
  minCoverage: number;
  /** Lissage de la courbe des graphes, en secondes. */
  chartSmoothingS: number;
  /** Temps couvert par la cadence sous lequel une session est dite sans cadence, en secondes. */
  minCoverageS: number;
  /** Écart entre deux points au-delà duquel la cadence n'est pas comptée entre eux, en secondes. */
  gapS: number;
  /**
   * Unité de `cad` d'un GPX, pas ou foulées par minute (décision du 27/10) :
   * longueur de pas divisée par la fréquence des pas (en pas par seconde),
   * vraisemblable entre ces bornes, en m·s. Lue sur les segments mesurés :
   * pris tels quels, puis doublés, un seul des deux sens doit y tomber.
   */
  stepLengthPerHz: { min: number; max: number };
  /**
   * Faute d'indice de longueur de pas (pas de mouvement, ou les deux sens
   * aussi vraisemblables) : une médiane de `cad` au-dessus est déjà en pas par
   * minute, en dessous en foulées.
   */
  spmAbove: number;
  /** Bornes basses des tranches de cadence de la marche et de la course, en pas par minute. */
  walkBands: readonly number[];
  runBands: readonly number[];
  /** Cadence moyenne au-dessus de laquelle la session prend les tranches de la course. */
  runAboveSpm: number;
  /** Durée de la cadence maximale, en secondes. */
  maxWindowS: number;
  /** Largeur d'une tranche de vitesse, en km/h. */
  speedBinKmh: number;
  /** Temps sous lequel une tranche de vitesse n'est pas montrée, en secondes. */
  minBinS: number;
  /** Temps mesuré en mouvement sous lequel la dérive n'est pas donnée, en secondes. */
  driftMinS: number;
  /**
   * Garder toute la capture dans la mémoire : vrai tant que la mesure se
   * règle sur de vraies sorties (relues par adb) ; faux, elle n'est pas
   * rangée quand elle ne servait qu'à la cadence.
   */
  keepCapture: boolean;
}

/** Cadence mesurée sur une capture, un pas tous les `stepS`, depuis `startMs` (heure). */
export interface CadenceSeries {
  startMs: number;
  stepS: number;
  /** Pas par minute, `null` sans mesure. */
  spm: (number | null)[];
}

/**
 * Module de l'accélération moyenné sur la grille, `NaN` dans les trous ;
 * le premier point de la grille est au premier relevé de l'accéléromètre.
 */
const accelMagnitudeGrid = (rec: ImuRecording, p: CadenceDetection): { startUs: number; values: Float64Array } | null => {
  const accel = rec.series.find((s) => s.info.kind === 'accel');
  if (!accel || accel.t.length < 2 || accel.values.length < 3) return null;
  const [x, y, z] = accel.values;
  const stepUs = p.gridStepS * 1e6;
  const startUs = accel.t[0];
  const n = Math.floor((accel.t[accel.t.length - 1] - startUs) / stepUs) + 1;
  const sum = new Float64Array(n);
  const count = new Uint16Array(n);
  for (let i = 0; i < accel.t.length; i++) {
    const k = Math.floor((accel.t[i] - startUs) / stepUs);
    if (k < 0 || k >= n) continue;
    sum[k] += Math.hypot(x[i], y[i], z[i]);
    count[k]++;
  }
  // Cases vides : comblées entre deux cases pleines assez proches, sinon trou.
  const values = new Float64Array(n);
  const maxEmpty = Math.max(1, Math.round(p.maxGapS / p.gridStepS));
  let last = -1;
  for (let k = 0; k < n; k++) {
    if (count[k] === 0) continue;
    values[k] = sum[k] / count[k];
    if (last >= 0 && k - last > 1) {
      const fill = k - last - 1 <= maxEmpty;
      for (let j = last + 1; j < k; j++) {
        values[j] = fill ? values[last] + ((values[k] - values[last]) * (j - last)) / (k - last) : NaN;
      }
    }
    last = k;
  }
  return { startUs, values };
};

/** Retire au signal sa moyenne glissante centrée (sur les seules valeurs connues). */
const removeMovingMean = (values: Float64Array, half: number): Float64Array => {
  const n = values.length;
  const cumSum = new Float64Array(n + 1);
  const cumCount = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) {
    const known = Number.isFinite(values[k]);
    cumSum[k + 1] = cumSum[k] + (known ? values[k] : 0);
    cumCount[k + 1] = cumCount[k] + (known ? 1 : 0);
  }
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    if (!Number.isFinite(values[k])) { out[k] = NaN; continue; }
    const a = Math.max(0, k - half);
    const b = Math.min(n, k + half + 1);
    out[k] = values[k] - (cumSum[b] - cumSum[a]) / (cumCount[b] - cumCount[a]);
  }
  return out;
};

/** Autocorrélation normalisée de `x` (sans trou) pour les décalages de 0 à `maxLag`. */
const autocorrelation = (x: Float64Array, maxLag: number): Float64Array => {
  const n = x.length;
  const r = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag && lag < n - 1; lag++) {
    let xy = 0;
    let xx = 0;
    let yy = 0;
    for (let i = 0; i + lag < n; i++) {
      const a = x[i];
      const b = x[i + lag];
      xy += a * b;
      xx += a * a;
      yy += b * b;
    }
    r[lag] = xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
  }
  return r;
};

/** Crête locale de l'autocorrélation. */
const isPeak = (r: Float64Array, k: number) => k > 0 && k < r.length - 1 && r[k] >= r[k - 1] && r[k] >= r[k + 1];

/**
 * Période d'un pas dans une fenêtre, en cases de la grille (fractionnaire), ou
 * `null` ; `rmsMs2` : écart type de la fenêtre.
 */
export const stepPeriod = (x: Float64Array, p: CadenceDetection, rmsMs2: number): number | null => {
  const minLag = Math.max(2, Math.floor(60 / p.maxSpm / p.gridStepS));
  const maxStepLag = Math.ceil(60 / p.minSpm / p.gridStepS);
  const maxLag = Math.min(x.length - 2, 2 * maxStepLag + 1);
  if (maxLag <= minLag) return null;
  const r = autocorrelation(x, maxLag);
  const peaks: number[] = [];
  for (let k = minLag; k < maxLag; k++) if (isPeak(r, k)) peaks.push(k);
  if (peaks.length === 0) return null;
  const best = Math.max(...peaks.map((k) => r[k]));
  if (best < p.minCorrelation) return null;
  let chosen = peaks.find((k) => r[k] >= p.peakFraction * best)!;
  // Pas ou foulée : la demi-période, si elle corrèle encore assez, est le pas.
  const half = chosen / 2;
  const span = Math.max(1, Math.round(half * 0.15));
  let halfPeak = -1;
  for (let k = Math.max(minLag, Math.floor(half) - span); k <= Math.ceil(half) + span; k++) {
    if (isPeak(r, k) && (halfPeak < 0 || r[k] > r[halfPeak])) halfPeak = k;
  }
  // Sans demi-période, une foulée : trop longue pour un pas, ou secousses de course.
  let steps = 1;
  if (halfPeak >= minLag && r[halfPeak] >= p.halfPeriodFraction * r[chosen] && r[halfPeak] >= p.minCorrelation / 2) chosen = halfPeak;
  else if (chosen > maxStepLag || (half >= minLag && rmsMs2 >= p.strideRmsMs2)) steps = 2;
  if (chosen / steps > maxStepLag) return null;
  // Crête affinée par une parabole sur ses deux voisines.
  const a = r[chosen - 1];
  const b = r[chosen];
  const c = r[chosen + 1];
  const denom = a - 2 * b + c;
  const shift = denom < 0 ? (0.5 * (a - c)) / denom : 0;
  return (chosen + Math.max(-0.5, Math.min(0.5, shift))) / steps;
};

/** Cadence d'une capture, un pas tous les `stepS` ; `null` si elle n'a pas d'accéléromètre. */
export const cadenceSeries = (rec: ImuRecording, p: CadenceDetection): CadenceSeries | null => {
  const grid = accelMagnitudeGrid(rec, p);
  if (!grid) return null;
  const dyn = removeMovingMean(grid.values, Math.round(p.gravityWindowS / 2 / p.gridStepS));
  const n = dyn.length;
  const halfWindow = Math.round(p.windowS / 2 / p.gridStepS);
  const every = Math.max(1, Math.round(p.stepS / p.gridStepS));
  const spm: (number | null)[] = [];
  const window = new Float64Array(2 * halfWindow + 1);
  for (let center = 0; center < n; center += every) {
    const a = Math.max(0, center - halfWindow);
    const b = Math.min(n, center + halfWindow + 1);
    let known = 0;
    let sum = 0;
    for (let k = a; k < b; k++) if (Number.isFinite(dyn[k])) { known++; sum += dyn[k]; }
    if (known < p.minCoverage * (2 * halfWindow + 1)) { spm.push(null); continue; }
    // Trous comblés par la moyenne : ils ne créent pas de corrélation.
    const mean = sum / known;
    const len = b - a;
    let sq = 0;
    for (let k = 0; k < len; k++) {
      const v = dyn[a + k];
      window[k] = Number.isFinite(v) ? v - mean : 0;
      sq += window[k] * window[k];
    }
    const rms = Math.sqrt(sq / known);
    if (rms < p.minRmsMs2) { spm.push(null); continue; }
    const period = stepPeriod(window.subarray(0, len), p, rms);
    spm.push(period === null ? null : Math.round((600 / (period * p.gridStepS))) / 10);
  }
  const wallMs = rec.header.clock.wallMs + grid.startUs / 1000;
  return { startMs: wallMs, stepS: every * p.gridStepS, spm };
};

/** Cadence à un instant (la mesure la plus proche, à moins d'un pas), ou `null`. */
export const cadenceAt = (series: CadenceSeries, timeMs: number): number | null => {
  const k = Math.round((timeMs - series.startMs) / (series.stepS * 1000));
  return k >= 0 && k < series.spm.length ? series.spm[k] : null;
};

/** Foulées par minute écrites dans le GPX (`gpxtpx:cad`, entier) pour une cadence en pas par minute. */
export const gpxStrideCadence = (spm: number): number => Math.round(spm / 2);

/** Valeur de `cad` utilisable : un nombre fini, positif. */
const cadValue = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Facteur qui met `cad` en pas par minute : 2 en foulées par minute (Garmin,
 * Strava, Tracker), 1 si le fichier l'écrit déjà en pas (décision du 27/10).
 *
 * Indice : la longueur de pas divisée par la fréquence des pas (L/f, en m·s),
 * sur les segments où la cadence est connue aux deux bouts, hors trous et
 * reprises. Avec D la distance, T le temps et N les pas comptés tels quels,
 * L/f vaut D·T/N² ; doubler les pas la divise par 4. Le sens qui seul tombe
 * dans `stepLengthPerHz` l'emporte : une marche à 1,4 m/s écrite à 110 pas/min
 * donne 0,42 telle quelle, 0,10 doublée. Sans mouvement, ou si les deux sens
 * sont aussi vraisemblables, la médiane décide (`spmAbove`).
 */
export const cadenceFactor = (
  track: readonly TrackPoint[],
  p: Pick<CadenceDetection, 'gapS' | 'stepLengthPerHz' | 'spmAbove'>
): 1 | 2 => {
  const values = track.map((pt) => pt.cadence).filter(cadValue).sort((a, b) => a - b);
  if (values.length === 0) return 2;
  let d = 0;
  let t = 0;
  let steps = 0;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1].cadence;
    const b = track[i].cadence;
    const dtS = (track[i].timeMs - track[i - 1].timeMs) / 1000;
    if (!cadValue(a) || !cadValue(b) || dtS <= 0 || dtS > p.gapS || track[i].segmentStart) continue;
    d += segmentDistanceM(track as TrackPoint[], i);
    t += dtS;
    steps += ((a + b) / 2 / 60) * dtS;
  }
  if (d > 0 && steps > 0) {
    const asIs = (d * t) / (steps * steps);
    const plausible = (v: number) => v >= p.stepLengthPerHz.min && v <= p.stepLengthPerHz.max;
    const keep = plausible(asIs);
    const double = plausible(asIs / 4);
    if (keep !== double) return keep ? 1 : 2;
  }
  return upperMedianOfSorted(values) > p.spmAbove ? 1 : 2;
};

/** Cadence du GPX en pas par minute, point par point (`null` sans valeur ou à 0), `cad` multiplié par `factor` (`cadenceFactor`). */
export const stepCadenceSpm = (raw: readonly (number | undefined)[], factor: 1 | 2): (number | null)[] =>
  raw.map((v) => (cadValue(v) ? v * factor : null));

/**
 * Positions d'un enregistrement avec leur cadence (`cadenceSpm`), mesurée à
 * leur instant ; celles sans mesure restent telles quelles.
 */
export const joinCadence = <F extends { timeMs: number }>(fixes: readonly F[], series: CadenceSeries): (F & { cadenceSpm?: number })[] =>
  fixes.map((fix) => {
    const spm = cadenceAt(series, fix.timeMs);
    return spm === null ? fix : { ...fix, cadenceSpm: spm };
  });

/** Cadence d'une session, point par point de la trace. */
export interface SessionCadence {
  /** Pas par minute de chaque point, `null` sans mesure. */
  spm: (number | null)[];
  /** La même, lissée sur `chartSmoothingS` (graphes). */
  smoothed: (number | null)[];
  /** Temps couvert par la cadence, en secondes. */
  coveredS: number;
  /** Assez de cadence pour en parler (`minCoverageS`) : courbe et onglet « cadence ». */
  present: boolean;
}

/** Moyenne glissante centrée sur `windowS`, des seules valeurs connues ; `null` là où la valeur manque. */
const smoothByTime = (values: readonly (number | null)[], times: readonly number[], windowS: number): (number | null)[] => {
  const half = (windowS * 1000) / 2;
  const out: (number | null)[] = [];
  let a = 0;
  let b = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    while (b < values.length && times[b] <= times[i] + half) {
      if (values[b] !== null) { sum += values[b]!; count++; }
      b++;
    }
    while (times[a] < times[i] - half) {
      if (values[a] !== null) { sum -= values[a]!; count--; }
      a++;
    }
    out.push(values[i] === null || count === 0 ? null : sum / count);
  }
  return out;
};

/** Cadence d'une trace (`cad` du GPX), en pas par minute, avec sa couverture. */
export const sessionCadence = (track: readonly TrackPoint[], p: CadenceDetection): SessionCadence => {
  const factor = cadenceFactor(track, p);
  const spm = stepCadenceSpm(track.map((pt) => pt.cadence), factor);
  // Temps couvert : pas les trous (plus de `gapS`) ni les pauses, comme `measuredSegments`.
  let coveredMs = 0;
  for (let i = 1; i < track.length; i++) {
    const dtMs = track[i].timeMs - track[i - 1].timeMs;
    if (spm[i] === null || spm[i - 1] === null || dtMs <= 0 || dtMs > p.gapS * 1000 || track[i].segmentStart) continue;
    coveredMs += dtMs;
  }
  const times = track.map((pt) => pt.timeMs);
  const coveredS = coveredMs / 1000;
  return { spm, smoothed: smoothByTime(spm, times, p.chartSmoothingS), coveredS, present: coveredS >= p.minCoverageS };
};

/** Cadence et longueur de pas d'une partie de la session (tranche de vitesse, zone de pente, tiers). */
export interface CadenceShare {
  timeS: number;
  /** Cadence moyenne, en pas par minute. */
  spm: number;
  /** Longueur de pas moyenne, en mètres : distance ÷ pas. */
  stepLengthM: number | null;
}

/** Ce que dit l'onglet « cadence ». */
export interface CadenceAnalysis {
  /** Cadence moyenne en mouvement, en pas par minute. */
  averageSpm: number;
  /** Meilleure cadence moyenne sur `maxWindowS`, ou `null` si la session est plus courte. */
  maxSpm: number | null;
  /** Durée de la cadence maximale, en secondes (`CadenceDetection.maxWindowS`). */
  maxWindowS: number;
  /** Pas comptés sur toute la session. */
  steps: number;
  /** Longueur de pas moyenne en mouvement, en mètres. */
  stepLengthM: number | null;
  /** Part du temps en mouvement où la cadence est mesurée. */
  measuredShare: number;
  /** Tranches : bornes basses (marche ou course) et secondes en mouvement dans chacune, « sous la première » compris. */
  bands: { bounds: readonly number[]; timesS: number[]; running: boolean };
  /** Par tranche de vitesse, de la plus lente à la plus rapide (bornes en m/s). */
  bySpeed: (CadenceShare & { fromMs: number; toMs: number })[];
  /** Par zone de pente, dans l'ordre de `gradeZones` ; `null` sans altitude. */
  byGrade: (CadenceShare & { zone: GradeZone })[] | null;
  /** Premier et dernier tiers du temps mesuré en mouvement ; `null` sur une session trop courte. */
  drift: { first: CadenceShare; last: CadenceShare } | null;
}

/** Accumulateur d'une part de la session. */
class ShareSum {
  timeS = 0;
  spmTime = 0;
  steps = 0;
  distanceM = 0;
  add(dtS: number, spm: number, d: number) {
    this.timeS += dtS;
    this.spmTime += spm * dtS;
    this.steps += (spm / 60) * dtS;
    this.distanceM += d;
  }
  share(): CadenceShare {
    return {
      timeS: this.timeS,
      spm: this.timeS > 0 ? this.spmTime / this.timeS : 0,
      stepLengthM: this.steps > 0 ? this.distanceM / this.steps : null,
    };
  }
}

/** Un segment mesuré : celui qui arrive au point `i`, sa durée, sa cadence moyenne et sa distance. */
export interface MeasuredSegment {
  i: number;
  dtS: number;
  spm: number;
  d: number;
}

/** Le segment qui arrive au point `i` : mesuré si la cadence est connue à ses deux bouts et qu'il n'enjambe pas un trou. */
const measuredSegments = (track: readonly TrackPoint[], spm: readonly (number | null)[], gapS: number): MeasuredSegment[] => {
  const out: MeasuredSegment[] = [];
  for (let i = 1; i < track.length; i++) {
    const a = spm[i - 1];
    const b = spm[i];
    const dtS = (track[i].timeMs - track[i - 1].timeMs) / 1000;
    if (a === null || b === null || dtS <= 0 || dtS > gapS) continue;
    out.push({ i, dtS, spm: (a + b) / 2, d: segmentDistanceM(track as TrackPoint[], i) });
  }
  return out;
};

/**
 * Chiffres de l'onglet « cadence » : moyenne en mouvement, maximum sur
 * `maxWindowS`, pas, longueur de pas, tranches, selon la vitesse et la pente,
 * dérive. Seuls comptent les segments en mouvement (`active`) où la cadence
 * est mesurée ; les pas, eux, sont comptés partout. `null` sans mesure en mouvement.
 */
export const analyzeCadence = (
  track: readonly TrackPoint[],
  spm: readonly (number | null)[],
  active: readonly boolean[],
  grades: { values: readonly number[]; zones: GradeProfile } | null,
  p: CadenceDetection
): CadenceAnalysis | null => {
  const segments = measuredSegments(track, spm, p.gapS);
  const moving = segments.filter((s) => active[s.i]);
  const total = new ShareSum();
  for (const s of moving) total.add(s.dtS, s.spm, s.d);
  if (total.timeS <= 0) return null;
  const steps = segments.reduce((n, s) => n + (s.spm / 60) * s.dtS, 0);
  let movingTimeS = 0;
  for (let i = 1; i < track.length; i++) if (active[i]) movingTimeS += (track[i].timeMs - track[i - 1].timeMs) / 1000;
  const average = total.share();

  // Maximum : la meilleure moyenne sur `maxWindowS` de temps mesuré en mouvement d'affilée.
  let maxSpm: number | null = null;
  let start = 0;
  let sumSpmTime = 0;
  let sumTime = 0;
  for (let j = 0; j < moving.length; j++) {
    sumSpmTime += moving[j].spm * moving[j].dtS;
    sumTime += moving[j].dtS;
    const endMs = track[moving[j].i].timeMs;
    while (start < j && endMs - track[moving[start].i - 1].timeMs > p.maxWindowS * 1000) {
      sumSpmTime -= moving[start].spm * moving[start].dtS;
      sumTime -= moving[start].dtS;
      start++;
    }
    const spanS = (endMs - track[moving[start].i - 1].timeMs) / 1000;
    if (spanS >= p.maxWindowS * 0.95 && sumTime >= p.maxWindowS * 0.8) {
      const mean = sumSpmTime / sumTime;
      if (maxSpm === null || mean > maxSpm) maxSpm = mean;
    }
  }

  // Tranches : celles de la course ou de la marche, selon la cadence moyenne.
  const running = average.spm >= p.runAboveSpm;
  const bounds = running ? p.runBands : p.walkBands;
  const timesS = new Array<number>(bounds.length + 1).fill(0);
  for (const s of moving) timesS[bandIndex(s.spm, bounds)] += s.dtS;

  // Selon la vitesse : tranches de `speedBinKmh`, sur la vitesse lissée du point.
  const binMs = kmhToMs(p.speedBinKmh);
  const bins = new Map<number, ShareSum>();
  for (const s of moving) {
    const k = Math.floor(track[s.i].smoothedSpeedMs / binMs);
    if (!bins.has(k)) bins.set(k, new ShareSum());
    bins.get(k)!.add(s.dtS, s.spm, s.d);
  }
  const bySpeed = [...bins.entries()]
    .filter(([, sum]) => sum.timeS >= p.minBinS)
    .sort(([a], [b]) => a - b)
    .map(([k, sum]) => ({ ...sum.share(), fromMs: k * binMs, toMs: (k + 1) * binMs }));

  // Selon la pente : les zones de l'onglet « zones de pente ».
  let byGrade: CadenceAnalysis['byGrade'] = null;
  if (grades && grades.values.some((g) => Number.isFinite(g))) {
    const list = gradeZones(grades.zones);
    const zones = new Map(list.map((z) => [z.key, new ShareSum()]));
    for (const s of moving) {
      const zone = classifyGrade(grades.values[s.i], grades.zones);
      if (zone) zones.get(zone)!.add(s.dtS, s.spm, s.d);
    }
    byGrade = list.map((z) => ({ zone: z, ...zones.get(z.key)!.share() }));
  }

  // Dérive : premier et dernier tiers du temps mesuré en mouvement.
  let drift: CadenceAnalysis['drift'] = null;
  if (total.timeS >= p.driftMinS) {
    const first = new ShareSum();
    const last = new ShareSum();
    let elapsed = 0;
    for (const s of moving) {
      if (elapsed < total.timeS / 3) first.add(s.dtS, s.spm, s.d);
      else if (elapsed >= (2 * total.timeS) / 3) last.add(s.dtS, s.spm, s.d);
      elapsed += s.dtS;
    }
    drift = { first: first.share(), last: last.share() };
  }

  return {
    averageSpm: average.spm,
    maxSpm,
    maxWindowS: p.maxWindowS,
    steps,
    stepLengthM: average.stepLengthM,
    measuredShare: movingTimeS > 0 ? Math.min(1, total.timeS / movingTimeS) : 0,
    bands: { bounds, timesS, running },
    bySpeed,
    byGrade,
    drift,
  };
};

/** Segments mesurés d'une session (`measuredSegments`), et si les dates de sa trace ne reculent jamais. */
export interface MeasuredCadenceSegments {
  list: MeasuredSegment[];
  /** Aucune date de la trace ne recule ni n'est illisible (NaN) : les segments se suivent dans le temps. */
  ordered: boolean;
}

/** Segments mesurés d'une session, calculés une fois pour la cadence de chaque répétition (`timeSpanCadence`, lot 56). */
export const measuredCadenceSegments = (
  track: readonly TrackPoint[],
  spm: readonly (number | null)[],
  gapS: number
): MeasuredCadenceSegments => {
  let ordered = true;
  for (let i = 1; i < track.length && ordered; i++) if (!(track[i].timeMs >= track[i - 1].timeMs)) ordered = false;
  return { list: measuredSegments(track, spm, gapS), ordered };
};

/**
 * Cadence et longueur de pas entre deux instants (l'effort d'une répétition),
 * ou `null` sans mesure : les segments mesurés de la session
 * (`measuredCadenceSegments`, sur la même trace) qui commencent à `startMs`
 * ou après et finissent à `endMs` ou avant, dans leur ordre. Dates de la
 * trace jamais décroissantes (le cas ordinaire) : ces segments se suivent, le
 * premier est trouvé par dichotomie (lot 56).
 */
export const timeSpanCadence = (
  measured: MeasuredCadenceSegments,
  track: readonly TrackPoint[],
  startMs: number,
  endMs: number
): CadenceShare | null => {
  const sum = new ShareSum();
  const segments = measured.list;
  if (measured.ordered) {
    let lo = 0;
    let hi = segments.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (track[segments[mid].i - 1].timeMs >= startMs) hi = mid;
      else lo = mid + 1;
    }
    for (let k = lo; k < segments.length && track[segments[k].i].timeMs <= endMs; k++) {
      sum.add(segments[k].dtS, segments[k].spm, segments[k].d);
    }
  } else {
    for (const s of segments) {
      if (track[s.i - 1].timeMs >= startMs && track[s.i].timeMs <= endMs) sum.add(s.dtS, s.spm, s.d);
    }
  }
  return sum.timeS > 0 ? sum.share() : null;
};


/**
 * Passages d'une tranche de cadence, à montrer sur la carte : suites de
 * segments en mouvement dont la cadence tombe dans la tranche (`zone` : 0 sous
 * la première borne, puis une par borne).
 */
export const cadenceBandPaths = (
  track: readonly TrackPoint[],
  spm: readonly (number | null)[],
  active: readonly boolean[],
  bounds: readonly number[],
  zone: number,
  gapS: number
): [number, number][][] =>
  pathsWhere(
    track,
    measuredSegments(track, spm, gapS).map((s) => ({ from: s.i - 1, to: s.i, spm: s.spm })),
    (s) => active[s.to] && bandIndex(s.spm, bounds) === zone
  );
