import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Écoute de la ceinture (B5) : un abonnement aux événements du greffon qui
 * échoue une fois n'empêche pas un `holdBelt` suivant de réessayer.
 */

const plugin = vi.hoisted(() => ({
  /** Abonnements à refuser, dans l'ordre des appels. */
  refusals: 0,
  added: [] as string[],
  removed: [] as string[],
  connects: 0,
  disconnects: 0,
  /** Écouteurs posés, par événement, pour jouer les événements du greffon. */
  listeners: {} as Record<string, (data: unknown) => void>,
}));

vi.mock('./runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./runtime')>()),
  isNativeApp: () => true,
}));

vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  registerPlugin: () => ({
    addListener: async (event: string, listener: (data: unknown) => void) => {
      if (plugin.refusals > 0) {
        plugin.refusals -= 1;
        throw new Error('greffon pas prêt');
      }
      plugin.added.push(event);
      plugin.listeners[event] = listener;
      return { remove: async () => void plugin.removed.push(event) };
    },
    connect: async () => {
      plugin.connects += 1;
    },
    disconnect: async () => {
      plugin.disconnects += 1;
    },
  }),
}));

beforeEach(() => {
  plugin.refusals = 0;
  plugin.added = [];
  plugin.removed = [];
  plugin.connects = 0;
  plugin.disconnects = 0;
  plugin.listeners = {};
  vi.resetModules();
});

/** Joue un événement du greffon vers la page. */
const emit = (event: 'heartRate' | 'status', data: unknown): void => plugin.listeners[event](data);

const belt = { address: 'AA:BB:CC:DD:EE:FF', name: 'Ceinture' };

describe('écoute de la ceinture', () => {
  it("un premier abonnement en échec est oublié : la prise suivante réessaie et se connecte", async () => {
    const { holdBelt } = await import('./heartRate');
    plugin.refusals = 1;
    await expect(holdBelt('essai', belt)).rejects.toThrow('greffon pas prêt');
    expect(plugin.connects).toBe(0);
    const release = await holdBelt('essai', belt);
    expect(plugin.connects).toBe(1);
    release();
  });

  it("la moitié prise d'un abonnement en échec est rendue : pas d'événement en double au nouvel essai", async () => {
    const { holdBelt } = await import('./heartRate');
    plugin.refusals = 1;
    await expect(holdBelt('essai', belt)).rejects.toThrow();
    expect(plugin.removed).toEqual(plugin.added);
    plugin.added = [];
    const release = await holdBelt('essai', belt);
    expect(plugin.added.sort()).toEqual(['heartRate', 'status']);
    release();
  });

  it("un abonnement réussi n'est pris qu'une fois", async () => {
    const { holdBelt } = await import('./heartRate');
    const first = await holdBelt('essai', belt);
    const second = await holdBelt('enregistrement', belt);
    expect(plugin.added.sort()).toEqual(['heartRate', 'status']);
    first();
    second();
  });
});

/**
 * Ceinture perdue pendant un enregistrement (lot 86) : la relance est au
 * greffon ; la page garde la ceinture, montre la perte et un trou dans la FC,
 * et reprend d'elle-même à la première mesure revenue.
 */
describe('ceinture perdue', () => {
  it("une perte ne rend pas la connexion : le détenteur la garde, rien n'est coupé ni redemandé", async () => {
    const { holdBelt, beltHeldBy, beltState } = await import('./heartRate');
    const release = await holdBelt('enregistrement', belt);
    emit('status', { state: 'connected', address: belt.address });
    emit('status', { state: 'lost', address: belt.address });
    expect(beltState()).toBe('lost');
    expect(beltHeldBy('enregistrement')).toBe(true);
    expect(plugin.disconnects).toBe(0);
    expect(plugin.connects).toBe(1);
    release();
    expect(plugin.disconnects).toBe(1);
  });

  it("pendant la perte, pas de FC : la dernière mesure n'est pas gardée", async () => {
    const { holdBelt, latestHeartRate } = await import('./heartRate');
    const release = await holdBelt('enregistrement', belt);
    emit('heartRate', { bpm: 142, timeMs: 1000, contact: true });
    expect(latestHeartRate()?.bpm).toBe(142);
    emit('status', { state: 'lost', address: belt.address });
    expect(latestHeartRate()).toBeNull();
    release();
  });

  it('la première mesure revenue rend la ceinture connectée, avec sa FC', async () => {
    const { holdBelt, beltState, latestHeartRate, subscribeBeltState } = await import('./heartRate');
    const release = await holdBelt('enregistrement', belt);
    const states: string[] = [];
    const off = subscribeBeltState((s) => states.push(s));
    emit('status', { state: 'lost', address: belt.address });
    emit('heartRate', { bpm: 120, timeMs: 2000 });
    expect(beltState()).toBe('connected');
    expect(states).toEqual(['lost', 'connected']);
    expect(latestHeartRate()).toEqual({ bpm: 120, timeMs: 2000, contact: null });
    off();
    release();
  });

  it("une seconde prise pendant la perte ne relance pas la connexion : le greffon s'en charge", async () => {
    const { holdBelt } = await import('./heartRate');
    const first = await holdBelt('enregistrement', belt);
    emit('status', { state: 'lost', address: belt.address });
    const second = await holdBelt('essai', belt);
    expect(plugin.connects).toBe(1);
    first();
    second();
  });
});

/** Deux détenteurs (l'enregistreur et un test guidé) : la connexion n'est coupée que par le dernier qui la rend. */
describe('deux détenteurs de la ceinture', () => {
  it("le premier qui rend ne coupe rien ; le second, qui rend en dernier, coupe une seule fois", async () => {
    const { holdBelt, beltHeldBy, beltState } = await import('./heartRate');
    const first = await holdBelt('enregistrement', belt);
    emit('status', { state: 'connected', address: belt.address });
    const second = await holdBelt('essai', belt);
    expect(plugin.connects).toBe(1);
    expect(beltHeldBy('enregistrement')).toBe(true);
    expect(beltHeldBy('essai')).toBe(true);

    first();
    expect(beltHeldBy('enregistrement')).toBe(false);
    expect(beltHeldBy('essai')).toBe(true);
    expect(plugin.disconnects).toBe(0);
    expect(beltState()).toBe('connected');

    second();
    expect(plugin.disconnects).toBe(1);
    expect(beltState()).toBe('off');
  });

  it('rendre deux fois la même prise ne coupe pas la connexion de l\'autre détenteur', async () => {
    const { holdBelt, beltHeldBy } = await import('./heartRate');
    const first = await holdBelt('enregistrement', belt);
    const second = await holdBelt('essai', belt);
    first();
    first();
    expect(beltHeldBy('essai')).toBe(true);
    expect(plugin.disconnects).toBe(0);
    second();
    expect(plugin.disconnects).toBe(1);
  });
});
