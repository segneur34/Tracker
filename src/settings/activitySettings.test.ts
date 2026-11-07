import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTIVITIES, type Activity } from '../core/activities';
import { analysisTabs, isTabShown, toggleTabChoice } from '../core/analysisTabs';
import { getSportProfile, hasActiveThreshold, TERRAIN_STEP_CHOICES_M } from '../core/sportProfiles';
import { isValidGradeRange } from '../land/grade';
import { knotsToMs } from '../core/units';
import { DEFAULT_PACE_LEVEL } from '../planning/duration';
import { WAY_TYPES } from '../planning/brouterProfile';
import { BIKE_TYPES } from '../cycling/energy';
import {
  PER_ACTIVITY_KEYS, PRESETS_VERSION, TREATMENT_UNITS, defaultAutoPauseOf, defaultBikeKg, defaultBikeType, defaultGradeRange, defaultHeartRateOf,
  defaultHrOffsetOf, defaultLiveFieldsFor, defaultMarkGuideOf, defaultNotificationFieldsFor, defaultPaceOf, defaultSpeedRangeOf, defaultSpeedUnitOf,
  defaultEnergyModelOf, defaultTerrainStepOf, defaultThresholdOf, isActivityOverridden, isValidAutoPause, nextBoundPair, nextSpeedRange, rangeFollowsPace, resetOverrides, resetStoredPresets, resolveJumps, resolveRecordingProfile, resolveThresholdOverride, resolveTurns, defaultTurnsOf,
  SETTING_FIELDS, defaultTabsOf, effectiveHrZoneLines, settingsView, tabsAfterJumpsChange, thresholdFollowsPace, withSetting, type StoredSettings,
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
    expect(PRESETS_VERSION).toBe(5);
  });

  it('efface une fois la case des sauts du kite et du VTT (version 3 → 4), garde celle des autres', () => {
    const kiteCree = { id: 'a-kite', name: 'Kite', base: 'kite' as const, color: '#5b87f2' };
    const off = { enabled: false, placement: 'poitrine' as const, minHeightM: 1 };
    const stored: StoredSettings = {
      activities: [...DEFAULT_ACTIVITIES, kiteCree],
      presetsVersion: 3,
      jumps: { kite: off, [kiteCree.id]: off, 'a-vtt': off, cycling: off, wingfoil: off },
      thresholds: { kite: 12 },
    };
    const next = resetStoredPresets(stored);
    expect(next.jumps).toEqual({ cycling: off, wingfoil: off });
    expect(next.thresholds).toBe(stored.thresholds);
  });
});

describe('sauts mesurés par défaut (05/11)', () => {
  it('cochés en voile et au VTT, décochés ailleurs ; ni bateau ni surf', () => {
    const byId = (id: string) => DEFAULT_ACTIVITIES.find((a) => a.id === id)!;
    const kiteCree = { id: 'a-kite', name: 'Kite', base: 'kite' as const, color: '#5b87f2' };
    expect(resolveJumps({}, byId('wingfoil'))?.enabled).toBe(true);
    expect(resolveJumps({}, kiteCree)).toEqual({ enabled: true, placement: 'poitrine', minHeightM: 1 });
    expect(resolveJumps({}, byId('a-vtt'))?.enabled).toBe(true);
    for (const id of ['running', 'a-marche', 'cycling', 'a-gravel']) expect(resolveJumps({}, byId(id))?.enabled).toBe(false);
    expect(resolveJumps({}, { id: 'a-voilier', name: 'Voilier', base: 'bateau', color: '#014e86' })).toBeNull();
    expect(resolveJumps({}, byId('surf'))).toBeNull();
    // Le réglage enregistré prime.
    expect(resolveJumps({ jumps: { 'a-vtt': { enabled: false, placement: 'taille', minHeightM: 0.5 } } }, byId('a-vtt'))?.enabled).toBe(false);
  });
});

