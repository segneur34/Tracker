import { describe, expect, it } from 'vitest';
import {
  LAND_TABS, SAILING_TABS, SURF_TABS, analysisTabs, isTabShown, maskHiddenTabs, sanitizeTabChoices, shownTabs, toggleTabChoice,
} from './analysisTabs';
import { SPORT_PROFILES } from './sportProfiles';

const keys = (tabs: readonly { key: string }[]) => tabs.map((t) => t.key);
const tab = (tabs: readonly { key: string; label: string; generic?: true }[], key: string) => tabs.find((t) => t.key === key)!;

describe('analysisTabs : onglets proposés par calcul', () => {
  it('voile : la barre de la voile, « sauts » compris, sauf en bateau', () => {
    expect(keys(analysisTabs(SPORT_PROFILES.wingfoil))).toEqual(keys(SAILING_TABS));
    expect(keys(analysisTabs(SPORT_PROFILES.bateau))).not.toContain('sauts');
  });

  it('course et vélo : la même barre, sans « sauts » en fractionné', () => {
    expect(keys(analysisTabs(SPORT_PROFILES.running))).toEqual(keys(LAND_TABS.course));
    expect(keys(analysisTabs(SPORT_PROFILES.cycling))).toEqual(keys(LAND_TABS.velo));
    expect(keys(analysisTabs(SPORT_PROFILES['run-intervals']))).not.toContain('sauts');
    expect(keys(analysisTabs(SPORT_PROFILES['bike-intervals']))).not.toContain('sauts');
    expect(keys(analysisTabs(SPORT_PROFILES['run-intervals']))).toContain('fractionne');
  });

  it('surf : « tops » entre « vols » et « graphiques »', () => {
    const surf = keys(analysisTabs(SPORT_PROFILES.surf));
    expect(surf).toEqual(keys(SURF_TABS));
    expect(surf.indexOf('tops')).toBe(surf.indexOf('vols') + 1);
    expect(surf.indexOf('graphiques')).toBe(surf.indexOf('tops') + 1);
  });

  it('chaque calcul qui propose « tops » a des cibles', () => {
    for (const profile of Object.values(SPORT_PROFILES)) {
      if (keys(analysisTabs(profile)).includes('tops')) expect(profile.topTargets.length, profile.id).toBeGreaterThan(0);
    }
  });
});

describe('isTabShown : défauts et choix', () => {
  it('sans choix, les onglets du module sont montrés, « tops » caché à pied et en surf', () => {
    expect(keys(shownTabs(SAILING_TABS, null))).toEqual(keys(SAILING_TABS));
    expect(keys(shownTabs(LAND_TABS.velo, null))).toContain('tops');
    expect(keys(shownTabs(LAND_TABS.course, null))).not.toContain('tops');
    expect(keys(shownTabs(SURF_TABS, null))).not.toContain('tops');
  });

  it('un choix l\'emporte sur le défaut, dans les deux sens', () => {
    const choices = { tops: true, vagues: false };
    expect(isTabShown(tab(SURF_TABS, 'tops'), choices)).toBe(true);
    expect(isTabShown(tab(SURF_TABS, 'vagues'), choices)).toBe(false);
    expect(isTabShown(tab(SURF_TABS, 'rame'), choices)).toBe(true);
  });

  it('une clé du prototype n\'est pas prise pour un choix', () => {
    expect(isTabShown({ key: 'toString', label: 'x' }, {})).toBe(true);
    expect(isTabShown({ key: 'constructor', label: 'x', generic: true }, {})).toBe(false);
  });
});

describe('sanitizeTabChoices', () => {
  it('garde les booléens, ignore le reste', () => {
    expect(sanitizeTabChoices({ tops: true, vmg: false, vent: 'non', [''.padEnd(41, 'x')]: true })).toEqual({ tops: true, vmg: false });
  });

  it('une clé inconnue est gardée, sans effet sur les onglets', () => {
    const choices = sanitizeTabChoices({ onglet_retire: false });
    expect(choices).toEqual({ onglet_retire: false });
    expect(keys(shownTabs(SURF_TABS, choices))).toEqual(keys(shownTabs(SURF_TABS, null)));
  });

  it('`null` pour une valeur mal formée ou vide', () => {
    expect(sanitizeTabChoices(null)).toBeNull();
    expect(sanitizeTabChoices(['tops'])).toBeNull();
    expect(sanitizeTabChoices('tops')).toBeNull();
    expect(sanitizeTabChoices({})).toBeNull();
    expect(sanitizeTabChoices({ tops: 1 })).toBeNull();
  });
});

describe('toggleTabChoice', () => {
  it('coche un onglet générique, puis revient au défaut', () => {
    const tops = tab(SURF_TABS, 'tops');
    const once = toggleTabChoice(null, tops);
    expect(once).toEqual({ tops: true });
    expect(toggleTabChoice(once, tops)).toBeNull();
  });

  it('cache un onglet du module, les autres choix gardés', () => {
    const next = toggleTabChoice({ tops: true }, tab(SURF_TABS, 'vagues'));
    expect(next).toEqual({ tops: true, vagues: false });
    expect(toggleTabChoice(next, tab(SURF_TABS, 'vagues'))).toEqual({ tops: true });
  });

  it('tout se cache, « général » et « réglages » compris', () => {
    let choices = null as ReturnType<typeof toggleTabChoice>;
    for (const t of SAILING_TABS) choices = toggleTabChoice(choices, t);
    expect(shownTabs(SAILING_TABS, choices)).toEqual([]);
  });
});

describe('maskHiddenTabs', () => {
  const open = { general: true, vagues: true, rame: false, vols: false, tops: true, graphiques: false, notes: false, reglages: false };

  it('ferme les onglets cachés laissés ouverts', () => {
    const masked = maskHiddenTabs(open, SURF_TABS, { vagues: false });
    expect(masked.vagues).toBe(false);
    // « tops » est générique : ouvert dans la mémoire, mais pas coché.
    expect(masked.tops).toBe(false);
    expect(masked.general).toBe(true);
    expect(open.vagues).toBe(true);
  });

  it('rend le même objet quand rien n\'est caché', () => {
    const allShown = { ...open, tops: false };
    expect(maskHiddenTabs(allShown, SURF_TABS, null)).toBe(allShown);
    expect(maskHiddenTabs(open, SURF_TABS, { tops: true })).toBe(open);
  });
});
