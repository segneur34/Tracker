import { describe, expect, it } from 'vitest';
import { minutesFullRange, trackMinutes } from './useTimeChartAxis';

/** Trace de `seconds` secondes à `hz` points par seconde, depuis `t0`. */
const trace = (t0: number, seconds: number, hz: number) => Array.from({ length: seconds * hz + 1 }, (_, k) => ({ timeMs: t0 + (k * 1000) / hz }));

describe('trackMinutes', () => {
  it('minutes depuis le premier point, à 1 Hz et à 5 Hz', () => {
    const t0 = Date.UTC(2026, 9, 1, 8, 0, 0);
    const one = trackMinutes(trace(t0, 120, 1));
    const five = trackMinutes(trace(t0, 120, 5));
    expect(one[0]).toBe(0);
    expect(one[60]).toBe(1);
    expect(one[one.length - 1]).toBe(2);
    expect(five[five.length - 1]).toBe(2);
    expect(five[300]).toBe(1);
  });

  it('trace vide : rien', () => {
    expect(trackMinutes([])).toEqual([]);
  });
});

describe('minutesFullRange', () => {
  it('de 0 à la dernière minute, la même à 1 Hz et à 5 Hz', () => {
    expect(minutesFullRange(trackMinutes(trace(0, 180, 1)))).toEqual({ min: 0, max: 3 });
    expect(minutesFullRange(trackMinutes(trace(0, 180, 5)))).toEqual({ min: 0, max: 3 });
  });

  it('aucune étendue sous deux points', () => {
    expect(minutesFullRange([])).toBeNull();
    expect(minutesFullRange([0])).toBeNull();
  });
});
