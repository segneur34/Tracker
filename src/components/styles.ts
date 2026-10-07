/** Styles en ligne partagés entre les pages, sur les variables de `theme/tokens.css`. */

/** Bloc blanc arrondi qui encadre chaque section d'un module, comme `Card`. */
export const CARD_STYLE = {
  padding: '15px',
  backgroundColor: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-l)',
} as const;

/**
 * Place d'un panneau d'onglet dans une page d'analyse, sur ordinateur : deux
 * par ligne (`.an-carte-panels`, 20 px entre deux), un seul quand la moitié
 * de la ligne n'atteint plus 420 px. Sur téléphone, `ResizablePanel` le met
 * en pleine largeur.
 */
export const HALF_PANEL_STYLE = {
  flex: '1 1 calc(50% - 10px)',
  minWidth: 'min(100%, 420px)',
  // Marge intérieure comprise dans la demi-ligne, pour un simple bloc comme pour un `ResizablePanel`.
  boxSizing: 'border-box',
} as const;
