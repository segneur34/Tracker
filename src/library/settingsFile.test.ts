import { describe, expect, it } from 'vitest';
import {
  SETTINGS_FORMAT,
  SETTINGS_VERSION,
  buildSettingsFile,
  chooseSettings,
  parseSettingsFile,
  serializeSettingsFile,
} from './settingsFile';

const values = { 'tracker.sportSettings': { thresholds: { wingfoil: 9 } } };

describe('parseSettingsFile', () => {
  it('relit un fichier écrit', () => {
    const file = buildSettingsFile(values, 1234);
    expect(parseSettingsFile(serializeSettingsFile(file))).toEqual(file);
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
    const previous = { format: SETTINGS_FORMAT, version: SETTINGS_VERSION + 1, savedAt: 1, values: { 'tracker.futur': 1 } } as const;
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
