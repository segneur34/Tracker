import { isObject } from './basics';
import { isIntervalSport, isTestSport, sportTreatment, type SportProfile, type Treatment } from './sportProfiles';

/**
 * Onglets des analyses, par module, dans l'ordre de leur barre. Chaque
 * activité choisit dans Réglages ceux qu'elle montre : un onglet du module
 * est montré tant qu'on ne le cache pas, un onglet générique (`generic`) est
 * caché tant qu'on ne le coche pas. Tous se cachent, « général » et
 * « réglages » compris (choix de l'utilisateur, 14/10).
 *
 * Pour ajouter un onglet : une entrée dans la liste de son module (ouvert par
 * défaut s'il est `primary`, `tabDefaults`), puis, dans la page, un bloc
 * `{open.maCle && (...)}` ; un onglet générique porte `generic` dans les
 * modules où il n'est pas natif, et sa pièce est partagée (`TopsPanel`).
 */
export interface AnalysisTab<K extends string = string> {
  key: K;
  label: string;
  /** Onglet générique : caché tant que l'activité ne le coche pas. */
  generic?: true;
  /** Onglet de la première rangée, hors d'« avancé » : « général », « fractionné » (22/10) et « test » (24/10). */
  primary?: true;
}

/** Choix d'une activité : seulement les onglets montrés ou cachés à l'écart de leur défaut. */
export type TabChoices = Readonly<Record<string, boolean>>;

export type SailingTab = 'general' | 'tops' | 'manoeuvres' | 'graphiques' | 'cardio' | 'vmg' | 'sauts' | 'vols' | 'pumping' | 'vent' | 'matos' | 'reglages';

/** Voile : une seule barre, dans l'ordre voulu par l'utilisateur. */
export const SAILING_TABS: AnalysisTab<SailingTab>[] = [
  { key: 'general', label: 'général', primary: true },
  { key: 'tops', label: 'tops' },
  { key: 'manoeuvres', label: 'manœuvres' },
  { key: 'graphiques', label: 'graphiques' },
  // Seulement pour une session qui a de la FC (ceinture, montre).
  { key: 'cardio', label: 'cardio' },
  { key: 'vmg', label: 'vmg' },
  // Seulement pour une session aux sauts mesurés par les capteurs du téléphone.
  { key: 'sauts', label: 'sauts' },
  // Sur foil seulement : les vols vus par le GPS, puis le pumping, pour une session qui a ses capteurs (lot 22),
  // les mêmes que les sauts ; deux onglets à part (lot 50, 31/10).
  { key: 'vols', label: 'vols' },
  { key: 'pumping', label: 'pumping' },
  { key: 'vent', label: 'vent' },
  { key: 'matos', label: 'matos et conditions' },
  { key: 'reglages', label: 'réglages' },
];

export type LandTab = 'general' | 'fractionne' | 'test' | 'tops' | 'zones' | 'surface' | 'energie' | 'graphiques' | 'cardio' | 'cadence' | 'sauts' | 'notes' | 'reglages';

/**
 * Course et vélo : « tops » est natif à vélo, générique à pied (course, marche).
 * « graphiques » à la place des zones de pente, « cardio » juste derrière lui
 * (choix de l'utilisateur, 16/10), puis « cadence », à pied seulement.
 */
const landTabs = (topsGeneric: boolean, cadence: boolean): AnalysisTab<LandTab>[] => [
  { key: 'general', label: 'général', primary: true },
  { key: 'fractionne', label: 'fractionné', primary: true },
  // Seulement pour une session qui a son test guidé (`record.test`).
  { key: 'test', label: 'test', primary: true },
  topsGeneric ? { key: 'tops', label: 'tops', generic: true } : { key: 'tops', label: 'tops' },
  { key: 'graphiques', label: 'graphiques' },
  { key: 'cardio', label: 'cardio' },
  // Seulement pour une session qui a de la cadence (capteurs du téléphone, montre).
  ...(cadence ? [{ key: 'cadence' as const, label: 'cadence' }] : []),
  { key: 'surface', label: 'surface' },
  { key: 'energie', label: 'énergie' },
  { key: 'zones', label: 'zones de pente' },
  { key: 'sauts', label: 'sauts' },
  { key: 'notes', label: 'matériel et notes' },
  { key: 'reglages', label: 'réglages' },
];

