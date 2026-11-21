import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FollowedTrace } from '../recording/followedTrace';
import { at } from '../test/geo.fixture';

/**
 * Trace suivie gardée sur l'appareil (lot 222, « Inverser ») : le stockage est une table en mémoire, le module
 * réimporté neuf à chaque test (sa trace est lue au premier besoin).
 */

const KEY = 'tracker.followedTrace';

/** Un coude vers le nord puis l'est, relief compris : rien à amincir. */
const trace: FollowedTrace = {
  name: 'Coude',
  source: 'route',
  activityId: 'running',
  points: [{ ...at(0, 0), eleM: 100 }, { ...at(0, 500), eleM: 150 }, { ...at(500, 500), eleM: 120 }],
};

let stored = new Map<string, string>();

const load = async () => {
  vi.resetModules();
  return import('./useFollowedTrace');
};

beforeEach(() => {
  stored = new Map();
  vi.stubGlobal('localStorage', { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v) });
});
afterEach(() => vi.unstubAllGlobals());

describe('inverser la trace suivie', () => {
  it('rend la trace à rebours, gardée sur l\'appareil, relue ainsi après une reprise', async () => {
    const store = await load();
    store.followTrace(trace);
    const chosen = store.getFollowedTrace()!;
    const heard = vi.fn();
    store.subscribeToFollowedTrace(heard);
    store.reverseFollowedTrace();
    expect(heard).toHaveBeenCalledTimes(1);
    const reversed = store.getFollowedTrace()!;
    expect(reversed.points).toEqual([...chosen.points].reverse());
    expect(reversed.name).toBe('Coude');
    expect(JSON.parse(stored.get(KEY)!)).toEqual(reversed);
    // Reprise : le module relit la trace gardée, toujours à rebours.
    const resumed = await load();
    expect(resumed.getFollowedTrace()!.points).toEqual(reversed.points);
  });

  it('deux inversions rendent exactement la trace choisie, sans nouvel amincissement', async () => {
    const store = await load();
    store.followTrace(trace);
    const chosen = store.getFollowedTrace();
    store.reverseFollowedTrace();
    store.reverseFollowedTrace();
    expect(store.getFollowedTrace()).toEqual(chosen);
  });

  it('sans trace suivie, rien', async () => {
    const store = await load();
    store.reverseFollowedTrace();
    expect(store.getFollowedTrace()).toBeNull();
    expect(stored.has(KEY)).toBe(false);
  });
});
