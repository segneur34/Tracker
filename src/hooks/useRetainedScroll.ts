import { useEffect, useLayoutEffect, useRef } from 'react';

/** Position de défilement retenue par clé, le temps de l'ouverture de l'application. */
const positions = new Map<string, number>();

/**
 * Défilement d'une liste retenu entre deux visites (lot 158) : la bibliothèque
 * d'une famille se rouvre là où on l'a laissée en revenant d'une analyse.
 * La position est rendue une fois, quand `ready` devient vrai (la liste est
 * dessinée), puis suivie jusqu'à la sortie de la page. `key` : une clé par
 * famille.
 */
export const useRetainedScroll = (key: string, ready: boolean): void => {
  const restoredKey = useRef<string | null>(null);
  const mounted = useRef(true);

  // Vrai tant que la page est là : le défilement ramené par le démontage du DOM n'est pas une position à retenir.
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || restoredKey.current === key) return;
    restoredKey.current = key;
    window.scrollTo(0, positions.get(key) ?? 0);
  }, [key, ready]);

  useEffect(() => {
    const onScroll = () => {
      if (mounted.current && restoredKey.current === key) positions.set(key, window.scrollY);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [key]);
};

/** Ouvre la page en haut (une analyse ouverte depuis le bas d'une liste ne démarre pas au milieu). */
export const useScrollToTopOnMount = (): void => {
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);
};
