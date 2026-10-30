import { bandIndex } from './basics';
import { firstIndexAtOrAfterTime, lastIndexAtOrBeforeTime } from './search';
import { meanFilterByTime } from './speedFilter';
import { pathsWhere, type TrackStep } from './trackPaths';

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
 * point n'a pas de FC. Le lissage porte sur la suite des seuls points à FC : un
 * point sans FC entre deux ne la coupe pas (GPS à 5 Hz, FC à 1 Hz, 27/10) ;
 * elle est coupée par un trou de plus de `gapS` entre deux FC successives.
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
    if (!validBpm(points[i].hr)) continue;
    const prev = run[run.length - 1];
    if (prev !== undefined && points[i].timeMs - points[prev].timeMs > gapS * 1000) flush();
    run.push(i);
  }
  flush();
  return out;
};

/**
 * Chaque intervalle compté : de `from`, le point à FC précédent (`i - 1` quand
 * tous les points ont la leur), à `i`, sans trou de plus de `gapS` entre les
 * deux ; la durée va à la FC lissée de `i`, arrondie au battement. Seulement
 * les points de `start` à `end` compris, s'ils sont donnés.
 */
const forEachCounted = (
  points: readonly HeartRatePoint[],
  smoothed: readonly (number | null)[],
  gapS: number,
  visit: (i: number, bpm: number, dtS: number, from: number) => void,
  start = 0,
  end = points.length - 1
) => {
  let from = -1;
  for (let i = Math.max(start, 0); i <= end && i < points.length; i++) {
    const bpm = smoothed[i];
    if (bpm === null) continue;
    const previous = from;
    from = i;
    if (previous < 0) continue;
    const dtS = (points[i].timeMs - points[previous].timeMs) / 1000;
    if (dtS <= 0 || dtS > gapS) continue;
    visit(i, Math.round(bpm), dtS, previous);
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

/** Données du pratiquant qui fixent les seuils et les zones (`RunnerProfile`). */
export interface HeartRateAthlete {
  hrMax: number | null;
  hrRest: number | null;
  /** S1 et S2 saisis à la main (test en laboratoire), à pied, en bpm. */
  hrThresholds?: readonly number[] | null;
  /** Bornes basses des zones 1 à 5 saisies avant les seuils (avant le 25/10), relues pour en tirer S1 et S2. */
  hrZones?: readonly number[] | null;
}

/**
 * Modèle des seuils et des zones (`HeartRateProfile.zoneModel`). S1 et S2 en
 * part de la réserve cardiaque, ou de la FC max sans FC de repos ; les zones
 * calées dessus : Z1 et Z2 sous S1, Z3 à S1, Z4 entre S1 et S2, Z5 au-dessus.
 */
export interface HeartRateZoneModel {
  /** S1 et S2 : repos + part × (FC max − repos). */
  reserveThresholds: readonly [number, number];
  /** S1 et S2 sans FC de repos : part × FC max. */
  maxThresholds: readonly [number, number];
  /** Débuts de Z1 et de Z2 : repos + part × (S1 − repos). */
  belowS1Reserve: readonly [number, number];
  /** Débuts de Z1 et de Z2 sans FC de repos : part × S1. */
  belowS1Max: readonly [number, number];
  /** Début de Z4 : S1 + part × (S2 − S1). */
  z4: number;
  /** Début de Z5 : S2 + part × (FC max − S2). */
  z5: number;
}

/** D'où viennent S1 et S2 : saisis, réserve cardiaque, FC max seule. */
export type ZoneMethod = 'saisis' | 'reserve' | 'max';

export interface HeartRateThresholds {
  /** Seuils à pied, en bpm. */
  s1: number;
  s2: number;
  method: ZoneMethod;
  /** FC max retenue ; `null` quand seuls des seuils saisis sont connus. */
  hrMax: number | null;
  /** FC max estimée par l'âge, faute d'être saisie. */
  estimated: boolean;
}

export interface HeartRateZones extends HeartRateThresholds {
  /** Bornes basses des zones 1 à 5, en bpm, croissantes. */
  bounds: number[];
  /** Décalage du sport, déjà ajouté à `s1` et `s2`. */
  offsetBpm: number;
}

/** Nombre de zones. */
export const ZONE_COUNT = 5;

/** FC max estimée par l'âge (Tanaka, 2001). */
export const estimateHrMax = (age: number): number => Math.round(208 - 0.7 * age);

const plausible = (b: unknown): b is number => typeof b === 'number' && isFinite(b) && b >= MIN_PLAUSIBLE_BPM && b <= MAX_PLAUSIBLE_BPM;

/** Bornes personnalisées valides : 5 valeurs croissantes. */
export const isValidZoneBounds = (bounds: readonly number[] | null | undefined): bounds is readonly number[] =>
  Array.isArray(bounds) && bounds.length === ZONE_COUNT && bounds.every((b, k) => plausible(b) && (k === 0 || b > bounds[k - 1]));

/** Seuils saisis valides : S1 puis S2, plus haut. */
export const isValidThresholds = (thresholds: readonly number[] | null | undefined): thresholds is readonly [number, number] =>
  Array.isArray(thresholds) && thresholds.length === 2 && plausible(thresholds[0]) && plausible(thresholds[1]) && thresholds[1] > thresholds[0];

/**
 * Seuils saisis : ceux de `hrThresholds`, sinon tirés des zones saisies avant
 * eux (S1 au début de Z3, S2 là où Z4 le placerait).
 */
const enteredThresholds = (athlete: HeartRateAthlete, model: HeartRateZoneModel): [number, number] | null => {
  if (isValidThresholds(athlete.hrThresholds)) return [Math.round(athlete.hrThresholds[0]), Math.round(athlete.hrThresholds[1])];
  if (!isValidZoneBounds(athlete.hrZones)) return null;
  const [, , z3, z4] = athlete.hrZones;
  return [Math.round(z3), Math.round(z3 + (z4 - z3) / model.z4)];
};

/**
 * S1 et S2 à pied : saisis d'abord ; sinon en part de la réserve cardiaque
 * (Karvonen) si la FC de repos est connue, de la FC max sinon ; FC max estimée
 * par l'âge si elle manque. `null` sans seuils saisis, FC max ni âge.
 */
export const heartRateThresholds = (athlete: HeartRateAthlete, age: number | null, model: HeartRateZoneModel): HeartRateThresholds | null => {
  const given = athlete.hrMax;
  const hrMax = given ?? (age !== null && age > 0 ? estimateHrMax(age) : null);
  const estimated = given === null && hrMax !== null;
  const entered = enteredThresholds(athlete, model);
  if (entered) return { s1: entered[0], s2: entered[1], method: 'saisis', hrMax, estimated };
  if (hrMax === null) return null;
  const rest = athlete.hrRest;
  if (rest !== null && rest < hrMax) {
    const [f1, f2] = model.reserveThresholds;
    return { s1: Math.round(rest + f1 * (hrMax - rest)), s2: Math.round(rest + f2 * (hrMax - rest)), method: 'reserve', hrMax, estimated };
  }
  const [f1, f2] = model.maxThresholds;
  return { s1: Math.round(f1 * hrMax), s2: Math.round(f2 * hrMax), method: 'max', hrMax, estimated };
};

/**
 * Zones du pratiquant pour un sport : S1 et S2 (`heartRateThresholds`)
 * décalés de `offsetBpm`, puis les 5 bornes calées dessus (`model`). Sans FC
 * max, Z5 commence juste au-dessus de S2. `null` sans seuils.
 */
export const heartRateZones = (
  athlete: HeartRateAthlete, age: number | null, model: HeartRateZoneModel, offsetBpm = 0
): HeartRateZones | null => {
  const thresholds = heartRateThresholds(athlete, age, model);
  if (thresholds === null) return null;
  const s1 = thresholds.s1 + offsetBpm;
  const s2 = thresholds.s2 + offsetBpm;
  const { hrMax } = thresholds;
  const rest = athlete.hrRest !== null && athlete.hrRest < s1 ? athlete.hrRest : null;
  const below = rest !== null
    ? model.belowS1Reserve.map((f) => rest + f * (s1 - rest))
    : model.belowS1Max.map((f) => f * s1);
  const z5 = hrMax !== null && hrMax > s2 ? s2 + model.z5 * (hrMax - s2) : s2 + 1;
  const bounds = [...below, s1, s1 + model.z4 * (s2 - s1), z5].map(Math.round);
  // Toujours croissantes, même resserrées par l'arrondi.
  for (let k = 1; k < bounds.length; k++) bounds[k] = Math.max(bounds[k], bounds[k - 1] + 1);
  return { ...thresholds, s1, s2, bounds, offsetBpm };
};

/** Secondes passées dans chaque zone, de « sous Z1 » (0) à Z5. */
export const timeInZones = (
  points: readonly HeartRatePoint[],
  smoothed: readonly (number | null)[],
  bounds: readonly number[],
  gapS: number
): number[] => {
  const times = new Array<number>(bounds.length + 1).fill(0);
  forEachCounted(points, smoothed, gapS, (_, bpm, dtS) => (times[bandIndex(bpm, bounds)] += dtS));
  return times;
};

/**
 * Charge d'Edwards : minutes de chaque zone × son coefficient (`weights`, de
 * « sous Z1 » à Z5, `HeartRateProfile.loadWeights`).
 */
export const edwardsLoad = (zoneTimesS: readonly number[], weights: readonly number[]): number =>
  zoneTimesS.reduce((sum, s, zone) => sum + (s / 60) * (weights[zone] ?? 0), 0);

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
  // Boucle plutôt que Math.min(...clés), comme pour toute série.
  let fromBpm = Infinity;
  let toBpm = -Infinity;
  for (const bpm of byBpm.keys()) {
    if (bpm < fromBpm) fromBpm = bpm;
    if (bpm > toBpm) toBpm = bpm;
  }
  const seconds = new Array<number>(toBpm - fromBpm + 1).fill(0);
  for (const [bpm, s] of byBpm) seconds[bpm - fromBpm] = Math.round(s);
  return { fromBpm, seconds };
};

/** Temps par zone tiré d'un histogramme, avec les zones du moment (statistiques). */
export const histogramZoneTimes = (histogram: HeartRateHistogram, bounds: readonly number[]): number[] => {
  const times = new Array<number>(bounds.length + 1).fill(0);
  histogram.seconds.forEach((s, k) => (times[bandIndex(histogram.fromBpm + k, bounds)] += s));
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
  forEachCounted(points, smoothed, gapS, (i, bpm, dtS, from) => {
    if (!active[i] || !isFinite(speedsMs[i])) return;
    if (block !== null && last !== from) block = null;
    block ??= { index: from, speed: 0, bpm: 0, s: 0 };
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
  // La FC lissée telle quelle, pas arrondie : arrondies à la fin.
  forEachCounted(points, smoothed, gapS, (i, _, dtS) => {
    const bpm = smoothed[i] as number;
    sum += bpm * dtS;
    coveredS += dtS;
    maxBpm = Math.max(maxBpm, bpm);
  }, start, end);
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
  const steps: (TrackStep & { bpm: number })[] = [];
  forEachCounted(points, smoothed, gapS, (i, bpm, _, from) => steps.push({ from, to: i, bpm }));
  return pathsWhere(points, steps, (s) => bandIndex(s.bpm, bounds) === zone);
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
  const start = firstIndexAtOrAfterTime(points, startMs);
  const end = lastIndexAtOrBeforeTime(points, endMs);
  return end > start ? spanHeartRate(points, smoothed, start, end, gapS, recoveryS) : null;
};
