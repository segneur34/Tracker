import {
  indexAt, placeRootlets, rootMaturity, rootVisibility, type RootModel, type RootPiece, type RootStyle,
} from '../core/rootPath';

/**
 * Dessin de la racine du Profil sur un canevas (`ProfileRoot.tsx`), d'après
 * sa géométrie (`core/rootPath.ts`) : ligne de sol et pousse dans le carré,
 * partie sèche, racine et ramifications, radicelles de la période, bourgeons.
 */

/** Couleurs du dessin, lues sur les variables `--root-*` de `theme/tokens.css`. */
export interface RootColors {
  live: string;
  edge: string;
  bud: string;
  fresh: string;
  freshTip: string;
  withered: string;
  dry: string;
  dryEdge: string;
  sprout: string;
  soil: string;
  seed: string;
  flower: string;
  flowerEdge: string;
  flowerHeart: string;
}

const COLOR_VARS: Record<keyof RootColors, string> = {
  live: '--root-live', edge: '--root-edge', bud: '--root-bud', fresh: '--root-fresh', freshTip: '--root-fresh-tip',
  withered: '--root-withered', dry: '--root-dry', dryEdge: '--root-dry-edge', sprout: '--root-sprout', soil: '--root-soil',
  seed: '--root-seed', flower: '--root-flower', flowerEdge: '--root-flower-edge', flowerHeart: '--root-flower-heart',
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
  /** Pousse au-dessus du sol : part de l'objectif faite, de 0 à 1. */
  progress: number;
  /** Bourgeons aux pointes : la période est tenue, la racine poussera à sa fin. */
  buds: boolean;
  /** Feuilles qui pendent, de 0 à 1 : la dernière période close a été manquée ; elles se relèvent quand l'objectif est tenu. */
  wilting: number;
}

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

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
  const tip = mix(colors.freshTip, colors.withered, frame.wither);
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
    // Poils absorbants, puis la coiffe claire au bout.
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
    ctx.fillStyle = tip;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(ex, ey, Math.max(1.2, thickness * 0.42) * grow, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
};

const drawBuds = (ctx: CanvasRenderingContext2D, model: RootModel, vis: readonly (number | null)[], colors: RootColors, thickness: number) => {
  for (let m = 0; m < model.mains; m++) {
    const piece = model.pieces[m];
    const v = vis[m];
    if (v === null || v <= 2 || v >= piece.len) continue;
    const p = piece.pts[Math.min(piece.pts.length - 1, indexAt(piece.pts, v))];
    ctx.fillStyle = colors.bud;
    ctx.strokeStyle = colors.edge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(2, thickness * 0.9), 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
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
 * période à l'autre et grandit avec l'objectif. À son sommet, un bouton fermé,
 * qui s'ouvre en fleur quand l'objectif est tenu ; feuilles et bouton pendent
 * quand on est en train de tuer la racine (`wilting`).
 */
const drawSprout = (ctx: CanvasRenderingContext2D, model: RootModel, frame: RootFrame, colors: RootColors) => {
  const { seed, slot } = model;
  const k = (slot.b - slot.y) / 88;
  const progress = frame.progress * (1 - frame.wither);
  const open = progress >= 1;
  const planted = frame.level > 0.01 ? 0.62 + 0.3 * clamp(frame.level / frame.growthSteps, 0, 1) : 0;
  const grown = Math.max(progress, planted);
  if (grown <= 0.02) {
    ctx.fillStyle = colors.seed;
    ctx.beginPath();
    ctx.ellipse(seed.x, seed.y - 2.2, 3.4, 2.2, -0.3, 0, TAU);
    ctx.fill();
    return;
  }
  const droop = open ? 0 : clamp(frame.wilting, 0, 1);
  const h = (4 + 26 * grown) * k * (1 - 0.08 * droop);
  // Une plante qui pend penche la tête de côté.
  const top = { x: seed.x + (2 + 7 * droop) * k, y: seed.y - h };
  const green = mix(colors.sprout, colors.withered, 0.4 * droop);
  ctx.strokeStyle = green;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(seed.x, seed.y);
  ctx.quadraticCurveTo(seed.x - 4 * k, seed.y - h * (0.55 + 0.4 * droop), top.x, top.y);
  ctx.stroke();

  const leaf = (at: { x: number; y: number }, angle: number, size: number) => {
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.ellipse(size * 0.55, 0, size * 0.6, size * 0.28, 0, 0, TAU);
    ctx.fillStyle = green;
    ctx.fill();
    ctx.restore();
  };
  // Les feuilles, sous le bouton : relevées, ou tombantes le long de la tige.
  const size = (2 + 10 * clamp((grown - 0.15) / 0.85, 0, 1)) * k;
  if (grown > 0.15) {
    const node = { x: seed.x + (top.x - seed.x) * 0.6 - 1.5 * k, y: seed.y - h * 0.7 };
    leaf(node, -0.5 + 1.35 * droop, size * (1 + 0.15 * droop));
    leaf(node, Math.PI + 0.5 - 1.35 * droop, size * (0.9 + 0.15 * droop));
  }

  // Au sommet : la fleur ouverte, ou le bouton fermé, penché quand la plante pend.
  const r = (2.2 + 1.6 * clamp(grown, 0, 1)) * k;
  ctx.save();
  ctx.translate(top.x, top.y);
  ctx.rotate(1.9 * droop);
  ctx.lineWidth = 0.8;
  if (open) {
    ctx.fillStyle = colors.flower;
    ctx.strokeStyle = colors.flowerEdge;
    for (let i = 0; i < 5; i++) {
      ctx.save();
      ctx.rotate((i * TAU) / 5 - Math.PI / 2);
      ctx.beginPath();
      ctx.ellipse(r * 1.05, 0, r * 0.95, r * 0.55, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = colors.flowerHeart;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, 0, TAU);
    ctx.fill();
  } else {
    // Pétales serrés en goutte, pointe vers le haut, tenus par deux sépales.
    ctx.fillStyle = mix(colors.flower, colors.withered, 0.5 * droop);
    ctx.strokeStyle = colors.flowerEdge;
    ctx.beginPath();
    ctx.moveTo(0, -r * 2.1);
    ctx.quadraticCurveTo(r * 1.1, -r * 0.8, 0, 0);
    ctx.quadraticCurveTo(-r * 1.1, -r * 0.8, 0, -r * 2.1);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = green;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, 0.4 * r);
      ctx.quadraticCurveTo(side * r * 1.05, -r * 0.3, side * r * 0.25, -r * 1.35);
      ctx.quadraticCurveTo(side * r * 0.2, -r * 0.4, 0, 0.4 * r);
      ctx.fill();
    }
  }
  ctx.restore();
};

/** Tout le dessin d'un instant, sur un canevas déjà effacé et mis à l'échelle. */
export const drawRoot = (ctx: CanvasRenderingContext2D, model: RootModel, frame: RootFrame, colors: RootColors, style: RootStyle) => {
  drawGround(ctx, model, colors);
  if (frame.maxLevel > frame.level + 0.01) {
    drawStructure(ctx, model, frame.maxLevel, frame.growthSteps, style, colors.dry, colors.dryEdge, style.thickness * 0.92, false);
  }
  const vis = drawStructure(ctx, model, frame.level, frame.growthSteps, style, colors.live, colors.edge, style.thickness, true);
  drawRootlets(ctx, model, vis, frame, colors, style.thickness);
  if (frame.buds) drawBuds(ctx, model, vis, colors, style.thickness);
  drawSprout(ctx, model, frame, colors);
};
