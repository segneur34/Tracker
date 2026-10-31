import { nearestIndexAtTime, valueAtTime } from './search';
import type { ImuRecording } from './imuFile';
import {
  captureBounds, centredMean, fileUsOf, verticalAcceleration, wallMsOf,
  type AttitudeParams, type ImuVertical, type ImuWindow,
} from './imuVertical';
import { autocorrelation, firstStrongPeak, refinedPeak } from './periodicity';
import { spanOfRun, type ActiveRun, type TrackSpan } from './sessionStats';
import type { CumulativeTrack, TrackPoint } from './types';

/**
 * Pumping sur foil, commun au surf (§10, point 104) et à la voile (lot 22),
 * mesuré par l'accéléromètre et le gyroscope du téléphone fixé sur la
 * poitrine, depuis le `.imu` de la session, vol par vol : les vols viennent
 * du module (`SurfFlight` en surf, `sailingFlights` en voile). Tout est en
 * SI : instants du fichier en µs, heures en ms, accélérations en m/s²,
 * distances en mètres. L'élagage propre au surf reste dans `surfing/imuPrune.ts`.
 *
 * Le vol (la planche lancée) n'est pas le pumping (lot 50, décision du 31/10) :
 * le pumping se cherche seulement en vol, et seulement là où une cadence
 * régulière de coups le valide, par séries.
 *
 * - Verticale du monde (`core/imuVertical.ts`), quelle que soit l'orientation
 *   du téléphone, comme pour les sauts.
 * - Coups : chaque pompe fait osciller le buste de haut en bas. L'accélération
 *   verticale, lissée et privée de sa dérive lente (`pumpSignal`), passe sous
 *   −`strokeMinG` puis au-dessus de +`strokeMinG` : un coup, à
 *   `strokeMinPeriodS` au moins du précédent.
 * - Cadence (`pumpCadence`) : sur une fenêtre glissante, la période du même
 *   signal est cherchée par autocorrélation, comme la cadence à pied
 *   (`core/periodicity.ts`) ; la fenêtre valide le pumping si elle corrèle
 *   assez et que sa période tombe dans la plage de cadence du pumping. Un clapot
 *   irrégulier, une vibration rapide ou une houle lente ne valident rien.
 * - Séries : dans chaque plage validée, les coups espacés de `strokeMaxGapS`
 *   au plus forment une série, gardée si elle en compte `minSeriesStrokes`.
 *   Deux plages séparées de plus de `strokeMaxGapS` restent deux séries (une
 *   fenêtre ratée plus courte ne coupe rien) ; aucune durée plafond. Le temps pompé est
 *   celui des séries ; la distance pompée, l'intégrale de la vitesse sur elles.
 * - Décollage (expérimental) : sur l'eau, la planche tape et le buste vibre ;
 *   en vol, plus rien que le pumping, plus lent. Le décollage est la dernière
 *   reprise du calme (rugosité de l'accélération verticale, filtrée au-dessus
 *   de quelques hertz) autour du début du vol vu par le GPS. Sa vitesse est
 *   celle du GPS à cet instant.
 *
 * Toutes les durées sont en secondes : une capture à 50 ou 200 Hz, une trace à
 * 1 ou 5 Hz, donnent le même résultat (règle 2).
 */

