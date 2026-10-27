import { describe, expect, it } from 'vitest';
import {
  buildRootModel, inCard, MAX_ROOTLETS, placeRootlets, ROOT_SEED_LENGTH, ROOT_STYLE, rootMaturity, rootRoute, rootVisibility,
  sampleRoute, tourLength, type Box, type RootLayout,
} from './rootPath';

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, r: x + w, b: y + h });

/** Profil sur ordinateur : carré à droite du pseudo, périodes, chiffres, répartition, graphe (gouttière de 20 px). */
const DESKTOP: RootLayout = {
  slot: box(652, 20, 88, 88),
  cards: [box(20, 128, 720, 40), box(20, 188, 720, 110), box(20, 318, 720, 260), box(20, 598, 720, 220)],
};
const FLAT = { ...ROOT_STYLE, wobble: 0 };

describe('rootRoute', () => {
  it('part de la graine, dans le carré, et serpente d\'un intervalle à l\'autre', () => {
    const route = rootRoute(DESKTOP)!;
    expect(route.seed.x).toBeGreaterThan(DESKTOP.slot.x);
    expect(route.seed.x).toBeLessThan(DESKTOP.slot.r);
    // Graine, sortie du carré, marge de droite, deux sommets par intervalle (trois), puis le dessous du dernier cadre.
    expect(route.trunk.vertices).toHaveLength(3 + 2 * 3 + 2);
    const xs = route.trunk.vertices.slice(2).map((v) => v.x);
    expect(new Set(xs.map(Math.round))).toEqual(new Set([750, 10, 748]));
    expect(route.branches).toHaveLength(3);
  });

  it('un seul cadre : la racine le contourne par la droite et le dessous', () => {
    const route = rootRoute({ slot: DESKTOP.slot, cards: [DESKTOP.cards[0]] })!;
    expect(route.branches).toHaveLength(0);
    expect(route.trunk.vertices.at(-1)!.y).toBeCloseTo(DESKTOP.cards[0].b + 10);
  });

  it('sans cadre : pas de racine', () => {
    expect(rootRoute({ slot: DESKTOP.slot, cards: [] })).toBeNull();
    expect(buildRootModel({ slot: DESKTOP.slot, cards: [] })).toBeNull();
  });
});

describe('sampleRoute', () => {
  it('échantillonne tous les 2,5 px, coins arrondis, tangentes unitaires', () => {
    const pts = sampleRoute([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], [0, 20, 0]);
    const len = pts.at(-1)!.s;
    // Un coin de rayon 20 raccourcit le chemin de 2 × 20 − (arc ≈ 31) ≈ 9 px.
    expect(len).toBeGreaterThan(188);
    expect(len).toBeLessThan(195);
    for (let i = 1; i < pts.length; i++) expect(pts[i].s - pts[i - 1].s).toBeLessThan(2.6);
    for (const p of pts) expect(Math.hypot(p.tx, p.ty)).toBeCloseTo(1);
  });
});

describe('buildRootModel', () => {
  it('reproductible : la même page donne la même racine', () => {
    const a = buildRootModel(DESKTOP)!;
    const b = buildRootModel(DESKTOP)!;
    expect(b.pieces.length).toBe(a.pieces.length);
    expect(b.pieces[0].pts[200]).toEqual(a.pieces[0].pts[200]);
  });

  it('au tour complet, chaque côté de chaque cadre est longé par la racine ou une branche', () => {
    const model = buildRootModel(DESKTOP, FLAT)!;
    const mainPts = model.pieces.slice(0, model.mains).flatMap((p) => p.pts);
    const near = (x: number, y: number) => mainPts.some((p) => Math.hypot(p.x - x, p.y - y) < 14);
    for (const c of DESKTOP.cards.slice(1)) {
      const mx = (c.x + c.r) / 2;
      const my = (c.y + c.b) / 2;
      expect(near(mx, c.y), 'dessus').toBe(true);
      expect(near(mx, c.b), 'dessous').toBe(true);
      expect(near(c.x, my), 'gauche').toBe(true);
      expect(near(c.r, my), 'droite').toBe(true);
    }
  });

  it('les ramifications ne s\'enfoncent pas dans un cadre de plus de 3 px', () => {
    const model = buildRootModel(DESKTOP)!;
    const laterals = model.pieces.filter((p) => p.kind === 'lateral' || p.kind === 'sub');
    expect(laterals.length).toBeGreaterThan(20);
    // Le premier point est sur la racine porteuse, qui ondule et peut mordre le bord.
    for (const p of laterals) for (const pt of p.pts.slice(2)) expect(inCard(DESKTOP.cards, pt.x, pt.y, 3.5)).toBe(false);
  });
});

