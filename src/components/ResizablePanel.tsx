import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';

/**
 * Panneau redimensionnable par sa poignée en bas à droite, en largeur et en
 * hauteur, dont la taille est mémorisée dans le navigateur. Tout bloc d'un
 * module, tableau, graphe ou carte, doit pouvoir être agrandi ou réduit par
 * l'utilisateur.
 *
 * Tant que l'utilisateur n'a pas touché au panneau, c'est le `style` de la
 * page qui fait la mise en page (`flex: '1 1 500px'`, `width: '500px'`…) :
 * un bloc à hauteur automatique garde ainsi sa liberté de grandir avec son
 * contenu. Dès qu'il glisse la poignée, et ensuite tant qu'une taille est
 * mémorisée, le panneau devient un bloc de taille fixe (`flex: 0 0 auto`,
 * largeur et hauteur explicites) qui prime sur le `style`. Sans cela, un
 * item flex à `flex-basis` non `auto` ignore la propriété `width` que pose
 * la poignée, et `flex-grow` le fait regrandir pour remplir la ligne.
 */

const STORAGE_KEY = 'tracker.panelSizes';

/** Zone en pixels, depuis le coin bas-droit, où le navigateur dessine la poignée `resize`. */
const HANDLE_ZONE_PX = 20;

interface PanelSize {
  width?: number;
  height?: number;
}

const readSizes = (): Record<string, PanelSize> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, PanelSize>) : {};
  } catch {
    return {};
  }
};

const writeSize = (id: string, size: PanelSize | null): void => {
  try {
    const all = readSizes();
    if (size === null) delete all[id];
    else all[id] = size;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Stockage indisponible : la taille vaut pour la session en cours.
  }
};

interface ResizablePanelProps {
  /** Identifiant stable, unique dans l'application, sous lequel la taille est mémorisée. */
  id: string;
  children: ReactNode;
  /** Hauteur initiale en pixels, tant que l'utilisateur n'a pas redimensionné. */
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  /** Sens de redimensionnement autorisé. */
  direction?: 'both' | 'vertical' | 'horizontal';
  style?: CSSProperties;
}

function ResizablePanel({
  id,
  children,
  defaultHeight,
  minWidth = 240,
  minHeight = 120,
  direction = 'both',
  style,
}: ResizablePanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [stored, setStored] = useState<PanelSize | null>(() => readSizes()[id] ?? null);
  /** Taille figée au début d'un glisser sur la poignée, pour que la largeur suive la souris sans saut. */
  const [dragSize, setDragSize] = useState<PanelSize | null>(null);
  const dragStart = useRef<PanelSize | null>(null);

  // Un même panneau peut changer d'identifiant, par exemple la section
  // manœuvres qui passe du tableau compact aux détails. C'est alors un autre
  // panneau : on relit sa taille mémorisée et on efface celle que le
  // navigateur a laissée en style inline après un redimensionnement à la
  // souris, sinon la nouvelle version resterait coincée à l'ancienne taille.
  const lastId = useRef(id);
  useEffect(() => {
    if (lastId.current === id) return;
    lastId.current = id;
    const next = readSizes()[id] ?? null;
    setStored(next);
    const el = ref.current;
    if (!el) return;
    el.style.width = next?.width !== undefined && direction !== 'vertical' ? `${next.width}px` : '';
    el.style.height = next?.height !== undefined ? `${next.height}px` : defaultHeight !== undefined ? `${defaultHeight}px` : '';
  }, [id, direction, defaultHeight]);

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const start: PanelSize = { width: el.offsetWidth, height: el.offsetHeight };
    dragStart.current = start;

    // Glisser commencé sur la poignée : le panneau passe tout de suite en
    // taille fixe, à sa taille courante, pour que le navigateur puisse
    // ensuite lui appliquer la largeur et la hauteur tirées à la souris.
    const rect = el.getBoundingClientRect();
    const onHandle = rect.right - e.clientX <= HANDLE_ZONE_PX && rect.bottom - e.clientY <= HANDLE_ZONE_PX;
    if (onHandle) setDragSize(start);

    const onPointerUp = () => {
      const begin = dragStart.current;
      dragStart.current = null;
      setDragSize(null);
      if (!begin || !ref.current) return;
      const width = Math.round(ref.current.offsetWidth);
      const height = Math.round(ref.current.offsetHeight);
      if (Math.abs(width - (begin.width ?? 0)) <= 1 && Math.abs(height - (begin.height ?? 0)) <= 1) return;

      const size: PanelSize = { height };
      if (direction !== 'vertical') size.width = width;
      setStored(size);
      writeSize(id, size);
    };
    document.addEventListener('pointerup', onPointerUp, { once: true });
  }, [id, direction]);

  // La taille est portée par les props React : au retour au défaut, React
  // retire lui-même les propriétés inline ou rétablit celles du `style`.
  const reset = () => {
    setStored(null);
    writeSize(id, null);
  };

  const size = dragSize ?? stored;
  const sizeOverride: CSSProperties = {};
  if (size?.height !== undefined) sizeOverride.height = `${size.height}px`;
  else if (defaultHeight !== undefined) sizeOverride.height = `${defaultHeight}px`;
  if (size?.width !== undefined && direction !== 'vertical') {
    sizeOverride.width = `${size.width}px`;
    sizeOverride.flex = '0 0 auto';
  }

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      style={{
        position: 'relative',
        resize: direction,
        overflow: 'auto',
        boxSizing: 'border-box',
        minWidth,
        minHeight,
        maxWidth: '100%',
        ...style,
        ...sizeOverride,
      }}>
      {children}
      {stored !== null && (
        <button
          onClick={reset}
          title="Revenir à la taille par défaut"
          style={{ position: 'absolute', top: 4, right: 4, padding: '0 5px', fontSize: '10px', lineHeight: '16px', cursor: 'pointer', border: '1px solid #bbb', borderRadius: '3px', backgroundColor: 'rgba(255,255,255,0.85)', color: '#555' }}>
          ↺
        </button>
      )}
    </div>
  );
}

export default ResizablePanel;
