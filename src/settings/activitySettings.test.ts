import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTIVITIES } from '../core/activities';
import { getSportProfile, hasActiveThreshold, TERRAIN_STEP_CHOICES_M } from '../core/sportProfiles';
import { knotsToMs } from '../core/units';
import { DEFAULT_PACE_LEVEL } from '../planning/duration';
import { WAY_TYPES } from '../planning/brouterProfile';
import { BIKE_TYPES } from '../cycling/energy';
import {
  PER_ACTIVITY_KEYS, PRESETS_VERSION, TREATMENT_UNITS, defaultAutoPauseOf, defaultBikeKg, defaultBikeType, defaultGradeRange, defaultHeartRateOf,
  defaultHrOffsetOf, defaultLiveFieldsFor, defaultMarkGuideOf, defaultNotificationFieldsFor, defaultPaceOf, defaultSpeedRangeOf, defaultSpeedUnitOf,
  defaultEnergyModelOf, defaultTerrainStepOf, defaultThresholdOf, isActivityOverridden, rangeFollowsPace, resetOverrides, resetStoredPresets,
  SETTING_FIELDS, settingsView, thresholdFollowsPace, withSetting, type StoredSettings,
} from './activitySettings';

describe('pré-réglages du bateau (21/10)', () => {
  const boat = { id: 'a-voilier', name: 'Voilier', base: 'bateau' as const, color: '#014e86' };

  it('colore de 1 à 15 nœuds, sans seuil, pause sous 0,2 km/h pendant 60 s', () => {
    const range = defaultSpeedRangeOf(boat);
    expect(range.minMs).toBeCloseTo(knotsToMs(1), 6);
    expect(range.maxMs).toBeCloseTo(knotsToMs(15), 6);
    const profile = getSportProfile('bateau');
    expect(hasActiveThreshold(profile)).toBe(false);
    expect(profile.withoutActiveThreshold?.maneuverSuccess).toBe(1);
    expect(profile.recording.autoPauseSpeedMs * 3.6).toBeCloseTo(0.2, 6);
    expect(profile.recording.autoPauseDelayS).toBe(60);
    expect(hasActiveThreshold(getSportProfile('wingfoil'))).toBe(true);
  });

  it("efface une fois les anciens réglages du bateau, rien d'autre", () => {
    const stored: StoredSettings = {
      activities: [...DEFAULT_ACTIVITIES, boat],
      speedRanges: { [boat.id]: { minMs: 1, maxMs: 9 }, bateau: { minMs: 1, maxMs: 8 }, kite: { minMs: 3, maxMs: 12 } },
      thresholds: { [boat.id]: 3, kite: 9 },
      autoPause: { [boat.id]: { speedMs: 0.3, delayS: 60 } },
      liveFields: { [boat.id]: ['speed'] },
      notificationFields: { [boat.id]: ['speed', 'max'] },
      speedUnits: { [boat.id]: 'kmh' },
    };
    const next = resetStoredPresets(stored);
    expect(next.speedRanges).toEqual({ kite: { minMs: 3, maxMs: 12 } });
    expect(next.thresholds).toEqual({ kite: 9 });
    expect(next.autoPause).toEqual({});
    expect(next.liveFields).toEqual({});
    expect(next.notificationFields).toEqual({});
    expect(next.speedUnits).toEqual({ [boat.id]: 'kmh' });
    // Réglages écrits après la mise à jour : gardés.
    const written = { ...stored, presetsVersion: PRESETS_VERSION };
    expect(resetStoredPresets(written)).toBe(written);
    // Rien à effacer : les réglages eux-mêmes.
    const clean: StoredSettings = { speedUnits: { kite: 'kmh' } };
    expect(resetStoredPresets(clean)).toBe(clean);
  });
});

