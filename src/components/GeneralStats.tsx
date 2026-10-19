import type { ShareStat } from '../core/shareImage';

/**
 * Chiffres de l'onglet « général » d'une analyse. La même liste est proposée
 * pour l'image de partage (`ShareDialog`) : un chiffre ne s'écrit qu'une fois.
 */
function GeneralStats({ stats }: { stats: ReadonlyArray<ShareStat> }) {
  return (
    <div className="an-sheet__stats an-sheet__stats--always">
      {stats.map((stat) => (
        <div key={stat.key} className="an-sheet__stat" title={stat.title}>
          <span className="an-sheet__stat-label">{stat.label}</span>
          <strong className="an-sheet__stat-value">{stat.value}</strong>
        </div>
      ))}
    </div>
  );
}

export default GeneralStats;
