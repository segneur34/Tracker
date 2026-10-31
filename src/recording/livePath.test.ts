import { describe, expect, it } from 'vitest';
import type { LocationFix } from '../platform/location';
import { segmentCount, splitIntoSegments } from './session';
import { liveTail } from './livePath';

const T0 = Date.UTC(2026, 9, 31, 9, 0, 0);
/** Course vers l'est à 3 m/s, une position par seconde ; `lonAt` pour une position prise ailleurs. */
const fixAt = (s: number, lonAt = 3.85 + (3 * s) / 80_000): LocationFix => ({ timeMs: T0 + s * 1000, lat: 43.7, lon: lonAt });

describe('liveTail (raccord de la carte du direct)', () => {
  // Enregistrement : 0 à 30 s, pause manuelle, reprise à 60 s plus loin (nouveau segment).
  const fixes = [...Array.from({ length: 31 }, (_, s) => fixAt(s)), fixAt(60), fixAt(61)];
  const breaks = [31];
  /** Ce que la carte reçoit après `n` positions gardées, la trace calculée à `computed` positions. */
  const view = (n: number, computed: number) => {
    const kept = fixes.slice(0, n);
    const segments = splitIntoSegments(fixes.slice(0, computed), breaks);
    return { segments, position: kept[n - 1] ?? null, positionSegment: segmentCount(n, breaks) - 1 };
  };

  it('prolonge le dernier segment jusqu\'à la position entre deux calculs', () => {
    const { segments, position, positionSegment } = view(30, 28);
    expect(liveTail(segments, position, positionSegment)).toEqual([fixes[27], fixes[29]]);
  });

  it('ne joint jamais le point de la pause à la première position reprise', () => {
    // Reprise : la position est dans le segment 1, la trace calculée s'arrête encore au point de la pause.
    const resumed = view(32, 31);
    expect(resumed.positionSegment).toBe(1);
    expect(liveTail(resumed.segments, resumed.position, resumed.positionSegment)).toBeNull();
    // Seconde position reprise, toujours avant le calcul suivant.
    const second = view(33, 31);
    expect(liveTail(second.segments, second.position, second.positionSegment)).toBeNull();
  });

  it('raccorde de nouveau une fois le nouveau segment calculé', () => {
    const { segments, position, positionSegment } = view(33, 32);
    expect(segments).toHaveLength(2);
    expect(liveTail(segments, position, positionSegment)).toEqual([fixes[31], fixes[32]]);
  });

  it('aucun raccord pour une position non gardée, ni sans trace', () => {
    const { segments } = view(31, 31);
    expect(liveTail(segments, fixAt(45), null)).toBeNull();
    expect(liveTail([], fixAt(1), 0)).toBeNull();
    expect(liveTail(segments, null, 0)).toBeNull();
  });
});
