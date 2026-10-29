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

/** Bloc blanc d'un panneau d'analyse à sa place dans la page : `CARD_STYLE` et `HALF_PANEL_STYLE`. */
export const PANEL_BLOCK_STYLE = { ...CARD_STYLE, ...HALF_PANEL_STYLE } as const;

/** Panneau d'analyse, texte en petit : le style de la plupart des `ResizablePanel` des onglets. */
export const ANALYSIS_PANEL_STYLE = { ...PANEL_BLOCK_STYLE, fontSize: 'var(--text-s)' } as const;

/** Panneau d'analyse qui range ses blocs en ligne (matériel et notes) : le style de l'onglet « matos et notes ». */
export const NOTES_PANEL_STYLE = { ...PANEL_BLOCK_STYLE, display: 'flex', gap: '24px', flexWrap: 'wrap' } as const;
