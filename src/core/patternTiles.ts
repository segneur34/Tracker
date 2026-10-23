import type { SportFamily } from './sportProfiles';

/**
 * Tuiles des fonds de page (`components/PageBackdrop.tsx`), en pixels, à
 * l'échelle 1 : la tuile se répète en largeur et en hauteur, si bien que la
 * densité du fond ne dépend ni de la longueur de la page ni de la largeur de
 * l'écran (avant le 22/10, un seul dessin étiré sur toute la page grossissait
 * et s'éclaircissait sur une longue liste).
 *
 * Chaque tracé se raccorde à lui-même d'un bord à l'autre : les courbes de
 * niveau sont celles d'un relief périodique dans les deux sens, les lignes
 * des motifs de famille des fonctions périodiques de la largeur (ou de la
 * hauteur pour les lacets du vélo), et les dessins isolés (volutes, repères,
 * traits de vitesse) restent loin des bords.
 */

export const TILE_W = 390;
export const TILE_H = 640;

/** Un tracé du motif : `dots` en pointillé, `fill` plein (repères). */
export interface TilePath {
  d: string;
  kind?: 'dots' | 'fill' | 'major';
}

const TAU = 2 * Math.PI;
const r1 = (v: number): number => Math.round(v * 10) / 10;

/** Ligne brisée fine d'une suite de points, en tracé SVG. */
const polyline = (points: readonly (readonly [number, number])[]): string =>
  points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${r1(x)} ${r1(y)}`).join('');

/** Points d'une fonction `y(x)` de `from` à `to`, tous les `step` pixels. */
const sampleX = (from: number, to: number, y: (x: number) => number, step = 6): [number, number][] => {
  const n = Math.max(1, Math.ceil((to - from) / step));
  return Array.from({ length: n + 1 }, (_, i) => {
    const x = from + ((to - from) * i) / n;
    return [x, y(x)];
  });
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

/** Pas de la grille des courbes de niveau, en pixels : il divise la largeur et la hauteur de la tuile. */
const GRID = 5;
/** Nombre de niveaux tracés ; une courbe sur `MAJOR_EVERY` est maîtresse (plus épaisse), comme sur une carte. */
const LEVELS = 16;
const MAJOR_EVERY = 4;

type Point = [number, number];

/** Segments de la courbe de niveau `level` (carrés de proche en proche), aux bords exacts de la tuile. */
const isolineSegments = (heights: number[][], level: number): [Point, Point][] => {
  const nx = TILE_W / GRID;
  const ny = TILE_H / GRID;
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
    for (const k of [key(p), key(q)]) byEnd.set(k, [...(byEnd.get(k) ?? []), i]);
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

/** Courbes de niveau de la tuile : les ordinaires puis les maîtresses. */
export const contourTile = (): TilePath[] => {
  const heights = Array.from({ length: TILE_H / GRID + 1 }, (_, j) =>
    Array.from({ length: TILE_W / GRID + 1 }, (_, i) => reliefHeight(i * GRID, j * GRID)));
  const flat = heights.flat();
  const lo = Math.min(...flat);
  const hi = Math.max(...flat);
  const minor: string[] = [];
  const major: string[] = [];
  for (let n = 1; n <= LEVELS; n++) {
    const level = lo + ((hi - lo) * n) / (LEVELS + 1);
    const d = joinSegments(isolineSegments(heights, level)).map(polyline).join('');
    (n % MAJOR_EVERY === 0 ? major : minor).push(d);
  }
  return [{ d: minor.join('') }, { d: major.join(''), kind: 'major' }];
};

// --- Motifs des familles ---

/** Ligne `y0 + houle(x)` sur `[from, to]`, coupée en deux au bord droit si elle le passe (la suite reprend à gauche). */
const wrappedLine = (from: number, to: number, y: (x: number) => number): string => {
  if (to <= TILE_W) return polyline(sampleX(from, to, y));
  return polyline(sampleX(from, TILE_W, y)) + polyline(sampleX(0, to - TILE_W, y));
};

/** Suite pseudo-aléatoire fixe dans [0, 1[ : le motif est le même à chaque ouverture. */
const jitter = (n: number): number => {
  const v = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * Dessin isolé posé en `(x, y)` (tracé relatif après son point de départ), répété une tuile plus à gauche
 * et plus haut : ce qui dépasse à droite ou en bas reprend à gauche ou en haut.
 */
const wrappedShape = (x: number, y: number, relative: string): string =>
  [[0, 0], [-TILE_W, 0], [0, -TILE_H], [-TILE_W, -TILE_H]]
    .map(([dx, dy]) => `M${r1(x + dx)} ${r1(y + dy)}${relative}`).join('');

/** Volute au bout d'une ligne de vent, qui part vers la droite et s'enroule vers le haut. */
const curl = (x: number, y: number, size: number): string => {
  const s = size / 44;
  const c = (...v: number[]) => v.map((n) => r1(n * s)).join(' ');
  return wrappedShape(x, y, `c${c(30, -6, 34, -40, 4, -44)}c${c(-30, -4, -36, 30, -6, 34)}`);
};

/** Voile : lignes de vent ondulées en rangs serrés, interrompues, une sur deux finissant en volute. */
const voileTile = (): TilePath[] => {
  const paths: string[] = [];
  for (let row = 0; row < 16; row++) {
    const y0 = 20 + row * 40;
    const phase = row * 1.3;
    const k = row % 3 === 0 ? 2 : 1;
    const wave = (x: number) => y0 + 7 * Math.sin((TAU * k * x) / TILE_W + phase);
    const start = jitter(row) * TILE_W;
    const first = 110 + jitter(row + 50) * 90;
    const gap = 30 + jitter(row + 100) * 40;
    const second = TILE_W - first - 2 * gap;
    // Deux brins par rang ; le premier finit en volute un rang sur deux.
    paths.push(wrappedLine(start, start + first, wave));
    paths.push(wrappedLine(start + first + gap, start + first + gap + second, wave));
    if (row % 2 === 1) {
      const xe = (start + first) % TILE_W;
      paths.push(curl(xe, wave(xe), 22));
    }
  }
  return [{ d: paths.join('') }];
};

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

/** Vélo : quatre routes en lacets qui montent la page, chacune à deux bords. */
const veloTile = (): TilePath[] => {
  const paths: string[] = [];
  const roads = 4;
  for (let n = 0; n < roads; n++) {
    const x0 = ((n + 0.5) * TILE_W) / roads;
    const phase = n * 2.2;
    const x = (y: number, dx: number) => {
      const t = (2 * TAU * y) / TILE_H + phase;
      return x0 + dx + 30 * (Math.sin(t) + 0.25 * Math.sin(3 * t));
    };
    for (const dx of [-5, 5]) {
      const points: Point[] = Array.from({ length: TILE_H / 4 + 1 }, (_, i) => [x(i * 4, dx), i * 4]);
      paths.push(polyline(points));
    }
  }
  return [{ d: paths.join('') }];
};

/** Surf : houle en rangs serrés, décalés d'une demi-onde d'un rang à l'autre, quelques crêtes qui déferlent. */
const surfTile = (): TilePath[] => {
  const paths: string[] = [];
  const crests: string[] = [];
  const wavelength = TILE_W / 6;
  for (let row = 0; row < 16; row++) {
    const y0 = 20 + row * 40;
    const amp = row % 2 === 0 ? 11 : 7;
    const shift = row % 2 === 0 ? 0 : wavelength / 2;
    // Une demi-onde par segment (bosse puis creux) : sept ondes couvrent la tuile, décalage compris.
    const half = r1(wavelength / 2);
    paths.push(`M${r1(-shift)} ${y0}q${r1(wavelength / 4)} ${-amp} ${half} 0` + `t${half} 0`.repeat(13));
    if (row % 3 === 1) {
      const xc = shift + wavelength * ((row * 2) % 5) + wavelength / 4 + 4;
      crests.push(`M${r1(xc)} ${y0 - amp}c8 -4 16 0 14 7c-2 5 -9 4 -9 0`);
    }
  }
  return [{ d: paths.join('') + crests.join('') }];
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

const FAMILY_TILES: Record<SportFamily, () => TilePath[]> = {
  voile: voileTile,
  course: courseTile,
  velo: veloTile,
  surf: surfTile,
  fractionne: fractionneTile,
};

export type BackdropVariant = 'contours' | SportFamily;

/** Tracés de la tuile d'un fond ; calculés une fois, à la première demande. */
const cache = new Map<BackdropVariant, TilePath[]>();
export const backdropTile = (variant: BackdropVariant): TilePath[] => {
  let tile = cache.get(variant);
  if (!tile) {
    tile = variant === 'contours' ? contourTile() : FAMILY_TILES[variant]();
    cache.set(variant, tile);
  }
  return tile;
};
