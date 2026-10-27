import { partitionPoint } from './search';
import { clamp } from './basics';

/**
 * Géométrie de la racine du Profil (`components/ProfileRoot.tsx`), en pixels
 * de la page, sans dessin : le canevas est l'affaire de `components/drawRoot.ts`.
 *
 * Du carré à droite du pseudo, la racine descend dans la marge de droite, puis
 * serpente d'un intervalle entre cadres à l'autre (au-dessus du premier cadre
 * vers la gauche, le long de son côté gauche, sous lui vers la droite…) ; à
 * chaque virage, une branche continue tout droit et ferme le côté resté libre
 * du cadre, si bien qu'au tour complet chaque cadre est entouré. Le long de la
 * racine et de ses branches partent des ramifications (racines latérales et
 * sous-racines) qui plongent vers le bas et s'arrêtent au bord d'un cadre.
 *
 * Sa longueur, elle, ne suit pas la page (26/10) : une étape fait avancer la
 * racine d'une longueur fixe, tirée d'une page de référence (`tourLength`), si
 * bien qu'elle a la même taille quelle que soit la période affichée, dont
 * dépend la hauteur des cadres. Plus courte que cette référence, la page
 * prolonge la racine d'une queue sous le dernier cadre (`tail`).
 *
 * Tout est tiré d'un hasard reproductible : la même page donne la même racine
 * d'une ouverture à l'autre. Maquette validée le 22/10 (ondulation 6,
 * ramifications 1,4, épaisseur 2,8).
 */

/** Rectangle en pixels de la page : gauche, haut, droite, bas. */
export interface Box {
  x: number;
  y: number;
  r: number;
  b: number;
}

/** Point d'un tracé : abscisse curviligne `s` depuis son départ, tangente unitaire. */
export interface RootPoint {
  x: number;
  y: number;
  s: number;
  tx: number;
  ty: number;
}

export type RootPieceKind = 'trunk' | 'branch' | 'lateral' | 'sub';

export interface RootPiece {
  pts: RootPoint[];
  len: number;
  kind: RootPieceKind;
  /** Indice du morceau qui le porte, −1 pour la racine mère. */
  parent: number;
  /** Abscisse de son départ sur le morceau qui le porte. */
  base: number;
  /** Longueur dont le porteur doit dépasser `base` avant qu'il ne pousse. */
  delay: number;
  /** Vitesse de pousse rapportée à celle du porteur. */
  rate: number;
  /** Tirage qui décide s'il est montré à une densité de ramifications donnée. */
  q: number;
  /** Ramification de la racine mûre : tirage de son apparition après le tour, `null` sinon. */
  extra: number | null;
}

/** Radicelle de la semaine : place et forme tirées une fois pour toutes. */
export interface Rootlet {
  /** Place le long de la racine visible, de 0 à 1. */
  u: number;
  ang: number;
  len: number;
  bend: number;
  side: 1 | -1;
  hairs: number;
}

export interface RootModel {
  pieces: RootPiece[];
  /** Les `mains` premiers morceaux : la racine mère et ses branches. */
  mains: number;
  /** Longueur de la racine mère et des branches au tour complet, depuis la graine. */
  reach: number;
  /** Longueur de la racine mère au tour complet (26 étapes) : celle de la page de référence, la même quelle que soit la période. */
  tour: number;
  /** Point le plus bas de la racine mère : la page doit descendre au moins jusque-là. */
  bottom: number;
  rootlets: Rootlet[];
  /** Point de la graine, sur la ligne de sol du carré. */
  seed: { x: number; y: number };
  slot: Box;
  cards: Box[];
}

/** Disposition lue sur la page : le carré, et les cadres dans l'ordre de la page. */
export interface RootLayout {
  slot: Box;
  cards: Box[];
}

export interface RootStyle {
  /** Amplitude de l'ondulation, en pixels. */
  wobble: number;
  /** Densité des ramifications, de 0 (aucune) à 2 (toutes). */
  ramifications: number;
  /** Épaisseur de la racine mère, en pixels. */
  thickness: number;
}

