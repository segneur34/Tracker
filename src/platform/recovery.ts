import { registerPlugin } from '@capacitor/core';
import { isNativeApp } from './runtime';

/**
 * Preuve qu'un service au premier plan a survécu à la page (lot 156) : seul passage vers
 * `android/…/RecoveryPlugin.java`, qui lit la liste des services de l'application. Un service vivant veut dire que
 * le processus aussi : ceux-ci ne sont pas relancés par Android après sa mort. Dans le navigateur, ou si la lecture
 * échoue, aucun : la reprise silencieuse n'a jamais lieu sur un doute.
 */

/** Services au premier plan vus vivants : GPS, et ceinture sans position (muscu). */
export interface RecoveryServices {
  gps: boolean;
  belt: boolean;
}

interface RecoveryPlugin {
  state(): Promise<RecoveryServices>;
}

const plugin = registerPlugin<RecoveryPlugin>('Recovery');

export const readRecoveryServices = async (): Promise<RecoveryServices> => {
  if (!isNativeApp()) return { gps: false, belt: false };
  try {
    const { gps, belt } = await plugin.state();
    return { gps: gps === true, belt: belt === true };
  } catch (err) {
    console.warn('Services de l\'enregistrement illisibles', err);
    return { gps: false, belt: false };
  }
};
