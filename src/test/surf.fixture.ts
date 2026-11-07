import type { RawTrackPoint } from '../core/types';
import { phasesTrack } from './track.fixture';

/** Fichier de test seulement : le code de l'application ne l'importe pas. */

/** Départ des sessions de surf d'essai. */
export const SURF_T0 = Date.parse('2026-09-20T10:00:00Z');

/**
 * Session de surf par phases (`[durée en s, vitesse en m/s]`), vers l'est, `hz` points par seconde,
 * comme `library/summary.test.ts` la bâtit : une rame lente, une prise de vague, la glisse, le retour.
 */
export const surfRaw = (phases: [number, number][], hz = 1): RawTrackPoint[] => phasesTrack(phases, hz, { startMs: SURF_T0 });

/** Deux vagues sans foil, à 5 et 4 m/s, entre des rames et des retours. */
export const SURF_TWO_WAVES: [number, number][] = [[60, 0.2], [6, 1.6], [12, 5], [80, 1], [60, 0.2], [6, 1.6], [12, 4], [80, 1], [60, 0.2]];

/** Sur foil : deux vols à 6 m/s reliés par une glisse à 3,8 m/s. */
export const SURF_FOIL_FLIGHTS: [number, number][] = [[60, 0.2], [6, 1.6], [10, 6], [20, 3.8], [10, 6], [60, 1], [60, 0.1]];
