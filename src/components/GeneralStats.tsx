import type { ShareStat } from '../core/shareImage';
import StatTile from './ui/StatTile';

/** Onglet qu'ouvre une tuile (lot 234) : son nom, lu par l'accessibilité, s'il est ouvert, et de quoi l'ouvrir ou le refermer. */
export interface TileLink {
  tabLabel: string;
  open: boolean;
  onToggle: () => void;
}

/** Nom du bouton d'une tuile reliée, lu par l'accessibilité : son chiffre, et ce que fera le toucher. */
const tileAriaLabel = (stat: ShareStat, link: TileLink): string =>
  `${stat.label} : ${stat.value}. ${link.open ? 'Fermer' : 'Ouvrir'} l'onglet ${link.tabLabel}`;

/**
 * Chiffres de l'onglet « général » d'une analyse. La même liste est proposée
 * pour l'image de partage (`ShareDialog`) : un chiffre ne s'écrit qu'une fois.
 * `pairs` : couples de clés voisines gardés côte à côte sur une même ligne
 * (un bloc de deux colonnes), quel que soit le nombre de tuiles avant eux.
 * `linkOf` : onglet qu'ouvre puis referme la tuile d'une clé (`tileTab`), `null` pour un simple bloc.
 */
function GeneralStats({ stats, pairs = [], linkOf }: {
  stats: ReadonlyArray<ShareStat>;
  pairs?: ReadonlyArray<readonly [string, string]>;
  linkOf?: (statKey: string) => TileLink | null;
}) {
  const tile = (stat: ShareStat) => {
    const link = linkOf?.(stat.key) ?? null;
    return (
      <StatTile key={stat.key} label={stat.label} value={stat.value} title={stat.title}
        onToggle={link?.onToggle} expanded={link?.open} ariaLabel={link ? tileAriaLabel(stat, link) : undefined} />
    );
  };
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
