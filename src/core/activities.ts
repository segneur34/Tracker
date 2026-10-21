import { SPORT_FAMILIES, SPORT_PROFILES, sportFamily, sportTreatment, type SportFamily, type Treatment } from './sportProfiles';
import type { SportType } from './types';
import { isActivityIconId, type ActivityIconId } from './activityIcons';

/**
 * Activités : ce que l'utilisateur pratique, sous le nom qu'il choisit
 * (« Moth à foil », « Trail », « 10 000 m »). Chacune s'appuie sur un des
 * calculs de `SPORT_PROFILES`, sa base, qui fixe ses valeurs par défaut, sa
 * famille et le module qui l'analyse. Les calculs ne connaissent que la base.
 *
 * Les réglages de l'appareil (unité, seuil, couleurs de trace, pause
 * automatique) sont rangés sous l'identifiant de l'activité. Une activité de
 * base, construite à la volée pour un calcul sans activité, porte
 * l'identifiant du calcul lui-même : c'est sous lui que les réglages étaient
 * rangés avant les activités (§10, point 53), ils restent donc valables.
 */

export interface Activity {
  /** Identifiant stable, clé des réglages et des fiches ; jamais affiché. */
  id: string;
  name: string;
  /** Calcul sur lequel l'activité s'appuie. */
  base: SportType;
  /** Couleur de l'activité dans le graphe de l'accueil (donnée de graphe, en dur). */
  color: string;
  /**
   * Cachée dans Réglages : ni proposée, ni listée, ses sessions comprises ;
   * rien n'est effacé, la ré-afficher rend tout (§10, point 100).
   */
  hidden?: true;
  /** Icône choisie dans Réglages ; absente, elle est devinée du nom et du calcul (`activityIcon`). */
  icon?: ActivityIconId;
}

/**
 * Nuances de chaque famille (§10, point 90) : la première est la couleur de la
 * famille (`--voile`, `--course`… de `theme/tokens.css`, qui porte du texte
 * blanc, contraste d'au moins 4,5 sur blanc) ; les suivantes, d'un contraste
 * d'au moins 3, vont aux activités dans cet ordre (`nextActivityColor`).
 * Toutes distinctes, d'une famille à l'autre comprises (`palette.test.ts`).
 * Rouge, orange et vert ne se séparent que par leur clarté pour un daltonien :
 * une famille ne se montre jamais par sa seule couleur.
 */
export const FAMILY_SHADES: Record<SportFamily, readonly string[]> = {
  voile: ['#1976d2', '#014e86', '#5b87f2', '#4458c2', '#192f94', '#0c92ce'],
  course: ['#d42a3c', '#970029', '#f0504a', '#b9045d', '#6e1020', '#d6336c'],
  velo: ['#1e7a3c', '#015215', '#0a9469', '#6f9a3a', '#056245', '#2e9d2a'],
  fractionne: ['#c25700', '#873e04', '#dc7810', '#9f6c00', '#5f3104', '#b8860b'],
  // Gris un peu teintés, bleutés ou chauds : des gris purs ne se sépareraient que par leur clarté (point 97).
  surf: ['#5b6670', '#8292a6', '#847c6e', '#223246', '#2e2610', '#0a1a2e'],
};

/** Couleur de chaque calcul, pour ses activités de base : une nuance de sa famille. */
export const BASE_COLOR: Record<SportType, string> = {
  wingfoil: FAMILY_SHADES.voile[0],
  windsurf: FAMILY_SHADES.voile[5],
  kite: FAMILY_SHADES.voile[3],
  bateau: FAMILY_SHADES.voile[1],
  running: FAMILY_SHADES.course[0],
  cycling: FAMILY_SHADES.velo[0],
  'run-intervals': FAMILY_SHADES.fractionne[0],
  'bike-intervals': FAMILY_SHADES.fractionne[1],
  surf: FAMILY_SHADES.surf[0],
};

