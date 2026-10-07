import { SLOW_COLOR, gradientCss } from '../core/speedGradient';
import type { GradeRange } from '../running/runningAnalytics';
import './SpeedGradientLegend.css';

/**
 * Légende de la trace colorée par la pente (« Voir sur la carte » sous le
 * graphe d'altitude), posée sur la carte comme celle de la vitesse
 * (`SpeedGradientLegend`), dont elle reprend le gabarit : la pastille grise si
 * la borne basse est au-dessus de zéro, puis le dégradé de la raideur, montée
 * ou descente confondues. Les bornes se règlent par activité dans Réglages.
 */
function GradeGradientLegend({ range }: { range: GradeRange }) {
  const low = Math.round(range.min * 100);
  const high = Math.round(range.max * 100);
  const description = `Couleur de la trace selon la pente, montée ou descente${low > 0 ? ` (gris : sous ${low} %)` : ''}, du bleu au rouge de ${low} à ${high} % et plus`;

  return (
    <div className="speed-legend" role="img" title={description} aria-label={description}>
      {low > 0 && <span className="speed-legend__slow" style={{ backgroundColor: SLOW_COLOR }} />}
      <span className="num">{low}</span>
      <span className="speed-legend__bar" style={{ background: gradientCss() }} />
      <span className="num">{high} % pente</span>
    </div>
  );
}

export default GradeGradientLegend;