describe('pré-réglages des activités (21/10)', () => {
  const [voile, course, marche, route, gravel, vtt, surf, , runIntervals, bikeIntervals] = DEFAULT_ACTIVITIES;
  const pav = { id: 'a-pav', name: 'Pav', base: 'windsurf' as const, color: '#5b87f2' };
  const trail = { id: 'a-trail', name: 'Trail', base: 'running' as const, color: '#d42a3c' };
  const kmh = (ms: number) => Math.round(ms * 3.6 * 10) / 10;
  const kn = (ms: number) => Math.round((ms / knotsToMs(1)) * 10) / 10;

  it('wing et planche : 8 nœuds partout, seuil et couleurs fixes', () => {
    for (const activity of [voile, pav]) {
      expect(defaultThresholdOf(activity, false)).toBe(8);
      expect(thresholdFollowsPace(activity)).toBe(false);
      expect(rangeFollowsPace(activity)).toBe(false);
      const range = defaultSpeedRangeOf(activity);
      expect([kn(range.minMs), kn(range.maxMs)]).toEqual([8, 24]);
      expect(kmh(defaultAutoPauseOf(activity).speedMs)).toBe(1.5);
      expect(defaultLiveFieldsFor(activity)).toEqual(['speed', 'average', 'recentTopShort', 'distance']);
      expect(defaultMarkGuideOf(activity).curve.map((p) => p.distanceM)).toEqual([5, 25, 34]);
    }
    // Le kite suit toujours l'allure.
    const kite = { id: 'a-kite', name: 'Kite', base: 'kite' as const, color: '#1976d2' };
    expect(thresholdFollowsPace(kite)).toBe(true);
    expect(rangeFollowsPace(kite)).toBe(true);
  });

  it("sans seuil d'activité à pied, à vélo et en fractionné, marche comprise (28/10)", () => {
    for (const activity of [course, marche, route, gravel, vtt, runIntervals, bikeIntervals, trail]) {
      expect(defaultThresholdOf(activity, false)).toBe(0);
    }
    // Le surf garde ses défauts.
    expect(defaultThresholdOf(surf, false)).toBe(getSportProfile('surf').defaultActiveThreshold);
  });

  it('course : km/h, couleurs de 1 à 13, pause sous 0,5 km/h pendant 20 s, ceinture, sentier et piste', () => {
    expect(defaultSpeedUnitOf(course)).toBe('kmh');
    const range = defaultSpeedRangeOf(course);
    expect([kmh(range.minMs), kmh(range.maxMs)]).toEqual([1, 13]);
    expect(defaultAutoPauseOf(course)).toEqual({ speedMs: 0.5 / 3.6, delayS: 20 });
    expect(defaultGradeRange(course)).toEqual({ min: 0, max: 0.17 });
    expect(defaultHeartRateOf(course)).toBe(true);
    expect(defaultTerrainStepOf(course)).toBe(5);
    // Une activité créée sur la course prend son pré-réglage.
    expect(defaultSpeedRangeOf(trail)).toEqual(range);
  });

  it("la marche a le sien en entier, sans rien reprendre de la course", () => {
    const range = defaultSpeedRangeOf(marche);
    expect([kmh(range.minMs), kmh(range.maxMs)]).toEqual([1, 8]);
    expect(defaultHeartRateOf(marche)).toBe(false);
    expect(defaultNotificationFieldsFor(marche)).toEqual(['speed', 'heartRate']);
    const walk = defaultPaceOf(marche);
    expect(walk.level).toBe('perso');
    expect(walk.customFlatSpeedMs! * 3.6).toBeCloseTo(5);
    expect(defaultPaceOf(course)).toEqual({ level: DEFAULT_PACE_LEVEL, customFlatSpeedMs: null });
  });

  it('vélo : type et poids pré-réglés, le poids du type dès que le type change', () => {
    expect(defaultBikeType(route)).toBe('route');
    expect(defaultBikeKg(route, 'route')).toBe(12);
    expect(defaultBikeKg(route, 'gravel')).toBe(BIKE_TYPES.gravel.bikeKg);
    expect(defaultBikeType(gravel)).toBe('gravel');
    expect(defaultBikeKg(gravel, 'gravel')).toBe(13);
    expect(defaultBikeType(vtt)).toBe('vtt');
    expect(defaultBikeKg(vtt, 'vtt')).toBe(BIKE_TYPES.vtt.bikeKg);
    expect(defaultHeartRateOf(route)).toBe(true);
    expect(defaultHeartRateOf(gravel)).toBe(false);
  });

  it('fractionné : chiffres cardio, pause coupée', () => {
    for (const activity of [runIntervals, bikeIntervals]) {
      expect(defaultLiveFieldsFor(activity)).toEqual(['speed', 'average', 'heartRate', 'heartRateZone']);
      expect(defaultAutoPauseOf(activity).speedMs).toBe(0);
    }
  });

  it('efface une fois les anciens réglages des sports pré-réglés, pas ceux du kite ni du surf', () => {
    const stored: StoredSettings = {
      activities: [...DEFAULT_ACTIVITIES, pav],
      presetsVersion: 1,
      thresholds: { running: 2, 'a-gravel': 2, [pav.id]: 9, kite: 12, surf: 9 },
      speedRanges: { 'a-route': { minMs: 2, maxMs: 12 }, cycling: { minMs: 2, maxMs: 12 } },
      tabs: { [pav.id]: { vent: false } },
      gearLabels: { running: ['Chaussures', ''] },
    };
    const next = resetStoredPresets(stored);
    expect(next.thresholds).toEqual({ kite: 12, surf: 9 });
    expect(next.speedRanges).toEqual({ 'a-route': { minMs: 2, maxMs: 12 } });
    expect(next.tabs).toEqual({});
    expect(next.gearLabels).toEqual(stored.gearLabels);
  });

  it('dépense : la Marche sur Pandolf, les autres sur la course', () => {
    expect(defaultEnergyModelOf(marche)).toBe('marche');
    for (const activity of [course, trail, runIntervals, route]) expect(defaultEnergyModelOf(activity)).toBe('course');
  });

  it('efface une fois le seuil rangé de la Marche (version 2 → 3), garde celui de la Course', () => {
    const stored: StoredSettings = {
      activities: [...DEFAULT_ACTIVITIES],
      presetsVersion: 2,
      thresholds: { [marche.id]: 0.5, running: 2, kite: 12 },
      speedRanges: { [marche.id]: { minMs: 0.3, maxMs: 2 } },
    };
    const next = resetStoredPresets(stored);
    expect(next.thresholds).toEqual({ running: 2, kite: 12 });
    expect(next.speedRanges).toBe(stored.speedRanges);
    expect(PRESETS_VERSION).toBe(3);
  });
});

