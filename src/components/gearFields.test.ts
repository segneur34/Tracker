import { describe, expect, it } from 'vitest';
import { gearFieldsFor, type GearField } from './gearFields';

/** Copies gelées des trois fonctions locales que `gearFieldsFor` remplace (lot 64). */
const frozenLand = (labels: [string, string]): GearField[] => [
  { field: 'gear1', label: labels[0], placeholder: 'ex. modèle, taille' },
  { field: 'gear2', label: labels[1], placeholder: 'ex. modèle, taille' },
];
const frozenMuscu = (labels: [string, string]): GearField[] => [
  { field: 'gear1', label: labels[0], placeholder: 'ex. charges, machine' },
  { field: 'gear2', label: labels[1], placeholder: 'ex. modèle, taille' },
];

describe('gearFieldsFor', () => {
  const labels: [string, string] = ['Chaussures', 'Sac'];
  it('reprend la fonction de la course, du surf et du vélo', () => {
    expect(gearFieldsFor(labels)).toEqual(frozenLand(labels));
  });
  it('reprend celle de la muscu avec ses exemples', () => {
    expect(gearFieldsFor(labels, ['ex. charges, machine', 'ex. modèle, taille'])).toEqual(frozenMuscu(labels));
  });
});
