import { describe, expect, it } from 'vitest';
import { windowMean } from './windowMean';

describe('windowMean', () => {
  // Une mesure par seconde, valeur = son heure ; chacune vaut depuis la précédente.
  const window = Array.from({ length: 11 }, (_, i) => ({ activeMs: i * 1000, speedMs: i }));
  it('moyenne des dernières secondes, ou d’une fenêtre finie plus tôt', () => {
    expect(windowMean(window, 'speedMs', 5, 10_000)).toBeCloseTo(8, 9);
    expect(windowMean(window, 'speedMs', 5, 10_000, 5_000)).toBeCloseTo(3, 9);
    // Fenêtre (2,5 ; 4,5] : une demi-seconde de 3, une seconde de 4, une demi-seconde de 5.
    expect(windowMean(window, 'speedMs', 2, 10_000, 4_500)).toBeCloseTo(4, 9);
    // Pas assez couverte.
    expect(windowMean(window, 'speedMs', 30, 10_000, 5_000)).toBeNull();
  });

  it('à 5 Hz comme à 1 Hz : la même moyenne, fenêtre en secondes (règle 2)', () => {
    // Le même signal en escalier (valeur = seconde entière), échantillonné cinq fois plus souvent.
    const dense = Array.from({ length: 51 }, (_, i) => ({ activeMs: i * 200, speedMs: Math.ceil(i / 5 - 1e-9) }));
    expect(windowMean(dense, 'speedMs', 5, 10_000)).toBeCloseTo(windowMean(window, 'speedMs', 5, 10_000)!, 6);
    // Une mesure sans le champ ne pèse rien ; une fenêtre couverte à moitié seulement rend encore une valeur.
    const sparse = [{ activeMs: 0 }, { activeMs: 2_000, hrBpm: 100 }, { activeMs: 4_000 }, { activeMs: 5_000, hrBpm: 140 }];
    expect(windowMean(sparse, 'hrBpm', 5, 5_000)).toBeCloseTo((100 * 2000 + 140 * 1000) / 3000, 9);
  });
});
