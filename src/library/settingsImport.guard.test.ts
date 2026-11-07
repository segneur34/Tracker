import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ACTIVITIES, readActivities, type Activity } from '../core/activities';
import { readStoredSettings, upgradeStoredActivities, upgradeStoredPresets } from '../hooks/useSportSettings';
import { readRunnerProfile } from '../hooks/useRunnerProfile';
import { jsonStore } from '../platform/storage';
import {
  moduleActivity, readHiddenFamilies, resolveFoil, resolveLiveFields, resolveMarkGuide, resolveSpeedUnit, resolveTabChoices,
  resolveThresholdOverride, resolveTurns, settingsView,
} from '../settings/activitySettings';
import { EMPTY_RUNNER_PROFILE } from './athleteProfile';
import { TRAVELLING_KEYS, adoptedValues, buildSettingsFile, checkedValues, parseSettingsFile, serializeSettingsFile } from './settingsFile';

/**
 * Garde de l'import (fiche 154, risque 3, lot 187) : un fichier de réglages complet, écrit par l'application entière,
 * avec en plus une famille et un calcul que cette version ne connaît pas (« ski »), repris par le chemin de
 * Réglages › Mémoire (`parseSettingsFile`, `adoptedValues`, écriture clé par clé, montées de version). Attendu :
 * rien n'est rejeté en bloc ; ce qui est inconnu est ignoré là où il paraît ; les réglages de voile et de surf et le
 * profil du pratiquant sont retrouvés tels quels.
 */

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

const WING = DEFAULT_ACTIVITIES.find((a) => a.id === 'wingfoil')!;
const SURF = DEFAULT_ACTIVITIES.find((a) => a.id === 'surf')!;
const SURF_FOIL = DEFAULT_ACTIVITIES.find((a) => a.id === 'a-surf-foil')!;
const SKI = { id: 'a-ski', name: 'Ski', base: 'ski', color: '#123456' };
const KITE: Activity = { id: 'a-kite', name: 'Kite', base: 'kite', color: '#2f6fd1' };

const WING_MARK_GUIDE = { curve: [{ distanceM: 40, intervalMs: 200 }, { distanceM: 120, intervalMs: 800 }], vibrate: false };

/** `tracker.sportSettings` de l'application entière, plus le ski partout où une famille ou un calcul se range. */
const fullSportSettings = (): Record<string, unknown> => ({
  sport: 'wingfoil',
  moduleActivity: { voile: 'a-kite', surf: 'a-surf-foil', course: 'a-marche', velo: 'a-vtt', ski: 'a-ski' },
  recordActivity: 'a-ski',
  activities: [...DEFAULT_ACTIVITIES.map((a) => ({ ...a })), KITE, SKI],
  activitiesVersion: 9,
  presetsVersion: 5,
  hiddenFamilies: ['fractionne', 'ski'],
  thresholds: { wingfoil: 9, 'a-kite': 7, surf: 0, 'a-surf-foil': 2, running: 1.5, 'a-ski': 12 },
  speedUnits: { wingfoil: 'kn', 'a-kite': 'kmh', surf: 'kmh', running: 'minkm', 'a-ski': 'kmh' },
  distanceUnits: { wingfoil: 'nm' },
  speedRanges: { wingfoil: { minMs: 4.1, maxMs: 12.3 }, cycling: { minMs: 3, maxMs: 14 }, 'a-ski': { minMs: 2, maxMs: 20 } },
  autoPause: { wingfoil: { speedMs: 0.5, delayS: 45 }, running: { speedMs: 0.2, delayS: 10 } },
  // Un chiffre du direct inconnu (« glisseTotale ») au milieu de chiffres connus.
  liveFields: { wingfoil: ['speed', 'glisseTotale', 'recentTopLong', 'legAverage'], surf: ['speed', 'distance'], running: ['speed', 'gain'] },
  notificationFields: { wingfoil: ['speed', 'distance'] },
  markGuide: { wingfoil: WING_MARK_GUIDE },
  foils: { wingfoil: true, surf: false, 'a-surf-foil': true },
  pumping: { wingfoil: true },
  turns: { surf: false, 'a-surf-foil': true },
  jumps: { wingfoil: { enabled: true, placement: 'taille', minHeightM: 0.4 }, 'a-vtt': { enabled: true, placement: 'poitrine', minHeightM: 0.3 } },
  heartRate: { wingfoil: true, running: true },
  cadence: { running: false },
  bikeTypes: { cycling: 'gravel' },
  bikeWeights: { cycling: 11.5 },
  carriedLoads: { running: 3 },
  energyModels: { 'a-marche': 'marche' },
  hrOffsets: { wingfoil: -6, running: 0 },
  tabs: { wingfoil: { sauts: true, pumping: false }, surf: { rame: false }, running: { sauts: false }, 'a-ski': { piste: true } },
  paceLevels: { running: 'rapide' },
  wayTypes: { cycling: ['route'] },
  gearGroups: { wingfoil: [{ id: 'g1', name: 'Ailes', items: [{ id: 'i1', name: '5 m²' }] }] },
  longPressMs: 1500,
  beepSound: 'grave',
  intervalPresets: [{ id: 's9', name: '10 × 30-30', workout: { reps: 10, workS: 30, restS: 30 } }],
  fitnessTests: { 'fc-max': { warmupS: 600 } },
});

