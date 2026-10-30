import { describe, expect, it } from 'vitest';
import { tileUrl } from '../core/mapBase';
import { tileKey, type AncestorTile } from '../core/tiles';
import { createTileResolver, isAbsentStatus, type FetchedTile } from './mapTiles';
import type { StoredTile } from './tileCache';

const DAY_MS = 24 * 3600 * 1000;
const NOW = 100 * DAY_MS;
const TILE = { z: 15, x: 16808, y: 11953 };

/** Image de tuile factice, reconnaissable à son contenu. */
const image = (name: string) => new Blob([name], { type: 'image/png' });

/** Requête au serveur en attente de sa réponse, rendue à la main par `answer`. */
interface Call {
  url: string;
  signal: AbortSignal;
  answer: (result: FetchedTile) => void;
}

/** Résolveur sur une mémoire et un serveur factices ; `serve` répond tout de suite, sinon la requête attend `answer`. */
const setup = ({ stored = {}, serve, online = true }: {
  stored?: Record<string, StoredTile>;
  serve?: (url: string) => FetchedTile;
  online?: boolean;
} = {}) => {
  const memory = new Map(Object.entries(stored));
  const calls: Call[] = [];
  const kept: string[] = [];
  const crops: { ancestor: AncestorTile; size: number }[] = [];
  const resolver = createTileResolver({
    store: { read: async (key) => memory.get(key) ?? null },
    keep: async (key, blob) => {
      kept.push(key);
      memory.set(key, { blob, savedAtMs: NOW });
    },
    fetchTile: (url, signal) => new Promise((resolve) => {
      const call: Call = { url, signal, answer: resolve };
      calls.push(call);
      signal.addEventListener('abort', () => resolve('echec'));
      if (serve) resolve(serve(url));
    }),
    isOnline: () => online,
    crop: async (_blob, ancestor, size) => {
      crops.push({ ancestor, size });
      return `data:agrandie-${ancestor.tile.z}`;
    },
    now: () => NOW,
  });
  return { resolver, calls, kept, crops, memory };
};

