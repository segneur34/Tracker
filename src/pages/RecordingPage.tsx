import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import ActivitySelect from '../components/ActivitySelect';
import BeltStatus from '../components/BeltStatus';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import HoldDial from '../components/ui/HoldDial';
import FollowTracePicker from '../components/FollowTracePicker';
import IntervalCard from '../components/IntervalCard';
import PageHeader from '../components/ui/PageHeader';
import SegmentedControl from '../components/ui/SegmentedControl';
import SavedSessionShare from '../components/SavedSessionShare';
import { IconFlag, IconPause, IconPlay, IconRoute } from '../components/icons';
import { parseGpx } from '../core/gpxParser';
import { FAMILY_ACCENT, FAMILY_LABEL, FAMILY_SHADES, activitiesOfFamily, activityFamily, intervalActivityFor, type Activity } from '../core/activities';
import { sportFamily, sportTreatment, usesMarkCourse, type SportFamily } from '../core/sportProfiles';
import { formatClock, formatDistance, formatShortDistance, formatSpeed } from '../core/units';
import LiveMap from '../components/LiveMap';
import { clearFollowedTrace, useFollowedTrace } from '../hooks/useFollowedTrace';
import { useIntervalTimerOpen } from '../hooks/useIntervalTimer';
import { useStopwatchOpen } from '../hooks/useStopwatch';
import { useLongPress } from '../hooks/useLongPress';
import { useLiveRecording } from '../hooks/useLiveRecording';
import { useBeltLive } from '../hooks/useBeltLive';
import { useBeltWarmup } from '../hooks/useBeltWarmup';
import { useSatellites } from '../hooks/useSatellites';
import { useMissingPermissions } from '../hooks/usePermissions';
import { setBeepsMuted, skipMark, useMarkGuide, type MarkGuideView } from '../hooks/useMarkGuide';
import { useOpenSections } from '../hooks/useOpenSections';
import { readHeartRateZoneBounds } from '../hooks/useRunnerProfile';
import {
  effectiveCadence, effectiveDistanceUnit, effectiveFoil, effectiveHeartRate, effectiveJumpSettings, effectiveLiveFields, effectivePumping, effectiveSpeedUnit, effectiveStopHoldMs,
  lastRecordActivity, rememberRecordActivity, useVisibility,
} from '../hooks/useSportSettings';
import { getMotionCapabilities, type MotionCapabilities } from '../platform/motion';
import { BELT_STATE_LABEL, savedBelt } from '../platform/heartRate';
import { JUMP_PLACEMENT_LABEL } from '../recording/jumpSettings';
import { PERMISSION_LABEL } from '../recording/permissionsPrompt';
import { useOpenSession } from '../hooks/useLibraryNavigation';
import { updateSessionRecord } from '../hooks/useSessionLibrary';
import {
  addRecordingMark, analyzePendingSession, changeRecordingActivity, discardPendingSession, dismissRecorderResult, getLastFix, getLiveFixes, pauseRecording,
  resumeRecording, startRecording, stopRecording, useRecorder, type RecorderState,
} from '../hooks/useRecorder';
import { followedTraceLengthM, splitFollowedTrace, type FollowProgress, type FollowedTrace } from '../recording/followedTrace';
import { travelHeading } from '../recording/heading';
import {
  liveFieldLabel, liveFieldValue, type LiveFieldContext, type LiveFieldUnits,
} from '../recording/liveFields';
import { LIVE_LEG_DEFAULTS, type LiveLeg } from '../recording/liveLegs';
import { courseMarks, markName } from '../recording/markGuide';
import { LIVE_STATS_DEFAULTS, type LiveStats } from '../recording/liveStats';
import { canDownloadFiles, downloadTextFile, readPickedFile } from '../platform/files';
import { createReplaySource, deviceLocationSource, type LocationFix } from '../platform/location';
import { buzz } from '../platform/beeper';
import { isNativeApp } from '../platform/runtime';
import { keepScreenOn } from '../platform/screen';
import { fixesFromRawPoints, recordingDurationMs } from '../recording/session';

/**
 * Enregistrement d'une session : support, démarrer, arrêter, et ce qu'il faut
 * pour juger en direct que l'enregistrement tient (points, durée, plus long
 * trou, précision). À l'arrêt, la session n'est rangée dans la mémoire que
 * sur « Analyser » ; « Jeter » l'abandonne. L'onglet « Enregistrer » de la
 * barre de navigation.
 *
 * « Suivre une trace » choisit un itinéraire rangé ou une session déjà
 * enregistrée, dessiné sous la trace en cours, la partie faite en gris, avec
 * la distance restante le long de la trace ; au repos, la carte le montre en
 * aperçu. En voile, un itinéraire est un parcours : ses balises se valident
 * une à une, avec des bips d'approche (`useMarkGuide`), et l'avancement se
 * compte par balises.
 *
 * En fractionné, le compteur (`IntervalCard`) vit à côté de l'enregistrement,
 * sans en dépendre : lancé avant, pendant ou sans lui.
 *
 * Dans le navigateur, une source « rejeu » relit un GPX en accéléré : toute la
 * chaîne s'éprouve sur le PC, jusqu'à l'analyse de la session obtenue.
 */

const REPLAY_SPEEDS = [1, 10, 60, 600];

type SourceChoice = 'device' | 'replay';

interface ReplayTrack {
  fileName: string;
  fixes: LocationFix[];
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '12px 14px', borderRadius: 'var(--radius-m)', background: 'var(--bg)' }}>
    <span style={{ fontSize: 'var(--text-s)', color: 'var(--muted)' }}>{label}</span>
    <span className="num" style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>{value}</span>
  </div>
);

const STAT_GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--space-2)' } as const;

