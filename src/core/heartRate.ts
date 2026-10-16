import { meanFilterByTime } from './speedFilter';

/**
 * Fréquence cardiaque d'une session : série lissée, zones d'effort, temps
 * passé dans chaque zone, charge, dérive. Tout se mesure en temps (règle 2) :
 * un intervalle entre deux points à FC compte pour sa durée, et un intervalle
 * plus long que `gapS` est un trou (ceinture retirée, pause), ni compté ni
 * tracé. Les paramètres viennent de `HeartRateProfile` (`sportProfiles.ts`).
 */

/** Point lu : `TrackPoint` en est un. */
export interface HeartRatePoint {
  timeMs: number;
  hr?: number;
}

/** FC plausible d'une mesure ; au-delà, un défaut de la ceinture ou du fichier. */
const MIN_PLAUSIBLE_BPM = 25;
const MAX_PLAUSIBLE_BPM = 250;

const validBpm = (hr: number | undefined): hr is number =>
  hr !== undefined && isFinite(hr) && hr >= MIN_PLAUSIBLE_BPM && hr <= MAX_PLAUSIBLE_BPM;

/**
 * FC lissée sur `windowS` secondes, centrée, point par point ; `null` là où le
 * point n'a pas de FC. Le lissage ne franchit pas un trou de plus de `gapS`.
 */
export const smoothHeartRate = (points: readonly HeartRatePoint[], windowS: number, gapS: number): (number | null)[] => {
  const out: (number | null)[] = points.map(() => null);
  let run: number[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const smoothed = meanFilterByTime(run.map((i) => points[i].hr!), run.map((i) => points[i].timeMs), windowS);
    run.forEach((i, k) => (out[i] = smoothed[k]));
    run = [];
  };
  for (let i = 0; i < points.length; i++) {
    if (!validBpm(points[i].hr)) {
      flush();
      continue;
    }
    const prev = run[run.length - 1];
    if (prev !== undefined && points[i].timeMs - points[prev].timeMs > gapS * 1000) flush();
    run.push(i);
  }
  flush();
  return out;
};

/**
 * Chaque intervalle compté : de `i - 1` à `i`, tous deux à FC, sans trou ; la
 * durée va à la FC lissée de `i`, arrondie au battement.
 */
const forEachCounted = (
  points: readonly HeartRatePoint[],
  smoothed: readonly (number | null)[],
  gapS: number,
  visit: (i: number, bpm: number, dtS: number) => void
) => {
  for (let i = 1; i < points.length; i++) {
    const bpm = smoothed[i];
    if (bpm === null || smoothed[i - 1] === null) continue;
    const dtS = (points[i].timeMs - points[i - 1].timeMs) / 1000;
    if (dtS <= 0 || dtS > gapS) continue;
    visit(i, Math.round(bpm), dtS);
  }
};

export interface HeartRateStats {
  /** Moyenne pondérée par le temps, en bpm. */
  avgBpm: number;
  /** Maximum de la série lissée : les pics d'une ceinture encore sèche n'y passent pas. */
  maxBpm: number;
  /** Temps couvert par la FC, en secondes. */
  coveredS: number;
}

/** FC moyenne, max et temps couvert ; `null` sans aucun intervalle compté. */
export const heartRateStats = (points: readonly HeartRatePoint[], smoothed: readonly (number | null)[], gapS: number): HeartRateStats | null => {
  let sum = 0;
  let coveredS = 0;
  forEachCounted(points, smoothed, gapS, (_, bpm, dtS) => {
    sum += bpm * dtS;
    coveredS += dtS;
  });
  if (coveredS === 0) return null;
  let maxBpm = 0;
  for (const v of smoothed) if (v !== null && v > maxBpm) maxBpm = v;
  return { avgBpm: sum / coveredS, maxBpm: Math.round(maxBpm), coveredS };
};

/** Données du pratiquant qui fixent les zones (`RunnerProfile`). */
export interface HeartRateAthlete {
  hrMax: number | null;
  hrRest: number | null;
  /** Bornes basses des zones 1 à 5 saisies à la main, en bpm. */
  hrZones: readonly number[] | null;
}

