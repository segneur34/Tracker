import { finiteOr, isFiniteNumber, isObject, parseJson, roundTo, stringifyJson } from '../core/basics';
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

/** Clé de l'appareil où la liste est gardée. */
export const RESTING_HR_KEY = 'tracker.restingHr';

/**
 * Union de deux listes par `startedAtMs` (un même départ est un même test : celui de `a`, l'appareil, est gardé),
 * du plus récent au plus ancien, au plus `MAX_STORED_RESTING_RESULTS`.
 *
 * Limite assumée : la fusion est une union, sans mémoire des retraits. Un test retiré sur un appareil revient
 * depuis un autre appareil du dossier qui l'a encore.
 */
export const mergeRestingResults = (a: readonly StoredRestingResult[], b: readonly StoredRestingResult[]): StoredRestingResult[] => {
  const byStart = new Map<number, StoredRestingResult>();
  for (const r of [...a, ...b]) if (!byStart.has(r.startedAtMs)) byStart.set(r.startedAtMs, r);
  return [...byStart.values()].sort((x, y) => y.startedAtMs - x.startedAtMs).slice(0, MAX_STORED_RESTING_RESULTS);
};

/** Deux listes disent-elles la même chose ? */
export const sameRestingResults = (a: readonly StoredRestingResult[], b: readonly StoredRestingResult[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const FILE_FORMAT = 'tracker-fc-repos';
const FILE_VERSION = 1;

/** Texte du fichier `fc-repos.json` du dossier mémoire. */
export const restingHrFileText = (results: readonly StoredRestingResult[]): string =>
  `${stringifyJson({ format: FILE_FORMAT, version: FILE_VERSION, results })}\n`;

/**
 * Relecture tolérante du fichier : `[]` s'il est absent (`text` nul), les tests bien formés sinon, `null` s'il ne
 * se lit pas (abîmé, d'un autre format) : l'appelant n'écrit alors rien par-dessus.
 */
export const parseRestingHrFile = (text: string | null): StoredRestingResult[] | null => {
  if (text === null) return [];
  const file = parseJson(text);
  if (!isObject(file) || file.format !== FILE_FORMAT || !Array.isArray(file.results)) return null;
  return readStoredRestingResults(file.results);
};

/** Résultat à garder : `null` si aucune fenêtre n'a pu être mesurée. */
export const toStoredRestingResult = (result: RestingHrResult, startedAtMs: number, protocol: RestingHrProtocol): StoredRestingResult | null =>
  result.lowestBpm === null || result.fromS === null || result.toS === null
    ? null
    : {
      startedAtMs, version: protocol.version, lowestBpm: result.lowestBpm, fromS: result.fromS, toS: result.toS,
      meanBpm: result.meanBpm, maxBpm: result.maxBpm, coverage: roundTo(result.coverage, 2),
      series: result.series.map((v) => (v === null ? null : Math.round(v))),
    };
