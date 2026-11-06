import { useState } from 'react';
import { isValidSpeedRange, type SpeedRangeMs } from '../core/speedGradient';
import { SPEED_UNIT_LABEL, editSpeedUnit, fromDisplaySpeed, speedFromText, toDisplaySpeed, type SpeedUnit } from '../core/units';
import Button from './ui/Button';

/**
 * Saisie des deux bornes du dégradé de couleur de la trace, dans l'onglet
 * Réglages des modules course et voile. La légende, sous la carte
 * (`SpeedGradientLegend`), ne fait qu'afficher les bornes en vigueur. Une
 * allure (min/km) se saisit en km/h, comme dans Réglages (`editSpeedUnit`).
 */

interface SpeedRangeEditorProps {
  /** Unité de l'activité ; une allure se saisit en km/h. */
  unit: SpeedUnit;
  /** Bornes en vigueur, en m/s. */
  range: SpeedRangeMs;
  /** Vrai si les bornes viennent de l'utilisateur, pour proposer le retour au défaut. */
  isOverridden: boolean;
  /**
   * Moment où une borne tapée est écrite : `input` (défaut), à chaque frappe
   * valide ; `blur`, à Entrée ou en quittant le champ, et seulement si les
   * deux bornes restent valides (min < max), sinon le champ reprend la borne
   * en vigueur. « Défaut » est toujours immédiat.
   */
  commit?: 'input' | 'blur';
  /** Nouvelles bornes, ou `null` pour revenir au défaut du support. */
  onChange: (range: SpeedRangeMs | null) => void;
}

function SpeedRangeEditor({ unit: activityUnit, range, isOverridden, commit = 'input', onChange }: SpeedRangeEditorProps) {
  const unit = editSpeedUnit(activityUnit);
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
   * valide, flèches ↕ comprises, sauf en mode `blur` (analyses), où elle
   * attend Entrée ou la sortie du champ.
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
    if (commit === 'blur') return;

    const parsed = parseFloat(text);
    if (isNaN(parsed) || parsed <= 0) return;
    const ms = fromDisplaySpeed(parsed, unit);
    if (!isFinite(ms)) return;
    onChange(bound === 'min' ? { minMs: ms, maxMs: range.maxMs } : { minMs: range.minMs, maxMs: ms });
  };

  /** Validation d'une borne (`commit="blur"`) : écrite si elle change et garde min < max, sinon le champ reprend la borne en vigueur. */
  const commitBound = (bound: 'min' | 'max') => () => {
    const current = bound === 'min' ? range.minMs : range.maxMs;
    const reset = () => (bound === 'min' ? setMinText : setMaxText)(String(boundValue(current)));
    const ms = speedFromText(bound === 'min' ? minText : maxText, unit, 'ms');
    if (ms === null || boundValue(ms) === boundValue(current)) {
      reset();
      return;
    }
    const next = bound === 'min' ? { minMs: ms, maxMs: range.maxMs } : { minMs: range.minMs, maxMs: ms };
    if (!isValidSpeedRange(next)) {
      reset();
      return;
    }
    onChange(next);
  };
  /** Écouteurs de validation d'un champ, en mode `blur` seulement. */
  const commitHandlers = (bound: 'min' | 'max') => commit === 'blur' ? {
    onBlur: commitBound(bound),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); commitBound(bound)(); } },
  } : {};

  return (
    <label className="ui-row-6 ui-center ui-wrap">
      <strong>Couleur de la trace :</strong>
      de
      <input type="number" min={0} step={0.5} value={minText}
        onChange={handleBoundChange('min')} {...commitHandlers('min')}
        className="ui-field ui-field--s num ui-input-num" />
      à
      <input type="number" min={0} step={0.5} value={maxText}
        onChange={handleBoundChange('max')} {...commitHandlers('max')}
        className="ui-field ui-field--s num ui-input-num" />
      {unitLabel}
      {isOverridden && (
        <Button size="s" onClick={() => onChange(null)}>Défaut</Button>
      )}
    </label>
  );
}

export default SpeedRangeEditor;

/**
 * Bornes de couleur de la trace dans l'onglet réglages d'une analyse : le
 * champ `SpeedRangeEditor`, qui ne passe au brouillon que des bornes valides
 * (min < max) ou `null` (retour au défaut), écrites à Entrée ou en quittant le
 * champ (`commit="blur"`) : chaque borne écrite redessine toute la trace.
 */
export function SessionColorRangeField({ unit, range, isOverridden, onChange }: Omit<SpeedRangeEditorProps, 'onChange' | 'commit'> & {
  onChange: (range: SpeedRangeMs | null) => void;
}) {
  return (
    <SpeedRangeEditor unit={unit} range={range} isOverridden={isOverridden} commit="blur"
      onChange={(next) => { if (next === null || isValidSpeedRange(next)) onChange(next); }} />
  );
}
