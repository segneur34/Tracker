import { useState } from 'react';
import { SPEED_UNIT_LABEL, formatSpeed, fromDisplaySpeed, toDisplaySpeed, type SpeedUnit } from '../core/units';
import Button from './ui/Button';

/**
 * Seuil d'effort de la détection des répétitions (fractionné sans compteur),
 * dans l'onglet réglages de l'analyse : au-dessus, la trace est en effort.
 * Tiré de la session par défaut ; une valeur saisie reste en brouillon
 * jusqu'à « Enregistrer la session », comme le seuil d'activité.
 */

interface EffortThresholdEditorProps {
  /** Unité de saisie : celle des vitesses, en km/h pour une allure. */
  unit: SpeedUnit;
  /** Seuil appliqué, en m/s. */
  valueMs: number | null;
  /** Seuil tiré de la session, en m/s. */
  suggestedMs: number | null;
  isOverridden: boolean;
  /** Seuil imposé, en m/s, ou `null` pour revenir à celui tiré de la session. */
  onChange: (thresholdMs: number | null) => void;
}

function EffortThresholdEditor({ unit, valueMs, suggestedMs, isOverridden, onChange }: EffortThresholdEditorProps) {
  const shown = (ms: number | null): string => (ms === null ? '' : String(Number(toDisplaySpeed(ms, unit).toFixed(unit === 'ms' ? 2 : 1))));
  // Texte local, distinct du seuil enregistré, comme `SpeedRangeEditor` : une frappe
  // intermédiaire ne doit pas être réécrite par le rendu suivant.
  const [text, setText] = useState(() => shown(valueMs));
  const key = `${valueMs}|${unit}`;
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    if (fromDisplaySpeed(parseFloat(text), unit) !== valueMs) setText(shown(valueMs));
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
    const parsed = parseFloat(e.target.value);
    if (isNaN(parsed) || parsed <= 0) return;
    const ms = fromDisplaySpeed(parsed, unit);
    if (isFinite(ms) && ms > 0) onChange(ms);
  };

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      <strong>Seuil d'effort :</strong>
      <input type="number" min={0} step={unit === 'ms' ? 0.1 : 0.5} value={text} onChange={handleChange}
        aria-label="Seuil d'effort" className="ui-field ui-field--s num" style={{ width: '68px', textAlign: 'right' }} />
      {SPEED_UNIT_LABEL[unit]}
      {suggestedMs !== null && (
        <span style={{ color: 'var(--muted)', fontSize: '0.9em' }}>
          {isOverridden ? `tiré de la session : ${formatSpeed(suggestedMs, unit)}` : 'tiré de la session'}
        </span>
      )}
      {isOverridden && <Button size="s" onClick={() => onChange(null)}>Revenir à la session</Button>}
    </label>
  );
}

export default EffortThresholdEditor;
