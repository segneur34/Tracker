import type { HeartRateSample } from '../platform/heartRate';

/**
 * Fréquence cardiaque d'une position : la dernière mesure de la ceinture, si
 * elle est assez proche dans le temps (`maxAgeS`, du profil) et prise au
 * contact de la peau. Sinon rien : une ceinture retirée ou hors de portée
 * laisse un trou plutôt qu'une valeur figée.
 */
export const heartRateAt = (sample: HeartRateSample | null, atMs: number, maxAgeS: number): number | undefined => {
  if (sample === null || sample.contact === false) return undefined;
  if (!(sample.bpm > 0)) return undefined;
  return Math.abs(atMs - sample.timeMs) <= maxAgeS * 1000 ? Math.round(sample.bpm) : undefined;
};
