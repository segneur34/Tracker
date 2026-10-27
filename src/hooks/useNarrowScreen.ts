import { useEffect, useState } from 'react';

/**
 * Disposition téléphone : moins de 768 px de large, ou un écran tactile de moins de 500 px de haut (téléphone
 * tourné, 834 × 375 pour celui de l'utilisateur) ; une fenêtre d'ordinateur basse reste un ordinateur (pointeur
 * fin). Recopiée telle quelle dans chaque `@media` de la rupture (`AppShell.css`, `pages/analysisMobile.css`…),
 * l'ordinateur prenant `WIDE_QUERY`, son contraire : `mediaQueries.test.ts` y veille.
 */
export const NARROW_QUERY = '(max-width: 767.98px), (max-height: 499.98px) and (pointer: coarse)';

/**
 * Disposition ordinateur : le contraire exact de `NARROW_QUERY` (un pointeur est `fine`, `coarse` ou `none` ; ce
 * dernier, téléviseur ou certaines WebView, compte comme un ordinateur), sans le `not` des requêtes de niveau 4.
 */
export const WIDE_QUERY = '(min-width: 768px) and (min-height: 500px), (min-width: 768px) and (pointer: fine), (min-width: 768px) and (pointer: none)';

/** Téléphone tourné : rail de navigation à gauche, carte sur un côté (lot 5 b des demandes du 23/10). */
export const PHONE_LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 499.98px) and (pointer: coarse)';

/** Vrai tant que la requête répond, suivi en direct quand l'écran change de taille ou tourne. */
function useMediaQuery(media: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(media).matches);

  useEffect(() => {
    const query = window.matchMedia(media);
    const onChange = () => setMatches(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [media]);

  return matches;
}

/** Vrai sur un écran de téléphone, droit ou tourné. */
export function useNarrowScreen(): boolean {
  return useMediaQuery(NARROW_QUERY);
}

/** Vrai sur un téléphone tourné. */
export function usePhoneLandscape(): boolean {
  return useMediaQuery(PHONE_LANDSCAPE_QUERY);
}
