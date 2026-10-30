import { describe, expect, it } from 'vitest';
import type { IntervalTimerState } from './intervalTimer';
import type { LiveFieldContext } from './liveFields';
import { liveNotification, liveNotificationKey, notificationStateKey, trainingStep, type LiveNotificationInput } from './liveNotification';
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

describe('trainingStep (26/10)', () => {
  const test = (phase: 'echauffement' | 'rampe' | 'recuperation', step: number) => ({ active: true, phase, step });

  it("rend l'étape du compteur en priorité, sinon le palier de la rampe, sinon rien", () => {
    expect(trainingStep({ rep: 5, of: 20 }, test('rampe', 3))).toEqual({ rep: 5, of: 20 });
    expect(trainingStep(null, test('rampe', 3))).toEqual({ rep: 3, of: null });
    expect(trainingStep(null, test('echauffement', 0))).toBeNull();
    expect(trainingStep(null, test('recuperation', 7))).toBeNull();
    expect(trainingStep(null, { active: false, phase: 'rampe', step: 2 })).toBeNull();
    expect(trainingStep(null, null)).toBeNull();
  });

  it("met l'étape sur la ligne repliée, la phase restant dans le titre", () => {
    const n = liveNotification(input({ activityName: 'Fractionné à pied', fields: ['step', 'speed'], context: context({ step: { rep: 5, of: 20 } }) }));
    expect(n.text).toBe('Étape 5/20 · Vit. 36.0 km/h');
    expect(n.lines[0]).toBe('Étape : 5/20');
  });
});

describe('notificationStateKey (lot 67, sortie de recordingNotification)', () => {
  /** Copie gelée de l'ancienne clé du service (`stateKeyNow`), sur les mêmes lectures. */
  const oldKey = (status: string, pausedReason: 'manual' | 'auto' | null, activity: { id: string } | null, timer: IntervalTimerState | null, computed: boolean): string => {
    const phase = timer?.phase ? `${timer.status}:${timer.phase.kind}:${timer.phase.rep}:${timer.phase.startS}` : '';
    return `${status}|${pausedReason ?? ''}|${activity?.id ?? ''}|${phase}|${computed}`;
  };
  const cases: [string, 'manual' | 'auto' | null, string | null, IntervalTimerState | null, boolean][] = [
    ['recording', null, 'running', null, true],
    ['paused', 'auto', 'running', null, true],
    ['paused', 'manual', 'wingfoil', null, true],
    ['recording', null, 'run-intervals', work3, true],
    ['recording', null, 'run-intervals', { ...work3, status: 'paused' }, true],
    ['recording', null, 'running', { ...work3, phase: null }, true],
    ['recording', null, 'running', null, false],
    ['starting', null, null, null, false],
  ];

  it.each(cases)('%s %s %s : la même clé qu\'avant', (status, pausedReason, activityId, timer, computed) => {
    expect(notificationStateKey({ status, pausedReason, activityId, timer, computed }))
      .toBe(oldKey(status, pausedReason, activityId === null ? null : { id: activityId }, timer, computed));
  });

  it('change avec la pause, la phase du compteur et le premier calcul', () => {
    const key = (patch: Partial<Parameters<typeof notificationStateKey>[0]>) =>
      notificationStateKey({ status: 'recording', pausedReason: null, activityId: 'running', timer: null, computed: true, ...patch });
    expect(key({})).toBe('recording||running||true');
    expect(key({ status: 'paused', pausedReason: 'auto' })).not.toBe(key({ status: 'paused', pausedReason: 'manual' }));
    expect(key({ timer: work3 })).toBe('recording||running|running:travail:3:100|true');
    expect(key({ computed: false })).not.toBe(key({}));
  });
});
