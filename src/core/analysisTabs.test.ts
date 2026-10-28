import { describe, expect, it } from 'vitest';
import {
  LAND_TABS, MUSCU_TABS, SAILING_TABS, SURF_TABS, analysisTabs, generalOpenAfterAdvanced, isNewAnalysisSession, isTabShown, maskAdvancedTabs, maskHiddenTabs, sanitizeTabChoices, shownTabs, toggleTabChoice,
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
    expect(keys(analysisTabs(SPORT_PROFILES.running))).toEqual(keys(LAND_TABS.course).filter((k) => k !== 'fractionne' && k !== 'test'));
    expect(keys(analysisTabs(SPORT_PROFILES.cycling))).toEqual(keys(LAND_TABS.velo).filter((k) => k !== 'fractionne' && k !== 'test'));
    expect(keys(analysisTabs(SPORT_PROFILES['run-intervals']))).not.toContain('sauts');
    expect(keys(analysisTabs(SPORT_PROFILES['bike-intervals']))).not.toContain('sauts');
    expect(keys(analysisTabs(SPORT_PROFILES['run-intervals']))).toContain('fractionne');
  });

  it('« fractionné » en famille Fractionné seulement, ni à pied ni à vélo (19/10)', () => {
    expect(keys(analysisTabs(SPORT_PROFILES.running))).not.toContain('fractionne');
    expect(keys(analysisTabs(SPORT_PROFILES.cycling))).not.toContain('fractionne');
    expect(keys(analysisTabs(SPORT_PROFILES['run-intervals']))).toContain('fractionne');
    expect(keys(analysisTabs(SPORT_PROFILES['bike-intervals']))).toContain('fractionne');
  });

  it('« test » aux seuls calculs de test, sans « fractionné » ni « sauts » (24/10)', () => {
    const testTabs = keys(analysisTabs(SPORT_PROFILES['run-test']));
    expect(testTabs).toContain('test');
    expect(testTabs).not.toContain('fractionne');
    expect(testTabs).not.toContain('sauts');
    expect(keys(analysisTabs(SPORT_PROFILES['run-intervals']))).not.toContain('test');
  });

  it('course et vélo : « graphiques » à la place des zones de pente, « cardio » derrière lui (16/10)', () => {
    expect(keys(LAND_TABS.course)).toEqual(['general', 'fractionne', 'test', 'tops', 'graphiques', 'cardio', 'cadence', 'surface', 'energie', 'zones', 'sauts', 'notes', 'reglages']);
    expect(keys(LAND_TABS.velo)).toEqual(['general', 'fractionne', 'test', 'tops', 'graphiques', 'cardio', 'surface', 'energie', 'zones', 'sauts', 'notes', 'reglages']);
    expect(tab(LAND_TABS.course, 'graphiques').label).toBe('graphiques');
  });

  it('« cadence » à pied seulement : course, marche, fractionné à pied', () => {
    expect(keys(analysisTabs(SPORT_PROFILES.running))).toContain('cadence');
    expect(keys(analysisTabs(SPORT_PROFILES['run-intervals']))).toContain('cadence');
    expect(keys(analysisTabs(SPORT_PROFILES.cycling))).not.toContain('cadence');
    expect(keys(analysisTabs(SPORT_PROFILES['bike-intervals']))).not.toContain('cadence');
  });

  it('surf : « tops » entre « vols » et « graphiques »', () => {
    const surf = keys(analysisTabs(SPORT_PROFILES.surf));
    expect(surf).toEqual(keys(SURF_TABS));
    expect(surf.indexOf('tops')).toBe(surf.indexOf('vols') + 1);
    expect(surf.indexOf('graphiques')).toBe(surf.indexOf('tops') + 1);
  });

  it('muscu : général, cardio, matériel et notes, réglages, sans carte (lot I du 25/10)', () => {
    expect(keys(analysisTabs(SPORT_PROFILES.muscu))).toEqual(['general', 'cardio', 'notes', 'reglages']);
    expect(keys(MUSCU_TABS)).toEqual(['general', 'cardio', 'notes', 'reglages']);
    expect(MUSCU_TABS[0].primary).toBe(true);
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
  const open = { general: true, vagues: true, rame: false, vols: false, tops: true, graphiques: false, cardio: false, notes: false, reglages: false };

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

describe('maskAdvancedTabs', () => {
  const open = { general: true, vagues: true, rame: false, vols: false, tops: true, graphiques: false, cardio: false, notes: false, reglages: false };

  it('« avancé » fermé : ses onglets se replient, « général » reste', () => {
    const masked = maskAdvancedTabs(open, SURF_TABS, false);
    expect(masked.general).toBe(true);
    expect(masked.vagues).toBe(false);
    expect(masked.tops).toBe(false);
    // La mémoire n'est pas touchée : les panneaux reviennent à la réouverture.
    expect(open.vagues).toBe(true);
  });

  it('« fractionné » est de la première rangée, comme « général »', () => {
    const land = { general: true, fractionne: true, test: true, tops: false, zones: false, surface: false, energie: false, graphiques: true, cardio: false, cadence: false, sauts: false, notes: false, reglages: false };
    const masked = maskAdvancedTabs(land, LAND_TABS.course, false);
    expect(masked.fractionne).toBe(true);
    expect(masked.test).toBe(true);
    expect(masked.graphiques).toBe(false);
  });

  it('rend le même objet quand rien ne change', () => {
    expect(maskAdvancedTabs(open, SURF_TABS, true)).toBe(open);
    const onlyGeneral = { ...open, vagues: false, tops: false };
    expect(maskAdvancedTabs(onlyGeneral, SURF_TABS, false)).toBe(onlyGeneral);
  });
});

describe('« avancé » et « général »', () => {
  it('ouvrir « avancé » ferme « général », le refermer le rouvre', () => {
    expect(generalOpenAfterAdvanced(true)).toBe(false);
    expect(generalOpenAfterAdvanced(false)).toBe(true);
  });

  it('une autre session est neuve, la même ne l’est pas', () => {
    expect(isNewAnalysisSession('a|1', 'b|2')).toBe(true);
    expect(isNewAnalysisSession(undefined, 'a|1')).toBe(true);
    expect(isNewAnalysisSession(null, 'a|1')).toBe(true);
    expect(isNewAnalysisSession('a|1', 'a|1')).toBe(false);
  });

  it('une trace pas encore lue ne compte pas', () => {
    expect(isNewAnalysisSession('a|1', null)).toBe(false);
    expect(isNewAnalysisSession(undefined, null)).toBe(false);
  });
});
