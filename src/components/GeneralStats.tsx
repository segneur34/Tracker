import type { ShareStat } from '../core/shareImage';
import StatTile from './ui/StatTile';

/**
 * Chiffres de l'onglet « général » d'une analyse. La même liste est proposée
 * pour l'image de partage (`ShareDialog`) : un chiffre ne s'écrit qu'une fois.
 */
function GeneralStats({ stats }: { stats: ReadonlyArray<ShareStat> }) {
  return (
    <div className="an-sheet__stats an-sheet__stats--always">
      {stats.map((stat) => (
        <StatTile key={stat.key} label={stat.label} value={stat.value} title={stat.title} />
      ))}
    </div>
  );
}

export default GeneralStats;