/** Activité vélo de départ, sur l'identifiant du calcul ; appelée « Vélo » avant le point 81. */
const ROUTE_ACTIVITY: Activity = { id: 'cycling', name: 'Route', base: 'cycling', color: BASE_COLOR.cycling };
/** Activité à pied de départ à côté de Course (20/10) ; ses bornes de couleur et son temps estimé par défaut suivent (`useSportSettings.ts`). */
export const MARCHE_ACTIVITY: Activity = { id: 'a-marche', name: 'Marche', base: 'running', color: FAMILY_SHADES.course[1] };
/** Activités vélo de départ à côté de Route (§10, point 81) ; leur type de vélo par défaut suit (`useSportSettings.ts`). */
export const GRAVEL_ACTIVITY: Activity = { id: 'a-gravel', name: 'Gravel', base: 'cycling', color: FAMILY_SHADES.velo[1] };
export const VTT_ACTIVITY: Activity = { id: 'a-vtt', name: 'VTT', base: 'cycling', color: FAMILY_SHADES.velo[2] };
/** Activités de la famille Fractionné (§10, point 89), sur l'identifiant de leur calcul. */
export const RUN_INTERVALS_ACTIVITY: Activity = {
  id: 'run-intervals', name: 'Fractionné à pied', base: 'run-intervals', color: BASE_COLOR['run-intervals'],
};
export const BIKE_INTERVALS_ACTIVITY: Activity = {
  id: 'bike-intervals', name: 'Fractionné vélo', base: 'bike-intervals', color: BASE_COLOR['bike-intervals'],
};
/** Activités de la famille Surf (§10, point 97) ; le foil de « Surf foil » est coché d'office (`useSportSettings.ts`). */
export const SURF_ACTIVITY: Activity = { id: 'surf', name: 'Surf', base: 'surf', color: BASE_COLOR.surf };
export const SURF_FOIL_ACTIVITY: Activity = { id: 'a-surf-foil', name: 'Surf foil', base: 'surf', color: FAMILY_SHADES.surf[1] };

/**
 * Au premier lancement : une activité par famille, sur l'identifiant de son
 * calcul (celui des anciens réglages), plus la Marche, Gravel et VTT, les
 * deux du fractionné et les deux du surf.
 */
export const DEFAULT_ACTIVITIES: Activity[] = [
  { id: 'wingfoil', name: 'Voile', base: 'wingfoil', color: BASE_COLOR.wingfoil },
  { id: 'running', name: 'Course', base: 'running', color: BASE_COLOR.running },
  MARCHE_ACTIVITY,
  ROUTE_ACTIVITY,
  GRAVEL_ACTIVITY,
  VTT_ACTIVITY,
  RUN_INTERVALS_ACTIVITY,
  BIKE_INTERVALS_ACTIVITY,
  SURF_ACTIVITY,
  SURF_FOIL_ACTIVITY,
];

/**
 * Version de la liste des activités rangée dans les réglages. 2 : Route,
 * Gravel et VTT dans la famille Vélo (point 81) ; 3 : les deux activités du
 * fractionné (point 89) ; 4 : couleurs prises dans les nuances de la famille
 * (point 90) ; 5 : Surf et Surf foil (point 97) ; 6 : Marche (20/10). Une liste d'avant est mise à jour une fois
 * (`upgradeActivities`) ; toute liste écrite ensuite porte ce numéro, pour
 * qu'une activité supprimée ne revienne pas.
 */
export const ACTIVITIES_VERSION = 6;

/** Activités ajoutées à une liste d'avant, avec la version de la liste qui les a apportées. */
const ACTIVITY_SEEDS: { version: number; activity: Activity }[] = [
  { version: 2, activity: GRAVEL_ACTIVITY },
  { version: 2, activity: VTT_ACTIVITY },
  { version: 3, activity: RUN_INTERVALS_ACTIVITY },
  { version: 3, activity: BIKE_INTERVALS_ACTIVITY },
  { version: 5, activity: SURF_ACTIVITY },
  { version: 5, activity: SURF_FOIL_ACTIVITY },
  { version: 6, activity: MARCHE_ACTIVITY },
];

/** Ancien nom de l'activité vélo de départ, devenue « Route ». */
const LEGACY_CYCLING_NAME = 'Vélo';