/** Réglages du dessin retenus sur la maquette du 22/10. */
export const ROOT_STYLE: RootStyle = { wobble: 6, ramifications: 1.4, thickness: 2.8 };

/** Une radicelle par tranche de ce nombre de minutes d'activité dans la période. */
export const ROOTLET_MINUTES = 5;
export const MAX_ROOTLETS = 120;
/** Longueur de la racine à la graine (niveau 0) : un bout de racine sous le sol. */
export const ROOT_SEED_LENGTH = 20;
/** Rayon des coins des cadres (`--radius-l`). */
const CARD_RADIUS = 16;
const STEP = 2.5;
const TAU = Math.PI * 2;

/** Hasard reproductible. */
export const seededRandom = (seed: number) => {
  let a = seed;
  return (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};


interface Vertex {
  x: number;
  y: number;
}

/** Tangentes unitaires d'une suite de points (différence centrée). */
const withTangents = (pts: readonly { x: number; y: number; s: number }[]): RootPoint[] =>
  pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: p.x, y: p.y, s: p.s, tx: (b.x - a.x) / tl, ty: (b.y - a.y) / tl };
  });

/** Ligne brisée aux coins arrondis (courbe de Bézier au coin, de rayon `radii[i]`), échantillonnée tous les 2,5 px. */
export const sampleRoute = (vertices: readonly Vertex[], radii: readonly number[]): RootPoint[] => {
  const out: { x: number; y: number; s: number }[] = [{ x: vertices[0].x, y: vertices[0].y, s: 0 }];
  const push = (x: number, y: number) => {
    const last = out[out.length - 1];
    out.push({ x, y, s: last.s + Math.hypot(x - last.x, y - last.y) });
  };
  const line = (a: Vertex, b: Vertex) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 0.01) return;
    const n = Math.max(1, Math.ceil(length / STEP));
    for (let i = 1; i <= n; i++) push(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n);
  };
  const quad = (a: Vertex, c: Vertex, b: Vertex) => {
    const length = Math.hypot(c.x - a.x, c.y - a.y) + Math.hypot(b.x - c.x, b.y - c.y);
    const n = Math.max(2, Math.ceil(length / STEP));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      push(u * u * a.x + 2 * u * t * c.x + t * t * b.x, u * u * a.y + 2 * u * t * c.y + t * t * b.y);
    }
  };
  let cur = vertices[0];
  for (let i = 1; i < vertices.length; i++) {
    const v = vertices[i];
    if (i < vertices.length - 1 && radii[i] > 0) {
      const a = vertices[i - 1];
      const b = vertices[i + 1];
      const la = Math.hypot(v.x - a.x, v.y - a.y);
      const lb = Math.hypot(b.x - v.x, b.y - v.y);
      if (la < 0.01 || lb < 0.01) { line(cur, v); cur = v; continue; }
      // Un coin prend au plus la moitié d'un côté partagé avec un autre coin.
      const r = Math.min(radii[i], la * (i === 1 ? 0.95 : 0.5), lb * (i === vertices.length - 2 ? 0.95 : 0.5));
      const p1 = { x: v.x - ((v.x - a.x) / la) * r, y: v.y - ((v.y - a.y) / la) * r };
      const p2 = { x: v.x + ((b.x - v.x) / lb) * r, y: v.y + ((b.y - v.y) / lb) * r };
      line(cur, p1);
      quad(p1, v, p2);
      cur = p2;
    } else {
      line(cur, v);
      cur = v;
    }
  }
  return withTangents(out);
};

/**
 * Ondulation le long de la normale, somme de quatre sinus de longueurs d'onde
 * 47 à 5 px ; `rampIn` et `rampOut` l'éteignent aux bouts, pour qu'une branche
 * s'attache sur sa racine mère et la rejoigne.
 */
