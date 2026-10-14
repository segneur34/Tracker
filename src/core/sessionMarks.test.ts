import { describe, expect, it } from 'vitest';
import { locateMarks, marksWithin, readSessionMarks, type SessionMark } from './sessionMarks';

const T0 = Date.UTC(2026, 9, 14, 8, 0, 0);

/** Trace droite à vitesse constante, échantillonnée à `hz` : distance cumulée exacte. */
const straight = (hz: number, durationS: number, speedMs: number) => {
  const track: { timeMs: number }[] = [];
  const cumDist: number[] = [];
  for (let k = 0; k <= durationS * hz; k++) {
    track.push({ timeMs: T0 + (k * 1000) / hz });
    cumDist.push((k / hz) * speedMs);
  }
  return { track, cumDist };
};

const mark = (offsetMs: number, label: string | null = null): SessionMark => ({ timeMs: T0 + offsetMs, lat: 43.5, lon: 3.9, label });

describe('locateMarks', () => {
  it('numérote dans l\'ordre du temps et donne la distance au repère', () => {
    const { track, cumDist } = straight(1, 100, 5);
    const located = locateMarks(track, cumDist, [mark(60_000), mark(10_500)]);
    expect(located.map((m) => m.n)).toEqual([1, 2]);
    expect(located[0].mark.timeMs).toBe(T0 + 10_500);
    expect(located[0].distanceM).toBeCloseTo(52.5, 6);
    expect(located[0].index).toBe(11);
    expect(located[1].distanceM).toBeCloseTo(300, 6);
    expect(located[1].index).toBe(60);
  });

  it('donne la même distance à 1 Hz et à 5 Hz', () => {
    const marks = [mark(12_300), mark(47_900)];
    const a = straight(1, 60, 4);
    const b = straight(5, 60, 4);
    const da = locateMarks(a.track, a.cumDist, marks).map((m) => m.distanceM);
    const db = locateMarks(b.track, b.cumDist, marks).map((m) => m.distanceM);
    da.forEach((d, i) => expect(db[i]).toBeCloseTo(d, 6));
  });

  it('rattache un repère hors de la trace à son bout, et ne rend rien sans trace', () => {
    const { track, cumDist } = straight(1, 10, 2);
    const located = locateMarks(track, cumDist, [mark(-5_000), mark(60_000)]);
    expect(located.map((m) => [m.index, m.distanceM])).toEqual([[0, 0], [10, 20]]);
    expect(locateMarks([], [], [mark(0)])).toEqual([]);
  });

  it('tient un intervalle qui couvre plusieurs secondes (cadence variable)', () => {
    const track = [{ timeMs: T0 }, { timeMs: T0 + 30_000 }];
    const located = locateMarks(track, [0, 300], [mark(10_000)]);
    expect(located[0].index).toBe(0);
    expect(located[0].distanceM).toBeCloseTo(100, 6);
  });
});

describe('repères relus et bornés', () => {
  it('bornent à la fenêtre de la session', () => {
    expect(marksWithin([mark(5_000), mark(-1), mark(1_000)], T0, T0 + 2_000).map((m) => m.timeMs)).toEqual([T0 + 1_000]);
  });

  it('rendent null sans repère lisible', () => {
    expect(readSessionMarks([{ lat: 1 }])).toBeNull();
    expect(readSessionMarks(null)).toBeNull();
  });
});
