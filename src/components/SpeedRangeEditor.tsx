import { useState } from 'react';
import type { SpeedRangeMs } from '../core/speedGradient';
import { SPEED_UNIT_LABEL, fromDisplaySpeed, toDisplaySpeed, type SpeedUnit } from '../core/units';
import Button from './ui/Button';

/**
 * Saisie des deux bornes du dégradé de couleur de la trace, dans l'onglet
 * Réglages des modules course et voile. La légende, sous la carte
 * (`SpeedGradientLegend`), ne fait qu'afficher les bornes en vigueur.
 */

interface SpeedRangeEditorProps {
  /** Unité d'affichage des bornes. */
  unit: SpeedUnit;
  /** Bornes en vigueur, en m/s. */
  range: SpeedRangeMs;
  /** Vrai si les bornes viennent de l'utilisateur, pour proposer le retour au défaut. */
  isOverridden: boolean;
  /** Nouvelles bornes, ou `null` pour revenir au défaut du support. */
  onChange: (range: SpeedRangeMs | null) => void;
}

function SpeedRangeEditor({ unit, range, isOverridden, onChange }: SpeedRangeEditorProps) {
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
   * (piège du point 13 de docs/HISTORIQUE.md, que le point 20 pensait
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

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      <strong>Couleur de la trace :</strong>
      de
      <input type="number" min={0} step={0.5} value={minText}
        onChange={handleBoundChange('min')}
        className="ui-field ui-field--s num"
        style={{ width: '68px', textAlign: 'right' }} />
      à
      <input type="number" min={0} step={0.5} value={maxText}
        onChange={handleBoundChange('max')}
        className="ui-field ui-field--s num"
        style={{ width: '68px', textAlign: 'right' }} />
      {unitLabel}
      {isOverridden && (
        <Button size="s" onClick={() => onChange(null)}>Défaut</Button>
      )}
    </label>
  );
}

export default SpeedRangeEditor;
