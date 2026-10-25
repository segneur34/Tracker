import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './Dialog.css';

/**
 * Fenêtre modale au milieu de l'écran, au-dessus des barres et du menu « … » :
 * un titre, ×, et son contenu. Le fond, × et Échap la ferment. `className`
 * s'ajoute à la fenêtre pour ce qui lui est propre (partage, profil).
 */
function Dialog({ title, onClose, className, children }: {
  title: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return createPortal(
    <div className="ui-dialog__backdrop" onClick={onClose}>
      <div className={className ? `ui-dialog ${className}` : 'ui-dialog'} role="dialog" aria-modal="true" aria-label={title}
        onClick={(e) => e.stopPropagation()}>
        <div className="ui-dialog__head">
          <strong>{title}</strong>
          <button type="button" className="ui-dialog__close" onClick={onClose} aria-label="Fermer">×</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

export default Dialog;
