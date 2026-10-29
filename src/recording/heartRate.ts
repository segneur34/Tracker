import type { HeartRateSample } from '../platform/heartRate';

/** FC lisible d'une mesure : `null` hors contact de la peau ou sans valeur (`bpm` jamais arrondi). */
export const readableBpm = (sample: HeartRateSample | null): number | null =>
  sample === null || sample.contact === false || !(sample.bpm > 0) ? null : sample.bpm;

/**
 * Fréquence cardiaque d'une position : la dernière mesure de la ceinture, si
 * elle est assez proche dans le temps (`maxAgeS`, du profil) et prise au
 * contact de la peau. Sinon rien : une ceinture retirée ou hors de portée
 * laisse un trou plutôt qu'une valeur figée.
 */
export const heartRateAt = (sample: HeartRateSample | null, atMs: number, maxAgeS: number): number | undefined => {
  const bpm = readableBpm(sample);
  if (sample === null || bpm === null) return undefined;
  return Math.abs(atMs - sample.timeMs) <= maxAgeS * 1000 ? Math.round(bpm) : undefined;
};
