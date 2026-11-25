import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readRecoveryServices } from './recovery';

/**
 * Preuve des services vivants à la réouverture (lot 232, étape 2) : le service de position le dit par son greffon,
 * pour une session ; celui de la ceinture sans position, par `Recovery.state()`.
 */
const phone = vi.hoisted(() => ({
  native: true,
  location: { running: false, session: null as number | null, paused: false },
  locationFails: false,
  belt: false,
  beltFails: false,
}));
vi.mock('./runtime', () => ({ isNativeApp: () => phone.native }));
vi.mock('./location', () => ({
  deviceLocationState: async () => {
    if (phone.locationFails) throw new Error('greffon absent');
    return phone.location;
  },
}));
vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({
    state: async () => {
      if (phone.beltFails) throw new Error('greffon absent');
      return { belt: phone.belt };
    },
  }),
}));

const SESSION = Date.UTC(2026, 10, 25, 9, 0, 0);

beforeEach(() => {
  Object.assign(phone, { native: true, location: { running: false, session: null, paused: false }, locationFails: false, belt: false, beltFails: false });
});

describe('readRecoveryServices', () => {
  it('service de position : vu seulement pour la session du journal', async () => {
    phone.location = { running: true, session: SESSION, paused: false };
    expect(await readRecoveryServices(SESSION)).toEqual({ gps: true, belt: false });
    // Celui d'une autre session ne prouve rien.
    expect(await readRecoveryServices(SESSION + 1)).toEqual({ gps: false, belt: false });
    // Sans journal : tout service en route compte, pour être arrêté.
    expect(await readRecoveryServices(null)).toEqual({ gps: true, belt: false });
  });

  it('arrêté : rien, quelle que soit la session', async () => {
    expect(await readRecoveryServices(SESSION)).toEqual({ gps: false, belt: false });
    expect(await readRecoveryServices(null)).toEqual({ gps: false, belt: false });
  });

  it('ceinture sans position : lue à part, comme avant', async () => {
    phone.belt = true;
    expect(await readRecoveryServices(SESSION)).toEqual({ gps: false, belt: true });
  });

  it('une lecture en échec compte pour aucun, sans gêner l\'autre', async () => {
    phone.location = { running: true, session: SESSION, paused: false };
    phone.belt = true;
    phone.locationFails = true;
    expect(await readRecoveryServices(SESSION)).toEqual({ gps: false, belt: true });
    phone.locationFails = false;
    phone.beltFails = true;
    expect(await readRecoveryServices(SESSION)).toEqual({ gps: true, belt: false });
  });

  it('navigateur : aucun service', async () => {
    phone.native = false;
    phone.location = { running: true, session: SESSION, paused: false };
    phone.belt = true;
    expect(await readRecoveryServices(SESSION)).toEqual({ gps: false, belt: false });
  });
});
