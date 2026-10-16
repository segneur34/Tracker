import { IconHelp } from '../icons';

interface HelpButtonProps {
  open: boolean;
  onToggle: () => void;
  /** Question que le bouton ouvre, lue par les lecteurs d'écran. */
  label: string;
  /** `s` à côté d'un titre de panneau, `xs` dans le libellé d'un chiffre. */
  size?: 'xs' | 's' | 'm';
}

/**
 * Bouton « ? » qui déplie une explication, fermée par défaut. La page garde
 * l'état et place le texte où elle veut, sous le bouton ou plus bas.
 */
function HelpButton({ open, onToggle, label, size = 'm' }: HelpButtonProps) {
  return (
    <button
      type="button"
      className={size === 'm' ? 'ui-help' : `ui-help ui-help--${size}`}
      aria-label={label}
      aria-expanded={open}
      onClick={onToggle}>
      <IconHelp size={size === 'xs' ? 14 : size === 's' ? 18 : 20} />
    </button>
  );
}

export default HelpButton;
