import { kmhToMs } from '../core/units';
import type { SpeedRangeMs } from '../core/speedGradient';

/**
 * Bornes de couleur de la trace en surf, à défaut de réglage : 5 à 30 km/h.
 * La rame, sous 5 km/h, reste grise ; la vague ressort en couleur.
 */
export const DEFAULT_SURF_SPEED_RANGE_MS: SpeedRangeMs = { minMs: kmhToMs(5), maxMs: kmhToMs(30) };