export const LAND_TABS: Record<'course' | 'velo', AnalysisTab<LandTab>[]> = {
  course: landTabs(true, true),
  velo: landTabs(false, false),
};

export type SurfTab = 'general' | 'vagues' | 'rame' | 'vols' | 'pumping' | 'tops' | 'graphiques' | 'cardio' | 'notes' | 'reglages';

/** Surf (surf, paddle, SUP foil, kayak, downwind) : « tops » est générique. */
export const SURF_TABS: AnalysisTab<SurfTab>[] = [
  { key: 'general', label: 'général', primary: true },
  { key: 'vagues', label: 'vagues' },
  { key: 'rame', label: 'rame' },
  // Sur foil seulement ; « pumping » pour une session qui a ses capteurs, à part des vols (lot 50, 31/10).
  { key: 'vols', label: 'vols' },
  { key: 'pumping', label: 'pumping' },
  { key: 'tops', label: 'tops', generic: true },
  { key: 'graphiques', label: 'graphiques' },
  { key: 'cardio', label: 'cardio' },
  { key: 'notes', label: 'matériel et notes' },
  { key: 'reglages', label: 'réglages' },
];

export type MuscuTab = 'general' | 'test' | 'cardio' | 'notes' | 'reglages';

/**
 * Muscu (lot I du 25/10), sans carte : « général » porte la FC et les phases
 * du compteur, « cardio » le panneau commun (charge, zones, FC max à retenir).
 * « test » : les chiffres de la FC de nuit (lot 213), aux seuls calculs de test
 * (`analysisTabs`, `isTestSport`), donc jamais en muscu.
 */
export const MUSCU_TABS: AnalysisTab<MuscuTab>[] = [
  { key: 'general', label: 'général', primary: true },
  { key: 'test', label: 'test', primary: true },
  { key: 'cardio', label: 'cardio' },
  { key: 'notes', label: 'matériel et notes' },
  { key: 'reglages', label: 'réglages' },
];

const TREATMENT_TABS: Record<Treatment, readonly AnalysisTab[]> = {
  voile: SAILING_TABS,
  course: LAND_TABS.course,
  velo: LAND_TABS.velo,
  surf: SURF_TABS,
  muscu: MUSCU_TABS,
};

/**
 * Onglets d'un calcul, proposés dans Réglages : « sauts » seulement s'il les mesure (ni bateau ni fractionné),
 * « cadence » de même, « pumping » de même (voile sur foil, pas le bateau), « fractionné » aux seuls calculs
 * de fractionné (19/10), « test » aux seuls calculs de test (24/10).
 */
export const analysisTabs = (profile: SportProfile): readonly AnalysisTab[] =>
  TREATMENT_TABS[sportTreatment(profile.id)].filter((tab) => (tab.key !== 'sauts' || profile.jumps !== null) && (tab.key !== 'cadence' || profile.cadence !== null)
    && (tab.key !== 'pumping' || profile.pump !== null)
    && (tab.key !== 'fractionne' || isIntervalSport(profile.id)) && (tab.key !== 'test' || isTestSport(profile.id)));

/**
 * Onglets d'une activité proposés dans Réglages › Onglets : ceux de son calcul
 * (`analysisTabs`), « vols » et « pumping » sur foil seulement, « sauts » si
 * l'activité mesure les sauts (case de Réglages, 05/11). Cocher cette case
 * montre l'onglet (`tabsAfterJumpsChange`). Dans une analyse, « sauts » paraît
 * si la session a sa capture (`useShownJumps`, `visible`) et que le choix
 * d'onglets de l'activité le montre : ce choix prime, la case décochée depuis
 * ne le change pas (un pré-réglage qui cache l'onglet, comme à la course, le
 * cache donc même sur une session à capture).
 */
