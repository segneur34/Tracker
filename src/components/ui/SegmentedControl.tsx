import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';

interface SegmentedControlProps<K extends string> {
  /** Nom du choix, lu par les lecteurs d'écran. */
  label: string;
  items: { key: K; label: string; title?: string }[];
  value: K;
  onChange: (key: K) => void;
  /** Couleur du texte du choix (famille) ; l'encre sans elle. */
  accent?: string;
  className?: string;
}

/**
 * Bouton glissant : un choix parmi plusieurs, dans une gouttière creuse où une
 * case blanche glisse sous le choix (Profil, Statistiques). Flèches du clavier
 * d'un choix à l'autre. Trop large, la rangée défile et garde le choix en vue.
 */
function SegmentedControl<K extends string>({ label, items, value, onChange, accent, className }: SegmentedControlProps<K>) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  /** Pas de glissement à la première mesure : la case apparaît à sa place. */
  const [measured, setMeasured] = useState(false);
  /** Choix fait au clavier : le focus suit le nouveau choix une fois rendu. */
  const keyed = useRef(false);
  const itemsKey = items.map((it) => `${it.key}:${it.label}`).join('|');

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    // Mesures reprises quand une taille change (police chargée, écran tourné) : la case suit, et le choix reste
    // en vue si la rangée défile.
    const place = () => {
      const button = row.querySelector<HTMLButtonElement>('[aria-checked="true"]');
      const next = button ? { left: button.offsetLeft, width: button.offsetWidth } : null;
      setThumb((prev) => (prev?.left === next?.left && prev?.width === next?.width ? prev : next));
      if (button && (button.offsetLeft < row.scrollLeft || button.offsetLeft + button.offsetWidth > row.scrollLeft + row.clientWidth)) {
        row.scrollLeft = button.offsetLeft - (row.clientWidth - button.offsetWidth) / 2;
      }
    };
    place();
    if (keyed.current) {
      keyed.current = false;
      row.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    }
    const observer = new ResizeObserver(place);
    observer.observe(row);
    for (const child of row.querySelectorAll('button')) observer.observe(child);
    return () => observer.disconnect();
    // Les libellés comptent aussi : une rangée d'activités qui change de famille garde parfois le même choix.
  }, [value, itemsKey]);

  useLayoutEffect(() => {
    if (thumb && !measured) requestAnimationFrame(() => setMeasured(true));
  }, [thumb, measured]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = items.findIndex((it) => it.key === value);
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1)
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? Math.max(0, i - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
      : null;
    if (next === null || items.length === 0) return;
    e.preventDefault();
    const key = items[next].key;
    if (key === value) return;
    keyed.current = true;
    onChange(key);
  };

  return (
    <div ref={rowRef} className={`ui-segmented${measured ? ' is-ready' : ''}${className ? ` ${className}` : ''}`}
      role="radiogroup" aria-label={label} onKeyDown={onKeyDown}
      style={accent ? ({ '--seg-accent': accent } as CSSProperties) : undefined}>
      {thumb && <span className="ui-segmented__thumb" aria-hidden style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }} />}
      {items.map((item) => {
        const checked = item.key === value;
        return (
          <button key={item.key} type="button" role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1}
            title={item.title} aria-label={item.title} onClick={() => onChange(item.key)}>
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
