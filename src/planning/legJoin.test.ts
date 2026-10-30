import { describe, expect, it } from 'vitest';
import { isComputedLeg, joinLegs } from './legJoin';
import type { RouteMode } from './route';

const P = (lat: number, lon: number) => ({ lat, lon });
const leg = (mode: RouteMode, ...points: { lat: number; lon: number }[]) => ({ mode, points });

describe('tronçons mis bout à bout', () => {
  const a = leg('route', P(0, 0), P(0, 1));
  const b = leg('straight', P(0, 1), P(0, 2));
  const c = leg('piste', P(0, 2), P(0, 3));

  it('sans filtre : un seul trait, jonctions comptées une fois', () => {
    expect(joinLegs([a, b, c])).toEqual([[P(0, 0), P(0, 1), P(0, 2), P(0, 3)]]);
  });

  it('un tronçon écarté coupe la suite en deux traits', () => {
    expect(joinLegs([a, b, c], isComputedLeg)).toEqual([[P(0, 0), P(0, 1)], [P(0, 2), P(0, 3)]]);
  });

  it('sans tronçon : aucun trait', () => {
    expect(joinLegs([])).toEqual([]);
  });

  it('deux tronçons qui ne se touchent pas gardent tous leurs points', () => {
    expect(joinLegs([a, c])).toEqual([[P(0, 0), P(0, 1), P(0, 2), P(0, 3)]]);
  });
});

describe('tronçon calculé', () => {
  it('ni ligne droite ni trace importée', () => {
    expect(isComputedLeg({ mode: 'sentier' })).toBe(true);
    expect(isComputedLeg({ mode: 'route+grandeRoute' })).toBe(true);
    expect(isComputedLeg({ mode: 'straight' })).toBe(false);
    expect(isComputedLeg({ mode: 'imported' })).toBe(false);
  });
});
