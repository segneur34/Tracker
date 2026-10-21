import type { ReactNode } from 'react';
import PanelTitle from './PanelTitle';
import ResizablePanel from './ResizablePanel';
import { CARD_STYLE, HALF_PANEL_STYLE } from './styles';

/**
 * Onglet ouvert qui n'a rien à montrer pour cette session : son titre, qui le
 * replie, et une ligne qui dit pourquoi, avec au besoin de quoi y remédier
 * (manœuvres sans vent, zones de pente sans altitude ; demande du 19/10).
 * L'onglet reste dans la barre : il se remplit quand la donnée arrive. L'`id`
 * est propre à cet état, pour ne pas toucher la taille retenue du vrai panneau.
 */
function EmptyTabPanel({ id, label, open, onToggle, children, action }: {
  id: string;
  label: ReactNode;
  open: boolean;
  onToggle: () => void;
  /** Pourquoi l'onglet est vide. */
  children: ReactNode;
  /** Bouton qui y remédie (saisir le vent, réessayer). */
  action?: ReactNode;
}) {
  return (
    <ResizablePanel id={id} direction="vertical" style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE }}>
      <div style={{ marginBottom: 'var(--space-2)' }}>
        <PanelTitle label={label} open={open} onToggle={onToggle} />
      </div>
      <div className="empty-tab__text" style={{ color: 'var(--muted)', fontSize: 'var(--text-s)' }}>{children}</div>
      {action && <div style={{ marginTop: 'var(--space-2)' }}>{action}</div>}
    </ResizablePanel>
  );
}

export default EmptyTabPanel;