/** Constantes du pumping (`SPORT_PROFILES[sport].pump`). */
export interface PumpDetection extends AttitudeParams {
  /** Lissage centré de l'accélération verticale avant le compte des coups, en secondes. */
  strokeSmoothingS: number;
  /** Dérive lente retirée : moyenne glissante sur cette durée, en secondes. */
  strokeBaselineS: number;
  /** Un coup : l'accélération passe sous −cette valeur puis au-dessus de +cette valeur, en g. */
  strokeMinG: number;
  /** Écart minimal entre deux coups, en secondes. */
  strokeMinPeriodS: number;
  /** Au-delà de cet écart, la série de coups est coupée, en secondes ; un trou de validation de la cadence aussi long au plus ne la coupe pas. */
  strokeMaxGapS: number;
  /** Série gardée : au moins ce nombre de coups. */
  minSeriesStrokes: number;
  /** Cadence : signal des coups moyenné par cases de cette durée, en secondes… */
  cadenceGridS: number;
  /** …période cherchée par autocorrélation sur une fenêtre centrée de cette durée, en secondes… */
  cadenceWindowS: number;
  /** …une fenêtre toutes les `cadenceStepS` secondes… */
  cadenceStepS: number;
  /** …qui valide le pumping si sa crête corrèle au moins de cette valeur (0 à 1)… */
  cadenceMinCorrelation: number;
  /** …la première crête qui atteint cette part de la plus haute, pas un multiple de la période… */
  cadencePeakFraction: number;
  /** …si la fenêtre est mesurée sur au moins cette part de sa longueur (trous de la capture, bords du vol)… */
  cadenceMinCoverage: number;
  /** …et si sa période tombe de `cadenceMinPerMin` à `cadenceMaxPerMin` coups par minute. */
  cadenceMinPerMin: number;
  cadenceMaxPerMin: number;
  /** Décollage : filtre passe-haut, retrait de la moyenne sur cette durée, en secondes… */
  liftoffHighPassS: number;
  /** …rugosité : valeur efficace sur cette durée, en secondes… */
  liftoffRoughWindowS: number;
  /** …calme sous cette rugosité, en g… */
  liftoffCalmG: number;
  /** …tenu au moins cette durée, en secondes… */
  liftoffCalmS: number;
  /** …cherché de cette durée avant le début du vol GPS… */
  liftoffSearchBeforeS: number;
  /** …à cette durée après, en secondes. */
  liftoffSearchAfterS: number;
  /**
   * Élagage du `.imu` à « Analyser » autour des glisses ; coupé tant que les seuils ne sont pas réglés sur des
   * sessions réelles : une session sans vol (départ raté) garderait à peine ses mesures.
   */
  pruneCapture: boolean;
  /** Élagage : mesures gardées de part et d'autre de chaque glisse, en secondes. */
  pruneMarginS: number;
  /**
   * Vols listés : au moins cette durée, en secondes (voile, où un vol est une
   * suite au-dessus du seuil d'activité) ; filtre d'affichage, 0 : tous. Le
   * surf a ses vols à lui (`SurfFlight`) et ne s'en sert pas.
   */
  minFlightS: number;
}

/** Un vol, en index de points de la trace et en heures (ms) : ceux du surf (`SurfFlight`) comme ceux de la voile. */
export interface FlightSpan extends TrackSpan {
  /** Numéro du vol, à partir de 1. */
  n: number;
}

/**
 * Vols d'une suite de plages actives (`activeRuns`) : celles d'au moins
 * `minS` secondes, numérotées à partir de 1 dans l'ordre. Durée et distance
 * comme celles des cumuls (`ActiveRun`).
 */
export const flightSpans = (track: TrackPoint[], cum: CumulativeTrack, runs: ActiveRun[], minS: number): FlightSpan[] => {
  const spans: FlightSpan[] = [];
  for (const r of runs) {
    const span = spanOfRun(track, cum, r);
    if (span.durationS < minS) continue;
    spans.push({ n: spans.length + 1, ...span });
  }
  return spans;
};

/**
 * Capture d'une session sur foil, Pumping coché (fiche, sinon activité) : rangée
 * entière plutôt qu'élaguée autour des sauts (décision du 28/10), le pumping
 * se mesurant sur tout le vol. Seulement si le calcul mesure le pumping et ne
 * l'élague pas à sa façon (`pruneCapture`, propre au surf).
 */
export const keepsWholeCaptureForPumping = (pump: PumpDetection | null, foil: boolean, pumping: boolean): boolean =>
  pump !== null && !pump.pruneCapture && foil && pumping;

/** Une série de coups. */
export interface PumpSeries {
  /** Début et fin, en secondes sur l'axe donné ; un demi-coup de part et d'autre du premier et du dernier coup. */
  startS: number;
  endS: number;
  strokes: number;
}

