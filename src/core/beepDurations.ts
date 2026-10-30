/**
 * Durées des sons, en millisecondes : la seule écriture, pour le bip de
 * l'enregistreur (`platform/beeper.ts`) et le calendrier du compteur
 * (`recording/intervalTimer.ts`). `TonePlayer.java` reprend les mêmes valeurs (BRIEF_MS, SHORT_MS, LONG_MS,
 * FINAL_MS et les vibrations) : les changer des deux côtés.
 */

/** Bip bref des doubles et triples (tests guidés) : plus court que le bip court, pour un « bip-bip » net. */
export const BEEP_BRIEF_MS = 65;
/** Écart entre les débuts de deux bips brefs d'un même double ou triple. */
export const BRIEF_SPACING_MS = 165;
/** Bip d'approche et bip de validation d'une balise. */
export const BEEP_SHORT_MS = 120;
export const BEEP_LONG_MS = 800;
/** Pause entre les trois bips de fin d'un parcours. */
export const BEEP_FINISH_GAP_MS = 250;
/** Long double, la fin d'une séance du compteur. */
export const BEEP_FINAL_MS = 1600;

/** Sons du compteur et des tests guidés : bip bref, bip court, bip long, et le long double de la fin de séance. */
export type ToneKind = 'bref' | 'court' | 'long' | 'final';

/** Durée de chaque son, en millisecondes. */
export const TONE_MS: Record<ToneKind, number> = { bref: BEEP_BRIEF_MS, court: BEEP_SHORT_MS, long: BEEP_LONG_MS, final: BEEP_FINAL_MS };
