import { pointTimeMs } from '../core/kinematics';
import { SPORT_PROFILES } from '../core/sportProfiles';
import type { RawTrackPoint, SportType } from '../core/types';
import type { LocationFix } from '../platform/location';

/**
 * Logique de l'enregistrement, sans accès au téléphone : ce que l'enregistreur
 * garde d'une position, ce qu'il en affiche, et comment il nomme la session.
 *
 * Principe (`docs/ETAT_DU_PROJET.md` §12) : enregistrer brut, analyser
 * ensuite. Rien n'est filtré, sauf une position qui n'est pas plus récente que
 * la précédente : ce n'est pas une mesure mais une redélivrance, et elle
 * donnerait un intervalle nul au pipeline d'analyse.
 */

/** Vrai si la position est plus récente que la dernière gardée. */
export const isNewerFix = (lastMs: number | null, fix: LocationFix): boolean =>
  lastMs === null || fix.timeMs > lastMs;

const round = (value: number | undefined, decimals: number): number | undefined =>
  value === undefined ? undefined : Number(value.toFixed(decimals));

/**
 * Arrondi à la résolution utile : 6 décimales de degré (environ 11 cm, sous
 * la précision GPS réelle), le centimètre par seconde pour la vitesse, le
 * décimètre pour la précision et l'altitude, le dixième de degré pour le cap.
 * Appliqué une fois, à la réception, pour que le GPX écrit depuis la mémoire
 * et celui reconstruit depuis le journal soient identiques.
 */
export const roundFix = (fix: LocationFix): LocationFix => ({
  timeMs: Math.round(fix.timeMs),
  lat: Number(fix.lat.toFixed(6)),
  lon: Number(fix.lon.toFixed(6)),
  accuracyM: round(fix.accuracyM, 1),
  altitudeM: round(fix.altitudeM, 1),
  speedMs: round(fix.speedMs, 2),
  bearingDeg: round(fix.bearingDeg, 1),
});

/** Points d'une trace lue, rendus sous forme de positions : l'entrée du rejeu. */
export const fixesFromRawPoints = (points: RawTrackPoint[]): LocationFix[] =>
  points
    .map((p) => ({ p, timeMs: pointTimeMs(p.time) }))
    .filter(({ timeMs }) => isFinite(timeMs))
    .map(({ p, timeMs }) => ({ timeMs, lat: p.lat, lon: p.lon, altitudeM: p.ele, speedMs: p.speedMs }));

/**
 * Découpe une trace plate en segments continus, aux indices de `breaks` (le
 * premier point de chaque nouveau segment ; le segment 0 commence à l'indice
 * 0). Une pause, manuelle ou automatique, en pose une : c'est la même trace
 * qu'elle vienne de la mémoire ou d'un journal relu après un arrêt brutal.
 * Aucun segment vide dans le résultat.
 */
export const splitIntoSegments = (fixes: LocationFix[], breaks: number[]): LocationFix[][] => {
  const cuts = [...new Set(breaks)]
    .filter((i) => i > 0 && i < fixes.length)
    .sort((a, b) => a - b);
  const segments: LocationFix[][] = [];
  let start = 0;
  for (const cut of cuts) {
    segments.push(fixes.slice(start, cut));
    start = cut;
  }
  segments.push(fixes.slice(start));
  return segments.filter((s) => s.length > 0);
};

/** Ce que la page d'enregistrement affiche en direct. */
export interface RecordingStats {
  pointCount: number;
  /** Heure de la première et de la dernière position, en millisecondes. */
  firstMs: number | null;
  lastMs: number | null;
  /**
   * Plus long intervalle entre deux positions, en secondes. C'est l'indicateur
   * d'une coupure : un téléphone qui suspend l'application écran éteint le
   * trahit ici, quand le nombre de points seul ne dit rien.
   */
  longestGapS: number;
  /** Précision de la dernière position, en mètres, si la source la donne. */
  lastAccuracyM: number | null;
}