/**
 * Une série de coups d'un vol, validée par sa cadence : un tronçon de la trace
 * (index du point le plus proche de son début et de sa fin, pour la carte ;
 * distance par la distance cumulée interpolée à ces instants, règle 6).
 */
export interface MeasuredPumpSeries extends TrackSpan {
  /** Numéro du vol (`FlightSpan.n`). */
  flight: number;
  strokes: number;
  /** Cadence des coups comptés : (coups − 1) ÷ (dernier − premier), en coups par minute. */
  strokesPerMin: number;
  /** Distance par coup : distance de la série ÷ ses coups, en mètres. */
  perStrokeM: number;
  /** Vitesse lissée de la trace au début et à la fin de la série, en m/s. */
  speedBeforeMs: number;
  speedAfterMs: number;
}

/** Une série de la session : celle d'un vol, numérotée dans l'ordre de la session (à partir de 1). */
export interface PumpingSeries extends MeasuredPumpSeries {
  n: number;
}

/** Pumping d'un vol. */
export interface FlightPumping {
  /** Numéro du vol (`FlightSpan.n`). */
  n: number;
  /** Faux si la capture ne couvre qu'une partie du vol (fichier élagué autrement, seuil changé depuis). */
  covered: boolean;
  /** Décollage vu par les capteurs, en heure (ms), et vitesse GPS à cet instant ; `null` s'il n'est pas trouvé. */
  liftoffMs: number | null;
  takeoffSpeedMs: number | null;
  /** Séries validées par leur cadence, du décollage (sinon du début du vol) à la fin du vol, dans l'ordre. */
  series: MeasuredPumpSeries[];
  /** Sommes sur ces séries : coups, temps pompé, distance pompée. */
  strokes: number;
  pumpS: number;
  pumpDistanceM: number;
  /** Coups par minute de pumping ; `null` sans coup. */
  strokesPerMin: number | null;
  /** Distance par coup ; `null` sans coup. */
  perStrokeM: number | null;
  /** Temps de vol couvert par la capture, du décollage (sinon du début du vol) à la fin, en secondes. */
  measuredS: number;
  /** Part de ce temps pompée (séries), de 0 à 1. */
  pumpShare: number;
}

/** Nombre de points d'une demi-fenêtre de `seconds` sur la grille. */
const halfSteps = (seconds: number, dt: number) => Math.max(0, Math.round(seconds / dt / 2));

/**
 * Signal des coups sur la grille de `v` : l'accélération verticale lissée sur
 * `strokeSmoothingS`, privée de sa dérive (moyenne glissante sur
 * `strokeBaselineS`). Calculé une fois par vol, pour les coups et la cadence.
 */
export const pumpSignal = (v: ImuVertical, p: PumpDetection): Float64Array => {
  const smooth = centredMean(v.aUp, halfSteps(p.strokeSmoothingS, v.dt));
  const base = centredMean(smooth, halfSteps(p.strokeBaselineS, v.dt));
  const x = new Float64Array(v.n);
  for (let i = 0; i < v.n; i++) x[i] = smooth[i] - base[i];
  return x;
};

/**
 * Coups dans les points [from, to) de la grille : indices des montées au-dessus
 * de +`strokeMinG`, chacune après un passage sous −`strokeMinG`. `signal` :
 * celui de `pumpSignal`, s'il est déjà calculé.
 */
export const pumpStrokes = (v: ImuVertical, from: number, to: number, p: PumpDetection, signal: Float64Array = pumpSignal(v, p)): number[] => {
  const h = p.strokeMinG * v.gLocal;
  const minSteps = Math.round(p.strokeMinPeriodS / v.dt);
  const strokes: number[] = [];
  let armed = false;
  for (let i = Math.max(0, from); i < Math.min(v.n, to); i++) {
    const x = signal[i];
    if (x < -h) armed = true;
    else if (armed && x > h) {
      armed = false;
      const last = strokes[strokes.length - 1];
      if (last === undefined || i - last >= minSteps) strokes.push(i);
    }
  }
  return strokes;
};

