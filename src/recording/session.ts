import { pad2 } from '../core/units';
import { formatLocalDate } from '../core/calendar';
import { pointTimeMs } from '../core/kinematics';
import { SPORT_PROFILES, hasPositions } from '../core/sportProfiles';
import type { RawTrackPoint, SportType } from '../core/types';
import type { HeartRateSample } from '../platform/heartRate';
import { readableBpm } from './heartRate';
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

/** Ce que les états de l'enregistreur disent de la pause : l'état (`RecorderState`) en porte plus. */
interface RecorderPhase {
  status: string;
  pausedReason: 'manual' | 'auto' | null;
}

/** Une session est en cours : au démarrage, en enregistrement ou en pause. */
export const isRecordingSession = (state: { status: string }): boolean =>
  state.status === 'starting' || state.status === 'recording' || state.status === 'paused';

/** En pause demandée par l'utilisateur (appui long, notification). */
export const isManualPause = (state: RecorderPhase): boolean => state.status === 'paused' && state.pausedReason === 'manual';

/** En pause automatique : à l'arrêt, sous la vitesse de pause de l'activité. */
export const isAutoPause = (state: RecorderPhase): boolean => state.status === 'paused' && state.pausedReason === 'auto';

/**
 * Mesure de la ceinture gardée par l'enregistrement d'une session sans
 * position (muscu, lot I du 25/10) : l'heure et la FC, sans lat ni lon. Sans
 * FC, c'est le point posé à l'heure de l'arrêt, pour que la durée aille
 * jusqu'à lui (`withStopPoint`).
 */
export interface HeartRateFix {
  timeMs: number;
  heartRateBpm?: number;
}

/**
 * Mesure de la ceinture à garder pour une session sans position, ou `null` :
 * sans contact avec la peau ou sans FC, pas de point (un trou plutôt qu'une
 * valeur figée) ; moins de `minIntervalMs` après la dernière gardée, pas de
 * point non plus (une par seconde au plus, au pas de l'enregistrement).
 */
export const keepHeartRateSample = (lastKeptMs: number | null, sample: HeartRateSample, minIntervalMs: number): HeartRateFix | null => {
  const bpm = readableBpm(sample);
  if (bpm === null || !isFinite(sample.timeMs)) return null;
  const timeMs = Math.round(sample.timeMs);
  // Tolérance d'un quart d'intervalle : une ceinture à 1 Hz livre ses mesures
  // avec quelques ms de gigue, et 998 ms après la dernière reste une mesure
  // par seconde, pas une de trop (relecture du 28/10).
  if (lastKeptMs !== null && timeMs - lastKeptMs < minIntervalMs * 0.75) return null;
  return { timeMs, heartRateBpm: Math.round(bpm) };
};

/**
 * Segments d'une session sans position, avec un dernier point sans FC à
 * l'heure de l'arrêt au bout du dernier : la durée va jusqu'à l'arrêt, pas
 * jusqu'à la dernière mesure. Rien d'ajouté si l'arrêt n'est pas plus tard
 * que le dernier point, ni sans segment.
 */
export const withStopPoint = (segments: HeartRateFix[][], stopMs: number): HeartRateFix[][] => {
  const last = segments[segments.length - 1];
  if (!last || last.length === 0 || stopMs <= last[last.length - 1].timeMs) return segments;
  return [...segments.slice(0, -1), [...last, { timeMs: Math.round(stopMs) }]];
};

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
  heartRateBpm: round(fix.heartRateBpm, 0),
});

/** Points d'une trace lue, rendus sous forme de positions, FC comprise : l'entrée du rejeu (un test se guide sur la FC du fichier). */
export const fixesFromRawPoints = (points: RawTrackPoint[]): LocationFix[] =>
  points
    .map((p) => ({ p, timeMs: pointTimeMs(p.time) }))
    .filter(({ timeMs }) => isFinite(timeMs))
    .map(({ p, timeMs }) => ({ timeMs, lat: p.lat, lon: p.lon, altitudeM: p.ele, speedMs: p.speedMs, heartRateBpm: p.hr }));

/**
 * Découpe une trace plate en segments continus, aux indices de `breaks` (le
 * premier point de chaque nouveau segment ; le segment 0 commence à l'indice
 * 0). Une pause, manuelle ou automatique, en pose une : c'est la même trace
 * qu'elle vienne de la mémoire ou d'un journal relu après un arrêt brutal.
 * Aucun segment vide dans le résultat.
 */
export const splitIntoSegments = <F extends { timeMs: number }>(fixes: F[], breaks: number[]): F[][] => {
  const cuts = [...new Set(breaks)]
    .filter((i) => i > 0 && i < fixes.length)
    .sort((a, b) => a - b);
  const segments: F[][] = [];
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

/**
 * Pause en cours, à l'horloge du téléphone : depuis quand, et l'instant où la
 * durée s'est figée (pause manuelle) ; `frozenAtMs` nul en pause automatique.
 */
export interface PauseClock {
  sinceMs: number;
  frozenAtMs: number | null;
}

/**
 * Durée affichée de l'enregistrement : celle des positions gardées, plus la
 * pause en cours, qui tourne en pause automatique (aucune position gardée, la
 * notification compte, elle) et reste figée en pause manuelle. Comptée à
 * l'horloge du téléphone, pas à l'heure des positions : un rejeu garde les
 * siennes.
 */
export const displayedDurationMs = (stats: RecordingStats, pause: PauseClock | null, nowMs: number): number =>
  recordingDurationMs(stats) + (pause === null ? 0 : Math.max(0, (pause.frozenAtMs ?? nowMs) - pause.sinceMs));

/** Une position, ou une mesure de la ceinture d'une session sans position : seules l'heure et la précision comptent. */
export const addFixToStats = (stats: RecordingStats, fix: Pick<LocationFix, 'timeMs' | 'accuracyM'>): RecordingStats => {
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

/**
 * Nom de fichier d'une session, à l'heure locale de son premier point :
 * `2026-09-23_14-05-07_wingfoil.gpx`, ou `…_session.gpx` si le support est inconnu.
 */
export const sessionFileName = (startMs: number, sport: SportType | null): string => {
  const d = new Date(startMs);
  const date = formatLocalDate(startMs);
  const time = `${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
  return `${date}_${time}_${sport ?? 'session'}.gpx`;
};

/** Titre d'une session, repris comme nom de trace dans le GPX : `Moth à foil, 23/09/2026 14:05`. */
export const sessionTitle = (startMs: number, activityName: string): string => {
  const d = new Date(startMs);
  return `${activityName}, ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** Message d'un arrêt sans rien à garder : moins de deux positions, ou sans position (muscu) moins de deux mesures de la ceinture. */
export const nothingToKeep = (sport: SportType | null): string =>
  sport === null || hasPositions(sport) ? 'Moins de deux positions reçues : rien à enregistrer.' : 'Moins de deux mesures de la ceinture : rien à enregistrer.';
