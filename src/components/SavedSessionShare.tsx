import { useState } from 'react';
import { FAMILY_LABEL, type Activity } from '../core/activities';
import { parseGpx } from '../core/gpxParser';
import { shareableStats } from '../core/shareImage';
import { sportFamily, sportTreatment } from '../core/sportProfiles';
import { coloredSegments } from '../core/trackColor';
import { librarySession } from '../hooks/useSessionLibrary';
import { effectiveDistanceUnit, effectiveSpeedUnit } from '../hooks/useSportSettings';
import { shareLabels, summaryShareStats } from '../library/shareStats';
import { summarizeSession } from '../library/summary';
import { safeFileName } from '../platform/files';
import { IconShare } from './icons';
import { sessionColorTrack, sessionSpeedRange } from './sessionTrack';
import ShareDialog from './ShareDialog';
import type { TrackSegment } from './TrackSegmentsLayer';
import Button from './ui/Button';
import MoreMenu from './ui/MoreMenu';

type Prepared = {
  segments: TrackSegment[];
  props: Omit<Parameters<typeof ShareDialog>[0], 'segments' | 'onClose'>;
};

interface SavedSessionShareProps {
  /** Le GPX de la session. */
  gpx: string;
  activity: Activity;
  /** Nom du GPX ; celui de la mémoire si elle y est rangée (`libraryFile`). */
  fileName: string;
  /** Rangée dans la mémoire : sa fiche donne le nom, l'allure imposée, les bornes et le résumé. */
  libraryFile: string | null;
}

/**
 * Menu « … » des cartes de fin d'enregistrement (« Session terminée »,
 * « Session rangée ») : « Partager » ouvre la même fenêtre que dans
 * l'analyse (`ShareDialog`), la trace colorée comme l'analyse la colorerait
 * (`sessionColorTrack`) et les chiffres du résumé (`summaryShareStats`) : celui
 * de la fiche si la session est rangée, sinon calculé sur le GPX.
 */
function SavedSessionShare({ gpx, activity, fileName, libraryFile }: SavedSessionShareProps) {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setError(null);
    try {
      const record = libraryFile === null ? undefined : librarySession(libraryFile)?.record;
      const sport = record?.sport ?? activity.base;
      const family = sportFamily(sport);
      const summary = record?.summary ?? summarizeSession(parseGpx(gpx).rawPoints, sport);
      const track = sessionColorTrack(gpx, sport, record?.analysis?.referenceSpeedMs ?? null, family);
      if (track === null || summary === null) throw new Error('trace trop courte.');
      const range = sessionSpeedRange(record ?? { analysis: null, sport }, activity, family, track.suggested);
      const labels = shareLabels(record?.name ?? null, activity.name, FAMILY_LABEL[family], summary.startMs, libraryFile ?? fileName);
      const units = { speed: effectiveSpeedUnit(activity), distance: effectiveDistanceUnit(activity) };
      setPrepared({
        segments: coloredSegments(track.points, range),
        props: {
          family,
          activityId: record?.activityId ?? activity.id,
          title: labels.title,
          subtitle: labels.subtitle,
          fileName: safeFileName(labels.baseName),
          stats: shareableStats(summaryShareStats(summary, sportTreatment(sport), units)),
        },
      });
    } catch (err) {
      setError(`Partage impossible : ${err instanceof Error ? err.message : 'erreur inconnue'}`);
    }
  };

  return (
    <>
      <MoreMenu label="Plus d'actions sur la session">
        <Button onClick={open}>
          <IconShare size={18} />
          Partager
        </Button>
      </MoreMenu>
      {error && <span role="status" style={{ fontSize: 'var(--text-s)', color: 'var(--recording)' }}>{error}</span>}
      {prepared && <ShareDialog {...prepared.props} segments={prepared.segments} onClose={() => setPrepared(null)} />}
    </>
  );
}

export default SavedSessionShare;
