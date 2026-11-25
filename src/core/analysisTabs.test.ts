import { describe, expect, it } from 'vitest';
import {
  FLIGHT_TILE_TABS, LAND_TABS, LAND_TILE_TABS, MUSCU_TABS, PANEL_HEAD_VISIBLE_PX, SAILING_TABS, SAILING_TILE_TABS, SURF_TABS, SURF_TILE_TABS, activityTabs,
  isTabOpenOnScreen, panelNeedsScroll, revealTab, tabAnchorId, tileTab, toggleTabFromTile, analysisTabs, closeAllTabs, gearTabToOpen, generalOpenAfterAdvanced, initialTabsState, isTabShown, keepOpenTabEntries, openAllTabs, tabsBulkAction, maskAdvancedTabs, maskHiddenTabs, sanitizeTabChoices, shownTabs, tabDefaults, tabsStateFor, toggleTabChoice,
  type TabChoices,
} from './analysisTabs';
import { SPORT_PROFILES } from './sportProfiles';

const keys = (tabs: readonly { key: string }[]) => tabs.map((t) => t.key);
const tab = (tabs: readonly { key: string; label: string; generic?: true }[], key: string) => tabs.find((t) => t.key === key)!;

describe('analysisTabs : onglets proposés par calcul', () => {
  it('voile : la barre de la voile, « sauts » et « pumping » compris, sauf en bateau', () => {
    expect(keys(analysisTabs(SPORT_PROFILES.wingfoil))).toEqual(keys(SAILING_TABS));
    expect(keys(analysisTabs(SPORT_PROFILES.bateau))).not.toContain('sauts');
    expect(keys(analysisTabs(SPORT_PROFILES.bateau))).not.toContain('pumping');
  });

  it('voile : « vols » puis « pumping » juste après « sauts » (lots 22 et 50)', () => {
    const order = keys(SAILING_TABS);
    expect(order.indexOf('vols')).toBe(order.indexOf('sauts') + 1);
    expect(order.indexOf('pumping')).toBe(order.indexOf('vols') + 1);
    expect(keys(analysisTabs(SPORT_PROFILES.kite))).toContain('pumping');
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

  it('surf : « pumping » juste après « vols », puis « tops » avant « graphiques »', () => {
    const surf = keys(analysisTabs(SPORT_PROFILES.surf));
    expect(surf).toEqual(keys(SURF_TABS));
    expect(surf.indexOf('pumping')).toBe(surf.indexOf('vols') + 1);
    expect(surf.indexOf('tops')).toBe(surf.indexOf('pumping') + 1);
    expect(surf.indexOf('graphiques')).toBe(surf.indexOf('tops') + 1);
  });

  it('muscu : général, cardio, matériel et notes, réglages, sans carte (lot I du 25/10)', () => {
    expect(keys(analysisTabs(SPORT_PROFILES.muscu))).toEqual(['general', 'cardio', 'notes', 'reglages']);
    expect(keys(MUSCU_TABS)).toEqual(['general', 'test', 'cardio', 'notes', 'reglages']);
    expect(MUSCU_TABS[0].primary).toBe(true);
  });

  it('FC de nuit : « test » juste après « général », dans la première rangée (lot 213)', () => {
    expect(keys(analysisTabs(SPORT_PROFILES['night-hr']))).toEqual(['general', 'test', 'cardio', 'notes', 'reglages']);
    expect(MUSCU_TABS.find((t) => t.key === 'test')?.primary).toBe(true);
  });

  it('chaque calcul qui propose « tops » a des cibles', () => {
    for (const profile of Object.values(SPORT_PROFILES)) {
      if (keys(analysisTabs(profile)).includes('tops')) expect(profile.topTargets.length, profile.id).toBeGreaterThan(0);
    }
  });
});

describe("activityTabs : onglets de Réglages selon les options de l'activité (05/11)", () => {
  it("« sauts » seulement si l'activité mesure les sauts", () => {
    const wing = SPORT_PROFILES.wingfoil;
    expect(keys(activityTabs(wing, { foil: true, jumps: true }))).toContain('sauts');
    expect(keys(activityTabs(wing, { foil: true, jumps: false }))).not.toContain('sauts');
    expect(keys(activityTabs(SPORT_PROFILES.cycling, { foil: false, jumps: true }))).toContain('sauts');
    expect(keys(activityTabs(SPORT_PROFILES.running, { foil: false, jumps: false }))).not.toContain('sauts');
  });

  it('un calcul sans sauts ne les propose pas, même coché ; « vols » et « pumping » suivent le foil', () => {
    expect(keys(activityTabs(SPORT_PROFILES.bateau, { foil: false, jumps: true }))).not.toContain('sauts');
    const wing = SPORT_PROFILES.wingfoil;
    expect(keys(activityTabs(wing, { foil: false, jumps: true }))).not.toContain('vols');
    expect(keys(activityTabs(wing, { foil: true, jumps: true }))).toEqual(keys(analysisTabs(wing)));
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
    const once = toggleTabChoice(null, tops, null);
    expect(once).toEqual({ tops: true });
    expect(toggleTabChoice(once, tops, null)).toBeNull();
  });

  it('cache un onglet du module, les autres choix gardés', () => {
    const next = toggleTabChoice({ tops: true }, tab(SURF_TABS, 'vagues'), null);
    expect(next).toEqual({ tops: true, vagues: false });
    expect(toggleTabChoice(next, tab(SURF_TABS, 'vagues'), null)).toEqual({ tops: true });
  });

  it('tout se cache, « général » et « réglages » compris', () => {
    let choices = null as ReturnType<typeof toggleTabChoice>;
    for (const t of SAILING_TABS) choices = toggleTabChoice(choices, t, null);
    expect(shownTabs(SAILING_TABS, choices)).toEqual([]);
  });
});

describe('toggleTabChoice : activité à pré-réglage (n° 174)', () => {
  /** Ce que lit l'application (`resolveTabChoices`) : le choix rangé, sinon le pré-réglage tout entier. */
  const resolved = (choices: TabChoices | null, preset: TabChoices | null) => sanitizeTabChoices(choices) ?? preset;
  const sauts = tab(LAND_TABS.course, 'sauts');
  const cardio = tab(LAND_TABS.course, 'cardio');
  const topsCourse = tab(LAND_TABS.course, 'tops');
  const topsVelo = tab(LAND_TABS.velo, 'tops');
  const COURSE = { sauts: false };
  const VTT = { tops: false };

  it('Course : un toucher montre « sauts », un second revient au pré-réglage', () => {
    const once = toggleTabChoice(COURSE, sauts, COURSE);
    expect(isTabShown(sauts, resolved(once, COURSE))).toBe(true);
    expect(once).toEqual({ sauts: true });
    expect(toggleTabChoice(once, sauts, COURSE)).toBeNull();
  });

  it('VTT : un toucher montre « tops », un second revient au pré-réglage', () => {
    const once = toggleTabChoice(VTT, topsVelo, VTT);
    expect(isTabShown(topsVelo, resolved(once, VTT))).toBe(true);
    expect(once).toEqual({ tops: true });
    expect(toggleTabChoice(once, topsVelo, VTT)).toBeNull();
  });

  it('chaque toucher change le bouton, dix fois de suite', () => {
    let stored: TabChoices | null = null;
    let shown = false;
    for (let i = 0; i < 10; i++) {
      stored = toggleTabChoice(resolved(stored, COURSE), sauts, COURSE);
      shown = !shown;
      expect(isTabShown(sauts, resolved(stored, COURSE)), `toucher ${i + 1}`).toBe(shown);
    }
  });

  it("un autre onglet changé puis remis ne change pas « sauts » et rend la marque « défaut »", () => {
    const changed = toggleTabChoice(COURSE, cardio, COURSE);
    expect(changed).toEqual({ sauts: false, cardio: false });
    expect(toggleTabChoice(changed, cardio, COURSE)).toBeNull();
  });

  it("« sauts » montré reste montré quand un autre onglet revient à son défaut", () => {
    const withTops = toggleTabChoice(toggleTabChoice(COURSE, topsCourse, COURSE), sauts, COURSE);
    expect(withTops).toEqual({ sauts: true, tops: true });
    const back = toggleTabChoice(withTops, topsCourse, COURSE);
    expect(back).toEqual({ sauts: true });
    expect(isTabShown(sauts, resolved(back, COURSE))).toBe(true);
  });

  it("un choix ancien, sans la clé du pré-réglage, ne retombe pas sur lui en se vidant", () => {
    // Rangé avant le n° 174 : « sauts » y est montré parce qu'absent.
    const old = { cardio: false };
    expect(isTabShown(sauts, old)).toBe(true);
    const back = toggleTabChoice(old, cardio, COURSE);
    expect(back).toEqual({ sauts: true });
    expect(isTabShown(sauts, resolved(back, COURSE))).toBe(true);
    expect(isTabShown(cardio, resolved(back, COURSE))).toBe(true);
  });

  it("un choix égal au pré-réglage s'efface, quel que soit l'ordre de ses clés", () => {
    const preset = { sauts: false, cardio: false };
    expect(toggleTabChoice({ cardio: false, sauts: true }, sauts, preset)).toBeNull();
  });

  it('sans pré-réglage, un choix revenu au défaut du module s\'efface', () => {
    expect(toggleTabChoice({ sauts: false }, sauts, null)).toBeNull();
    expect(toggleTabChoice(null, topsCourse, null)).toEqual({ tops: true });
  });
});

describe('maskHiddenTabs', () => {
  const open = { general: true, vagues: true, rame: false, vols: false, pumping: false, tops: true, graphiques: false, cardio: false, notes: false, reglages: false };

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
  const open = { general: true, vagues: true, rame: false, vols: false, pumping: false, tops: true, graphiques: false, cardio: false, notes: false, reglages: false };

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

describe('keepOpenTabEntries : la carte ne garde que ce que demandent les onglets ouverts', () => {
  const open = { ...tabDefaults(SAILING_TABS), manoeuvres: true, tops: true };
  const entries = [
    { panel: 'manoeuvres' as const, key: 'tack' },
    { panel: 'tops' as const, key: 't2s' },
    { panel: 'manoeuvres' as const, key: 'jibe' },
  ];

  it('rien de fermé : la même liste, sans copie', () => {
    expect(keepOpenTabEntries(entries, open)).toBe(entries);
  });

  it('un onglet fermé : ses entrées partent, les autres restent dans leur ordre', () => {
    expect(keepOpenTabEntries(entries, { ...open, manoeuvres: false })).toEqual([{ panel: 'tops', key: 't2s' }]);
    expect(keepOpenTabEntries(entries, closeAllTabs(open))).toEqual([]);
  });

  it('« avancé » refermé : les entrées de ses onglets partent', () => {
    expect(keepOpenTabEntries(entries, maskAdvancedTabs(open, SAILING_TABS, false))).toEqual([]);
  });

  it('liste vide : rendue telle quelle', () => {
    const empty: { panel: 'tops'; key: string }[] = [];
    expect(keepOpenTabEntries(empty, closeAllTabs(open))).toBe(empty);
  });
});

describe('« avancé » et « général »', () => {
  it('ouvrir « avancé » ferme « général », le refermer le rouvre', () => {
    expect(generalOpenAfterAdvanced(true)).toBe(false);
    expect(generalOpenAfterAdvanced(false)).toBe(true);
  });
});

describe('état des onglets : « général » seul à chaque ouverture (05/11)', () => {
  const defaults = tabDefaults(SURF_TABS);

  it('part des défauts, « avancé » fermé, sans partager l’objet des défauts', () => {
    const state = initialTabsState(defaults, 'a|1');
    expect(state).toEqual({ key: 'a|1', open: defaults, advanced: false });
    expect(state.open).not.toBe(defaults);
    expect(Object.entries(state.open).filter(([, v]) => v).map(([k]) => k)).toEqual(['general']);
  });

  it('une autre session repart des défauts', () => {
    const state = { key: 'a|1', open: { ...defaults, general: false, vagues: true }, advanced: true };
    expect(tabsStateFor(state, defaults, 'b|2')).toEqual(initialTabsState(defaults, 'b|2'));
  });

  it('la même session, ou une trace pas encore lue, garde l’état', () => {
    const state = { key: 'a|1', open: { ...defaults, vagues: true }, advanced: true };
    expect(tabsStateFor(state, defaults, 'a|1')).toBe(state);
    expect(tabsStateFor(state, defaults, null)).toBe(state);
  });

  it('une première trace lue repart des défauts', () => {
    const state = initialTabsState(defaults, null);
    expect(tabsStateFor(state, defaults, 'a|1')).toEqual(initialTabsState(defaults, 'a|1'));
  });
});

describe('ouverture après « Finir » sur l’onglet du matériel (lot 220)', () => {
  it('trouve l’onglet du matériel de chaque module', () => {
    expect(gearTabToOpen(SAILING_TABS, null)).toBe('matos');
    expect(gearTabToOpen(LAND_TABS.course, null)).toBe('notes');
    expect(gearTabToOpen(LAND_TABS.velo, null)).toBe('notes');
    expect(gearTabToOpen(SURF_TABS, null)).toBe('notes');
    expect(gearTabToOpen(MUSCU_TABS, null)).toBe('notes');
  });

  it('rien si l’activité cache l’onglet du matériel : ouverture habituelle', () => {
    expect(gearTabToOpen(SAILING_TABS, { matos: false })).toBeNull();
    expect(gearTabToOpen(LAND_TABS.course, { notes: false, tops: true })).toBeNull();
  });

  it('« avancé » déplié, l’onglet du matériel ouvert seul, « général » fermé', () => {
    const defaults = tabDefaults(LAND_TABS.course, LAND_TABS.velo);
    const state = initialTabsState(defaults, 'a|1', 'notes');
    expect(state.advanced).toBe(true);
    expect(state.key).toBe('a|1');
    expect(Object.keys(state.open).sort()).toEqual(Object.keys(defaults).sort());
    expect(Object.entries(state.open).filter(([, v]) => v).map(([k]) => k)).toEqual(['notes']);
  });

  it('la première trace lue s’ouvre sur le matériel, puis l’état reste ; sans demande, « général » seul', () => {
    const defaults = tabDefaults(SAILING_TABS);
    const loading = initialTabsState(defaults, null, 'matos');
    const first = tabsStateFor(loading, defaults, 'a|1', 'matos');
    expect(first).toEqual(initialTabsState(defaults, 'a|1', 'matos'));
    expect(tabsStateFor(first, defaults, 'a|1', 'matos')).toBe(first);
    expect(tabsStateFor(loading, defaults, 'a|1')).toEqual(initialTabsState(defaults, 'a|1'));
  });
});

describe('closeAllTabs : « tout fermer »', () => {
  it('ferme chaque onglet, « général » compris', () => {
    const open = { ...tabDefaults(LAND_TABS.course), tops: true, cardio: true };
    const closed = closeAllTabs(open);
    expect(Object.keys(closed)).toEqual(Object.keys(open));
    expect(Object.values(closed).every((v) => v === false)).toBe(true);
  });
});

describe('« tout ouvrir » / « tout fermer » (lot 227)', () => {
  it('ouvrir sous 2 onglets ouverts, fermer dès 2', () => {
    expect([0, 1].map(tabsBulkAction)).toEqual(['open', 'open']);
    expect([2, 3, 9].map(tabsBulkAction)).toEqual(['close', 'close', 'close']);
  });

  it('ouvre tout en une fois, « général » compris, « avancé » déplié', () => {
    const state = { key: 'a', open: { general: true, tops: false, cardio: false, cache: false }, advanced: false };
    const next = openAllTabs(state, ['general', 'tops', 'cardio']);
    expect(next.open).toEqual({ general: true, tops: true, cardio: true, cache: false });
    expect(next.advanced).toBe(true);
  });

  it('« avancé » déjà déplié et onglets déjà ouverts : rien ne se referme', () => {
    const state = { key: 'a', open: { general: false, tops: true, cardio: false }, advanced: true };
    const next = openAllTabs(state, ['general', 'tops', 'cardio']);
    expect(next.open).toEqual({ general: true, tops: true, cardio: true });
    expect(next.advanced).toBe(true);
  });
});

describe('tabDefaults : onglets ouverts à la première visite', () => {
  // Copies gelées des constantes écrites à la main avant le lot 62 (SailingModule, LandModule, SurfModule, MuscuModule).
  const SAILING_PANEL_DEFAULTS = {
    general: true, tops: false, manoeuvres: false, graphiques: false, cardio: false, vmg: false, sauts: false, vols: false, pumping: false, vent: false, matos: false, reglages: false,
  };
  const LAND_SECTION_DEFAULTS = {
    general: true, fractionne: true, test: true, tops: false, zones: false, surface: false, energie: false, graphiques: false, cardio: false, cadence: false,
    sauts: false, notes: false, reglages: false,
  };
  const SURF_SECTION_DEFAULTS = {
    general: true, vagues: false, rame: false, vols: false, pumping: false, tops: false, graphiques: false, cardio: false, notes: false, reglages: false,
  };
  // « test » de la FC de nuit en plus (lot 213), dans la première rangée comme à pied.
  const MUSCU_SECTION_DEFAULTS = { general: true, test: true, cardio: false, notes: false, reglages: false };

  it('rend les défauts de chaque module, tels qu\'ils étaient écrits', () => {
    expect(tabDefaults(SAILING_TABS)).toEqual(SAILING_PANEL_DEFAULTS);
    expect(tabDefaults(LAND_TABS.course, LAND_TABS.velo)).toEqual(LAND_SECTION_DEFAULTS);
    expect(tabDefaults(SURF_TABS)).toEqual(SURF_SECTION_DEFAULTS);
    expect(tabDefaults(MUSCU_TABS)).toEqual(MUSCU_SECTION_DEFAULTS);
  });

  it('course et vélo : l\'union des deux listes, « cadence » comprise', () => {
    expect(Object.hasOwn(tabDefaults(LAND_TABS.velo), 'cadence')).toBe(false);
    expect(tabDefaults(LAND_TABS.course, LAND_TABS.velo).cadence).toBe(false);
  });
});

const openKeys = (open: Record<string, boolean>) => Object.entries(open).filter(([, v]) => v).map(([k]) => k);

describe('revealTab : ouvrir un onglet depuis ailleurs que sa pastille (lot 234)', () => {
  it('sans `keepPrimary` : « avancé » se déplie et ferme « général », comme sa pastille', () => {
    const next = revealTab(initialTabsState(tabDefaults(SAILING_TABS), 'a|1'), SAILING_TABS, 'manoeuvres');
    expect(next.advanced).toBe(true);
    expect(openKeys(next.open)).toEqual(['manoeuvres']);
  });

  it("depuis une tuile (`keepPrimary`) : « avancé » se déplie, « général » reste ouvert, l'onglet s'ouvre en plus", () => {
    const next = revealTab(initialTabsState(tabDefaults(SAILING_TABS), 'a|1'), SAILING_TABS, 'manoeuvres', { keepPrimary: true });
    expect(next.advanced).toBe(true);
    expect(openKeys(next.open)).toEqual(['general', 'manoeuvres']);
    const surf = revealTab(initialTabsState(tabDefaults(SURF_TABS), 'a|1'), SURF_TABS, 'vagues', { keepPrimary: true });
    expect(openKeys(surf.open)).toEqual(['general', 'vagues']);
  });

  it("« avancé » déjà ouvert : les onglets ouverts restent, l'onglet s'ajoute", () => {
    const state = { key: 'a|1', open: { ...tabDefaults(SAILING_TABS), tops: true }, advanced: true };
    const next = revealTab(state, SAILING_TABS, 'sauts', { keepPrimary: true });
    expect(openKeys(next.open)).toEqual(['general', 'tops', 'sauts']);
    expect(next.advanced).toBe(true);
  });

  it("l'onglet déjà ouvert à l'écran : l'état est rendu tel quel", () => {
    const state = { key: 'a|1', open: { ...tabDefaults(SAILING_TABS), cardio: true }, advanced: true };
    expect(revealTab(state, SAILING_TABS, 'cardio', { keepPrimary: true })).toBe(state);
  });
});

describe('toggleTabFromTile : la tuile ouvre puis referme son onglet (lot 234)', () => {
  it("fermé : il s'ouvre en plus de « général », « avancé » se déplie", () => {
    const start = initialTabsState(tabDefaults(SAILING_TABS), 'a|1');
    const next = toggleTabFromTile(start, SAILING_TABS, 'manoeuvres');
    expect(next).toEqual(revealTab(start, SAILING_TABS, 'manoeuvres', { keepPrimary: true }));
    expect(openKeys(next.open)).toEqual(['general', 'manoeuvres']);
  });

  it('ouvert : il se referme seul, « général », les autres onglets et « avancé » restent', () => {
    const state = { key: 'a|1', open: { ...tabDefaults(SAILING_TABS), tops: true, manoeuvres: true }, advanced: true };
    const next = toggleTabFromTile(state, SAILING_TABS, 'manoeuvres');
    expect(openKeys(next.open)).toEqual(['general', 'tops']);
    expect(next.advanced).toBe(true);
    const defaults = tabDefaults(LAND_TABS.course, LAND_TABS.velo);
    const land = toggleTabFromTile({ key: 'a|1', open: { ...defaults, zones: true }, advanced: true }, LAND_TABS.course, 'zones');
    // Première rangée de la course et du vélo : « général », « fractionné », « test », ouverts d'office.
    expect(openKeys(land.open)).toEqual(['general', 'fractionne', 'test']);
  });

  it("deux touchers rendent l'état de départ, « avancé » mis à part", () => {
    const start = { key: 'a|1', open: tabDefaults(SAILING_TABS), advanced: true };
    expect(toggleTabFromTile(toggleTabFromTile(start, SAILING_TABS, 'sauts'), SAILING_TABS, 'sauts')).toEqual(start);
  });

  it("ouvert dans l'état mais replié par « avancé » fermé : la tuile le montre, elle ne le ferme pas", () => {
    const state = { key: 'a|1', open: { ...tabDefaults(SAILING_TABS), cardio: true }, advanced: false };
    expect(isTabOpenOnScreen(state, SAILING_TABS, 'cardio')).toBe(false);
    const next = toggleTabFromTile(state, SAILING_TABS, 'cardio');
    expect(next.advanced).toBe(true);
    expect(openKeys(next.open)).toEqual(['general', 'cardio']);
  });

  it('« tout fermer » puis une tuile : seul son onglet s’ouvre, « général » reste fermé', () => {
    const closed = { key: 'a|1', open: closeAllTabs(tabDefaults(SAILING_TABS)), advanced: true };
    expect(openKeys(toggleTabFromTile(closed, SAILING_TABS, 'tops').open)).toEqual(['tops']);
  });
});

describe('tileTab : la tuile de « général » et son onglet (lot 234)', () => {
  it('chaque cible est un onglet de son module, jamais de la première rangée', () => {
    const cases: [Readonly<Record<string, string>>, readonly { key: string; primary?: true }[]][] = [
      [SAILING_TILE_TABS, SAILING_TABS], [FLIGHT_TILE_TABS, SAILING_TABS], [SURF_TILE_TABS, SURF_TABS], [LAND_TILE_TABS, LAND_TABS.course],
    ];
    for (const [table, tabs] of cases) {
      for (const target of Object.values(table)) {
        const found = tabs.find((t) => t.key === target);
        expect(found, target).toBeDefined();
        expect(found?.primary, target).toBeUndefined();
      }
    }
  });

  it('onglet montré : la tuile le trouve, avec son libellé', () => {
    expect(tileTab([SAILING_TILE_TABS], 'tacks', SAILING_TABS)?.key).toBe('manoeuvres');
    expect(tileTab([SAILING_TILE_TABS], 'jumps', SAILING_TABS)?.label).toBe('sauts');
    expect(tileTab([SURF_TILE_TABS], 'waves', SURF_TABS)?.key).toBe('vagues');
    expect(tileTab([LAND_TILE_TABS], 'elevationGain', LAND_TABS.course)?.label).toBe('zones de pente');
    expect(tileTab([LAND_TILE_TABS], 'top-t5min', LAND_TABS.velo)?.key).toBe('tops');
    expect(tileTab([LAND_TILE_TABS], 'energy', LAND_TABS.velo)?.key).toBe('energie');
  });

  it('null : tuile sans onglet, clé inconnue ou héritée, onglet caché ou absent du module', () => {
    expect(tileTab([SAILING_TILE_TABS], 'totalTime', SAILING_TABS)).toBeNull();
    expect(tileTab([LAND_TILE_TABS], 'distance', LAND_TABS.course)).toBeNull();
    expect(tileTab([LAND_TILE_TABS], 'movingAverage', LAND_TABS.course)).toBeNull();
    expect(tileTab([SAILING_TILE_TABS], 'toString', SAILING_TABS)).toBeNull();
    expect(tileTab([SAILING_TILE_TABS], 'jumps', SAILING_TABS.filter((t) => t.key !== 'sauts'))).toBeNull();
    // À vélo, pas d'onglet « cadence » : la tuile reste un bloc.
    expect(tileTab([LAND_TILE_TABS], 'cadence', LAND_TABS.velo)).toBeNull();
    expect(tileTab([SURF_TILE_TABS], 'tacks', SURF_TABS)).toBeNull();
  });

  it("sur foil : le premier bloc ouvre « vols » s'il est montré ; sans foil, rien", () => {
    for (const key of ['activeDistance', 'totalTime', 'activeTime', 'activeRatio', 'activeAverage']) {
      expect(tileTab([FLIGHT_TILE_TABS, SAILING_TILE_TABS], key, SAILING_TABS)?.key, key).toBe('vols');
      expect(tileTab([SAILING_TILE_TABS], key, SAILING_TABS), key).toBeNull();
    }
    expect(tileTab([FLIGHT_TILE_TABS, SAILING_TILE_TABS], 'activeTime', SAILING_TABS.filter((t) => t.key !== 'vols'))).toBeNull();
    // Les autres tuiles gardent leur onglet.
    expect(tileTab([FLIGHT_TILE_TABS, SAILING_TILE_TABS], 'tacks', SAILING_TABS)?.key).toBe('manoeuvres');
  });

  it('ancre du panneau : une par onglet', () => {
    expect(tabAnchorId('manoeuvres')).toBe('an-onglet-manoeuvres');
    expect(tabAnchorId('vagues')).not.toBe(tabAnchorId('vols'));
  });
});

describe('panelNeedsScroll : défiler seulement si le haut du panneau est caché (lot 234)', () => {
  const inset = 64;
  const height = 800;

  it("haut à l'écran, sous ce qui colle : pas de défilement", () => {
    expect(panelNeedsScroll(inset, inset, height)).toBe(false);
    expect(panelNeedsScroll(300, inset, height)).toBe(false);
    expect(panelNeedsScroll(height - PANEL_HEAD_VISIBLE_PX, inset, height)).toBe(false);
  });

  it('haut sous la barre collée, passé au-dessus, ou trop bas pour paraître : défilement', () => {
    expect(panelNeedsScroll(inset - 1, inset, height)).toBe(true);
    expect(panelNeedsScroll(-500, inset, height)).toBe(true);
    expect(panelNeedsScroll(height - PANEL_HEAD_VISIBLE_PX + 1, inset, height)).toBe(true);
  });

  it('barre du bas du téléphone : le haut du panneau doit paraître au-dessus d’elle', () => {
    const phone = 844;
    const bar = 64;
    expect(panelNeedsScroll(770, inset, phone, bar)).toBe(true);
    expect(panelNeedsScroll(phone - bar - PANEL_HEAD_VISIBLE_PX, inset, phone, bar)).toBe(false);
    expect(panelNeedsScroll(phone - bar - PANEL_HEAD_VISIBLE_PX + 1, inset, phone, bar)).toBe(true);
    expect(panelNeedsScroll(760, inset, phone)).toBe(false);
  });
});
