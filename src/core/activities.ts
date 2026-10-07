import { SPORT_FAMILIES, SPORT_PROFILES, sportFamily, type SportFamily } from './sportProfiles';
import type { SportType } from './types';

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
}

/** Couleur de chaque calcul, pour ses activités de base et comme première proposition. */
export const BASE_COLOR: Record<SportType, string> = {
  wingfoil: '#1565c0',
  windsurf: '#00838f',
  kite: '#6a1b9a',
  bateau: '#283593',
  running: '#bf360c',
  cycling: '#00695c',
};

/** Couleurs proposées aux nouvelles activités, dans l'ordre. */
export const ACTIVITY_COLORS = [
  '#1565c0', '#bf360c', '#2e7d32', '#6a1b9a', '#00838f', '#ef6c00', '#ad1457', '#5d4037', '#283593', '#9e9d24',
];

/** Activité vélo de départ, sur l'identifiant du calcul ; appelée « Vélo » avant le point 81. */
const ROUTE_ACTIVITY: Activity = { id: 'cycling', name: 'Route', base: 'cycling', color: BASE_COLOR.cycling };
/** Activités vélo de départ à côté de Route (§10, point 81) ; leur type de vélo par défaut suit (`useSportSettings.ts`). */
export const GRAVEL_ACTIVITY: Activity = { id: 'a-gravel', name: 'Gravel', base: 'cycling', color: '#9e9d24' };
export const VTT_ACTIVITY: Activity = { id: 'a-vtt', name: 'VTT', base: 'cycling', color: '#5d4037' };

/** Au premier lancement : une activité par famille, sur l'identifiant de son calcul (celui des anciens réglages), plus Gravel et VTT. */
export const DEFAULT_ACTIVITIES: Activity[] = [
  { id: 'wingfoil', name: 'Voile', base: 'wingfoil', color: BASE_COLOR.wingfoil },
  { id: 'running', name: 'Course', base: 'running', color: BASE_COLOR.running },
  ROUTE_ACTIVITY,
  GRAVEL_ACTIVITY,
  VTT_ACTIVITY,
];

/**
 * Version de la liste des activités rangée dans les réglages. 2 : Route,
 * Gravel et VTT dans la famille Vélo (point 81). Une liste d'avant est mise
 * à jour une fois (`upgradeActivities`) ; toute liste écrite ensuite porte ce
 * numéro, pour qu'une activité supprimée ne revienne pas.
 */
export const ACTIVITIES_VERSION = 2;

/** Ancien nom de l'activité vélo de départ, devenue « Route ». */
const LEGACY_CYCLING_NAME = 'Vélo';

/** Calcul par défaut d'une famille, pour un module sans activité. */
export const FAMILY_BASE: Record<SportFamily, SportType> = { voile: 'wingfoil', course: 'running', velo: 'cycling' };

/** Nom d'une famille, tel que l'interface l'affiche. */
export const FAMILY_LABEL: Record<SportFamily, string> = { voile: 'Voile', course: 'Course à pied', velo: 'Vélo' };

/** Couleur d'interface d'une famille (variable du thème). */
export const FAMILY_ACCENT: Record<SportFamily, string> = { voile: 'var(--voile)', course: 'var(--course)', velo: 'var(--velo)' };

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
    const { id, name, base, color } = item as Record<string, unknown>;
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
    if (typeof name !== 'string' || name.trim() === '' || !isSportType(base)) continue;
    seen.add(id);
    list.push({ id, name: name.trim(), base, color: isColor(color) ? color : BASE_COLOR[base] });
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

export const activitiesOfFamily = (activities: Activity[], family: SportFamily): Activity[] =>
  activities.filter((a) => activityFamily(a) === family);

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

/**
 * Liste d'une version d'avant mise à jour (`ACTIVITIES_VERSION`). L'activité
 * vélo de départ, si elle s'appelle encore « Vélo », devient « Route » : même
 * identifiant, donc mêmes sessions et mêmes réglages. Gravel et VTT
 * s'ajoutent après la dernière activité vélo, sauf si l'une porte déjà leur
 * identifiant ou leur nom ; leur couleur, si une autre la porte déjà, est la
 * première libre.
 */
export const upgradeActivities = (activities: Activity[]): Activity[] => {
  const sameName = (a: string, b: string) => a.toLocaleLowerCase('fr') === b.toLocaleLowerCase('fr');
  let list = activities.map((a) =>
    a.id === ROUTE_ACTIVITY.id && a.name === LEGACY_CYCLING_NAME ? { ...a, name: ROUTE_ACTIVITY.name } : a
  );
  for (const seed of [GRAVEL_ACTIVITY, VTT_ACTIVITY]) {
    if (list.some((a) => a.id === seed.id || (activityFamily(a) === 'velo' && sameName(a.name, seed.name)))) continue;
    const color = list.some((a) => a.color.toLowerCase() === seed.color) ? nextActivityColor(list) : seed.color;
    list = insertActivity(list, { ...seed, color });
  }
  return list;
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
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'activite';
  const taken = new Set(existing.map((a) => a.id));
  let id = `a-${slug}`;
  for (let n = 2; taken.has(id); n++) id = `a-${slug}-${n}`;
  return id;
};

/** Première couleur de la palette qu'aucune activité n'utilise encore. */
export const nextActivityColor = (activities: Activity[]): string => {
  const used = new Set(activities.map((a) => a.color.toLowerCase()));
  return ACTIVITY_COLORS.find((c) => !used.has(c)) ?? ACTIVITY_COLORS[activities.length % ACTIVITY_COLORS.length];
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
