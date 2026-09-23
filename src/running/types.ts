import type { BaseSessionStats } from '../core/types';

/**
 * Statistiques d'une session de course à pied.
 *
 * Pour l'instant strictement la base générique. Point d'extension prévu pour
 * les métriques propres à la course : allure moyenne, splits kilométriques,
 * dénivelé positif et négatif, temps de pause.
 */
export type RunningSessionStats = BaseSessionStats;
