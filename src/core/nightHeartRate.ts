import type { HeartRateSessionPoint } from './heartRateSession';
import { pad2 } from './units';

/**
 * Chiffres d'une nuit de FC (test « FC de nuit », lot 213) : la ceinture portée
 * toute la nuit, sans position. Calcul pur sur les points du GPX, en heure et
 * FC, avec les réglages du protocole passés en paramètre (règle 3 ; le
 * protocole versionné est `NIGHT_HR_TEST`, `recording/nightHrTest.ts`, qui
 * reprend ces types : le noyau n'importe aucun domaine).
 *
 * Tout se mesure en temps (règle 2) : la nuit est d'abord ramenée à des cases
 * d'une seconde, où chaque mesure lisible compte au prorata du temps qu'elle
 * couvre ; une mesure vaut au plus `holdS` secondes, faute d'une plus récente,
 * si bien qu'un trou reste un trou, jamais une valeur figée. Une ceinture à
 * 1 Hz, à 5 Hz ou qui saute des secondes donne donc les mêmes chiffres. Les
 * fenêtres glissantes passent par des sommes cumulées (jamais
 * O(points × fenêtre)) ; la ligne de base des sursauts, une médiane glissante,
 * par un histogramme des battements entiers : 10 h à 1 Hz se calculent en
 * quelques dizaines de millisecondes.
 */

/** Place du creux dans la nuit, dite en clair : en début, au milieu ou en fin de nuit. */
export type NightHrPlace = 'debut' | 'milieu' | 'fin';

/** Sursaut de FC (réveil ou mouvement probable) : montée au-dessus d'une ligne de base glissante. */
export interface NightHrSurgeProtocol {
  /** Fenêtre de la ligne de base, médiane glissante des secondes qui précèdent, en secondes. */
  baselineS: number;
  /** Hausse minimale au-dessus de la ligne de base, en bpm. */
  riseBpm: number;
  /** Tenue minimale au-dessus du seuil, en secondes. */
  holdS: number;
  /** Retour sous le seuil exigé avant de compter un autre sursaut, en secondes ; plus court, le même sursaut continue. */
  refractoryS: number;
}

/** Heure de stabilisation : premier instant où la FC lissée reste près du creux assez longtemps. */
export interface NightHrStableProtocol {
  /** Écart maximal au-dessus du creux, en bpm. */
  aboveLowBpm: number;
  /** Durée pendant laquelle l'écart doit tenir, en secondes. */
  holdS: number;
}

/** Bornes de la place du creux, en fraction de la durée de la nuit (0 : départ, 1 : fin). */
export interface NightHrPlaceProtocol {
  /** Creux avant cette fraction : « en début de nuit ». */
  earlyBefore: number;
  /** Creux après cette fraction : « en fin de nuit » ; entre les deux, « au milieu ». */
  lateAfter: number;
}

/** Réglages du calcul d'une nuit, en secondes et en bpm (le protocole sans son nom ni sa version). */
export interface NightHrParams {
  /** Fenêtre de la FC la plus basse (moyenne glissante), en secondes. */
  lowWindowS: number;
  /** Part minimale d'une fenêtre (la plus basse, le lissage, la ligne de base) couverte par des mesures pour qu'elle compte. */
  lowCoverage: number;
  /** Lissage de la courbe de la nuit (moyenne glissante centrée), en secondes. */
  smoothS: number;
  surge: NightHrSurgeProtocol;
  /** Trou : plus de tant de secondes sans mesure lisible. */
  gapS: number;
  /** Une mesure vaut jusqu'à tant de secondes après elle, faute d'une plus récente. */
  holdS: number;
  stable: NightHrStableProtocol;
  /** Temps près du creux : FC lissée à moins de tant de bpm au-dessus du creux. */
  nearLowBpm: number;
  /** Nuit plus courte : chiffres montrés, avec la mention « nuit incomplète ». */
  shortNightS: number;
  /** Mesures hors de cet intervalle ignorées (parasite de la ceinture). */
  minBpm: number;
  maxBpm: number;
  place: NightHrPlaceProtocol;
  /** Pas de la courbe décimée pour l'affichage (une valeur par case), en secondes. */
  curveStepS: number;
}

/** Place du creux d'après sa fraction de la nuit (0 à 1). */
export const nightPlace = (fraction: number, place: NightHrPlaceProtocol): NightHrPlace =>
  fraction < place.earlyBefore ? 'debut' : fraction > place.lateAfter ? 'fin' : 'milieu';

