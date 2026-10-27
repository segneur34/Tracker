import { useThemedShade } from '../hooks/useTheme';
import './ShadePicker.css';

/**
 * Couleur d'une activité : une rangée de pastilles, les nuances de sa famille
 * (`FAMILY_SHADES`, §10, point 90). Une couleur hors de la rangée (reprise
 * d'un autre appareil) n'en coche aucune. En sombre, chaque pastille montre sa
 * nuance sombre (`shadeForTheme`) ; la valeur choisie reste la nuance claire.
 */
function ShadePicker({
  shades, value, onChange, label,
}: {
  shades: readonly string[];
  value: string;
  onChange: (color: string) => void;
  label: string;
}) {
  const current = value.toLowerCase();
  const shown = useThemedShade();
  return (
    <div className="shade-picker" role="group" aria-label={label}>
      {shades.map((shade, i) => (
        <button key={shade} type="button" className="shade-picker__swatch" style={{ backgroundColor: shown(shade) }}
          aria-pressed={shade === current} aria-label={`Nuance ${i + 1}`} title={`Nuance ${i + 1}`}
          onClick={() => onChange(shade)} />
      ))}
    </div>
  );
}

export default ShadePicker;
