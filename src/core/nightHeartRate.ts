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
 *
 * Réglé sur les premières vraies nuits (lot 218) : les sursauts se rangent par
 * durée (mouvements, éveils brefs, réveils), et le creux, la part de nuit calme
 * et l'indice de régularité se lisent hors de leurs secondes. L'heure
 * d'endormissement n'est pas calculée : la FC seule ne la dit pas (une montée
 * pendant le sommeil la nuit du 12/11).
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
  /**
   * Durée d'un sursaut : de part et d'autre de sa montée, jusqu'au retour de la FC (moyenne centrée sur
   * `returnSmoothS`) à la ligne de base de son départ + `returnBpm`.
   */
  returnBpm: number;
  returnSmoothS: number;
  /** Retour cherché au plus tant de secondes après la dernière seconde au-dessus du seuil ; le début, au plus `baselineS` avant la montée. */
  returnMaxS: number;
  /** Aucun sursaut ne part dans les tant de secondes après le départ : le temps de se poser (la FC descend, lot 218). */
  startSkipS: number;
}

/** Classes des sursauts d'après leur durée : « mouvement » sous `shortS`, « éveil bref » jusqu'à `longS`, « réveil » au-delà. */
export interface NightHrWakeProtocol {
  shortS: number;
  longS: number;
}

/** Part de nuit calme et indice de régularité : tranches de `windowS` calées sur le départ, calmes sous `sdBpm` d'écart-type. */
export interface NightHrCalmProtocol {
  windowS: number;
  sdBpm: number;
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
  wake: NightHrWakeProtocol;
  calm: NightHrCalmProtocol;
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

/** Classe d'un sursaut d'après sa durée en secondes. */
export const surgeKind = (durationS: number, wake: NightHrWakeProtocol): NightHrSurgeKind =>
  durationS < wake.shortS ? 'mouvement' : durationS <= wake.longS ? 'bref' : 'reveil';

/** FC la plus basse de la nuit : la moyenne sur `lowWindowS` la plus basse hors des secondes de sursaut, au milieu de sa fenêtre. */
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

/** Classe d'un sursaut : moins d'une minute, une à trois minutes, plus de trois minutes (valeurs du protocole). */
export type NightHrSurgeKind = 'mouvement' | 'bref' | 'reveil';

/** Sursaut de FC, réveil ou mouvement probable : du début de la montée au retour près de la ligne de base. */
export interface NightHrSurge {
  startMs: number;
  endMs: number;
  durationS: number;
  kind: NightHrSurgeKind;
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
  /** Tous les sursauts, dans l'ordre ; `wakes` les compte par classe. */
  surges: NightHrSurge[];
  wakes: { movements: number; brief: number; long: number };
  /**
   * Part de nuit calme, de 0 à 1 : tranches de `calm.windowS` sans sursaut, assez mesurées, d'écart-type au plus
   * `calm.sdBpm`, sur toutes les tranches entières de la nuit ; `null` sans tranche entière.
   */
  calmShare: number | null;
  /** Indice de régularité de la nuit : médiane des écarts-types des tranches sans sursaut assez mesurées, en bpm ; `null` sans elles. */
  regularityBpm: number | null;
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

  // Sursauts d'abord : le creux, la part calme et la régularité se lisent hors de leurs secondes.
  const surges: NightHrSurge[] = [];
  const quiet = new Uint8Array(n).fill(1);
  for (const e of findSurges(sum, cov, params, meanOf)) {
    const durationS = e.endCell - e.startCell;
    surges.push({
      startMs: toMs(e.startCell), endMs: toMs(e.endCell), durationS, kind: surgeKind(durationS, params.wake),
      peakMs: toMs(e.peakCell + 0.5), peakBpm: e.peakBpm, baselineBpm: e.baselineBpm,
    });
    quiet.fill(0, e.startCell, e.endCell);
  }
  const wakes = { movements: 0, brief: 0, long: 0 };
  for (const s of surges) {
    if (s.kind === 'mouvement') wakes.movements++;
    else if (s.kind === 'bref') wakes.brief++;
    else wakes.long++;
  }

  // Sommes cumulées hors sursauts : secondes hors sursaut, battements × secondes couvertes, secondes couvertes, carrés.
  const qn = new Float64Array(n + 1);
  const qs = new Float64Array(n + 1);
  const qc = new Float64Array(n + 1);
  const qq = new Float64Array(n + 1);
  for (let c = 0; c < n; c++) {
    const keep = quiet[c] === 1 && cov[c] > 0;
    qn[c + 1] = qn[c] + quiet[c];
    qs[c + 1] = qs[c] + (keep ? sum[c] : 0);
    qc[c + 1] = qc[c] + (keep ? cov[c] : 0);
    qq[c + 1] = qq[c] + (keep ? (sum[c] * sum[c]) / cov[c] : 0);
  }
  /**
   * Moyenne et écart-type des cases [a, b[ hors sursauts, si la fenêtre entière est mesurée hors sursaut à `lowCoverage`
   * au moins : une fenêtre surtout prise par un réveil ne compte pas (sur les seules secondes restantes, le creux tombait
   * au milieu d'un réveil, nuit du 15/11).
   */
  const quietStats = (a: number, b: number): { mean: number; sd: number } | null => {
    const c = qc[b] - qc[a];
    if (!(c > 0) || c < params.lowCoverage * (b - a) - 1e-9) return null;
    const mean = (qs[b] - qs[a]) / c;
    return { mean, sd: Math.sqrt(Math.max(0, (qq[b] - qq[a]) / c - mean * mean)) };
  };