/** Nom d'une famille dans « Aucune activité … ». */
const FAMILY_NOUN: Record<SportFamily, string> = { voile: 'voile', course: 'à pied', velo: 'vélo', fractionne: 'de fractionné', surf: 'de surf' };

const formatMeters = (m: number | null): string => (m === null ? '—' : `${Math.round(m)} m`);
const recentWindowLabel = `${Math.round(LIVE_STATS_DEFAULTS.recentWindowS / 60)} min`;

/** Distance restante et part faite de la trace suivie ; « à rejoindre » tant qu'on ne l'a pas rejointe. */
const followStatItems = (activity: Activity, progress: FollowProgress | null, totalM: number): { label: string; value: string }[] => {
  const distanceUnit = effectiveDistanceUnit(activity);
  const total = formatDistance(totalM, distanceUnit, 1);
  return [
    { label: 'Restant', value: progress ? formatDistance(progress.remainingM, distanceUnit) : '—' },
    {
      label: `Fait, sur ${total}`,
      value: progress ? `${Math.round((100 * progress.progressM) / Math.max(1, progress.totalM))} %` : 'à rejoindre',
    },
  ];
};

/** Avancement d'un parcours de voile : distance restante par les balises, et balises validées. */
const courseStatItems = (activity: Activity, view: MarkGuideView): { label: string; value: string }[] => [
  { label: 'Restant', value: view.remainingM !== null ? formatDistance(view.remainingM, effectiveDistanceUnit(activity)) : '—' },
  { label: 'Balises validées', value: `${view.outcomes.filter((o) => o === 'validated').length}/${view.marks.length}` },
];

/**
 * Guidage vers la balise visée : son nom, sa distance et son cap ; « Passer »
 * la laisse pour la suivante, « Bips » coupe ou remet sons et vibrations.
 */
const MarkGuideCard = ({ view, activity }: { view: MarkGuideView; activity: Activity }) => {
  const count = view.marks.length;
  const aim = view.finished
    ? 'Parcours fini'
    : view.distanceM === null || view.bearingDeg === null
      ? 'en attente du GPS'
      : `${formatShortDistance(view.distanceM, effectiveDistanceUnit(activity))} · ${Math.round(view.bearingDeg) % 360}°`;
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2) var(--space-3)', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 12em', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: 'var(--text-s)', color: 'var(--muted)' }}>
            {view.finished ? `${count} balises` : `${markName(view.target, count)} · ${view.target + 1}/${count}`}
          </span>
          <span className="num" style={{ fontSize: 'var(--text-display)', fontWeight: 700, lineHeight: 1.15, whiteSpace: 'nowrap' }}>{aim}</span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button onClick={skipMark} disabled={view.finished}>Passer</Button>
          <Button variant={view.muted ? 'secondary' : 'ghost'} aria-pressed={!view.muted} onClick={() => setBeepsMuted(!view.muted)}
            title={view.muted ? 'Remettre les bips et les vibrations' : 'Couper les bips et les vibrations'}>
            {view.muted ? 'Bips coupés' : 'Bips'}
          </Button>
        </div>
      </div>
    </Card>
  );
};

/** Statistiques en direct propres au traitement du calcul de l'activité. */
const liveStatItems = (activity: Activity, live: LiveStats): { label: string; value: string }[] => {
  const unit = effectiveSpeedUnit(activity);
  const distanceUnit = effectiveDistanceUnit(activity);
  if (sportTreatment(activity.base) === 'voile') {
    return [
      ...LIVE_STATS_DEFAULTS.topDurationsS.map((d, i) => ({
        label: `Top ${d} s (${recentWindowLabel})`,
        value: formatSpeed(live.recentTopsMs[i] ?? null, unit),
      })),
      { label: 'Distance', value: formatDistance(live.distanceM, distanceUnit) },
    ];
  }
  if (sportTreatment(activity.base) === 'surf') {
    return [
      { label: 'Vitesse', value: formatSpeed(live.currentSpeedMs, unit) },
      { label: 'Vitesse max', value: formatSpeed(live.maxSpeedMs, unit) },
      { label: 'Distance', value: formatDistance(live.distanceM, distanceUnit) },
    ];
  }
  // Course : l'allure ; vélo : la vitesse.
  const speedWord = sportTreatment(activity.base) === 'velo' ? 'Vitesse' : 'Allure';
  return [
    { label: speedWord, value: formatSpeed(live.currentSpeedMs, unit) },
    { label: 'Distance', value: formatDistance(live.distanceM, distanceUnit) },
    { label: distanceUnit === 'nm' ? 'Dernier mille' : 'Dernier km', value: formatSpeed(live.lastDistanceSpeedMs, unit) },
    { label: `${speedWord} moyenne`, value: formatSpeed(live.averageSpeedMs, unit) },
    { label: 'D+', value: formatMeters(live.elevationGainM) },
    { label: 'D−', value: formatMeters(live.elevationLossM) },
    { label: `D+ ${recentWindowLabel}`, value: formatMeters(live.recentGainM) },
  ];
};

/** Durée d'un bord : m:ss, h:mm:ss au-delà d'une heure. */
const formatLegDuration = (ms: number): string => {
  const clock = formatClock(ms);
  return clock.startsWith('0:') ? clock.slice(2).replace(/^0(?=\d:)/, '') : clock;
};

/**
 * Un bord de voile en direct : cap moyen (le vent est inconnu, donc pas
 * d'amure), durée, vitesse moyenne et max sur 2 s. `leg` nul : `empty`.
 */