export type ZoneMethod = 'perso' | 'reserve' | 'max';

export interface HeartRateZones {
  /** Bornes basses des zones 1 à 5, en bpm, croissantes. */
  bounds: number[];
  method: ZoneMethod;
  /** FC max retenue ; `null` quand seules des zones personnalisées sont connues. */
  hrMax: number | null;
  /** FC max estimée par l'âge, faute d'être saisie. */
  estimated: boolean;
}

/** Nombre de zones. */
export const ZONE_COUNT = 5;

/** FC max estimée par l'âge (Tanaka, 2001). */
export const estimateHrMax = (age: number): number => Math.round(208 - 0.7 * age);

/** Bornes personnalisées valides : 5 valeurs croissantes. */
export const isValidZoneBounds = (bounds: readonly number[] | null | undefined): bounds is readonly number[] =>
  Array.isArray(bounds) && bounds.length === ZONE_COUNT &&
  bounds.every((b, k) => isFinite(b) && b >= MIN_PLAUSIBLE_BPM && b <= MAX_PLAUSIBLE_BPM && (k === 0 || b > bounds[k - 1]));

/**
 * Zones du pratiquant : personnalisées d'abord ; sinon `fractions` de la
 * réserve cardiaque (Karvonen) si la FC de repos est connue, de la FC max
 * sinon ; FC max estimée par l'âge si elle manque. `null` sans FC max ni âge.
 */
export const heartRateZones = (athlete: HeartRateAthlete, age: number | null, fractions: readonly number[]): HeartRateZones | null => {
  const given = athlete.hrMax;
  const hrMax = given ?? (age !== null && age > 0 ? estimateHrMax(age) : null);
  if (isValidZoneBounds(athlete.hrZones)) return { bounds: [...athlete.hrZones], method: 'perso', hrMax, estimated: given === null && hrMax !== null };
  if (hrMax === null) return null;
  const rest = athlete.hrRest;
  const reserve = rest !== null && rest < hrMax;
  const bounds = fractions.map((f) => Math.round(reserve ? rest + f * (hrMax - rest) : f * hrMax));
  return { bounds, method: reserve ? 'reserve' : 'max', hrMax, estimated: given === null };
};

/** Zone d'une FC : 0 sous la zone 1, puis 1 à 5. */
export const zoneOf = (bpm: number, bounds: readonly number[]): number => {
  let zone = 0;
  for (const b of bounds) if (bpm >= b) zone++;
  return zone;
};

/** Secondes passées dans chaque zone, de « sous Z1 » (0) à Z5. */
export const timeInZones = (
  points: readonly HeartRatePoint[],
  smoothed: readonly (number | null)[],
  bounds: readonly number[],
  gapS: number
): number[] => {
  const times = new Array<number>(bounds.length + 1).fill(0);
  forEachCounted(points, smoothed, gapS, (_, bpm, dtS) => (times[zoneOf(bpm, bounds)] += dtS));
  return times;
};

/** Charge d'Edwards : minutes en zone 1 × 1 + … + minutes en zone 5 × 5 ; « sous Z1 » ne compte pas. */
export const edwardsLoad = (zoneTimesS: readonly number[]): number =>
  zoneTimesS.reduce((sum, s, zone) => sum + (s / 60) * zone, 0);

/** Secondes par battement, de `fromBpm` à `fromBpm + seconds.length - 1` ; rangé dans le résumé. */
export interface HeartRateHistogram {
  fromBpm: number;
  seconds: number[];
}

/** Histogramme au battement près, réduit aux battements rencontrés ; `null` sans FC. */
export const heartRateHistogram = (
  points: readonly HeartRatePoint[],
  smoothed: readonly (number | null)[],
  gapS: number
): HeartRateHistogram | null => {
  const byBpm = new Map<number, number>();
  forEachCounted(points, smoothed, gapS, (_, bpm, dtS) => byBpm.set(bpm, (byBpm.get(bpm) ?? 0) + dtS));
  if (byBpm.size === 0) return null;
  const keys = [...byBpm.keys()];
  const fromBpm = Math.min(...keys);
  const seconds = new Array<number>(Math.max(...keys) - fromBpm + 1).fill(0);
  for (const [bpm, s] of byBpm) seconds[bpm - fromBpm] = Math.round(s);
  return { fromBpm, seconds };
};

