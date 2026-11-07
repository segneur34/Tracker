import { describe, expect, it } from 'vitest';
import { ancestorTile, isStale, shouldCheckCap, TILE_CACHE_DEFAULTS, tileCacheUsage, tileKey, tilesToEvict, tilesToRetry, tileViewOf } from './tiles';

describe('tileKey', () => {
  it('nomme la tuile par son zoom, sa colonne et sa ligne', () => {
    expect(tileKey({ z: 14, x: 8310, y: 5980 })).toBe('14_8310_5980');
  });
});

describe('ancestorTile', () => {
  it('trouve la parente et la case de la tuile en elle', () => {
    expect(ancestorTile({ z: 15, x: 16621, y: 11963 }, 1)).toEqual({ tile: { z: 14, x: 8310, y: 5981 }, scale: 2, col: 1, row: 1 });
    expect(ancestorTile({ z: 15, x: 16620, y: 11962 }, 1)).toEqual({ tile: { z: 14, x: 8310, y: 5981 }, scale: 2, col: 0, row: 0 });
    expect(ancestorTile({ z: 17, x: 66487, y: 47855 }, 3)).toEqual({ tile: { z: 14, x: 8310, y: 5981 }, scale: 8, col: 7, row: 7 });
  });

  it('ne remonte pas au-dessus du zoom 0', () => {
    expect(ancestorTile({ z: 2, x: 1, y: 1 }, 3)).toBeNull();
    expect(ancestorTile({ z: 2, x: 3, y: 2 }, 2)).toEqual({ tile: { z: 0, x: 0, y: 0 }, scale: 4, col: 3, row: 2 });
    expect(ancestorTile({ z: 5, x: 1, y: 1 }, 0)).toBeNull();
  });
});

describe('isStale', () => {
  it('compare l’âge à la limite', () => {
    expect(isStale(0, 1000, 999)).toBe(true);
    expect(isStale(0, 1000, 1000)).toBe(false);
  });
});

describe('tilesToEvict', () => {
  const entries = [
    { key: 'b', bytes: 30, savedAtMs: 2 },
    { key: 'a', bytes: 40, savedAtMs: 1 },
    { key: 'c', bytes: 30, savedAtMs: 3 },
  ];

  it('ne touche à rien sous le plafond', () => {
    expect(tilesToEvict(entries, 100)).toEqual([]);
    expect(tileCacheUsage(entries)).toEqual({ tiles: 3, bytes: 100 });
  });

  it('efface les plus anciennes jusqu’à repasser sous le plafond', () => {
    expect(tilesToEvict(entries, 99)).toEqual(['a']);
    expect(tilesToEvict(entries, 30)).toEqual(['a', 'b']);
    expect(tilesToEvict(entries, 0)).toEqual(['a', 'b', 'c']);
  });
});

describe('shouldCheckCap', () => {
  it('contrôle la place au plus une fois par intervalle', () => {
    expect(shouldCheckCap(0, 60_000, 60_000)).toBe(true);
    expect(shouldCheckCap(10_000, 69_999, 60_000)).toBe(false);
    expect(shouldCheckCap(10_000, 70_000, 60_000)).toBe(true);
  });
});

describe('tileViewOf', () => {
  it('rend les cases touchées par le rectangle de pixels', () => {
    expect(tileViewOf(15, { x: 512, y: 256 }, { x: 1024, y: 700 }, 256)).toEqual({ z: 15, minX: 2, maxX: 3, minY: 1, maxY: 2 });
  });

  it('un bord tombé juste entre deux cases ne compte pas la suivante', () => {
    expect(tileViewOf(15, { x: 0, y: 0 }, { x: 256, y: 256 }, 256)).toEqual({ z: 15, minX: 0, maxX: 0, minY: 0, maxY: 0 });
  });

  it('un rectangle à cheval sur le bord du monde garde ses colonnes négatives', () => {
    expect(tileViewOf(3, { x: -300, y: 0 }, { x: 100, y: 100 }, 256)).toEqual({ z: 3, minX: -2, maxX: 0, minY: 0, maxY: 0 });
  });
});

describe('tilesToRetry', () => {
  const NOW = 1_000_000;
  const GAP = 60_000;
  const VIEW = { z: 15, minX: 100, maxX: 102, minY: 200, maxY: 201 };
  const entry = (x: number, y: number, ageMs = GAP, z = 15) => ({ coords: { z, x, y }, triedAtMs: NOW - ageMs });

  it('garde les cases de la vue, bornes comprises', () => {
    const entries = [entry(100, 200), entry(102, 201), entry(101, 200)];
    expect(tilesToRetry(entries, VIEW, NOW, GAP)).toEqual(entries);
  });

  it('écarte une case hors de la vue', () => {
    expect(tilesToRetry([entry(99, 200), entry(103, 200), entry(100, 199), entry(100, 202)], VIEW, NOW, GAP)).toEqual([]);
  });

  it('écarte une case d’un autre zoom, même colonne et même ligne', () => {
    expect(tilesToRetry([entry(100, 200, GAP, 14), entry(100, 200, GAP, 16)], VIEW, NOW, GAP)).toEqual([]);
  });

  it('respecte l’attente par case, l’instant exact compris', () => {
    const due = entry(100, 200, GAP);
    expect(tilesToRetry([entry(101, 200, GAP - 1), due], VIEW, NOW, GAP)).toEqual([due]);
  });

  it('une case jamais demandée ou très ancienne repart', () => {
    const old = { coords: { z: 15, x: 100, y: 200 }, triedAtMs: 0 };
    expect(tilesToRetry([old], VIEW, NOW, GAP)).toEqual([old]);
  });

  it('reconnaît une case repliée sur le monde quand la vue passe l’antiméridien', () => {
    // Au zoom 3, 8 colonnes : la vue de -2 à 0 montre les colonnes 6, 7 et 0.
    const view = { z: 3, minX: -2, maxX: 0, minY: 0, maxY: 7 };
    const shown = [entry(6, 1, GAP, 3), entry(7, 1, GAP, 3), entry(0, 1, GAP, 3)];
    expect(tilesToRetry([...shown, entry(1, 1, GAP, 3), entry(5, 1, GAP, 3)], view, NOW, GAP)).toEqual(shown);
  });

  it('les délais tiennent ensemble', () => {
    const { retryDelaysMs, retryGapMs, moveRetryGapMs, stuckLoadMs, fetchTimeoutMs } = TILE_CACHE_DEFAULTS;
    for (let k = 1; k < retryDelaysMs.length; k++) {
      const gap = retryDelaysMs[k] - retryDelaysMs[k - 1];
      // Une case échouée juste avant une reprise doit pouvoir repartir à la suivante.
      expect(gap).toBeGreaterThanOrEqual(retryGapMs);
      // Une reprise perdue dans l'attente du serveur est finie quand la suivante passe.
      expect(gap).toBeGreaterThan(fetchTimeoutMs);
    }
    expect(moveRetryGapMs).toBeGreaterThan(retryDelaysMs[retryDelaysMs.length - 1]);
    // Une demande normale, même enchaînée sur une parente, n'est jamais coupée.
    expect(stuckLoadMs).toBeGreaterThan(2 * fetchTimeoutMs);
  });
});
