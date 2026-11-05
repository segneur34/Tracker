import {
  indexAt, placeRootlets, rootMaturity, rootVisibility, type RootModel, type RootPiece, type RootStyle,
} from '../core/rootPath';
import { clamp } from '../core/basics';

/**
 * Dessin de la racine du Profil sur un canevas (`ProfileRoot.tsx`), d'après
 * sa géométrie (`core/rootPath.ts`) : ligne de sol et pousse dans le carré,
 * partie sèche, racine et ramifications, radicelles de la période, bourgeons.
 */

/**
 * Étapes nommées de la fleur (lot 147) : ouverte à 1 fois l'objectif, épanouie à 4 (maquette du 31/10), le papillon
 * qui entre dès 4 fois (4e étape), à côté de la fleur à 4,6 (5e) et posé à 5 fois (6e), réponse du 03/11.
 */
export const BLOOM_STEPS = 6;
/** Multiple où tout est figé, papillon posé : `bloom` est plafonné là. */
export const BLOOM_MAX = 5;
/** La fleur est épanouie à ce multiple, et ne change plus au-delà : le papillon prend la suite. */
const BLOOM_FULL = 4;
/** Le bouton s'entrouvre sur le dernier tiers avant l'objectif, de ce multiple à 1. */
const BUD_OPENING_FROM = 0.7;
/** Le second rang de pétales pousse entre ces deux multiples. */
const BLOOM_RING2: readonly [number, number] = [2, 3];
/** Les graines du cœur paraissent entre ces deux multiples. */
const BLOOM_SEEDS: readonly [number, number] = [3, 4];
/** Multiple où le papillon est arrivé à côté de la fleur (étape 5 sur 6) ; il descend ensuite se poser. */
export const BLOOM_BESIDE = 4.6;
/** Le papillon entre par le coin haut droit du carré et vole jusqu'à côté de la fleur entre ces deux multiples. */
const BLOOM_BUTTERFLY: readonly [number, number] = [4, BLOOM_BESIDE];
/** Puis il descend se poser sur le cœur, ailes dressées en V, entre ces deux-là ; posé et figé au-delà. */
const BLOOM_LANDING: readonly [number, number] = [BLOOM_BESIDE, BLOOM_MAX];
/**
 * Envergure du papillon, en pixels du carré de 88 px (`k` = 1) : la moitié du diamètre de la fleur épanouie (25 px,
 * pétales compris), lisible comme un pétale sans sortir du carré par la droite.
 */
const BUTTERFLY_SPAN = 13;
/** Où il attend, à côté de la fleur : à droite, un peu plus haut que le cœur, en pixels du carré depuis le sommet de la tige. */
const BUTTERFLY_BESIDE = { x: 17, y: -6 } as const;
/** Écart des deux ailes dressées, posé (vu de profil). */
const BUTTERFLY_V_DEG = 35;

/** Couleurs du dessin, lues sur les variables `--root-*` de `theme/tokens.css`. */
export interface RootColors {
  live: string;
  edge: string;
  fresh: string;
  withered: string;
  dry: string;
  dryEdge: string;
  sprout: string;
  soil: string;
  seed: string;
  flower: string;
  flowerEdge: string;
  flowerHeart: string;
  butterfly: string;
  butterflyEdge: string;
}

const COLOR_VARS: Record<keyof RootColors, string> = {
  live: '--root-live', edge: '--root-edge', fresh: '--root-fresh',
  withered: '--root-withered', dry: '--root-dry', dryEdge: '--root-dry-edge', sprout: '--root-sprout', soil: '--root-soil',
  seed: '--root-seed', flower: '--root-flower', flowerEdge: '--root-flower-edge', flowerHeart: '--root-flower-heart',
  butterfly: '--root-butterfly', butterflyEdge: '--root-butterfly-edge',
};

export const readRootColors = (el: Element): RootColors => {
  const style = getComputedStyle(el);
  const out = {} as RootColors;
  for (const key of Object.keys(COLOR_VARS) as (keyof RootColors)[]) out[key] = style.getPropertyValue(COLOR_VARS[key]).trim() || '#808080';
  return out;
};

