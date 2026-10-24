/**
 * Zoom horizontal d'un graphe : plage visible de l'axe des abscisses, dans
 * l'unité de l'axe (distance affichée). Les positions à l'écran sont en
 * pixels depuis le bord gauche de la zone de tracé, de largeur `widthPx`.
 * `null` vaut « tout voir ».
 */

export interface XRange {
  min: number;
  max: number;
}

/**
 * Plage ramenée dans `full`, d'une largeur d'au moins `minSpan` (centrée sur
 * la plage demandée si elle est élargie) ; `null` si elle couvre tout.
 */
export const clampRange = (range: XRange, full: XRange, minSpan: number): XRange | null => {
  const fullSpan = full.max - full.min;
  if (!(fullSpan > 0)) return null;
  const span = Math.max(minSpan, range.max - range.min);
  if (!(span < fullSpan)) return null;
  const center = (range.min + range.max) / 2;
  const min = Math.max(full.min, Math.min(center - span / 2, full.max - span));
  return { min, max: min + span };
};

/**
 * Plage après un geste à deux doigts : les valeurs qui étaient sous chaque
 * doigt au début du geste (`startPx`, plage `start`) restent sous lui
 * (`nowPx`). Écarter zoome, pincer dézoome, glisser déplace. Doigts croisés
 * ou confondus : la plage de départ.
 */
export const pinchRange = (
  start: XRange,
  startPx: readonly [number, number],
  nowPx: readonly [number, number],
  widthPx: number,
  full: XRange,
  minSpan: number
): XRange | null => {
  const startGap = startPx[1] - startPx[0];
  const nowGap = nowPx[1] - nowPx[0];
  if (!(widthPx > 0) || Math.abs(startGap) < 1 || Math.abs(nowGap) < 1) return clampRange(start, full, minSpan);
  const perPx = (start.max - start.min) / widthPx;
  const v0 = start.min + startPx[0] * perPx;
  const v1 = start.min + startPx[1] * perPx;
  const scale = (v1 - v0) / nowGap;
  if (!(scale > 0)) return clampRange(start, full, minSpan);
  const min = v0 - nowPx[0] * scale;
  return clampRange({ min, max: min + widthPx * scale }, full, minSpan);
};

/**
 * Plage après un double-clic ou un double toucher à `px` : divisée par
 * `factor`, la valeur sous le doigt ou la souris restant sous lui (deux
 * doubles touchers au même endroit zooment sur le même point).
 */
export const zoomAtRange = (
  view: XRange,
  px: number,
  widthPx: number,
  factor: number,
  full: XRange,
  minSpan: number
): XRange | null => {
  if (!(widthPx > 0) || !(factor > 0)) return clampRange(view, full, minSpan);
  const at = Math.max(0, Math.min(1, px / widthPx));
  const value = view.min + at * (view.max - view.min);
  const span = (view.max - view.min) / factor;
  const min = value - at * span;
  return clampRange({ min, max: min + span }, full, minSpan);
};

/**
 * Tronçon de la trace que montre une plage de l'axe d'un graphe : `axis`
 * donne la valeur croissante de chaque point (distance affichée, minutes).
 * Les points dans la plage, et à chaque bout le point de la borne, placé sur
 * le segment qui la coupe. Un seul intervalle peut couvrir toute la plage
 * (règle 10) : deux points sur ce segment, jamais aucun. Vide sans trace.
 */
export const axisRangePath = (
  points: ReadonlyArray<{ lat: number; lon: number }>,
  axis: ArrayLike<number>,
  range: XRange
): [number, number][] => {
  const n = Math.min(points.length, axis.length);
  if (n === 0) return [];
  // Position du point de la trace à la valeur `v` de l'axe, interpolée sur son segment.
  const at = (v: number): [number, number] => {
    if (v <= axis[0]) return [points[0].lat, points[0].lon];
    if (v >= axis[n - 1]) return [points[n - 1].lat, points[n - 1].lon];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (axis[mid] <= v) lo = mid;
      else hi = mid;
    }
    const span = axis[hi] - axis[lo];
    const t = span > 0 ? (v - axis[lo]) / span : 0;
    return [points[lo].lat + t * (points[hi].lat - points[lo].lat), points[lo].lon + t * (points[hi].lon - points[lo].lon)];
  };
  const path: [number, number][] = [at(range.min)];
  for (let i = 0; i < n; i++) {
    if (axis[i] > range.min && axis[i] < range.max) path.push([points[i].lat, points[i].lon]);
  }
  path.push(at(range.max));
  return path;
};

/** Plage désignée par une sélection à la souris entre deux positions, bornée à la zone de tracé. */
export const pxSelectionRange = (aPx: number, bPx: number, view: XRange, widthPx: number): XRange => {
  const clampPx = (px: number) => Math.max(0, Math.min(widthPx, px));
  const perPx = widthPx > 0 ? (view.max - view.min) / widthPx : 0;
  const lo = clampPx(Math.min(aPx, bPx));
  const hi = clampPx(Math.max(aPx, bPx));
  return { min: view.min + lo * perPx, max: view.min + hi * perPx };
};

/**
 * Indices extrêmes, bornes comprises, des valeurs croissantes `values` à
 * tracer pour la plage : celles qu'elle contient et un voisin de chaque côté,
 * pour que la courbe touche les bords. Toute la série sans plage.
 */
export const visibleIndexRange = (values: ArrayLike<number>, range: XRange | null): [number, number] => {
  const n = values.length;
  if (n === 0) return [0, -1];
  if (!range) return [0, n - 1];
  // Premier indice dont la valeur atteint `target` (ou la dépasse strictement si `strict`).
  const search = (target: number, strict: boolean) => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (strict ? values[mid] > target : values[mid] >= target) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
  return [Math.max(0, search(range.min, false) - 1), Math.min(n - 1, search(range.max, true))];
};

/**
 * Indices de `first` à `last` à tracer, au plus `maxPoints` environ, à pas
 * régulier ; le dernier est toujours compris, pour que la courbe aille au
 * bout de la plage.
 */
export const sampledIndices = (first: number, last: number, maxPoints: number): number[] => {
  if (last < first) return [];
  const step = Math.max(1, Math.ceil((last - first + 1) / Math.max(1, maxPoints)));
  const out: number[] = [];
  for (let i = first; i <= last; i += step) out.push(i);
  if (out[out.length - 1] !== last) out.push(last);
  return out;
};

/** Multiples d'une puissance de dix retenus comme pas de graduation. */
const NICE_STEPS = [1, 2, 2.5, 5, 10];

/**
 * Graduations rondes de la plage (pas de 1, 2, 2,5 ou 5 × 10ⁿ), environ
 * `count` : une plage zoomée a des bornes quelconques, que le graphe
 * graduerait telles quelles (2,02, 4,05…).
 */
export const niceTicks = (range: XRange, count = 5): number[] => {
  const span = range.max - range.min;
  if (!(span > 0) || count < 2) return [];
  const raw = span / (count - 1);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = (NICE_STEPS.find((m) => m * pow >= raw * (1 - 1e-9)) ?? 10) * pow;
  const out: number[] = [];
  for (let k = Math.ceil(range.min / step - 1e-9); k * step <= range.max + step * 1e-9; k++) {
    out.push(parseFloat((k * step).toFixed(12)));
  }
  return out;
};
