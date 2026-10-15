import { sportTreatment, type SportProfile, type Treatment } from './sportProfiles';

/**
 * Onglets des analyses, par module, dans l'ordre de leur barre. Chaque
 * activité choisit dans Réglages ceux qu'elle montre : un onglet du module
 * est montré tant qu'on ne le cache pas, un onglet générique (`generic`) est
 * caché tant qu'on ne le coche pas. Tous se cachent, « général » et
 * « réglages » compris (choix de l'utilisateur, 14/10).
 *
 * Pour ajouter un onglet : une entrée dans la liste de son module, puis, dans
 * la page, une valeur par défaut dans `*_SECTION_DEFAULTS` et un bloc
 * `{open.maCle && (...)}` ; un onglet générique porte `generic` dans les
 * modules où il n'est pas natif, et sa pièce est partagée (`TopsPanel`).
 */
export interface AnalysisTab<K extends string = string> {
  key: K;
  label: string;
  /** Onglet générique : caché tant que l'activité ne le coche pas. */
  generic?: true;
}

/** Choix d'une activité : seulement les onglets montrés ou cachés à l'écart de leur défaut. */
export type TabChoices = Readonly<Record<string, boolean>>;

export type SailingTab = 'general' | 'tops' | 'manoeuvres' | 'graphiques' | 'vmg' | 'sauts' | 'vent' | 'matos' | 'reglages';

/** Voile : une seule barre, dans l'ordre voulu par l'utilisateur. */
export const SAILING_TABS: AnalysisTab<SailingTab>[] = [
  { key: 'general', label: 'général' },
  { key: 'tops', label: 'tops' },
  { key: 'manoeuvres', label: 'manœuvres' },
  { key: 'graphiques', label: 'graphiques' },
  { key: 'vmg', label: 'vmg' },
  // Seulement pour une session aux sauts mesurés par les capteurs du téléphone.
  { key: 'sauts', label: 'sauts' },
  { key: 'vent', label: 'vent' },
  { key: 'matos', label: 'matos et conditions' },
  { key: 'reglages', label: 'réglages' },
];

export type LandTab = 'general' | 'fractionne' | 'tops' | 'zones' | 'surface' | 'energie' | 'graphiques' | 'sauts' | 'notes' | 'reglages';

/** Course et vélo : « tops » est natif à vélo, générique à pied (course, marche). */
const landTabs = (topsGeneric: boolean): AnalysisTab<LandTab>[] => [
  { key: 'general', label: 'général' },
  { key: 'fractionne', label: 'fractionné' },
  topsGeneric ? { key: 'tops', label: 'tops', generic: true } : { key: 'tops', label: 'tops' },
  { key: 'zones', label: 'zones de pente' },
  { key: 'surface', label: 'surface' },
  { key: 'energie', label: 'énergie' },
  { key: 'graphiques', label: 'vitesse et altitude' },
  { key: 'sauts', label: 'sauts' },
  { key: 'notes', label: 'matériel et notes' },
  { key: 'reglages', label: 'réglages' },
];

export const LAND_TABS: Record<'course' | 'velo', AnalysisTab<LandTab>[]> = {
  course: landTabs(true),
  velo: landTabs(false),
};

export type SurfTab = 'general' | 'vagues' | 'rame' | 'vols' | 'tops' | 'graphiques' | 'notes' | 'reglages';

/** Surf (surf, paddle, SUP foil, kayak, downwind) : « tops » est générique. */
export const SURF_TABS: AnalysisTab<SurfTab>[] = [
  { key: 'general', label: 'général' },
  { key: 'vagues', label: 'vagues' },
  { key: 'rame', label: 'rame' },
  // Sur foil seulement.
  { key: 'vols', label: 'vols' },
  { key: 'tops', label: 'tops', generic: true },
  { key: 'graphiques', label: 'graphiques' },
  { key: 'notes', label: 'matériel et notes' },
  { key: 'reglages', label: 'réglages' },
];

const TREATMENT_TABS: Record<Treatment, readonly AnalysisTab[]> = {
  voile: SAILING_TABS,
  course: LAND_TABS.course,
  velo: LAND_TABS.velo,
  surf: SURF_TABS,
};

/** Onglets d'un calcul, proposés dans Réglages : « sauts » seulement s'il les mesure (ni bateau ni fractionné). */
export const analysisTabs = (profile: SportProfile): readonly AnalysisTab[] =>
  TREATMENT_TABS[sportTreatment(profile.id)].filter((tab) => tab.key !== 'sauts' || profile.jumps !== null);

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
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value).filter(
    ([key, shown]) => key.length > 0 && key.length <= MAX_TAB_KEY_LENGTH && typeof shown === 'boolean'
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
};

/** Montre ou cache un onglet ; un choix revenu au défaut s'efface, `null` quand il n'en reste aucun. */
export const toggleTabChoice = (choices: TabChoices | null, tab: AnalysisTab): TabChoices | null => {
  const shown = !isTabShown(tab, choices);
  const next: Record<string, boolean> = { ...choices };
  if (shown === (tab.generic !== true)) delete next[tab.key];
  else next[tab.key] = shown;
  return Object.keys(next).length > 0 ? next : null;
};

/**
 * Sections ouvertes mémorisées, les onglets cachés fermés : un onglet caché
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
