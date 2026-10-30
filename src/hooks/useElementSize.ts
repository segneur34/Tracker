import { useEffect, useState, type RefObject } from 'react';

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Taille intérieure de `frame` en pixels de la page (`clientWidth`,
 * `clientHeight`), lue dès que l'élément est observé, puis suivie : un changement de moins de
 * `minChangePx` est ignoré, et un redimensionnement n'est rendu qu'après
 * `delayMs` de calme (une image redessinée à chaque pas du glissé coûterait
 * cher). `null` tant que l'élément n'est pas monté.
 */
export const useElementSize = (frame: RefObject<Element | null>, minChangePx = 2, delayMs = 150): ElementSize | null => {
  const [size, setSize] = useState<ElementSize | null>(null);
  useEffect(() => {
    const el = frame.current;
    if (!el) return undefined;
    const read = (): ElementSize => ({ width: el.clientWidth, height: el.clientHeight });
    if (typeof ResizeObserver === 'undefined') {
      let live = true;
      void Promise.resolve().then(() => { if (live) setSize(read()); });
      return () => { live = false; };
    }
    let shown: ElementSize | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Le premier appel, à l'observation, donne la taille de départ aussitôt ; les suivants attendent le calme.
    const observer = new ResizeObserver(() => {
      if (shown === null) {
        shown = read();
        setSize(shown);
        return;
      }
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const next = read();
        if (shown && Math.abs(next.width - shown.width) < minChangePx && Math.abs(next.height - shown.height) < minChangePx) return;
        shown = next;
        setSize(next);
      }, delayMs);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
  }, [frame, minChangePx, delayMs]);
  return size;
};
