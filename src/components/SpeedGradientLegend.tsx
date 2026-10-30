import { SLOW_COLOR, gradientCss, type SpeedRangeMs } from '../core/speedGradient';
import { formatSpeedValue, speedUnitLabel, toDisplaySpeed, type DistanceUnit, type SpeedUnit } from '../core/units';
import './SpeedGradientLegend.css';

/**
 * Légende du dégradé de couleur de la trace, en une ligne compacte posée sur
 * la carte, à gauche de la mention OSM (`AnalysisMap`) : la pastille grise,
 * puis le dégradé entre ses deux bornes, dans l'unité. Ce que dit le gris
 * (`slowLabel`) passe dans le titre, lu au survol et par un lecteur d'écran.
 * En lecture seule : les bornes se règlent dans l'onglet réglages du module
 * (`SpeedRangeEditor`). Partagée par les modules : seuls l'unité, les bornes
 * et le libellé du gris changent.
 */

interface SpeedGradientLegendProps {
  /** Unité d'affichage des bornes. */
  unit: SpeedUnit;
  /** Unité de distance de l'activité : une allure se lit au kilomètre ou au mille (km par défaut). */
  distanceUnit?: DistanceUnit;
  /** Bornes en vigueur, en m/s. */
  range: SpeedRangeMs;
  /** Ce que représente le gris sous la borne basse : « marche », « sous le seuil »… */
  slowLabel: string;
}

function SpeedGradientLegend({ unit, distanceUnit = 'km', range, slowLabel }: SpeedGradientLegendProps) {
  const low = formatSpeedValue(toDisplaySpeed(range.minMs, unit, distanceUnit), unit);
  const high = formatSpeedValue(toDisplaySpeed(range.maxMs, unit, distanceUnit), unit);
  const label = speedUnitLabel(unit, distanceUnit);
  const description = `Couleur de la trace (gris : ${slowLabel}), du bleu au rouge de ${low} à ${high} ${label}`;

  return (
    <div className="speed-legend" role="img" title={description} aria-label={description}>
      <span className="speed-legend__slow" style={{ backgroundColor: SLOW_COLOR }} />
      <span className="num">{low}</span>
      <span className="speed-legend__bar" style={{ background: gradientCss() }} />
      <span className="num">{high} {label}</span>
    </div>
  );
}

export default SpeedGradientLegend;
