import { describe, expect, it } from 'vitest';
import { buildRootModel, ROOT_STYLE, type Box } from '../core/rootPath';
import { BLOOM_BESIDE, BLOOM_MAX, butterflyStateAt, drawRoot, type RootColors, type RootFrame } from './drawRoot';

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, r: x + w, b: y + h });
// Carré de 88 px : `k` = 1.
const model = buildRootModel({
  slot: box(652, 20, 88, 88),
  cards: [box(20, 128, 720, 40), box(20, 188, 720, 110), box(20, 318, 720, 260), box(20, 598, 720, 220)],
})!;
// Tige à sa pleine hauteur, `progress` à 1.
const top = { x: model.seed.x + 2, y: model.seed.y - 30 };

const COLORS: RootColors = {
  live: '#000001', edge: '#000002', fresh: '#000003', withered: '#000004', dry: '#000005', dryEdge: '#000006', sprout: '#000007',
  soil: '#000008', seed: '#000009', flower: '#00000a', flowerEdge: '#00000b', flowerHeart: '#00000c',
  butterfly: '#ec7a1c', butterflyEdge: '#3a2415',
};

interface Call { name: string; args: number[]; fill: unknown; alpha: unknown }

/** Dessine une image sur un faux canevas qui retient ses appels, et rend ceux du papillon, à partir de sa mise en place. */
const butterflyCalls = (frame: Partial<RootFrame>): Call[] => {
  const state: Record<string, unknown> = { globalAlpha: 1, fillStyle: '' };
  const calls: Call[] = [];
  const ctx = new Proxy({}, {
    get: (_, key: string) => (key in state
      ? state[key]
      : (...args: number[]) => { calls.push({ name: key, args, fill: state.fillStyle, alpha: state.globalAlpha }); }),
    set: (_, key: string, value) => { state[key] = value; return true; },
  }) as CanvasRenderingContext2D;
  drawRoot(ctx, model, {
    level: 5, maxLevel: 5, growthSteps: 26, minutes: 200, wither: 0, progress: 1, bloom: 0, fallen: 0, ...frame,
  }, COLORS, ROOT_STYLE);
  const firstFill = calls.findIndex((c) => c.name === 'fill' && c.fill === COLORS.butterfly);
  if (firstFill < 0) return [];
  // Le `translate` de sa mise en place est le dernier avant sa première aile.
  const start = calls.slice(0, firstFill).map((c) => c.name).lastIndexOf('translate');
  return calls.slice(start);
};

const placeOf = (calls: readonly Call[]) => ({
  at: calls[0].args,
  tilt: calls.find((c) => c.name === 'rotate')?.args[0],
  flat: Math.abs(calls.find((c) => c.name === 'scale')?.args[0] ?? 0),
});

describe('butterflyStateAt', () => {
  it('deux états sans entre-deux : rien sous 4,6, à côté de 4,6 inclus à 5 exclu, posé dès 5', () => {
    expect(BLOOM_BESIDE).toBe(4.6);
    expect(BLOOM_MAX).toBe(5);
    for (const t of [0, 1, 4, 4.3, 4.59]) expect(butterflyStateAt(t)).toBeNull();
    for (const t of [4.6, 4.8, 4.99]) expect(butterflyStateAt(t)).toBe('beside');
    expect(butterflyStateAt(5)).toBe('perched');
  });

  it("garde la marge d'arrondi de la bulle : 4,6 et 5 fois un rien trop courts comptent", () => {
    expect(butterflyStateAt(4.6 - 1e-12)).toBe('beside');
    expect(butterflyStateAt(5 - 1e-12)).toBe('perched');
  });
});

describe('papillon dessiné', () => {
  it('absent sous 4,6 fois', () => {
    expect(butterflyCalls({ bloom: 4 })).toEqual([]);
    expect(butterflyCalls({ bloom: 4.59 })).toEqual([]);
  });

  it("à côté de la fleur : à droite, plus haut que le cœur, penché, ailes à 0,72", () => {
    const { at, tilt, flat } = placeOf(butterflyCalls({ bloom: 4.6 }));
    expect(at[0]).toBeCloseTo(top.x + 17);
    expect(at[1]).toBeCloseTo(top.y - 6);
    expect(tilt).toBeCloseTo(-0.45);
    expect(flat).toBeCloseTo(0.72);
  });

  it('posé sur le cœur : droit, ailes à 0,95, envergure de 13 px', () => {
    const { at, tilt, flat } = placeOf(butterflyCalls({ bloom: 5 }));
    expect(at[0]).toBeCloseTo(top.x);
    expect(at[1]).toBeCloseTo(top.y - 0.35 * (13 / 2));
    expect(tilt).toBe(0);
    expect(flat).toBeCloseTo(0.95);
  });

  it('deux points blancs par aile haute, bord épais', () => {
    const calls = butterflyCalls({ bloom: 5 });
    expect(calls.filter((c) => c.name === 'fill' && c.fill === '#ffffff')).toHaveLength(4);
    expect(calls.filter((c) => c.name === 'fill' && c.fill === COLORS.butterfly)).toHaveLength(4);
  });

  it("quand la fleur se fane, il garde son état et s'efface par l'opacité", () => {
    // La valeur fanée (2,3 et 2,5 fois) l'aurait fait disparaître d'un coup.
    for (const bloom of [4.6, 5]) {
      const calls = butterflyCalls({ bloom, wither: 0.5 });
      const fill = calls.find((c) => c.name === 'fill' && c.fill === COLORS.butterfly);
      expect(fill?.alpha).toBeCloseTo(0.5);
    }
    expect(butterflyCalls({ bloom: 5, wither: 1 })).toEqual([]);
    expect(butterflyCalls({ bloom: 4, wither: 0.5 })).toEqual([]);
  });
});
