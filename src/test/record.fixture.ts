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

/**
 * Une fiche d'essai par famille (lot 80), pleine de ce que la fiche peut
 * porter : réglages, notes et matériel, résumé détaillé, et les tableaux de
 * nombres qui pèsent (altitude du terrain de 2 000 échantillons avec des trous,
 * histogramme de FC de 150 cases, voies, courbes des sauts, séances du compteur).
 */
export const familyRecords = (): Record<string, SessionRecord> => {
  const analysis = (patch: Partial<NonNullable<SessionRecord['analysis']>> = {}): NonNullable<SessionRecord['analysis']> => ({
    windDeg: null, activeThreshold: null, referenceSpeedMs: null, speedRange: null, effortThresholdMs: null, foil: null,
    pumping: null, waveThreshold: null, bikeWeightKg: null, loadKg: null, savedAt: START_MS + 7_200_000, ...patch,
  });
  const notes = { foil: '', mast: '', wing: '', gear1: '', gear2: '', conditions: 'Mistral [force 5]\net clapot', gear: null, windLevel: null, waterState: null, comment: 'Bien "tenu"', rating: 4 as const, savedAt: START_MS + 7_200_000 };
  const gear = [{ groupId: 'g1', groupName: 'Planche', itemId: 'i1', itemName: 'Foil 1 200 cm²' }];
  const histogram = { fromBpm: 60, seconds: Array.from({ length: 150 }, (_, i) => (i % 7 === 0 ? 0 : Math.round(((i * 37) % 23) * 10) / 4)) };
  const heartRate = { avgBpm: 141.25, maxBpm: 188, coveredS: 3540, histogram };
  const terrainElevation = {
    source: 'ign' as const, resource: 'ign_rge_alti_wld', version: 1, stepM: 10, fetchedAt: '2026-10-07T09:00:00.000Z', startMs: START_MS,
    t: Array.from({ length: 2000 }, (_, i) => i * 1800),
    z: Array.from({ length: 2000 }, (_, i) => (i % 97 === 13 ? null : Math.round((120 + 40 * Math.sin(i / 50) - i * 0.003) * 100) / 100)),
  };
  const marks = [{ timeMs: START_MS + 60_000, lat: 43.512345, lon: 3.912345, label: 'Départ [1]' }, { timeMs: START_MS + 90_000, lat: null, lon: null, label: null }];
  const jumps = {
    version: 2, computedAt: '2026-10-08T14:00:00.000Z',
    jumps: [0, 1, 2].map((n) => ({
      takeoffMs: START_MS + 60_000 * (n + 1), landingMs: START_MS + 60_000 * (n + 1) + 1200, flightS: 1.2, heightM: 1.05 + n / 10, takeoffVerticalMs: 3.9,
      speedMs: n === 1 ? null : 7.8, lengthM: n === 1 ? null : 9.36, doubts: n === 2 ? ['saturation' as const] : [],
      curve: { stepS: 0.05, startS: -0.5, heightsM: Array.from({ length: 45 }, (_, i) => Math.round(Math.max(0, Math.sin((i / 44) * Math.PI)) * 1.1e4) / 1e4) },
    })),
  };
  return {
    voile: sessionRecord({
      name: 'Wing à Carnon', activityId: 'voile',
      notes: { ...notes, foil: 'Foil 1200', mast: '85', wing: '5 m²', windLevel: 'moyen', waterState: 'clapot', gear },
      analysis: analysis({ windDeg: 312.5, activeThreshold: 8, referenceSpeedMs: 6.2, speedRange: { minMs: 3, maxMs: 14.5 }, foil: true, pumping: false }),
    }, { maneuverCount: 24, maneuverResults: { tackSuccess: 5, tackFail: 2, jibeSuccess: 12, jibeFail: 5 }, inMotionS: 3100, movingDistanceM: 23_500.5 }),
    course: sessionRecord({
      gpx: '2026-09-23_14-00-00_course.gpx', sport: 'running', activityId: 'course', name: 'Footing',
      notes: { ...notes, gear }, analysis: analysis({ activeThreshold: 1.2, loadKg: 4.5, speedRange: { minMs: 2, maxMs: 5 } }),
      terrainElevation, marks,
    }, { elevationGainM: 412.4, heartRate, cadence: { avgSpm: 172.5, steps: 9800 }, movingDistanceM: 11_000 }),
    velo: sessionRecord({
      gpx: '2026-09-23_14-00-00_route.gpx', sport: 'cycling', activityId: 'route', analysis: analysis({ bikeWeightKg: 9.8, speedRange: { minMs: 4, maxMs: 16 } }),
      surfaces: {
        source: 'overpass', fetchedAt: '2026-10-04T15:00:00.000Z', matchVersion: 3, startMs: START_MS,
        tags: ['highway=residential', 'highway=track|surface=gravel'], runs: Array.from({ length: 300 }, (_, i): [number, number] => [i * 12_000, (i % 3) - 1]),
      },
      terrainElevation, elevationSource: 'gps', jumps,
    }, { elevationGainM: 1250, heartRate }),
    surf: sessionRecord({
      gpx: '2026-09-23_14-00-00_surf.gpx', sport: 'surf', activityId: 'surf-foil',
      analysis: analysis({ foil: true, pumping: true, waveThreshold: 9.5, activeThreshold: 0 }), notes: { ...notes, conditions: '' },
    }, { waveCount: 14, longestWaveM: 182.25, longestFlightS: null, flightS: 640.5 }),
    fractionne: sessionRecord({
      gpx: '2026-09-23_14-00-00_fractionne.gpx', sport: 'run-intervals', activityId: 'fractionne',
      analysis: analysis({ effortThresholdMs: 4.35 }),
      intervals: [{
        workout: { reps: 3, workS: 60, restS: 30 },
        laps: [0, 1, 2].flatMap((n) => [
          { kind: 'travail' as const, rep: n + 1, startMs: START_MS + n * 90_000, endMs: START_MS + n * 90_000 + 60_000 },
          { kind: 'repos' as const, rep: n + 1, startMs: START_MS + n * 90_000 + 60_000, endMs: START_MS + (n + 1) * 90_000 },
        ]),
      }],
      marks,
    }, { heartRate }),
    sauts: sessionRecord({ gpx: '2026-09-23_14-00-00_kite.gpx', sport: 'kite', analysis: analysis({ windDeg: 0 }), jumps }),
  };
};