/** État d'un instant du dessin. */
export interface RootFrame {
  /** Niveau montré, en étapes (fractionnaire pendant une animation). */
  level: number;
  /** Plus haut niveau atteint : la partie sèche au-delà de `level`. */
  maxLevel: number;
  /** Étapes du tour complet. */
  growthSteps: number;
  /** Minutes d'activité de la période en cours : les radicelles. */
  minutes: number;
  /** Flétrissement des radicelles, de 0 (fraîches) à 1 (mortes). */
  wither: number;
  /** Part de l'objectif faite dans la période, de 0 à 1 : la pousse grandit (tige et feuilles). */
  progress: number;
  /** Temps de la période en multiples de l'objectif, de 0 à `BLOOM_MAX` : la fleur, en bouton avant 1, épanouie à 4, puis le papillon, posé à 5. */
  bloom: number;
  /** Feuilles tombées, de 0 (sur la tige) à 1 (mortes au sol) : la dernière période close a été manquée ; de nouvelles repoussent avec `progress`. */
  fallen: number;
}

const TAU = Math.PI * 2;

const rgb = (hex: string): number[] | null =>
  /^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : null;

/** Mélange de deux couleurs `#rrggbb` ; `a` seule si l'une n'est pas de cette forme. */
const mix = (a: string, b: string, t: number): string => {
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y) return a;
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
};

/** Trace un morceau jusqu'à `vis`, en paquets de même épaisseur : moins d'appels, pas de perles aux jonctions. */
const strokePiece = (ctx: CanvasRenderingContext2D, piece: RootPiece, vis: number, width: (s: number) => number) => {
  const { pts } = piece;
  let prev = pts[0];
  let cur = -1;
  ctx.beginPath();
  ctx.moveTo(prev.x, prev.y);
  for (let i = 1; i < pts.length; i++) {
    let p = pts[i];
    let last = false;
    if (p.s > vis) {
      const t = (vis - prev.s) / (p.s - prev.s || 1);
      if (t <= 0) break;
      p = { ...p, x: prev.x + (p.x - prev.x) * t, y: prev.y + (p.y - prev.y) * t, s: vis };
      last = true;
    }
    const w = Math.round(width((prev.s + p.s) / 2) * 4) / 4;
    if (w !== cur) {
      if (cur > 0) {
        ctx.lineWidth = cur;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
      }
      cur = w;
    }
    ctx.lineTo(p.x, p.y);
    if (last) break;
    prev = p;
  }
  if (cur > 0) {
    ctx.lineWidth = cur;
    ctx.stroke();
  }
};

const baseWidth = (piece: RootPiece, s: number, thickness: number): number => {
  switch (piece.kind) {
    case 'trunk': return thickness * (1 + 0.9 * Math.exp(-s / 160));
    case 'branch': return thickness * 0.72 * (1 - (0.3 * s) / piece.len);
    case 'lateral': return thickness * 0.46 * (1 - (0.55 * s) / piece.len);
    default: return thickness * 0.3 * (1 - (0.4 * s) / piece.len);
  }
};

