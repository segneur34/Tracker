import type { SVGProps } from 'react';
import type { Activity } from '../core/activities';
import { activityIcon } from '../core/activityIcons';
import { ACTIVITY_ICON } from './familyIcons';

/** Petite icône d'une activité : celle choisie dans Réglages, sinon la devinée. Décorative, le nom l'accompagne toujours. */
function ActivityIcon({ activity, size = 16, ...props }: { activity: Activity; size?: number } & SVGProps<SVGSVGElement>) {
  const Icon = ACTIVITY_ICON[activityIcon(activity)];
  return <Icon size={size} {...props} />;
}

export default ActivityIcon;
