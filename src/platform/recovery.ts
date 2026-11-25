import { registerPlugin } from '@capacitor/core';
import { deviceLocationState } from './location';
import { isNativeApp } from './runtime';

/**
 * Preuve qu'un service de l'enregistrement a survécu à la page (lot 156, lot 232 étape 2) : la page rechargée après
 * une chute du moteur de rendu, ou rouverte après avoir été balayée, sait ainsi s'il faut reprendre seule.
 *
 * - `gps` : notre service de position (`RecordingService.java`) le dit lui-même (`Recording.state()`, par
 *   `platform/location.ts`) : il tourne, pour la session du journal relu. Android ne le relance jamais seul : le
 *   voir en route veut dire qu'il n'a pas cessé de recevoir et d'écrire ses positions. Celui d'une autre session ne
 *   prouve rien.
 * - `belt` : le service de la ceinture sans position (muscu, FC de nuit, `HeartRateService.java`), lu dans la liste
 *   des services de l'application (`RecoveryPlugin.java`).
 *
 * Dans le navigateur, ou si la lecture échoue, aucun : la reprise silencieuse n'a jamais lieu sur un doute.
 */

/** Services au premier plan vus vivants : position (pour la session du journal), et ceinture sans position (muscu). */
export interface RecoveryServices {
  gps: boolean;
  belt: boolean;
}

interface RecoveryPlugin {
  state(): Promise<{ belt?: boolean }>;
}

const plugin = registerPlugin<RecoveryPlugin>('Recovery');

/**
 * Services vivants. `session` : l'identifiant de la session du journal relu (le `startedAtMs` de son en-tête) ; le
 * service de position ne compte que s'il l'enregistre. `null` (pas de journal) : tout service de position en route
 * compte, pour être arrêté.
 */
export const readRecoveryServices = async (session: number | null): Promise<RecoveryServices> => {
  if (!isNativeApp()) return { gps: false, belt: false };
  const [gps, belt] = await Promise.all([
    deviceLocationState().then(
      (s) => s.running && (session === null || s.session === session),
      (err: unknown) => {
        console.warn('État du service de position illisible', err);
        return false;
      }
    ),
    plugin.state().then(
      (s) => s.belt === true,
      (err: unknown) => {
        console.warn('Service de la ceinture illisible', err);
        return false;
      }
    ),
  ]);
  return { gps, belt };
};
