/**
 * Lectures communes des graphes (`Readout`) : la valeur d'une série dans sa
 * couleur, puis l'abscisse. Pures ; chaque module décide quand lire (point
 * survolé dans la plage zoomée) et donne le texte de l'abscisse.
 */
import type { Readout, ReadoutValue } from './ChartReadout';
import { SPEED_COLOR } from './chartStyle';
import { HEART_RATE_COLOR } from './heartRateColors';

/** Valeur de FC lue en un point : « 142 bpm », ou « — » sans valeur (trou de ceinture). */
export const heartRateValue = (bpm: number | null | undefined): ReadoutValue => (
  { text: bpm === null || bpm === undefined ? '—' : `${Math.round(bpm)} bpm`, color: HEART_RATE_COLOR }
);

/** FC lue en un point, avec son abscisse. */
export const heartRateReadout = (bpm: number | null | undefined, at: string): Readout => ({ values: [heartRateValue(bpm)], at });

/** Vitesse (ou allure) déjà mise en forme, dans la couleur de sa série (le bleu de la voile pour la voile). */
export const speedReadout = (text: string, at: string, color: string = SPEED_COLOR): Readout => ({
  values: [{ text, color }],
  at,
});
