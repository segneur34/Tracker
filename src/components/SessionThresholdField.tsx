import { useState } from 'react';
import { SPEED_UNIT_LABEL, fromDisplaySpeed, toDisplaySpeed, type SpeedUnit } from '../core/units';
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
  /** Nouvelle valeur, dans `thresholdUnit`, ou `null` pour revenir au défaut. */
  onChange: (next: number | null) => void;
}

/**
 * Vitesse propre à la session (seuil d'activité, de vague ou de vol, allure
 * imposée), saisie dans l'unité des vitesses et rangée dans `thresholdUnit`.
 * Texte local, comme `SpeedRangeEditor` : une frappe intermédiaire n'est pas
 * réécrite par le rendu suivant (« 12 » ne devient pas « 1,02 »), et le
 * champ se vide sans revenir à l'ancienne valeur. Une valeur valide est
 * écrite à chaque frappe ; le texte est réaligné quand la valeur change
 * d'ailleurs (« Défaut », rechargement, changement d'unité).
 */
function SessionThresholdField({ label, title, value, defaultValue, isOverridden, unit, thresholdUnit, hint, onChange }: SessionThresholdFieldProps) {
  const shown = (v: number): string => String(Number(toDisplaySpeed(fromDisplaySpeed(v, thresholdUnit), unit).toFixed(unit === 'ms' ? 2 : 1)));
  const [text, setText] = useState(() => shown(value));
  const key = `${value}|${unit}`;
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setText(shown(value));
  }
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }} title={title}>
      <strong>{label} :</strong>
      <input type="number" min={0} step={unit === 'ms' ? 0.1 : 0.5} value={text} aria-label={label}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseFloat(e.target.value);
          if (isNaN(parsed) || parsed <= 0) return;
          const next = toDisplaySpeed(fromDisplaySpeed(parsed, unit), thresholdUnit);
          if (isFinite(next) && next > 0) onChange(next);
        }}
        className="ui-field ui-field--s num" style={{ width: '68px', textAlign: 'right' }} />
      {SPEED_UNIT_LABEL[unit]}
      {!isOverridden && hint && <span style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>({hint})</span>}
      {isOverridden && (
        <Button size="s" onClick={() => onChange(null)}
          title={defaultValue === undefined ? 'Revenir au défaut' : `Revenir au défaut (${shown(defaultValue)} ${SPEED_UNIT_LABEL[unit]})`}>
          Défaut
        </Button>
      )}
    </label>
  );
}

export default SessionThresholdField;
