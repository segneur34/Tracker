import { describe, expect, it } from 'vitest';
import { angleDiff, circularMean, normalizeDeg, roundBearingDeg, signedDeltaHalfOpen, toDeg, toRad } from './angles';

// Copies gelées des écritures remplacées (lot 57) : mêmes résultats au bit près.
const frozenGpsTurnsDelta = (from: number, to: number): number => {
  const d = (((to - from) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
};
const frozenCompass = (alpha: number, screen: number): number => (((360 - alpha + screen) % 360) + 360) % 360;

let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const angles = [0, 180, -180, 360, -360, 540, 359.5, 359.4999, -0.5, 0.5, 179.99999999, 1e-12, ...Array.from({ length: 400 }, () => (rnd() - 0.5) * 2000)];

describe('angles', () => {
  it('normalise dans [0, 360[', () => {
    expect(normalizeDeg(-10)).toBe(350);
    expect(normalizeDeg(720)).toBe(0);
    for (const a of angles) for (const s of [0, 90, 270]) expect(normalizeDeg(360 - a + s)).toBe(frozenCompass(a, s));
  });

  it('angleDiff rend [−180 ; 180[, signedDeltaHalfOpen ]−180 ; 180] comme gpsTurns', () => {
    expect(angleDiff(10, 350)).toBe(20);
    expect(angleDiff(0, 180)).toBe(-180);
    expect(signedDeltaHalfOpen(0, 180)).toBe(180);
    expect(signedDeltaHalfOpen(180, 0)).toBe(180);
    for (const a of angles) for (const b of angles.slice(0, 40)) expect(signedDeltaHalfOpen(a, b)).toBe(frozenGpsTurnsDelta(a, b));
  });

  it('moyenne vectorielle, pondérée ou non', () => {
    expect(circularMean([350, 10]).mean).toBeCloseTo(0, 9);
    expect(circularMean([]).mean).toBe(0);
    expect(circularMean([0, 90], [1, 0]).mean).toBe(0);
  });

  it('conversions et cap affiché', () => {
    expect(toRad(180)).toBe(Math.PI);
    expect(toDeg(Math.PI)).toBe(180);
    for (const a of angles) expect(toRad(a)).toBe((a * Math.PI) / 180);
    expect(roundBearingDeg(359.6)).toBe(0);
    expect(roundBearingDeg(12.4)).toBe(12);
  });
});
