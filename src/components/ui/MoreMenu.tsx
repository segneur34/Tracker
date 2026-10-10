import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconMore } from '../icons';

interface MoreMenuProps {
  /** Ce que le menu propose, lu par les lecteurs d'écran (« Plus d'actions sur la session »). */
  label: string;
  /** Entrées : des `Button`, ou des `label` porteurs d'un sélecteur de fichiers. */
  children: ReactNode;
}

/**
 * Bouton « … » qui déplie, sous lui et aligné à droite, les actions de moindre
 * usage d'un écran. Il se referme après un choix, en touchant ailleurs ou par
 * Échap.
 *
 * Le panneau reste monté, seulement caché : un sélecteur de fichiers posé
 * dedans (`ImportButtons`) doit survivre à la fermeture pour recevoir les
 * fichiers choisis. Tout est en `span`, pour se loger dans un sous-titre
 * (`PageHeader`, un `p`).
 */
function MoreMenu({ label, children }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="ui-more" ref={rootRef}>
      <button
        type="button"
        className="ui-more__button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}>
        <IconMore />
      </button>
      <span
        className="ui-more__panel"
        role="menu"
        hidden={!open}
        onClick={(e) => {
          // Fermé au tour suivant : un `label` doit d'abord ouvrir son sélecteur de fichiers.
          if ((e.target as HTMLElement).closest('button, label')) setTimeout(() => setOpen(false), 0);
        }}>
        {children}
      </span>
    </span>
  );
}

export default MoreMenu;