/** Calcul par défaut d'une famille, pour un module sans activité. */
export const FAMILY_BASE: Record<SportFamily, SportType> = {
  voile: 'wingfoil', course: 'running', velo: 'cycling', fractionne: 'run-intervals', surf: 'surf',
};

/** Nom d'une famille, tel que l'interface l'affiche. */
export const FAMILY_LABEL: Record<SportFamily, string> = {
  voile: 'Voile', course: 'À pied', velo: 'Vélo', fractionne: 'Fractionné', surf: 'Surf',
};

/** Couleur d'interface d'une famille (variable du thème). */
export const FAMILY_ACCENT: Record<SportFamily, string> = {
  voile: 'var(--voile)', course: 'var(--course)', velo: 'var(--velo)', fractionne: 'var(--fractionne)', surf: 'var(--surf)',
};

const isSportType = (value: unknown): value is SportType =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(SPORT_PROFILES, value);

const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

/**
 * Liste des activités telle que les réglages la gardent. Absente : celles du
 * premier lancement. Une entrée abîmée est écartée, un doublon d'identifiant
 * aussi ; une liste vide reste vide (l'utilisateur a tout supprimé).
 */
export const readActivities = (raw: unknown): Activity[] => {
  if (!Array.isArray(raw)) return DEFAULT_ACTIVITIES;
  const seen = new Set<string>();
  const list: Activity[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, name, base, color, hidden, icon } = item as Record<string, unknown>;
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
    if (typeof name !== 'string' || name.trim() === '' || !isSportType(base)) continue;
    seen.add(id);
    list.push({
      id, name: name.trim(), base, color: isColor(color) ? color : BASE_COLOR[base],
      ...(hidden === true ? { hidden } : {}),
      ...(isActivityIconId(icon) ? { icon } : {}),
    });
  }
  return list;
};

/** Activité de base d'un calcul : son libellé, sa couleur, son identifiant. */
export const baseActivity = (sport: SportType): Activity => ({
  id: sport,
  name: SPORT_PROFILES[sport].label,
  base: sport,
  color: BASE_COLOR[sport],
});

export const activityFamily = (activity: Activity): SportFamily => sportFamily(activity.base);

export const activityTreatment = (activity: Activity): Treatment => sportTreatment(activity.base);

export const activitiesOfFamily = (activities: Activity[], family: SportFamily): Activity[] =>
  activities.filter((a) => activityFamily(a) === family);

/**
 * Famille cachée (§10, point 100) : cachée dans Réglages, ou sans activité
 * visible, qu'elles soient toutes cachées ou qu'elle n'en ait aucune (choix de
 * l'utilisateur). Une activité ajoutée dans Réglages la fait revenir.
 */
export const isFamilyHidden = (activities: Activity[], hiddenFamilies: readonly SportFamily[], family: SportFamily): boolean =>
  hiddenFamilies.includes(family) || activitiesOfFamily(activities, family).every((a) => a.hidden);

/** Familles visibles, dans l'ordre de `families` (toutes par défaut). */
export const visibleFamilies = (
  activities: Activity[], hiddenFamilies: readonly SportFamily[], families: readonly SportFamily[] = SPORT_FAMILIES
): SportFamily[] => families.filter((f) => !isFamilyHidden(activities, hiddenFamilies, f));

/**
 * Activité visible : ni cachée elle-même, ni dans une famille cachée. Une
 * activité de base (supprimée, ou session sans activité) suit sa famille.
 */
export const isActivityShown = (activity: Activity, activities: Activity[], hiddenFamilies: readonly SportFamily[]): boolean =>
  !activity.hidden && !isFamilyHidden(activities, hiddenFamilies, activityFamily(activity));

/**
 * Activité de Fractionné proposée pour une sortie à pied ou à vélo faite avec
 * le compteur d'intervalles (19/10) : la première de `candidates` (les
 * activités visibles du Fractionné) au même traitement, à pied ou à vélo.
 * `null` pour une session déjà en Fractionné, en voile ou en surf, ou sans
 * activité qui convienne : rien à demander.
 */
