import { RECORD_FORMAT, RECORD_VERSION, SUMMARY_CALC_VERSION, type SessionRecord } from '../library/record';
import type { StatSession } from '../library/stats';

/** Fichier de test seulement : le code de l'application ne l'importe pas. */

const START_MS = Date.UTC(2026, 8, 23, 12, 0, 0);

/**
 * Fiche de session d'essai : un wingfoil enregistré le 23/09/2026. `patch` remplace
 * des champs de la fiche, `summary` seulement des champs du résumé.
 */
export const sessionRecord = (patch: Partial<SessionRecord> = {}, summary: Partial<SessionRecord['summary']> = {}): SessionRecord => ({
  format: RECORD_FORMAT,
  version: RECORD_VERSION,
  gpx: '2026-09-23_14-00-00_wingfoil.gpx',
  sport: 'wingfoil',
  activityId: null,
  source: 'enregistrement',
  addedAt: '2026-09-23T13:00:00.000Z',
  title: 'Wingfoil, 23/09/2026 14:00',
  name: null,
  summary: {
    calcVersion: SUMMARY_CALC_VERSION,
    startMs: START_MS,
    endMs: START_MS + 3_600_000,
    distanceM: 25_000,
    movingTimeS: 3000,
    elevationGainM: null,
    maxSpeedMs: 12.4,
    pointCount: 3601,
    samplingS: 1,
    ...summary,
  },
  notes: null,
  analysis: null,
  ...patch,
});

/** Session des statistiques d'essai : une course d'une heure, 10 km, qui commence à `startMs`. */
export const statSession = (startMs: number, over: Partial<StatSession> = {}): StatSession => ({
  file: `s-${startMs}.json`,
  name: null,
  startMs,
  endMs: startMs + 3_600_000,
  distanceM: 10_000,
  movingTimeS: 3000,
  inMotionS: null,
  movingDistanceM: 9000,
  elevationGainM: null,
  maxSpeedMs: 5,
  activityId: 'course',
  family: 'course',
  treatment: 'course',
  positions: true,
  maneuverCount: null,
  maneuverResults: null,
  foil: false,
  waveCount: null,
  longestWaveM: null,
  longestFlightS: null,
  flightS: null,
  reps: 0,
  heartRate: null,
  cadenceSpm: null,
  gear: null,
  ...over,
});