/** Séries de coups, instants en secondes : les coups espacés de `strokeMaxGapS` au plus, gardées si assez longues. */
export const pumpSeries = (strokeTimesS: number[], p: PumpDetection): PumpSeries[] => {
  const groups: number[][] = [];
  for (const t of strokeTimesS) {
    const last = groups[groups.length - 1];
    if (last && t - last[last.length - 1] <= p.strokeMaxGapS) last.push(t);
    else groups.push([t]);
  }
  return groups
    .filter((g) => g.length >= Math.max(2, p.minSeriesStrokes))
    .map((g) => {
      const halfPeriod = (g[g.length - 1] - g[0]) / (g.length - 1) / 2;
      return { startS: g[0] - halfPeriod, endS: g[g.length - 1] + halfPeriod, strokes: g.length };
    });
};

/** Une fenêtre de la cadence. */
export interface PumpCadenceWindow {
  /** Centre de la fenêtre, en secondes sur l'axe de la grille de `v` (0 à son premier point). */
  centerS: number;
  /** Cadence de sa période d'autocorrélation, en coups par minute ; `null` sans période (trop peu mesurée, sans régularité). */
  perMin: number | null;
  /** Période trouvée et dans la plage de cadence du pumping. */
  valid: boolean;
}

/** Cadence d'un vol : ses fenêtres, et les plages qu'elles valident. */
export interface PumpCadence {
  windows: PumpCadenceWindow[];
  /**
   * Plages validées, [début, fin] en secondes sur l'axe de la grille de `v`, dans
   * l'ordre ; deux plages séparées de `strokeMaxGapS` au plus n'en font qu'une.
   */
  ranges: [number, number][];
}

/**
 * Cadence du signal des coups dans les points [from, to) de la grille de `v`.
 * Le signal est moyenné par cases de `cadenceGridS` ; une case qui touche un
 * trou de la capture (`v.gap`) est inconnue. Une fenêtre de `cadenceWindowS`
 * est centrée sur une case toutes les `cadenceStepS` : gardée si
 * `cadenceMinCoverage` de sa longueur est connue, sa moyenne retirée et ses
 * cases inconnues mises à 0 (elles ne créent pas de corrélation). Sa période
 * est la première crête forte de l'autocorrélation (`firstStrongPeak`),
 * cherchée dès 2 cases (pas dès la plus courte période permise : la crête
 * d'une vibration rapide, hors de la plage, ne laisse pas valider un de ses
 * multiples) jusqu'à la plus longue période permise ; une période hors de
 * [`cadenceMinPerMin`, `cadenceMaxPerMin`] ne valide rien. Chaque fenêtre
 * couvre les cases à mi-chemin de ses voisines ; les fenêtres validées font les
 * plages, dont les trous de `strokeMaxGapS` au plus sont comblés.
 */