const wobble = (pts: readonly RootPoint[], amp: number, seed: number, s0: number, rampIn: number, rampOut: number): RootPoint[] => {
  const rng = seededRandom(seed);
  const ph = [rng() * TAU, rng() * TAU, rng() * TAU, rng() * TAU];
  const len = pts[pts.length - 1].s;
  return withTangents(pts.map((p) => {
    const g = s0 + p.s;
    const n = 0.4 * Math.sin(g / 47 + ph[3]) + 0.35 * Math.sin(g / 23 + ph[0]) + 0.17 * Math.sin(g / 10.3 + ph[1]) + 0.08 * Math.sin(g / 4.7 + ph[2]);
    let k = 1;
    if (rampIn > 0) k = Math.min(k, p.s / rampIn);
    if (rampOut > 0) k = Math.min(k, (len - p.s) / rampOut);
    const d = amp * n * Math.max(0, k);
    return { x: p.x - p.ty * d, y: p.y + p.tx * d, s: p.s };
  }));
};

interface Route {
  seed: Vertex;
  trunk: { vertices: Vertex[]; radii: number[] };
  branches: { vertices: Vertex[]; radii: number[] }[];
}

/**
 * Chemin de la racine mère et des branches qui ferment les cadres, sans
 * ondulation. `null` sans cadre. La marge de la racine est la moitié de la
 * gouttière de la page, 10 px au plus. `tail` : longueur ajoutée sous le
 * dernier cadre, le long de la marge, quand la page est plus courte que la
 * page de référence.
 */
export const rootRoute = ({ slot, cards }: RootLayout, tail = 0): Route | null => {
  if (cards.length === 0) return null;
  const left = Math.min(...cards.map((c) => c.x));
  const right = Math.max(...cards.map((c) => c.r));
  const o = clamp(left / 2, 2, 10);
  const lane = (side: number) => (side > 0 ? right + o : left - o);
  const rc = CARD_RADIUS + o;
  // Graine à droite du carré, à mi-hauteur : son chiffre est en bas à gauche.
  const seed = { x: slot.x + (slot.r - slot.x) * 0.68, y: slot.y + (slot.b - slot.y) * 0.42 };
  const yA = (slot.b + cards[0].y) / 2;
  const vertices: Vertex[] = [seed, { x: seed.x, y: yA }, { x: lane(1), y: yA }];
  const radii = [0, 9, 9];
  const branches: Route['branches'] = [];
  let side = 1;
  const yB = cards[cards.length - 1].b + o;
  for (let k = 0; k + 1 < cards.length; k++) {
    const gap = (cards[k].b + cards[k + 1].y) / 2;
    vertices.push({ x: lane(side), y: gap }, { x: lane(-side), y: gap });
    radii.push(rc, rc);
    // Le côté `side` du cadre k + 1 reste libre : une branche le longe jusqu'au virage suivant.
    const x = lane(side);
    if (k + 2 < cards.length) {
      const next = (cards[k + 1].b + cards[k + 2].y) / 2;
      branches.push({ vertices: [{ x, y: gap - rc }, { x, y: next + rc * 0.55 }], radii: [0, 0] });
    } else {
      branches.push({ vertices: [{ x, y: gap - rc }, { x, y: yB }, { x: x - side * 16, y: yB }], radii: [0, 12, 0] });
    }
    side = -side;
  }
  vertices.push({ x: lane(side), y: yB }, { x: lane(-side) + side * 2, y: yB });
  radii.push(rc, 0);
  if (tail > 0) {
    const end = vertices[vertices.length - 1];
    radii[radii.length - 1] = 12;
    vertices.push({ x: end.x, y: end.y + tail });
    radii.push(0);
  }
  return { seed, trunk: { vertices, radii }, branches };
};

/**
 * Hauteurs des quatre cadres du Profil (périodes, chiffres, répartition,
 * graphe) sur la page de référence : le Profil en période « Année » à 390 px
 * (relevé du 27/10 : 34, 178, 318 et 273 px, gouttière de 20 px). Elles fixent
 * la longueur d'un tour de racine ; la racine y a l'allure qu'elle avait à
 * cette période avant que la longueur cesse de suivre la page.
 */
export const REFERENCE_CARD_HEIGHTS: readonly number[] = [34, 178, 318, 273];
/** Gouttière entre deux cadres de la page de référence. */
export const REFERENCE_GAP = 20;

