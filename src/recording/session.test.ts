import { describe, expect, it } from 'vitest';
import type { LocationFix } from '../platform/location';
import {
  EMPTY_RECORDING_STATS,
  addFixToStats,
  fixesFromRawPoints,
  isNewerFix,
  isSportType,
  roundFix,
  sessionFileName,
  sessionTitle,
  shouldFlushJournal,
} from './session';

const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
const fixAt = (s: number, extra: Partial<LocationFix> = {}): LocationFix => ({
  timeMs: T0 + s * 1000,
  lat: 43.5,
  lon: 3.9,
  ...extra,
});

describe('isNewerFix', () => {
  it('accepte la première position', () => {
    expect(isNewerFix(null, fixAt(0))).toBe(true);
  });

  it('écarte une position redélivrée ou plus ancienne, garde la suivante', () => {
    expect(isNewerFix(T0, fixAt(0))).toBe(false);
    expect(isNewerFix(T0, fixAt(-1))).toBe(false);
    expect(isNewerFix(T0, fixAt(1))).toBe(true);
  });
});

describe('roundFix', () => {
  it('arrondit à la résolution utile sans inventer de valeur', () => {
    const rounded = roundFix({
      timeMs: T0 + 0.4,
      lat: 43.123456789,
      lon: -3.987654321,
      accuracyM: 4.26,
      speedMs: 5.4321,
      bearingDeg: 271.26,
    });
    expect(rounded).toEqual({
      timeMs: T0,
      lat: 43.1234568,
      lon: -3.9876543,
      accuracyM: 4.3,
      altitudeM: undefined,
      speedMs: 5.43,
      bearingDeg: 271.3,
    });
  });
});

describe('fixesFromRawPoints', () => {
  it('reprend heure, position, altitude et vitesse, et écarte un point sans heure lisible', () => {
    const fixes = fixesFromRawPoints([
      { lat: 43.5, lon: 3.9, time: '2026-09-23T12:00:00Z', ele: 12, speedMs: 4.2 },
      { lat: 43.6, lon: 3.8, time: 'pas une date' },
      { lat: 43.7, lon: 3.7, time: new Date(T0 + 1000) },
    ]);
    expect(fixes).toEqual([
      { timeMs: T0, lat: 43.5, lon: 3.9, altitudeM: 12, speedMs: 4.2 },
      { timeMs: T0 + 1000, lat: 43.7, lon: 3.7, altitudeM: undefined, speedMs: undefined },
    ]);
  });
});

describe('addFixToStats', () => {
  it('compte les points, la durée, le plus long trou et la dernière précision', () => {
    const stats = [fixAt(0, { accuracyM: 8 }), fixAt(1), fixAt(2, { accuracyM: 3 }), fixAt(47, { accuracyM: 5 }), fixAt(48)]
      .reduce(addFixToStats, EMPTY_RECORDING_STATS);
    expect(stats.pointCount).toBe(5);
    expect(stats.firstMs).toBe(T0);
    expect(stats.lastMs).toBe(T0 + 48_000);
    expect(stats.longestGapS).toBe(45);
    expect(stats.lastAccuracyM).toBeNull();
  });
});

describe('shouldFlushJournal', () => {
  it('écrit à la première position puis toutes les N secondes de trace', () => {
    expect(shouldFlushJournal(null, T0, 10)).toBe(true);
    expect(shouldFlushJournal(T0, T0 + 9_999, 10)).toBe(false);
    expect(shouldFlushJournal(T0, T0 + 10_000, 10)).toBe(true);
  });

  it('écrit au premier point qui suit une coupure, sans attendre', () => {
    expect(shouldFlushJournal(T0, T0 + 600_000, 10)).toBe(true);
  });
});

describe('isSportType', () => {
  it('ne reconnaît que les supports du profil', () => {
    expect(isSportType('wingfoil')).toBe(true);
    expect(isSportType('running')).toBe(true);
    expect(isSportType('toString')).toBe(false);
    expect(isSportType(42)).toBe(false);
  });
});

describe('sessionFileName et sessionTitle', () => {
  // Construite à l'heure locale : le test ne dépend pas du fuseau de la machine.
  const start = new Date(2026, 8, 3, 9, 5, 7).getTime();

  it('nomme le fichier par la date et l\'heure locales du premier point', () => {
    expect(sessionFileName(start, 'wingfoil')).toBe('2026-09-03_09-05-07_wingfoil.gpx');
  });

  it('titre la session par le support et l\'heure à la minute', () => {
    expect(sessionTitle(start, 'running')).toBe('Course à pied, 03/09/2026 09:05');
  });
});
