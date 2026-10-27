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