/** Laisse passer les promesses en attente. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('resolveTile', () => {
  it('rend la tuile gardée sans rien demander au serveur', async () => {
    const blob = image('gardée');
    const { resolver, calls } = setup({ stored: { [tileKey(TILE)]: { blob, savedAtMs: NOW } } });
    expect(await resolver.resolveTile(TILE, 'plan', 256)).toBe(blob);
    expect(calls).toHaveLength(0);
  });

  it('montre une tuile vieillie, puis la redemande et la garde', async () => {
    const old = image('vieille');
    const fresh = image('fraîche');
    const { resolver, calls, kept } = setup({ stored: { [tileKey(TILE)]: { blob: old, savedAtMs: NOW - 8 * DAY_MS } }, serve: () => fresh });
    expect(await resolver.resolveTile(TILE, 'plan', 256)).toBe(old);
    await flush();
    expect(calls.map((c) => c.url)).toEqual([tileUrl('plan', TILE)]);
    expect(kept).toEqual([tileKey(TILE)]);
  });

  it('demande une tuile absente, la rend et la garde', async () => {
    const blob = image('reçue');
    const { resolver, kept } = setup({ serve: () => blob });
    expect(await resolver.resolveTile(TILE, 'plan', 256)).toBe(blob);
    await flush();
    expect(kept).toEqual([tileKey(TILE)]);
  });

  it('découpe la parente gardée la plus proche quand le serveur n’a pas la tuile', async () => {
    const parent = { z: 13, x: 4202, y: 2988 };
    const { resolver, crops } = setup({ stored: { [tileKey(parent)]: { blob: image('parente'), savedAtMs: NOW } }, serve: () => 'absent' });
    expect(await resolver.resolveTile(TILE, 'plan', 256)).toBe('data:agrandie-13');
    expect(crops).toEqual([{ ancestor: { tile: parent, scale: 4, col: 0, row: 1 }, size: 256 }]);
  });

  it('rend null sans tuile ni parente', async () => {
    const { resolver } = setup({ online: false });
    expect(await resolver.resolveTile(TILE, 'plan', 256)).toBeNull();
  });
});

describe('requêtes partagées', () => {
  it('deux demandes de la même tuile ne font qu’une requête', async () => {
    const blob = image('reçue');
    const { resolver, calls } = setup();
    const first = resolver.resolveTile(TILE, 'plan', 256);
    const second = resolver.resolveTile(TILE, 'plan', 256);
    await flush();
    expect(calls).toHaveLength(1);
    calls[0].answer(blob);
    expect(await first).toBe(blob);
    expect(await second).toBe(blob);
  });

  it('un abandon sur deux garde la requête, et la tuile reçue est gardée', async () => {
    const blob = image('reçue');
    const { resolver, calls, kept } = setup();
    const gone = new AbortController();
    const first = resolver.resolveTile(TILE, 'plan', 256, gone.signal);
    const second = resolver.resolveTile(TILE, 'plan', 256, new AbortController().signal);
    await flush();
    gone.abort();
    expect(await first).toBeNull();
    expect(calls[0].signal.aborted).toBe(false);
    calls[0].answer(blob);
    expect(await second).toBe(blob);
    await flush();
    expect(kept).toEqual([tileKey(TILE)]);
  });

  it('deux abandons coupent la requête, sans rien garder', async () => {
    const { resolver, calls, kept } = setup();
    const a = new AbortController();
    const b = new AbortController();
    const first = resolver.resolveTile(TILE, 'plan', 256, a.signal);
    const second = resolver.resolveTile(TILE, 'plan', 256, b.signal);
    await flush();
    a.abort();
    b.abort();
    expect(await first).toBeNull();
    expect(await second).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].signal.aborted).toBe(true);
    await flush();
    expect(kept).toEqual([]);
  });

  it('une demande abandonnée avant de partir ne demande rien', async () => {
    const { resolver, calls } = setup();
    const gone = new AbortController();
    gone.abort();
    expect(await resolver.resolveTile(TILE, 'plan', 256, gone.signal)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('remontée vers les zooms inférieurs', () => {
  it('ne redemande pas le temps de la page une tuile que le serveur n’a pas', async () => {
    // Photo satellite au large : la tuile et ses parentes demandées une fois, la plus haute servie.
    const top = { z: 12, x: 2101, y: 1494 };
    const { resolver, calls } = setup({ serve: (url) => (url === tileUrl('satellite', top) ? image('large') : 'absent') });
    expect(await resolver.resolveTile(TILE, 'satellite', 256)).toBe('data:agrandie-12');
    expect(calls).toHaveLength(4);
    // La parente reçue est gardée : la seconde fois, plus rien ne part.
    await flush();
    expect(await resolver.resolveTile(TILE, 'satellite', 256)).toBe('data:agrandie-12');
    expect(calls).toHaveLength(4);
  });

  it('après un échec du réseau, ne lit plus que la mémoire', async () => {
    const parent = { z: 11, x: 1050, y: 747 };
    const { resolver, calls } = setup({ stored: { [tileKey(parent, 'sat_')]: { blob: image('gardée'), savedAtMs: NOW } }, serve: () => 'echec' });
    expect(await resolver.resolveTile(TILE, 'satellite', 256)).toBe('data:agrandie-11');
    expect(calls.map((c) => c.url)).toEqual([tileUrl('satellite', TILE)]);
  });
});

describe('réponse d’erreur du serveur', () => {
  it('ne prend pour absente qu’une tuile en 404 ou 410', () => {
    expect(isAbsentStatus(404)).toBe(true);
    expect(isAbsentStatus(410)).toBe(true);
    for (const status of [429, 500, 502, 503, 403]) expect(isAbsentStatus(status)).toBe(false);
  });

  it('redemande à l’affichage suivant une tuile refusée un instant (503), et la rend', async () => {
    const blob = image('reçue');
    const answers: FetchedTile[] = ['echec', blob];
    const { resolver, calls, kept } = setup({ serve: () => answers.shift() ?? 'echec' });
    expect(await resolver.resolveTile(TILE, 'plan', 256)).toBeNull();
    expect(await resolver.resolveTile(TILE, 'plan', 256)).toBe(blob);
    expect(calls).toHaveLength(2);
    await flush();
    expect(kept).toEqual([tileKey(TILE)]);
  });

  it('ne redemande pas le temps de la page une tuile en 404', async () => {
    const { resolver, calls, kept } = setup({ serve: () => 'absent' });
    expect(await resolver.resolveTile(TILE, 'plan', 256)).toBeNull();
    expect(await resolver.resolveTile(TILE, 'plan', 256)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(kept).toEqual([]);
  });
});
