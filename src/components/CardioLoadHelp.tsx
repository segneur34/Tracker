import { zoneLabel } from './heartRateColors';

interface Props {
  /** Bornes basses des zones 1 à 5, en bpm (`HeartRateZones.bounds`). */
  bounds: readonly number[];
  /** Coefficients de « sous Z1 » à Z5 (`HeartRateProfile.loadWeights`). */
  weights: readonly number[];
  /** Statistiques : la charge est la somme des sessions de la période. */
  period?: boolean;
}

const coefficient = (w: number | undefined) => String(w ?? 0).replace('.', ',');

/**
 * Explication de la charge cardiaque, dépliée par le « ? » de sa case :
 * onglet « cardio » d'une session et des statistiques.
 */
function CardioLoadHelp({ bounds, weights, period = false }: Props) {
  const range = (zone: number) =>
    zone === 0 ? `moins de ${bounds[0]} bpm`
      : zone === bounds.length ? `${bounds[zone - 1]} bpm et plus`
        : `${bounds[zone - 1]} à ${bounds[zone] - 1} bpm`;
  return (
    <div style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)', lineHeight: 1.45, margin: '8px 0 4px' }}>
      La charge résume en un chiffre l'effort cardiaque {period ? 'de la période' : 'de la sortie'}, sa durée et son
      intensité ensemble : chaque minute compte, d'autant plus que la FC est haute (méthode d'Edwards, temps sous Z1
      compris). Minutes{' '}
      {Array.from({ length: bounds.length + 1 }, (_, zone) => `${zoneLabel(zone)} (${range(zone)}) × ${coefficient(weights[zone])}`).join(' ; ')}.
      {' '}Ainsi 1 h en Z2 donne {Math.round(60 * (weights[2] ?? 0))} ; 30 min en Z4, {Math.round(30 * (weights[4] ?? 0))}.
      {period && ' Ici, somme des sessions de la période ; « Charge par semaine » la divise par le nombre de semaines.'}
    </div>
  );
}

export default CardioLoadHelp;
