import './SurfaceBar.css';
import { formatShortDistance, type DistanceUnit } from '../core/units';
import { SURFACE_LABEL, type SurfaceCategory, type SurfaceTotal } from '../planning/surface';

/**
 * Couleur de chaque revêtement (donnée de graphe, donc en dur) : tons sourds,
 * proches de ceux de Komoot.
 */
const SURFACE_COLOR: Record<SurfaceCategory, string> = {
  asphalte: '#5b6270',
  pierresPlates: '#c4c7cc',
  paves: '#8f8a84',
  gravillon: '#d9c7a3',
  nonPave: '#a07850',
  terre: '#7b5534',
  herbe: '#9dbf7a',
  sable: '#e6d38f',
  alpin: '#7f9f86',
  autre: '#a99bb8',
  inconnu: '#dedbd5',
};

/**
 * Revêtement d'un itinéraire ou d'une session : une barre en segments
 * arrondis, chaque catégorie de largeur proportionnelle à sa longueur, puis
 * une ligne par catégorie, de la plus longue à la plus courte
 * (`summarizeSurfaces`). Distances en mètres sous 1 km, sinon dans l'unité de
 * l'activité.
 */
function SurfaceBar({ totals, distanceUnit }: { totals: SurfaceTotal[]; distanceUnit: DistanceUnit }) {
  const describe = (t: SurfaceTotal) => `${SURFACE_LABEL[t.category]} ${formatShortDistance(t.distanceM, distanceUnit)}`;
  return (
    <div className="surface-bar">
      <div className="surface-bar__track" role="img" aria-label={`Revêtement : ${totals.map(describe).join(', ')}`}>
        {totals.map((t) => (
          <span key={t.category} className="surface-bar__part" title={describe(t)}
            style={{ flexGrow: t.distanceM, backgroundColor: SURFACE_COLOR[t.category] }} />
        ))}
      </div>
      <ul className="surface-bar__list">
        {totals.map((t) => (
          <li key={t.category} className="surface-bar__row">
            <span className="surface-bar__swatch" style={{ backgroundColor: SURFACE_COLOR[t.category] }} />
            <strong className="surface-bar__name">{SURFACE_LABEL[t.category]}</strong>
            <span className="surface-bar__distance num">{formatShortDistance(t.distanceM, distanceUnit)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default SurfaceBar;
