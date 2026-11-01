import { isFiniteNumber } from '../core/basics';
import type { TrackBounds } from '../core/displayConfig';
import type { SpeedRangeMs } from '../core/speedGradient';
import type { SportFamily } from '../core/sportProfiles';
import { tilesToEvict } from '../core/tiles';
import type { SportType } from '../core/types';
import { SUMMARY_CALC_VERSION, type SessionSummary } from './record';
import type { SessionColorTrack } from './sessionTrack';

/**
 * Traces réduites des vignettes de la bibliothèque, gardées sur l'appareil
 * d'un lancement à l'autre (lot 118, décision du 01/11) : calculs purs du
 * document que range `platform/previewStore.ts`. Une entrée par session, sous
 * `folderLabel|file`, avec l'empreinte de ce dont sa trace dépend ; les
 * points y sont des entiers (millionièmes de degré, millièmes de m/s) codés en
 * écarts. Les images dessinées, elles, restent en mémoire.
 */

/** Version propre du document : l'augmenter oublie toutes les vignettes gardées. */
export const PREVIEW_FORMAT_VERSION = 1;

/** Borne du document en octets (à peu près : caractères du JSON) et calme avant de le réécrire. */
export const PREVIEW_STORE_DEFAULTS = { maxBytes: 3e6, writeDelayMs: 2000 } as const;

export interface PreviewStoreOptions {
  maxBytes: number;
  writeDelayMs: number;
}

/** Facteurs des entiers rangés : degrés au millionième (une dizaine de cm), vitesses au millième de m/s. */
const DEGREE_SCALE = 1e6;
const SPEED_SCALE = 1e3;

type PreviewPoint = SessionColorTrack['points'][number];

/** Trace d'une vignette telle que la page la dessine : points réduits au zoom `zoom`, emprise et bornes suggérées. */
export interface PreviewTrack {
  zoom: number;
  bounds: TrackBounds;
  suggested: SpeedRangeMs | null;
  points: PreviewPoint[];
}

/** Entrée rangée : empreinte, dernière vue (ms), et points en entiers codés en écarts. */
export interface StoredPreview {
  fp: string;
  usedAt: number;
  zoom: number;
  bounds: TrackBounds;
  suggested: SpeedRangeMs | null;
  lat: number[];
  lon: number[];
  colorMs: number[];
}

/** Document rangé sur l'appareil. */
export interface PreviewDocument {
  version: number;
  entries: Record<string, StoredPreview>;
}

/** Clé d'une vignette : le dossier mémoire en service (un autre dossier peut avoir un fichier de même nom) et le fichier. */
export const previewKey = (folderLabel: string | null, file: string): string => `${folderLabel}|${file}`;

/**
 * Empreinte de tout ce dont la trace d'une vignette dépend : calcul, allure
 * imposée, famille, bornes et nombre de points de la trace (un GPX rangé n'est
 * jamais réécrit), version du document et du calcul des résumés (un filtre de
 * trace changé l'augmente). Une entrée d'une autre empreinte est ignorée.
 */
export const previewFingerprint = ({ sport, referenceOverrideMs, family, summary }: {
  sport: SportType | null;
  referenceOverrideMs: number | null;
  family: SportFamily;
  summary: Pick<SessionSummary, 'startMs' | 'endMs' | 'pointCount'>;
}): string =>
  [sport, referenceOverrideMs, family, summary.startMs, summary.endMs, summary.pointCount, `${PREVIEW_FORMAT_VERSION}.${SUMMARY_CALC_VERSION}`].join('|');

/**
 * Points arrondis à la précision rangée, avant le premier dessin : la vignette
 * dessinée au premier lancement et celle relue au suivant sont la même image.
 */
export const roundPreviewPoints = (points: readonly PreviewPoint[]): PreviewPoint[] =>
  points.map((p) => ({
    lat: Math.round(p.lat * DEGREE_SCALE) / DEGREE_SCALE,
    lon: Math.round(p.lon * DEGREE_SCALE) / DEGREE_SCALE,
    colorMs: Math.round(p.colorMs * SPEED_SCALE) / SPEED_SCALE,
  }));

const deltas = (values: number[]): number[] => values.map((v, i) => (i === 0 ? v : v - values[i - 1]));

