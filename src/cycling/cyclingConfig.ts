import { kmhToMs } from '../core/units';
import type { SpeedRangeMs } from '../core/speedGradient';
import type { GradeRange } from '../running/runningAnalytics';

/**
 * Valeurs d'affichage propres au vélo, surchargeables par activité dans
 * Réglages et par trace dans son analyse, comme en course.
 */

/** Bornes du dégradé de couleur de la trace, en m/s : 10 km/h, l'allure de balade, et 40 km/h. */
export const DEFAULT_CYCLING_SPEED_RANGE_MS: SpeedRangeMs = { minMs: kmhToMs(10), maxMs: kmhToMs(40) };

/** Bornes de la couleur de pente : à vélo, 15 % est déjà un mur. */
export const DEFAULT_CYCLING_GRADE_RANGE: GradeRange = { min: 0, max: 0.15 };
