import type { SportFamily } from '../core/sportProfiles';
import { IconBike, IconRun, IconSail, IconStopwatch } from './icons';

/** Icône de chaque famille de sports, dans les listes groupées par famille (choix d'activité, Réglages). */
export const FAMILY_ICON: Record<SportFamily, typeof IconSail> = {
  voile: IconSail, course: IconRun, velo: IconBike, fractionne: IconStopwatch,
};
