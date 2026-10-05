import './SurfaceBar.css';
import { formatShortDistance, type DistanceUnit } from '../core/units';
import { SURFACE_COLOR, SURFACE_LABEL, type SurfaceTotal } from '../planning/surface';
import Button from './ui/Button';

interface SurfaceBarProps {
  totals: SurfaceTotal[];
  distanceUnit: DistanceUnit;
  /** Tracé coloré par revêtement sur la carte (`SurfaceLayer`). */
  shownOnMap?: boolean;
  /** Bouton « Voir sur la carte », s'il est donné. */
  onToggleMap?: () => void;
}

/**
 * Revêtement d'un itinéraire ou d'une session : une barre en segments
 * arrondis, chaque catégorie de largeur proportionnelle à sa longueur, puis
 * une ligne par catégorie, de la plus longue à la plus courte
 * (`summarizeSurfaces`). Distances en mètres sous 1 km, sinon dans l'unité de
 * l'activité. « Voir sur la carte » colore le tracé selon le revêtement, aux
 * couleurs de la barre.
 */
function SurfaceBar({ totals, distanceUnit, shownOnMap = false, onToggleMap }: SurfaceBarProps) {
  const describe = (t: SurfaceTotal) => `${SURFACE_LABEL[t.category]} ${formatShortDistance(t.distanceM, distanceUnit)}`;
  return (
    <div className="surface-bar">
      {onToggleMap && (
        <div className="surface-bar__actions">
          <Button size="s" aria-pressed={shownOnMap} onClick={onToggleMap}>
            {shownOnMap ? 'Masquer de la carte' : 'Voir sur la carte'}
          </Button>
        </div>
      )}
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
