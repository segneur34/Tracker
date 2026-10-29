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
}));

vi.mock('./runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./runtime')>()),
  isNativeApp: () => true,
}));

vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  registerPlugin: () => ({
    addListener: async (event: string) => {
      if (plugin.refusals > 0) {
        plugin.refusals -= 1;
        throw new Error('greffon pas prêt');
      }
      plugin.added.push(event);
      return { remove: async () => void plugin.removed.push(event) };
    },
    connect: async () => {
      plugin.connects += 1;
    },
    disconnect: async () => undefined,
  }),
}));

beforeEach(() => {
  plugin.refusals = 0;
  plugin.added = [];
  plugin.removed = [];
  plugin.connects = 0;
  vi.resetModules();
});

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
