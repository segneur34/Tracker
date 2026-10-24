import { describe, expect, it } from 'vitest';
import type { IntervalTimerState } from './intervalTimer';
import type { LiveFieldContext } from './liveFields';
import { liveNotification, liveNotificationKey, type LiveNotificationInput } from './liveNotification';
import { EMPTY_LIVE_STATS } from './liveStats';

const context = (patch: Partial<LiveFieldContext> = {}): LiveFieldContext => ({
  stats: { ...EMPTY_LIVE_STATS, currentSpeedMs: 10, averageSpeedMs: 5, distanceM: 12_345 },
  durationMs: 3_725_000,
  nowMs: 0,
  remainingM: null,
  headingDeg: null,
  markDistanceM: null,
  markBearingDeg: null,
  heartRateBpm: null,
  heartRateZoneBounds: null,
  speedUnit: 'kmh',
  distanceUnit: 'km',
  ...patch,
});

const NOW = 1_700_000_000_000;

const input = (patch: Partial<LiveNotificationInput> = {}): LiveNotificationInput => ({
  activityName: 'Wingfoil',
  fields: ['speed', 'distance'],
  context: context(),
  paused: null,
  startedAtMs: NOW - 3_725_000,
  interval: null,
  nowMs: NOW,
  ...patch,
});

const work3: IntervalTimerState = { status: 'running', phase: { kind: 'travail', rep: 3, of: 8, block: 0, series: 1, seriesCount: 1, startS: 100, endS: 160 }, remainingMs: 42_300, elapsedS: 117.7 };

describe('liveNotification', () => {
  it("donne l'activité, les chiffres en une ligne et la durée au chronomètre", () => {
    const n = liveNotification(input());
    expect(n.title).toBe('Wingfoil');
    expect(n.text).toBe('Vit. 36.0 km/h · Dist. 12.35 km');
    expect(n.lines).toEqual(['Vitesse : 36.0 km/h', 'Distance : 12.35 km']);
    expect(n.chrono).toEqual({ baseMs: NOW - 3_725_000, countDown: false });
  });

  it("parle d'allure en min/km", () => {
    const n = liveNotification(input({ fields: ['speed'], context: context({ speedUnit: 'minkm' }) }));
    expect(n.text.startsWith('Allure ')).toBe(true);
    expect(n.lines[0].startsWith('Allure : ')).toBe(true);
  });

  it('marque les valeurs absentes', () => {
    const n = liveNotification(input({ fields: ['grade', 'heading'] }));
    expect(n.text).toBe('Pente — · Cap —');
  });

  it('en pause manuelle : durée figée dans le titre, deux chiffres sur la ligne, pas de chronomètre', () => {
    const n = liveNotification(input({ paused: 'manual' }));
    expect(n.title).toBe('Wingfoil · en pause 1:02:05');
    expect(n.text).toBe('Vit. 36.0 km/h · Dist. 12.35 km');
    expect(n.chrono).toBeNull();
  });

  it('en pause automatique, le chronomètre continue', () => {
    const n = liveNotification(input({ paused: 'auto' }));
    expect(n.title).toBe('Wingfoil · pause auto');
    expect(n.chrono?.countDown).toBe(false);
  });

  it('avec le compteur : la répétition au titre, le décompte de la phase au chronomètre', () => {
    const n = liveNotification(input({ activityName: 'Fractionné à pied', interval: { state: work3 } }));
    expect(n.title).toBe('Fractionné à pied · Travail 3/8');
    expect(n.chrono).toEqual({ baseMs: NOW + 42_000, countDown: true });
  });

  it('compteur en pause : la phase le dit, la durée reprend le chronomètre', () => {
    const n = liveNotification(input({ interval: { state: { ...work3, status: 'paused' } } }));
    expect(n.title).toBe('Wingfoil · Travail 3/8 en pause');
    expect(n.chrono?.countDown).toBe(false);
  });

  it('sans premier point, pas de chronomètre', () => {
    expect(liveNotification(input({ startedAtMs: null })).chrono).toBeNull();
  });
});

describe('liveNotificationKey', () => {
  it('ne change pas pour un même décompte recalculé un peu plus tard', () => {
    const a = liveNotification(input({ interval: { state: work3 } }));
    const b = liveNotification(input({ nowMs: NOW + 1000, interval: { state: { ...work3, remainingMs: 41_300 } } }));
    expect(liveNotificationKey(a, false)).toBe(liveNotificationKey(b, false));
  });

  it('distingue la notification posée seule', () => {
    const n = liveNotification(input());
    expect(liveNotificationKey(n, true)).not.toBe(liveNotificationKey(n, false));
  });
});