export const intervalActivityFor = (activity: Activity, candidates: readonly Activity[]): Activity | null => {
  if (activityFamily(activity) === 'fractionne') return null;
  const treatment = activityTreatment(activity);
  if (treatment !== 'course' && treatment !== 'velo') return null;
  return candidates.find((a) => activityFamily(a) === 'fractionne' && activityTreatment(a) === treatment) ?? null;
};

/** Activité cachée ou ré-affichée ; une activité visible ne porte pas le champ. */
export const withHidden = (activity: Activity, hidden: boolean): Activity => {
  const { hidden: _was, ...rest } = activity;
  return hidden ? { ...rest, hidden: true } : rest;
};

/** Activités visibles, d'une famille ou de toutes, dans l'ordre de la liste. */
export const visibleActivities = (activities: Activity[], hiddenFamilies: readonly SportFamily[], family?: SportFamily): Activity[] =>
  (family ? activitiesOfFamily(activities, family) : activities).filter((a) => isActivityShown(a, activities, hiddenFamilies));

/**
 * Activité désignée par un identifiant : une de la liste, sinon celle de base
 * si l'identifiant est un calcul, sinon `null`.
 */
export const findActivity = (activities: Activity[], id: string | null | undefined): Activity | null => {
  if (!id) return null;
  return activities.find((a) => a.id === id) ?? (isSportType(id) ? baseActivity(id) : null);
};

/**
 * Activité d'une session, d'après sa fiche.
 * - Elle en désigne une qui existe : celle-là.
 * - Elle en désigne une supprimée depuis : l'activité de base de son calcul
 *   (les sessions restent, sous le nom du calcul).
 * - Elle n'en désigne aucune (fiche d'avant les activités, import) : la
 *   première activité de son calcul, sinon l'activité de base.
 * - Sans calcul (session à classer) : `null`.
 */
export const sessionActivity = (
  activities: Activity[],
  activityId: string | null | undefined,
  sport: SportType | null
): Activity | null => {
  if (sport === null) return null;
  if (activityId) {
    const chosen = activities.find((a) => a.id === activityId);
    return chosen && chosen.base === sport ? chosen : baseActivity(sport);
  }
  return activities.find((a) => a.id === sport) ?? activities.find((a) => a.base === sport) ?? baseActivity(sport);
};

/** Nom sans casse, accents ni espaces autour, pour reconnaître une activité déjà créée. */
const foldName = (name: string): string =>
  name.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');

/**
 * Liste de la version `fromVersion` mise à jour (`ACTIVITIES_VERSION`) : seul
 * ce qu'ont apporté les versions suivantes s'ajoute, pour qu'une activité
 * supprimée depuis ne revienne pas.
 * - Version 2 : l'activité vélo de départ, si elle s'appelle encore « Vélo »,
 *   devient « Route » (même identifiant, donc mêmes sessions et mêmes
 *   réglages) ; Gravel et VTT s'ajoutent.
 * - Version 3 : les deux activités du fractionné.
 * - Version 4 : chaque activité dont la couleur n'est pas une nuance de sa
 *   famille, ou en porte une déjà prise plus haut dans la liste, reçoit la
 *   première nuance libre de sa famille (`recolorActivities`).
 * - Version 5 : les deux activités du surf.
 * - Version 6 : la Marche.
 *
 * Une activité ajoutée se range avec sa famille, sauf si une autre porte déjà
 * son identifiant, ou son nom dans la même famille (casse et accents ignorés :
 * une « marche » créée avant reste seule) ; sa couleur, si une autre
 * la porte déjà, est la première nuance libre.
 */
export const upgradeActivities = (activities: Activity[], fromVersion: number): Activity[] => {
  const sameName = (a: string, b: string) => foldName(a) === foldName(b);
  let list = fromVersion >= 2 ? activities : activities.map((a) =>
    a.id === ROUTE_ACTIVITY.id && a.name === LEGACY_CYCLING_NAME ? { ...a, name: ROUTE_ACTIVITY.name } : a
  );
  for (const { version, activity: seed } of ACTIVITY_SEEDS) {
    if (version <= fromVersion) continue;
    const family = activityFamily(seed);
    if (list.some((a) => a.id === seed.id || (activityFamily(a) === family && sameName(a.name, seed.name)))) continue;
    const color = list.some((a) => a.color.toLowerCase() === seed.color) ? nextActivityColor(list, family) : seed.color;
    list = insertActivity(list, { ...seed, color });
  }
  return fromVersion >= 4 ? list : recolorActivities(list);
};

