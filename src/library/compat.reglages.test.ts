import { describe, expect, it } from 'vitest';
import { buildSettingsFile, parseSettingsFile, serializeSettingsFile } from './settingsFile';
import { ACTIVITIES_VERSION } from '../core/activities';
import { PRESETS_VERSION, resetStoredPresets, withSetting, withVisibility } from '../settings/activitySettings';
import { readStoredSettings, updateStoredSettings, upgradeStoredPresets } from '../hooks/useSportSettings';
import { jsonStore } from '../platform/storage';

const file = (over: Record<string, unknown> = {}) => JSON.stringify({
  format: 'tracker-reglages', version: 2, savedAt: 1790000000000, device: { id: 'abc', name: 'Téléphone' },
  values: { 'tracker.sportSettings': { thresholds: { wingfoil: 9 } } }, ...over,
});

describe('réglages, compatibilité (a) version future', () => {
  it('version 7 : lue comme une autre, et la réécriture garde 7', () => {
    const read = parseSettingsFile(file({ version: 7, values: { 'tracker.sportSettings': {}, 'tracker.futur': { x: 1 } } }));
    expect(read?.version).toBe(7);
    const written = buildSettingsFile({ 'tracker.sportSettings': { ancien: true } }, 1, read, { id: 'abc', name: 'T' });
    expect(written.version).toBe(7);
    expect(written.values['tracker.futur']).toEqual({ x: 1 });
  });
});

describe('réglages, compatibilité (b) champs mal typés', () => {
  it('savedAt en texte : fichier ignoré ; values tableau : ignoré ; device mal formé : null', () => {
    expect(parseSettingsFile(file({ savedAt: '1790000000000' }))).toBeNull();
    expect(parseSettingsFile(file({ values: [] }))).toBeNull();
    expect(parseSettingsFile(file({ device: { id: 3, name: 'x' } }))?.device).toBeNull();
  });
  it('valeur de tracker.sportSettings d\'une autre forme : acceptée sans contrôle par parseSettingsFile', () => {
    expect(parseSettingsFile(file({ values: { 'tracker.sportSettings': 'texte' } }))?.values['tracker.sportSettings']).toBe('texte');
  });
});

describe('réglages, compatibilité (c) __proto__', () => {
  it('pas de pollution', () => {
    const text = '{"format":"tracker-reglages","version":2,"savedAt":1,"device":null,"values":{"__proto__":{"pollue":true},"tracker.sportSettings":{}}}';
    const read = parseSettingsFile(text)!;
    expect(({} as Record<string, unknown>).pollue).toBeUndefined();
    const again = parseSettingsFile(serializeSettingsFile(buildSettingsFile({}, 2, read, null)))!;
    expect(Object.prototype.hasOwnProperty.call(again.values, '__proto__')).toBe(true);
  });
});

describe('réglages, compatibilité : BOM, CRLF', () => {
  it('BOM : retiré ; CRLF : lu', () => {
    expect(parseSettingsFile('﻿' + file())).not.toBeNull();
    expect(parseSettingsFile(serializeSettingsFile(parseSettingsFile(file())!).replace(/\n/g, '\r\n'))).not.toBeNull();
  });
});

describe('réglages : deux écritures de suite (n° 174, case « Sauts » puis onglet)', () => {
  it('la seconde relit la première au lieu de l\'écraser', () => {
    jsonStore.write('tracker.sportSettings', {});
    const jumps = { enabled: true, placement: 'poitrine' as const, minHeightM: 0.3 };
    updateStoredSettings((s) => withSetting(s, 'running', 'jumps', jumps));
    updateStoredSettings((s) => withSetting(s, 'running', 'tabs', { sauts: true }));
    expect(readStoredSettings().jumps).toEqual({ running: jumps });
    expect(readStoredSettings().tabs).toEqual({ running: { sauts: true } });
  });
});

describe('réglages, compatibilité : numéros de version jamais rabaissés (lot 148, C5-5)', () => {
  it('une écriture garde le numéro de pré-réglages le plus haut, le sien ou celui lu', () => {
    jsonStore.write('tracker.sportSettings', { presetsVersion: PRESETS_VERSION + 1, thresholds: { wingfoil: 9 } });
    updateStoredSettings((s) => ({ ...s, longPressMs: 900 }));
    expect(readStoredSettings().presetsVersion).toBe(PRESETS_VERSION + 1);
  });
  it('une écriture relève un numéro plus bas, ou absent', () => {
    jsonStore.write('tracker.sportSettings', { presetsVersion: PRESETS_VERSION - 1 });
    updateStoredSettings((s) => ({ ...s, longPressMs: 900 }));
    expect(readStoredSettings().presetsVersion).toBe(PRESETS_VERSION);
    jsonStore.write('tracker.sportSettings', {});
    updateStoredSettings((s) => ({ ...s, longPressMs: 900 }));
    expect(readStoredSettings().presetsVersion).toBe(PRESETS_VERSION);
  });
  it('écriture par une version plus basse, puis démarrage : rien n\'est effacé', () => {
    const thresholds = { 'a-marche': 1.2, wingfoil: 9 };
    jsonStore.write('tracker.sportSettings', { presetsVersion: PRESETS_VERSION + 1, thresholds });
    updateStoredSettings((s) => ({ ...s, longPressMs: 900 }));
    expect(upgradeStoredPresets()).toBe(false);
    expect(readStoredSettings().thresholds).toEqual(thresholds);
  });
  it('le numéro de la liste d\'activités n\'est pas rabaissé non plus', () => {
    const next = withVisibility({ activitiesVersion: ACTIVITIES_VERSION + 1 }, [], []);
    // Aucune famille visible : refusé ; avec les familles par défaut, le numéro lu reste.
    expect(next).toBeNull();
    const activities = [{ id: 'a', name: 'A', base: 'running' as const, color: '#000' }];
    expect(withVisibility({ activitiesVersion: ACTIVITIES_VERSION + 1 }, activities, [])?.activitiesVersion).toBe(ACTIVITIES_VERSION + 1);
    expect(withVisibility({ activitiesVersion: ACTIVITIES_VERSION - 1 }, activities, [])?.activitiesVersion).toBe(ACTIVITIES_VERSION);
  });
  it('une version de pré-réglages plus basse fait effacer de nouveau les réglages couverts', () => {
    const stored = { presetsVersion: 2, activities: undefined, thresholds: { 'a-marche': 1.2, wingfoil: 9 } };
    const next = resetStoredPresets(stored as never);
    expect((next.thresholds as Record<string, number>)['a-marche']).toBeUndefined();
    expect((next.thresholds as Record<string, number>).wingfoil).toBe(9);
  });
});
