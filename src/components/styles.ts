/** Styles en ligne partagés entre les pages, sur les variables de `theme/tokens.css`. */

/** Bloc blanc arrondi qui encadre chaque section d'un module, comme `Card`. */
export const CARD_STYLE = {
  padding: '15px',
  backgroundColor: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-l)',
} as const;
