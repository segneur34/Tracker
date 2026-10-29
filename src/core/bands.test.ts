import { describe, expect, it } from 'vitest';
import { bandRangeLabel } from './bands';

/** Copie gelée de l'expression recopiée dans `HeartRatePanel` et `CadencePanel` avant le lot 64. */
const frozen = (bounds: readonly number[], band: number): string =>
  band === 0 ? `< ${bounds[0]}` : band === bounds.length ? `≥ ${bounds[band - 1]}` : `${bounds[band - 1]}-${bounds[band] - 1}`;

describe('bandRangeLabel', () => {
  it('dit la tranche basse, les tranches du milieu et la tranche haute', () => {
    const zones = [114, 133, 152, 171];
    expect(bandRangeLabel(zones, 0)).toBe('< 114');
    expect(bandRangeLabel(zones, 1)).toBe('114-132');
    expect(bandRangeLabel(zones, 3)).toBe('152-170');
    expect(bandRangeLabel(zones, 4)).toBe('≥ 171');
  });
  it('reprend l\'ancienne expression pour chaque tranche de plusieurs séries de bornes', () => {
    for (const bounds of [[114, 133, 152, 171], [150, 160, 170, 180], [1, 2], [90]]) {
      for (let band = 0; band <= bounds.length; band++) {
        expect(bandRangeLabel(bounds, band)).toBe(frozen(bounds, band));
      }
    }
  });
});
