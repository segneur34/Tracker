import type { SportFamily } from './sportProfiles';

/**
 * Tuiles des fonds de page (`components/PageBackdrop.tsx`), en pixels : la
 * tuile se répète en largeur et en hauteur, si bien que la densité du fond ne
 * dépend ni de la longueur de la page ni de la largeur de l'écran (avant le
 * 22/10, un seul dessin étiré sur toute la page grossissait et s'éclaircissait
 * sur une longue liste).
 *
 * Chaque tracé se raccorde à lui-même d'un bord à l'autre : les courbes de
 * niveau sont celles d'un relief périodique dans les deux sens, les lignes
 * des chemins à pied des fonctions périodiques de la largeur, et les dessins
 * isolés (souffles, vague, repères, traits de vitesse) sont posés avec leurs
 * copies d'une tuile à côté, ce qui dépasse d'un bord reprenant à l'autre.
 *
 * Dessins choisis par l'utilisateur sur maquette le 23/10 : voile, surf et
 * vélo d'après ses images (souffle de vent, vague, dénivelé), à pied et
 * fractionné ceux du 22/10. Chaque fond a sa taille de tuile et son
 * espacement (`scale`, qui agrandit la tuile sans épaissir le trait) ; l'encre
 * et l'épaisseur sont dans le CSS (`ui.css`, `.page-backdrop--<fond>`).
 */

export const TILE_W = 390;
export const TILE_H = 640;

/** Un tracé du motif : `dots` en pointillé, `fill` plein (repères), `major` plus épais ; `alpha` éclaircit son encre. */
export interface TilePath {
  d: string;
  kind?: 'dots' | 'fill' | 'major';
  alpha?: number;
}

/** Tuile d'un fond : ses tracés, sa taille, et l'espacement qui l'agrandit à l'écran. */
export interface BackdropTile {
  paths: TilePath[];
  width: number;
  height: number;
  scale: number;
}

const TAU = 2 * Math.PI;
const r1 = (v: number): number => Math.round(v * 10) / 10;

type Point = [number, number];

