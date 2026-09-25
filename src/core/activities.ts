import { SPORT_PROFILES, sportFamily, type SportFamily } from './sportProfiles';
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
};

/** Couleurs proposées aux nouvelles activités, dans l'ordre. */
export const ACTIVITY_COLORS = [
  '#1565c0', '#bf360c', '#2e7d32', '#6a1b9a', '#00838f', '#ef6c00', '#ad1457', '#5d4037', '#283593', '#9e9d24',
];

/** Au premier lancement : une activité par famille, sur les identifiants des anciens réglages. */
export const DEFAULT_ACTIVITIES: Activity[] = [
  { id: 'wingfoil', name: 'Voile', base: 'wingfoil', color: BASE_COLOR.wingfoil },
  { id: 'running', name: 'Course', base: 'running', color: BASE_COLOR.running },
];

/** Calcul par défaut d'une famille, pour un module sans activité. */
export const FAMILY_BASE: Record<SportFamily, SportType> = { voile: 'wingfoil', course: 'running' };

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
