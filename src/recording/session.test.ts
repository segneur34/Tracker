import { describe, expect, it } from 'vitest';
import type { LocationFix } from '../platform/location';
import {
  EMPTY_RECORDING_STATS,
  addFixToStats,
  displayedDurationMs,
  evaluateAutoPause,
  fixesFromRawPoints,
  isAutoPause,
  isManualPause,
  isNewerFix,
  isRecordingSession,
  keepHeartRateSample,
  nothingToKeep,
  withStopPoint,
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
  it('reprend heure, position, altitude, vitesse et FC, et écarte un point sans heure lisible', () => {
    const fixes = fixesFromRawPoints([
      { lat: 43.5, lon: 3.9, time: '2026-09-23T12:00:00Z', ele: 12, speedMs: 4.2, hr: 150 },
      { lat: 43.6, lon: 3.8, time: 'pas une date' },
      { lat: 43.7, lon: 3.7, time: new Date(T0 + 1000) },
    ]);
    expect(fixes).toEqual([
      { timeMs: T0, lat: 43.5, lon: 3.9, altitudeM: 12, speedMs: 4.2, heartRateBpm: 150 },
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

describe('displayedDurationMs', () => {
  const stats = [fixAt(0), fixAt(600)].reduce(addFixToStats, EMPTY_RECORDING_STATS);
  const wall = 5_000_000;

  it('suit les positions hors pause', () => {
    expect(displayedDurationMs(stats, null, wall)).toBe(600_000);
  });

  it("tourne en pause automatique, à l'horloge du téléphone", () => {
    const pause = { sinceMs: wall, frozenAtMs: null };
    expect(displayedDurationMs(stats, pause, wall)).toBe(600_000);
    expect(displayedDurationMs(stats, pause, wall + 240_000)).toBe(840_000);
    // Horloge en retard sur le début de la pause : jamais en dessous des positions.
    expect(displayedDurationMs(stats, pause, wall - 1000)).toBe(600_000);
  });

  it("reste figée en pause manuelle, la pause automatique d'avant comprise", () => {
    expect(displayedDurationMs(stats, { sinceMs: wall, frozenAtMs: wall }, wall + 999_000)).toBe(600_000);
    expect(displayedDurationMs(stats, { sinceMs: wall, frozenAtMs: wall + 60_000 }, wall + 999_000)).toBe(660_000);
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

describe('mesures de la ceinture sans position (muscu, lot I du 25/10)', () => {
  const T = Date.UTC(2026, 9, 28, 18, 0, 0);
  it('une par intervalle au plus, ni hors contact ni sans FC', () => {
    expect(keepHeartRateSample(null, { bpm: 92.4, timeMs: T + 0.4, contact: true }, 1000)).toEqual({ timeMs: T, heartRateBpm: 92 });
    expect(keepHeartRateSample(T, { bpm: 92, timeMs: T + 700, contact: null }, 1000)).toBeNull();
    // Gigue Bluetooth : 998 ms après la dernière, la mesure est gardée (tolérance d'un quart d'intervalle).
    expect(keepHeartRateSample(T, { bpm: 92, timeMs: T + 998, contact: null }, 1000)).toEqual({ timeMs: T + 998, heartRateBpm: 92 });
    expect(keepHeartRateSample(T, { bpm: 92, timeMs: T + 1000, contact: null }, 1000)).toEqual({ timeMs: T + 1000, heartRateBpm: 92 });
    expect(keepHeartRateSample(null, { bpm: 92, timeMs: T, contact: false }, 1000)).toBeNull();
    expect(keepHeartRateSample(null, { bpm: 0, timeMs: T, contact: true }, 1000)).toBeNull();
  });

  it('le point de l’arrêt prolonge le dernier segment, pas avant la dernière mesure', () => {
    const segments = [[{ timeMs: T, heartRateBpm: 90 }], [{ timeMs: T + 60_000, heartRateBpm: 100 }]];
    expect(withStopPoint(segments, T + 65_000)).toEqual([segments[0], [{ timeMs: T + 60_000, heartRateBpm: 100 }, { timeMs: T + 65_000 }]]);
    expect(withStopPoint(segments, T + 60_000)).toBe(segments);
    expect(withStopPoint([], T)).toEqual([]);
  });
});

describe('états de l’enregistreur', () => {
  const cases = [
    { status: 'idle', pausedReason: null },
    { status: 'starting', pausedReason: null },
    { status: 'recording', pausedReason: null },
    { status: 'paused', pausedReason: 'manual' as const },
    { status: 'paused', pausedReason: 'auto' as const },
    { status: 'stopping', pausedReason: null },
  ];

  it('dit si une session est en cours, en pause manuelle ou automatique', () => {
    expect(cases.map(isRecordingSession)).toEqual([false, true, true, true, true, false]);
    expect(cases.map(isManualPause)).toEqual([false, false, false, true, false, false]);
    expect(cases.map(isAutoPause)).toEqual([false, false, false, false, true, false]);
  });

  it('suit les écritures d’avant', () => {
    for (const c of cases) {
      expect(isRecordingSession(c)).toBe(c.status === 'starting' || c.status === 'recording' || c.status === 'paused');
      expect(isManualPause(c)).toBe(c.status === 'paused' && c.pausedReason === 'manual');
      expect(isAutoPause(c)).toBe(c.status === 'paused' && c.pausedReason === 'auto');
    }
  });
});

describe('nothingToKeep (lot 67, sorti de useRecorder)', () => {
  it('parle des positions, ou sans position (muscu) des mesures de la ceinture', () => {
    expect(nothingToKeep('running')).toBe('Moins de deux positions reçues : rien à enregistrer.');
    expect(nothingToKeep(null)).toBe('Moins de deux positions reçues : rien à enregistrer.');
    expect(nothingToKeep('muscu')).toBe('Moins de deux mesures de la ceinture : rien à enregistrer.');
  });
});
