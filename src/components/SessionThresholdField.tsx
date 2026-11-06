import { useState } from 'react';
import { SPEED_UNIT_LABEL, fromDisplaySpeed, speedFromText, toDisplaySpeed, type SpeedUnit } from '../core/units';
import Button from './ui/Button';

interface SessionThresholdFieldProps {
  label: string;
  title: string;
  /** Valeur appliquée, dans `thresholdUnit`. */
  value: number;
  /** Valeur par défaut, dans `thresholdUnit`, rappelée sur le bouton « Défaut » ; absente, le bouton ne la dit pas. */
  defaultValue?: number;
  isOverridden: boolean;
  /** Unité de saisie : celle des vitesses de l'activité. */
  unit: SpeedUnit;
  /** Unité de la valeur rangée : celle du profil (`thresholdUnit`), les nœuds en voile, les m/s pour une allure. */
  thresholdUnit: SpeedUnit;
  /** Mention en gris quand la valeur n'est pas imposée (« déduite de la trace »). */
  hint?: string;
  /** Phrase discrète sous le champ, quand la valeur n'est pas imposée. */
  note?: string | null;
  /**
   * Moment où la valeur tapée est écrite : `input` (défaut), à chaque frappe
   * valide ; `blur`, à Entrée ou en quittant le champ, pour une valeur dont
   * chaque changement relance toute l'analyse (l'allure). « Défaut » est
   * toujours immédiat.
   */
  commit?: 'input' | 'blur';
  /** Nouvelle valeur, dans `thresholdUnit`, ou `null` pour revenir au défaut. */
  onChange: (next: number | null) => void;
}

/**
 * Vitesse propre à la session (seuil d'activité, de vague ou de vol, allure
 * imposée), saisie dans l'unité des vitesses et rangée dans `thresholdUnit`.
 * Texte local, comme `SpeedRangeEditor` : une frappe intermédiaire n'est pas
 * réécrite par le rendu suivant (« 12 » ne devient pas « 1,02 »), et le
 * champ se vide sans revenir à l'ancienne valeur. Une valeur valide est
 * écrite à chaque frappe, ou seulement à Entrée et en quittant le champ
 * (`commit="blur"`, comme l'angle du vent : un texte invalide y rend
 * l'ancienne valeur, une saisie jamais validée se perd) ; le texte est
 * réaligné quand la valeur change d'ailleurs (« Défaut », rechargement,
 * changement d'unité).
 */
function SessionThresholdField({ label, title, value, defaultValue, isOverridden, unit, thresholdUnit, hint, note, commit = 'input', onChange }: SessionThresholdFieldProps) {
  const shown = (v: number): string => String(Number(toDisplaySpeed(fromDisplaySpeed(v, thresholdUnit), unit).toFixed(unit === 'ms' ? 2 : 1)));
  const [text, setText] = useState(() => shown(value));
  const key = `${value}|${unit}`;
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setText(shown(value));
  }
  /** Validation du texte (`commit="blur"`) : écrit s'il a changé la valeur, sinon le champ reprend la valeur en vigueur. */
  const commitText = () => {
    const next = speedFromText(text, unit, thresholdUnit);
    if (next === null || shown(next) === shown(value)) {
      setText(shown(value));
      return;
    }
    onChange(next);
  };
  return (
    <label className="ui-row-6 ui-center ui-wrap" title={title}>
      <strong>{label} :</strong>
      <input type="number" min={0} step={unit === 'ms' ? 0.1 : 0.5} value={text} aria-label={label}
        onChange={(e) => {
          setText(e.target.value);
          if (commit === 'blur') return;
          const next = speedFromText(e.target.value, unit, thresholdUnit);
          if (next !== null) onChange(next);
        }}
        onBlur={commit === 'blur' ? commitText : undefined}
        onKeyDown={commit === 'blur' ? (e) => { if (e.key === 'Enter') { e.preventDefault(); commitText(); } } : undefined}
        className="ui-field ui-field--s num ui-input-num" />
      {SPEED_UNIT_LABEL[unit]}
      {!isOverridden && hint && <span className="ui-muted ui-text-xs">({hint})</span>}
      {isOverridden && (
        <Button size="s" onClick={() => onChange(null)}
          title={defaultValue === undefined ? 'Revenir au défaut' : `Revenir au défaut (${shown(defaultValue)} ${SPEED_UNIT_LABEL[unit]})`}>
          Défaut
        </Button>
      )}
      {!isOverridden && note && <span style={{ flexBasis: '100%', color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>{note}</span>}
    </label>
  );
}

export default SessionThresholdField;
