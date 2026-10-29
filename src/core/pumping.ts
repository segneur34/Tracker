import { valueAtTime } from './search';
import type { ImuRecording } from './imuFile';
import {
  captureBounds, centredMean, fileUsOf, verticalAcceleration, wallMsOf,
  type AttitudeParams, type ImuVertical, type ImuWindow,
} from './imuVertical';
import type { ActiveRun } from './sessionStats';
import type { CumulativeTrack, TrackPoint } from './types';

/**
 * Pumping sur foil, commun au surf (§10, point 104) et à la voile (lot 22),
 * mesuré par l'accéléromètre et le gyroscope du téléphone fixé sur la
 * poitrine, depuis le `.imu` de la session, vol par vol : les vols viennent
 * du module (`SurfFlight` en surf, `sailingFlights` en voile). Tout est en
 * SI : instants du fichier en µs, heures en ms, accélérations en m/s²,
 * distances en mètres. L'élagage propre au surf reste dans `surfing/pumping.ts`.
 *
 * - Verticale du monde (`core/imuVertical.ts`), quelle que soit l'orientation
 *   du téléphone, comme pour les sauts.
 * - Coups : chaque pompe fait osciller le buste de haut en bas. L'accélération
 *   verticale, lissée et privée de sa dérive lente, passe sous −`strokeMinG`
 *   puis au-dessus de +`strokeMinG` : un coup, à `strokeMinPeriodS` au moins du
 *   précédent. Les coups espacés de `strokeMaxGapS` au plus forment une série,
 *   gardée si elle en compte `minSeriesStrokes`. Le temps pompé est celui des
 *   séries ; la distance pompée, l'intégrale de la vitesse sur ces séries.
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
  /** Au-delà de cet écart, la série de coups est coupée, en secondes. */
  strokeMaxGapS: number;
  /** Série gardée : au moins ce nombre de coups. */
  minSeriesStrokes: number;
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
export interface FlightSpan {
  /** Numéro du vol, à partir de 1. */
  n: number;
  start: number;
  end: number;
  startMs: number;
  endMs: number;
  durationS: number;
  distanceM: number;
}

/**
 * Vols d'une suite de plages actives (`activeRuns`) : celles d'au moins
 * `minS` secondes, numérotées à partir de 1 dans l'ordre. Durée et distance
 * comme celles des cumuls (`ActiveRun`).
 */
export const flightSpans = (track: TrackPoint[], cum: CumulativeTrack, runs: ActiveRun[], minS: number): FlightSpan[] => {
  const spans: FlightSpan[] = [];
  for (const r of runs) {
    const durationS = (track[r.end].timeMs - track[r.start].timeMs) / 1000;
    if (durationS < minS) continue;
    spans.push({
      n: spans.length + 1, start: r.start, end: r.end, startMs: track[r.start].timeMs, endMs: track[r.end].timeMs,
      durationS, distanceM: cum.cumDist[r.end] - cum.cumDist[r.start],
    });
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

/** Pumping d'un vol. */
export interface FlightPumping {
  /** Numéro du vol (`FlightSpan.n`). */
  n: number;
  /** Faux si la capture ne couvre qu'une partie du vol (fichier élagué autrement, seuil changé depuis). */
  covered: boolean;
  /** Décollage vu par les capteurs, en heure (ms), et vitesse GPS à cet instant ; `null` s'il n'est pas trouvé. */
  liftoffMs: number | null;
  takeoffSpeedMs: number | null;
  /** Coups des séries gardées, du décollage (sinon du début du vol) à la fin du vol. */
  strokes: number;
  pumpS: number;
  pumpDistanceM: number;
  /** Coups par minute de pumping ; `null` sans coup. */
  strokesPerMin: number | null;
  /** Distance par coup ; `null` sans coup. */
  perStrokeM: number | null;
}

/** Nombre de points d'une demi-fenêtre de `seconds` sur la grille. */
const halfSteps = (seconds: number, dt: number) => Math.max(0, Math.round(seconds / dt / 2));

/**
 * Coups dans les points [from, to) de la grille : indices des montées au-dessus
 * de +`strokeMinG`, chacune après un passage sous −`strokeMinG`.
 */
export const pumpStrokes = (v: ImuVertical, from: number, to: number, p: PumpDetection): number[] => {
  const smooth = centredMean(v.aUp, halfSteps(p.strokeSmoothingS, v.dt));
  const base = centredMean(smooth, halfSteps(p.strokeBaselineS, v.dt));
  const h = p.strokeMinG * v.gLocal;
  const minSteps = Math.round(p.strokeMinPeriodS / v.dt);
  const strokes: number[] = [];
  let armed = false;
  for (let i = Math.max(0, from); i < Math.min(v.n, to); i++) {
    const x = smooth[i] - base[i];
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
  return flights.map((f) => {
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
    const indexOf = (us: number) => Math.round((us - v.startUs) / v.stepUs);
    const timeMsOf = (i: number) => wallMsOf(rec, v.startUs + i * v.stepUs);

    const start = Math.max(0, indexOf(flightFrom));
    // Décollage cherché seulement si la capture couvre le début du vol : sinon la
    // dernière reprise du calme trouvée serait au milieu du vol (capture élaguée autour d'un saut).
    const liftoff = best[0] <= flightFrom ? liftoffAt(v, start, p) : null;
    const liftoffMs = liftoff === null ? null : timeMsOf(liftoff);
    const takeoffSpeedMs = liftoffMs === null ? null : valueAtTime(track, (i) => track[i].smoothedSpeedMs, liftoffMs, 'clamp');

    const from = liftoff === null ? start : Math.min(start, liftoff);
    const series = pumpSeries(pumpStrokes(v, from, v.n, p).map((i) => i * v.dt), p);
    let strokes = 0;
    let pumpS = 0;
    let pumpDistanceM = 0;
    const seriesMs = (s: number) => timeMsOf(0) + s * 1000;
    for (const s of series) {
      strokes += s.strokes;
      pumpS += s.endS - s.startS;
      pumpDistanceM += distanceAt(seriesMs(s.endS)) - distanceAt(seriesMs(s.startS));
    }
    return {
      n: f.n, covered, liftoffMs, takeoffSpeedMs, strokes, pumpS, pumpDistanceM,
      strokesPerMin: strokes > 0 && pumpS > 0 ? (strokes / pumpS) * 60 : null,
      perStrokeM: strokes > 0 ? pumpDistanceM / strokes : null,
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
}

export const summarizePumping = (list: (FlightPumping | null)[]): PumpingSummary => {
  const measured = list.filter((x): x is FlightPumping => x !== null);
  const strokes = measured.reduce((s, x) => s + x.strokes, 0);
  const pumpS = measured.reduce((s, x) => s + x.pumpS, 0);
  const pumpDistanceM = measured.reduce((s, x) => s + x.pumpDistanceM, 0);
  return {
    strokes, pumpS, pumpDistanceM,
    strokesPerMin: strokes > 0 && pumpS > 0 ? (strokes / pumpS) * 60 : null,
    perStrokeM: strokes > 0 ? pumpDistanceM / strokes : null,
    measured: measured.length,
  };
};