export const pumpCadence = (v: ImuVertical, signal: Float64Array, from: number, to: number, p: PumpDetection): PumpCadence => {
  const lo = Math.max(0, from);
  const hi = Math.min(v.n, to);
  const block = Math.max(1, Math.round(p.cadenceGridS / v.dt));
  const gridS = block * v.dt;
  const m = Math.floor((hi - lo) / block);
  const windows: PumpCadenceWindow[] = [];
  const ranges: [number, number][] = [];
  if (m <= 0) return { windows, ranges };
  const x = new Float64Array(m);
  const known = new Uint8Array(m);
  for (let k = 0; k < m; k++) {
    let sum = 0;
    let gap = false;
    for (let j = lo + k * block; j < lo + (k + 1) * block; j++) {
      sum += signal[j];
      if (v.gap[j]) gap = true;
    }
    x[k] = sum / block;
    known[k] = gap ? 0 : 1;
  }
  const half = Math.round(p.cadenceWindowS / 2 / gridS);
  const every = Math.max(1, Math.round(p.cadenceStepS / gridS));
  const reach = Math.floor(every / 2);
  const fromLag = 2;
  const toLag = Math.ceil(60 / p.cadenceMinPerMin / gridS) + 1;
  const cellS = (k: number) => (lo + k * block) * v.dt;
  const endS = (hi - 1) * v.dt;
  const buf = new Float64Array(2 * half + 1);
  for (let c = 0; c < m; c += every) {
    const centerS = cellS(c) + ((block - 1) / 2) * v.dt;
    const a = Math.max(0, c - half);
    const b = Math.min(m, c + half + 1);
    let count = 0;
    let sum = 0;
    for (let k = a; k < b; k++) {
      if (!known[k]) continue;
      count++;
      sum += x[k];
    }
    let perMin: number | null = null;
    if (count >= p.cadenceMinCoverage * (2 * half + 1)) {
      const mean = sum / count;
      const len = b - a;
      for (let k = 0; k < len; k++) buf[k] = known[a + k] ? x[a + k] - mean : 0;
      const maxLag = Math.min(len - 2, toLag);
      if (maxLag > fromLag) {
        const r = autocorrelation(buf.subarray(0, len), maxLag);
        const peak = firstStrongPeak(r, fromLag, maxLag, p.cadenceMinCorrelation, p.cadencePeakFraction);
        if (peak !== null) perMin = 60 / (refinedPeak(r, peak) * gridS);
      }
    }
    const valid = perMin !== null && perMin >= p.cadenceMinPerMin && perMin <= p.cadenceMaxPerMin;
    windows.push({ centerS, perMin, valid });
    if (!valid) continue;
    // Cases couvertes : à mi-chemin des fenêtres voisines, jusqu'aux bouts pour la première et la dernière.
    const startS = c === 0 ? cellS(0) : cellS(c - reach);
    const stopS = c + every >= m ? endS : cellS(c + every - reach);
    const last = ranges[ranges.length - 1];
    if (last && startS - last[1] <= p.strokeMaxGapS) last[1] = stopS;
    else ranges.push([startS, stopS]);
  }
  return { windows, ranges };
};

/**
 * Séries validées des points [from, to) : coups de `pumpStrokes` rangés par
 * plage de `pumpCadence`, puis groupés en séries (`pumpSeries`) dans chacune ;
 * un coup hors des plages ne compte pas. Instants en secondes sur l'axe de la grille.
 */
export const validatedPumpSeries = (v: ImuVertical, signal: Float64Array, from: number, to: number, p: PumpDetection): PumpSeries[] => {
  const { ranges } = pumpCadence(v, signal, from, to, p);
  const times = pumpStrokes(v, from, to, p, signal).map((i) => i * v.dt);
  const out: PumpSeries[] = [];
  let k = 0;
  for (const [a, b] of ranges) {
    while (k < times.length && times[k] < a) k++;
    const inRange: number[] = [];
    while (k < times.length && times[k] <= b) inRange.push(times[k++]);
    out.push(...pumpSeries(inRange, p));
  }
  return out;
};

/**
 * Décollage cherché autour du point `around` de la grille : début de la
 * dernière reprise du calme, d'au moins `liftoffCalmS`, qui commence dans la
 * recherche. `null` si la recherche est calme de bout en bout, ou jamais.
 */
export const liftoffAt = (v: ImuVertical, around: number, p: PumpDetection): number | null => {
  const mean = centredMean(v.aUp, halfSteps(p.liftoffHighPassS, v.dt));
  const sq = new Float64Array(v.n);
  for (let i = 0; i < v.n; i++) sq[i] = (v.aUp[i] - mean[i]) ** 2;
  const rough = centredMean(sq, halfSteps(p.liftoffRoughWindowS, v.dt));
  const limit = (p.liftoffCalmG * v.gLocal) ** 2;
  // Longueur du calme qui part de chaque point.
  const calmRun = new Int32Array(v.n + 1);
  for (let i = v.n - 1; i >= 0; i--) calmRun[i] = rough[i] < limit ? calmRun[i + 1] + 1 : 0;
  const need = Math.max(1, Math.round(p.liftoffCalmS / v.dt));
  const lo = Math.max(1, around - Math.round(p.liftoffSearchBeforeS / v.dt));
  const hi = Math.min(v.n - 1, around + Math.round(p.liftoffSearchAfterS / v.dt));
  for (let i = hi; i >= lo; i--) {
    if (calmRun[i] >= need && calmRun[i - 1] === 0) return i;
  }
  return null;
};

