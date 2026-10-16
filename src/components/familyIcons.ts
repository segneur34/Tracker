import type { SportFamily } from '../core/sportProfiles';
import { IconBike, IconRun, IconSail, IconStopwatch, IconSurf } from './icons';

/** Icône de chaque famille de sports, partout : barre de navigation, accueil, listes groupées par famille (choix d'activité, Réglages). */
export const FAMILY_ICON: Record<SportFamily, typeof IconSail> = {
  voile: IconSail, course: IconRun, velo: IconBike, fractionne: IconStopwatch, surf: IconSurf,
};