describe('virages mesurés par le gyroscope (lot 40)', () => {
  const byId = (id: string) => DEFAULT_ACTIVITIES.find((a) => a.id === id)!;
  const paddle = { id: 'a-paddle', name: 'Paddle', base: 'surf' as const, color: '#8292a6' };

  it('cochés pour Surf et Surf foil, décochés pour une activité créée en surf, absents hors surf', () => {
    expect(resolveTurns({}, byId('surf'))).toBe(true);
    expect(resolveTurns({}, byId('a-surf-foil'))).toBe(true);
    expect(resolveTurns({}, paddle)).toBe(false);
    for (const id of ['wingfoil', 'running', 'cycling', 'a-vtt']) expect(resolveTurns({}, byId(id))).toBeNull();
    expect(settingsView({}, byId('wingfoil')).turns).toBeNull();
  });

  it("le réglage rangé prime, et seul l'écart au défaut est rangé", () => {
    const surf = byId('surf');
    expect(defaultTurnsOf(surf)).toBe(true);
    const off = withSetting({}, surf.id, 'turns', false)!;
    expect(off.turns).toEqual({ surf: false });
    expect(resolveTurns(off, surf)).toBe(false);
    expect(settingsView(off, surf).isTurnsOverridden).toBe(true);
    expect(withSetting(off, surf.id, 'turns', true)!.turns).toEqual({});
    expect(withSetting({}, paddle.id, 'turns', true)).toBeNull(); // activité inconnue des réglages : refusée
    expect(withSetting({ activities: [paddle] } as StoredSettings, paddle.id, 'turns', true)!.turns).toEqual({ 'a-paddle': true });
    expect(withSetting({}, 'wingfoil', 'turns', true)).toBeNull();
    expect(settingsView({}, surf).isTurnsOverridden).toBe(false);
  });
});