/** FC la plus basse de la nuit : la moyenne sur `lowWindowS` la plus basse, au milieu de sa fenêtre. */
export interface NightHrLow {
  bpm: number;
  atMs: number;
  /** Place dans la nuit, de 0 (départ) à 1 (fin). */
  fraction: number;
  place: NightHrPlace;
}

/** Une heure d'horloge de la nuit (la première et la dernière, entamées, sont coupées au départ et à la fin). */
export interface NightHrHour {
  startMs: number;
  endMs: number;
  /** Moyenne des mesures de l'heure, `null` sans mesure. */
  avgBpm: number | null;
  /** FC lissée la plus basse de l'heure, `null` sans courbe. */
  lowBpm: number | null;
  coveredS: number;
}

/** Sursaut de FC, réveil ou mouvement probable. */
export interface NightHrSurge {
  startMs: number;
  endMs: number;
  peakMs: number;
  peakBpm: number;
  /** Ligne de base à son départ. */
  baselineBpm: number;
}

/** Qualité de l'enregistrement : ce que la ceinture et le téléphone ont gardé. */
export interface NightHrQuality {
  /** Trous de plus de `gapS` sans mesure lisible, du départ à la fin. */
  gapCount: number;
  /** Le plus long, sa durée et son début ; `null` sans trou. */
  longestGap: { s: number; atMs: number } | null;
  /** Intervalle médian et le plus grand entre deux mesures lisibles ; `null` sous deux mesures. */
  medianStepS: number | null;
  maxStepS: number | null;
  /** Reprises de l'enregistrement (pause, ou session interrompue puis récupérée), lues dans les segments du GPX. */
  resumes: number;
}

/** Point de la courbe décimée : une case de `curveStepS`, avec l'indice du point de trace le plus proche (survol). */
export interface NightHrCurvePoint {
  index: number;
  /** Minutes depuis le premier point de la session (axe des graphes de l'analyse). */
  minutes: number;
  bpm: number | null;
}

export interface NightHrResults {
  startMs: number;
  endMs: number;
  durationS: number;
  /** Temps couvert par des mesures lisibles, en secondes, et sa part de la nuit. */
  coveredS: number;
  coverage: number;
  /** Moyenne de la nuit, pondérée par le temps couvert. */
  avgBpm: number;
  low: NightHrLow | null;
  /** Écart de la FC la plus basse à la FC repos de Pratiquant, en bpm et en % ; `null` sans l'une ou l'autre. */
  restingGap: { bpm: number; pct: number } | null;
  hourly: NightHrHour[];
  surges: NightHrSurge[];
  /** Moyennes de la première et de la seconde moitié de la nuit, `null` sans mesure. */
  halves: { first: number | null; second: number | null };
  quality: NightHrQuality;
  /** Nuit plus courte que `shortNightS`. */
  incomplete: boolean;
  /** Premier instant où la FC lissée reste près du creux pendant `stable.holdS` ; `null` jamais. */
  stabilizedAtMs: number | null;
  /** Temps passé à moins de `nearLowBpm` au-dessus du creux, en secondes ; `null` sans creux. */
  nearLowS: number | null;
  curve: NightHrCurvePoint[];
}

/** Mesure lisible : une FC dans les bornes du protocole. */
const readable = (hr: number | undefined, params: NightHrParams): hr is number =>
  hr !== undefined && Number.isFinite(hr) && hr >= params.minBpm && hr <= params.maxBpm;

