import { describe, expect, it } from 'vitest';
import { cardHeight, cardTop, fitBoundsView, fitView, fullView, mapHeight,pickShareStats, projectPoint, SHARE_IMAGE, shareableStats, statColumns, statRows, viewTiles, worldPx, type ShareStat } from './shareImage';

/** Une boucle d'environ 2 km au large de Marseille. */
const loop: Array<[number, number]> = Array.from({ length: 60 }, (_, i) => {
  const a = (i / 60) * 2 * Math.PI;
  return [43.28 + 0.009 * Math.sin(a), 5.33 + 0.012 * Math.cos(a)];
});

describe('worldPx', () => {
  it('place le méridien de Greenwich et l\'équateur au centre du monde', () => {
    const p = worldPx(0, 0, 0);
    expect(p.x).toBeCloseTo(128);
    expect(p.y).toBeCloseTo(128);
  });

  it('double les coordonnées à chaque zoom', () => {
    const a = worldPx(43.3, 5.4, 10);
    const b = worldPx(43.3, 5.4, 11);
    expect(b.x).toBeCloseTo(2 * a.x);
    expect(b.y).toBeCloseTo(2 * a.y);
  });
});

describe('fitView', () => {
  it('rend null sans point', () => {
    expect(fitView([], 1080, 760)).toBeNull();
  });

  it('tient toute la trace dans le cadre, marge comprise, et la remplit sur un côté', () => {
    const view = fitView(loop, 1080, 760, 70)!;
    expect(view.scale).toBeGreaterThanOrEqual(1);
    expect(view.scale).toBeLessThan(2);
    const projected = loop.map(([lat, lon]) => projectPoint(view, lat, lon));
    const xs = projected.map((p) => p.x);
    const ys = projected.map((p) => p.y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(70 - 1e-6);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1080 - 70 + 1e-6);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(70 - 1e-6);
    expect(Math.max(...ys)).toBeLessThanOrEqual(760 - 70 + 1e-6);
    const filled = Math.max((Math.max(...xs) - Math.min(...xs)) / (1080 - 140), (Math.max(...ys) - Math.min(...ys)) / (760 - 140));
    expect(filled).toBeCloseTo(1, 6);
  });

  it('centre la trace', () => {
    const view = fitView(loop, 1080, 760)!;
    const projected = loop.map(([lat, lon]) => projectPoint(view, lat, lon));
    const xs = projected.map((p) => p.x);
    const ys = projected.map((p) => p.y);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(540, 6);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(380, 6);
  });

  it('plafonne le zoom pour un point seul', () => {
    const view = fitView([[43.3, 5.4]], 1080, 760)!;
    expect(view.zoom).toBe(SHARE_IMAGE.maxZoom);
    expect(view.scale).toBe(1);
    const p = projectPoint(view, 43.3, 5.4);
    expect(p.x).toBeCloseTo(540);
    expect(p.y).toBeCloseTo(380);
  });

  it('ne dépend pas du nombre de points de la trace', () => {
    const sparse = loop.filter((_, i) => i % 5 === 0);
    const dense = fitView(loop, 1080, 760)!;
    const light = fitView([...sparse, ...loop.filter((_, i) => [14, 15, 30, 44, 45].includes(i))], 1080, 760)!;
    expect(light.zoom).toBe(dense.zoom);
  });
});

describe('fitBoundsView', () => {
  const options = { paddingPx: 8, maxZoom: 17 };

  it('rend null sans point', () => {
    expect(fitBoundsView([], 200, 100, options)).toBeNull();
  });

  it('prend le zoom entier où l’emprise tient, marges comprises, et centre au pixel près', () => {
    // 0,703125° de longitude à l’équateur : un demi-pixel au zoom 0 ; 184 px offerts : 368 fois, zoom 8,5 → 8.
    const view = fitBoundsView([[0, 0], [0, 0.703125]], 200, 100, options)!;
    expect(view).toEqual({ zoom: 8, scale: 1, originX: 32732, originY: 32718, widthPx: 200, heightPx: 100 });
  });

  it('monte d’un cran à moins d’un centième de zoom, comme Leaflet', () => {
    const lonFor = (ratio: number) => (184 * 360) / (256 * ratio);
    expect(fitBoundsView([[0, 0], [0, lonFor(512 * 0.998)]], 200, 100, options)!.zoom).toBe(9);
    expect(fitBoundsView([[0, 0], [0, lonFor(512 * 0.99)]], 200, 100, options)!.zoom).toBe(8);
  });

  it('plafonne le zoom pour un point seul', () => {
    const view = fitBoundsView([[43.3, 5.4]], 200, 100, options)!;
    expect(view.zoom).toBe(17);
    const p = worldPx(43.3, 5.4, 17);
    expect(view.originX).toBe(Math.round(p.x - 100));
    expect(view.originY).toBe(Math.round(p.y - 50));
  });

  it('garde toute la trace dans le cadre, marges comprises', () => {
    const view = fitBoundsView(loop, 280, 140, options)!;
    for (const [lat, lon] of loop) {
      const p = projectPoint(view, lat, lon);
      expect(p.x).toBeGreaterThanOrEqual(8 - 1);
      expect(p.x).toBeLessThanOrEqual(280 - 8 + 1);
      expect(p.y).toBeGreaterThanOrEqual(8 - 1);
      expect(p.y).toBeLessThanOrEqual(140 - 8 + 1);
    }
  });
});

