import { useEffect, useRef } from 'react';
import { pushBackLayer } from '../platform/backButton';

/**
 * Ferme une liste posée par-dessus la page : Échap ou le retour d'Android.
 * Posé une fois à l'ouverture (la page dessous peut se redessiner sans le
 * reposer) ; le dernier `onClose` est lu au moment de la fermeture.
 */
export function useCloseOnEscapeOrBack(onClose: () => void): void {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    const removeLayer = pushBackLayer(() => closeRef.current());
    return () => {
      window.removeEventListener('keydown', onKey);
      removeLayer();
    };
  }, []);
}

/** Ferme un menu ouvert en touchant hors de `root` ou par Échap. */
export function useCloseOnOutsideOrEscape(
  open: boolean,
  root: () => { contains(node: Node): boolean } | null,
  onClose: () => void,
): void {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root()?.contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    // Le retour d'Android ferme le menu avant de quitter la page (lot 158).
    const removeLayer = pushBackLayer(() => closeRef.current());
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
      removeLayer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `root` est recréé à chaque rendu ; seule l'ouverture compte
  }, [open]);
}
