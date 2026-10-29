/**
 * Durées des sons, en millisecondes : la seule écriture, pour le bip de
 * l'enregistreur (`platform/beeper.ts`) et le calendrier du compteur
 * (`recording/intervalTimer.ts`). `TonePlayer.java` reprend les mêmes valeurs.
 */

/** Bip d'approche et bip de validation d'une balise. */
export const BEEP_SHORT_MS = 120;
export const BEEP_LONG_MS = 800;
/** Pause entre les trois bips de fin d'un parcours. */
export const BEEP_FINISH_GAP_MS = 250;
/** Long double, la fin d'une séance du compteur. */
export const BEEP_FINAL_MS = 1600;

/** Sons du compteur et des tests guidés : bip court, bip long, et le long double de la fin de séance. */
export type ToneKind = 'court' | 'long' | 'final';

/** Durée de chaque son, en millisecondes. */
export const TONE_MS: Record<ToneKind, number> = { court: BEEP_SHORT_MS, long: BEEP_LONG_MS, final: BEEP_FINAL_MS };