/** Racine et ramifications à un niveau : un liseré sombre, puis la couleur ; renvoie les longueurs visibles. */
const drawStructure = (
  ctx: CanvasRenderingContext2D, model: RootModel, level: number, growthSteps: number, style: RootStyle,
  live: string, edge: string, thickness: number, highlight: boolean,
): (number | null)[] => {
  const vis = rootVisibility(model, level, growthSteps, style.ramifications);
  const mature = rootMaturity(level, growthSteps);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass ? live : edge;
    model.pieces.forEach((piece, i) => {
      const v0 = vis[i];
      if (v0 === null) return;
      const v = Math.min(v0, piece.len);
      if (v <= 0.5) return;
      const main = piece.kind === 'trunk' || piece.kind === 'branch';
      const growing = v0 < piece.len;
      const taper = main ? 30 : 8;
      const rim = pass ? 0 : main ? 1.3 : 0.9;
      strokePiece(ctx, piece, v, (s) => baseWidth(piece, s, thickness) * mature * (growing ? clamp((v - s) / taper, 0.28, 1) : 1) + rim);
    });
  }
  const trunk = model.pieces[0];
  const shown = Math.min(vis[0] ?? 0, trunk.len) - 12;
  if (highlight && shown > 4) {
    // Reflet d'un seul trait : des bouts semi-transparents feraient des perles.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = Math.max(0.5, thickness * mature * 0.3);
    ctx.beginPath();
    const start = indexAt(trunk.pts, 4);
    ctx.moveTo(trunk.pts[start].x, trunk.pts[start].y);
    for (let i = start + 1; i < trunk.pts.length && trunk.pts[i].s <= shown; i++) ctx.lineTo(trunk.pts[i].x, trunk.pts[i].y);
    ctx.stroke();
  }
  return vis;
};

