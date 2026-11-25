import { describe, expect, it } from 'vitest';
import {
  batteryRestricted, isXiaomiDevice, missingPermissions, requiredPermissions, shouldPromptPermissions, showsAutostart, type PermissionsStatus,
} from './permissionsPrompt';

const ALL_GRANTED: PermissionsStatus = { location: 'granted', notifications: 'granted', battery: 'granted', bluetooth: 'granted' };
const FRESH: PermissionsStatus = { location: 'prompt', notifications: 'prompt', battery: 'denied', bluetooth: 'prompt' };
const BROWSER: PermissionsStatus = { location: 'unavailable', notifications: 'unavailable', battery: 'unavailable', bluetooth: 'unavailable' };

describe('autorisations requises', () => {
  it('demande le Bluetooth seulement si une ceinture est retenue', () => {
    expect(requiredPermissions(false)).toEqual(['location', 'notifications', 'battery']);
    expect(requiredPermissions(true)).toEqual(['location', 'notifications', 'battery', 'bluetooth']);
  });

  it('ne compte ni les accordées ni celles sans objet', () => {
    expect(missingPermissions(FRESH, false)).toEqual(['location', 'notifications', 'battery']);
    expect(missingPermissions({ ...ALL_GRANTED, bluetooth: 'denied' }, false)).toEqual([]);
    expect(missingPermissions({ ...ALL_GRANTED, bluetooth: 'denied' }, true)).toEqual(['bluetooth']);
    expect(missingPermissions(BROWSER, true)).toEqual([]);
  });
});

describe('carte montrée d\'office', () => {
  const base = { appVersion: '0.3.2', beltSaved: false };

  it('au premier lancement, s\'il manque une autorisation', () => {
    expect(shouldPromptPermissions({ ...base, seenVersion: null, status: FRESH })).toBe(true);
    expect(shouldPromptPermissions({ ...base, seenVersion: null, status: ALL_GRANTED })).toBe(false);
  });

  it('pas deux fois pour la même version, même s\'il manque encore quelque chose (« Plus tard »)', () => {
    expect(shouldPromptPermissions({ ...base, seenVersion: '0.3.2', status: FRESH })).toBe(false);
  });

  it('après une mise à jour, seulement s\'il manque une autorisation', () => {
    expect(shouldPromptPermissions({ ...base, seenVersion: '0.3.1', status: ALL_GRANTED })).toBe(false);
    expect(shouldPromptPermissions({ ...base, seenVersion: '0.3.1', status: { ...ALL_GRANTED, battery: 'denied' } })).toBe(true);
  });

  it('le Bluetooth refusé ne compte qu\'avec une ceinture retenue', () => {
    const status: PermissionsStatus = { ...ALL_GRANTED, bluetooth: 'denied' };
    expect(shouldPromptPermissions({ ...base, seenVersion: '0.3.1', status })).toBe(false);
    expect(shouldPromptPermissions({ ...base, seenVersion: '0.3.1', status, beltSaved: true })).toBe(true);
  });

  it('jamais dans le navigateur', () => {
    expect(shouldPromptPermissions({ ...base, seenVersion: null, status: BROWSER, beltSaved: true })).toBe(false);
  });
});

describe('démarrage automatique de Xiaomi (lot 232)', () => {
  it('reconnaît Xiaomi, Redmi et POCO, au fabricant ou à la marque, casse ignorée', () => {
    expect(isXiaomiDevice({ manufacturer: 'Xiaomi', brand: 'Redmi' })).toBe(true);
    expect(isXiaomiDevice({ manufacturer: 'XIAOMI', brand: '' })).toBe(true);
    expect(isXiaomiDevice({ manufacturer: '', brand: 'POCO' })).toBe(true);
    expect(isXiaomiDevice({ manufacturer: 'unknown', brand: 'redmi ' })).toBe(true);
    expect(isXiaomiDevice({ manufacturer: 'samsung', brand: 'samsung' })).toBe(false);
    expect(isXiaomiDevice({ manufacturer: 'Google', brand: 'google' })).toBe(false);
  });

  it('la ligne ne se montre que sur un Xiaomi, jamais sans lecture de la marque (navigateur compris)', () => {
    expect(showsAutostart(null)).toBe(false);
    expect(showsAutostart({ manufacturer: 'samsung', brand: 'samsung' })).toBe(false);
    expect(showsAutostart({ manufacturer: 'Xiaomi', brand: 'Redmi' })).toBe(true);
  });
});

describe('batterie restreinte (lot 232)', () => {
  it('seulement si elle est lue refusée', () => {
    expect(batteryRestricted(null)).toBe(false);
    expect(batteryRestricted(FRESH)).toBe(true);
    expect(batteryRestricted(ALL_GRANTED)).toBe(false);
    expect(batteryRestricted({ ...ALL_GRANTED, battery: 'prompt' })).toBe(false);
    expect(batteryRestricted(BROWSER)).toBe(false);
  });
});
