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
  stopScans: 0,
  /** Réponse de `connection` (connexion restée ouverte côté téléphone après une chute de la page). */
  connection: { wanted: false, state: 'off', address: undefined as string | undefined },
  /** Écouteurs posés, par événement, pour jouer les événements du greffon. */
  listeners: {} as Record<string, (data: unknown) => void>,
}));

vi.mock('./runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./runtime')>()),
  isNativeApp: () => true,
}));

/** Stockage en mémoire, sans le `localStorage` de Node ; remis à vide par les tests qui le lisent. */
vi.mock('./storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./storage')>();
  const data = new Map<string, string>();
  return { ...actual, jsonStore: actual.createJsonStore(() => ({ getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) })) };
});

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
    stopScan: async () => {
      plugin.stopScans += 1;
    },
    connection: async () => plugin.connection,
  }),
}));

beforeEach(() => {
  plugin.refusals = 0;
  plugin.added = [];
  plugin.removed = [];
  plugin.connects = 0;
  plugin.disconnects = 0;
  plugin.stopScans = 0;
  plugin.connection = { wanted: false, state: 'off', address: undefined };
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

const other = { address: '11:22:33:44:55:66', name: 'Montre' };

/** Un seul appareil tenu à la fois (lot 198) : en demander un autre pendant qu'il l'est ne le lâche pas sans le dire. */
describe('un seul appareil à la fois', () => {
  it("une autre adresse est refusée tant que la première est tenue : rien n'est coupé ni reconnecté", async () => {
    const { holdBelt, beltHeldBy, heldBeltAddress, OTHER_BELT_HELD } = await import('./heartRate');
    const release = await holdBelt('enregistrement', belt);
    await expect(holdBelt('reglages', other)).rejects.toThrow(OTHER_BELT_HELD);
    expect(beltHeldBy('reglages')).toBe(false);
    expect(beltHeldBy('enregistrement')).toBe(true);
    expect(heldBeltAddress()).toBe(belt.address);
    expect(plugin.connects).toBe(1);
    expect(plugin.disconnects).toBe(0);
    release();
  });

  it('la même adresse, déjà tenue, est prise sans reconnexion', async () => {
    const { holdBelt } = await import('./heartRate');
    const first = await holdBelt('enregistrement', belt);
    emit('status', { state: 'connected', address: belt.address });
    const second = await holdBelt('reglages', { ...belt });
    expect(plugin.connects).toBe(1);
    first();
    second();
  });

  it('une fois rendue, une autre adresse est acceptée', async () => {
    const { holdBelt, heldBeltAddress } = await import('./heartRate');
    const first = await holdBelt('reglages', belt);
    first();
    expect(heldBeltAddress()).toBeNull();
    const second = await holdBelt('reglages', other);
    expect(heldBeltAddress()).toBe(other.address);
    expect(plugin.connects).toBe(2);
    second();
  });

  it('une connexion reprise après une chute de la page garde son adresse : une autre est refusée', async () => {
    const { adoptBelt, holdBelt } = await import('./heartRate');
    plugin.connection = { wanted: true, state: 'connected', address: belt.address };
    const release = await adoptBelt('enregistrement');
    expect(release).not.toBeNull();
    await expect(holdBelt('reglages', other)).rejects.toThrow();
    release?.();
  });
});

describe('recherche annulée', () => {
  it("stopBeltScan demande au greffon d'arrêter la recherche", async () => {
    const { stopBeltScan } = await import('./heartRate');
    await stopBeltScan();
    expect(plugin.stopScans).toBe(1);
  });
});

/** Appareils retenus (lot 198) : nouvelle clé de liste, l'ancienne garde l'actif ; rien n'est perdu à la mise à jour. */
describe('appareils retenus', () => {
  /** Stockage remis à vide : rien ne reste d'un test à l'autre. */
  beforeEach(async () => {
    const { jsonStore } = await import('./storage');
    jsonStore.write('tracker.heartRateBelt', null);
    jsonStore.write('tracker.heartRateBelts', null);
  });

  it("ancienne clé seule : la ceinture retenue est la liste et reste l'actif", async () => {
    const { jsonStore } = await import('./storage');
    const { savedBelt, savedBelts } = await import('./heartRate');
    jsonStore.write('tracker.heartRateBelt', belt);
    expect(savedBelts()).toEqual([belt]);
    expect(savedBelt()).toEqual(belt);
  });

  it("ajouter sans activer garde l'actif ; le choisir le change ; oublier l'actif passe au suivant", async () => {
    const { jsonStore } = await import('./storage');
    const { addSavedBelt, chooseSavedBelt, forgetSavedBelt, savedBelt, savedBelts } = await import('./heartRate');
    jsonStore.write('tracker.heartRateBelt', belt);
    addSavedBelt(other, false);
    expect(savedBelts()).toEqual([belt, other]);
    expect(savedBelt()).toEqual(belt);
    chooseSavedBelt(other);
    expect(savedBelt()).toEqual(other);
    forgetSavedBelt(other.address);
    expect(savedBelts()).toEqual([belt]);
    expect(savedBelt()).toEqual(belt);
    forgetSavedBelt(belt.address);
    expect(savedBelts()).toEqual([]);
    expect(savedBelt()).toBeNull();
  });

  it('le premier appareil ajouté devient actif même sans le demander', async () => {
    const { addSavedBelt, savedBelt } = await import('./heartRate');
    addSavedBelt(other, false);
    expect(savedBelt()).toEqual(other);
  });

  it("le type d'adresse appris par le greffon va sur l'entrée de la liste et sur l'actif", async () => {
    const { jsonStore } = await import('./storage');
    const { addSavedBelt, holdBelt, savedBelt, savedBelts } = await import('./heartRate');
    jsonStore.write('tracker.heartRateBelt', belt);
    addSavedBelt(other, false);
    const release = await holdBelt('reglages', belt);
    emit('status', { state: 'connected', address: belt.address, random: true });
    expect(savedBelt()).toEqual({ ...belt, random: true });
    expect(savedBelts()).toEqual([{ ...belt, random: true }, other]);
    release();
  });
});
