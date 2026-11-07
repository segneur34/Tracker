import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonStore } from '../platform/storage';
import {
  PRESETS_VERSION, resolveFoil, resolveHrOffset, resolveJumps, resolveLiveFields, resolveMarkGuide, resolveSpeedUnit, resolveTabChoices,
  resolveThresholdOverride, settingsView, type StoredSettings,
} from '../settings/activitySettings';
import { ACTIVITIES_0461, KITE_0461, settings0461 } from '../test/settings0461.fixture';
import { readStoredSettings, upgradeStoredActivities, upgradeStoredPresets } from './useSportSettings';

/**
 * Garde des migrations (fiche 154, risque 1, lot 187) : les réglages d'un appareil de la 0.4.61 tenus en voile et en
 * surf traversent la mise à jour de la liste d'activités (`ACTIVITIES_VERSION`) et l'effacement des pré-réglages
 * (`PRESET_RESETS`) sans changer, à un écart près, voulu et écrit ici : la reprise 4 des pré-réglages (sauts mesurés
 * d'office au kite, 05/11) efface une fois la case « Sauts » de toute activité sur le calcul kite. Rien d'autre ne
 * bouge, ni dans ce qui est rangé ni dans ce que Réglages en lit.
 */

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

/** Ce que Réglages lit d'une activité, en une chaîne : la vue entière, et les lectures hors composant. */
const readings = (stored: StoredSettings) =>
  Object.fromEntries(ACTIVITIES_0461.map((a) => [a.id, JSON.stringify({
    view: settingsView(stored, a),
    threshold: resolveThresholdOverride(stored, a),
    unit: resolveSpeedUnit(stored, a),
    foil: resolveFoil(stored, a),
    markGuide: resolveMarkGuide(stored, a),
    jumps: resolveJumps(stored, a),
    live: resolveLiveFields(stored, a),
    hrOffset: resolveHrOffset(stored, a),
    tabs: resolveTabChoices(stored, a),
  })]));

/** La même chaîne sans les sauts : l'écart voulu au kite. */
const withoutJumps = (stored: StoredSettings) =>
  Object.fromEntries(ACTIVITIES_0461.map((a) => {
    const { jumps: _j, isJumpsOverridden: _o, ...view } = settingsView(stored, a);
    return [a.id, JSON.stringify({ view, threshold: resolveThresholdOverride(stored, a), tabs: resolveTabChoices(stored, a) })];
  }));

describe('réglages de la 0.4.61 en voile et surf, après les montées de version (garde du lot 187)', () => {
  it('rien ne change, sauf la case « Sauts » du kite, effacée une fois par la reprise 4 des pré-réglages', () => {
    const before = settings0461();
    jsonStore.write(KEY, before);
    const readBefore = readings(before);

    expect(upgradeStoredActivities()).toBe(false);
    expect(upgradeStoredPresets()).toBe(true);
    const after = readStoredSettings();

    // Ce qui est rangé : à l'identique, hors la version des pré-réglages et les sauts du kite.
    const { jumps: jumpsBefore, ...restBefore } = before;
    const { jumps: jumpsAfter, ...restAfter } = after;
    expect(restAfter).toEqual({ ...restBefore, presetsVersion: PRESETS_VERSION });
    expect(jumpsAfter).toEqual({ wingfoil: jumpsBefore!.wingfoil });
    expect(after.activities).toEqual(ACTIVITIES_0461);

    // Ce que Réglages lit : à l'identique pour la voile et les deux surfs, sauts compris ; au kite, tout sauf les sauts.
    const readAfter = readings(after);
    for (const a of ACTIVITIES_0461) if (a.id !== KITE_0461.id) expect(readAfter[a.id], a.name).toBe(readBefore[a.id]);
    expect(withoutJumps(after)[KITE_0461.id]).toBe(withoutJumps(before)[KITE_0461.id]);
    // Le kite reprend le pré-réglage du 05/11 : sauts mesurés d'office, au bas de son calcul.
    expect(resolveJumps(before, KITE_0461)).toEqual({ enabled: false, placement: 'dos', minHeightM: 1.2 });
    expect(resolveJumps(after, KITE_0461)).toEqual({ enabled: true, placement: 'poitrine', minHeightM: 1 });
  });

  it('déjà à la version courante des pré-réglages : rien n\'est récrit', () => {
    const current = { ...settings0461(), presetsVersion: PRESETS_VERSION };
    jsonStore.write(KEY, current);
    const readBefore = readings(current);
    expect(upgradeStoredActivities()).toBe(false);
    expect(upgradeStoredPresets()).toBe(false);
    expect(readStoredSettings()).toEqual(current);
    expect(readings(readStoredSettings())).toEqual(readBefore);
  });

  it('les lectures portent bien les réglages de la fixture (garde-fou du test lui-même)', () => {
    const stored = settings0461();
    expect(resolveThresholdOverride(stored, ACTIVITIES_0461[0])).toBe(9);
    expect(resolveSpeedUnit(stored, KITE_0461)).toBe('kmh');
    expect(resolveMarkGuide(stored, ACTIVITIES_0461[0]).vibrate).toBe(false);
    expect(resolveLiveFields(stored, ACTIVITIES_0461[2])).toEqual(['speed', 'distance', 'duration']);
    expect(resolveTabChoices(stored, ACTIVITIES_0461[3])).toEqual({ pumping: true });
    expect(resolveHrOffset(stored, ACTIVITIES_0461[2])).toBe(-3);
    expect(resolveFoil(stored, ACTIVITIES_0461[3])).toBe(true);
  });
});
