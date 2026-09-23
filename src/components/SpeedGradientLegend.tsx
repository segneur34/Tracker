import { useState } from 'react';
import { SLOW_COLOR, gradientCss, type SpeedRangeMs } from '../core/speedGradient';
import { SPEED_UNIT_LABEL, formatSpeedValue, fromDisplaySpeed, toDisplaySpeed, type SpeedUnit } from '../core/units';

/**
 * Légende du dégradé de couleur de la trace, avec saisie des deux bornes.
 * Partagée par les modules course et voile : seuls l'unité d'affichage, les
 * bornes et le libellé de la couleur « lente » changent.
 */

interface SpeedGradientLegendProps {
  /** Unité d'affichage des bornes et des graduations. */
  unit: SpeedUnit;
  /** Bornes en vigueur, en m/s. */
  range: SpeedRangeMs;
  /** Vrai si les bornes viennent de l'utilisateur, pour proposer le retour au défaut. */
  isOverridden: boolean;
  /** Nouvelles bornes, ou `null` pour revenir au défaut du support. */
  onChange: (range: SpeedRangeMs | null) => void;
  /** Ce que représente le gris sous la borne basse : « marche », « sous le seuil »… */
  slowLabel: string;
}

function SpeedGradientLegend({ unit, range, isOverridden, onChange, slowLabel }: SpeedGradientLegendProps) {
  const unitLabel = SPEED_UNIT_LABEL[unit];

  /** Valeur d'une borne dans l'unité choisie, arrondie pour le champ de saisie. */
  const boundValue = (ms: number): number => Number(toDisplaySpeed(ms, unit).toFixed(unit === 'ms' ? 2 : 1));

  /**
   * Texte affiché par champ, distinct de la borne enregistrée : les deux
   * bornes se valident l'une par rapport à l'autre (min < max), et une
   * frappe intermédiaire (le premier chiffre d'un nombre à deux chiffres,
   * après une sélection complète) peut violer cette contrainte même quand la
   * valeur finale visée est correcte. Si l'affichage était piloté
   * directement par la borne enregistrée, cette frappe rejetée ne
   * déclencherait aucun re-render ; au prochain rendu du composant, pour une
   * tout autre raison, React réappliquerait l'ancienne valeur et
   * repositionnerait le curseur en fin de champ, si bien que le chiffre
   * suivant s'ajouterait après l'ancienne valeur au lieu de la remplacer
   * (piège du point 13 de docs/ETAT_DU_PROJET.md, que le point 20 pensait
   * éviter ici à tort). Le texte local reflète donc toujours exactement ce
   * qui a été tapé ; l'application reste immédiate dès que la valeur est
   * valide, flèches ↕ comprises.
   */
  const [minText, setMinText] = useState(() => String(boundValue(range.minMs)));
  const [maxText, setMaxText] = useState(() => String(boundValue(range.maxMs)));

  // Resynchronisation pendant le rendu (pas un effet) quand la borne change
  // pour une autre raison que la frappe locale : nouvelle trace, bouton
  // « Défaut », modification de l'autre borne. Le texte suivi ici sert
  // uniquement à détecter ce changement, jamais affiché tel quel.
  const [prevMinKey, setPrevMinKey] = useState(`${range.minMs}|${unit}`);
  const [prevMaxKey, setPrevMaxKey] = useState(`${range.maxMs}|${unit}`);
  const minKey = `${range.minMs}|${unit}`;
  const maxKey = `${range.maxMs}|${unit}`;
  if (minKey !== prevMinKey) {
    setPrevMinKey(minKey);
    setMinText(String(boundValue(range.minMs)));
  }
  if (maxKey !== prevMaxKey) {
    setPrevMaxKey(maxKey);
    setMaxText(String(boundValue(range.maxMs)));
  }

  const handleBoundChange = (bound: 'min' | 'max') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    (bound === 'min' ? setMinText : setMaxText)(text);

    const parsed = parseFloat(text);
    if (isNaN(parsed) || parsed <= 0) return;
    const ms = fromDisplaySpeed(parsed, unit);
    if (!isFinite(ms)) return;
    onChange(bound === 'min' ? { minMs: ms, maxMs: range.maxMs } : { minMs: range.minMs, maxMs: ms });
  };

  /** Graduations : cinq repères entre les deux bornes, dans l'unité. */
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const ms = range.minMs + t * (range.maxMs - range.minMs);
    return formatSpeedValue(toDisplaySpeed(ms, unit), unit);
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', fontSize: '12px', marginTop: '8px' }}>
      <strong>Couleur de la trace ({unitLabel})</strong>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ display: 'inline-block', width: '22px', height: '12px', backgroundColor: SLOW_COLOR, borderRadius: '2px' }} />
        {slowLabel}
      </span>
      <span style={{ display: 'inline-flex', flexDirection: 'column', minWidth: '260px' }}>
        <span style={{ display: 'block', height: '12px', borderRadius: '2px', background: gradientCss() }} />
        <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#444' }}>
          {ticks.map((tick, i) => <span key={i}>{tick}</span>)}
        </span>
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        de
        <input type="number" min={0} step={0.5} value={minText}
          onChange={handleBoundChange('min')}
          style={{ width: '64px', padding: '2px 4px', textAlign: 'right' }} />
        à
        <input type="number" min={0} step={0.5} value={maxText}
          onChange={handleBoundChange('max')}
          style={{ width: '64px', padding: '2px 4px', textAlign: 'right' }} />
        {unitLabel}
      </span>
      {isOverridden && (
        <button onClick={() => onChange(null)} style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer' }}>Défaut</button>
      )}
    </div>
  );
}

export default SpeedGradientLegend;