export const activityTabs = (profile: SportProfile, options: { foil: boolean; jumps: boolean }): readonly AnalysisTab[] =>
  analysisTabs(profile).filter((tab) => ((tab.key !== 'vols' && tab.key !== 'pumping') || options.foil) && (tab.key !== 'sauts' || options.jumps));

/**
 * Onglets ouverts à la première visite d'un module : ceux de la première rangée
 * (`primary`), tous les autres fermés. Plusieurs listes pour un module qui en
 * change avec l'activité (course et vélo : « cadence » n'est qu'à pied) ; le
 * résultat sert de défauts fixes à l'état des onglets (`initialTabsState`).
 */
export const tabDefaults = <K extends string>(...lists: readonly (readonly AnalysisTab<K>[])[]): Record<K, boolean> => {
  const defaults = {} as Record<K, boolean>;
  for (const list of lists) {
    for (const tab of list) defaults[tab.key] = tab.primary === true;
  }
  return defaults;
};

/** Onglet montré : le choix de l'activité, sinon son défaut (natif montré, générique caché). */
export const isTabShown = (tab: AnalysisTab, choices: TabChoices | null | undefined): boolean => {
  const own = choices && Object.hasOwn(choices, tab.key) ? choices[tab.key] : undefined;
  return typeof own === 'boolean' ? own : tab.generic !== true;
};

/** Onglets montrés d'un module, dans l'ordre de sa barre. */
export const shownTabs = <K extends string>(tabs: readonly AnalysisTab<K>[], choices: TabChoices | null | undefined): AnalysisTab<K>[] =>
  tabs.filter((tab) => isTabShown(tab, choices));

/** Clé d'onglet admise dans un choix rangé. */
const MAX_TAB_KEY_LENGTH = 40;

/**
 * Choix rangés relus : un objet de booléens aux clés courtes, le reste ignoré ;
 * `null` s'il n'en reste rien. Une clé d'onglet inconnue est gardée sans être
 * jamais lue : un onglet retiré ne casse rien, un onglet revenu retrouve son choix.
 */
export const sanitizeTabChoices = (value: unknown): TabChoices | null => {
  if (!isObject(value)) return null;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, boolean] => entry[0].length > 0 && entry[0].length <= MAX_TAB_KEY_LENGTH && typeof entry[1] === 'boolean'
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
};

/** Mêmes choix, clé par clé, dans n'importe quel ordre. */
const sameTabChoices = (a: TabChoices, b: TabChoices): boolean => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key]);
};

/**
 * Montre ou cache un onglet ; `null` quand il ne reste rien à ranger. Un choix
 * rangé remplace tout entier le pré-réglage de l'activité (`preset`), qui revient
 * dès qu'il n'y a plus de choix (`resolveTabChoices`) : un onglet du pré-réglage
 * s'écrit donc toujours en clair, un choix égal au pré-réglage s'efface, et un
 * choix vidé qui le ramènerait à tort écrit ses onglets à leur défaut du module
 * (un pré-réglage s'en écarte toujours, c'est sa raison d'être ; testé).
 */
export const toggleTabChoice = (choices: TabChoices | null, tab: AnalysisTab, preset: TabChoices | null): TabChoices | null => {
  const shown = !isTabShown(tab, choices);
  const next: Record<string, boolean> = { ...choices };
  if (shown === (tab.generic !== true) && !(preset && Object.hasOwn(preset, tab.key))) delete next[tab.key];
  else next[tab.key] = shown;
  if (preset && sameTabChoices(next, preset)) return null;
  if (Object.keys(next).length > 0) return next;
  if (!preset) return null;
  return Object.fromEntries(Object.entries(preset).map(([key, value]) => [key, !value]));
};

/**
 * Sections ouvertes, les onglets cachés fermés : un onglet caché
 * n'affiche pas son panneau, même laissé ouvert, et sa surbrillance s'efface.
 * Rend l'objet reçu tel quel quand rien n'est caché.
 */
