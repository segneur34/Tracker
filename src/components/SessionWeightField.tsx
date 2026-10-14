import { useState } from 'react';
import Button from './ui/Button';

/**
 * Masse propre à une session, en kg, dans l'onglet réglages de l'analyse :
 * poids du vélo et des bagages, charge portée en course. Vide, c'est celle de
 * l'activité (Réglages) ; une valeur saisie reste en brouillon jusqu'à
 * « Enregistrer la session », comme le terrain.
 */

interface SessionWeightFieldProps {
  label: string;
  /** Valeur de la session, ou `null` pour celle de l'activité. */
  valueKg: number | null;
  /** Valeur de l'activité, proposée dans le champ vide. */
  activityKg: number;
  /** Bornes de la saisie, celles relues dans la fiche. */
  isValid: (kg: number) => boolean;
  onChange: (kg: number | null) => void;
  title?: string;
}

function SessionWeightField({ label, valueKg, activityKg, isValid, onChange, title }: SessionWeightFieldProps) {
  const shown = (kg: number | null): string => (kg === null ? '' : String(kg));
  // Texte local, comme `EffortThresholdEditor` : une frappe intermédiaire ne doit
  // pas être réécrite par le rendu suivant.
  const [text, setText] = useState(() => shown(valueKg));
  const [prevValue, setPrevValue] = useState(valueKg);
  if (valueKg !== prevValue) {
    setPrevValue(valueKg);
    if (parseFloat(text) !== valueKg) setText(shown(valueKg));
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
    if (e.target.value === '') { onChange(null); return; }
    const parsed = parseFloat(e.target.value);
    if (isValid(parsed)) onChange(parsed);
  };

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }} title={title}>
      <strong>{label} :</strong>
      <input type="number" min={0} step={0.5} value={text} placeholder={String(activityKg)} onChange={handleChange}
        aria-label={label} className="ui-field ui-field--s num" style={{ width: '68px', textAlign: 'right' }} />
      kg
      {valueKg === null
        ? <span style={{ color: 'var(--muted)', fontSize: '0.9em' }}>valeur de l'activité</span>
        : <Button size="s" onClick={() => { setText(''); onChange(null); }}>Revenir à l'activité</Button>}
    </label>
  );
}

export default SessionWeightField;
