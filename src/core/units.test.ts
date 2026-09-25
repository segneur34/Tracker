import { describe, expect, it } from 'vitest';
import { formatDistance, formatKnots, knotsToDisplay, toDisplayDistance } from './units';

describe('distances', () => {
  it('convertit les mètres en kilomètres et en milles nautiques', () => {
    expect(toDisplayDistance(29_720, 'km')).toBeCloseTo(29.72, 6);
    expect(toDisplayDistance(1852, 'nm')).toBeCloseTo(1, 6);
  });

  it('formate avec le symbole et le nombre de décimales demandé', () => {
    expect(formatDistance(29_720, 'km')).toBe('29.72 km');
    expect(formatDistance(3704, 'nm', 1)).toBe('2.0 NM');
    expect(formatDistance(NaN, 'km')).toBe('-');
  });
});

describe('knotsToDisplay', () => {
  it('rend les nœuds inchangés et convertit vers km/h et m/s', () => {
    expect(knotsToDisplay(10, 'kn')).toBeCloseTo(10, 6);
    expect(knotsToDisplay(10, 'kmh')).toBeCloseTo(18.52, 2);
    expect(knotsToDisplay(10, 'ms')).toBeCloseTo(5.144, 3);
  });
});

describe('formatKnots', () => {
  it('garde le texte reçu en nœuds, pour un affichage inchangé', () => {
    expect(formatKnots('12.4', 'kn')).toBe('12.4');
    expect(formatKnots(12.44, 'kn')).toBe('12.4');
  });

  it('convertit un texte ou un nombre de nœuds dans l\'unité choisie', () => {
    expect(formatKnots('10.0', 'kmh')).toBe('18.5');
    expect(formatKnots(10, 'ms')).toBe('5.14');
  });

  it('rend tel quel ce qui n\'est pas un nombre', () => {
    expect(formatKnots('-', 'kmh')).toBe('-');
  });
});
