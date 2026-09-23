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
 * Arrondi à la résolution utile : 7 décimales de degré (environ 1 cm), le
 * centimètre par seconde pour la vitesse, le décimètre pour la précision et
 * l'altitude, le dixième de degré pour le cap. Appliqué une fois, à la
 * réception, pour que le GPX écrit depuis la mémoire et celui reconstruit
 * depuis le journal soient identiques.
 */
export const roundFix = (fix: LocationFix): LocationFix => ({
  timeMs: Math.round(fix.timeMs),
  lat: Number(fix.lat.toFixed(7)),
  lon: Number(fix.lon.toFixed(7)),
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

export const isSportType = (value: unknown): value is SportType =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(SPORT_PROFILES, value);

const pad = (n: number): string => String(n).padStart(2, '0');

/** Nom de fichier d'une session, à l'heure locale de son premier point : `2026-09-23_14-05-07_wingfoil.gpx`. */
export const sessionFileName = (startMs: number, sport: SportType): string => {
  const d = new Date(startMs);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `${date}_${time}_${sport}.gpx`;
};

/** Titre d'une session, repris comme nom de trace dans le GPX : `Wingfoil, 23/09/2026 14:05`. */
export const sessionTitle = (startMs: number, sport: SportType): string => {
  const d = new Date(startMs);
  return `${SPORT_PROFILES[sport].label}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