/** Ligne brisée fine d'une suite de points, en tracé SVG. */
const polyline = (points: readonly (readonly [number, number])[]): string =>
  points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${r1(x)} ${r1(y)}`).join('');

/** Points d'une fonction `y(x)` de `from` à `to`, tous les `step` pixels. */
const sampleX = (from: number, to: number, y: (x: number) => number, step = 6): Point[] => {
  const n = Math.max(1, Math.ceil((to - from) / step));
  return Array.from({ length: n + 1 }, (_, i) => {
    const x = from + ((to - from) * i) / n;
    return [x, y(x)];
  });
};

/** Suite pseudo-aléatoire fixe dans [0, 1[ : le motif est le même à chaque ouverture. */
const jitter = (n: number): number => {
  const v = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
};

// --- Courbes de niveau ---

/** Relief périodique : chaque terme fait un nombre entier d'ondes sur la tuile, dans les deux sens. */
const RELIEF: readonly { k: number; l: number; a: number; phase: number }[] = [
  { k: 1, l: 1, a: 1, phase: 0.3 },
  { k: 2, l: -1, a: 0.75, phase: 1.7 },
  { k: 1, l: 2, a: 0.6, phase: 4 },
  { k: 0, l: 1, a: 0.45, phase: 0.9 },
  { k: 3, l: 1, a: 0.32, phase: 2.2 },
  { k: 1, l: -3, a: 0.28, phase: 3.3 },
  { k: 2, l: 3, a: 0.2, phase: 5.1 },
];

export const reliefHeight = (x: number, y: number): number =>
  RELIEF.reduce((h, t) => h + t.a * Math.cos(TAU * ((t.k * x) / TILE_W + (t.l * y) / TILE_H) + t.phase), 0);

/** Pas de la grille des courbes de niveau, en pixels : il divise la largeur et la hauteur de chaque tuile. */
const GRID = 5;
/** Nombre de niveaux tracés ; une courbe sur `MAJOR_EVERY` est maîtresse (plus épaisse), comme sur une carte. */
const LEVELS = 16;
const MAJOR_EVERY = 4;

/** Hauteurs d'un relief aux nœuds de la grille d'une tuile `width` × `height`. */
const heightGrid = (h: (x: number, y: number) => number, width: number, height: number): number[][] =>
  Array.from({ length: height / GRID + 1 }, (_, j) => Array.from({ length: width / GRID + 1 }, (_, i) => h(i * GRID, j * GRID)));

/** Segments de la courbe de niveau `level` (carrés de proche en proche), aux bords exacts de la tuile. */
const isolineSegments = (heights: number[][], level: number): [Point, Point][] => {
  const ny = heights.length - 1;
  const nx = heights[0].length - 1;
  const segments: [Point, Point][] = [];
  const cross = (x0: number, y0: number, h0: number, x1: number, y1: number, h1: number): Point => {
    const t = (level - h0) / (h1 - h0);
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = i * GRID;
      const y = j * GRID;
      const a = heights[j][i]; // haut gauche
      const b = heights[j][i + 1]; // haut droit
      const c = heights[j + 1][i + 1]; // bas droit
      const d = heights[j + 1][i]; // bas gauche
      const code = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = () => cross(x, y, a, x + GRID, y, b);
      const right = () => cross(x + GRID, y, b, x + GRID, y + GRID, c);
      const bottom = () => cross(x, y + GRID, d, x + GRID, y + GRID, c);
      const left = () => cross(x, y, a, x, y + GRID, d);
      // Col (deux coins opposés au-dessus) : la moyenne du carré dit s'ils sont reliés.
      const centreHigh = (a + b + c + d) / 4 > level;
      switch (code) {
        case 1: case 14: segments.push([left(), bottom()]); break;
        case 2: case 13: segments.push([bottom(), right()]); break;
        case 3: case 12: segments.push([left(), right()]); break;
        case 4: case 11: segments.push([top(), right()]); break;
        case 6: case 9: segments.push([top(), bottom()]); break;
        case 7: case 8: segments.push([left(), top()]); break;
        case 5:
          if (centreHigh) segments.push([left(), top()], [bottom(), right()]);
          else segments.push([left(), bottom()], [top(), right()]);
          break;
        case 10:
          if (centreHigh) segments.push([left(), bottom()], [top(), right()]);
          else segments.push([left(), top()], [bottom(), right()]);
          break;
      }
    }
  }
  return segments;
};

/** Raboute les segments en lignes : un tracé plus court, et des jonctions sans rupture. */
const joinSegments = (segments: [Point, Point][]): Point[][] => {
  const key = ([x, y]: Point) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
  const byEnd = new Map<string, number[]>();
  segments.forEach(([p, q], i) => {
    for (const k of [key(p), key(q)]) {
      const list = byEnd.get(k);
      if (list) list.push(i);
      else byEnd.set(k, [i]);
    }
  });
  const used = new Set<number>();
  const next = (point: Point): Point | null => {
    for (const i of byEnd.get(key(point)) ?? []) {
      if (used.has(i)) continue;
      used.add(i);
      const [p, q] = segments[i];
      return key(p) === key(point) ? q : p;
    }
    return null;
  };
  const lines: Point[][] = [];
  segments.forEach(([p, q], i) => {
    if (used.has(i)) return;
    used.add(i);
    const line: Point[] = [p, q];
    for (let n = next(q); n; n = next(n)) line.push(n);
    for (let n = next(p); n; n = next(n)) line.unshift(n);
    lines.push(line);
  });
  return lines;
};

/** Tracé de la courbe de niveau `level` d'une grille de hauteurs. */
const isoline = (heights: number[][], level: number): string =>
  joinSegments(isolineSegments(heights, level)).map(polyline).join('');

/** Courbes de niveau de la tuile : les ordinaires puis les maîtresses. */
const contourTile = (): TilePath[] => {
  const heights = heightGrid(reliefHeight, TILE_W, TILE_H);
  const flat = heights.flat();
  const lo = Math.min(...flat);
  const hi = Math.max(...flat);
  const minor: string[] = [];
  const major: string[] = [];
  for (let n = 1; n <= LEVELS; n++) {
    const d = isoline(heights, lo + ((hi - lo) * n) / (LEVELS + 1));
    (n % MAJOR_EVERY === 0 ? major : minor).push(d);
  }
  return [{ d: minor.join('') }, { d: major.join(''), kind: 'major' }];
};

// --- Motifs des familles ---

/** Décalages d'une copie posée à côté de la tuile : ce qui dépasse d'un bord reprend à l'autre. */
const neighbours = (width: number, height: number): Point[] =>
  [[0, 0], [-width, 0], [width, 0], [0, -height], [0, height], [-width, -height]];

/**
 * Dessin isolé posé en `(x, y)` (tracé relatif après son point de départ), répété une tuile plus à gauche
 * et plus haut : ce qui dépasse à droite ou en bas reprend à gauche ou en haut.
 */
const wrappedShape = (x: number, y: number, relative: string): string =>
  [[0, 0], [-TILE_W, 0], [0, -TILE_H], [-TILE_W, -TILE_H]]
    .map(([dx, dy]) => `M${r1(x + dx)} ${r1(y + dy)}${relative}`).join('');

/**
 * Souffle de vent, d'après l'image de l'utilisateur (23/10) : quatre longs traits, dont l'un finit en
 * spirale. Tracés absolus dans un cadre de 1080 × 370, posés à l'échelle voulue par `placeSouffle`.
 */
const SOUFFLE = [
  'M8 5C150 110 380 190 568 190',
  'M262 28C380 120 560 145 700 160C820 172 910 210 915 270C918 330 860 365 780 366C700 368 668 320 680 285C690 255 730 240 770 250C795 256 808 265 817 278',
  'M322 213C400 232 470 240 547 242',
  'M665 70C760 115 880 130 960 165C1010 188 1050 215 1078 253',
];

/** Le souffle à l'échelle `s`, son coin en `(ox, oy)`, avec ses copies autour de la tuile. */
const placeSouffle = (ox: number, oy: number, s: number): string =>
  neighbours(TILE_W, TILE_H).map(([dx, dy]) =>
    SOUFFLE.map((d) => {
      let i = 0;
      return d.replace(/-?\d+(\.\d+)?/g, (n) => String(r1(i++ % 2 === 0 ? ox + dx + Number(n) * s : oy + dy + Number(n) * s)));
    }).join('')).join('');

/** Voile : trois souffles de tailles différentes par tuile, beaucoup de vide autour. */
const voileTile = (): TilePath[] => [{ d: placeSouffle(24, 70, 0.3) + placeSouffle(150, 360, 0.24) + placeSouffle(-60, 540, 0.2) }];

/** À pied : chemins pointillés qui serpentent, des repères ronds et des fanions posés dessus. */
const courseTile = (): TilePath[] => {
  const dots: string[] = [];
  const marks: string[] = [];
  const flags: string[] = [];
  const rows = 6;
  for (let row = 0; row < rows; row++) {
    const y0 = ((row + 0.5) * TILE_H) / rows;
    const phase = row * 2.1;
    const y = (x: number) => y0 + 22 * Math.sin((TAU * x) / TILE_W + phase) + 9 * Math.sin((2 * TAU * x) / TILE_W + phase * 0.7);
    dots.push(polyline(sampleX(0, TILE_W, y, 4)));
    const xm = jitter(row) * TILE_W;
    marks.push(wrappedShape(xm + 6, y(xm), 'a6 6 0 1 0 -12 0a6 6 0 1 0 12 0'));
    const xf = (xm + 150 + jitter(row + 9) * 90) % TILE_W;
    flags.push(wrappedShape(xf, y(xf), 'l0 -26l18 7l-18 7'));
  }
  return [{ d: dots.join(''), kind: 'dots' }, { d: marks.join(''), kind: 'fill' }, { d: flags.join('') }];
};

/** Tuile du vélo : grande, pour que ses courbes restent peu nombreuses à l'écran. */
const VELO_W = 780;
const VELO_H = 1280;
const VELO_LEVELS = 11;

/**
 * Relief du vélo, d'après l'image de l'utilisateur (23/10) : un sinus en largeur que deux ondes en hauteur
 * déforment, d'où des courbes de niveau ouvertes en grands lacets ; périodique sur la tuile, dans les deux sens.
 */
export const veloHeight = (x: number, y: number): number =>
  Math.sin(TAU * x / VELO_W + 3 * Math.sin(TAU * y / VELO_H + 1) + 1.2 * Math.sin(TAU * (x / VELO_W + 2 * y / VELO_H) + 2.5));

/** Vélo : courbes de dénivelé, à niveaux égaux entre −1 et 1. */
const veloTile = (): TilePath[] => {
  const heights = heightGrid(veloHeight, VELO_W, VELO_H);
  const lines = Array.from({ length: VELO_LEVELS }, (_, n) => isoline(heights, -1 + (2 * (n + 0.5)) / VELO_LEVELS));
  return [{ d: lines.join('') }];
};

/** Tuile du surf : une seule vague par tuile, donc à peu près une par écran. */
const SURF_W = 600;
const SURF_H = 520;

/**
 * Lignes de la vague, d'après l'image de l'utilisateur (23/10), dans un repère de 1520 × 1250 : droites à
 * gauche, elles montent en colline puis tournent d'un quart de cercle vers le bas autour d'un même centre.
 * Cette carte polaire est injective : des lignes qui ne se croisent pas avant le virage ne se croisent pas
 * après. Les lignes du bas finissent par un crochet ; l'encre croît de la plus haute à la plus basse.
 */
const vagueLines = (): { points: Point[]; hook: number; alpha: number }[] => {
  const n = 9;
  const [top, gap, hill, u0, cy, radius, firstHook] = [490, 85, 480, 750, 1250, 400, 5];
  const swell = (u: number) =>
    Math.exp(-(((u - 370) / 200) ** 2)) + 0.32 * Math.exp(-(((u - 730) / 85) ** 2))
    + 0.26 * Math.exp(-(((u - 1000) / 95) ** 2)) + 0.2 * Math.exp(-(((u - 1230) / 85) ** 2));
  return Array.from({ length: n }, (_, k) => {
    const v = top + k * gap;
    const amp = hill * ((n - 1 - k) / (n - 1)) ** 1.4 + 25;
    const points: Point[] = [];
    for (let u = 0; u <= u0 + (radius * Math.PI) / 2; u += 8) {
      const vv = v - amp * swell(u);
      if (u <= u0) points.push([u, vv]);
      else {
        const rho = cy - vv;
        const phi = (u - u0) / radius;
        points.push([u0 + rho * Math.sin(phi), cy - rho * Math.cos(phi)]);
      }
    }
    return { points, hook: k >= firstHook ? 0.7 + 0.5 * jitter(k) : 0, alpha: 0.45 + (0.55 * k) / (n - 1) };
  });
};

/** Surf : la vague à l'échelle 0,4 dans sa tuile, avec ses copies autour. */
const surfTile = (): TilePath[] => {
  const [ox, oy, s] = [0, 4, 0.4];
  return vagueLines().map(({ points, hook, alpha }) => ({
    alpha,
    d: neighbours(SURF_W, SURF_H).slice(0, 5).map(([dx, dy]) => {
      let d = polyline(points.map(([x, y]) => [ox + dx + x * s, oy + dy + y * s]));
      if (hook) {
        const c = (...v: number[]) => v.map((q) => r1(q * s * hook)).join(' ');
        d += `c${c(0, 30, -14, 44, -36, 40)}c${c(-20, -4, -18, -28, 4, -26)}`;
      }
      return d;
    }).join(''),
  }));
};

/** Fractionné : rafales de trois traits de vitesse en diagonale, en quinconce. */
const fractionneTile = (): TilePath[] => {
  const paths: string[] = [];
  const [ux, uy] = [0.83, -0.55];
  const cols = 3;
  const rows = 5;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x0 = (col * TILE_W) / cols + (row % 2) * 50 + jitter(row * cols + col) * 20;
      const y0 = (row * TILE_H) / rows + 80;
      [[0, 0, 54], [16, 11, 84], [42, 16, 38]].forEach(([dx, dy, len]) => {
        paths.push(wrappedShape(x0 + dx, y0 + dy, `l${r1(ux * len)} ${r1(uy * len)}`));
      });
    }
  }
  return [{ d: paths.join('') }];
};

export type BackdropVariant = 'contours' | SportFamily;

/** Dessin, taille de tuile et espacement de chaque fond, réglés à l'œil par l'utilisateur sur la maquette du 23/10. */
const BACKDROPS: Record<BackdropVariant, { draw: () => TilePath[]; width: number; height: number; scale: number }> = {
  contours: { draw: contourTile, width: TILE_W, height: TILE_H, scale: 1 },
  voile: { draw: voileTile, width: TILE_W, height: TILE_H, scale: 0.9 },
  course: { draw: courseTile, width: TILE_W, height: TILE_H, scale: 1.3 },
  velo: { draw: veloTile, width: VELO_W, height: VELO_H, scale: 1.8 },
  surf: { draw: surfTile, width: SURF_W, height: SURF_H, scale: 0.9 },
  fractionne: { draw: fractionneTile, width: TILE_W, height: TILE_H, scale: 1 },
};

/** Tuile d'un fond ; ses tracés sont calculés une fois, à la première demande. */
const cache = new Map<BackdropVariant, BackdropTile>();
export const backdropTile = (variant: BackdropVariant): BackdropTile => {
  let tile = cache.get(variant);
  if (!tile) {
    const { draw, width, height, scale } = BACKDROPS[variant];
    tile = { paths: draw(), width, height, scale };
    cache.set(variant, tile);
  }
  return tile;
};