describe('rootVisibility', () => {
  const model = buildRootModel(DESKTOP)!;

  it('à la graine, un bout de racine seulement ; au tour complet, toutes les branches', () => {
    const seed = rootVisibility(model, 0, 15, 1.4);
    expect(seed[0]).toBe(ROOT_SEED_LENGTH);
    expect(seed.slice(1, model.mains).every((v) => v === null)).toBe(true);
    const full = rootVisibility(model, 15, 15, 1.4);
    for (let m = 0; m < model.mains; m++) expect(full[m]!).toBeGreaterThanOrEqual(model.pieces[m].len - 0.01);
  });

  it('la racine avance d\'autant à chaque étape, quelle que soit la durée du tour', () => {
    const a = rootVisibility(model, 3, 15, 1.4)[0]!;
    const b = rootVisibility(model, 4, 15, 1.4)[0]!;
    const c = rootVisibility(model, 8, 30, 1.4)[0]!;
    expect(b - a).toBeCloseTo((model.reach - ROOT_SEED_LENGTH) / 15);
    expect(c).toBeCloseTo(a + (b - a) * 1);
  });

  it('densité 0 : aucune ramification ; les ramifications de la racine mûre attendent le tour', () => {
    expect(rootVisibility(model, 15, 15, 0).filter((v, i) => v !== null && model.pieces[i].kind !== 'trunk' && model.pieces[i].kind !== 'branch')).toHaveLength(0);
    const extras = model.pieces.map((p, i) => [p, i] as const).filter(([p]) => p.extra !== null);
    expect(extras.length).toBeGreaterThan(0);
    const atFull = rootVisibility(model, 15, 15, 2);
    expect(extras.every(([, i]) => atFull[i] === null)).toBe(true);
    const later = rootVisibility(model, 40, 15, 2);
    expect(extras.some(([, i]) => later[i] !== null)).toBe(true);
  });

  it('la racine s\'épaissit après le tour', () => {
    expect(rootMaturity(10, 15)).toBe(1);
    expect(rootMaturity(15, 15)).toBe(1);
    expect(rootMaturity(30, 15)).toBeGreaterThan(1.3);
    expect(rootMaturity(300, 15)).toBeLessThanOrEqual(1.6);
  });
});

describe('placeRootlets', () => {
  const model = buildRootModel(DESKTOP)!;
  const vis = rootVisibility(model, 6, 15, 1.4);

  it('une radicelle par tranche de 5 minutes, sur la racine visible', () => {
    expect(placeRootlets(model, vis, 0)).toHaveLength(0);
    const placed = placeRootlets(model, vis, 80);
    expect(placed).toHaveLength(16);
    expect(placed.every((p) => p.grow === 1)).toBe(true);
    // La dernière pousse avec les minutes.
    expect(placeRootlets(model, vis, 82).at(-1)!.grow).toBeCloseTo(0.4);
    const trunkPts = model.pieces[0].pts.filter((p) => p.s <= vis[0]!);
    const onRoot = (x: number, y: number) => model.pieces.slice(0, model.mains).some((piece) => piece.pts.some((p) => p.x === x && p.y === y));
    expect(placed.every((p) => onRoot(p.at.x, p.at.y))).toBe(true);
    expect(trunkPts.length).toBeGreaterThan(0);
  });

  it('120 au plus (10 h)', () => {
    expect(placeRootlets(model, vis, 2000)).toHaveLength(MAX_ROOTLETS);
  });
});