const drawRootlets = (
  ctx: CanvasRenderingContext2D, model: RootModel, vis: readonly (number | null)[], frame: RootFrame, colors: RootColors, thickness: number,
) => {
  if (frame.wither >= 1) return;
  const placed = placeRootlets(model, vis, frame.minutes);
  if (placed.length === 0) return;
  const color = mix(colors.fresh, colors.withered, frame.wither);
  ctx.globalAlpha = 1 - 0.85 * frame.wither;
  ctx.lineCap = 'round';
  for (const { rootlet: r, at: p, side, grow } of placed) {
    const nx = -p.ty * side;
    const ny = p.tx * side;
    const L = r.len * grow * (1 - 0.45 * frame.wither) * (0.6 + (0.4 * thickness) / 2.8);
    const dx = p.tx * Math.cos(r.ang) + nx * Math.sin(r.ang);
    const dy = p.ty * Math.cos(r.ang) + ny * Math.sin(r.ang);
    const ex = p.x + dx * L;
    const ey = p.y + dy * L + frame.wither * 2;
    const cx = p.x + dx * L * 0.5 + nx * r.bend * L * 0.5;
    const cy = p.y + dy * L * 0.5 + ny * r.bend * L * 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, thickness * 0.5);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.stroke();
    // Poils absorbants ; le bout reste nu, sans coiffe (26/10).
    if (L > 5) {
      ctx.lineWidth = 0.8;
      for (const [f, a] of [[0.45, 1], [0.7, -1]]) {
        const hx = (1 - f) * (1 - f) * p.x + 2 * f * (1 - f) * cx + f * f * ex;
        const hy = (1 - f) * (1 - f) * p.y + 2 * f * (1 - f) * cy + f * f * ey;
        const hl = L * (0.22 + 0.15 * r.hairs) * 0.7;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + (dx * 0.5 + nx * a) * hl, hy + (dy * 0.5 + ny * a) * hl);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
};

/** Un pétale : ellipse posée à `dist` du centre, longueur `len`, largeur `wid`, tournée de `angle`. */
const petal = (ctx: CanvasRenderingContext2D, angle: number, dist: number, len: number, wid: number, fill: string, edge: string) => {
  ctx.save();
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.ellipse(dist, 0, len, wid, 0, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.stroke();
  ctx.restore();
};

/**
 * La fleur, centrée sur l'origine (le sommet de la tige), pour `t` multiples de
 * l'objectif (maquette du 31/10, quatre étapes). Avant 1 : un bouton qui
 * grossit et s'entrouvre sur le dernier tiers ; à 1 : cinq pétales ; de 1 à 2 :
 * pétales plus longs et cœur plus gros ; de 2 à 3, un second rang de pétales
 * pousse derrière ; jusqu'à 4, tout grandit et le cœur se garnit de graines.
 * Continue d'une étape à l'autre.
 */
const drawFlower = (ctx: CanvasRenderingContext2D, bloom: number, k: number, colors: RootColors) => {
  const t = clamp(bloom, 0, BLOOM_FULL);
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = colors.flowerEdge;
  if (t < 1) {
    const r = (1.4 + 1.6 * t) * k;
    const opening = clamp((t - BUD_OPENING_FROM) / (1 - BUD_OPENING_FROM), 0, 1);
    if (opening <= 0) {
      // Pétales serrés en goutte, pointe vers le haut, tenus par deux sépales.
      ctx.fillStyle = colors.flower;
      ctx.beginPath();
      ctx.moveTo(0, -r * 2.1);
      ctx.quadraticCurveTo(r * 1.1, -r * 0.8, 0, 0);
      ctx.quadraticCurveTo(-r * 1.1, -r * 0.8, 0, -r * 2.1);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = colors.sprout;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, 0.4 * r);
        ctx.quadraticCurveTo(side * r * 1.05, -r * 0.3, side * r * 0.25, -r * 1.35);
        ctx.quadraticCurveTo(side * r * 0.2, -r * 0.4, 0, 0.4 * r);
        ctx.fill();
      }
      return;
    }
    // Cinq pétales qui s'écartent depuis le haut, régulièrement répartis à l'objectif ; celui du haut en dernier.
    const spread = opening * (TAU / 5);
    const length = 0.75 + 0.25 * opening;
    for (const i of [0, 4, 1, 3, 2]) {
      petal(ctx, -Math.PI / 2 + (i - 2) * spread, r * 1.05 * length, r * 0.95 * length, r * (0.4 + 0.15 * opening), colors.flower, colors.flowerEdge);
    }
    ctx.fillStyle = colors.flowerHeart;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55 * (0.5 + 0.5 * opening), 0, TAU);
    ctx.fill();
    return;
  }
  // Ouverte : la taille suit le multiple.
  const r = (3.0 + 0.55 * (t - 1)) * k;
  const length = 1 + 0.25 * clamp(t - 1, 0, 1) + 0.1 * clamp(t - 3, 0, 1);
  const width = 0.55 + (0.08 * clamp(t - 1, 0, 3)) / 3;
  const ring2 = clamp((t - BLOOM_RING2[0]) / (BLOOM_RING2[1] - BLOOM_RING2[0]), 0, 1);
  if (ring2 > 0) {
    // Rang du dos : un peu plus foncé, décalé d'un demi-pétale, qui grandit depuis le cœur.
    const back = mix(colors.flower, colors.flowerEdge, 0.3);
    for (let i = 0; i < 5; i++) {
      petal(ctx, -Math.PI / 2 + (i + 0.5) * (TAU / 5), r * 1.1 * length * ring2, r * 1.05 * length * ring2, r * width * 0.95 * ring2, back, colors.flowerEdge);
    }
  }
  for (const i of [0, 4, 1, 3, 2]) {
    petal(ctx, -Math.PI / 2 + i * (TAU / 5), r * 1.05 * length, r * 0.95 * length, r * width, colors.flower, colors.flowerEdge);
  }
  const heart = r * (0.55 + (0.15 * clamp(t - 1, 0, 3)) / 3);
  ctx.fillStyle = colors.flowerHeart;
  ctx.beginPath();
  ctx.arc(0, 0, heart, 0, TAU);
  ctx.fill();
  // Les graines du cœur : la fleur est mûre.
  const seeds = clamp((t - BLOOM_SEEDS[0]) / (BLOOM_SEEDS[1] - BLOOM_SEEDS[0]), 0, 1);
  if (seeds > 0) {
    ctx.fillStyle = mix(colors.flowerHeart, '#000000', 0.3);
    ctx.globalAlpha = seeds;
    for (let i = 0; i < 6; i++) {
      const a = (i * TAU) / 6 + 0.4;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * heart * 0.5, Math.sin(a) * heart * 0.5, heart * 0.12, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
};

/** Point d'une courbe quadratique de `p0` à `p2`, tirée vers `c`, à `t` de 0 à 1. */
const quad = (p0: { x: number; y: number }, c: { x: number; y: number }, p2: { x: number; y: number }, t: number) => ({
  x: (1 - t) * (1 - t) * p0.x + 2 * t * (1 - t) * c.x + t * t * p2.x,
  y: (1 - t) * (1 - t) * p0.y + 2 * t * (1 - t) * c.y + t * t * p2.y,
});

/**
 * Le papillon, centré sur (`x`, `y`), d'envergure `size` : un corps sombre et deux antennes, deux paires d'ailes
 * (la haute plus grande, la basse plus petite et plus ronde) avec un point clair sur chaque aile haute.
 * `opening` : 0, ailes repliées (vues par la tranche), 1, à plat ; `perch`, de 0 à 1 : les ailes se dressent
 * en V, écartées de `BUTTERFLY_V_DEG`, comme posé, vu de profil.
 */
const drawButterfly = (
  ctx: CanvasRenderingContext2D, x: number, y: number, size: number, opening: number, colors: RootColors, perch = 0,
) => {
  const a = size / 2;
  const p = clamp(perch, 0, 1);
  const body = mix(colors.butterfly, '#000000', 0.5);
  const spot = mix(colors.butterfly, '#ffffff', 0.55);
  // Vers le haut, l'aile s'écarte de la verticale de la moitié du V.
  const lift = p * (Math.PI / 2 - (BUTTERFLY_V_DEG * Math.PI) / 360);
  const flat = clamp(opening + (1 - opening) * p, 0.05, 1);
  ctx.save();
  ctx.translate(x, y);
  /** Un chemin du côté `side`, tracé dans le repère tourné et aplati de ce côté ; rempli et bordé hors de ce repère (trait d'épaisseur égale). */
  const wingPath = (side: number, draw: () => void) => {
    ctx.save();
    ctx.scale(side, 1);
    ctx.rotate(-lift);
    ctx.scale(flat, 1);
    ctx.beginPath();
    draw();
    ctx.restore();
  };
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = colors.butterflyEdge;
  ctx.fillStyle = colors.butterfly;
  for (const side of [-1, 1]) {
    // L'aile basse, puis la haute par-dessus.
    for (const [cx, cy, rx, ry, rot] of [[0.42, 0.3, 0.4, 0.3, 0.5], [0.5, -0.28, 0.52, 0.4, -0.45]]) {
      wingPath(side, () => ctx.ellipse(cx * a, cy * a, rx * a, ry * a, rot, 0, TAU));
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.fillStyle = spot;
  for (const side of [-1, 1]) {
    wingPath(side, () => ctx.arc(0.6 * a, -0.33 * a, 0.12 * a, 0, TAU));
    ctx.fill();
  }
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, 0.02 * a, 0.1 * a, 0.42 * a, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -0.46 * a, 0.12 * a, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = body;
  ctx.lineWidth = 0.6;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 0.04 * a, -0.52 * a);
    ctx.quadraticCurveTo(side * 0.08 * a, -0.85 * a, side * 0.3 * a, -0.98 * a);
    ctx.stroke();
  }
  ctx.restore();
};

/**
 * Le papillon des deux dernières étapes, pour `t` multiples de l'objectif (rien avant 4) : de 4 à 4,6, il entre par le
 * coin haut droit du carré et vole, le long d'une courbe douce, jusqu'à côté de la fleur, ailes battant avec le
 * temps fait (elles ne bougent que quand `t` change) ; de 4,6 à 5, il descend de côté jusqu'au cœur et s'y pose,
 * ailes dressées en V ; posé et figé dès 5. `top` : le sommet de la tige (le cœur), `corner` : le coin haut droit du carré.
 */
const drawButterflyStage = (
  ctx: CanvasRenderingContext2D, t: number, top: { x: number; y: number }, corner: { x: number; y: number }, k: number, colors: RootColors,
) => {
  if (t < BLOOM_BUTTERFLY[0]) return;
  const span = BUTTERFLY_SPAN * k;
  const beside = { x: top.x + BUTTERFLY_BESIDE.x * k, y: top.y + BUTTERFLY_BESIDE.y * k };
  // Posé : le bas du corps sur le cœur.
  const perched = { x: top.x, y: top.y - 0.35 * (span / 2) };
  const flight = clamp((t - BLOOM_BUTTERFLY[0]) / (BLOOM_BUTTERFLY[1] - BLOOM_BUTTERFLY[0]), 0, 1);
  const landing = clamp((t - BLOOM_LANDING[0]) / (BLOOM_LANDING[1] - BLOOM_LANDING[0]), 0, 1);
  const at = landing > 0
    ? quad(beside, { x: top.x + 10 * k, y: top.y - 11 * k }, perched, landing)
    : quad(corner, { x: corner.x - 2 * k, y: beside.y + 14 * k }, beside, flight);
  // Deux battements sur le vol, l'ouverture gardée pendant la descente (les ailes s'y dressent).
  const opening = 0.35 + 0.45 * Math.abs(Math.sin(2 * Math.PI * flight));
  drawButterfly(ctx, at.x, at.y, span, opening, colors, landing);
};

/** Ligne de sol du carré, avec quelques cailloux dessous, à droite (le chiffre est à gauche). */
const drawGround = (ctx: CanvasRenderingContext2D, model: RootModel, colors: RootColors) => {
  const { slot, seed } = model;
  const k = (slot.b - slot.y) / 88;
  ctx.strokeStyle = colors.soil;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const from = slot.x + 4;
  for (let x = from; x <= slot.r - 4; x += 2) {
    const y = seed.y + 0.9 * Math.sin(x / 5.3) + 0.5 * Math.sin(x / 2.1);
    if (x === from) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = colors.soil;
  ctx.globalAlpha = 0.55;
  for (const [dx, dy, r] of [[-9, 6, 1.1], [9, 8, 1.2], [16, 15, 1], [6, 19, 0.9], [-5, 14, 0.8]]) {
    ctx.beginPath();
    ctx.ellipse(seed.x + dx * k, seed.y + dy * k, r * 1.4, r, 0.4, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
};

/**
 * Pousse au-dessus du sol. Une graine tant que la racine n'a rien et que la
 * période est vide ; dès qu'elle a une étape, une plante qui reste debout d'une
 * période à l'autre et grandit avec l'objectif. La fleur n'est là qu'avec du
 * temps dans la période : un bouton dès la première minute, qui grossit puis
 * s'ouvre avec le temps fait, en entier à l'objectif, et continue d'évoluer par
 * multiples de l'objectif jusqu'à 4 fois (`drawFlower`) ; de 4 à 5 fois, un
 * papillon approche puis se pose sur elle (`drawButterflyStage`). Après une période
 * manquée (`fallen`), les feuilles tombent et restent mortes au sol ; de
 * nouvelles repoussent sur la tige avec le temps fait.
 */
const drawSprout = (ctx: CanvasRenderingContext2D, model: RootModel, frame: RootFrame, colors: RootColors) => {
  const { seed, slot } = model;
  const k = (slot.b - slot.y) / 88;
  const progress = frame.progress * (1 - frame.wither);
  const flowering = frame.minutes > 0 && frame.wither < 1;
  const planted = frame.level > 0.01 ? 0.62 + 0.3 * clamp(frame.level / frame.growthSteps, 0, 1) : 0;
  const grown = Math.max(progress, planted);
  const fallen = clamp(frame.fallen, 0, 1);

  /** Une feuille ; `edge` : liseré et nervure (une feuille morte, qui se détache du sol). */
  const leaf = (at: { x: number; y: number }, angle: number, size: number, color: string, edge?: string) => {
    if (size <= 0.3) return;
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.ellipse(size * 0.55, 0, size * 0.6, size * 0.28, 0, 0, TAU);
    ctx.fillStyle = color;
    ctx.fill();
    if (edge) {
      ctx.strokeStyle = edge;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(size * 1.05, 0);
      ctx.stroke();
    }
    ctx.restore();
  };

  // Les anciennes feuilles tombent de la tige jusqu'au sol en brunissant, et y restent, même revenue à la graine.
  if (fallen > 0) {
    const h0 = (4 + 26 * Math.max(grown, 0.62)) * k;
    const node = { x: seed.x + 0.2 * k, y: seed.y - h0 * 0.7 };
    const size0 = 12 * k * 0.85;
    const dead = mix(colors.sprout, colors.withered, Math.min(1, fallen * 1.4));
    // Posées au-dessus de la ligne de sol, pas dessus.
    for (const side of [1, -1]) {
      const ground = { x: seed.x + side * 7 * k - (side > 0 ? 0 : size0 * 1.1), y: seed.y - 2.5 * k };
      const at = { x: node.x + (ground.x - node.x) * fallen, y: node.y + (ground.y - node.y) * fallen * fallen };
      const from = side > 0 ? -0.5 : Math.PI + 0.5;
      const to = side > 0 ? 0.1 : -0.06;
      leaf(at, from + (to - from) * fallen, size0 * (side > 0 ? 1 : 0.9), dead, mix(colors.sprout, colors.dryEdge, fallen));
    }
  }

  if (grown <= 0.02) {
    ctx.fillStyle = colors.seed;
    ctx.beginPath();
    ctx.ellipse(seed.x, seed.y - 2.2, 3.4, 2.2, -0.3, 0, TAU);
    ctx.fill();
  } else {
    const h = (4 + 26 * grown) * k;
    const top = { x: seed.x + 2 * k, y: seed.y - h };
    ctx.strokeStyle = colors.sprout;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(seed.x, seed.y);
    ctx.quadraticCurveTo(seed.x - 4 * k, seed.y - h * 0.55, top.x, top.y);
    ctx.stroke();

    // Feuilles de la tige : pleines, ou qui repoussent avec le temps fait après une période manquée.
    const full = (2 + 10 * clamp((grown - 0.15) / 0.85, 0, 1)) * k;
    const regrown = (2 + 10 * clamp(progress, 0, 1)) * k * (progress > 0 ? 1 : 0);
    const node = { x: seed.x + (top.x - seed.x) * 0.6 - 1.5 * k, y: seed.y - h * 0.7 };
    if (grown > 0.15) {
      const size = fallen > 0 ? regrown : full;
      leaf(node, -0.5, size, colors.sprout);
      leaf(node, Math.PI + 0.5, size * 0.9, colors.sprout);
    }

    // La fleur : rien sans temps dans la période ; un bouton, ouvert à l'objectif, puis ses étapes jusqu'à 4 fois ;
    // ensuite le papillon, qui s'efface avec elle quand elle se fane.
    if (flowering) {
      const bloom = frame.bloom * (1 - frame.wither);
      ctx.save();
      ctx.translate(top.x, top.y);
      drawFlower(ctx, bloom, k, colors);
      ctx.restore();
      ctx.globalAlpha = 1 - frame.wither;
      drawButterflyStage(ctx, bloom, top, { x: slot.r, y: slot.y }, k, colors);
      ctx.globalAlpha = 1;
    }
  }
};

/** Tout le dessin d'un instant, sur un canevas déjà effacé et mis à l'échelle. */
export const drawRoot = (ctx: CanvasRenderingContext2D, model: RootModel, frame: RootFrame, colors: RootColors, style: RootStyle) => {
  drawGround(ctx, model, colors);
  if (frame.maxLevel > frame.level + 0.01) {
    drawStructure(ctx, model, frame.maxLevel, frame.growthSteps, style, colors.dry, colors.dryEdge, style.thickness * 0.92, false);
  }
  const vis = drawStructure(ctx, model, frame.level, frame.growthSteps, style, colors.live, colors.edge, style.thickness, true);
  drawRootlets(ctx, model, vis, frame, colors, style.thickness);
  drawSprout(ctx, model, frame, colors);
};