export const maskHiddenTabs = <K extends string>(
  open: Record<K, boolean>,
  tabs: readonly AnalysisTab<K>[],
  choices: TabChoices | null | undefined
): Record<K, boolean> => {
  let masked: Record<K, boolean> | null = null;
  for (const tab of tabs) {
    if (open[tab.key] && !isTabShown(tab, choices)) {
      masked ??= { ...open };
      masked[tab.key] = false;
    }
  }
  return masked ?? open;
};

/**
 * Sections ouvertes, celles de la rangée « avancé » fermées tant qu'elle l'est :
 * refermer « avancé » replie ses onglets et leurs panneaux, gardés pour sa
 * réouverture (demande du 22/10). Rend l'objet reçu tel quel quand rien ne change.
 */
export const maskAdvancedTabs = <K extends string>(
  open: Record<K, boolean>,
  tabs: readonly AnalysisTab<K>[],
  advancedOpen: boolean
): Record<K, boolean> => {
  if (advancedOpen) return open;
  let masked: Record<K, boolean> | null = null;
  for (const tab of tabs) {
    if (open[tab.key] && tab.primary !== true) {
      masked ??= { ...open };
      masked[tab.key] = false;
    }
  }
  return masked ?? open;
};

/**
 * Ce qu'un onglet fait montrer sur la carte (surbrillance, case cumulable),
 * réduit à ses onglets ouverts : celles d'un onglet fermé partent, et rien ne
 * les ramène à sa réouverture. Rend la liste reçue telle quelle quand rien ne change.
 */
export const keepOpenTabEntries = <K extends string, E extends { panel: K }>(
  entries: readonly E[],
  open: Readonly<Record<K, boolean>>
): readonly E[] => (entries.every((entry) => open[entry.panel]) ? entries : entries.filter((entry) => open[entry.panel]));

/** « général » après un toucher sur « avancé » : l'ouvrir ferme « général », le refermer le rouvre (23/10). */
export const generalOpenAfterAdvanced = (advancedOpen: boolean): boolean => !advancedOpen;

/**
 * Onglets d'une analyse ouverte, en mémoire vive (05/11) : toute ouverture
 * d'une analyse rend « général » seul ouvert, « avancé » fermé ; rien n'est
 * retenu d'une session à l'autre ni d'une visite à l'autre. `key` est la trace
 * dont l'état vient (`sessionKey`).
 */
export interface AnalysisTabsState<K extends string> {
  key: string | null;
  open: Record<K, boolean>;
  advanced: boolean;
}

/**
 * État d'ouverture : les défauts du module (`tabDefaults`), « avancé » fermé ;
 * ou, si `openOn` est donné (onglet du matériel après « Finir », lot 220),
 * « avancé » déplié et cet onglet ouvert seul, « général » fermé.
 */
export const initialTabsState = <K extends string>(defaults: Record<K, boolean>, key: string | null, openOn: K | null = null): AnalysisTabsState<K> =>
  openOn === null
    ? { key, open: { ...defaults }, advanced: false }
    : { key, open: { ...closeAllTabs(defaults), [openOn]: true }, advanced: true };

/**
 * État valable pour la trace `key` : celui reçu s'il en vient, sinon celui
 * d'ouverture (une autre session s'ouvre sur « général » seul, ou sur `openOn`).
 * Une trace pas encore lue (`null`) garde l'état reçu. Rend l'objet reçu tel
 * quel quand rien ne change.
 */
export const tabsStateFor = <K extends string>(
  state: AnalysisTabsState<K>,
  defaults: Record<K, boolean>,
  key: string | null,
  openOn: K | null = null
): AnalysisTabsState<K> =>
  key !== null && key !== state.key ? initialTabsState(defaults, key, openOn) : state;

/**
 * Onglet ouvert depuis ailleurs que sa pastille : la rangée « avancé » se déplie s'il en fait partie, ce qui ferme
 * « général » comme le fait la pastille d'« avancé », et l'onglet s'ouvre. `keepPrimary` (tuile de « général »,
 * lot 234) laisse les onglets de la première rangée comme ils sont : l'onglet s'ouvre en plus. Rend l'état reçu tel
 * quel quand l'onglet est déjà ouvert à l'écran.
 */
