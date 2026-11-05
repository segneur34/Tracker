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

export type MuscuTab = 'general' | 'cardio' | 'notes' | 'reglages';

/**
 * Muscu (lot I du 25/10), sans carte : « général » porte la FC et les phases
 * du compteur, « cardio » le panneau commun (charge, zones, FC max à retenir).
 */
export const MUSCU_TABS: AnalysisTab<MuscuTab>[] = [
  { key: 'general', label: 'général', primary: true },
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

/** État d'ouverture : les défauts du module (`tabDefaults`), « avancé » fermé. */
export const initialTabsState = <K extends string>(defaults: Record<K, boolean>, key: string | null): AnalysisTabsState<K> => ({
  key, open: { ...defaults }, advanced: false,
});

/**
 * État valable pour la trace `key` : celui reçu s'il en vient, sinon les défauts
 * (une autre session s'ouvre sur « général » seul). Une trace pas encore lue
 * (`null`) garde l'état reçu. Rend l'objet reçu tel quel quand rien ne change.
 */
export const tabsStateFor = <K extends string>(state: AnalysisTabsState<K>, defaults: Record<K, boolean>, key: string | null): AnalysisTabsState<K> =>
  key !== null && key !== state.key ? initialTabsState(defaults, key) : state;

/** « tout fermer » : chaque onglet fermé, « général » compris ; « avancé » ne change pas (05/11). */
export const closeAllTabs = <K extends string>(open: Record<K, boolean>): Record<K, boolean> =>
  Object.fromEntries(Object.keys(open).map((key) => [key, false])) as Record<K, boolean>;