const routeLength = (route: Route): number => sampleRoute(route.trunk.vertices, route.trunk.radii).at(-1)!.s;

/**
 * Longueur de la racine mère au tour complet : celle de la page de référence,
 * qui garde du réel la largeur de la colonne, le carré et le haut du premier
 * cadre, et pour le reste des cadres de hauteur fixe. `null` sans cadre.
 */
export const tourLength = ({ slot, cards }: RootLayout, heights: readonly number[] = REFERENCE_CARD_HEIGHTS): number | null => {
  if (cards.length === 0) return null;
  const x = Math.min(...cards.map((c) => c.x));
  const r = Math.max(...cards.map((c) => c.r));
  let y = cards[0].y;
  const reference = heights.map((h): Box => {
    const box = { x, y, r, b: y + h };
    y += h + REFERENCE_GAP;
    return box;
  });
  const route = rootRoute({ slot, cards: reference });
  return route ? routeLength(route) : null;
};

/** Point dans un cadre, à `inset` pixels de son bord au moins (négatif : tout autour du cadre). */
export const inCard = (cards: readonly Box[], x: number, y: number, inset: number): boolean =>
  cards.some((c) => x > c.x + inset && x < c.r - inset && y > c.y + inset && y < c.b - inset);

/** Indice du premier point d'abscisse au moins `s`. */
export const indexAt = (pts: readonly RootPoint[], s: number): number => {
  return Math.max(0, Math.min(pts.length - 1, partitionPoint(pts.length, (i) => pts[i].s < s)));
};

/** Côté libre d'un point de racine : +1 ou −1 selon la normale, 0 si des cadres sont des deux côtés. */
export const freeSide = (cards: readonly Box[], p: RootPoint, rng: () => number): -1 | 0 | 1 => {
  const nx = -p.ty;
  const ny = p.tx;
  const a = inCard(cards, p.x + nx * 8, p.y + ny * 8, -1);
  const b = inCard(cards, p.x - nx * 8, p.y - ny * 8, -1);
  if (a && b) return 0;
  if (a) return -1;
  if (b) return 1;
  return rng() < 0.5 ? 1 : -1;
};

/**
 * Ramification partie de `parent` à l'abscisse `s`, du côté libre, vers
 * l'avant ; elle s'enroule doucement et plonge vers le bas comme une vraie
 * racine, et s'arrête à 3 px dans un cadre.
 */
const lateral = (parent: RootPiece, s: number, rng: () => number, cards: readonly Box[], sub: boolean): RootPiece | null => {
  const p = parent.pts[indexAt(parent.pts, s)];
  const side = freeSide(cards, p, rng);
  if (side === 0) return null;
  const nx = -p.ty * side;
  const ny = p.tx * side;
  const ang = (sub ? 0.6 : 0.45) + rng() * 0.6;
  let dx = p.tx * Math.cos(ang) + nx * Math.sin(ang);
  let dy = p.ty * Math.cos(ang) + ny * Math.sin(ang);
  const len = sub ? 5 + rng() * 10 : 16 + rng() * 34;
  const ph = rng() * TAU;
  const curl = 0.05 + rng() * 0.07;
  const pts = [{ x: p.x, y: p.y, s: 0 }];
  let x = p.x;
  let y = p.y;
  for (let d = STEP; d <= len; d += STEP) {
    const turn = curl * Math.sin(d / 6 + ph);
    const c = Math.cos(turn);
    const sn = Math.sin(turn);
    [dx, dy] = [dx * c - dy * sn, dx * sn + dy * c];
    dy += 0.02;
    const l = Math.hypot(dx, dy);
    dx /= l;
    dy /= l;
    x += dx * STEP;
    y += dy * STEP;
    if (d > 4 && inCard(cards, x, y, 3)) break;
    pts.push({ x, y, s: d });
  }
  if (pts.length < 3) return null;
  return {
    pts: withTangents(pts), len: pts[pts.length - 1].s, kind: sub ? 'sub' : 'lateral', parent: -1,
    base: s, delay: sub ? 3 : 10 + rng() * 25, rate: sub ? 0.5 : 0.26 + rng() * 0.16, q: rng(), extra: null,
  };
};