describe('longueur de la racine indépendante de la page', () => {
  /** Mêmes carré et largeur, cadres empilés avec une gouttière de 20 px, de hauteurs données. */
  const stacked = (heights: number[]): RootLayout => {
    let y = 128;
    return { slot: DESKTOP.slot, cards: heights.map((h) => { const b = box(20, y, 720, h); y += h + 20; return b; }) };
  };
  /** Année, 30 jours puis semaine sans répartition : des pages de hauteurs très différentes. */
  const LAYOUTS = { annee: [34, 178, 318, 273], trente: [34, 178, 318, 253], semaine: [34, 174, 150], haute: [34, 300, 600, 500] };
  const front = (heights: number[], level: number) => rootVisibility(buildRootModel(stacked(heights), FLAT)!, level, 26, 1.4)[0]!;

  it('à niveau égal, la racine mère a la même longueur sur toutes les pages', () => {
    for (const level of [1, 6, 13, 26]) {
      const lengths = Object.values(LAYOUTS).map((h) => front(h, level));
      for (const l of lengths) expect(l).toBeCloseTo(lengths[0], 6);
    }
  });

  it('la longueur croît avec le niveau, d\'un même pas à chaque étape', () => {
    const lengths = [0, 1, 2, 13, 26].map((level) => front(LAYOUTS.semaine, level));
    for (let i = 1; i < lengths.length; i++) expect(lengths[i]).toBeGreaterThan(lengths[i - 1]);
    expect(lengths[0]).toBe(ROOT_SEED_LENGTH);
    expect(lengths[2] - lengths[1]).toBeCloseTo(lengths[1] - lengths[0]);
    expect(lengths[4] - lengths[3]).toBeCloseTo((lengths[3] - lengths[0]));
  });

  it('une page plus courte que la référence prolonge la racine sous son dernier cadre jusqu\'à la longueur du tour', () => {
    const short = buildRootModel(stacked(LAYOUTS.semaine), FLAT)!;
    const trunk = short.pieces[0];
    expect(trunk.len).toBeGreaterThanOrEqual(short.tour - 1);
    expect(trunk.len).toBeLessThan(short.tour + 1);
    const lastBottom = stacked(LAYOUTS.semaine).cards.at(-1)!.b;
    expect(short.bottom).toBeGreaterThan(lastBottom + 20);
    // Une page plus haute n'allonge pas la racine : elle ne couvre qu'une partie de la page au tour complet.
    const tall = buildRootModel(stacked(LAYOUTS.haute), FLAT)!;
    expect(tall.tour).toBeCloseTo(short.tour, 6);
    expect(tall.pieces[0].len).toBeGreaterThan(tall.tour);
  });

  it('la page de référence ne dépend ni de la hauteur ni du nombre des cadres réels', () => {
    expect(tourLength(stacked(LAYOUTS.annee))).toBeCloseTo(tourLength(stacked(LAYOUTS.semaine))!, 6);
    expect(tourLength(stacked(LAYOUTS.haute))).toBeCloseTo(tourLength(stacked(LAYOUTS.annee))!, 6);
    expect(tourLength({ slot: DESKTOP.slot, cards: [] })).toBeNull();
  });

  it('à la période de référence, la racine garde sa longueur d\'avant (la page entière en 26 étapes)', () => {
    const reference = buildRootModel(stacked(LAYOUTS.annee), FLAT)!;
    expect(reference.tour).toBeCloseTo(reference.pieces[0].len, 6);
  });
});
