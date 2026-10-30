import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ACTIVITIES } from '../core/activities';
import type { GearGroup } from '../library/notes';
import { jsonStore } from '../platform/storage';
import { addGearItem, effectivePumping, readStoredSettings } from './useSportSettings';

describe('matériel enregistré (lot 20) : écrit dans les réglages', () => {
  const wing: GearGroup = { id: 'g-aile', name: 'Aile', items: [{ id: 'i-5', name: 'Duotone 5' }, { id: 'i-6', name: 'Duotone 6' }] };
  const mast: GearGroup = { id: 'g-mat', name: 'Mât', items: [] };
  const memory = new Map<string, string>();
  beforeEach(() => {
    memory.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("ajoute une pièce à la liste de l'activité seule, tout de suite", () => {
    jsonStore.write('tracker.sportSettings', { gearGroups: { wing: [wing, mast], kite: [mast] } });
    const item = addGearItem('wing', 'g-mat', '85 cm');
    expect(item?.name).toBe('85 cm');
    const stored = readStoredSettings();
    expect(stored.gearGroups?.wing?.[1].items).toEqual([item]);
    expect(stored.gearGroups?.kite).toEqual([mast]);
    expect(addGearItem('wing', 'g-inconnu', 'Axis')).toBeNull();
  });

  it('propose le pumping en voile sur foil comme en surf, pas en bateau ni à pied (lot 22)', () => {
    const wing = DEFAULT_ACTIVITIES.find((a) => a.base === 'wingfoil')!;
    const boat = { id: 'a-voilier', name: 'Voilier', base: 'bateau' as const, color: '#014e86' };
    const run = DEFAULT_ACTIVITIES.find((a) => a.base === 'running')!;
    expect(effectivePumping(wing)).toBe(false);
    expect(effectivePumping(boat)).toBeNull();
    expect(effectivePumping(run)).toBeNull();
    jsonStore.write('tracker.sportSettings', { pumping: { [wing.id]: true, [boat.id]: true } });
    expect(effectivePumping(wing)).toBe(true);
    expect(effectivePumping(boat)).toBeNull();
  });

});
