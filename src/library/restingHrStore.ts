import { finiteOr, isFiniteNumber, roundTo } from '../core/basics';
import type { RestingHrProtocol } from '../recording/restingHrTest';
import type { RestingHrResult } from '../running/restingHrResults';

/**
 * Tests de FC repos tels qu'ils sont gardés sur l'appareil (clé
 * `tracker.restingHr`, lue et écrite par `hooks/useRestingHrResults.ts`) :
 * forme gardée, relecture tolérante, au plus `MAX_STORED_RESTING_RESULTS`. Le
 * calcul du résultat est dans `running/restingHrResults.ts`.
 */

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

/** Un test gardé, relu ; `null` s'il est mal formé. */
export const readStoredRestingResult = (raw: unknown): StoredRestingResult | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isFiniteNumber(r.startedAtMs) || !isFiniteNumber(r.lowestBpm) || !isFiniteNumber(r.fromS) || !isFiniteNumber(r.toS) || !Array.isArray(r.series)) return null;
  return {
    startedAtMs: r.startedAtMs,
    version: isFiniteNumber(r.version) ? r.version : 1,
    lowestBpm: r.lowestBpm,
    fromS: r.fromS,
    toS: r.toS,
    meanBpm: finiteOr(r.meanBpm, null),
    maxBpm: finiteOr(r.maxBpm, null),
    coverage: isFiniteNumber(r.coverage) ? Math.min(1, Math.max(0, r.coverage)) : 0,
    series: r.series.map((v) => finiteOr(v, null)),
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
      meanBpm: result.meanBpm, maxBpm: result.maxBpm, coverage: roundTo(result.coverage, 2),
      series: result.series.map((v) => (v === null ? null : Math.round(v))),
    };
