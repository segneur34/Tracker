import { useState } from 'react';
import './SurfaceBar.css';
import { formatShortDistance, type DistanceUnit } from '../core/units';
import { SURFACE_COLOR, SURFACE_LABEL, type SurfaceCategory, type SurfaceTotal } from '../planning/surface';
import Button from './ui/Button';

interface SurfaceBarProps {
  totals: SurfaceTotal[];
  distanceUnit: DistanceUnit;
  /** Tracé coloré par revêtement sur la carte (`SurfaceLayer`). */
  shownOnMap?: boolean;
  /** Bouton « Voir sur la carte », s'il est donné. */
  onToggleMap?: () => void;
  /** Revêtement en surbrillance sur la carte (`SurfaceHighlight`), `null` sans. */
  selected: SurfaceCategory | null;
  /** Un toucher sur une part ou une ligne choisit son revêtement ; un second le retire. */
  onSelect: (category: SurfaceCategory | null) => void;
}

/** Part de la longueur totale, en pour cent : un chiffre après la virgule sous 1 %. */
const share = (distanceM: number, totalM: number): string => {
  const pct = totalM > 0 ? (100 * distanceM) / totalM : 0;
  return `${pct < 1 ? pct.toFixed(1) : Math.round(pct)} %`;
};

/**
 * Revêtement d'un itinéraire ou d'une session : une barre en segments
 * arrondis, chaque catégorie de largeur proportionnelle à sa longueur, puis
 * une ligne par catégorie, de la plus longue à la plus courte
 * (`summarizeSurfaces`). Distances en mètres sous 1 km, sinon dans l'unité de
 * l'activité. « Voir sur la carte » colore le tracé selon le revêtement, aux
 * couleurs de la barre.
 *
 * Le survol d'une part, ou d'une ligne, dit son revêtement au-dessus de la
 * barre (le toucher, sur téléphone, le choisit). Choisir un revêtement le met
 * en surbrillance sur la carte : un court morceau perdu dans une grande
 * boucle se retrouve.
 */
function SurfaceBar({ totals, distanceUnit, shownOnMap = false, onToggleMap, selected, onSelect }: SurfaceBarProps) {
  const [hovered, setHovered] = useState<SurfaceCategory | null>(null);
  const totalM = totals.reduce((sum, t) => sum + t.distanceM, 0);
  const describe = (t: SurfaceTotal) => `${SURFACE_LABEL[t.category]} ${formatShortDistance(t.distanceM, distanceUnit)}`;
  const shown = totals.find((t) => t.category === (hovered ?? selected)) ?? null;
  const choose = (category: SurfaceCategory) => onSelect(selected === category ? null : category);
  const pointer = (category: SurfaceCategory) => ({
    onMouseEnter: () => setHovered(category),
    onMouseLeave: () => setHovered(null),
  });

  return (
    <div className="surface-bar">
      {onToggleMap && (
        <div className="surface-bar__actions">
          <Button size="s" aria-pressed={shownOnMap} onClick={onToggleMap}>
            {shownOnMap ? 'Masquer de la carte' : 'Voir sur la carte'}
          </Button>
        </div>
      )}
      <div className="surface-bar__caption" aria-live="polite">
        {shown ? (
          <>
            <span className="surface-bar__swatch" style={{ backgroundColor: SURFACE_COLOR[shown.category] }} />
            <strong>{SURFACE_LABEL[shown.category]}</strong>
            <span className="num">{formatShortDistance(shown.distanceM, distanceUnit)} · {share(shown.distanceM, totalM)}</span>
          </>
        ) : (
          <span className="surface-bar__hint">Touchez un revêtement pour le voir sur la carte</span>
        )}
      </div>
      <div className={`surface-bar__track${selected ? ' surface-bar__track--chosen' : ''}`} role="group" aria-label={`Revêtement : ${totals.map(describe).join(', ')}`}>
        {totals.map((t) => (
          <button key={t.category} type="button" className="surface-bar__part" {...pointer(t.category)}
            aria-label={describe(t)} aria-pressed={selected === t.category}
            onClick={() => choose(t.category)}
            style={{ flexGrow: t.distanceM, backgroundColor: SURFACE_COLOR[t.category] }} />
        ))}
      </div>
      <ul className="surface-bar__list">
        {totals.map((t) => (
          <li key={t.category}>
            <button type="button" className="surface-bar__row" {...pointer(t.category)}
              aria-pressed={selected === t.category} onClick={() => choose(t.category)}>
              <span className="surface-bar__swatch" style={{ backgroundColor: SURFACE_COLOR[t.category] }} />
              <strong className="surface-bar__name">{SURFACE_LABEL[t.category]}</strong>
              <span className="surface-bar__distance num">{formatShortDistance(t.distanceM, distanceUnit)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default SurfaceBar;