/** Fenêtres mesurées d'un fichier : celles de l'élagage, sinon toute la capture. */
export const capturedWindows = (rec: ImuRecording): ImuWindow[] => {
  if (rec.header.windows) return rec.header.windows;
  const bounds = captureBounds(rec);
  return bounds ? [bounds] : [];
};

/** Capture d'un vol, prête au compte des coups. */
export interface FlightCapture {
  /** Verticale de la recherche du décollage à la fin du vol, sur la fenêtre mesurée qui recouvre le plus le vol. */
  v: ImuVertical;
  covered: boolean;
  /** Point de la grille du début du vol GPS (0 si la capture commence après). */
  start: number;
  /** Point du décollage, `null` s'il n'est pas trouvé. */
  liftoff: number | null;
  /** Premier point où le pumping se cherche : le décollage, sinon le début du vol, le plus tôt des deux. */
  from: number;
}

/**
 * Capture d'un vol (`measureFlightPumping`, et le diagnostic du banc) ; `null`
 * si la capture ne touche pas le vol. Elle ne lit que les mesures du vol, et
 * de la recherche du décollage avant lui.
 */
export const flightCapture = (
  rec: ImuRecording, p: PumpDetection, windows: ImuWindow[], f: Pick<FlightSpan, 'startMs' | 'endMs'>
): FlightCapture | null => {
  const wantFrom = fileUsOf(rec, f.startMs - p.liftoffSearchBeforeS * 1000);
  const flightFrom = fileUsOf(rec, f.startMs);
  const flightTo = fileUsOf(rec, f.endMs);
  // La fenêtre mesurée qui recouvre le plus le vol.
  let best: ImuWindow | null = null;
  let bestOverlap = 0;
  for (const w of windows) {
    const overlap = Math.min(w[1], flightTo) - Math.max(w[0], flightFrom);
    if (overlap > bestOverlap) {
      best = w;
      bestOverlap = overlap;
    }
  }
  if (!best) return null;
  const v = verticalAcceleration(rec, p, Math.max(best[0], wantFrom), Math.min(best[1], flightTo));
  if (!v) return null;
  const covered = best[0] <= flightFrom && best[1] >= flightTo;
  const start = Math.max(0, Math.round((flightFrom - v.startUs) / v.stepUs));
  // Décollage cherché seulement si la capture couvre le début du vol : sinon la
  // dernière reprise du calme trouvée serait au milieu du vol (capture élaguée autour d'un saut).
  const liftoff = best[0] <= flightFrom ? liftoffAt(v, start, p) : null;
  return { v, covered, start, liftoff, from: liftoff === null ? start : Math.min(start, liftoff) };
};

/**
 * Pumping de chaque vol, dans l'ordre des vols ; `null` pour un vol que la
 * capture ne touche pas. Le calcul d'un vol ne lit que ses mesures, et la
 * recherche du décollage avant lui.
 */
