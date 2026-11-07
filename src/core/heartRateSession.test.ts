import { describe, expect, it } from 'vitest';
import { activeDurationS, heartRatePointsFrom } from './heartRateSession';

const T0 = Date.UTC(2026, 9, 28, 18, 0, 0);

describe('heartRatePointsFrom et activeDurationS', () => {
  it('lit les heures, garde la reprise, écarte un point qui ne vient pas après le précédent', () => {
    const p = heartRatePointsFrom([
      { time: new Date(T0).toISOString(), hr: 90 },
      { time: new Date(T0 + 1000).toISOString() },
      { time: new Date(T0 + 1000).toISOString(), hr: 95 },
      { time: new Date(T0 + 60_000).toISOString(), hr: 100, segmentStart: true },
      { time: new Date(T0 + 70_000).toISOString(), hr: 101 },
    ]);
    expect(p).toEqual([
      { timeMs: T0, hr: 90 }, { timeMs: T0 + 1000 }, { timeMs: T0 + 60_000, hr: 100, segmentStart: true }, { timeMs: T0 + 70_000, hr: 101 },
    ]);
    // Le pas qui mène à la reprise (la pause) n'est pas compté.
    expect(activeDurationS(p)).toBe(11);
  });
});