const PROFILE = {
  ...EMPTY_RUNNER_PROFILE, name: 'Léa', weightKg: 62, heightCm: 168, birthYear: 1990, sex: 'f' as const,
  hrMax: 190, hrMaxSource: { kind: 'saisie' as const, atMs: null }, hrRest: 52, hrRestSource: { kind: 'seance' as const, atMs: 1_789_000_000_000 },
};

/**
 * Le chemin de Réglages › Mémoire : fichier écrit, relu, repris clé par clé (`adoptedValues`, qui laisse à l'appareil
 * ses choix retenus : module, activité de l'enregistrement), puis les montées de version du démarrage. `legacy` : le
 * chemin de l'ancien `reglages.json` (`checkedValues`), qui reprend aussi les choix retenus.
 */
const importFile = (sportSettings: Record<string, unknown>, legacy = false) => {
  const text = serializeSettingsFile(buildSettingsFile(
    { 'tracker.sportSettings': sportSettings, 'tracker.runnerProfile': { me: PROFILE } }, 1_790_000_000_000, null, { id: 'autre', name: 'Téléphone entier' }
  ));
  const file = parseSettingsFile(text);
  expect(file).not.toBeNull();
  const values = legacy ? checkedValues(file!.values) : adoptedValues(file!.values, {});
  for (const key of TRAVELLING_KEYS) if (key in values) jsonStore.write(key, values[key]);
  upgradeStoredActivities();
  upgradeStoredPresets();
  return readStoredSettings();
};

describe('import d\'un fichier de réglages complet avec une famille inconnue (garde du lot 187)', () => {
  it('rien n\'est rejeté en bloc : les activités de voile et de surf sont là, le ski est écarté', () => {
    const stored = importFile(fullSportSettings());
    const activities = readActivities(stored.activities);
    expect(activities.map((a) => a.id)).toContain('wingfoil');
    expect(activities.map((a) => a.id)).toContain('a-kite');
    expect(activities.map((a) => a.id)).toContain('surf');
    expect(activities.map((a) => a.id)).toContain('a-surf-foil');
    expect(activities.map((a) => a.id)).not.toContain('a-ski');
    expect(activities.length).toBe(DEFAULT_ACTIVITIES.length + 1);
  });

  it('une famille inconnue dans les familles cachées est ignorée, les autres gardées', () => {
    const stored = importFile(fullSportSettings());
    expect(readHiddenFamilies(stored)).toEqual(['fractionne']);
  });

  it('l\'activité retenue par module : les choix retenus restent ceux de l\'appareil (reprise), ou suivent le fichier (ancien reglages.json), malgré la clé « ski »', () => {
    const adopted = importFile(fullSportSettings());
    expect(adopted.moduleActivity).toBeUndefined();
    expect(moduleActivity(adopted, readActivities(adopted.activities), 'voile').id).toBe('wingfoil');
    const legacy = importFile(fullSportSettings(), true);
    const activities = readActivities(legacy.activities);
    expect(moduleActivity(legacy, activities, 'voile').id).toBe('a-kite');
    expect(moduleActivity(legacy, activities, 'surf').id).toBe('a-surf-foil');
  });

  it('les réglages de voile et de surf sont retrouvés tels quels, le chiffre du direct inconnu écarté', () => {
    const stored = importFile(fullSportSettings());
    expect(resolveThresholdOverride(stored, WING)).toBe(9);
    expect(resolveThresholdOverride(stored, KITE)).toBe(7);
    expect(resolveThresholdOverride(stored, SURF)).toBe(0);
    expect(resolveThresholdOverride(stored, SURF_FOIL)).toBe(2);
    expect(resolveSpeedUnit(stored, WING)).toBe('kn');
    expect(resolveSpeedUnit(stored, KITE)).toBe('kmh');
    expect(resolveFoil(stored, WING)).toBe(true);
    expect(resolveFoil(stored, SURF_FOIL)).toBe(true);
    expect(resolveTurns(stored, SURF)).toBe(false);
    expect(resolveMarkGuide(stored, WING)).toEqual(WING_MARK_GUIDE);
    expect(resolveLiveFields(stored, WING)).toEqual(['speed', 'recentTopLong', 'legAverage']);
    expect(resolveLiveFields(stored, SURF)).toEqual(['speed', 'distance']);
    expect(resolveTabChoices(stored, WING)).toEqual({ sauts: true, pumping: false });
    expect(resolveTabChoices(stored, SURF)).toEqual({ rame: false });
    const view = settingsView(stored, WING);
    expect(view.speedRange).toEqual({ minMs: 4.1, maxMs: 12.3 });
    expect(view.autoPause).toEqual({ speedMs: 0.5, delayS: 45 });
    expect(view.jumps).toEqual({ enabled: true, placement: 'taille', minHeightM: 0.4 });
    expect(view.pumping).toBe(true);
    expect(stored.gearGroups?.wingfoil?.[0]?.items.map((i) => i.name)).toEqual(['5 m²']);
    expect(stored.longPressMs).toBe(1500);
    expect(stored.beepSound).toBe('grave');
  });

  it('le profil du pratiquant est gardé', () => {
    importFile(fullSportSettings());
    expect(readRunnerProfile()).toEqual(PROFILE);
  });

  it('le fichier de la version entière est bien lu entier (garde-fou du test lui-même)', () => {
    const stored = importFile(fullSportSettings());
    // Ce que l'application entière range à terre est encore là : rien n'est filtré à l'import, seulement à la lecture.
    expect(stored.bikeTypes).toEqual({ cycling: 'gravel' });
    expect(stored.intervalPresets).toHaveLength(1);
  });
});