/**
 * Racine complète d'une disposition : racine mère, branches, ramifications
 * tirées à la densité la plus forte (le style n'en montre qu'une part, sans
 * retirer au hasard), places des radicelles. `null` sans cadre.
 */
export const buildRootModel = (
  layout: RootLayout, style: RootStyle = ROOT_STYLE, referenceHeights: readonly number[] = REFERENCE_CARD_HEIGHTS,
): RootModel | null => {
  let route = rootRoute(layout);
  const tour = tourLength(layout, referenceHeights);
  if (!route || tour === null) return null;
  // Une page plus courte que la référence prolonge la racine sous son dernier cadre, jusqu'à la longueur du tour.
  let have = routeLength(route);
  let tail = 0;
  for (let k = 0; k < 3 && have < tour - 0.5; k++) {
    tail += tour - have;
    route = rootRoute(layout, tail)!;
    have = routeLength(route);
  }
  const { cards } = layout;
  const seed = 7;
  const rawTrunk = sampleRoute(route.trunk.vertices, route.trunk.radii);
  const trunk: RootPiece = {
    pts: wobble(rawTrunk, style.wobble, seed, 0, 25, 0), len: rawTrunk[rawTrunk.length - 1].s,
    kind: 'trunk', parent: -1, base: 0, delay: 0, rate: 1, q: 0, extra: null,
  };
  const pieces: RootPiece[] = [trunk];
  route.branches.forEach((branch, j) => {
    // Départ sur la racine mère telle qu'ondulée, au point le plus proche du départ prévu.
    let bi = 0;
    let best = Infinity;
    rawTrunk.forEach((p, i) => {
      const d = Math.hypot(p.x - branch.vertices[0].x, p.y - branch.vertices[0].y);
      if (d < best) { best = d; bi = i; }
    });
    const raw = sampleRoute([{ x: trunk.pts[bi].x, y: trunk.pts[bi].y }, ...branch.vertices.slice(1)], branch.radii);
    pieces.push({
      pts: wobble(raw, style.wobble * 0.8, seed + 11 * (j + 1), rawTrunk[bi].s, 18, 18), len: raw[raw.length - 1].s,
      kind: 'branch', parent: 0, base: rawTrunk[bi].s, delay: 0, rate: 1, q: 0, extra: null,
    });
  });
  const mains = pieces.length;
  const rng = seededRandom(seed * 7 + 1);
  for (let m = 0; m < mains; m++) {
    const piece = pieces[m];
    for (const extra of [false, true]) {
      for (let s = 18 + rng() * 25; s < piece.len - 8; s += 34 * (0.6 + 0.8 * rng())) {
        const lat = lateral(piece, s, rng, cards, false);
        if (!lat) continue;
        lat.parent = m;
        if (extra) lat.extra = rng();
        const li = pieces.push(lat) - 1;
        const subs = lat.len > 22 ? 1 + (rng() < 0.55 ? 1 : 0) : 0;
        for (let k = 0; k < subs; k++) {
          const sub = lateral(lat, lat.len * (0.3 + 0.45 * rng()), rng, cards, true);
          if (sub) {
            sub.parent = li;
            pieces.push(sub);
          }
        }
      }
    }
  }
  const rr = seededRandom(4242);
  const rootlets: Rootlet[] = Array.from({ length: MAX_ROOTLETS }, () => ({
    u: rr(), ang: 0.7 + rr() * 0.7, len: 9 + rr() * 11, bend: rr() - 0.5, side: (rr() < 0.5 ? 1 : -1) as 1 | -1, hairs: rr(),
  }));
  return {
    pieces, mains, reach: Math.max(...pieces.slice(0, mains).map((p) => p.base + p.len)),
    tour, bottom: Math.max(...trunk.pts.map((p) => p.y)),
    rootlets, seed: route.seed, slot: layout.slot, cards,
  };
};

