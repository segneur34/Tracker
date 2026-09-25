import { SLOW_COLOR, gradientCss, type SpeedRangeMs } from '../core/speedGradient';
import { SPEED_UNIT_LABEL, formatSpeedValue, toDisplaySpeed, type SpeedUnit } from '../core/units';

/**
 * Légende du dégradé de couleur de la trace, sous la carte : bornes et
 * graduations en lecture seule. Elles se règlent dans l'onglet Réglages du
 * module (`SpeedRangeEditor`). Partagée par les modules course et voile :
 * seuls l'unité d'affichage, les bornes et le libellé de la couleur « lente »
 * changent.
 */

interface SpeedGradientLegendProps {
  /** Unité d'affichage des graduations. */
  unit: SpeedUnit;
  /** Bornes en vigueur, en m/s. */
  range: SpeedRangeMs;
  /** Ce que représente le gris sous la borne basse : « marche », « sous le seuil »… */
  slowLabel: string;
}

function SpeedGradientLegend({ unit, range, slowLabel }: SpeedGradientLegendProps) {
  /** Graduations : cinq repères entre les deux bornes, dans l'unité. */
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const ms = range.minMs + t * (range.maxMs - range.minMs);
    return formatSpeedValue(toDisplaySpeed(ms, unit), unit);
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', fontSize: 'var(--text-xs)', color: 'var(--ink-2)', marginTop: '8px' }}>
      <strong style={{ color: 'var(--ink)' }}>Couleur de la trace ({SPEED_UNIT_LABEL[unit]})</strong>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ display: 'inline-block', width: '22px', height: '12px', backgroundColor: SLOW_COLOR, borderRadius: '3px' }} />
        {slowLabel}
      </span>
      <span style={{ display: 'inline-flex', flexDirection: 'column', minWidth: '260px' }}>
        <span style={{ display: 'block', height: '12px', borderRadius: '3px', background: gradientCss() }} />
        <span className="num" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)' }}>
          {ticks.map((tick, i) => <span key={i}>{tick}</span>)}
        </span>
      </span>
    </div>
  );
}

export default SpeedGradientLegend;
