import { isNativeApp } from './runtime';

/**
 * Touche retour d'Android. Par défaut, à la racine de l'historique, elle
 * ferme l'activité, donc la WebView : un enregistrement en cours perdrait
 * alors ses positions, même si le service GPS continue de tourner. Tant que
 * `keepAlive` répond vrai, l'application passe en arrière-plan au lieu de se
 * fermer. Sans effet dans le navigateur.
 */
export const installBackButton = async (keepAlive: () => boolean): Promise<void> => {
  if (!isNativeApp()) return;
  const { App } = await import('@capacitor/app');
  await App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else if (keepAlive()) void App.minimizeApp();
    else void App.exitApp();
  });
};