const LegCard = ({ title, leg, empty, activity }: { title: string; leg: LiveLeg | null; empty: string; activity: Activity }) => {
  const unit = effectiveSpeedUnit(activity);
  const detail = leg
    ? `${leg.headingDeg === null ? 'cap —' : `cap ${Math.round(leg.headingDeg) % 360}°`} · ${formatLegDuration(leg.endMs - leg.startMs)}`
    : empty;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-2)' }}>
        <span style={{ fontWeight: 700 }}>{title}</span>
        <span className="num" style={{ fontSize: 'var(--text-s)', color: 'var(--muted)' }}>{detail}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-2)' }}>
        <Stat label="Moyenne" value={formatSpeed(leg?.averageSpeedMs ?? null, unit)} />
        <Stat label={`Max (${LIVE_LEG_DEFAULTS.topDurationS} s)`} value={formatSpeed(leg?.maxSpeedMs ?? null, unit)} />
      </div>
    </div>
  );
};

/**
 * Chiffres en grand quand la carte est réduite : ceux choisis pour l'activité
 * dans Réglages (`effectiveLiveFields`), déjà formatés.
 */
const LiveSummary = ({ items }: { items: { label: string; value: string }[] }) => (
  <Card>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {items.map((item) => (
        <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)' }}>
          <span style={{ fontSize: 'var(--text-m)', color: 'var(--muted)' }}>{item.label}</span>
          <span className="num" style={{ fontSize: 'var(--text-display)', fontWeight: 700, lineHeight: 1.15, whiteSpace: 'nowrap' }}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  </Card>
);

/** Lignes de la carte réduite, dans les unités de l'activité. */
const liveSummaryItems = (activity: Activity, context: Omit<LiveFieldContext, keyof LiveFieldUnits>): { label: string; value: string }[] => {
  const units: LiveFieldUnits = { speedUnit: effectiveSpeedUnit(activity), distanceUnit: effectiveDistanceUnit(activity) };
  return effectiveLiveFields(activity).map((key) => ({
    label: liveFieldLabel(key, units),
    value: liveFieldValue(key, { ...units, ...context }),
  }));
};

/** Carte de l'enregistrement en cours, réduite ou non ; mémorisé sur l'appareil. */
const RECORDING_SECTION_DEFAULTS = { carte: true };

/**
 * « Arrêter » : tenu le temps réglé dans Réglages (2 s par défaut), pour qu'un
 * geste involontaire ne coupe pas la session ; un appui court le rappelle. À 0,
 * un simple appui arrête. Le grand cadran montre l'appui sous le doigt.
 */
function StopButton({ status }: { status: RecorderState['status'] }) {
  const busy = status === 'starting' || status === 'stopping';
  // Lue au rendu, comme à chaque appui : un réglage changé dans Réglages vaut au retour sur la page.
  const holdMs = effectiveStopHoldMs();
  const stop = useCallback(() => void stopRecording(), []);
  const { pressingMs, handlers } = useLongPress(stop, effectiveStopHoldMs, holdMs > 0 && !busy);
  /** Rappel du geste après un appui trop court, effacé au bout de quelques secondes. */
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (!hint) return undefined;
    const timer = window.setTimeout(() => setHint(false), 3000);
    return () => window.clearTimeout(timer);
  }, [hint]);

  const onClick = (e: MouseEvent) => {
    if (holdMs === 0) {
      stop();
      return;
    }
    handlers.onClick(e);
    // Le clic qui suit un appui long abouti est annulé par `useLongPress` : seul un appui court rappelle le geste.
    if (!e.defaultPrevented) setHint(true);
  };

  const holdS = (holdMs / 1000).toLocaleString('fr-FR');
  return (
    <>
      <Button variant="danger" size="l" className="ui-btn--hold" style={{ flex: 1 }} disabled={busy} {...handlers} onClick={onClick}>
        <span className="ui-record-dot ui-record-dot--stop" />
        {status === 'stopping' ? 'Enregistrement du fichier…' : hint ? `Maintenir ${holdS} s pour arrêter` : 'Arrêter'}
      </Button>
      {pressingMs !== null && (
        <HoldDial pressMs={pressingMs} color="var(--recording)"
          icon={<span className="ui-record-dot ui-record-dot--stop" style={{ width: '48px', height: '48px', borderRadius: '8px' }} />}
          title="Arrêter" hint="Maintenez le bouton" />
      )}
    </>
  );
}

/** Durée du retour du bouton « Note », en millisecondes. */
const NOTE_FEEDBACK_MS = 3000;
/** Vibration qui confirme une note posée, en millisecondes. */
const NOTE_BUZZ_MS = 80;

/**
 * Bouton « Note » : pose un repère à cet instant et à la dernière position
 * (`addRecordingMark`), sans rien saisir, puisqu'on est en mouvement ; il se
 * nomme ensuite dans l'analyse. Le bouton dit lui-même « Note N posée »
 * quelques secondes, et le téléphone vibre.
 */
