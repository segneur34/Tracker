import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTIVITIES } from '../core/activities';
import {
  SETTINGS_FORMAT,
  SETTINGS_VERSION,
  adoptedValues,
  buildSettingsFile,
  chooseSettings,
  cleanDeviceName,
  deviceFileName,
  freeDeviceName,
  importedSettingsFileName,
  newestSettingsEntry,
  ownSettingsEntry,
  parseSettingsFile,
  serializeSettingsFile,
  settingsActivityCount,
  settingsEntryKey,
  settingsEntryName,
  settingsSignature,
  unseenSettingsEntries,
  type SettingsEntry,
} from './settingsFile';

const values = { 'tracker.sportSettings': { thresholds: { wingfoil: 9 } } };

describe('parseSettingsFile', () => {
  it('relit un fichier écrit, avec son appareil', () => {
    const file = buildSettingsFile(values, 1234, null, { id: 'abc', name: 'Téléphone' });
    expect(parseSettingsFile(serializeSettingsFile(file))).toEqual(file);
    expect(file.version).toBe(2);
  });

  it("relit l'ancien reglages.json (version 1), sans appareil", () => {
    const old = JSON.stringify({ format: SETTINGS_FORMAT, version: 1, savedAt: 5, values });
    expect(parseSettingsFile(old)).toEqual({ format: SETTINGS_FORMAT, version: 1, savedAt: 5, device: null, values });
  });

  it('écarte un appareil abîmé, et nettoie son nom', () => {
    const read = (device: unknown) => parseSettingsFile(JSON.stringify({ format: SETTINGS_FORMAT, version: 2, savedAt: 5, device, values }))?.device;
    expect(read({ id: '', name: 'PC' })).toBeNull();
    expect(read({ id: 'x', name: '   ' })).toBeNull();
    expect(read('PC')).toBeNull();
    expect(read({ id: 'x', name: '  PC   du   bureau ' })).toEqual({ id: 'x', name: 'PC du bureau' });
  });

  it('rend `null` pour un fichier absent, illisible ou d\'un autre format', () => {
    expect(parseSettingsFile(null)).toBeNull();
    expect(parseSettingsFile('{')).toBeNull();
    expect(parseSettingsFile(JSON.stringify({ format: 'autre', version: 1, savedAt: 1, values: {} }))).toBeNull();
    expect(parseSettingsFile(JSON.stringify({ format: SETTINGS_FORMAT, version: 1, values: {} }))).toBeNull();
  });
});

describe('buildSettingsFile', () => {
  it('garde les clés et la version d\'un fichier écrit par une version plus récente', () => {
    const previous = { format: SETTINGS_FORMAT, version: SETTINGS_VERSION + 1, savedAt: 1, device: null, values: { 'tracker.futur': 1 } } as const;
    const file = buildSettingsFile(values, 2, previous);
    expect(file.values).toEqual({ 'tracker.futur': 1, ...values });
    expect(file.version).toBe(SETTINGS_VERSION + 1);
  });
});

describe('chooseSettings', () => {
  const folder = buildSettingsFile(values, 1000);

  it('reprend le dossier sur un appareil sans réglage daté', () => {
    expect(chooseSettings(null, folder)).toBe('folder');
  });

  it('retient le plus récent des deux', () => {
    expect(chooseSettings(500, folder)).toBe('folder');
    expect(chooseSettings(2000, folder)).toBe('local');
    expect(chooseSettings(1000, folder)).toBe('same');
  });

  it('écrit les réglages de l\'appareil dans un dossier qui n\'en a pas', () => {
    expect(chooseSettings(null, null)).toBe('local');
    expect(chooseSettings(1000, null)).toBe('local');
  });
});

