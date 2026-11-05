import { describe, expect, it } from 'vitest';
import { eastwardTrack } from '../test/track.fixture';
import { kilometerSplits } from './kilometerSplits';

/** `durationS` secondes à `speedMs`, `hz` points par seconde. */
const steady = (speedMs: number, durationS: number, hz: number, options: { altitudeAt?: (m: number) => number } = {}) =>
  eastwardTrack(new Array(Math.round(durationS * hz) + 1).fill(speedMs), 1 / hz, options);

describe('kilometerSplits', () => {
  it('ligne droite à 4 m/s pendant 2 600 m : deux kilomètres de 250 s, puis 600 m partiels', () => {
    const splits = kilometerSplits(steady(4, 650, 1), { splitM: 1000 });
    expect(splits).toHaveLength(3);
    for (const s of splits.slice(0, 2)) {
      expect(s.distanceM).toBeCloseTo(1000, 6);
      expect(s.durationS).toBeCloseTo(250, 6);
      expect(s.speedMs).toBeCloseTo(4, 6);
      expect(s.partial).toBe(false);
    }
    expect(splits[2].partial).toBe(true);
    expect(splits[2].distanceM).toBeCloseTo(600, 6);
    expect(splits[2].durationS).toBeCloseTo(150, 6);
    expect(splits.map((s) => s.rank)).toEqual([1, 2, 3]);
  });

  it('1 Hz et 5 Hz donnent les mêmes tranches, borne au milieu d’un pas comprise', () => {
    // 3,7 m/s : les bornes tombent entre deux points.
    const a = kilometerSplits(steady(3.7, 700, 1), { splitM: 1000 });
    const b = kilometerSplits(steady(3.7, 700, 5), { splitM: 1000 });
    expect(b).toHaveLength(a.length);
    a.forEach((s, k) => {
      expect(b[k].distanceM).toBeCloseTo(s.distanceM, 6);
      expect(b[k].durationS).toBeCloseTo(s.durationS, 6);
      expect(b[k].partial).toBe(s.partial);
    });
    expect(a[0].durationS).toBeCloseTo(1000 / 3.7, 6);
  });

  it('sans altitude ni FC ni masque : dénivelé, FC et temps en mouvement à null', () => {
    const [s] = kilometerSplits(steady(5, 300, 1), { splitM: 1000 });
    expect(s.gainM).toBeNull();
    expect(s.lossM).toBeNull();
    expect(s.heartRateBpm).toBeNull();
    expect(s.movingS).toBeNull();
  });

  it('montée régulière : D+ de chaque kilomètre, sans D-', () => {
    // 2 % : 20 m par kilomètre.
    const track = steady(4, 500, 1, { altitudeAt: (m) => 100 + 0.02 * m });
    const elevation = track.map((p) => p.ele ?? NaN);
    const splits = kilometerSplits(track, { splitM: 1000, elevation, minGainM: 3 });
    expect(splits).toHaveLength(2);
    for (const s of splits) {
      expect(s.gainM).toBeCloseTo(20, 6);
      expect(s.lossM).toBe(0);
    }
  });

  it('FC pondérée par le temps, et temps en mouvement selon le masque', () => {
    const track = steady(4, 250, 1).map((p, i) => ({ ...p, hr: i <= 125 ? 140 : 160 }));
    const active = track.map((_, i) => i <= 200);
    const [s] = kilometerSplits(track, { splitM: 1000, active });
    expect(s.heartRateBpm).toBeCloseTo(150, 6);
    expect(s.movingS).toBeCloseTo(200, 6);
    expect(s.durationS).toBeCloseTo(250, 6);
  });

  it('une pause reste dans la tranche où elle tombe (temps total)', () => {
    const track = steady(4, 300, 1);
    // 60 s d'arrêt au 100e point : la suite décalée d'une minute, la pause reprend sans distance.
    const shifted = track.map((p, i) => (i < 100 ? p : { ...p, timeMs: p.timeMs + 60000, ...(i === 100 ? { segmentStart: true as const } : {}) }));
    const [first] = kilometerSplits(shifted, { splitM: 1000 });
    // Le pas de reprise ne compte pas de distance : 4 m en moins, rattrapés une seconde plus tard.
    expect(first.durationS).toBeCloseTo(250 + 60 + 1, 6);
  });

  it('tranches d’un mille (1 852 m) ; reste trop court oublié', () => {
    const splits = kilometerSplits(steady(4, 463 + 1, 1), { splitM: 1852 });
    expect(splits).toHaveLength(1);
    expect(splits[0].distanceM).toBeCloseTo(1852, 6);
    expect(kilometerSplits(steady(4, 1, 1), { splitM: 1000 })).toEqual([]);
  });
});
