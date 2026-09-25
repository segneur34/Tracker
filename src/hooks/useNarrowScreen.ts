import { useEffect, useState } from 'react';

/**
 * Largeur sous laquelle l'application passe en disposition téléphone : la même rupture que la barre
 * de navigation (`AppShell.css`) et que `pages/analysisMobile.css`.
 */
export const NARROW_QUERY = '(max-width: 767.98px)';

/** Vrai sur un écran étroit (téléphone), suivi en direct quand la fenêtre change de largeur. */
export function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return narrow;
}
