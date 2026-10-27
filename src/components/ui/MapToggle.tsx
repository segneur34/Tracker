import type { CSSProperties } from 'react';

interface MapToggleProps {
  /** Vrai quand l'élément est montré sur la carte : la pastille prend alors la couleur de l'analyse. */
  shown: boolean;
  onClick: () => void;
  /** Couleur de la pastille allumée (accent de l'analyse ou de la surbrillance). */
  color: string;
  disabled?: boolean;
  /** Libellés éteint puis allumé ; « Voir » et « Masquer » par défaut. */
  labels?: readonly [string, string];
  title?: string;
  /** Retouche d'une pastille qui s'écarte de la commune (marge, opacité). */
  style?: CSSProperties;
}

/**
 * Pastille « Voir sur la carte » d'une ligne de tableau ou d'un podium :
 * montre ou masque l'élément sur la carte de l'analyse (une seule surbrillance
 * à la fois, `useMapHighlight`). Le style reste en ligne, pour passer devant
 * les règles de boutons des tableaux du téléphone.
 */
function MapToggle({ shown, onClick, color, disabled, labels = ['Voir', 'Masquer'], title, style }: MapToggleProps) {
  return (
    <button
      type="button" disabled={disabled} title={title} onClick={onClick}
      style={{
        padding: '2px 8px', fontSize: 'var(--text-xs)', cursor: disabled ? 'default' : 'pointer',
        backgroundColor: shown ? color : 'var(--surface-sunken)', color: shown ? 'var(--on-accent)' : 'var(--ink)',
        border: '1px solid var(--line-strong)', borderRadius: '4px', ...style,
      }}>
      {shown ? labels[1] : labels[0]}
    </button>
  );
}

export default MapToggle;
