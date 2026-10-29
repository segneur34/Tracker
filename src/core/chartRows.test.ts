import { describe, expect, it } from 'vitest';
import { toFixedNumber } from './basics';
import { sampledIndices, visibleIndexRange, type XRange } from './chartZoom';
import { CHART_MAX_POINTS } from './displayConfig';
import { trackChartRows, type TrackChartRow } from './chartRows';
import { CHART_PACE_MIN_SPEED_MS, toDisplaySpeed, type DistanceUnit, type SpeedUnit } from './units';

/**
 * Corps de `chartData` de `LandModule` avant le lot 60, recopié tel quel
 * (copie gelée), avec les entrées du module sous leur ancien nom.
 */
const frozenChartData = (
  track: { length: number },
  trackDist: number[],
  zoomView: XRange | null,
  chartSpeed: number[],
  elevation: { smoothed: number[] },
  stats: { hasElevation: boolean } | null,
  grades: number[],
  speedUnit: SpeedUnit,
  distanceUnit: DistanceUnit,
  inverse: boolean,
  heartSmoothed: (number | null | undefined)[],
  cadence: { smoothed: (number | null)[] } | null,
  cadencePresent: boolean,
): TrackChartRow[] => {
  if (track.length === 0) return [];
  const [first, last] = visibleIndexRange(trackDist, zoomView);
  return sampledIndices(first, last, CHART_MAX_POINTS, chartSpeed).map((i): TrackChartRow => {
    const altitude = elevation.smoothed[i];
    const ms = chartSpeed[i];
    const speed = inverse && ms < CHART_PACE_MIN_SPEED_MS ? null : toFixedNumber(toDisplaySpeed(ms, speedUnit, distanceUnit), 2);
    return {
      index: i,
      dist: toFixedNumber(trackDist[i], 3),
      speed,
      speedMs: ms,
      altitude: stats?.hasElevation && isFinite(altitude) ? Math.round(altitude) : null,
      grade: isFinite(grades[i]) ? grades[i] : null,
      hr: heartSmoothed[i] === null || heartSmoothed[i] === undefined ? null : Math.round(heartSmoothed[i]!),
      cadence: cadencePresent && cadence!.smoothed[i] !== null ? Math.round(cadence!.smoothed[i]!) : null,
    };
  });
};

interface Session {
  dist: number[];
  speed: number[];
  altitude: number[];
  grades: number[];
  hr: (number | null | undefined)[];
  cadence: (number | null)[];
}

/**
 * Course synthétique de `seconds` secondes à `hz` points par seconde : arrêts
 * (vitesse sous 0,3 m/s), altitude absente sur un tiers, FC à trous (null et
 * absente), cadence à trous.
 */
const session = (seconds: number, hz: number, constant = false): Session => {
  const n = seconds * hz + 1;
  const s: Session = { dist: [], speed: [], altitude: [], grades: [], hr: [], cadence: [] };
  let d = 0;
  for (let k = 0; k < n; k++) {
    const t = k / hz;
    const v = constant ? 3 : (Math.floor(t / 120) % 5 === 4 ? 0.1 + 0.05 * Math.sin(t) : 3 + Math.sin(t / 17) + 0.37 * Math.sin(t * 1.3));
    if (k > 0) d += v / hz;
    s.speed.push(v);
    s.dist.push(d / 1000);
    s.altitude.push(constant ? 50 : (t > seconds * 0.6 && t < seconds * 0.8 ? NaN : 50 + 12.345 * Math.sin(t / 200)));
    s.grades.push(constant ? 0 : (t < 30 ? NaN : 0.08 * Math.cos(t / 200)));
    s.hr.push(constant ? 140 : (k % 97 === 0 ? null : k % 89 === 0 ? undefined : 130 + 0.5 + t / 60 + 3 * Math.sin(t / 9)));
    s.cadence.push(constant ? 170 : (Math.floor(t / 50) % 7 === 3 ? null : 165.5 + 4 * Math.sin(t / 13)));
  }
  return s;
};

type Options = { view: XRange | null; speedUnit: SpeedUnit; distanceUnit: DistanceUnit; inverse: boolean; hasElevation: boolean | null; withCadence: boolean };

const compare = (s: Session, o: Options) => {
  const stats = o.hasElevation === null ? null : { hasElevation: o.hasElevation };
  const before = frozenChartData(
    { length: s.speed.length }, s.dist, o.view, s.speed, { smoothed: s.altitude }, stats, s.grades,
    o.speedUnit, o.distanceUnit, o.inverse, s.hr, o.withCadence ? { smoothed: s.cadence } : null, o.withCadence,
  );
  const after = trackChartRows({
    pointCount: s.speed.length, dist: s.dist, view: o.view, speedMs: s.speed, altitude: s.altitude,
    hasElevation: Boolean(stats?.hasElevation), grades: s.grades, speedUnit: o.speedUnit, distanceUnit: o.distanceUnit,
    inverse: o.inverse, heartRate: s.hr, cadence: o.withCadence ? s.cadence : null,
  });
  expect(after).toEqual(before);
  expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  return after;
};

const PACE: Options = { view: null, speedUnit: 'minkm', distanceUnit: 'km', inverse: true, hasElevation: true, withCadence: true };
const SPEED: Options = { view: null, speedUnit: 'kmh', distanceUnit: 'km', inverse: false, hasElevation: true, withCadence: true };

describe('trackChartRows, copie gelée de `chartData`', () => {
  for (const hz of [1, 5]) {
    const s = session(1800, hz);
    const end = s.dist[s.dist.length - 1];

    it(`${hz} Hz, toute la trace, plus de ${CHART_MAX_POINTS} points : allure, trous laissés`, () => {
      const rows = compare(s, PACE);
      expect(rows.length).toBeLessThan(s.speed.length);
      expect(rows.some((r) => r.speed === null)).toBe(true);
      expect(rows.some((r) => r.altitude === null)).toBe(true);
    });

    it(`${hz} Hz, zoomé`, () => {
      compare(s, { ...PACE, view: { min: end * 0.2, max: end * 0.45 } });
      compare(s, { ...SPEED, view: { min: end * 0.7, max: end * 0.71 } });
    });

    it(`${hz} Hz, vitesse en km/h et en nœuds, milles`, () => {
      compare(s, SPEED);
      compare(s, { ...SPEED, speedUnit: 'kn', distanceUnit: 'nm' });
    });

    it(`${hz} Hz, sans altitude (session ou fiche) ni cadence`, () => {
      const rows = compare(s, { ...SPEED, hasElevation: false, withCadence: false });
      expect(rows.every((r) => r.altitude === null && r.cadence === null)).toBe(true);
      compare(s, { ...SPEED, hasElevation: null });
    });

    it(`${hz} Hz, valeurs égales`, () => {
      compare(session(900, hz, true), PACE);
      compare(session(900, hz, true), { ...SPEED, view: { min: 0.5, max: 1 } });
    });
  }

  it('trace vide et à un point', () => {
    expect(compare({ dist: [], speed: [], altitude: [], grades: [], hr: [], cadence: [] }, PACE)).toEqual([]);
    const one = compare({ dist: [0], speed: [0], altitude: [NaN], grades: [NaN], hr: [undefined], cadence: [null] }, PACE);
    expect(one).toHaveLength(1);
    compare({ dist: [0], speed: [2.5], altitude: [12.4], grades: [0.01], hr: [141.5], cadence: [170.4] }, SPEED);
  });
});