/** Temps par zone tiré d'un histogramme, avec les zones du moment (statistiques). */
export const histogramZoneTimes = (histogram: HeartRateHistogram, bounds: readonly number[]): number[] => {
  const times = new Array<number>(bounds.length + 1).fill(0);
  histogram.seconds.forEach((s, k) => (times[zoneOf(histogram.fromBpm + k, bounds)] += s));
  return times;
};

export interface HeartRateDrift {
  /** Vitesse moyenne par battement de chaque moitié, en m/s par bpm. */
  firstRatio: number;
  secondRatio: number;
  /** Perte d'efficacité de la seconde moitié, en % : positive quand le cœur monte à vitesse égale. */
  driftPct: number;
}

/**
 * Dérive cardiaque : rapport vitesse / FC de la première moitié du temps actif
 * à FC, comparé à celui de la seconde. `null` sous `minS` secondes.
 */
export const heartRateDrift = (
  points: readonly HeartRatePoint[],
  smoothed: readonly (number | null)[],
  speedsMs: readonly number[],
  active: readonly boolean[],
  gapS: number,
  minS: number
): HeartRateDrift | null => {
  const counted: { bpm: number; speed: number; dtS: number }[] = [];
  forEachCounted(points, smoothed, gapS, (i, bpm, dtS) => {
    if (active[i] && isFinite(speedsMs[i])) counted.push({ bpm, speed: speedsMs[i], dtS });
  });
  const totalS = counted.reduce((s, c) => s + c.dtS, 0);
  if (totalS < minS) return null;
  const halves = [{ speed: 0, bpm: 0 }, { speed: 0, bpm: 0 }];
  let elapsedS = 0;
  for (const c of counted) {
    const half = halves[elapsedS + c.dtS / 2 < totalS / 2 ? 0 : 1];
    half.speed += c.speed * c.dtS;
    half.bpm += c.bpm * c.dtS;
    elapsedS += c.dtS;
  }
  if (halves.some((h) => h.bpm <= 0 || h.speed <= 0)) return null;
  const [firstRatio, secondRatio] = halves.map((h) => h.speed / h.bpm);
  return { firstRatio, secondRatio, driftPct: ((firstRatio - secondRatio) / firstRatio) * 100 };
};

export interface EfficiencyBlock {
  /** Premier point du bloc. */
  index: number;
  speedMs: number;
  bpm: number;
  /** Moitié du temps actif à FC où tombe le bloc : 0 ou 1. */
  half: 0 | 1;
}

/**
 * Nuage FC / vitesse : moyennes par blocs de `blockS` secondes de temps actif
 * à FC, un bloc interrompu par une pause ou un trou étant abandonné.
 */
export const efficiencyBlocks = (
  points: readonly HeartRatePoint[],
  smoothed: readonly (number | null)[],
  speedsMs: readonly number[],
  active: readonly boolean[],
  gapS: number,
  blockS: number
): EfficiencyBlock[] => {
  const raw: { index: number; speedMs: number; bpm: number; atS: number }[] = [];
  let block: { index: number; speed: number; bpm: number; s: number } | null = null;
  let last = -1;
  let elapsedS = 0;
  forEachCounted(points, smoothed, gapS, (i, bpm, dtS) => {
    if (!active[i] || !isFinite(speedsMs[i])) return;
    if (block !== null && last !== i - 1) block = null;
    block ??= { index: i - 1, speed: 0, bpm: 0, s: 0 };
    block.speed += speedsMs[i] * dtS;
    block.bpm += bpm * dtS;
    block.s += dtS;
    elapsedS += dtS;
    last = i;
    if (block.s >= blockS) {
      raw.push({ index: block.index, speedMs: block.speed / block.s, bpm: block.bpm / block.s, atS: elapsedS - block.s / 2 });
      block = null;
    }
  });
  return raw.map(({ atS, ...b }) => ({ ...b, half: atS < elapsedS / 2 ? 0 : 1 }));
};

