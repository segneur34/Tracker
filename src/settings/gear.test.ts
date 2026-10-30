import { describe, expect, it } from 'vitest';
import type { GearGroup } from '../library/notes';
import { resetOverrides, type StoredSettings } from './activitySettings';
import { MAX_GEAR_LABEL_LENGTH, resolveGearGroups, sanitizeGearGroups, sanitizeGearLabels, withGearItem } from './gear';

describe('sanitizeGearLabels', () => {
  it('rogne les intitulés et garde un texte vide pour celui par défaut', () => {
    expect(sanitizeGearLabels(['  Chaussures ', ''])).toEqual(['Chaussures', '']);
  });

  it('tronque un intitulé trop long', () => {
    expect(sanitizeGearLabels(['x'.repeat(50), 'Sac'])?.[0]).toHaveLength(MAX_GEAR_LABEL_LENGTH);
  });

  it('rend null pour deux intitulés vides ou une valeur mal formée', () => {
    expect(sanitizeGearLabels([' ', ''])).toBeNull();
    expect(sanitizeGearLabels(['Vélo'])).toBeNull();
    expect(sanitizeGearLabels(['Vélo', 3])).toBeNull();
    expect(sanitizeGearLabels('Vélo')).toBeNull();
  });
});

describe('matériel enregistré (lot 20)', () => {
  const wing: GearGroup = { id: 'g-aile', name: 'Aile', items: [{ id: 'i-5', name: 'Duotone 5' }, { id: 'i-6', name: 'Duotone 6' }] };
  const mast: GearGroup = { id: 'g-mat', name: 'Mât', items: [] };

  it('rogne les noms et garde les identifiants', () => {
    expect(sanitizeGearGroups([{ id: 'g-aile', name: '  Aile ', items: [{ id: 'i-5', name: ' Duotone 5 ' }, { id: 'i-6', name: 'Duotone 6' }] }]))
      .toEqual([wing]);
    expect(sanitizeGearGroups([{ id: 'g', name: 'x'.repeat(50), items: [] }])?.[0].name).toHaveLength(MAX_GEAR_LABEL_LENGTH);
  });

  it('écarte les groupes et les pièces sans identifiant ou sans nom, et les identifiants en double', () => {
    expect(sanitizeGearGroups([
      wing,
      { id: '', name: 'Sans id', items: [] },
      { id: 'g-vide', name: '  ', items: [] },
      { name: 'Foil', items: [] },
      'Planche',
      null,
      { id: 'g-aile', name: 'Doublon', items: [] },
      { id: 'g-mat', name: 'Mât', items: [{ id: 'i-85' }, { name: '90 cm' }, { id: 'i-5', name: 'Doublon' }, { id: 'i-75', name: 75 }, 'x'] },
      { id: 'g-sans', name: 'Sans pièces', items: 'non' },
    ])).toEqual([wing, mast, { id: 'g-sans', name: 'Sans pièces', items: [] }]);
  });

  it('garde une liste vide (option cochée) et rend null hors liste (option coupée)', () => {
    expect(sanitizeGearGroups([])).toEqual([]);
    expect(sanitizeGearGroups(undefined)).toBeNull();
    expect(sanitizeGearGroups({ id: 'g' })).toBeNull();
  });

  it('ajoute une pièce à un groupe, sans doubler un nom déjà là', () => {
    const added = withGearItem([wing, mast], 'g-mat', ' 85 cm ', 'i-85');
    expect(added?.item).toEqual({ id: 'i-85', name: '85 cm' });
    expect(added?.groups).toEqual([wing, { ...mast, items: [{ id: 'i-85', name: '85 cm' }] }]);
    expect(withGearItem([wing], 'g-aile', 'duotone 5 ', 'neuf')?.item).toEqual({ id: 'i-5', name: 'Duotone 5' });
    expect(withGearItem([wing], 'g-aile', '  ')).toBeNull();
    expect(withGearItem([wing], 'g-inconnu', 'Axis')).toBeNull();
  });

  it('« Par défaut » garde le matériel enregistré, et efface le reste', () => {
    const stored: StoredSettings = { gearGroups: { wing: [wing], kite: [mast] }, gearLabels: { wing: ['A', 'B'] }, thresholds: { wing: 9 } };
    const next = resetOverrides(stored, 'wing');
    expect(next.gearGroups).toEqual({ wing: [wing], kite: [mast] });
    expect(next.gearLabels).toEqual({});
    expect(next.thresholds).toEqual({});
  });


  it("ne voit l'option active dans l'analyse qu'avec au moins un groupe", () => {
    expect(resolveGearGroups({}, 'wing')).toBeNull();
    expect(resolveGearGroups({ gearGroups: { wing: [] } }, 'wing')).toBeNull();
    expect(resolveGearGroups({ gearGroups: { wing: [mast] } }, 'wing')).toEqual([mast]);
    expect(resolveGearGroups({ gearGroups: { kite: [mast] } }, 'wing')).toBeNull();
  });
});
