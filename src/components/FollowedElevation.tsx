import { memo, useMemo } from 'react';
import { DefaultZIndexes, ZIndexLayer, usePlotArea, useXAxisScale, useYAxisScale } from 'recharts';
import type { Activity } from '../core/activities';
import { ELEVATION_PRESETS } from '../core/sportProfiles';
import { DISTANCE_UNIT_SYMBOL, formatMeters, toDisplayDistance, type DistanceUnit } from '../core/units';
import { useResetChartHover } from '../hooks/useChartHover';
import { useLiveRecording } from '../hooks/useLiveRecording';
import { usePhoneLandscape } from '../hooks/useNarrowScreen';
import { effectiveDistanceUnit, effectiveGradeRange } from '../hooks/useSportSettings';
import { followedProfile, followedRowIndex, remainingGainM } from '../recording/followedProfile';
import type { FollowedTrace } from '../recording/followedTrace';
import type { ProfileRow } from '../planning/route';
import ElevationProfileMini from './ElevationProfileMini';
import { HOVER_MARKER_COLOR } from './mapStyles';
import { useRouteProfileChart } from './routeProfileChart';
import Card from './ui/Card';

/** Hauteur du graphe sur un téléphone tourné, en px : il partage la colonne de droite avec la carte. */
const LANDSCAPE_HEIGHT_PX = 96;
/** Hauteur du graphe ailleurs, en px. */
const PORTRAIT_HEIGHT_PX = 130;

/** Rayon du rond de la position sur la courbe, en px. */
const POSITION_DOT_R = 5;

/**
 * Marge de la position aux bords du tracé, en px. La plage zoomée, recalculée, peut
 * finir un arrondi avant la fin de la trace : la position y resterait invisible à l'arrivée.
 */
const POSITION_EDGE_PX = 0.5;

/**
 * Ligne du profil où en est l'enregistrement, `null` tant qu'elle n'a pas de
 * sens (au repos, trace pas encore rejointe) : le direct, ramené au pas du profil.
 */
const useFollowedRow = (rows: ReadonlyArray<ProfileRow>, busy: boolean): number | null => {
  const live = useLiveRecording();
  const progressM = busy ? live.progress?.progressM ?? null : null;
  return progressM === null ? null : followedRowIndex(rows, progressM);
};

/**
 * La position sur la courbe, posée dans le graphe : un trait et un rond, seuls à
 * suivre le direct. Un `ReferenceLine` passerait par l'état du graphe et ferait
 * tout recalculer à chaque avancée ; ici, le graphe et sa courbe ne bougent pas.
 * Absente hors de la plage zoomée.
 */
function FollowedPosition({ rows, busy, distanceUnit }: {
  rows: ReadonlyArray<ProfileRow>;
  busy: boolean;
  distanceUnit: DistanceUnit;
}) {
  const rowIndex = useFollowedRow(rows, busy);
  const area = usePlotArea();
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  if (rowIndex === null || !area || !xScale || !yScale) return null;
  const { distM, eleM } = rows[rowIndex];
  const x = xScale(toDisplayDistance(distM, distanceUnit));
  if (x === undefined || x < area.x - POSITION_EDGE_PX || x > area.x + area.width + POSITION_EDGE_PX) return null;
  // L'altitude arrondie, comme les lignes tracées : le rond est sur la courbe.
  const y = eleM === null ? undefined : yScale(Math.round(eleM));
  return (
    <ZIndexLayer zIndex={DefaultZIndexes.scatter}>
      <line className="rec-elevation__position-line" x1={x} x2={x} y1={area.y} y2={area.y + area.height}
        stroke={HOVER_MARKER_COLOR.stroke} strokeWidth={1.5} />
      {y !== undefined && (
        <circle className="rec-elevation__position-dot" cx={x} cy={y} r={POSITION_DOT_R}
          fill={HOVER_MARKER_COLOR.fill} stroke={HOVER_MARKER_COLOR.stroke} strokeWidth={2} />
      )}
    </ZIndexLayer>
  );
}

/** Le graphe, redessiné à son zoom, pas à chaque calcul du direct : seule `FollowedPosition` le suit. */
const FollowedElevationChart = memo(function FollowedElevationChart({ trace, activity, busy }: {
  trace: FollowedTrace;
  activity: Activity;
  busy: boolean;
}) {
  const distanceUnit = effectiveDistanceUnit(activity);
  const gradeRange = useMemo(() => effectiveGradeRange(activity), [activity]);
  const { rows } = followedProfile(trace);
  const { zoom, chartRows, gradeStops, gradientId, readProfile } = useRouteProfileChart(rows, distanceUnit, gradeRange, trace);
  const landscape = usePhoneLandscape();
  return (
    <ElevationProfileMini rows={chartRows} stops={gradeStops} gradientId={gradientId} distanceSymbol={DISTANCE_UNIT_SYMBOL[distanceUnit]}
      zoom={zoom} read={readProfile} height={landscape ? LANDSCAPE_HEIGHT_PX : PORTRAIT_HEIGHT_PX}
      front={<FollowedPosition rows={rows} busy={busy} distanceUnit={distanceUnit} />} />
  );
});

/**
 * Dénivelé de la trace suivie, sous la carte de la page Enregistrer : tout le
 * profil, coloré par la pente, zoomable, relié à la carte par le survol (la même
 * pièce que les analyses), et la position sur la courbe pendant un enregistrement.
 * Dessous, la montée qui reste, ou au repos celle de toute la trace. Seul à
 * suivre le direct ici : ni la page ni la carte ne se redessinent pour lui, et
 * replié, il n'est pas monté.
 */
function FollowedElevation({ trace, activity, busy }: {
  trace: FollowedTrace;
  activity: Activity;
  /** Enregistrement en cours ; sinon, l'aperçu de la trace, sans position. */
  busy: boolean;
}) {
  useResetChartHover(trace);
  const { rows } = followedProfile(trace);
  // Ramené à la ligne du profil : un nouveau calcul sans avancée ne touche pas au reste à monter.
  const rowIndex = useFollowedRow(rows, busy);
  const atM = rowIndex === null ? 0 : rows[rowIndex].distM;
  const minGainM = ELEVATION_PRESETS.route.minGainM;
  const gainM = useMemo(() => remainingGainM(trace, atM, minGainM), [trace, atM, minGainM]);
  return (
    <Card className="rec-elevation">
      <FollowedElevationChart trace={trace} activity={activity} busy={busy} />
      <p className="rec-elevation__gain">{busy ? `reste ${formatMeters(gainM)} D+` : `${formatMeters(gainM)} D+ au total`}</p>
    </Card>
  );
}

export default FollowedElevation;
