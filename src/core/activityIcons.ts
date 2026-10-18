import type { Activity } from './activities';
import type { SportType } from './types';

/**
 * Icône d'une activité : choisie dans Réglages parmi cette liste, sinon
 * devinée de son nom puis de son calcul. Plus d'icônes que de calculs : kayak,
 * paddle ou marche vont aux activités que l'utilisateur crée sur un calcul
 * voisin (surf, course).
 */

export const ACTIVITY_ICON_IDS = [
  'bateau', 'planche', 'wingfoil', 'kite',
  'course', 'marche', 'route', 'vtt', 'gravel',
  'surf', 'surf-foil', 'kayak', 'paddle', 'paddle-foil',
  'fractionne-velo', 'fractionne-pied',
] as const;

export type ActivityIconId = (typeof ACTIVITY_ICON_IDS)[number];

export const ACTIVITY_ICON_LABEL: Record<ActivityIconId, string> = {
  bateau: 'Bateau à voile',
  planche: 'Planche à voile',
  wingfoil: 'Wingfoil',
  kite: 'Kitesurf',
  course: 'Course',
  marche: 'Marche',
  route: 'Vélo de route',
  vtt: 'VTT',
  gravel: 'Gravel',
  surf: 'Surf',
  'surf-foil': 'Surf foil',
  kayak: 'Kayak',
  paddle: 'Paddle',
  'paddle-foil': 'Paddle foil',
  'fractionne-velo': 'Fractionné vélo',
  'fractionne-pied': 'Fractionné à pied',
};

export const isActivityIconId = (value: unknown): value is ActivityIconId =>
  typeof value === 'string' && (ACTIVITY_ICON_IDS as readonly string[]).includes(value);

/** Icône de chaque calcul, quand le nom ne dit rien. */
const BASE_ICON: Record<SportType, ActivityIconId> = {
  wingfoil: 'wingfoil',
  windsurf: 'planche',
  kite: 'kite',
  bateau: 'bateau',
  running: 'course',
  cycling: 'route',
  'run-intervals': 'fractionne-pied',
  'bike-intervals': 'fractionne-velo',
  surf: 'surf',
};

/** Activités de départ qui partagent leur calcul avec une autre (`DEFAULT_ACTIVITIES`). */
const ID_ICON: Record<string, ActivityIconId> = { 'a-gravel': 'gravel', 'a-vtt': 'vtt', 'a-surf-foil': 'surf-foil' };

/** Mots du nom, du plus précis au plus large : « paddle foil » avant « paddle », avant « foil ». */
const NAME_ICON: { pattern: RegExp; icon: ActivityIconId; bases?: readonly SportType[] }[] = [
  { pattern: /\b(paddle|sup\b|stand ?up).*\bfoil|\bfoil.*\b(paddle|sup\b|stand ?up)/, icon: 'paddle-foil' },
  { pattern: /\b(paddle|sup\b|stand ?up)/, icon: 'paddle' },
  { pattern: /\b(kayak|cano|pirogue|pagaie)/, icon: 'kayak' },
  { pattern: /\b(marche|rando|trek|balade|promenade)/, icon: 'marche' },
  { pattern: /\bgravel/, icon: 'gravel' },
  { pattern: /\b(vtt|mtb|enduro|descente)/, icon: 'vtt' },
  { pattern: /\bkite/, icon: 'kite' },
  { pattern: /\bwing/, icon: 'wingfoil' },
  { pattern: /\b(planche|windsurf|windfoil)/, icon: 'planche' },
  { pattern: /\b(bateau|voilier|dériveur|deriveur|catamaran|moth|laser|optimist|régate|regate)/, icon: 'bateau' },
  { pattern: /\bfoil/, icon: 'surf-foil', bases: ['surf'] },
];

/** Icône devinée du nom, de l'identifiant d'une activité de départ, sinon du calcul. */
export const guessActivityIcon = (name: string, base: SportType, id = ''): ActivityIconId => {
  if (ID_ICON[id]) return ID_ICON[id];
  const lower = name.toLowerCase();
  const match = NAME_ICON.find((rule) => (!rule.bases || rule.bases.includes(base)) && rule.pattern.test(lower));
  return match?.icon ?? BASE_ICON[base];
};

/** Icône d'une activité : celle choisie, sinon la devinée. */
export const activityIcon = (activity: Activity): ActivityIconId =>
  activity.icon ?? guessActivityIcon(activity.name, activity.base, activity.id);
