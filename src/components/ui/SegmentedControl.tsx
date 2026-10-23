import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';

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

/** Déplacement au-delà duquel un appui sur la case devient un glisser (px) ; en deçà, c'est un clic. */
const TAP_SLOP_PX = 6;

/**
 * Bouton glissant : un choix parmi plusieurs, dans une gouttière creuse où une
 * case blanche glisse sous le choix (Profil, Statistiques). La case s'attrape
 * au doigt ou à la souris : le choix se fait au lâcher, sur le plus proche.
 * Flèches du clavier d'un choix à l'autre. Trop large, la rangée défile et
 * garde le choix en vue.
 */
function SegmentedControl<K extends string>({ label, items, value, onChange, accent, className }: SegmentedControlProps<K>) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  /** Pas de glissement à la première mesure : la case apparaît à sa place. */
  const [measured, setMeasured] = useState(false);
  /** Choix fait au clavier : le focus suit le nouveau choix une fois rendu. */
  const keyed = useRef(false);
  /** Appui sur la case : point de départ, et s'il a dépassé le seuil du clic. */
  const press = useRef<{ pointerId: number; startX: number; startLeft: number; moved: boolean } | null>(null);
  /** Case tenue : sa position dans la rangée et le choix sous son centre. */
  const [drag, setDrag] = useState<{ left: number; under: K } | null>(null);
  /** Le clic qui suit un glisser ne choisit rien : le choix est fait au lâcher. */
  const swallowClick = useRef(false);
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

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    swallowClick.current = false;
    if (!thumb || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // La case s'attrape sur le choix en cours ; ailleurs, un appui reste un clic (ou fait défiler la rangée).
    const button = (e.target as Element).closest('button');
    if (!button || button.getAttribute('aria-checked') !== 'true') return;
    press.current = { pointerId: e.pointerId, startX: e.clientX, startLeft: thumb.left, moved: false };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    const row = rowRef.current;
    if (!p || p.pointerId !== e.pointerId || !row || !thumb) return;
    const dx = e.clientX - p.startX;
    if (!p.moved) {
      if (Math.abs(dx) < TAP_SLOP_PX) return;
      p.moved = true;
      row.setPointerCapture(e.pointerId);
    }
    const buttons = [...row.querySelectorAll<HTMLButtonElement>('button')];
    if (buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    const left = Math.min(Math.max(p.startLeft + dx, first.offsetLeft), last.offsetLeft + last.offsetWidth - thumb.width);
    // Le choix le plus proche du centre de la case : celui qui sera pris au lâcher.
    const center = left + thumb.width / 2;
    let under = value;
    let best = Infinity;
    buttons.forEach((b, i) => {
      const d = Math.abs(b.offsetLeft + b.offsetWidth / 2 - center);
      if (d < best && items[i]) {
        best = d;
        under = items[i].key;
      }
    });
    // Rangée qui défile : la case reste en vue.
    if (left < row.scrollLeft) row.scrollLeft = left;
    else if (left + thumb.width > row.scrollLeft + row.clientWidth) row.scrollLeft = left + thumb.width - row.clientWidth;
    setDrag({ left, under });
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    press.current = null;
    if (!p.moved) return;
    swallowClick.current = true;
    const key = drag?.under;
    setDrag(null);
    if (key !== undefined && key !== value) onChange(key);
  };

  const onPointerCancel = () => {
    press.current = null;
    setDrag(null);
  };

  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const lit = drag ? drag.under : value;

  return (
    <div ref={rowRef} className={`ui-segmented${measured ? ' is-ready' : ''}${drag ? ' is-dragging' : ''}${className ? ` ${className}` : ''}`}
      role="radiogroup" aria-label={label} onKeyDown={onKeyDown}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
      onClickCapture={onClickCapture}
      style={accent ? ({ '--seg-accent': accent } as CSSProperties) : undefined}>
      {thumb && <span className="ui-segmented__thumb" aria-hidden style={{ transform: `translateX(${drag ? drag.left : thumb.left}px)`, width: thumb.width }} />}
      {items.map((item) => {
        const checked = item.key === value;
        return (
          <button key={item.key} type="button" role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1}
            className={item.key === lit ? 'is-lit' : undefined}
            title={item.title} aria-label={item.title} onClick={() => onChange(item.key)}>
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