/** Médiane d'une liste (copiée, triée). */
const median = (values: number[]): number => {
  const sorted = Float64Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Début de l'heure d'horloge locale de `ms`. */
const localHourStart = (ms: number): number => {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  return d.getTime();
};

/**
 * Heure d'horloge locale suivante, changement d'heure compris : une heure de temps réel plus loin, ramenée au début
 * de son heure d'horloge. À l'automne, les deux « 2 h » font deux lignes (`setHours(h + 1)` sautait à 3 h, une ligne
 * de deux heures) ; au printemps, 1 h mène à 3 h.
 */
const nextLocalHour = (ms: number): number => {
  const next = localHourStart(ms + 3_600_000);
  return next > ms ? next : ms + 3_600_000;
};

/**
 * Chiffres d'une nuit ; `null` sous deux points ou sans aucune mesure lisible.
 * `points` : ceux de l'analyse (`heartRatePointsFrom`), dont la courbe garde les
 * indices pour le survol ; `restingBpm` : FC repos de Pratiquant, si connue.
 */
export const nightHrResults = (
  points: readonly HeartRateSessionPoint[],
  params: NightHrParams,
  opts: { restingBpm?: number | null } = {}
): NightHrResults | null => {
  if (points.length < 2) return null;
  const t0 = points[0].timeMs;
  const endMs = points[points.length - 1].timeMs;
  const durationS = (endMs - t0) / 1000;
  if (!(durationS > 0)) return null;

  // Mesures lisibles, dans l'ordre (les points sont déjà triés par `heartRatePointsFrom`).
  const measured: number[] = [];
  for (let i = 0; i < points.length; i++) if (readable(points[i].hr, params)) measured.push(i);
  if (measured.length === 0) return null;

  // Cases d'une seconde : somme des battements × secondes couvertes, et secondes couvertes.
  const n = Math.max(1, Math.ceil(durationS));
  const sum = new Float64Array(n);
  const cov = new Float64Array(n);
  const add = (fromS: number, toS: number, bpm: number) => {
    for (let c = Math.max(0, Math.floor(fromS)); c < n && c < toS; c++) {
      const overlap = Math.min(toS, c + 1) - Math.max(fromS, c);
      if (overlap <= 0) continue;
      sum[c] += bpm * overlap;
      cov[c] += overlap;
    }
  };
  const steps: number[] = [];
  let gapCount = 0;
  let longestGap: NightHrQuality['longestGap'] = null;
  const noteGap = (s: number, atMs: number) => {
    if (s <= params.gapS) return;
    gapCount++;
    if (!longestGap || s > longestGap.s) longestGap = { s, atMs };
  };
  noteGap((points[measured[0]].timeMs - t0) / 1000, t0);
  for (let j = 0; j < measured.length; j++) {
    const p = points[measured[j]];
    const nextMs = j + 1 < measured.length ? points[measured[j + 1]].timeMs : endMs;
    const toMs = Math.min(nextMs, p.timeMs + params.holdS * 1000, endMs);
    if (toMs > p.timeMs) add((p.timeMs - t0) / 1000, (toMs - t0) / 1000, p.hr!);
    if (j + 1 < measured.length) {
      const stepS = (nextMs - p.timeMs) / 1000;
      steps.push(stepS);
      noteGap(stepS, p.timeMs);
    } else {
      noteGap((endMs - p.timeMs) / 1000, p.timeMs);
    }
  }
  let resumes = 0;
  for (const p of points) if (p.segmentStart) resumes++;

  // Sommes cumulées : toute moyenne sur des cases [a, b[ en O(1).
  const ps = new Float64Array(n + 1);
  const pc = new Float64Array(n + 1);
  for (let c = 0; c < n; c++) {
    ps[c + 1] = ps[c] + sum[c];
    pc[c + 1] = pc[c] + cov[c];
  }
  const coveredS = pc[n];
  if (!(coveredS > 0)) return null;
  const meanOf = (a: number, b: number): number | null => {
    const c = pc[b] - pc[a];
    return c > 0 ? (ps[b] - ps[a]) / c : null;
  };
  /** Moyenne des cases [a, b[ si elles sont couvertes à `lowCoverage` au moins. */
  const coveredMean = (a: number, b: number): number | null => {
    const c = pc[b] - pc[a];
    return c > 0 && c >= params.lowCoverage * (b - a) - 1e-9 ? (ps[b] - ps[a]) / c : null;
  };
  const toMs = (cell: number) => t0 + cell * 1000;

  // FC la plus basse : la fenêtre de `lowWindowS` couverte la plus basse, la première en cas d'égalité.
  const w = Math.max(1, Math.round(params.lowWindowS));
  let low: NightHrLow | null = null;
  for (let a = 0; a + w <= n; a++) {
    const m = coveredMean(a, a + w);
    if (m === null || (low && m >= low.bpm)) continue;
    const fraction = Math.min(1, Math.max(0, (a + w / 2) / durationS));
    low = { bpm: m, atMs: toMs(a + w / 2), fraction, place: nightPlace(fraction, params.place) };
  }

  // Courbe lissée, fenêtre centrée de `smoothS`, coupée aux bords ; NaN là où elle est trop peu couverte.
  const half = Math.floor(params.smoothS / 2);
  const span = Math.max(1, Math.round(params.smoothS));
  const smooth = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    const a = Math.max(0, c - half);
    const b = Math.min(n, c - half + span);
    smooth[c] = coveredMean(a, b) ?? NaN;
  }

  // Stabilisation et temps près du creux, sur la courbe lissée.
  let stabilizedAtMs: number | null = null;
  let nearLowS: number | null = null;
  if (low) {
    const stableTop = low.bpm + params.stable.aboveLowBpm;
    const nearTop = low.bpm + params.nearLowBpm;
    const hold = Math.max(1, Math.round(params.stable.holdS));
    let runStart = -1;
    let near = 0;
    for (let c = 0; c < n; c++) {
      const v = smooth[c];
      if (!Number.isNaN(v) && v <= nearTop) near++;
      if (stabilizedAtMs !== null) continue;
      if (!Number.isNaN(v) && v <= stableTop) {
        if (runStart < 0) runStart = c;
        if (c - runStart + 1 >= hold) stabilizedAtMs = toMs(runStart);
      } else {
        runStart = -1;
      }
    }
    nearLowS = near;
  }

  // Première moitié contre seconde moitié.
  const mid = Math.round(n / 2);
  const halves = { first: meanOf(0, mid), second: meanOf(mid, n) };

  // Heures d'horloge : moyenne des mesures, et la plus basse de la courbe lissée.
  const hourly: NightHrHour[] = [];
  for (let h = localHourStart(t0); h < endMs; h = nextLocalHour(h)) {
    const fromMs = Math.max(h, t0);
    const untilMs = Math.min(nextLocalHour(h), endMs);
    const a = Math.min(n, Math.max(0, Math.round((fromMs - t0) / 1000)));
    const b = Math.min(n, Math.max(a, Math.round((untilMs - t0) / 1000)));
    if (b <= a) continue;
    let lowBpm: number | null = null;
    for (let c = a; c < b; c++) if (!Number.isNaN(smooth[c]) && (lowBpm === null || smooth[c] < lowBpm)) lowBpm = smooth[c];
    hourly.push({ startMs: fromMs, endMs: untilMs, avgBpm: meanOf(a, b), lowBpm, coveredS: pc[b] - pc[a] });
  }

  const surges = findSurges(sum, cov, params, toMs);

  // Courbe décimée : une valeur par case de `curveStepS`, au milieu de la case, avec le point le plus proche.
  const step = Math.max(1, Math.round(params.curveStepS));
  const curve: NightHrCurvePoint[] = [];
  let p = 0;
  for (let start = 0; start < n; start += step) {
    const c = Math.min(n - 1, start + Math.floor(step / 2));
    const atMs = t0 + (c + 0.5) * 1000;
    while (p + 1 < points.length && points[p + 1].timeMs <= atMs) p++;
    const index = p + 1 < points.length && points[p + 1].timeMs - atMs < atMs - points[p].timeMs ? p + 1 : p;
    const v = smooth[c];
    curve.push({ index, minutes: (c + 0.5) / 60, bpm: Number.isNaN(v) ? null : Math.round(v * 10) / 10 });
  }

  const resting = opts.restingBpm;
  const restingGap = low && resting != null && resting > 0
    ? { bpm: low.bpm - resting, pct: ((low.bpm - resting) / resting) * 100 }
    : null;

  return {
    startMs: t0,
    endMs,
    durationS,
    coveredS,
    coverage: Math.min(1, coveredS / durationS),
    avgBpm: ps[n] / coveredS,
    low,
    restingGap,
    hourly,
    surges,
    halves,
    quality: {
      gapCount,
      longestGap,
      medianStepS: steps.length > 0 ? median(steps) : null,
      maxStepS: steps.length > 0 ? steps.reduce((m, s) => (s > m ? s : m), 0) : null,
      resumes,
    },
    incomplete: durationS < params.shortNightS,
    stabilizedAtMs,
    nearLowS,
    curve,
  };
};