describe('viewTiles', () => {
  it('couvre tout le cadre sans trou', () => {
    const view = fitView(loop, 1080, 760)!;
    const tiles = viewTiles(view);
    const left = Math.min(...tiles.map((t) => t.x));
    const top = Math.min(...tiles.map((t) => t.y));
    const right = Math.max(...tiles.map((t) => t.x + t.sizePx));
    const bottom = Math.max(...tiles.map((t) => t.y + t.sizePx));
    expect(left).toBeLessThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(0);
    expect(right).toBeGreaterThanOrEqual(1080);
    expect(bottom).toBeGreaterThanOrEqual(760);
    const columns = new Set(tiles.map((t) => t.x)).size;
    const rows = new Set(tiles.map((t) => t.y)).size;
    expect(tiles.length).toBe(columns * rows);
  });

  it('fait le tour du monde en longitude', () => {
    const view = fitView([[0, 179.999], [0, -179.999]], 1080, 760)!;
    for (const { tile } of viewTiles(view)) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x).toBeLessThan(2 ** tile.z);
    }
  });
});

describe('chiffres de l\'image', () => {
  const stats: ShareStat[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((key) => ({ key, label: key, value: '1' }));

  it('prend les premiers sans choix retenu', () => {
    expect(pickShareStats(stats, null).map((s) => s.key)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('garde l\'ordre de la synthèse et ignore un chiffre absent de la session', () => {
    expect(pickShareStats(stats, ['g', 'b', 'z']).map((s) => s.key)).toEqual(['b', 'g']);
  });

  it('rend une liste vide si l\'utilisateur a tout décoché', () => {
    expect(pickShareStats(stats, [])).toEqual([]);
  });

  it('ne garde jamais plus de six chiffres', () => {
    expect(pickShareStats(stats, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])).toHaveLength(SHARE_IMAGE.maxStats);
  });

  it('met une rangée jusqu\'à trois chiffres, deux sur deux pour quatre, trois colonnes au-delà', () => {
    expect([1, 2, 3, 4, 5, 6].map(statColumns)).toEqual([1, 2, 3, 2, 3, 3]);
    expect([0, 1, 3, 4, 6].map(statRows)).toEqual([0, 1, 1, 2, 2]);
  });

  it('fait une image en hauteur, au format d\'un écran (1080 × 1920)', () => {
    expect(SHARE_IMAGE.widthPx).toBe(1080);
    expect(SHARE_IMAGE.heightPx).toBe(1920);
  });

  it('dimensionne le cartouche sur les rangées de chiffres, à 60 px du bas', () => {
    expect([0, 3, 6].map(cardHeight)).toEqual([0, 270, 400]);
    expect(cardHeight(9)).toBe(cardHeight(6));
    for (const count of [1, 3, 4, 6]) expect(cardTop(count) + cardHeight(count)).toBe(SHARE_IMAGE.heightPx - 60);
  });

  it('cadre la trace entre le titre et le cartouche : plus de chiffres, zone plus basse', () => {
    expect(mapHeight(0)).toBe(SHARE_IMAGE.heightPx - SHARE_IMAGE.footerVeilPx - SHARE_IMAGE.frameTopPx);
    expect(mapHeight(3)).toBe(cardTop(3) - SHARE_IMAGE.frameTopPx);
    expect(mapHeight(0)).toBeGreaterThan(mapHeight(3));
    expect(mapHeight(3)).toBeGreaterThan(mapHeight(6));
    expect(mapHeight(9)).toBe(mapHeight(6));
    expect(mapHeight(6)).toBeGreaterThan(SHARE_IMAGE.heightPx / 2);
  });

  it('tient la trace entre le titre et le cartouche quel que soit le nombre de chiffres', () => {
    const points: [number, number][] = [[43.5, 3.8], [43.62, 3.95]];
    const { widthPx, heightPx, frameTopPx, paddingPx } = SHARE_IMAGE;
    for (const count of [0, 4, 6]) {
      const view = fullView(fitView(points, widthPx, mapHeight(count))!, frameTopPx, heightPx);
      const bottom = count === 0 ? heightPx - SHARE_IMAGE.footerVeilPx : cardTop(count);
      for (const [lat, lon] of points) {
        const p = projectPoint(view, lat, lon);
        expect(p.x).toBeGreaterThanOrEqual(paddingPx - 1e-6);
        expect(p.x).toBeLessThanOrEqual(widthPx - paddingPx + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(frameTopPx + paddingPx - 1e-6);
        expect(p.y).toBeLessThanOrEqual(bottom - paddingPx + 1e-6);
      }
    }
  });

  it('étend le fond de carte à toute l\'image', () => {
    const { widthPx, heightPx, frameTopPx } = SHARE_IMAGE;
    const fitted = fitView(loop, widthPx, mapHeight(6))!;
    const view = fullView(fitted, frameTopPx, heightPx);
    expect(view.zoom).toBe(fitted.zoom);
    expect(view.scale).toBe(fitted.scale);
    expect(view.heightPx).toBe(heightPx);
    const tiles = viewTiles(view);
    expect(Math.min(...tiles.map((t) => t.x))).toBeLessThanOrEqual(0);
    expect(Math.min(...tiles.map((t) => t.y))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.x + t.sizePx))).toBeGreaterThanOrEqual(widthPx);
    expect(Math.max(...tiles.map((t) => t.y + t.sizePx))).toBeGreaterThanOrEqual(heightPx);
  });
});

describe('shareableStats', () => {
  it('écarte les chiffres que la session n\'a pas', () => {
    const stats: ShareStat[] = [
      { key: 'distance', label: 'Distance', value: '12,3 km' },
      { key: 'altitude', label: 'Altitude', value: '—' },
    ];
    expect(shareableStats(stats).map((s) => s.key)).toEqual(['distance']);
  });
});
