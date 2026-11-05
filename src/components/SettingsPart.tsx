import type { ReactNode } from 'react';
import { IconChevronRight } from './icons';

/**
 * Partie repliable de Réglages (partie d'une carte d'activité, licences d'« À propos ») : une ligne titre, un filet au
 * dessus, ses lignes dessous une fois ouverte. L'état est tenu par l'appelant.
 */
function SettingsPart({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="settings-part">
      <button type="button" className="settings-part__toggle" aria-expanded={open} onClick={onToggle}>
        <IconChevronRight size={14} className="settings-activity__chevron" style={{ transform: open ? 'rotate(90deg)' : undefined }} />
        {label}
      </button>
      {open && <div className="settings-part__body">{children}</div>}
    </div>
  );
}

export default SettingsPart;
