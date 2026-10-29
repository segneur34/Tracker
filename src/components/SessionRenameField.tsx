import type { CSSProperties } from 'react';
import Button from './ui/Button';

/**
 * Saisie du nom d'une session : le champ (Entrée valide, Échap annule) et ses
 * boutons « Valider » et « Annuler ». Le même dans la bibliothèque et dans
 * l'en-tête d'une analyse (`SessionNameEditor`), qui posent le texte en cours
 * et ce qu'il advient de la validation.
 */
export default function SessionRenameField({ value, onChange, onSave, onCancel, className = 'ui-field ui-field--s', style }: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  /** Classe du champ ; celle d'un petit champ par défaut. */
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <>
      <input
        className={className}
        value={value}
        autoFocus
        maxLength={80}
        placeholder="Nom de la session"
        aria-label="Nom de la session"
        style={style}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave();
          else if (e.key === 'Escape') onCancel();
        }} />
      <Button size="s" onClick={onSave}>Valider</Button>
      <Button size="s" variant="ghost" onClick={onCancel}>Annuler</Button>
    </>
  );
}
