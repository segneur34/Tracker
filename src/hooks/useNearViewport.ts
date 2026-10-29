import { useEffect, useState, type RefObject } from 'react';

/**
 * Vrai dès que `frame` approche de l'écran (à `margin` près), et le reste :
 * pour ne charger qu'une fois une vignette de liste. `ready` : déjà prête
 * (en cache), rien à attendre ; sans `IntersectionObserver`, tout de suite.
 */
export const useNearViewport = (frame: RefObject<Element | null>, ready: boolean, margin: string): boolean => {
  const [near, setNear] = useState(() => ready || typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = frame.current;
    if (!el || near) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setNear(true);
    }, { rootMargin: margin });
    observer.observe(el);
    return () => observer.disconnect();
  }, [frame, near, margin]);
  return near;
};