export interface SpanHeartRate {
  avgBpm: number;
  maxBpm: number;
  /** Baisse de la FC `recoveryS` après la fin, en bpm ; `null` sans FC à ce moment. */
  recoveryBpm: number | null;
}

/** FC d'un passage (une répétition), de `start` à `end` inclus ; `null` sans FC. */
export const spanHeartRate = (
  points: readonly HeartRatePoint[],
  smoothed: readonly (number | null)[],
  start: number,
  end: number,
  gapS: number,
  recoveryS: number
): SpanHeartRate | null => {
  let sum = 0;
  let coveredS = 0;
  let maxBpm = 0;
  for (let i = Math.max(start + 1, 1); i <= end && i < points.length; i++) {
    const bpm = smoothed[i];
    if (bpm === null || smoothed[i - 1] === null) continue;
    const dtS = (points[i].timeMs - points[i - 1].timeMs) / 1000;
    if (dtS <= 0 || dtS > gapS) continue;
    sum += bpm * dtS;
    coveredS += dtS;
    maxBpm = Math.max(maxBpm, bpm);
  }
  if (coveredS === 0) return null;
  const endBpm = smoothed[end];
  let recoveryBpm: number | null = null;
  if (endBpm !== null && endBpm !== undefined) {
    const targetMs = points[end].timeMs + recoveryS * 1000;
    let j = end;
    while (j + 1 < points.length && points[j + 1].timeMs <= targetMs) j++;
    const near = j + 1 < points.length && points[j + 1].timeMs - targetMs < targetMs - points[j].timeMs ? j + 1 : j;
    const later = smoothed[near];
    if (j > end && later !== null && Math.abs(points[near].timeMs - targetMs) <= gapS * 1000) recoveryBpm = Math.round(endBpm - later);
  }
  return { avgBpm: Math.round(sum / coveredS), maxBpm: Math.round(maxBpm), recoveryBpm };
};

/**
 * Passages d'une zone, à montrer sur la carte : les suites d'intervalles
 * comptés dont la FC tombe dans la zone, coupées à chaque changement de zone
 * et à chaque trou. Chaque passage est une suite de positions `[lat, lon]`.
 */
export const heartRateZonePaths = (
  points: readonly (HeartRatePoint & { lat: number; lon: number })[],
  smoothed: readonly (number | null)[],
  bounds: readonly number[],
  zone: number,
  gapS: number
): [number, number][][] => {
  const paths: [number, number][][] = [];
  let current: [number, number][] | null = null;
  let last = -1;
  forEachCounted(points, smoothed, gapS, (i, bpm) => {
    if (zoneOf(bpm, bounds) !== zone) return;
    if (current === null || last !== i - 1) {
      current = [[points[i - 1].lat, points[i - 1].lon]];
      paths.push(current);
    }
    current.push([points[i].lat, points[i].lon]);
    last = i;
  });
  return paths;
};

/** Premier point à `ms` ou après (`points.length` s'il n'y en a pas). */
const firstIndexAtOrAfter = (points: readonly HeartRatePoint[], ms: number): number => {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].timeMs < ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/** FC d'une plage de temps (une répétition du fractionné), de `startMs` à `endMs` ; `null` sans FC. */
export const timeSpanHeartRate = (
  points: readonly HeartRatePoint[],
  smoothed: readonly (number | null)[],
  startMs: number,
  endMs: number,
  gapS: number,
  recoveryS: number
): SpanHeartRate | null => {
  const start = firstIndexAtOrAfter(points, startMs);
  const end = firstIndexAtOrAfter(points, endMs + 1) - 1;
  return end > start ? spanHeartRate(points, smoothed, start, end, gapS, recoveryS) : null;
};
