import { useRef, useState, type ReactNode } from 'react';
import { useCloseOnOutsideOrEscape } from '../../hooks/useDismiss';
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

  useCloseOnOutsideOrEscape(open, () => rootRef.current, () => setOpen(false));

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
