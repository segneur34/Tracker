import { isNativeApp } from './runtime';

/** Renvoie à la page au-dessus ; faux s'il n'y en a pas (accueil). Posé par le cadre des pages, qui a le routeur. */
let backNavigator: (() => boolean) | null = null;

/** Vues posées par-dessus la page (carte en plein écran…), la dernière ouverte en fin : le retour les ferme d'abord. */
const backLayers: Array<() => void> = [];

/** Pose la fonction qui renvoie à la page au-dessus ; la fonction rendue la retire. */
export const setBackNavigator = (fn: () => boolean): (() => void) => {
  backNavigator = fn;
  return () => {
    if (backNavigator === fn) backNavigator = null;
  };
};

/**
 * Pose une vue par-dessus la page, que le retour referme par `close` au lieu
 * de quitter la page ; la fonction rendue la retire (vue fermée autrement).
 */
export const pushBackLayer = (close: () => void): (() => void) => {
  const layer = () => close();
  backLayers.push(layer);
  return () => {
    const at = backLayers.lastIndexOf(layer);
    if (at >= 0) backLayers.splice(at, 1);
  };
};

/** Ce qu'a fait un retour : vue fermée, page retenue (brouillon), page au-dessus, ou rien (accueil). */
export type BackOutcome = 'layer' | 'held' | 'page' | 'none';

/**
 * Un retour : la vue du dessus se ferme d'abord, sans demander pour le
 * brouillon (on reste sur la page) ; sinon `canLeave` peut retenir sur la
 * page, puis on remonte à la page au-dessus.
 */
export const dispatchBack = (canLeave: () => boolean = () => true): BackOutcome => {
  const layer = backLayers.pop();
  if (layer) {
    layer();
    return 'layer';
  }
  if (!canLeave()) return 'held';
  return backNavigator?.() ? 'page' : 'none';
};

/**
 * Touche retour d'Android, et geste du bord de l'écran : elle ferme la vue
 * posée par-dessus la page (`pushBackLayer`), sinon renvoie à la page
 * au-dessus (`core/parentPage.ts`), pas à la page vue juste avant. À
 * l'accueil, elle fermerait l'activité, donc la WebView : un enregistrement en
 * cours perdrait alors ses positions, même si le service GPS continue de
 * tourner. Tant que `keepAlive` répond vrai, l'application passe en
 * arrière-plan au lieu de se fermer. `canLeave` peut retenir l'utilisateur sur
 * la page (modifications non enregistrées). Dans le navigateur, en
 * développement, `window.trackerBack()` fait le même retour (banc).
 */
export const installBackButton = async (keepAlive: () => boolean, canLeave: () => boolean = () => true): Promise<void> => {
  if (!isNativeApp()) {
    if (import.meta.env.DEV) (window as Window & { trackerBack?: () => BackOutcome }).trackerBack = () => dispatchBack(canLeave);
    return;
  }
  const { App } = await import('@capacitor/app');
  await App.addListener('backButton', () => {
    if (dispatchBack(canLeave) !== 'none') return;
    if (keepAlive()) void App.minimizeApp();
    else void App.exitApp();
  });
};