describe('settingsSignature', () => {
  const settings = {
    activities: [{ id: 'voile' }],
    moduleActivity: { voile: 'wingfoil' },
    recordActivity: 'voile',
    thresholds: { wingfoil: 9 },
  };
  const signature = settingsSignature({ 'tracker.sportSettings': settings, 'tracker.runnerProfile': { me: { weightKg: 70 } } });

  it('ignore les choix retenus : activité du module, ancienne clé du support, activité à enregistrer, dernière séance du compteur', () => {
    const reopened = {
      ...settings, moduleActivity: { voile: 'kite', course: 'course' }, recordActivity: 'course', sport: 'kite',
      lastIntervalWorkout: { reps: 8, workS: 30, restS: 30 },
    };
    expect(settingsSignature({ 'tracker.sportSettings': reopened, 'tracker.runnerProfile': { me: { weightKg: 70 } } })).toBe(signature);
  });

  it('change avec un vrai réglage, de support, de coureur ou une séance gardée', () => {
    const changed = { ...settings, thresholds: { wingfoil: 10 } };
    expect(settingsSignature({ 'tracker.sportSettings': changed, 'tracker.runnerProfile': { me: { weightKg: 70 } } })).not.toBe(signature);
    const preset = { ...settings, intervalPresets: [{ id: 's1', name: 'Pyramide', workout: { reps: 8, workS: 30, restS: 30 } }] };
    expect(settingsSignature({ 'tracker.sportSettings': preset, 'tracker.runnerProfile': { me: { weightKg: 70 } } })).not.toBe(signature);
    expect(settingsSignature({ 'tracker.sportSettings': settings, 'tracker.runnerProfile': { me: { weightKg: 71 } } })).not.toBe(signature);
  });

  it('tient un appareil sans réglage de support', () => {
    expect(settingsSignature({})).toBe('{}');
  });
});

