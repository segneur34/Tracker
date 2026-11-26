import { useMemo } from 'react';
import { activityFamily, type Activity } from '../core/activities';
import { ELEVATION_PRESETS, usesMarkCourse } from '../core/sportProfiles';
import type { SavedRoute } from '../hooks/routeFiles';
import { useRunnerProfile } from '../hooks/useRunnerProfile';
import { effectiveDistanceUnit, effectiveDurationSettings } from '../hooks/useSportSettings';
import { routeDisplayName } from '../library/routeName';
import { routeActivity, routeDurationS } from '../planning/routeList';
import { recordToRoute } from '../planning/routeRecord';
import { routeImageDescription, routeShareContent, routeShareStats, routeSurfaceBand } from '../planning/routeShareImage';
import { safeFileName } from '../platform/files';
import ShareDialog from './ShareDialog';
import type { TrackSegment } from './TrackSegmentsLayer';

/** Un itinéraire n'a pas de trace colorée : son parcours la remplace. */
const NO_SEGMENTS: TrackSegment[] = [];

interface RouteImageShareProps {
  /** Itinéraire rangé : l'image montre sa fiche, jamais un tracé en cours de modification. */
  saved: SavedRoute;
  activities: Activity[];
  onClose: () => void;
}

/**
 * « Partager l'image » d'un itinéraire (lot 236), depuis le « … » de Planifier comme de la liste des itinéraires :
 * la fenêtre de partage d'une session (`ShareDialog`), au même cadre et au même cartouche, titrée du nom montré
 * (`routeDisplayName`). En voile et en surf, le parcours, ses bords annotés et les trois chiffres du bloc Parcours ;
 * à pied et à vélo, le tracé, distance, D+, D− et le temps estimé si l'activité a un niveau, et la bande du
 * revêtement au choix. Chiffres fixes ; distances dans l'unité de l'activité ; fond de carte de sa famille (la
 * course sans activité, comme Planifier). Les choix de la fenêtre sont retenus à part de ceux des sessions.
 */
function RouteImageShare({ saved, activities, onClose }: RouteImageShareProps) {
  const riderKg = useRunnerProfile().profile.weightKg;
  const prepared = useMemo(() => {
    const activity = routeActivity(saved, activities);
    const family = activity ? activityFamily(activity) : 'course';
    const markCourse = usesMarkCourse(family);
    const unit = activity ? effectiveDistanceUnit(activity) : 'km';
    const settings = activity && !markCourse ? effectiveDurationSettings(activity, riderKg) : null;
    const minGainM = ELEVATION_PRESETS.route.minGainM;
    const route = recordToRoute(saved.record);
    const course = routeShareContent(route, unit, markCourse);
    const stats = routeShareStats(route, unit, { markCourse, minGainM, durationS: routeDurationS(saved.record, minGainM, settings) });
    const surfaceBand = markCourse ? null : routeSurfaceBand(route);
    const title = routeDisplayName(saved.record);
    const subtitle = activity ? `${activity.name} · itinéraire planifié` : 'Itinéraire planifié';
    return {
      family,
      activityId: `itineraire:${activity?.id ?? ''}`,
      title,
      subtitle,
      // Le nom des fichiers de l'itinéraire, figé à son premier rangement : celui de son GPX partagé.
      fileName: safeFileName(saved.base),
      stats,
      course,
      surfaceBand,
      description: routeImageDescription(title, subtitle, course, stats),
    };
  }, [saved, activities, riderKg]);

  return <ShareDialog {...prepared} what="l'itinéraire" segments={NO_SEGMENTS} fixedStats onClose={onClose} />;
}

export default RouteImageShare;
