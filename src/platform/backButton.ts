import { isNativeApp } from './runtime';

/** Renvoie à la page au-dessus ; faux s'il n'y en a pas (accueil). Posé par le cadre des pages, qui a le routeur. */
let backNavigator: (() => boolean) | null = null;

/** Pose la fonction qui renvoie à la page au-dessus ; la fonction rendue la retire. */
export const setBackNavigator = (fn: () => boolean): (() => void) => {
  backNavigator = fn;
  return () => {
    if (backNavigator === fn) backNavigator = null;
  };
};

/**
 * Touche retour d'Android, et geste du bord de l'écran : elle renvoie à la
 * page au-dessus (`core/parentPage.ts`), pas à la page vue juste avant. À
 * l'accueil, elle fermerait l'activité, donc la WebView : un enregistrement en
 * cours perdrait alors ses positions, même si le service GPS continue de
 * tourner. Tant que `keepAlive` répond vrai, l'application passe en
 * arrière-plan au lieu de se fermer. `canLeave` peut retenir l'utilisateur sur
 * la page (modifications non enregistrées). Sans effet dans le navigateur.
 */
export const installBackButton = async (keepAlive: () => boolean, canLeave: () => boolean = () => true): Promise<void> => {
  if (!isNativeApp()) return;
  const { App } = await import('@capacitor/app');
  await App.addListener('backButton', () => {
    if (!canLeave()) return;
    if (backNavigator?.()) return;
    if (keepAlive()) void App.minimizeApp();
    else void App.exitApp();
  });
};