/**
 * Sursauts : chaque seconde mesurée comparée à la médiane des `baselineS`
 * secondes mesurées qui la précèdent (pas moins de `lowCoverage` de la
 * fenêtre) ; une montée d'au moins `riseBpm`, tenue `holdS` secondes de
 * suite, est un sursaut, et il continue tant que la FC ne repasse pas sous le
 * seuil pendant `refractoryS`. Médiane par un histogramme des battements
 * entiers, de `minBpm` à `maxBpm`.
 */
const findSurges = (
  sum: Float64Array,
  cov: Float64Array,
  params: NightHrParams,
  toMs: (cell: number) => number
): NightHrSurge[] => {
  const n = sum.length;
  const { baselineS, riseBpm, holdS, refractoryS } = params.surge;
  const width = Math.max(1, Math.round(baselineS));
  const hold = Math.max(1, Math.round(holdS));
  const bins = new Int32Array(params.maxBpm - params.minBpm + 1);
  const binOf = (c: number): number => (cov[c] > 0 ? Math.round(sum[c] / cov[c]) - params.minBpm : -1);
  let counted = 0;
  const medianBpm = (): number => {
    // Médiane basse : la première case où l'effectif cumulé atteint la moitié.
    const target = Math.ceil(counted / 2);
    let acc = 0;
    for (let b = 0; b < bins.length; b++) {
      acc += bins[b];
      if (acc >= target) return b + params.minBpm;
    }
    return params.maxBpm;
  };
  const surges: NightHrSurge[] = [];
  let open: { surge: NightHrSurge; endCell: number } | null = null;
  let last: { surge: NightHrSurge; endCell: number } | null = null;
  let runStart = -1;
  let runBaseline = 0;
  for (let c = 0; c < n; c++) {
    // Fenêtre de la ligne de base : [c - width, c[.
    if (c - width - 1 >= 0) {
      const out = binOf(c - width - 1);
      if (out >= 0 && out < bins.length) { bins[out]--; counted--; }
    }
    if (c - 1 >= 0) {
      const inBin = binOf(c - 1);
      if (inBin >= 0 && inBin < bins.length) { bins[inBin]++; counted++; }
    }
    const value = cov[c] > 0 ? sum[c] / cov[c] : NaN;
    const baseline = counted > 0 && counted >= params.lowCoverage * width - 1e-9 ? medianBpm() : NaN;
    const above = !Number.isNaN(value) && !Number.isNaN(baseline) && value - baseline >= riseBpm;
    if (!above) {
      runStart = -1;
      open = null;
      continue;
    }
    if (runStart < 0) {
      runStart = c;
      runBaseline = baseline;
    }
    if (open) {
      open.endCell = c;
      open.surge.endMs = toMs(c + 1);
      if (value > open.surge.peakBpm) {
        open.surge.peakBpm = value;
        open.surge.peakMs = toMs(c + 0.5);
      }
      continue;
    }
    if (c - runStart + 1 < hold) continue;
    // Tenue atteinte : la suite du sursaut précédent s'il n'est pas redescendu assez longtemps, sinon un nouveau.
    let peakBpm = -Infinity;
    let peakCell = runStart;
    for (let k = runStart; k <= c; k++) {
      const v = sum[k] / cov[k];
      if (v > peakBpm) { peakBpm = v; peakCell = k; }
    }
    if (last && runStart - last.endCell - 1 < refractoryS) {
      open = last;
      open.endCell = c;
      open.surge.endMs = toMs(c + 1);
      if (peakBpm > open.surge.peakBpm) {
        open.surge.peakBpm = peakBpm;
        open.surge.peakMs = toMs(peakCell + 0.5);
      }
    } else {
      open = {
        surge: { startMs: toMs(runStart), endMs: toMs(c + 1), peakMs: toMs(peakCell + 0.5), peakBpm, baselineBpm: runBaseline },
        endCell: c,
      };
      surges.push(open.surge);
    }
    last = open;
  }
  return surges;
};

/**
 * Nom par défaut d'une nuit, à l'heure locale : « Nuit du 12 au 13/11 », « Nuit
 * du 31/10 au 1/11 » d'un mois à l'autre, « Nuit du 12/11 » si départ et fin
 * tombent le même jour.
 */
export const nightSessionName = (startMs: number, endMs: number): string => {
  const a = new Date(startMs);
  const b = new Date(endMs);
  const dayMonth = (d: Date) => `${d.getDate()}/${pad2(d.getMonth() + 1)}`;
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return a.getDate() === b.getDate() ? `Nuit du ${dayMonth(a)}` : `Nuit du ${a.getDate()} au ${dayMonth(b)}`;
  }
  return `Nuit du ${dayMonth(a)} au ${dayMonth(b)}`;
};
