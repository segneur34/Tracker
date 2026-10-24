import type { RestingHrProtocol, RestingSample } from '../recording/restingHrTest';

/**
 * Résultat d'un test de FC repos (`recording/restingHrTest.ts`) : la moyenne
 * de 10 secondes la plus basse des 3 minutes, et la courbe à la seconde pour
 * le graphique. Tout se mesure en temps : chaque mesure vaut depuis son
 * instant jusqu'à la suivante (au plus `holdS`), donc une ceinture à 1 Hz et à
 * 5 Hz donnent la même courbe.
 */
export interface RestingHrResult {
  /** Moyenne de la fenêtre la plus basse, arrondie ; `null` si aucune fenêtre n'est assez couverte. */
  lowestBpm: number | null;
  /** Début et fin de cette fenêtre, en secondes depuis le départ. */
  fromS: number | null;
  toS: number | null;
  /** Moyenne et maximum de toute la mesure. */
  meanBpm: number | null;
  maxBpm: number | null;
  /** Part des secondes couvertes par une mesure, de 0 à 1. */
  coverage: number;
  /** Assez de mesures pour fier le résultat. */
  complete: boolean;
  /** La FC de chaque seconde (la moyenne de la seconde), `null` sans mesure. */
  series: (number | null)[];
}

const validBpm = (bpm: number | null, protocol: RestingHrProtocol): bpm is number =>
  bpm !== null && isFinite(bpm) && bpm >= protocol.minBpm && bpm <= protocol.maxBpm;

/** Courbe à la seconde : `durationS` valeurs, chacune la moyenne pondérée par le temps de sa seconde, `null` si moins de la moitié couverte. */
export const restingHrSeries = (samples: readonly RestingSample[], startMs: number, protocol: RestingHrProtocol): (number | null)[] => {
  const bins = protocol.durationS;
  const sum = new Array<number>(bins).fill(0);
  const dur = new Array<number>(bins).fill(0);
  const endMs = startMs + bins * 1000;
  const sorted = [...samples].sort((a, b) => a.timeMs - b.timeMs);
  for (let i = 0; i < sorted.length; i++) {
    const { timeMs, bpm } = sorted[i];
    if (!validBpm(bpm, protocol)) continue;
    const nextMs = i + 1 < sorted.length ? sorted[i + 1].timeMs : Infinity;
    const from = Math.max(timeMs, startMs);
    const to = Math.min(nextMs, timeMs + protocol.holdS * 1000, endMs);
    if (to <= from) continue;
    for (let b = Math.floor((from - startMs) / 1000); b < bins && startMs + b * 1000 < to; b++) {
      const overlap = Math.min(to, startMs + (b + 1) * 1000) - Math.max(from, startMs + b * 1000);
      if (overlap <= 0) continue;
      sum[b] += bpm * overlap;
      dur[b] += overlap;
    }
  }
  return sum.map((s, b) => (dur[b] >= 500 ? s / dur[b] : null));
};

export const restingHrResult = (samples: readonly RestingSample[], startMs: number, protocol: RestingHrProtocol): RestingHrResult => {
  const series = restingHrSeries(samples, startMs, protocol);
  const known = series.filter((v): v is number => v !== null);
  const coverage = series.length > 0 ? known.length / series.length : 0;

  const needed = Math.ceil(protocol.windowS * protocol.minWindowCoverage - 1e-9);
  let lowest: number | null = null;
  let fromS: number | null = null;
  for (let s = 0; s + protocol.windowS <= series.length; s++) {
    let total = 0;
    let count = 0;
    for (let k = s; k < s + protocol.windowS; k++) {
      const v = series[k];
      if (v === null) continue;
      total += v;
      count++;
    }
    if (count < needed) continue;
    const mean = total / count;
    if (lowest === null || mean < lowest - 1e-9) {
      lowest = mean;
      fromS = s;
    }
  }

  return {
    lowestBpm: lowest === null ? null : Math.round(lowest),
    fromS,
    toS: fromS === null ? null : fromS + protocol.windowS,
    meanBpm: known.length > 0 ? Math.round(known.reduce((a, b) => a + b, 0) / known.length) : null,
    maxBpm: known.length > 0 ? Math.round(Math.max(...known)) : null,
    coverage,
    complete: lowest !== null && coverage >= protocol.minCoverage,
    series,
  };
};

// --- Résultats gardés ---

/** Test gardé : le résultat et l'instant du départ, la courbe en entiers. */
export interface StoredRestingResult {
  startedAtMs: number;
  version: number;
  lowestBpm: number;
  fromS: number;
  toS: number;
  meanBpm: number | null;
  maxBpm: number | null;
  coverage: number;
  series: (number | null)[];
}

/** Nombre de tests gardés : les plus récents. */
export const MAX_STORED_RESTING_RESULTS = 60;

const isNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v);
const numOrNull = (v: unknown): number | null => (isNum(v) ? v : null);

/** Un test gardé, relu ; `null` s'il est mal formé. */
export const readStoredRestingResult = (raw: unknown): StoredRestingResult | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isNum(r.startedAtMs) || !isNum(r.lowestBpm) || !isNum(r.fromS) || !isNum(r.toS) || !Array.isArray(r.series)) return null;
  return {
    startedAtMs: r.startedAtMs,
    version: isNum(r.version) ? r.version : 1,
    lowestBpm: r.lowestBpm,
    fromS: r.fromS,
    toS: r.toS,
    meanBpm: numOrNull(r.meanBpm),
    maxBpm: numOrNull(r.maxBpm),
    coverage: isNum(r.coverage) ? Math.min(1, Math.max(0, r.coverage)) : 0,
    series: r.series.map(numOrNull),
  };
};

/** Liste gardée, relue : les tests bien formés, du plus récent au plus ancien, au plus `MAX_STORED_RESTING_RESULTS`. */
export const readStoredRestingResults = (raw: unknown): StoredRestingResult[] =>
  (Array.isArray(raw) ? raw : [])
    .map(readStoredRestingResult)
    .filter((r): r is StoredRestingResult => r !== null)
    .sort((a, b) => b.startedAtMs - a.startedAtMs)
    .slice(0, MAX_STORED_RESTING_RESULTS);

/** Résultat à garder : `null` si aucune fenêtre n'a pu être mesurée. */
export const toStoredRestingResult = (result: RestingHrResult, startedAtMs: number, protocol: RestingHrProtocol): StoredRestingResult | null =>
  result.lowestBpm === null || result.fromS === null || result.toS === null
    ? null
    : {
      startedAtMs, version: protocol.version, lowestBpm: result.lowestBpm, fromS: result.fromS, toS: result.toS,
      meanBpm: result.meanBpm, maxBpm: result.maxBpm, coverage: Math.round(result.coverage * 100) / 100,
      series: result.series.map((v) => (v === null ? null : Math.round(v))),
    };