function NoteButton() {
  const [feedback, setFeedback] = useState<string | null>(null);
  useEffect(() => {
    if (feedback === null) return;
    const timer = setTimeout(() => setFeedback(null), NOTE_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [feedback]);
  const note = () => {
    const added = addRecordingMark();
    setFeedback(added ? `Note ${added.n} posée` : 'Pas encore de position : note impossible');
    if (added) void buzz(NOTE_BUZZ_MS).catch(() => undefined);
  };
  return (
    <Button variant="secondary" size="l" block className="ui-btn--hold" onClick={note} aria-live="polite">
      <IconFlag size={20} />
      {feedback ?? 'Note'}
    </Button>
  );
}

function RecordingPage() {
  const recorder = useRecorder();
  const openSession = useOpenSession();
  const followed = useFollowedTrace();
  const [picking, setPicking] = useState(false);
  const native = isNativeApp();
  const { open: shown, toggle: toggleShown } = useOpenSections<'carte'>('recording', RECORDING_SECTION_DEFAULTS);

  // Famille puis activité : celle de la trace suivie d'abord, sinon la dernière enregistrée.
  // Seules les visibles sont proposées : une activité cachée dans Réglages n'est pas reprise (§10, point 100).
  const { activities, families, isShown } = useVisibility();
  const shownActivities = useMemo(() => activities.filter(isShown), [activities, isShown]);
  const [chosenId, setChosenId] = useState<string | null>(() => {
    const last = lastRecordActivity();
    return (shownActivities.find((a) => a.id === followed?.activityId) ?? (last && isShown(last) ? last : null) ?? shownActivities[0])?.id ?? null;
  });
  const chosen = activities.find((a) => a.id === chosenId) ?? null;
  const [family, setFamily] = useState<SportFamily>(chosen ? sportFamily(chosen.base) : families[0] ?? 'voile');
  const familyActivities = activitiesOfFamily(shownActivities, family);
  const pickFamily = (next: SportFamily) => {
    setFamily(next);
    setChosenId(activitiesOfFamily(shownActivities, next)[0]?.id ?? null);
  };
  const pickActivity = (activity: Activity) => {
    setFamily(sportFamily(activity.base));
    setChosenId(activity.id);
  };
  /** Une trace choisie propose son activité (celle de l'itinéraire, ou de la session). */
  const proposeActivityOf = (trace: FollowedTrace) => {
    const activity = shownActivities.find((a) => a.id === trace.activityId);
    if (activity) pickActivity(activity);
  };
  /** Changement d'activité en cours d'enregistrement : l'enregistreur la prend, la page la garde pour la suite. */
  const changeLiveActivity = (activity: Activity) => {
    changeRecordingActivity(activity);
    pickActivity(activity);
  };
  // Sauts : proposés par l'activité (Réglages), sur le téléphone seulement ; la case vaut pour cet enregistrement.
  const jumpSettings = chosen ? effectiveJumpSettings(chosen) : null;
  const [jumpChoice, setJumpChoice] = useState<{ activityId: string; measure: boolean } | null>(null);
  const measureJumps = chosen !== null && jumpSettings !== null &&
    (jumpChoice?.activityId === chosen.id ? jumpChoice.measure : jumpSettings.enabled);
  // Pumping foil : proposé par l'activité de surf (foil et pumping cochés dans Réglages), coché d'office ; la case vaut pour cet enregistrement.
  const pumpingOffered = chosen !== null && effectiveFoil(chosen) === true && effectivePumping(chosen) === true;
  const [pumpChoice, setPumpChoice] = useState<{ activityId: string; measure: boolean } | null>(null);
  const measurePumping = pumpingOffered && (pumpChoice?.activityId === chosen.id ? pumpChoice.measure : true);
  // Cadence à pied : proposée par l'activité (course, marche, fractionné à pied), cochée d'office sauf si Réglages la décoche ; la case vaut pour cet enregistrement.
  const cadenceSetting = chosen ? effectiveCadence(chosen) : null;
  const [cadenceChoice, setCadenceChoice] = useState<{ activityId: string; measure: boolean } | null>(null);
  const measureCadence = chosen !== null && cadenceSetting !== null &&
    (cadenceChoice?.activityId === chosen.id ? cadenceChoice.measure : cadenceSetting);
  // Ceinture cardio : proposée par l'activité (course, vélo, fractionné), cochée d'office si Réglages le dit ; la case vaut pour cet enregistrement.
  const heartRateSetting = chosen ? effectiveHeartRate(chosen) : null;
  const belt = useMemo(() => savedBelt(), []);
  const [heartRateChoice, setHeartRateChoice] = useState<{ activityId: string; measure: boolean } | null>(null);
  const measureHeartRate = chosen !== null && heartRateSetting !== null && belt !== null &&
    (heartRateChoice?.activityId === chosen.id ? heartRateChoice.measure : heartRateSetting);
  const [motionCaps, setMotionCaps] = useState<MotionCapabilities | null>(null);
  useEffect(() => {
    let alive = true;
    void getMotionCapabilities().then((caps) => { if (alive) setMotionCaps(caps); });
    return () => { alive = false; };
  }, []);
  const [sourceChoice, setSourceChoice] = useState<SourceChoice>('device');
  const [replay, setReplay] = useState<ReplayTrack | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replaySpeed, setReplaySpeed] = useState(60);

  const busy = recorder.status !== 'idle';
  const { stats, pending, saved } = recorder;
  // Ceinture cochée : connectée dès maintenant, avant le départ, pour voir qu'elle répond.
  const beltWarmup = useBeltWarmup(belt, native && sourceChoice === 'device' && measureHeartRate && !busy && pending === null);
  const beltLive = useBeltLive();
  // Satellites : sur le téléphone, tant que le GPS tourne (coupé en pause manuelle).
  const satellites = useSatellites(native && sourceChoice === 'device' && recorder.status === 'recording');
  const missingPermissions = useMissingPermissions();
  const [analyzing, setAnalyzing] = useState(false);
  const durationMs = recordingDurationMs(stats);
  const meanIntervalS = stats.pointCount > 1 ? durationMs / 1000 / (stats.pointCount - 1) : null;
  const canStart = !busy && pending === null && chosen !== null && (sourceChoice === 'device' || replay !== null);
  const liveActivity = recorder.activity ?? chosen;
  const mapReduced = busy && !shown.carte;
  // Compteur : pour le fractionné choisi (au repos) ou enregistré, et tant qu'une séance ou le chrono est lancé.
  const counterOpen = useIntervalTimerOpen();
  const stopwatchOpen = useStopwatchOpen();
  const counterFamily = busy ? (liveActivity ? activityFamily(liveActivity) : null) : pending ? null : family;
  const showCounter = counterOpen || stopwatchOpen || counterFamily === 'fractionne';
  // Écran allumé tant qu'un enregistrement (pause comprise), une séance du compteur ou le chrono tourne, sur cette page seulement.
  const screenOn = busy || counterOpen || stopwatchOpen;
  useEffect(() => {
    if (!screenOn) return undefined;
    keepScreenOn(true);
    return () => keepScreenOn(false);
  }, [screenOn]);
  // Calculé hors de la page, repris par la notification de l'enregistrement.
  const live = useLiveRecording();

  // Parcours de balises : la trace suivie a des balises et l'activité navigue sur un parcours (voile, surf). L'avancement se compte par balises.
  const markGuide = useMarkGuide();
  const courseMarksOf = followed?.marks && liveActivity && usesMarkCourse(sportFamily(liveActivity.base)) ? followed.marks : null;
  /** Balises laissées derrière soi : toutes celles d'avant la visée. */
  const leftMarks = markGuide.active ? markGuide.target : 0;

  // Avancement sur la trace suivie, recalculé avec la trace en direct (toutes les 2 s au plus).
  const followedLengthM = useMemo(() => (followed ? followedTraceLengthM(followed) : 0), [followed]);
  const progress = busy && followed && !courseMarksOf ? live.progress : null;
  const guide = useMemo(() => {
    // Sur un parcours de balises, il va de balise en balise : fait jusqu'à la dernière laissée, à faire ensuite.
    if (courseMarksOf) return { done: courseMarksOf.slice(0, leftMarks), remaining: courseMarksOf.slice(Math.max(0, leftMarks - 1)) };
    return followed && progress ? splitFollowedTrace(followed, progress.progressM) : { done: [], remaining: followed?.points ?? [] };
  }, [followed, progress, courseMarksOf, leftMarks]);
  const mapMarks = useMemo(
    () => (courseMarksOf ? courseMarks(courseMarksOf, markGuide.active ? markGuide : null) : undefined),
    [courseMarksOf, markGuide]
  );
  const liveFixes = getLiveFixes();
  const travel = busy ? travelHeading(liveFixes) : undefined;

  const handleReplayFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const fixes = fixesFromRawPoints(parseGpx(await readPickedFile(file)).rawPoints);
      if (fixes.length < 2) throw new Error('Le fichier ne contient pas assez de points horodatés.');
      setReplay({ fileName: file.name, fixes });
      setReplayError(null);
    } catch (err) {
      setReplay(null);
      setReplayError(err instanceof Error ? err.message : 'Lecture du fichier impossible.');
    }
  };

  /**
   * « Analyser » : range la session, puis l'ouvre si elle est entrée dans la mémoire. Une sortie à pied
   * ou à vélo faite avec le compteur d'intervalles : on demande d'abord si elle passe en Fractionné, seule
   * famille à avoir l'onglet « fractionné » (19/10) ; sinon elle reste dans la sienne, sans cet onglet.
   */
  const handleAnalyze = async () => {
    const pending = recorder.pending;
    const intervalActivity = pending && pending.intervals.length > 0
      ? intervalActivityFor(pending.activity, activitiesOfFamily(shownActivities, 'fractionne'))
      : null;
    const toIntervals = intervalActivity !== null && pending !== null && window.confirm(
      `Le compteur d'intervalles a servi pendant cette session. La ranger en « ${intervalActivity.name} » ? `
      + `Elle aura l'onglet fractionné ; sinon elle reste en « ${pending.activity.name} », sans cet onglet.`
    );
    setAnalyzing(true);
    const result = await analyzePendingSession();
    setAnalyzing(false);
    if (result?.libraryFile) {
      dismissRecorderResult();
      if (toIntervals && intervalActivity) {
        const listed = activities.some((a) => a.id === intervalActivity.id);
        updateSessionRecord(result.libraryFile, { sport: intervalActivity.base, activityId: listed ? intervalActivity.id : null });
        openSession(result.libraryFile, 'fractionne');
      } else {
        openSession(result.libraryFile, sportFamily(result.sport));
      }
    }
  };

  const handleDiscard = () => {
    if (window.confirm('Jeter cette session ? Elle ne sera pas rangée dans la mémoire, et ne pourra pas être récupérée.')) {
      void discardPendingSession();
    }
  };

  /** Ce que mesurent les capteurs pendant l'enregistrement : sauts (pumping en surf), cadence. */
  const motionWhat = (() => {
    const setup = recorder.motionSetup;
    const what: string[] = [];
    if (setup?.jumps !== false) what.push(liveActivity && sportTreatment(liveActivity.base) === 'surf' ? 'Pumping' : 'Sauts');
    if (setup?.cadence) what.push(what.length > 0 ? 'cadence' : 'Cadence');
    return what.join(' et ');
  })();

  const handleStart = () => {
    if (!chosen) return;
    rememberRecordActivity(chosen.id);
    const source = sourceChoice === 'replay' && replay
      ? createReplaySource(replay.fixes, replaySpeed)
      : deviceLocationSource();
    const capture = motionCaps?.available === true && sourceChoice === 'device';
    const cadence = capture && measureCadence;
    const motion = capture && measureJumps && jumpSettings
      ? { placement: jumpSettings.placement, foil: effectiveFoil(chosen) ?? false, jumps: true, cadence }
      : capture && measurePumping
        ? { placement: 'poitrine' as const, foil: true, jumps: true, cadence: false }
        : cadence
          ? { placement: jumpSettings?.placement ?? ('taille' as const), foil: false, jumps: false, cadence: true }
          : null;
    const heartRate = native && sourceChoice === 'device' && measureHeartRate ? belt : null;
    void beltWarmup.handOver(() => startRecording(chosen, source, { motion, heartRate }));
  };

  return (
    <div className="ui-page">
      <PageHeader title="Enregistrer" subtitle="Une position par seconde, gardée brute : l'analyse se fait ensuite." />

      {!busy && !pending && <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: 'var(--text-m)' }}>
          {/* Boutons glissants en cascade : la famille, puis ses activités (une rangée « Test » viendra en Fractionné). */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <SegmentedControl label="Famille" items={families.map((f) => ({ key: f, label: FAMILY_LABEL[f] }))} value={family}
              accent={FAMILY_ACCENT[family]} onChange={pickFamily} />
            {familyActivities.length > 0 && (
              <SegmentedControl label="Activité" items={familyActivities.map((a) => ({ key: a.id, label: a.name }))} value={chosenId ?? ''}
                accent={FAMILY_ACCENT[family]} onChange={setChosenId} />
            )}
          </div>
          {familyActivities.length === 0 && (
            <div className="ui-alert ui-alert--warning">
              Aucune activité {FAMILY_NOUN[family]} : ajoutez-en une dans <Link to="/parametres">Réglages</Link>.
            </div>
          )}

          {chosen && jumpSettings && native && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input type="checkbox" checked={measureJumps && motionCaps?.available === true} disabled={!motionCaps?.available}
                  onChange={(e) => setJumpChoice({ activityId: chosen.id, measure: e.target.checked })} />
                <span>Mesurer les sauts</span>
              </label>
              <span style={{ color: 'var(--muted)', fontSize: 'var(--text-s)', marginLeft: '26px' }}>
                {motionCaps && !motionCaps.available
                  ? motionCaps.reason
                  : `Téléphone fixé au corps : ${JUMP_PLACEMENT_LABEL[jumpSettings.placement].toLowerCase()}${effectiveFoil(chosen) ? ', sur foil' : ''} (Réglages).`}
                {motionCaps?.available && motionCaps.accelMaxG !== null && motionCaps.accelMaxG < 8 &&
                  ` L'accéléromètre plafonne à ${Math.round(motionCaps.accelMaxG)} g : les chocs à l'atterrissage seront écrêtés.`}
              </span>
            </div>
          )}

          {chosen && cadenceSetting !== null && native && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input type="checkbox" checked={measureCadence && motionCaps?.available === true} disabled={!motionCaps?.available}
                  onChange={(e) => setCadenceChoice({ activityId: chosen.id, measure: e.target.checked })} />
                <span>Mesurer la cadence</span>
              </label>
              <span style={{ color: 'var(--muted)', fontSize: 'var(--text-s)', marginLeft: '26px' }}>
                {motionCaps && !motionCaps.available
                  ? motionCaps.reason
                  : 'Téléphone porté sur soi, où vous voulez : poche, main, brassard, ceinture.'}
              </span>
            </div>
          )}

          {chosen && heartRateSetting !== null && native && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input type="checkbox" checked={measureHeartRate} disabled={belt === null}
                  onChange={(e) => setHeartRateChoice({ activityId: chosen.id, measure: e.target.checked })} />
                <span>Ceinture cardio</span>
              </label>
              <span style={{ color: 'var(--muted)', fontSize: 'var(--text-s)', marginLeft: '26px' }}>
                {belt === null
                  ? <>Aucune ceinture choisie : <Link to="/parametres">Réglages</Link>, bloc « Capteurs ».</>
                  : `${belt.name}, portée et humidifiée : elle n'émet qu'au contact de la peau.`}
              </span>
              {measureHeartRate && sourceChoice === 'device' && (
                <span style={{ fontSize: 'var(--text-s)', marginLeft: '26px' }}>
                  <BeltStatus state={beltLive.state} bpm={beltLive.bpm}
                    offText={beltWarmup.error ? `connexion impossible : ${beltWarmup.error}` : null}>
                    {beltWarmup.error && (
                      <button type="button" className="ui-btn ui-btn--secondary ui-btn--s" onClick={beltWarmup.retry}>Réessayer</button>
                    )}
                  </BeltStatus>
                </span>
              )}
            </div>
          )}

          {chosen && pumpingOffered && native && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input type="checkbox" checked={measurePumping && motionCaps?.available === true} disabled={!motionCaps?.available}
                  onChange={(e) => setPumpChoice({ activityId: chosen.id, measure: e.target.checked })} />
                <span>Mesurer le pumping</span>
              </label>
              <span style={{ color: 'var(--muted)', fontSize: 'var(--text-s)', marginLeft: '26px' }}>
                {motionCaps && !motionCaps.available
                  ? motionCaps.reason
                  : 'Téléphone fixé sur la poitrine : fréquence de pumping, distance par coup et décollage de chaque vol (Réglages).'}
              </span>
            </div>
          )}

          {native ? (
            <div><span className="ui-eyebrow">Source</span> <span style={{ marginLeft: '8px' }}>GPS du téléphone</span></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span className="ui-eyebrow">Source</span>
              <label>
                <input type="radio" checked={sourceChoice === 'device'} disabled={busy}
                  onChange={() => setSourceChoice('device')} /> GPS du navigateur
              </label>
              <label>
                <input type="radio" checked={sourceChoice === 'replay'} disabled={busy}
                  onChange={() => setSourceChoice('replay')} /> Rejeu d'un GPX, pour éprouver l'enregistrement
              </label>
              {sourceChoice === 'replay' && (
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginLeft: '24px' }}>
                  <input type="file" accept=".gpx" disabled={busy} onChange={handleReplayFile} />
                  <label>
                    Vitesse :{' '}
                    <select value={replaySpeed} disabled={busy} onChange={(e) => setReplaySpeed(Number(e.target.value))} className="ui-field ui-field--s">
                      {REPLAY_SPEEDS.map((s) => <option key={s} value={s}>×{s}</option>)}
                    </select>
                  </label>
                  {replay && <span style={{ color: 'var(--muted)' }}>{replay.fixes.length} points</span>}
                </div>
              )}
              {replayError && <div style={{ color: 'var(--danger)' }}>{replayError}</div>}
            </div>
          )}
        </div>
      </Card>}

      {busy ? (
        <div style={{ display: 'flex', gap: '10px' }}>
          {recorder.status === 'recording' && (
            <Button variant="secondary" size="l" style={{ flex: 1 }} onClick={() => void pauseRecording()}>
              <IconPause size={20} />
              Pause
            </Button>
          )}
          {recorder.status === 'paused' && recorder.pausedReason === 'manual' && (
            <Button variant="record" size="l" style={{ flex: 1 }} onClick={() => void resumeRecording()}>
              <IconPlay size={20} />
              Reprendre
            </Button>
          )}
          <StopButton status={recorder.status} />
        </div>
      ) : !pending && (
        // Au repos, la moitié du bouton choisit une trace à suivre.
        <div style={{ display: 'flex', gap: '10px' }}>
          <Button variant="record" size="l" style={{ flex: 1 }} onClick={handleStart} disabled={!canStart}>
            <span className="ui-record-dot" />
            Démarrer
          </Button>
          <Button variant="secondary" size="l" style={{ flex: 1 }} onClick={() => setPicking((p) => !p)} aria-expanded={picking}>
            <IconRoute size={20} />
            Suivre une trace
          </Button>
        </div>
      )}

      {(recorder.status === 'recording' || recorder.status === 'paused') && <NoteButton />}

      {picking && !busy && !pending && <FollowTracePicker onClose={() => setPicking(false)} onPicked={proposeActivityOf} />}

      {followed && (
        <div className="ui-alert" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <IconRoute size={18} />
          <span style={{ flex: 1 }}>
            Trace suivie : <strong>{followed.name}</strong>{followed.source === 'session' ? ' (session)' : ''}
            {liveActivity && <> · {formatDistance(followedLengthM, effectiveDistanceUnit(liveActivity), 1)}</>}
          </span>
          <Button size="s" variant="ghost" onClick={clearFollowedTrace}>Retirer</Button>
        </div>
      )}

      {recorder.status === 'paused' && recorder.pausedReason === 'manual' && (
        <div className="ui-alert ui-alert--warning">
          En pause : le GPS est coupé pour économiser la batterie{recorder.measuringMotion ? ', et la mesure des capteurs aussi' : ''}.
        </div>
      )}
      {busy && recorder.measuringMotion && recorder.status !== 'paused' && (
        <div className="ui-alert">{motionWhat} : les capteurs du téléphone mesurent.</div>
      )}
      {recorder.status === 'paused' && recorder.pausedReason === 'auto' && (
        <div className="ui-alert ui-alert--warning">En pause automatique : aucun mouvement détecté. Reprend dès que vous bougez.</div>
      )}

      {recorder.error && <div className="ui-alert ui-alert--danger">{recorder.error}</div>}

      {showCounter && <IntervalCard recording={busy} />}

      {markGuide.active && liveActivity && <MarkGuideCard view={markGuide} activity={liveActivity} />}

      {(busy || (followed && !pending)) && !mapReduced && (
        // Au repos, un aperçu de la trace suivie, sans position : remonté à chaque trace pour s'y cadrer.
        <LiveMap key={busy ? 'direct' : `apercu-${followed?.name}-${followed?.points.length}`}
          segments={busy ? live.segments : []} position={busy ? getLastFix() : null} height="45vh"
          guide={guide.remaining} guideDone={guide.done} travel={travel}
          marks={mapMarks} validationRadiusM={markGuide.active ? markGuide.validationRadiusM : undefined}
          notes={busy ? recorder.marks : undefined}
          color={FAMILY_SHADES[liveActivity ? sportFamily(liveActivity.base) : 'voile'][0]}
          family={liveActivity ? activityFamily(liveActivity) : family}
          overlay={busy ? (
            <Button size="s" onClick={() => toggleShown('carte')} style={{ boxShadow: '0 1px 5px rgba(0, 0, 0, 0.25)' }}>
              Réduire la carte
            </Button>
          ) : undefined} />
      )}

      {mapReduced && (
        // Carte réduite : elle n'est plus dessinée, les vitesses prennent sa place.
        <>
          <Button variant="secondary" block onClick={() => toggleShown('carte')}>Afficher la carte</Button>
          {liveActivity && (
            <LiveSummary items={liveSummaryItems(liveActivity, {
              stats: live.stats,
              durationMs,
              nowMs: live.updatedMs,
              remainingM: courseMarksOf ? (markGuide.active ? markGuide.remainingM : null) : progress?.remainingM ?? null,
              headingDeg: travel?.headingDeg ?? null,
              markDistanceM: markGuide.active ? markGuide.distanceM : null,
              markBearingDeg: markGuide.active ? markGuide.bearingDeg : null,
              heartRateBpm: recorder.heartRate?.bpm ?? null,
              heartRateZoneBounds: readHeartRateZoneBounds(liveActivity.base),
            })} />
          )}
        </>
      )}

      {busy && (
        <Card heading="En cours">
          {recorder.sourceLabel && (
            <p style={{ margin: '-6px 0 12px', color: 'var(--muted)', fontSize: 'var(--text-s)' }}>{recorder.sourceLabel}</p>
          )}
          {liveActivity && (
            // Changer d'activité en route, d'une famille à l'autre comprise : la session sera rangée sous la nouvelle.
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
              <span className="ui-eyebrow">Activité</span>
              <ActivitySelect
                activities={activities}
                value={liveActivity.id}
                extra={liveActivity}
                className="ui-field"
                disabled={recorder.status !== 'recording' && recorder.status !== 'paused'}
                onChange={changeLiveActivity} />
            </label>
          )}
          {recorder.heartRate && (
            <p style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-s)' }}>
              <span className="ui-eyebrow">Ceinture cardio</span>{' '}
              {recorder.heartRate.state === 'connected' && recorder.heartRate.bpm !== null
                ? `${Math.round(recorder.heartRate.bpm)} bpm`
                : recorder.heartRate.state === 'connected' ? 'connectée, sans contact avec la peau' : BELT_STATE_LABEL[recorder.heartRate.state]}
            </p>
          )}
          <div style={STAT_GRID}>
            <Stat label="Durée" value={formatClock(durationMs)} />
            {liveActivity && followed && (courseMarksOf && markGuide.active
              ? courseStatItems(liveActivity, markGuide)
              : followStatItems(liveActivity, progress, followedLengthM)
            ).map((item) => <Stat key={item.label} {...item} />)}
            {liveActivity && liveStatItems(liveActivity, live.stats).map((item) => <Stat key={item.label} {...item} />)}
          </div>
          {liveActivity && sportFamily(liveActivity.base) === 'voile' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
              <LegCard title="Bord en cours" leg={live.stats.legs.current}
                empty={live.stats.movingTimeMs > 0 ? 'en manœuvre' : 'pas encore'} activity={liveActivity} />
              <LegCard title="Bord précédent" leg={live.stats.legs.previous} empty="pas encore" activity={liveActivity} />
            </div>
          )}
        </Card>
      )}

      {(busy || stats.pointCount > 0) && (
        <Card heading={busy ? undefined : 'Dernier enregistrement'}>
          <details open={!busy}>
            <summary className="ui-eyebrow" style={{ cursor: 'pointer', marginBottom: 'var(--space-2)' }}>GPS</summary>
            <div style={STAT_GRID}>
              <Stat label="Durée" value={formatClock(durationMs)} />
              <Stat label="Points" value={String(stats.pointCount)} />
              <Stat label="Intervalle moyen" value={meanIntervalS === null ? '—' : `${meanIntervalS.toFixed(1)} s`} />
              <Stat label="Plus long trou" value={`${Math.round(stats.longestGapS)} s`} />
              <Stat label="Précision" value={stats.lastAccuracyM === null ? '—' : `${Math.round(stats.lastAccuracyM)} m`} />
              {busy && native && sourceChoice === 'device' && (
                <Stat label="Satellites utilisés" value={satellites === null ? '—' : `${satellites.used} sur ${satellites.visible}`} />
              )}
            </div>
          </details>
        </Card>
      )}

      {pending && (
        <Card heading={(
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
            {pending.recovered ? 'Session interrompue récupérée' : 'Session terminée'}
            <SavedSessionShare gpx={pending.content} activity={pending.activity} fileName={pending.fileName} libraryFile={null} />
          </span>
        )}>
          <p style={{ margin: '0 0 14px', lineHeight: 1.5 }}>
            {pending.activity.name}, {pending.pointCount} points.<br />
            <span style={{ color: 'var(--muted)', fontSize: 'var(--text-s)' }}>
              Pas encore rangée : « Analyser » la range dans la mémoire et l'ouvre, « Jeter » l'abandonne.
              Aucun nouvel enregistrement avant ce choix.
            </span>
          </p>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <Button variant="primary" onClick={() => void handleAnalyze()} disabled={analyzing}>
              {analyzing ? 'Rangement…' : 'Analyser'}
            </Button>
            {canDownloadFiles() && (
              <Button onClick={() => downloadTextFile(pending.fileName, pending.content)}>
                Télécharger le GPX
              </Button>
            )}
            <Button variant="danger" onClick={handleDiscard} disabled={analyzing}>
              Jeter
            </Button>
          </div>
        </Card>
      )}

      {saved && (
        <Card heading={(
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
            Session rangée
            <SavedSessionShare gpx={saved.content} activity={saved.activity} fileName={saved.fileName} libraryFile={saved.libraryFile} />
          </span>
        )}>
          <p style={{ margin: '0 0 14px', lineHeight: 1.5 }}>
            {saved.activity.name}, {saved.pointCount} points.<br />
            <span style={{ color: 'var(--muted)', fontSize: 'var(--text-s)', wordBreak: 'break-all' }}>Rangée dans : {saved.location}</span>
            {!saved.libraryFile && native && (
              <>
                <br />
                <span style={{ color: 'var(--muted)', fontSize: 'var(--text-s)' }}>
                  Pour l'analyser, choisissez le dossier mémoire (Réglages › Mémoire) : elle y sera rangée.
                </span>
              </>
            )}
          </p>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {saved.libraryFile && (
              <Button variant="primary" onClick={() => openSession(saved.libraryFile!, sportFamily(saved.sport))}>
                Analyser
              </Button>
            )}
            {canDownloadFiles() && (
              <Button onClick={() => downloadTextFile(saved.fileName, saved.content)}>
                Télécharger le GPX
              </Button>
            )}
            <Button variant="ghost" onClick={dismissRecorderResult}>
              Fermer
            </Button>
          </div>
        </Card>
      )}

      {native && !busy && !pending && (
        <p style={{ margin: 0, fontSize: 'var(--text-s)', color: 'var(--muted)', lineHeight: 1.5 }}>
          {missingPermissions.length > 0 && (
            <>
              Pour un enregistrement écran éteint, il manque : {missingPermissions.map((key) => PERMISSION_LABEL[key].toLowerCase()).join(', ')}
              {' '}(<Link to="/parametres">Réglages</Link>, bloc « Autorisations »).{' '}
            </>
          )}
          Pendant l'enregistrement, ne pas balayer l'application hors des applications récentes.
        </p>
      )}
    </div>
  );
}

export default RecordingPage;