  // FC la plus basse : la fenêtre de `lowWindowS` la plus basse hors sursauts, la première en cas d'égalité.
  const w = Math.max(1, Math.round(params.lowWindowS));
  let low: NightHrLow | null = null;
  for (let a = 0; a + w <= n; a++) {
    const m = quietStats(a, a + w)?.mean ?? null;
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

  // Part calme et régularité : tranches entières de `calm.windowS` calées sur le départ, sans aucune seconde de sursaut
  // (une tranche qui en porte n'est pas calme) et mesurées à `lowCoverage` ; écart-type des secondes de chacune.
  const slice = Math.max(1, Math.round(params.calm.windowS));
  const sliceCount = Math.floor(n / slice);
  const spreads: number[] = [];
  let calm = 0;
  for (let k = 0; k < sliceCount; k++) {
    const a = k * slice;
    const b = a + slice;
    const stats = qn[b] - qn[a] === slice ? quietStats(a, b) : null;
    if (!stats) continue;
    spreads.push(stats.sd);
    if (stats.sd <= params.calm.sdBpm) calm++;
  }
  const calmShare = sliceCount > 0 ? calm / sliceCount : null;
  const regularityBpm = spreads.length > 0 ? median(spreads) : null;

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
    wakes,
    calmShare,
    regularityBpm,
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

/** Sursaut en cases d'une seconde : [startCell, endCell[, son pic et la ligne de base de son départ. */
interface SurgeCells {
  startCell: number;
  endCell: number;
  peakCell: number;
  peakBpm: number;
  baselineBpm: number;
}

/**
 * Sursauts : chaque seconde mesurée comparée à la médiane des `baselineS`
 * secondes mesurées qui la précèdent (pas moins de `lowCoverage` de la
 * fenêtre) ; une montée d'au moins `riseBpm`, tenue `holdS` secondes de
 * suite, est un sursaut, et il continue tant que la FC ne repasse pas sous le
 * seuil pendant `refractoryS`. Aucun ne part dans les `startSkipS` premières
 * secondes. Médiane par un histogramme des battements entiers, de `minBpm` à
 * `maxBpm`.
 *
 * Sa durée court ensuite du début de la montée au retour : de part et d'autre,
 * jusqu'à la première seconde où la FC moyenne sur `returnSmoothS` (centrée)
 * repasse sous la ligne de base de son départ + `returnBpm` ; au plus
 * `baselineS` avant, `returnMaxS` après. Une seconde sans mesure ne l'arrête
 * pas (contact perdu pendant un réveil). Deux sursauts dont les durées se
 * chevauchent n'en font qu'un.
 */
const findSurges = (
  sum: Float64Array,
  cov: Float64Array,
  params: NightHrParams,
  meanOf: (a: number, b: number) => number | null
): SurgeCells[] => {
  const n = sum.length;
  const { baselineS, riseBpm, holdS, refractoryS, returnBpm, returnSmoothS, returnMaxS, startSkipS } = params.surge;
  const width = Math.max(1, Math.round(baselineS));
  const hold = Math.max(1, Math.round(holdS));
  const skip = Math.max(0, Math.round(startSkipS));
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
  const raw: SurgeCells[] = [];
  let open: SurgeCells | null = null;
  let last: SurgeCells | null = null;
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
    const baseline = c >= skip && counted > 0 && counted >= params.lowCoverage * width - 1e-9 ? medianBpm() : NaN;
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
      if (value > open.peakBpm) {
        open.peakBpm = value;
        open.peakCell = c;
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
      if (peakBpm > open.peakBpm) {
        open.peakBpm = peakBpm;
        open.peakCell = peakCell;
      }
    } else {
      // `endCell` tient ici la dernière seconde au-dessus du seuil ; la durée est posée plus bas.
      open = { startCell: runStart, endCell: c, peakCell, peakBpm, baselineBpm: runBaseline };
      raw.push(open);
    }
    last = open;
  }

  // Durée : du début de la montée au retour près de la ligne de base.
  const half = Math.max(0, Math.floor(returnSmoothS / 2));
  const settled = (c: number, top: number): boolean => {
    const m = meanOf(Math.max(0, c - half), Math.min(n, c + half + 1));
    return m !== null && m <= top;
  };
  const backMax = Math.max(0, Math.round(baselineS));
  const forwardMax = Math.max(0, Math.round(returnMaxS));
  const surges: SurgeCells[] = [];
  for (const s of raw) {
    const top = s.baselineBpm + returnBpm;
    let a = s.startCell;
    while (a > 0 && s.startCell - a < backMax && !settled(a, top)) a--;
    let b = s.endCell;
    while (b < n - 1 && b - s.endCell < forwardMax && !settled(b, top)) b++;
    const prev = surges[surges.length - 1];
    if (prev && a <= prev.endCell) {
      prev.startCell = Math.min(prev.startCell, a);
      prev.endCell = Math.max(prev.endCell, b);
      if (s.peakBpm > prev.peakBpm) {
        prev.peakBpm = s.peakBpm;
        prev.peakCell = s.peakCell;
      }
    } else {
      surges.push({ ...s, startCell: a, endCell: b });
    }
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