export const measureFlightPumping = (
  rec: ImuRecording, p: PumpDetection, track: TrackPoint[], cum: CumulativeTrack, flights: Pick<FlightSpan, 'n' | 'startMs' | 'endMs'>[]
): (FlightPumping | null)[] => {
  const windows = capturedWindows(rec);
  const distanceAt = (ms: number) => valueAtTime(track, (i) => cum.cumDist[i], ms, 'clamp');
  const speedAt = (ms: number) => valueAtTime(track, (i) => track[i].smoothedSpeedMs, ms, 'clamp');
  const lastPoint = track.length - 1;
  return flights.map((f) => {
    const capture = flightCapture(rec, p, windows, f);
    if (!capture) return null;
    const { v, covered, liftoff, from } = capture;
    const timeMsOf = (i: number) => wallMsOf(rec, v.startUs + i * v.stepUs);
    const liftoffMs = liftoff === null ? null : timeMsOf(liftoff);
    const takeoffSpeedMs = liftoffMs === null ? null : speedAt(liftoffMs);

    const signal = pumpSignal(v, p);
    const seriesMs = (s: number) => timeMsOf(0) + s * 1000;
    const series = validatedPumpSeries(v, signal, from, v.n, p).map((s): MeasuredPumpSeries => {
      const startMs = seriesMs(s.startS);
      const endMs = seriesMs(s.endS);
      const start = nearestIndexAtTime(track, startMs);
      // Au moins deux points quand la trace en a, pour la montrer sur la carte.
      const end = Math.max(nearestIndexAtTime(track, endMs), Math.min(start + 1, lastPoint));
      const distanceM = distanceAt(endMs) - distanceAt(startMs);
      const durationS = s.endS - s.startS;
      return {
        start, end, startMs, endMs, durationS, distanceM,
        flight: f.n, strokes: s.strokes,
        // Un demi-coup de part et d'autre : coups ÷ durée vaut (coups − 1) ÷ (dernier − premier).
        strokesPerMin: (s.strokes / durationS) * 60,
        perStrokeM: distanceM / s.strokes,
        speedBeforeMs: speedAt(startMs), speedAfterMs: speedAt(endMs),
      };
    });
    let strokes = 0;
    let pumpS = 0;
    let pumpDistanceM = 0;
    for (const s of series) {
      strokes += s.strokes;
      pumpS += s.durationS;
      pumpDistanceM += s.distanceM;
    }
    const measuredS = Math.max(0, v.n - 1 - from) * v.dt;
    return {
      n: f.n, covered, liftoffMs, takeoffSpeedMs, series, strokes, pumpS, pumpDistanceM,
      strokesPerMin: strokes > 0 && pumpS > 0 ? (strokes / pumpS) * 60 : null,
      perStrokeM: strokes > 0 ? pumpDistanceM / strokes : null,
      measuredS,
      pumpShare: measuredS > 0 ? Math.min(1, pumpS / measuredS) : 0,
    };
  });
};

/** Pumping de la session, sur les vols mesurés. */
export interface PumpingSummary {
  strokes: number;
  pumpS: number;
  pumpDistanceM: number;
  strokesPerMin: number | null;
  perStrokeM: number | null;
  /** Vols mesurés, sur tous les vols. */
  measured: number;
  /** Séries validées. */
  series: number;
  /** Temps de vol couvert par la capture (somme des `measuredS`), en secondes. */
  flightS: number;
  /** Part de ce temps pompée, de 0 à 1. */
  pumpShare: number;
}

export const summarizePumping = (list: (FlightPumping | null)[]): PumpingSummary => {
  const measured = list.filter((x): x is FlightPumping => x !== null);
  const strokes = measured.reduce((s, x) => s + x.strokes, 0);
  const pumpS = measured.reduce((s, x) => s + x.pumpS, 0);
  const pumpDistanceM = measured.reduce((s, x) => s + x.pumpDistanceM, 0);
  const flightS = measured.reduce((s, x) => s + x.measuredS, 0);
  return {
    strokes, pumpS, pumpDistanceM,
    strokesPerMin: strokes > 0 && pumpS > 0 ? (strokes / pumpS) * 60 : null,
    perStrokeM: strokes > 0 ? pumpDistanceM / strokes : null,
    measured: measured.length,
    series: measured.reduce((s, x) => s + x.series.length, 0),
    flightS,
    pumpShare: flightS > 0 ? Math.min(1, pumpS / flightS) : 0,
  };
};

/** Séries de la session, tous vols confondus, dans l'ordre de leur début, numérotées à partir de 1. */
export const sessionPumpSeries = (list: readonly (FlightPumping | null)[]): PumpingSeries[] =>
  list
    .flatMap((x) => x?.series ?? [])
    .sort((a, b) => a.startMs - b.startMs)
    .map((s, k) => ({ ...s, n: k + 1 }));

/** Les `count` plus longues séries (durée), de la plus longue à la plus courte ; à égalité, la première de la session. */
export const longestPumpSeries = <S extends PumpingSeries>(list: readonly S[], count: number): S[] =>
  [...list].sort((a, b) => b.durationS - a.durationS || a.n - b.n).slice(0, count);
