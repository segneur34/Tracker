/**
 * Durées des sons, en millisecondes : la seule écriture, pour le bip de
 * l'enregistreur (`platform/beeper.ts`) et le calendrier du compteur
 * (`recording/intervalTimer.ts`). `TonePlayer.java` reprend les mêmes valeurs (BRIEF_MS, SHORT_MS, LONG_MS,
 * FINAL_MS, GPS_LOST_* et les vibrations) : les changer des deux côtés.
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

/**
 * « GPS perdu » (lot 115) : deux notes descendantes, la hauteur réglée puis
 * ses 2/3, jouées deux fois. Nettement à part des bips brefs et d'une seule
 * hauteur des balises, du compteur et des tests (n° 88).
 */
export const GPS_LOST_HIGH_MS = 250;
export const GPS_LOST_LOW_MS = 500;
/** Silence entre les deux fois. */
export const GPS_LOST_GAP_MS = 150;
/** Hauteur de la seconde note, rapportée à la hauteur réglée. */
export const GPS_LOST_LOW_RATIO = 2 / 3;

/** Notes du son « GPS perdu », dans l'ordre : début et durée en millisecondes, hauteur rapportée à celle réglée. */
export const GPS_LOST_NOTES: ReadonlyArray<{ atMs: number; durationMs: number; ratio: number }> = [0, 1].flatMap((k) => {
  const at = k * (GPS_LOST_HIGH_MS + GPS_LOST_LOW_MS + GPS_LOST_GAP_MS);
  return [
    { atMs: at, durationMs: GPS_LOST_HIGH_MS, ratio: 1 },
    { atMs: at + GPS_LOST_HIGH_MS, durationMs: GPS_LOST_LOW_MS, ratio: GPS_LOST_LOW_RATIO },
  ];
});

/**
 * « FC perdue » (lot 177) : trois notes descendantes, une seule fois, la hauteur
 * réglée puis ses 5/6 et ses 2/3 ; à part du « GPS perdu », deux fois deux notes.
 */
export const BELT_LOST_NOTE_MS = 220;
/** Notes du son « FC perdue », dans l'ordre : début et durée en millisecondes, hauteur rapportée à celle réglée. */
export const BELT_LOST_NOTES: ReadonlyArray<{ atMs: number; durationMs: number; ratio: number }> = [1, 5 / 6, 2 / 3].map((ratio, k) => ({
  atMs: k * BELT_LOST_NOTE_MS, durationMs: BELT_LOST_NOTE_MS, ratio,
}));
/** Durée totale du son « FC perdue », en millisecondes. */
export const BELT_LOST_TOTAL_MS = 3 * BELT_LOST_NOTE_MS;

/** Durée totale du son « GPS perdu », en millisecondes. */
export const GPS_LOST_TOTAL_MS = 2 * (GPS_LOST_HIGH_MS + GPS_LOST_LOW_MS) + GPS_LOST_GAP_MS;
