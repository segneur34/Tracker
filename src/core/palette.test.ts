import { describe, expect, it } from 'vitest';
import { BASE_COLOR, FAMILY_SHADES, activityFamily, baseActivity } from './activities';
import { SPORT_FAMILIES, SPORT_PROFILES } from './sportProfiles';
import type { SportType } from './types';

/**
 * Couleurs des familles et nuances des activités (§10, point 90) : lisibles
 * sur fond blanc, distinctes, et la couleur de famille du thème égale à la
 * première nuance.
 */

const channel = (hex: string, i: number) => {
  const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const linear = (hex: string) => [0, 1, 2].map((i) => channel(hex, i));
/** Contraste WCAG d'une couleur sur blanc. */
const contrastOnWhite = (hex: string) => {
  const [r, g, b] = linear(hex);
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
};
/** Écart perçu, distance dans OKLab (× 100). */
const oklab = (hex: string) => {
  const [r, g, b] = linear(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};
const distance = (a: string, b: string) => {
  const [p, q] = [oklab(a), oklab(b)];
  return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

/**
 * Texte de `theme/tokens.css`. Vitest rend vide un CSS importé, même en
 * `?raw`, et la config TypeScript de l'application ne connaît pas Node : le
 * module `fs` est chargé à l'exécution, sous un type minimal.
 */
const readTokensCss = async (): Promise<string> => {
  const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readFileSync: (path: URL, encoding: 'utf8') => string };
  return fs.readFileSync(new URL('../theme/tokens.css', import.meta.url), 'utf8');
};

const TOKEN: Record<string, string> = { voile: '--voile', course: '--course', velo: '--velo', fractionne: '--fractionne' };

describe('nuances des familles', () => {
  it('six nuances par famille, en minuscules', () => {
    for (const family of SPORT_FAMILIES) {
      expect(FAMILY_SHADES[family]).toHaveLength(6);
      for (const shade of FAMILY_SHADES[family]) expect(shade).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('la couleur de famille du thème est la première nuance', async () => {
    const tokensCss = await readTokensCss();
    for (const family of SPORT_FAMILIES) {
      const match = tokensCss.match(new RegExp(`${TOKEN[family]}:\\s*(#[0-9a-fA-F]{6});`));
      expect(match?.[1].toLowerCase(), family).toBe(FAMILY_SHADES[family][0]);
    }
  });

  it('contraste sur blanc : 4,5 pour la couleur de famille (texte blanc), 3 pour les autres', () => {
    for (const family of SPORT_FAMILIES) {
      const [first, ...others] = FAMILY_SHADES[family];
      expect(contrastOnWhite(first), first).toBeGreaterThanOrEqual(4.5);
      for (const shade of others) expect(contrastOnWhite(shade), shade).toBeGreaterThanOrEqual(3);
    }
  });

  it('distinctes dans une famille et d\'une famille à l\'autre', () => {
    const all = SPORT_FAMILIES.flatMap((family) => FAMILY_SHADES[family].map((shade) => ({ family, shade })));
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const floor = all[i].family === all[j].family ? 6 : 8;
        expect(distance(all[i].shade, all[j].shade), `${all[i].shade} / ${all[j].shade}`).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  it('chaque calcul a une couleur de base parmi les nuances de sa famille', () => {
    for (const sport of Object.keys(SPORT_PROFILES) as SportType[]) {
      expect(FAMILY_SHADES[activityFamily(baseActivity(sport))]).toContain(BASE_COLOR[sport]);
    }
  });
});
