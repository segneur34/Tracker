import type { LessonIcon as LessonIconId } from '../tutorials/lessons';
import {
  IconChart, IconFile, IconLayers, IconMap, IconNote, IconPlay, IconPulse, IconRoute, IconRunIntervals, IconSail,
  IconSettings, IconShare, IconUser, IconWingfoil,
} from './icons';

const ICONS: Record<LessonIconId, typeof IconChart> = {
  enregistrer: IconPlay,
  analyse: IconLayers,
  carte: IconMap,
  activites: IconSettings,
  memoire: IconFile,
  profil: IconUser,
  notes: IconNote,
  statistiques: IconChart,
  itineraires: IconRoute,
  cardio: IconPulse,
  fractionne: IconRunIntervals,
  voile: IconSail,
  capteurs: IconWingfoil,
  partage: IconShare,
};

/** Icône d'une leçon des tutoriels (pas d'image : poids de l'APK). */
function LessonIcon({ icon, size = 20 }: { icon: LessonIconId; size?: number }) {
  const Icon = ICONS[icon];
  return <Icon size={size} />;
}

export default LessonIcon;