export const revealTab = <K extends string>(
  state: AnalysisTabsState<K>,
  tabs: readonly AnalysisTab<K>[],
  key: K,
  options: { keepPrimary?: boolean } = {}
): AnalysisTabsState<K> => {
  const inAdvanced = tabs.find((tab) => tab.key === key)?.primary !== true;
  if (state.open[key] && (!inAdvanced || state.advanced)) return state;
  const open: Record<K, boolean> = { ...state.open, [key]: true };
  if (inAdvanced && !state.advanced && options.keepPrimary !== true) {
    for (const tab of tabs) if (tab.primary === true && tab.key !== key) open[tab.key] = generalOpenAfterAdvanced(true);
  }
  return { ...state, advanced: inAdvanced ? true : state.advanced, open };
};

/**
 * L'onglet est-il ouvert à l'écran ? Ouvert dans l'état, et, s'il est rangé dans « avancé », la rangée dépliée
 * (refermée, elle replie ses onglets sans les oublier, `maskAdvancedTabs`).
 */
export const isTabOpenOnScreen = <K extends string>(state: AnalysisTabsState<K>, tabs: readonly AnalysisTab<K>[], key: K): boolean =>
  state.open[key] === true && (tabs.find((tab) => tab.key === key)?.primary === true || state.advanced);

/**
 * Tuile de « général » touchée (lot 234, repris de Gtracker) : son onglet fermé s'ouvre en plus de « général »
 * (`revealTab` avec `keepPrimary`, « avancé » déplié s'il y est rangé) ; ouvert à l'écran, il se referme, seul :
 * « général » et « avancé » restent comme ils sont.
 */
export const toggleTabFromTile = <K extends string>(state: AnalysisTabsState<K>, tabs: readonly AnalysisTab<K>[], key: K): AnalysisTabsState<K> =>
  isTabOpenOnScreen(state, tabs, key)
    ? { ...state, open: { ...state.open, [key]: false } }
    : revealTab(state, tabs, key, { keepPrimary: true });

/**
 * Onglet que chaque tuile de « général » ouvre, par clé de chiffre (`ShareStat.key`), par module (lot 234). Une
 * tuile absente n'en a pas (distances, temps, moyennes) : elle reste un simple bloc. Clés en chaînes : le code
 * commun n'importe rien de la course ni du vélo (règle 13).
 */
export type TileTabs = Readonly<Record<string, string>>;

export const SAILING_TILE_TABS: Readonly<Record<string, SailingTab>> = {
  top2s: 'tops',
  tacks: 'manoeuvres',
  jibes: 'manoeuvres',
  jumps: 'sauts',
  highestJump: 'sauts',
  pumpCadence: 'pumping',
  pumpShare: 'pumping',
  heartRate: 'cardio',
};

/**
 * Voile sur foil : le premier bloc de « général » (distance, temps total, temps, ratio et moyenne en vol) ouvre
 * l'onglet des vols, même si ses chiffres viennent du seuil de vitesse. Prime sur `SAILING_TILE_TABS`.
 */
export const FLIGHT_TILE_TABS: Readonly<Record<string, SailingTab>> = {
  activeDistance: 'vols', totalTime: 'vols', activeTime: 'vols', activeRatio: 'vols', activeAverage: 'vols',
};

export const SURF_TILE_TABS: Readonly<Record<string, SurfTab>> = {
  waves: 'vagues',
  waveTime: 'vagues',
  longestWave: 'vagues',
  maxSpeed: 'vagues',
  flightTime: 'vols',
  longestFlight: 'vols',
  pumpCadence: 'pumping',
  pumpShare: 'pumping',
  heartRate: 'cardio',
};

/**
 * Course, vélo et fractionné : les meilleurs segments ouvrent « tops », le dénivelé les zones de pente, la FC le
 * cardio, la cadence son onglet, la dépense l'énergie ; distance, temps et moyenne restent de simples blocs (25/11).
 */
