import { describe, expect, it } from 'vitest';
import type { LocationFix } from '../platform/location';
import {
  EMPTY_RECORDING_STATS,
  addFixToStats,
  evaluateAutoPause,
  fixesFromRawPoints,
  isNewerFix,
  isSportType,
  recordingDurationMs,
  roundFix,
  sessionFileName,
  sessionTitle,
  shouldFlushJournal,
  splitIntoSegments,
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
      lat: 43.123457,
      lon: -3.987654,
      accuracyM: 4.3,
      altitudeM: undefined,
      speedMs: 5.43,
      bearingDeg: 271.3,
    });
  });
});

describe('splitIntoSegments', () => {
  const fixes = [fixAt(0), fixAt(1), fixAt(2), fixAt(3)];

  it('rend un seul segment sans coupure', () => {
    expect(splitIntoSegments(fixes, [])).toEqual([fixes]);
  });

  it('découpe aux indices donnés', () => {
    expect(splitIntoSegments(fixes, [2])).toEqual([fixes.slice(0, 2), fixes.slice(2)]);
  });

  it('accepte des coupures non triées, dédoublonnées', () => {
    expect(splitIntoSegments(fixes, [3, 1, 1])).toEqual([fixes.slice(0, 1), fixes.slice(1, 3), fixes.slice(3)]);
  });

  it('ignore les coupures hors bornes, sans segment vide', () => {
    expect(splitIntoSegments(fixes, [0, -1, 4, 99])).toEqual([fixes]);
  });

  it('rend un tableau vide pour une trace vide', () => {
    expect(splitIntoSegments([], [1])).toEqual([]);
  });
});

describe('evaluateAutoPause', () => {
  const settings = { speedMs: 0.3, delayS: 60 };

  it('désactivée si le seuil est nul ou négatif', () => {
    expect(evaluateAutoPause(false, null, fixAt(0, { speedMs: 0 }), { speedMs: 0, delayS: 60 }))
      .toEqual({ event: 'none', belowSinceMs: null });
  });

  it('ne change rien sans vitesse connue, en enregistrement ou en pause', () => {
    expect(evaluateAutoPause(false, 1000, fixAt(1), settings)).toEqual({ event: 'none', belowSinceMs: 1000 });
    expect(evaluateAutoPause(true, null, fixAt(1), settings)).toEqual({ event: 'none', belowSinceMs: null });
  });

  it('ancre la première position sous le seuil, sans déclencher tout de suite', () => {
    const fix = fixAt(10, { speedMs: 0.1 });
    expect(evaluateAutoPause(false, null, fix, settings)).toEqual({ event: 'none', belowSinceMs: fix.timeMs });
  });

  it('ne déclenche pas juste avant le délai, déclenche pile au délai', () => {
    const since = T0;
    const before = { timeMs: since + 59_000, lat: 43.5, lon: 3.9, speedMs: 0.1 };
    const at = { timeMs: since + 60_000, lat: 43.5, lon: 3.9, speedMs: 0.1 };
    expect(evaluateAutoPause(false, since, before, settings)).toEqual({ event: 'none', belowSinceMs: since });
    expect(evaluateAutoPause(false, since, at, settings)).toEqual({ event: 'pause', belowSinceMs: null });
  });

  it('remet le compteur à zéro dès une vitesse au-dessus du seuil', () => {
    expect(evaluateAutoPause(false, T0, fixAt(5, { speedMs: 1 }), settings)).toEqual({ event: 'none', belowSinceMs: null });
  });

  it('ne reprend pas tant que la vitesse reste sous le seuil', () => {
    expect(evaluateAutoPause(true, null, fixAt(5, { speedMs: 0.1 }), settings)).toEqual({ event: 'none', belowSinceMs: null });
  });

  it('reprend dès qu\'une position dépasse le seuil', () => {
    expect(evaluateAutoPause(true, null, fixAt(5, { speedMs: 1 }), settings)).toEqual({ event: 'resume', belowSinceMs: null });
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

describe('recordingDurationMs', () => {
  it("vaut zéro avant la première position, puis l'écart entre la première et la dernière", () => {
    expect(recordingDurationMs(EMPTY_RECORDING_STATS)).toBe(0);
    expect(recordingDurationMs(addFixToStats(EMPTY_RECORDING_STATS, fixAt(0)))).toBe(0);
    const stats = [fixAt(0), fixAt(1), fixAt(3725)].reduce(addFixToStats, EMPTY_RECORDING_STATS);
    expect(recordingDurationMs(stats)).toBe(3_725_000);
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

  it('titre la session par son activité et l\'heure à la minute', () => {
    expect(sessionTitle(start, 'Trail')).toBe('Trail, 03/09/2026 09:05');
  });
});
