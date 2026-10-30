import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ACTIVITIES } from '../core/activities';
import { getSportProfile, TERRAIN_STEP_CHOICES_M } from '../core/sportProfiles';
import { BIKE_TYPES } from '../cycling/energy';
import { DEFAULT_PACE_LEVEL } from '../planning/duration';
import { WAY_TYPES } from '../planning/brouterProfile';
import { patchedDraft, type SessionEdits } from '../library/sessionEdits';
import { jsonStore } from '../platform/storage';
import {
  PER_ACTIVITY_KEYS, TREATMENT_UNITS, defaultBikeType, defaultGradeRange, defaultHeartRateOf, defaultLiveFieldsFor, defaultMarkGuideOf,
  defaultNotificationFieldsFor, defaultSpeedUnitOf, defaultTerrainStepOf, isActivityOverridden, readStoredSettings, resetOverrides,
  settingsView, subscribeStoredSettings, updateStoredSettings, type StoredSettings,
} from './useSportSettings';

const KEY = 'tracker.sportSettings';
const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('lecture des réglages par useSyncExternalStore (A4)', () => {
  it('rend le même instantané tant que rien n\'est écrit, un neuf après une écriture', () => {
    jsonStore.write(KEY, { thresholds: { wingfoil: 10 } });
    const first = readStoredSettings();
    expect(readStoredSettings()).toBe(first);
    jsonStore.write('tracker.autreCle', { x: 1 });
    expect(readStoredSettings()).toBe(first);
    jsonStore.write(KEY, { thresholds: { wingfoil: 11 } });
    expect(readStoredSettings()).not.toBe(first);
    expect(readStoredSettings().thresholds?.wingfoil).toBe(11);
  });

  it("voit une écriture faite entre le rendu et l'abonnement", () => {
    // Rendu : l'instantané est lu ; puis une écriture d'ailleurs ; puis l'abonnement de l'effet.
    jsonStore.write(KEY, { thresholds: { wingfoil: 10 } });
    const rendered = readStoredSettings();
    jsonStore.write(KEY, { thresholds: { wingfoil: 14 } });
    const listener = vi.fn();
    const unsubscribe = subscribeStoredSettings(listener);
    // useSyncExternalStore relit l'instantané après l'abonnement et redessine s'il a changé.
    expect(readStoredSettings()).not.toBe(rendered);
    expect(readStoredSettings().thresholds?.wingfoil).toBe(14);
    unsubscribe();
  });

  it("n'est réveillé que par les écritures des réglages", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeStoredSettings(listener);
    jsonStore.write('tracker.panelSizes', {});
    expect(listener).not.toHaveBeenCalled();
    jsonStore.write(KEY, {});
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    jsonStore.write(KEY, { a: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('deux écritures dans un même geste (A5)', () => {
  it('se cumulent dans les réglages', () => {
    jsonStore.write(KEY, { thresholds: { wingfoil: 10 } });
    updateStoredSettings((s) => ({ ...s, speedUnits: { ...s.speedUnits, wingfoil: 'kmh' } }));
    updateStoredSettings((s) => ({ ...s, distanceUnits: { ...s.distanceUnits, wingfoil: 'nm' } }));
    const stored = readStoredSettings();
    expect(stored.speedUnits?.wingfoil).toBe('kmh');
    expect(stored.distanceUnits?.wingfoil).toBe('nm');
    expect(stored.thresholds?.wingfoil).toBe(10);
  });

  it("n'écrit rien quand le changement rend null", () => {
    jsonStore.write(KEY, { thresholds: { wingfoil: 10 } });
    const listener = vi.fn();
    const unsubscribe = subscribeStoredSettings(listener);
    updateStoredSettings(() => null);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('se cumulent dans le brouillon de session', () => {
    const saved = { notes: { comment: '' } } as unknown as SessionEdits;
    const first = patchedDraft(null, saved, () => ({ customThreshold: 7 } as Partial<SessionEdits>));
    const second = patchedDraft(first, saved, (edits) => ({ notes: { ...edits.notes, comment: 'vent fort' } }));
    expect((second as unknown as { customThreshold: number }).customThreshold).toBe(7);
    expect(second.notes).toEqual({ comment: 'vent fort' });
    expect(saved.notes).toEqual({ comment: '' });
  });
});

describe('isActivityOverridden', () => {
  const find = (id: string) => DEFAULT_ACTIVITIES.find((a) => a.id === id)!;
  const wing = find('wingfoil');
  const run = find('running');
  const bike = find('cycling');
  const otherBike = (Object.keys(BIKE_TYPES) as (keyof typeof BIKE_TYPES)[]).find((k) => k !== defaultBikeType(bike))!;

  /** Une valeur réglée, autre que le défaut, pour chaque table rangée par activité. */
  const SAMPLES: Record<string, { activity: typeof wing; value: unknown }> = {
    thresholds: { activity: wing, value: 12 },
    speedUnits: { activity: run, value: TREATMENT_UNITS.course.find((u) => u !== defaultSpeedUnitOf(run)) },
    distanceUnits: { activity: run, value: 'nm' },
    speedRanges: { activity: run, value: { minMs: 1, maxMs: 5 } },
    gradeRanges: { activity: run, value: defaultGradeRange(run) },
    autoPause: { activity: run, value: { speedMs: 0.5, delayS: 10 } },
    bikeTypes: { activity: bike, value: otherBike },
    bikeWeights: { activity: bike, value: 9 },
    carriedLoads: { activity: run, value: 5 },
    energyModels: { activity: run, value: 'marche' },
    hrOffsets: { activity: run, value: 5 },
    gearLabels: { activity: run, value: ['Chaussures', 'Montre'] },
    tabs: { activity: run, value: { general: false } },
    paceLevels: { activity: run, value: DEFAULT_PACE_LEVEL === 'expert' ? 'bon' : 'expert' },
    customFlatSpeeds: { activity: run, value: 3.3 },
    liveFields: { activity: run, value: defaultLiveFieldsFor(run) },
    notificationFields: { activity: run, value: defaultNotificationFieldsFor(run) },
    markGuide: { activity: wing, value: defaultMarkGuideOf(wing) },
    wayTypes: { activity: run, value: [WAY_TYPES[0]] },
    terrainSteps: { activity: run, value: TERRAIN_STEP_CHOICES_M.find((v) => v !== defaultTerrainStepOf(run)) },
    loopReturnRatios: { activity: run, value: getSportProfile('running').loopReturnMaxRatio === 2 ? 2.5 : 2 },
    foils: { activity: wing, value: true },
    pumping: { activity: wing, value: true },
    jumps: { activity: wing, value: getSportProfile('wingfoil').jumps },
    heartRate: { activity: run, value: !defaultHeartRateOf(run) },
    cadence: { activity: run, value: false },
  };

  it('couvre chaque table rangée par activité, le matériel enregistré excepté', () => {
    expect([...PER_ACTIVITY_KEYS].filter((k) => k !== 'gearGroups').sort()).toEqual(Object.keys(SAMPLES).sort());
  });

  it('est faux sans aucun réglage', () => {
    for (const activity of [wing, run, bike]) expect(isActivityOverridden(settingsView({}, activity))).toBe(false);
  });

  for (const [key, { activity, value }] of Object.entries(SAMPLES)) {
    it(`voit « ${key} » réglé, et plus rien après « Par défaut »`, () => {
      const stored = { [key]: { [activity.id]: value } } as StoredSettings;
      expect(isActivityOverridden(settingsView(stored, activity))).toBe(true);
      expect(isActivityOverridden(settingsView(resetOverrides(stored, activity.id), activity))).toBe(false);
    });
  }

  it('ne compte pas le matériel enregistré, que « Par défaut » garde', () => {
    const groups = [{ id: 'g-mat', name: 'Aile', items: [{ id: 'i1', name: '5 m' }] }];
    const stored = { gearGroups: { [wing.id]: groups } } as StoredSettings;
    expect(resetOverrides(stored, wing.id).gearGroups?.[wing.id]).toEqual(groups);
    expect(isActivityOverridden(settingsView(stored, wing))).toBe(false);
  });
});