/**
 * Longueur visible de chaque morceau au niveau `level` (en étapes, le tour
 * complet en `growthSteps`), `null` pour un morceau caché. La racine mère
 * avance d'autant à chaque étape ; une ramification ne pousse qu'une fois son
 * porteur passé, plus lentement que lui ; celles de la racine mûre
 * n'apparaissent qu'après le tour.
 */
export const rootVisibility = (model: RootModel, level: number, growthSteps: number, ramifications: number): (number | null)[] => {
  const steps = Math.max(1, growthSteps);
  const step = (model.tour - ROOT_SEED_LENGTH) / steps;
  const front = ROOT_SEED_LENGTH + step * Math.max(0, level);
  const vis: (number | null)[] = new Array(model.pieces.length);
  model.pieces.forEach((piece, i) => {
    if (piece.parent < 0) { vis[i] = front; return; }
    const pv = vis[piece.parent];
    if (pv === null || pv < piece.base) { vis[i] = null; return; }
    if (piece.kind === 'lateral' && piece.q >= ramifications / 2) { vis[i] = null; return; }
    if (piece.extra !== null) {
      const from = steps * (1.04 + piece.extra * 0.6);
      vis[i] = level > from ? (level - from) * step * piece.rate * 1.2 : null;
      return;
    }
    const v = (pv - piece.base - piece.delay) * piece.rate;
    vis[i] = v > 0 ? v : null;
  });
  return vis;
};

/** Épaississement de la racine mûre : 1 jusqu'au tour, puis jusqu'à 1,6. */
export const rootMaturity = (level: number, growthSteps: number): number => {
  const over = Math.max(0, level - growthSteps) / Math.max(1, growthSteps);
  return 1 + 0.6 * (1 - Math.exp(-over * 1.45));
};

/** Radicelle placée sur la racine visible. */
export interface PlacedRootlet {
  rootlet: Rootlet;
  /** Point d'attache et tangente de la racine. */
  at: RootPoint;
  /** Côté de la normale où elle pousse. */
  side: 1 | -1;
  /** Part poussée, de 0 à 1 (la dernière pousse avec les minutes). */
  grow: number;
}

/**
 * Radicelles de la période : une par tranche de 5 minutes d'activité (120 au
 * plus), réparties le long de la racine mère et des branches visibles, du côté
 * libre ; `nearTips` les serre près des pointes.
 */
export const placeRootlets = (model: RootModel, vis: readonly (number | null)[], minutes: number, nearTips = false): PlacedRootlet[] => {
  const n = Math.min(MAX_ROOTLETS, Math.max(0, minutes) / ROOTLET_MINUTES);
  if (n <= 0) return [];
  const spans: { m: number; from: number; v: number }[] = [];
  let total = 0;
  for (let m = 0; m < model.mains; m++) {
    const v = vis[m];
    if (v === null) continue;
    const shown = clamp(v, 0, model.pieces[m].len);
    if (shown > 6) {
      spans.push({ m, from: total, v: shown });
      total += shown;
    }
  }
  if (total === 0) return [];
  const rng = seededRandom(77);
  const placed: PlacedRootlet[] = [];
  model.rootlets.forEach((rootlet, i) => {
    const grow = clamp(n - i, 0, 1);
    if (grow <= 0) return;
    let span: (typeof spans)[number];
    let local: number;
    if (nearTips) {
      span = spans[i % spans.length];
      local = span.v * (0.6 + 0.38 * rootlet.u);
    } else {
      const at = rootlet.u * total;
      span = spans.find((sp) => at < sp.from + sp.v) ?? spans[spans.length - 1];
      local = clamp(at - span.from, 3, span.v - 2);
    }
    const piece = model.pieces[span.m];
    const at = piece.pts[indexAt(piece.pts, local)];
    const free = freeSide(model.cards, at, rng);
    placed.push({ rootlet, at, side: free === 0 ? rootlet.side : free, grow });
  });
  return placed;
};

/** Clé d'une disposition, au pixel près : la racine se reconstruit quand elle change. */
export const layoutKey = ({ slot, cards }: RootLayout): string =>
  [slot, ...cards].map((b) => [b.x, b.y, b.r, b.b].map(Math.round).join(',')).join(';');