const sums = (values: number[]): number[] => {
  let total = 0;
  return values.map((v) => (total += v));
};

/** Entrée rangée d'une trace, vue à `usedAt`. */
export const encodePreview = (track: PreviewTrack, fp: string, usedAt: number): StoredPreview => ({
  fp,
  usedAt,
  zoom: track.zoom,
  bounds: track.bounds,
  suggested: track.suggested,
  lat: deltas(track.points.map((p) => Math.round(p.lat * DEGREE_SCALE))),
  lon: deltas(track.points.map((p) => Math.round(p.lon * DEGREE_SCALE))),
  colorMs: deltas(track.points.map((p) => Math.round(p.colorMs * SPEED_SCALE))),
});

/** Trace d'une entrée rangée ; les points sont ceux de `roundPreviewPoints`. */
export const decodePreview = (stored: StoredPreview): PreviewTrack => {
  const lat = sums(stored.lat);
  const lon = sums(stored.lon);
  const colorMs = sums(stored.colorMs);
  return {
    zoom: stored.zoom,
    bounds: stored.bounds,
    suggested: stored.suggested,
    points: lat.map((v, i) => ({ lat: v / DEGREE_SCALE, lon: lon[i] / DEGREE_SCALE, colorMs: colorMs[i] / SPEED_SCALE })),
  };
};

/** Place d'une entrée, à peu près en octets : sa clé et son JSON. */
export const previewEntryBytes = (key: string, stored: StoredPreview): number => key.length + JSON.stringify(stored).length;

const isIntegerList = (value: unknown): value is number[] => Array.isArray(value) && value.every((v) => Number.isInteger(v));

const isPair = (value: unknown): value is [number, number] =>
  Array.isArray(value) && value.length === 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1]);

const isRange = (value: unknown): value is SpeedRangeMs =>
  typeof value === 'object' && value !== null
  && isFiniteNumber((value as SpeedRangeMs).minMs) && isFiniteNumber((value as SpeedRangeMs).maxMs);

const isStoredPreview = (value: unknown): value is StoredPreview => {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Partial<StoredPreview>;
  return typeof e.fp === 'string'
    && isFiniteNumber(e.usedAt)
    && isFiniteNumber(e.zoom)
    && Array.isArray(e.bounds) && e.bounds.length === 2 && isPair(e.bounds[0]) && isPair(e.bounds[1])
    && (e.suggested === null || isRange(e.suggested))
    && isIntegerList(e.lat) && isIntegerList(e.lon) && isIntegerList(e.colorMs)
    && e.lat.length >= 1 && e.lon.length === e.lat.length && e.colorMs.length === e.lat.length;
};

/**
 * Entrées d'un document lu sur l'appareil : illisible ou d'une autre version,
 * il est vide ; une entrée abîmée est oubliée seule.
 */
export const parsePreviewDocument = (raw: unknown): Map<string, StoredPreview> => {
  const entries = new Map<string, StoredPreview>();
  if (typeof raw !== 'object' || raw === null) return entries;
  const doc = raw as Partial<PreviewDocument>;
  if (doc.version !== PREVIEW_FORMAT_VERSION || typeof doc.entries !== 'object' || doc.entries === null) return entries;
  for (const [key, entry] of Object.entries(doc.entries)) if (isStoredPreview(entry)) entries.set(key, entry);
  return entries;
};

/** Entrées à oublier, les moins récemment vues d'abord, pour repasser sous `maxBytes` (comme `tilesToEvict`). */
export const previewEntriesToEvict = (entries: ReadonlyArray<{ key: string; bytes: number; usedAt: number }>, maxBytes: number): string[] =>
  tilesToEvict(entries.map(({ key, bytes, usedAt }) => ({ key, bytes, savedAtMs: usedAt })), maxBytes);

/**
 * Clés gardées qu'aucune session de la bibliothèque complète ne porte :
 * session supprimée, ou d'un autre dossier mémoire.
 */
export const unknownPreviewKeys = (keys: Iterable<string>, folderLabel: string | null, files: Iterable<string>): string[] => {
  const known = new Set<string>();
  for (const file of files) known.add(previewKey(folderLabel, file));
  return [...keys].filter((key) => !known.has(key));
};
