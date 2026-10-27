/**
 * Son des bips (24/10) : plus ou moins grave, choisi dans Réglages pour tous
 * les bips de l'application (compteur, balises, tests, repos). Un haut-parleur
 * de téléphone porte le mieux vers 2 kHz, le son d'avant ce réglage ; plus
 * grave, il s'entend moins fort.
 */

export type BeepSound = 'grave' | 'medium' | 'aigu' | 'tres-aigu';

export const BEEP_SOUNDS: readonly { key: BeepSound; label: string; hz: number }[] = [
  { key: 'grave', label: 'grave', hz: 1000 },
  { key: 'medium', label: 'médium', hz: 1500 },
  { key: 'aigu', label: 'aigu', hz: 2000 },
  { key: 'tres-aigu', label: 'très aigu', hz: 3000 },
];

/**
 * Son par défaut : médium (26/10, demande de l'utilisateur ; aigu avant).
 * Un son choisi dans Réglages est écrit tel quel et ne suit pas ce défaut.
 */
export const DEFAULT_BEEP_SOUND: BeepSound = 'medium';

export const isBeepSound = (value: unknown): value is BeepSound => BEEP_SOUNDS.some((s) => s.key === value);

/** Hauteur d'un son, en hertz ; celle du défaut pour une valeur inconnue. */
export const beepSoundHz = (sound: unknown): number =>
  (BEEP_SOUNDS.find((s) => s.key === sound) ?? BEEP_SOUNDS.find((s) => s.key === DEFAULT_BEEP_SOUND)!).hz;