describe('onglets à pré-réglage et case « Sauts » (n° 174)', () => {
  const byId = (id: string) => DEFAULT_ACTIVITIES.find((a) => a.id === id)!;
  const run = byId('running');
  const vtt = byId('a-vtt');
  const route = byId('cycling');
  const tabOf = (activity: Activity, key: string) => analysisTabs(getSportProfile(activity.base)).find((t) => t.key === key)!;
  /** Un toucher sur le bouton d'un onglet, tel que le fait Réglages : relit la vue, écrit le choix. */
  const touch = (stored: StoredSettings, activity: Activity, key: string): StoredSettings =>
    withSetting(stored, activity.id, 'tabs', toggleTabChoice(settingsView(stored, activity).tabs, tabOf(activity, key), defaultTabsOf(activity)))!;
  const shown = (stored: StoredSettings, activity: Activity, key: string) => isTabShown(tabOf(activity, key), settingsView(stored, activity).tabs);
  /** La case telle que la coche Réglages : réglages des sauts, puis onglets s'il y a lieu. */
  const setCase = (stored: StoredSettings, activity: Activity, enabled: boolean): StoredSettings => {
    const view = settingsView(stored, activity);
    const next = { ...view.jumps!, enabled };
    const tabs = tabsAfterJumpsChange(view, next);
    const written = withSetting(stored, activity.id, 'jumps', next)!;
    return tabs === undefined ? written : withSetting(written, activity.id, 'tabs', tabs)!;
  };

  it('Course et VTT : un onglet caché par le pré-réglage répond au premier toucher, aller-retour, et la marque « défaut » suit', () => {
    for (const [activity, key] of [[run, 'sauts'], [vtt, 'tops']] as const) {
      expect(shown({}, activity, key)).toBe(false);
      expect(settingsView({}, activity).isTabsOverridden).toBe(false);
      const once = touch({}, activity, key);
      expect(shown(once, activity, key)).toBe(true);
      expect(settingsView(once, activity).isTabsOverridden).toBe(true);
      expect(isActivityOverridden(settingsView(once, activity))).toBe(true);
      const twice = touch(once, activity, key);
      expect(shown(twice, activity, key)).toBe(false);
      expect(settingsView(twice, activity).isTabsOverridden).toBe(false);
      expect(isActivityOverridden(settingsView(twice, activity))).toBe(false);
    }
  });

  it('un autre onglet changé puis remis rend la marque « défaut » et laisse l\'onglet du pré-réglage caché', () => {
    const back = touch(touch({}, run, 'cardio'), run, 'cardio');
    expect(settingsView(back, run).isTabsOverridden).toBe(false);
    expect(shown(back, run, 'sauts')).toBe(false);
  });

  it('un pré-réglage d\'onglets s\'écarte toujours du défaut du module (`toggleTabChoice`)', () => {
    for (const activity of DEFAULT_ACTIVITIES) {
      for (const [key, value] of Object.entries(defaultTabsOf(activity) ?? {})) {
        expect(isTabShown(tabOf(activity, key), null), `${activity.id} ${key}`).toBe(!value);
      }
    }
    expect(defaultTabsOf(run)).toEqual({ sauts: false });
    expect(defaultTabsOf(vtt)).toEqual({ tops: false });
    // Q61, 06/11 : décoché de base partout à terre, sauf au VTT, qui mesure les sauts d\'office.
    for (const activity of [byId('a-marche'), byId('a-gravel'), route]) expect(defaultTabsOf(activity), activity.id).toEqual({ sauts: false });
  });

  it('Course : cocher la case montre l\'onglet, en écrivant le choix en clair', () => {
    const view = settingsView({}, run);
    expect(view.jumps?.enabled).toBe(false);
    expect(tabsAfterJumpsChange(view, { ...view.jumps!, enabled: true })).toEqual({ sauts: true });
    const checked = setCase({}, run, true);
    expect(shown(checked, run, 'sauts')).toBe(true);
    expect(settingsView(checked, run).jumps?.enabled).toBe(true);
    expect(settingsView(checked, run).isTabsOverridden).toBe(true);
  });

  it('Marche, Route, Gravel : cocher la case montre l\'onglet', () => {
    for (const activity of [byId('a-marche'), route, byId('a-gravel')]) {
      const view = settingsView({ jumps: { [activity.id]: { enabled: false, placement: 'poitrine', minHeightM: 0.5 } } }, activity);
      expect(shown({}, activity, 'sauts'), activity.id).toBe(false);
      expect(tabsAfterJumpsChange(view, { ...view.jumps!, enabled: true }), activity.id).toEqual({ sauts: true });
    }
  });

  it('une mise à jour décoche « sauts » dans les choix rangés, sans rien effacer d\'autre', () => {
    const marche = byId('a-marche');
    const gravel = byId('a-gravel');
    const stored: StoredSettings = {
      presetsVersion: 4,
      tabs: { [marche.id]: { tops: true }, [route.id]: { sauts: true }, [vtt.id]: { cardio: false }, [gravel.id]: { tops: true } },
      jumps: { [gravel.id]: { enabled: true, placement: 'poitrine', minHeightM: 0.5 } },
    };
    expect(resetStoredPresets(stored).tabs).toEqual({
      // Sans choix sur « sauts » : décoché ; choix déjà fait, VTT et case cochée : gardés.
      [marche.id]: { tops: true, sauts: false }, [route.id]: { sauts: true }, [vtt.id]: { cardio: false }, [gravel.id]: { tops: true },
    });
    const written = { ...stored, presetsVersion: PRESETS_VERSION };
    expect(resetStoredPresets(written)).toBe(written);
  });

  it('rien à écrire si l\'onglet est déjà montré : VTT, Voile', () => {
    for (const activity of [vtt, byId('wingfoil')]) {
      const view = settingsView({ jumps: { [activity.id]: { enabled: false, placement: 'poitrine', minHeightM: 0.5 } } }, activity);
      expect(tabsAfterJumpsChange(view, { ...view.jumps!, enabled: true }), activity.id).toBeUndefined();
    }
  });

  it('seul le passage de décochée à cochée compte : décocher et changer une sous-option n\'écrivent rien', () => {
    const checked = settingsView(setCase({}, run, true), run);
    expect(tabsAfterJumpsChange(checked, { ...checked.jumps!, enabled: false })).toBeUndefined();
    expect(tabsAfterJumpsChange(checked, { ...checked.jumps!, placement: 'bras' })).toBeUndefined();
    const unchecked = settingsView({}, run);
    expect(tabsAfterJumpsChange(unchecked, { ...unchecked.jumps!, placement: 'bras' })).toBeUndefined();
  });

  it('un calcul sans sauts n\'écrit rien', () => {
    const view = settingsView({}, byId('surf'));
    expect(view.jumps).toBeNull();
    expect(tabsAfterJumpsChange(view, { enabled: true, placement: 'poitrine', minHeightM: 0.5 })).toBeUndefined();
  });

  it('décocher garde le choix ; l\'onglet se décoche seul, la case cochée ; recocher la case le remontre', () => {
    const on = setCase({}, run, true);
    const off = setCase(on, run, false);
    expect(settingsView(off, run).tabs).toEqual({ sauts: true });
    expect(settingsView(off, run).jumps?.enabled).toBe(false);
    const alone = touch(on, run, 'sauts');
    expect(shown(alone, run, 'sauts')).toBe(false);
    expect(settingsView(alone, run).jumps?.enabled).toBe(true);
    expect(shown(setCase(setCase(alone, run, false), run, true), run, 'sauts')).toBe(true);
  });

  it('un choix rangé sans pré-réglage qui cache l\'onglet s\'efface en le montrant', () => {
    const wing = byId('wingfoil');
    const stored: StoredSettings = { tabs: { [wing.id]: { sauts: false } }, jumps: { [wing.id]: { enabled: false, placement: 'poitrine', minHeightM: 0.5 } } };
    const next = setCase(stored, wing, true);
    expect(shown(next, wing, 'sauts')).toBe(true);
    expect(settingsView(next, wing).isTabsOverridden).toBe(false);
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
  const surf = find('surf');
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
    turns: { activity: surf, value: false },
    jumps: { activity: wing, value: getSportProfile('wingfoil').jumps },
    heartRate: { activity: run, value: !defaultHeartRateOf(run) },
    cadence: { activity: run, value: false },
    hrZoneLines: { activity: run, value: true },
  };

  it('couvre chaque table rangée par activité, le matériel enregistré excepté', () => {
    expect([...PER_ACTIVITY_KEYS].filter((k) => k !== 'gearGroups').sort()).toEqual(Object.keys(SAMPLES).sort());
  });

  it('est faux sans aucun réglage', () => {
    for (const activity of [wing, run, bike, surf]) expect(isActivityOverridden(settingsView({}, activity))).toBe(false);
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

describe('réglages abîmés relus avec contrôle (lot 117)', () => {
  const run = DEFAULT_ACTIVITIES.find((a) => a.id === 'running')!;
  const wrong = (v: unknown) => v as never;

  it("un seuil abîmé retombe sur le pré-réglage, un seuil sain est gardé", () => {
    const preset = resolveThresholdOverride({}, run);
    for (const bad of [Number.NaN, Infinity, -2, '5', null, {}]) {
      expect(resolveThresholdOverride({ thresholds: { [run.id]: wrong(bad) } }, run)).toBe(preset);
    }
    expect(resolveThresholdOverride({ thresholds: { [run.id]: 4.5 } }, run)).toBe(4.5);
  });

  it("une pause automatique incomplète ou abîmée retombe sur le pré-réglage au lieu de couper la pause", () => {
    const fallback = resolveRecordingProfile({}, run);
    const def = defaultAutoPauseOf(run);
    expect(fallback.autoPauseSpeedMs).toBe(def.speedMs);
    for (const bad of [{}, { speedMs: 0.5 }, { delayS: 10 }, { speedMs: Number.NaN, delayS: 10 }, { speedMs: 0.5, delayS: -1 }, { speedMs: '1', delayS: 3 }, 'x', null, 7]) {
      const got = resolveRecordingProfile({ autoPause: { [run.id]: wrong(bad) } }, run);
      expect(got.autoPauseSpeedMs).toBe(def.speedMs);
      expect(got.autoPauseDelayS).toBe(def.delayS);
    }
    const ok = resolveRecordingProfile({ autoPause: { [run.id]: { speedMs: 0.7, delayS: 12 } } }, run);
    expect(ok.autoPauseSpeedMs).toBe(0.7);
    expect(ok.autoPauseDelayS).toBe(12);
  });

  it("la vue des réglages ne montre pas une surcharge abîmée comme réglée", () => {
    const view = settingsView({ thresholds: { [run.id]: wrong(Number.NaN) }, autoPause: { [run.id]: wrong({}) } }, run);
    expect(view.isThresholdOverridden).toBe(false);
    expect(view.isAutoPauseOverridden).toBe(false);
  });
});

describe("paire de bornes de Réglages : un champ vidé n'efface que sa borne", () => {
  const fallback = { minMs: 5, maxMs: 30 };

  it('12-30, on efface 30, on retape 35 : 12-35 ; le 12 survit à chaque frappe', () => {
    let range: typeof fallback | null = { minMs: 12, maxMs: 30 };
    range = nextSpeedRange(range, 'maxMs', null, fallback);
    expect(range).toEqual({ minMs: 12, maxMs: 30 });
    // « 3 », première frappe de « 35 », passe sous 12 : refusé, rien n'est perdu.
    range = nextSpeedRange(range, 'maxMs', 3, fallback);
    expect(range).toEqual({ minMs: 12, maxMs: 30 });
    range = nextSpeedRange(range, 'maxMs', 35, fallback);
    expect(range).toEqual({ minMs: 12, maxMs: 35 });
  });

  it("la borne vidée reprend son défaut, l'autre reste", () => {
    expect(nextSpeedRange({ minMs: 12, maxMs: 40 }, 'maxMs', null, fallback)).toEqual({ minMs: 12, maxMs: 30 });
    expect(nextSpeedRange({ minMs: 12, maxMs: 40 }, 'minMs', null, fallback)).toEqual({ minMs: 5, maxMs: 40 });
  });

  it('les deux bornes vidées : plus de réglage', () => {
    const once = nextSpeedRange({ minMs: 12, maxMs: 40 }, 'maxMs', null, fallback);
    expect(nextSpeedRange(once, 'minMs', null, fallback)).toBeNull();
  });

  it('rendre la paire au défaut en la vidant efface le réglage ; le taper le garde', () => {
    expect(nextSpeedRange({ minMs: 12, maxMs: 30 }, 'minMs', null, fallback)).toBeNull();
    expect(nextSpeedRange({ minMs: 12, maxMs: 30 }, 'minMs', 5, fallback)).toEqual(fallback);
  });

  it('sans réglage, vider ne fige rien et une saisie part du défaut', () => {
    expect(nextSpeedRange(null, 'maxMs', null, fallback)).toBeNull();
    expect(nextSpeedRange(null, 'minMs', 12, fallback)).toEqual({ minMs: 12, maxMs: 30 });
  });

  it('une paire invalide laisse la valeur rangée telle quelle, le même objet', () => {
    const current = { minMs: 35, maxMs: 50 };
    // Le défaut 30 passerait sous le min de 35.
    expect(nextSpeedRange(current, 'maxMs', null, fallback)).toBe(current);
    expect(nextSpeedRange(current, 'maxMs', 20, fallback)).toBe(current);
    expect(nextSpeedRange(current, 'minMs', -1, fallback)).toBe(current);
    expect(nextSpeedRange(null, 'minMs', 40, fallback)).toBeNull();
  });

  it('pente : mêmes règles, avec ses bornes', () => {
    const grades = { min: 0.02, max: 0.2 };
    expect(nextBoundPair({ min: 0.05, max: 0.3 }, 'max', null, grades, isValidGradeRange)).toEqual({ min: 0.05, max: 0.2 });
    expect(nextBoundPair({ min: 0.05, max: 0.2 }, 'min', null, grades, isValidGradeRange)).toBeNull();
    expect(nextBoundPair(null, 'max', 0.1, grades, isValidGradeRange)).toEqual({ min: 0.02, max: 0.1 });
    expect(nextBoundPair({ min: 0.05, max: 0.3 }, 'max', 0.01, grades, isValidGradeRange)).toEqual({ min: 0.05, max: 0.3 });
  });

  it('pause automatique : vider le délai garde la vitesse ; 0 km/h reste permis', () => {
    const pause = { speedMs: 1, delayS: 10 };
    expect(nextBoundPair({ speedMs: 2, delayS: 60 }, 'delayS', null, pause, isValidAutoPause)).toEqual({ speedMs: 2, delayS: 10 });
    expect(nextBoundPair({ speedMs: 2, delayS: 10 }, 'speedMs', null, pause, isValidAutoPause)).toBeNull();
    expect(nextBoundPair(null, 'speedMs', 0, pause, isValidAutoPause)).toEqual({ speedMs: 0, delayS: 10 });
    expect(nextBoundPair({ speedMs: 2, delayS: 60 }, 'delayS', -5, pause, isValidAutoPause)).toEqual({ speedMs: 2, delayS: 60 });
  });

  it("une paire rendue est toujours acceptée par le rangement et par la lecture, jamais à une seule borne", () => {
    const run = DEFAULT_ACTIVITIES.find((a) => a.base === 'running')!;
    const stored = withSetting({}, run.id, 'speedRange', nextSpeedRange(null, 'minMs', 1, defaultSpeedRangeOf(run)));
    expect(settingsView(stored!, run).speedRange).toEqual({ minMs: 1, maxMs: defaultSpeedRangeOf(run).maxMs });
  });
});

describe('limites des zones sur la courbe de FC (case « Zones », 05/11)', () => {
  const run = DEFAULT_ACTIVITIES.find((a) => a.id === 'running')!;
  const bike = DEFAULT_ACTIVITIES.find((a) => a.id === 'cycling')!;

  it('décochées par défaut', () => {
    expect(effectiveHrZoneLines({}, run)).toBe(false);
    expect(settingsView({}, run).hrZoneLines).toBe(false);
  });

  it('cochées pour une activité seulement, « non » effacé', () => {
    const on = withSetting({}, run.id, 'hrZoneLines', true)!;
    expect(on.hrZoneLines).toEqual({ [run.id]: true });
    expect(effectiveHrZoneLines(on, run)).toBe(true);
    expect(effectiveHrZoneLines(on, bike)).toBe(false);
    expect(withSetting(on, run.id, 'hrZoneLines', false)!.hrZoneLines).toEqual({});
  });

  it('une valeur relue d’un fichier qui n’est pas « oui » vaut non ; une valeur absurde n’est pas écrite', () => {
    expect(effectiveHrZoneLines({ hrZoneLines: { [run.id]: 'oui' as unknown as boolean } }, run)).toBe(false);
    expect(withSetting({}, run.id, 'hrZoneLines', 1 as unknown as boolean)).toBeNull();
  });
});
