import type { ShareStat } from '../core/shareImage';
import StatTile from './ui/StatTile';

/**
 * Chiffres de l'onglet « général » d'une analyse. La même liste est proposée
 * pour l'image de partage (`ShareDialog`) : un chiffre ne s'écrit qu'une fois.
 * `pairs` : couples de clés voisines gardés côte à côte sur une même ligne
 * (un bloc de deux colonnes), quel que soit le nombre de tuiles avant eux.
 */
function GeneralStats({ stats, pairs = [] }: { stats: ReadonlyArray<ShareStat>; pairs?: ReadonlyArray<readonly [string, string]> }) {
  const tile = (stat: ShareStat) => (
    <StatTile key={stat.key} label={stat.label} value={stat.value} title={stat.title} />
  );
  return (
    <div className="an-sheet__stats an-sheet__stats--always">
      {stats.map((stat, i) => {
        const next = stats[i + 1];
        if (next && pairs.some(([a, b]) => a === stat.key && b === next.key)) {
          return (
            <div key={stat.key} className="an-sheet__stat-pair">
              {tile(stat)}
              {tile(next)}
            </div>
          );
        }
        if (i > 0 && pairs.some(([a, b]) => a === stats[i - 1].key && b === stat.key)) return null;
        return tile(stat);
      })}
    </div>
  );
}

export default GeneralStats;
