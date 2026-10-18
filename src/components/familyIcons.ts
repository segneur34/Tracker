import type { ActivityIconId } from '../core/activityIcons';
import type { SportFamily } from '../core/sportProfiles';
import {
  IconBike, IconBikeIntervals, IconGravel, IconKayak, IconKite, IconMtb, IconPaddle, IconPaddleFoil, IconRoadBike, IconRun,
  IconRunIntervals, IconSail, IconSailboat, IconStopwatch, IconSurf, IconSurfFoil, IconSurfer, IconWalk, IconWindsurf, IconWingfoil,
} from './icons';

/** Icône de chaque famille de sports, partout : barre de navigation, accueil, listes groupées par famille (choix d'activité, Réglages). */
export const FAMILY_ICON: Record<SportFamily, typeof IconSail> = {
  voile: IconSail, course: IconRun, velo: IconBike, fractionne: IconStopwatch, surf: IconSurf,
};

/** Petite icône de chaque activité (`activityIcon`) : listes, onglets, Réglages, accueil. */
export const ACTIVITY_ICON: Record<ActivityIconId, typeof IconSail> = {
  bateau: IconSailboat,
  planche: IconWindsurf,
  wingfoil: IconWingfoil,
  kite: IconKite,
  course: IconRun,
  marche: IconWalk,
  route: IconRoadBike,
  vtt: IconMtb,
  gravel: IconGravel,
  surf: IconSurfer,
  'surf-foil': IconSurfFoil,
  kayak: IconKayak,
  paddle: IconPaddle,
  'paddle-foil': IconPaddleFoil,
  'fractionne-velo': IconBikeIntervals,
  'fractionne-pied': IconRunIntervals,
};