describe('appareils et noms de fichier', () => {
  it("tire le nom du fichier du nom de l'appareil", () => {
    expect(deviceFileName('Téléphone')).toBe('telephone.json');
    expect(deviceFileName('PC')).toBe('pc.json');
    expect(deviceFileName('Téléphone de Léa (bœuf)')).toBe('telephone-de-lea-boeuf.json');
    expect(deviceFileName('!!!')).toBe('appareil.json');
  });

  it('nettoie un nom saisi', () => {
    expect(cleanDeviceName('  Mon   PC ')).toBe('Mon PC');
    expect(cleanDeviceName('x'.repeat(60))).toHaveLength(40);
  });

  it('donne un nom libre quand un autre appareil porte déjà le sien', () => {
    expect(freeDeviceName('Téléphone', new Set(['pc.json']))).toBe('Téléphone');
    expect(freeDeviceName('Téléphone', new Set(['telephone.json']))).toBe('Téléphone 2');
    expect(freeDeviceName('Téléphone', new Set(['telephone.json', 'telephone-2.json']))).toBe('Téléphone 3');
  });

  const entry = (fileName: string, savedAt: number, device: { id: string; name: string } | null): SettingsEntry =>
    ({ fileName, file: buildSettingsFile(values, savedAt, null, device) });
  const phone = entry('telephone.json', 3000, { id: 'tel', name: 'Téléphone' });
  const pc = entry('pc.json', 2000, { id: 'pc', name: 'PC' });
  const friend = entry('lea.json', 4000, null);

  it("retrouve le fichier de l'appareil à son identifiant, pas à son nom", () => {
    expect(ownSettingsEntry([phone, pc, friend], 'pc')).toBe(pc);
    const sameName = entry('telephone.json', 1000, { id: 'autre', name: 'Téléphone' });
    expect(ownSettingsEntry([sameName], 'tel')).toBeNull();
  });

  it('désigne le plus récent, pour un appareil neuf', () => {
    expect(newestSettingsEntry([phone, pc, friend])).toBe(friend);
    expect(newestSettingsEntry([])).toBeNull();
  });

  it('nomme un fichier par son appareil, sinon par son nom de fichier', () => {
    expect(settingsEntryName(phone)).toBe('Téléphone');
    expect(settingsEntryName(friend)).toBe('lea');
  });

  it("compte les activités, celles du premier lancement sans liste rangée", () => {
    expect(settingsActivityCount(phone.file)).toBe(DEFAULT_ACTIVITIES.length);
    const two = buildSettingsFile({ 'tracker.sportSettings': { activities: DEFAULT_ACTIVITIES.slice(0, 2) } }, 1);
    expect(settingsActivityCount(two)).toBe(2);
  });

  it("reconnaît un fichier à son appareil, même renommé, sinon à son nom de fichier", () => {
    const renamed = entry('telephone-de-lea.json', 5000, { id: 'tel', name: 'Téléphone de Léa' });
    expect(settingsEntryKey(renamed)).toBe(settingsEntryKey(phone));
    expect(settingsEntryKey(friend)).toBe(settingsEntryKey(entry('LEA.json', 1, null)));
    expect(settingsEntryKey(friend)).not.toBe(settingsEntryKey(pc));
  });

  it("propose les fichiers des autres appareils jamais vus, le plus récent en tête", () => {
    const seen = new Set([settingsEntryKey(pc)]);
    expect(unseenSettingsEntries([pc, phone, friend], seen, 'pc')).toEqual([friend, phone]);
    expect(unseenSettingsEntries([pc, phone, friend], new Set([settingsEntryKey(phone), settingsEntryKey(friend)]), 'pc')).toEqual([]);
  });

  it("ne propose jamais le fichier de l'appareil, même jamais vu", () => {
    expect(unseenSettingsEntries([pc], new Set(), 'pc')).toEqual([]);
  });

  it('tient pour vus tous les fichiers la première fois', () => {
    expect(unseenSettingsEntries([pc, phone, friend], null, 'pc')).toEqual([]);
  });

  it("range un fichier importé sous le nom de son appareil, sans écraser celui d'un autre", () => {
    const tablet = buildSettingsFile(values, 6000, null, { id: 'tab', name: 'Tablette' });
    expect(importedSettingsFileName(tablet, 'n-importe.json', [pc, phone], new Set(['pc.json', 'telephone.json']))).toBe('tablette.json');
    const otherPhone = buildSettingsFile(values, 6000, null, { id: 'tel-2', name: 'Téléphone' });
    expect(importedSettingsFileName(otherPhone, 'telephone.json', [pc, phone], new Set(['pc.json', 'telephone.json']))).toBe('telephone-2.json');
  });

  it("remplace le fichier du même appareil, même rangé sous un autre nom", () => {
    const newerPhone = buildSettingsFile(values, 9000, null, { id: 'tel', name: 'Téléphone de Léa' });
    expect(importedSettingsFileName(newerPhone, 'x.json', [pc, phone], new Set(['pc.json', 'telephone.json']))).toBe('telephone.json');
  });

  it("nomme un fichier sans appareil d'après le fichier choisi", () => {
    const old = buildSettingsFile(values, 1000);
    expect(importedSettingsFileName(old, 'Réglages Léa.json', [], new Set())).toBe('reglages-lea.json');
    expect(importedSettingsFileName(old, 'reglages-lea.JSON', [], new Set(['reglages-lea.json']))).toBe('reglages-lea-2.json');
  });
});

describe('adoptedValues', () => {
  it("prend les réglages de l'autre appareil, mais garde les choix retenus de celui-ci", () => {
    const theirs = {
      'tracker.sportSettings': { thresholds: { wingfoil: 12 }, recordActivity: 'a-trail', moduleActivity: { voile: 'a-kite' }, intervalPresets: [1] },
      'tracker.runnerProfile': { me: { weightKg: 80 } },
    };
    const mine = {
      'tracker.sportSettings': { thresholds: { wingfoil: 9 }, recordActivity: 'wingfoil', lastIntervalWorkout: { reps: 4, workS: 60, restS: 60 } },
    };
    expect(adoptedValues(theirs, mine)).toEqual({
      'tracker.sportSettings': {
        thresholds: { wingfoil: 12 }, intervalPresets: [1], recordActivity: 'wingfoil', lastIntervalWorkout: { reps: 4, workS: 60, restS: 60 },
      },
      'tracker.runnerProfile': { me: { weightKg: 80 } },
    });
  });

  it('rend tel quel un fichier sans réglage de support', () => {
    const theirs = { 'tracker.runnerProfile': { me: { weightKg: 80 } } };
    expect(adoptedValues(theirs, { 'tracker.sportSettings': { recordActivity: 'x' } })).toBe(theirs);
  });
});
