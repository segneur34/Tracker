import { IconHelp } from '../icons';

interface HelpButtonProps {
  open: boolean;
  onToggle: () => void;
  /** Question que le bouton ouvre, lue par les lecteurs d'écran. */
  label: string;
  /** `s` à côté d'un titre de panneau. */
  size?: 's' | 'm';
}

/**
 * Bouton « ? » qui déplie une explication, fermée par défaut. La page garde
 * l'état et place le texte où elle veut, sous le bouton ou plus bas.
 */
function HelpButton({ open, onToggle, label, size = 'm' }: HelpButtonProps) {
  return (
    <button
      type="button"
      className={size === 's' ? 'ui-help ui-help--s' : 'ui-help'}
      aria-label={label}
      aria-expanded={open}
      onClick={onToggle}>
      <IconHelp size={size === 's' ? 18 : 20} />
    </button>
  );
}

export default HelpButton;
