import { SLOW_COLOR, gradientCss } from '../core/speedGradient';
import Button from './ui/Button';
import Swatch from './ui/Swatch';

/**
 * Légende de la pente sous un profil d'altitude : l'échelle de couleur (gris
 * sous la borne basse, dégradé jusqu'à la borne haute) et « Voir sur la carte »,
 * qui colore la trace par la pente. `label` dit ce que le profil montre.
 */
export default function GradeLegendRow({ label, gradeRange, onMap, onToggleMap }: {
  label: string;
  /** Bornes de la pente, en fraction (0,05 pour 5 %). */
  gradeRange: { min: number; max: number };
  onMap: boolean;
  onToggleMap: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', color: 'var(--muted)', fontSize: 'var(--text-xs)', marginTop: '6px', flexShrink: 0 }}>
      <span>{label}</span>
      {gradeRange.min > 0 && (
        <>
          <Swatch color={SLOW_COLOR} />
          <span>sous {Math.round(gradeRange.min * 100)} %,</span>
        </>
      )}
      <span>{Math.round(gradeRange.min * 100)} %</span>
      <span style={{ display: 'inline-block', width: '90px', height: '10px', borderRadius: '2px', background: gradientCss() }} />
      <span>{Math.round(gradeRange.max * 100)} % et plus</span>
      <Button size="s" aria-pressed={onMap} onClick={onToggleMap} style={{ marginLeft: 'auto' }}>
        {onMap ? 'Masquer de la carte' : 'Voir sur la carte'}
      </Button>
    </div>
  );
}