export const EMPTY_RECORDING_STATS: RecordingStats = {
  pointCount: 0,
  firstMs: null,
  lastMs: null,
  longestGapS: 0,
  lastAccuracyM: null,
};

/** Durée couverte par les positions reçues, en millisecondes : le chrono de l'enregistrement. */
export const recordingDurationMs = (stats: RecordingStats): number =>
  stats.firstMs !== null && stats.lastMs !== null ? stats.lastMs - stats.firstMs : 0;

export const addFixToStats = (stats: RecordingStats, fix: LocationFix): RecordingStats => {
  const gapS = stats.lastMs === null ? 0 : (fix.timeMs - stats.lastMs) / 1000;
  return {
    pointCount: stats.pointCount + 1,
    firstMs: stats.firstMs ?? fix.timeMs,
    lastMs: fix.timeMs,
    longestGapS: Math.max(stats.longestGapS, gapS),
    lastAccuracyM: fix.accuracyM ?? null,
  };
};

/**
 * Vrai quand il faut écrire le journal : à la première position, puis dès que
 * `flushS` secondes de trace se sont écoulées depuis la dernière écriture.
 * Compté en temps de trace et non par une minuterie, que le système bride
 * écran éteint : le journal s'écrit au rythme où les positions arrivent.
 */
export const shouldFlushJournal = (lastFlushMs: number | null, fixMs: number, flushS: number): boolean =>
  lastFlushMs === null || fixMs - lastFlushMs >= flushS * 1000;

/** Résultat d'une évaluation de pause automatique : que faire, et l'état à garder pour la suivante. */
export type AutoPauseEvent = 'none' | 'pause' | 'resume';
export interface AutoPauseResult {
  event: AutoPauseEvent;
  belowSinceMs: number | null;
}

/**
 * Décide, à chaque position reçue, si la pause automatique doit se déclencher
 * ou s'arrêter. Toujours en temps réel de trace (`fix.timeMs`), jamais en
 * nombre de positions (règle n°2) : une cadence variable ne doit pas changer
 * le résultat. `speedMs <= 0` désactive la fonctionnalité.
 *
 * En enregistrement : la première position sous le seuil ancre
 * `belowSinceMs` ; la pause se déclenche dès que `delayS` secondes se sont
 * écoulées depuis cette ancre, sans qu'une position au-dessus du seuil ne
 * l'ait entre-temps remise à zéro. En pause : seule une position au-dessus du
 * seuil déclenche la reprise, immédiatement.
 */
export const evaluateAutoPause = (
  isPaused: boolean,
  belowSinceMs: number | null,
  fix: LocationFix,
  settings: { speedMs: number; delayS: number }
): AutoPauseResult => {
  if (settings.speedMs <= 0) return { event: 'none', belowSinceMs: null };
  if (fix.speedMs === undefined) return { event: 'none', belowSinceMs };

  const below = fix.speedMs < settings.speedMs;
  if (isPaused) {
    return below ? { event: 'none', belowSinceMs } : { event: 'resume', belowSinceMs: null };
  }
  if (!below) return { event: 'none', belowSinceMs: null };
  const since = belowSinceMs ?? fix.timeMs;
  if (fix.timeMs - since >= settings.delayS * 1000) return { event: 'pause', belowSinceMs: null };
  return { event: 'none', belowSinceMs: since };
};

export const isSportType = (value: unknown): value is SportType =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(SPORT_PROFILES, value);

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Nom de fichier d'une session, à l'heure locale de son premier point :
 * `2026-09-23_14-05-07_wingfoil.gpx`, ou `…_session.gpx` si le support est inconnu.
 */
export const sessionFileName = (startMs: number, sport: SportType | null): string => {
  const d = new Date(startMs);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `${date}_${time}_${sport ?? 'session'}.gpx`;
};

/** Titre d'une session, repris comme nom de trace dans le GPX : `Wingfoil, 23/09/2026 14:05`. */
export const sessionTitle = (startMs: number, sport: SportType): string => {
  const d = new Date(startMs);
  return `${SPORT_PROFILES[sport].label}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
