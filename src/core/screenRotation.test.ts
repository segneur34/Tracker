import { describe, expect, it } from 'vitest';
import { coverSquareSide, rotateAround, svgPaddingFor, unwrapDeg, zoomDeltaForAnyBearing } from './screenRotation';

const C = { x: 195, y: 400 };

describe('rotateAround', () => {
  it('ne change rien à 0° ni à 360°', () => {
    expect(rotateAround({ x: 12, y: -7 }, C, 0)).toEqual({ x: 12, y: -7 });
    expect(rotateAround({ x: 12, y: -7 }, C, 360)).toEqual({ x: 12, y: -7 });
  });

  it('tourne dans le sens horaire à l\'écran (y vers le bas), comme rotate() en CSS', () => {
    // Un point au-dessus du centre passe à sa droite après un quart de tour.
    const p = rotateAround({ x: C.x, y: C.y - 100 }, C, 90);
    expect(p.x).toBeCloseTo(C.x + 100, 9);
    expect(p.y).toBeCloseTo(C.y, 9);
  });

  it('écran → carte → écran rend le point de départ, à tout angle', () => {
    for (let deg = -720; deg <= 720; deg += 37) {
      const screen = { x: 31.5, y: 788.25 };
      const map = rotateAround(screen, C, -deg);
      const back = rotateAround(map, C, deg);
      expect(back.x).toBeCloseTo(screen.x, 9);
      expect(back.y).toBeCloseTo(screen.y, 9);
    }
  });

  it('garde les distances au centre', () => {
    const p = rotateAround({ x: 0, y: 0 }, C, 33);
    expect(Math.hypot(p.x - C.x, p.y - C.y)).toBeCloseTo(Math.hypot(C.x, C.y), 9);
  });
});

describe('coverSquareSide', () => {
  it('rend la diagonale du cadre, au pixel au-dessus', () => {
    expect(coverSquareSide(300, 400)).toBe(500);
    expect(coverSquareSide(390, 800)).toBe(Math.ceil(Math.hypot(390, 800)));
    expect(coverSquareSide(0, 0)).toBe(0);
  });

  it('le carré couvre les quatre coins du cadre tourné, de 0° à 359°', () => {
    const [w, h] = [390, 800];
    const c = { x: w / 2, y: h / 2 };
    const half = coverSquareSide(w, h) / 2;
    for (let deg = 0; deg < 360; deg++) {
      for (const corner of [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]) {
        // Coin de l'écran ramené dans le repère de la carte : il doit tomber dans le carré chargé.
        const p = rotateAround(corner, c, -deg);
        expect(Math.abs(p.x - c.x)).toBeLessThanOrEqual(half + 1e-9);
        expect(Math.abs(p.y - c.y)).toBeLessThanOrEqual(half + 1e-9);
      }
    }
  });
});

describe('svgPaddingFor', () => {
  it('un cadre étroit reçoit la marge qui atteint le carré sur son côté le plus court', () => {
    const [w, h] = [390, 800];
    const padding = svgPaddingFor(w, h, 0.1);
    const side = coverSquareSide(w, h);
    expect(w * (1 + 2 * padding)).toBeGreaterThanOrEqual(side - 1e-9);
    expect(h * (1 + 2 * padding)).toBeGreaterThanOrEqual(side - 1e-9);
  });

  it('ne descend jamais sous la marge donnée, seule pour un cadre sans taille', () => {
    expect(svgPaddingFor(390, 800, 5)).toBe(5);
    expect(svgPaddingFor(0, 800, 0.1)).toBe(0.1);
  });
});

describe('unwrapDeg', () => {
  it('passe de 350° à 10° par 370°, sans tour par 180°', () => {
    expect(unwrapDeg(350, 10)).toBe(370);
    expect(unwrapDeg(10, 350)).toBe(-10);
    expect(unwrapDeg(-30, -45)).toBe(-45);
    expect(unwrapDeg(720, 5)).toBe(725);
  });
});

describe('zoomDeltaForAnyBearing', () => {
  it('une emprise qui tient droite peut déborder tournée : le zoom recule', () => {
    // Emprise de 300 × 300 dans un cadre de 348 × 360 : elle tient droite, pas à 45°.
    const delta = zoomDeltaForAnyBearing(300, 300, 348, 360);
    expect(delta).toBeLessThan(0);
    const scale = 2 ** delta;
    const c = { x: 174, y: 180 };
    const half = (300 * scale) / 2;
    for (const deg of [0, 30, 45, 90, 135]) {
      for (const corner of [{ x: c.x - half, y: c.y - half }, { x: c.x + half, y: c.y - half }, { x: c.x + half, y: c.y + half }, { x: c.x - half, y: c.y + half }]) {
        const p = rotateAround(corner, c, deg);
        expect(p.x).toBeGreaterThanOrEqual(-1e-9);
        expect(p.x).toBeLessThanOrEqual(348 + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(-1e-9);
        expect(p.y).toBeLessThanOrEqual(360 + 1e-9);
      }
    }
  });

  it('rien pour une emprise ou un cadre sans taille', () => {
    expect(zoomDeltaForAnyBearing(0, 0, 348, 360)).toBe(0);
    expect(zoomDeltaForAnyBearing(100, 100, 0, 360)).toBe(0);
  });
});
