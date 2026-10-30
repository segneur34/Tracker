import type { PlanePoint } from './geo';

/**
 * Grille spatiale de segments d'un plan local : retrouver, pour un point, les
 * segments assez proches pour valoir un calcul de distance, sans les parcourir
 * tous (appariement d'une trace aux voies, recouvrement d'un retour de boucle
 * avec l'aller). Pur ; unités SI (règle 1) : mètres.
 *
 * Chaque segment est coupé en bouts d'au plus `cell` de long et rangé dans
 * toutes les cases que touche chaque bout, élargi de `margin` : un segment
 * occupe donc peu de cases quelle que soit sa longueur, et tout segment à
 * moins de `margin` d'un point figure dans la case de ce point. La liste d'une
 * case garde l'ordre des segments donnés.
 */
export interface SegmentGrid {
  /** Indices (dans les segments donnés) des segments candidats pour `p`, qui peuvent être plus loin que `margin`. */
  near(p: PlanePoint): readonly number[];
}

export const buildSegmentGrid = (
  segments: ReadonlyArray<readonly [PlanePoint, PlanePoint]>,
  cell: number,
  margin: number
): SegmentGrid => {
  const size = Math.max(cell, 1e-6);
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  const cells = new Map<string, number[]>();
  const mark = (a: PlanePoint, b: PlanePoint, index: number) => {
    const x0 = Math.floor((Math.min(a.x, b.x) - margin) / size);
    const x1 = Math.floor((Math.max(a.x, b.x) + margin) / size);
    const y0 = Math.floor((Math.min(a.y, b.y) - margin) / size);
    const y1 = Math.floor((Math.max(a.y, b.y) + margin) / size);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = key(cx, cy);
        const list = cells.get(k);
        if (!list) cells.set(k, [index]);
        // Bouts consécutifs du même segment : rangé une fois par case.
        else if (list[list.length - 1] !== index) list.push(index);
      }
    }
  };
  segments.forEach(([a, b], index) => {
    const parts = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / size));
    for (let k = 0; k < parts; k++) {
      const t0 = k / parts;
      const t1 = (k + 1) / parts;
      mark(
        { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 },
        { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 },
        index
      );
    }
  });
  const none: readonly number[] = [];
  return { near: (p) => cells.get(key(Math.floor(p.x / size), Math.floor(p.y / size))) ?? none };
};