/**
 * Liste où chaque activité porte une nuance de sa famille, distincte des
 * autres. Une nuance déjà juste est gardée, la première fois qu'elle paraît ;
 * les autres activités reçoivent, dans l'ordre de la liste, la première
 * nuance libre : sur une liste d'avant le point 90, la première activité de
 * chaque famille prend donc la couleur de la famille.
 */
export const recolorActivities = (activities: Activity[]): Activity[] => {
  const kept = new Set<string>();
  const keeps = activities.map((a) => {
    const color = a.color.toLowerCase();
    const ok = FAMILY_SHADES[activityFamily(a)].includes(color) && !kept.has(color);
    if (ok) kept.add(color);
    return ok;
  });
  const list = activities.filter((_, i) => keeps[i]);
  return activities.map((a, i) => {
    if (keeps[i]) return a;
    const recolored = { ...a, color: nextActivityColor(list, activityFamily(a)) };
    list.push(recolored);
    return recolored;
  });
};

/**
 * Liste avec une activité de plus, rangée avec sa famille : après la dernière
 * de la même famille ; sans elle, avant la première d'une famille qui la suit
 * (ordre de `SPORT_FAMILIES`), sinon à la fin. Une liste rangée par famille
 * le reste.
 */
export const insertActivity = (activities: Activity[], activity: Activity): Activity[] => {
  const family = activityFamily(activity);
  const families = activities.map(activityFamily);
  const lastSame = families.lastIndexOf(family);
  const rank = SPORT_FAMILIES.indexOf(family);
  const firstLater = families.findIndex((f) => SPORT_FAMILIES.indexOf(f) > rank);
  const at = lastSame >= 0 ? lastSame + 1 : firstLater >= 0 ? firstLater : activities.length;
  return [...activities.slice(0, at), activity, ...activities.slice(at)];
};

/**
 * Identifiant d'une nouvelle activité, tiré de son nom et unique. Le préfixe
 * `a-` l'empêche de se confondre avec un calcul, donc avec une activité de base.
 */
export const newActivityId = (name: string, existing: Activity[]): string => {
  const slug =
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'activite';
  const taken = new Set(existing.map((a) => a.id));
  let id = `a-${slug}`;
  for (let n = 2; taken.has(id); n++) id = `a-${slug}-${n}`;
  return id;
};

/**
 * Couleur d'une nouvelle activité de la famille : la première de ses nuances
 * qu'aucune activité ne porte encore ; les six prises, elles reviennent dans
 * l'ordre.
 */
export const nextActivityColor = (activities: Activity[], family: SportFamily): string => {
  const shades = FAMILY_SHADES[family];
  const used = new Set(activities.map((a) => a.color.toLowerCase()));
  return shades.find((c) => !used.has(c)) ?? shades[activitiesOfFamily(activities, family).length % shades.length];
};

export interface ActivityCount {
  activity: Activity;
  count: number;
}

/**
 * Onglets d'une liste filtrable par activité : les activités présentes parmi
 * `itemActivities` (une par élément, `null` s'il n'en a pas), dans l'ordre de
 * `ordered` puis dans l'ordre d'apparition, avec leur nombre d'éléments.
 */
export const activityCounts = (itemActivities: (Activity | null)[], ordered: Activity[]): ActivityCount[] => {
  const byId = new Map<string, ActivityCount>();
  for (const a of ordered) byId.set(a.id, { activity: a, count: 0 });
  for (const a of itemActivities) {
    if (!a) continue;
    const entry = byId.get(a.id) ?? { activity: a, count: 0 };
    byId.set(a.id, { ...entry, count: entry.count + 1 });
  }
  return [...byId.values()].filter((e) => e.count > 0);
};
