import { findActivity, type Activity } from '../core/activities';

/**
 * Activité d'un itinéraire rangé et itinéraires visibles : un module à part,
 * sans autre dépendance que `core/activities`, pour que l'accueil les lise sans
 * tirer le calcul d'itinéraire (`route.ts`, durée, retour de boucle, revêtement)
 * dans le paquet du démarrage. Pur.
 */

export interface WithActivity {
  record: { activityId: string | null };
}

export const routeActivity = (route: WithActivity, activities: Activity[]): Activity | null =>
  findActivity(activities, route.record.activityId);

/**
 * Itinéraires visibles : sans activité, ou d'une activité que `isShown`
 * montre (ni cachée dans Réglages, ni d'une famille cachée, §10, point 100).
 */
export const shownRoutes = <T extends WithActivity>(routes: T[], activities: Activity[], isShown: (a: Activity) => boolean): T[] =>
  routes.filter((r) => {
    const activity = routeActivity(r, activities);
    return activity === null || isShown(activity);
  });