describe('décalage des seuils cardio (25/10)', () => {
  const [voile, course, marche, route, , , surf, , runIntervals, bikeIntervals] = DEFAULT_ACTIVITIES;
  const kite = { id: 'a-kite', name: 'Kite', base: 'kite' as const, color: '#5b87f2' };
  const pav = { id: 'a-pav', name: 'Pav', base: 'windsurf' as const, color: '#5b87f2' };

  it("prend celui du calcul, la Marche le sien", () => {
    expect([course, runIntervals].map(defaultHrOffsetOf)).toEqual([0, 0]);
    expect(defaultHrOffsetOf(marche)).toBe(-4);
    expect([route, bikeIntervals].map(defaultHrOffsetOf)).toEqual([-7, -7]);
    expect([voile, kite, pav, surf].map(defaultHrOffsetOf)).toEqual([-8, -8, -5, -10]);
  });
});

describe('unités proposées par traitement', () => {
  it('le surf propose les nœuds, le km/h restant en tête et par défaut', () => {
    expect(TREATMENT_UNITS.surf).toContain('kn');
    expect(TREATMENT_UNITS.surf[0]).toBe('kmh');
    expect(getSportProfile('surf').speedUnit).toBe('kmh');
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

describe('bornes de couleur par défaut, tenues par le profil du calcul (lot 72)', () => {
  const kmh = (v: number) => v / 3.6;
  const custom = (base: keyof typeof expected) => ({ id: `a-${base}`, name: base, base, color: '#000000' });
  /** Valeurs d'avant le lot 72, gelées : les constantes de sport et la table du traitement qu'elles remplacent. */
  const expected = {
    wingfoil: [knotsToMs(8), knotsToMs(28)], windsurf: [knotsToMs(8), knotsToMs(28)], kite: [knotsToMs(8), knotsToMs(28)],
    bateau: [knotsToMs(1), knotsToMs(15)], running: [kmh(4), kmh(15)], 'run-intervals': [kmh(4), kmh(15)], 'run-test': [kmh(4), kmh(15)],
    muscu: [kmh(4), kmh(15)], cycling: [kmh(10), kmh(40)], 'bike-intervals': [kmh(10), kmh(40)], surf: [kmh(5), kmh(30)],
  } as const;

  it('chaque calcul a les siennes, celles du traitement de jadis', () => {
    for (const [base, [minMs, maxMs]] of Object.entries(expected)) {
      const range = getSportProfile(base as keyof typeof expected).speedRange;
      expect(range.minMs, base).toBeCloseTo(minMs, 9);
      expect(range.maxMs, base).toBeCloseTo(maxMs, 9);
    }
  });

  it("une activité sans pré-réglage prend celles de son calcul, une pré-réglée les siennes", () => {
    expect(defaultSpeedRangeOf(custom('kite'))).toEqual(getSportProfile('kite').speedRange);
    expect(defaultSpeedRangeOf(custom('muscu'))).toEqual(getSportProfile('muscu').speedRange);
    const wing = DEFAULT_ACTIVITIES.find((a) => a.id === 'wingfoil')!;
    expect(defaultSpeedRangeOf(wing).maxMs).toBeCloseTo(knotsToMs(24), 9);
  });

  it("les couleurs suivent l'allure en voile seulement, sans pré-réglage, bateau excepté", () => {
    expect(rangeFollowsPace(custom('kite'))).toBe(true);
    expect(rangeFollowsPace(custom('windsurf'))).toBe(false);
    expect(rangeFollowsPace(custom('bateau'))).toBe(false);
    expect(rangeFollowsPace(custom('running'))).toBe(false);
    expect(rangeFollowsPace(custom('surf'))).toBe(false);
  });
});

describe("écriture d'un réglage par la table des champs (lot 72)", () => {
  const find = (id: string) => DEFAULT_ACTIVITIES.find((a) => a.id === id)!;
  const run = find('running');
  const wing = find('wingfoil');
  const base: StoredSettings = { thresholds: { kite: 9 } };

  it('chaque champ se range dans une table par activité, et chaque table a son champ', () => {
    const keys = Object.values(SETTING_FIELDS).map((rule) => rule.key);
    expect([...keys].sort()).toEqual([...PER_ACTIVITY_KEYS].sort());
  });

  it("range la valeur sous l'activité seule, sans toucher aux autres", () => {
    const next = withSetting(base, run.id, 'activeThreshold', 4);
    expect(next?.thresholds).toEqual({ kite: 9, [run.id]: 4 });
    expect(base.thresholds).toEqual({ kite: 9 });
  });

  it('efface la surcharge pour null, refuse une valeur hors règle', () => {
    expect(withSetting({ thresholds: { [run.id]: 4 } }, run.id, 'activeThreshold', null)?.thresholds).toEqual({});
    expect(withSetting(base, run.id, 'activeThreshold', -1)).toBeNull();
    expect(withSetting(base, run.id, 'speedRange', { minMs: 5, maxMs: 2 })).toBeNull();
    expect(withSetting(base, run.id, 'hrOffset', 2.5)).toBeNull();
  });

  it("ne range que l'écart au défaut : aucune charge, ceinture par défaut, cadence mesurée", () => {
    expect(withSetting({ carriedLoads: { [run.id]: 5 } }, run.id, 'carriedLoad', 0)?.carriedLoads).toEqual({});
    expect(withSetting(base, run.id, 'heartRate', defaultHeartRateOf(run))?.heartRate).toEqual({});
    expect(withSetting(base, run.id, 'heartRate', !defaultHeartRateOf(run))?.heartRate).toEqual({ [run.id]: !defaultHeartRateOf(run) });
    expect(withSetting(base, run.id, 'cadence', true)?.cadence).toEqual({});
    expect(withSetting(base, run.id, 'cadence', false)?.cadence).toEqual({ [run.id]: false });
  });

  it("refuse un réglage que le calcul n'a pas, ou une activité inconnue", () => {
    expect(withSetting(base, run.id, 'foil', true)).toBeNull();
    expect(withSetting(base, run.id, 'pumping', true)).toBeNull();
    expect(withSetting(base, wing.id, 'pumping', true)?.pumping).toEqual({ [wing.id]: true });
    expect(withSetting(base, 'a-inconnue', 'liveFields', null)).toBeNull();
    expect(withSetting(base, 'a-inconnue', 'customFlatSpeedMs', 3)).toBeNull();
  });
});
