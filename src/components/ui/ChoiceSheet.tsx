import type { ReactNode, Ref } from 'react';
import { createPortal } from 'react-dom';
import { useCloseOnEscapeOrBack } from '../../hooks/useDismiss';
import '../ActivitySelect.css';

interface ChoiceSheetProps {
  /** Nom de la liste lu par les lecteurs d'écran. */
  label: string;
  /** Classe en plus de `activity-select__sheet` (le matériel y ajoute la sienne). */
  className?: string;
  testId?: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Liste de choix dessinée par l'application, par-dessus la page (jamais le menu
 * natif d'Android) : un appui à côté, Échap ou le retour d'Android la ferme.
 * Partagée par le choix d'une activité (`ActivitySelect`) et d'une pièce de
 * matériel (`GearPicker`), qui gardent chacun leur contenu.
 */
export function ChoiceSheet({ label, className, testId, onClose, children }: ChoiceSheetProps) {
  useCloseOnEscapeOrBack(onClose);
  return createPortal(
    <div className="ui-modal-backdrop" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className={className ? `activity-select__sheet ${className}` : 'activity-select__sheet'} role="listbox" aria-label={label}
        data-testid={testId} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body
  );
}

interface ChoiceOptionProps {
  label: string;
  selected: boolean;
  onClick: () => void;
  /** Pastille posée avant le nom (l'icône d'une activité). */
  icon?: ReactNode;
  buttonRef?: Ref<HTMLButtonElement>;
}

/** Une ligne de la liste : nom, et rond coché si choisie. */
export function ChoiceOption({ label, selected, onClick, icon, buttonRef }: ChoiceOptionProps) {
  return (
    <button ref={buttonRef} type="button" role="option" aria-selected={selected} className="activity-select__option" onClick={onClick}>
      {icon}
      <span className="activity-select__option-name">{label}</span>
      <span className="activity-select__radio" aria-hidden="true" />
    </button>
  );
}

