import { pad2 } from '../core/units';
import type { HeartRateZones } from '../core/heartRate';
import { runnerHrSource, type HrSource, type RunnerProfile } from '../hooks/useRunnerProfile';

/**
 * D'où viennent les seuils et les zones cardiaques, en clair : dans l'onglet
 * cardio, le test de FC max, Pratiquant et les Statistiques.
 */

/** « test du 24/10 », « séance du 20/10 », « saisie ». */
export const hrSourceLabel = (source: HrSource): string => {
  if (source.kind === 'saisie') return 'saisie';
  const kind = source.kind === 'test' ? 'test' : 'séance';
  if (source.atMs === null) return kind;
  const date = new Date(source.atMs);
  return `${kind} du ${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`;
};

/** Origine de la FC max retenue par les zones : estimée par l'âge, ou celle de Pratiquant. */
export const hrMaxOriginLabel = (zones: Pick<HeartRateZones, 'estimated'>, profile: RunnerProfile): string => {
  const source = runnerHrSource(profile, 'hrMax');
  return zones.estimated || source === null ? "estimée par l'âge" : hrSourceLabel(source);
};

/** Décalage signé, avec le vrai signe moins : « −7 », « +3 ». */
export const formatOffsetBpm = (offsetBpm: number): string => (offsetBpm < 0 ? `−${-offsetBpm}` : `+${offsetBpm}`);

/**
 * « S1 141 et S2 162 bpm (−7 pour cette activité), tirés de la FC repos 50
 * (test du 25/10) et de la FC max 190 (test du 24/10). »
 */
export const zonesOriginText = (zones: HeartRateZones, profile: RunnerProfile): string => {
  const offset = zones.offsetBpm !== 0 ? ` (${formatOffsetBpm(zones.offsetBpm)} pour cette activité)` : '';
  const seuils = `S1 ${zones.s1} et S2 ${zones.s2} bpm${offset}`;
  const hrMax = zones.hrMax === null ? '' : `FC max ${zones.hrMax} (${hrMaxOriginLabel(zones, profile)})`;
  if (zones.method === 'saisis') return `${seuils}, saisis dans Réglages › Pratiquant.`;
  if (zones.method === 'reserve') {
    const rest = runnerHrSource(profile, 'hrRest');
    return `${seuils}, tirés de la FC repos ${profile.hrRest} (${rest ? hrSourceLabel(rest) : 'saisie'}) et de la ${hrMax}.`;
  }
  return `${seuils}, tirés de la ${hrMax}, sans FC repos.`;
};