export const LAND_TILE_TABS: Readonly<Record<string, LandTab>> = {
  'top-d1km': 'tops',
  'top-t5min': 'tops',
  'top-d10km': 'tops',
  elevationGain: 'zones',
  heartRate: 'cardio',
  cadence: 'cadence',
  energy: 'energie',
};

/**
 * Onglet qu'ouvre la tuile `statKey` de « général » : celui de la première table qui la connaît (`tables`, la plus
 * précise d'abord), pris parmi les onglets montrés pour la session (`shown`, déjà filtrés par l'activité et les
 * données) ; `null` si la tuile n'en a pas, que son onglet n'est pas montré, ou que c'est un onglet de la première rangée.
 */
export const tileTab = <K extends string>(tables: readonly TileTabs[], statKey: string, shown: readonly AnalysisTab<K>[]): AnalysisTab<K> | null => {
  const table = tables.find((t) => Object.hasOwn(t, statKey));
  if (!table) return null;
  const target = table[statKey];
  return shown.find((tab) => tab.key === target && tab.primary !== true) ?? null;
};

/** Ancre HTML du panneau d'un onglet (`ResizablePanel`, `anchorId`), où défile la page quand une tuile l'ouvre. */
export const tabAnchorId = (key: string): string => `an-onglet-${key}`;

/** Hauteur du haut d'un panneau qui doit paraître pour le dire à l'écran : son titre et une ligne. */
export const PANEL_HEAD_VISIBLE_PX = 80;

/**
 * La page doit-elle défiler jusqu'au panneau ouvert ? Non si son haut est déjà à l'écran, sous ce qui colle en
 * haut (`topInset` : barre du haut, bandeaux, barre « Non enregistré ») et au moins `PANEL_HEAD_VISIBLE_PX` au-dessus
 * de ce qui colle en bas (`bottomInset` : barre du bas du téléphone, 0 sur ordinateur) ; oui s'il est caché
 * dessous ou passé au-dessus.
 */
export const panelNeedsScroll = (top: number, topInset: number, viewportH: number, bottomInset = 0): boolean =>
  top < topInset || top > viewportH - bottomInset - PANEL_HEAD_VISIBLE_PX;

/** Clés de l'onglet du matériel : « matos et conditions » en voile, « matériel et notes » ailleurs. */
const GEAR_TAB_KEYS: readonly string[] = ['matos', 'notes'];

/**
 * Onglet du matériel d'un module, à ouvrir seul après « Finir » (lot 220) :
 * `null` si le module n'en a pas ou si l'activité le cache dans Réglages (§11),
 * l'analyse s'ouvre alors comme d'habitude.
 */
export const gearTabToOpen = <K extends string>(tabs: readonly AnalysisTab<K>[], choices: TabChoices | null | undefined): K | null =>
  tabs.find((tab) => GEAR_TAB_KEYS.includes(tab.key) && isTabShown(tab, choices))?.key ?? null;

/** « tout fermer » : chaque onglet fermé, « général » compris ; « avancé » ne change pas (05/11). */
export const closeAllTabs = <K extends string>(open: Record<K, boolean>): Record<K, boolean> =>
  Object.fromEntries(Object.keys(open).map((key) => [key, false])) as Record<K, boolean>;

/**
 * Bouton de droite de la barre (lot 227) : « tout ouvrir » (vert) tant que moins
 * de 2 onglets sont ouverts, « tout fermer » (rouge) dès 2. « avancé » est une
 * pastille, pas un onglet : elle ne compte pas.
 */
export const TABS_BULK_THRESHOLD = 2;
export const tabsBulkAction = (openCount: number): 'open' | 'close' => (openCount >= TABS_BULK_THRESHOLD ? 'close' : 'open');

/**
 * « tout ouvrir » : d'un coup, « avancé » déplié et tous les onglets montrés ouverts,
 * « général » compris (déplier « avancé » seul le fermerait). Les autres clés restent.
 */
export const openAllTabs = <K extends string>(state: AnalysisTabsState<K>, shownKeys: readonly K[]): AnalysisTabsState<K> => {
  const open = { ...state.open };
  for (const key of shownKeys) open[key] = true;
  return { ...state, open, advanced: true };
};
