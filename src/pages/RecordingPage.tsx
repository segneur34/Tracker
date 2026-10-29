import { errorMessage } from '../core/basics';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ChangeEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import ActivitySelect from '../components/ActivitySelect';
import BeltStatus from '../components/BeltStatus';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import HoldButton from '../components/ui/HoldButton';
import FitnessTestCard from '../components/FitnessTestCard';
import FollowTracePicker from '../components/FollowTracePicker';
import IntervalCard from '../components/IntervalCard';
import PageHeader from '../components/ui/PageHeader';
import SegmentedControl from '../components/ui/SegmentedControl';
import SavedSessionShare from '../components/SavedSessionShare';
import { IconFlag, IconLock, IconPause, IconPlay, IconRoute } from '../components/icons';
import { parseGpx } from '../core/gpxParser';
import {
  FAMILY_ACCENT, FAMILY_LABEL, FAMILY_SHADES, activitiesOfFamily, activityFamily, intervalActivityFor, kindActivityLabel, trainingKindsOf, type Activity,
} from '../core/activities';
import {
  TRAINING_KIND_LABEL, hasPositions, isIntervalSport, isTestSport, sportFamily, sportTreatment, trainingKind, usesMarkCourse, type SportFamily,
  type TrainingKind,
} from '../core/sportProfiles';
import { formatClock, formatDistance, formatShortDistance, formatSpeed, formatMeters } from '../core/units';
import LiveMap from '../components/LiveMap';
import { clearFollowedTrace, useFollowedTrace } from '../hooks/useFollowedTrace';
import { armFitnessTest, useFitnessTest } from '../hooks/useFitnessTest';
import { useIntervalTimerOpen, useIntervalTimerRunning } from '../hooks/useIntervalTimer';
import { useStopwatchOpen, useStopwatchRunning } from '../hooks/useStopwatch';
import { useLiveRecording } from '../hooks/useLiveRecording';
import { useBeltLive } from '../hooks/useBeltLive';
import { useBeltWarmup } from '../hooks/useBeltWarmup';
import { useSatellites } from '../hooks/useSatellites';
import { useMissingPermissions } from '../hooks/usePermissions';
import { setBeepsMuted, skipMark, useMarkGuide, type MarkGuideView } from '../hooks/useMarkGuide';
import { useOpenSections } from '../hooks/useOpenSections';
import { usePhoneLandscape } from '../hooks/useNarrowScreen';
import { readHeartRateZoneBounds } from '../hooks/useRunnerProfile';
import {
  effectiveCadence, effectiveDistanceUnit, effectiveFoil, effectiveHeartRate, effectiveJumpSettings, effectiveLiveFields, effectivePumping, effectiveSpeedUnit, effectiveStopHoldMs,
  lastRecordActivity, rememberRecordActivity, useVisibility,
} from '../hooks/useSportSettings';
import { getMotionCapabilities, type MotionCapabilities } from '../platform/motion';
import { BELT_STATE_LABEL, EXAMPLE_BELT, savedBelt, type BeltState } from '../platform/heartRate';
import { JUMP_PLACEMENT_LABEL } from '../recording/jumpSettings';
import { PERMISSION_LABEL } from '../recording/permissionsPrompt';
import { useOpenSession } from '../hooks/useLibraryNavigation';
import { updateSessionRecord } from '../hooks/useSessionLibrary';
import {
  addRecordingMark, analyzePendingSession, changeRecordingActivity, discardPendingSession, dismissRecorderResult, getLastFix, getLiveFixes, pauseRecording,
  resumeRecording, startRecording, stopRecording, useRecorder, type RecorderState,
  useRecordingClock, useRecorderStatus,
} from '../hooks/useRecorder';
import { followedTraceLengthM, splitFollowedTrace, type FollowProgress, type FollowedTrace } from '../recording/followedTrace';
import { travelHeading } from '../recording/heading';
import {
  recentWindowLabel,
  liveFieldLabel, liveFieldValue, type LiveFieldContext, type LiveFieldUnits,
} from '../recording/liveFields';
import { LIVE_LEG_DEFAULTS, type LiveLeg } from '../recording/liveLegs';
import { courseMarks, markName } from '../recording/markGuide';
import { LIVE_STATS_DEFAULTS, type LiveStats } from '../recording/liveStats';
import { canDownloadFiles, downloadTextFile, readPickedFile } from '../platform/files';
import { createReplaySource, deviceLocationSource, type LocationFix } from '../platform/location';
import { buzz } from '../platform/beeper';
import { isNativeApp } from '../platform/runtime';
import { canLockOrientation, isOrientationLocked, keepScreenOn, lockOrientation, subscribeOrientationLock } from '../platform/screen';
import { fixesFromRawPoints, recordingDurationMs, isAutoPause, isManualPause } from '../recording/session';
import { FITNESS_TESTS, FITNESS_TEST_IDS, isFitnessTestId, type FitnessTestId } from '../recording/fitnessTest';
import { RESTING_HR_TEST, type RestingHrTestId } from '../recording/restingHrTest';
import { WORKOUT_LISTS } from './workoutLists';
import './RecordingPage.css';

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
 * En muscu (lot I du 25/10), une session sans GPS : la ceinture est exigée
 * (« Démarrer » attend qu'elle soit connectée), ni source, ni trace à suivre,
 * ni carte ; la carte du compteur porte les séances du Timer. Dans le
 * navigateur, la FC d'exemple (`EXAMPLE_BELT`) en tient lieu.
 *
 * En mode Timer (`?minuterie`, « Lancer » d'une séance du Timer, 25/10), hors
 * d'un enregistrement, la page n'est que le compteur : ni activité, ni carte,
 * ni « Démarrer », donc ni GPS ni session.
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

/** Fréquence cardiaque du direct : tuile allongée sur une ligne, plus grosse que les autres. Seulement avec une ceinture ;
 *  hors mesure, l'état de la ceinture tient la place du chiffre. */
const BpmTile = ({ belt }: { belt: { state: BeltState; bpm: number | null } }) => {
  const measured = belt.state === 'connected' && belt.bpm !== null;
  const text = measured
    ? String(Math.round(belt.bpm as number))
    : belt.state === 'connected' ? 'connectée, sans contact avec la peau' : BELT_STATE_LABEL[belt.state];
  return (
    <div className="rec-bpm">
      <span className="rec-bpm__label">BPM</span>
      <span className={measured ? 'num rec-bpm__value' : 'rec-bpm__state'}>{text}</span>
    </div>
  );
};

const STAT_GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--space-2)' } as const;

/** Nom d'une famille dans « Aucune activité … ». */
const FAMILY_NOUN: Record<SportFamily, string> = { voile: 'voile', course: 'à pied', velo: 'vélo', fractionne: "d'entraînement", surf: 'de surf' };


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

/** Statistiques en direct propres au traitement du calcul de l'activité ; sans position (muscu), la FC moyenne et la zone. */
const liveStatItems = (activity: Activity, live: LiveStats, heartRateBpm: number | null): { label: string; value: string }[] => {
  const unit = effectiveSpeedUnit(activity);
  const distanceUnit = effectiveDistanceUnit(activity);
  if (!hasPositions(activity.base)) {
    const units: LiveFieldUnits = { speedUnit: unit, distanceUnit };
    const context: LiveFieldContext = {
      ...units, stats: live, durationMs: 0, nowMs: null, remainingM: null, headingDeg: null, markDistanceM: null, markBearingDeg: null,
      heartRateBpm, heartRateZoneBounds: readHeartRateZoneBounds(activity),
    };
    return (['averageHeartRate', 'heartRateZone'] as const).map((key) => ({ label: liveFieldLabel(key, units), value: liveFieldValue(key, context) }));
  }
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
 * un simple appui arrête. Le grand cadran montre l'appui sous le doigt (`HoldButton`).
 */
function StopButton({ status }: { status: RecorderState['status'] }) {
  const stop = useCallback(() => void stopRecording(), []);
  return (
    <HoldButton onHold={stop} getHoldMs={effectiveStopHoldMs} disabled={status === 'starting' || status === 'stopping'}
      size="l" style={{ flex: 1 }} lead={<span className="ui-record-dot ui-record-dot--stop" />} dialTitle="Arrêter"
      label={status === 'stopping' ? 'Enregistrement du fichier…' : 'Arrêter'} />
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
function NoteButton({ style }: { style?: React.CSSProperties }) {
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
    <Button variant="secondary" size="l" block className="ui-btn--hold" onClick={note} aria-live="polite" style={style}>
      <IconFlag size={20} />
      {feedback ?? 'Note'}
    </Button>
  );
}

/**
 * Cadenas à droite de « Note » (téléphone seulement) : fige l'écran dans son orientation du moment, pour qu'un
 * geste ne le fasse pas tourner pendant la séance ; un second toucher le libère, l'arrêt de l'enregistrement aussi
 * (`AppShell`).
 */
function OrientationLockButton() {
  const locked = useSyncExternalStore(subscribeOrientationLock, isOrientationLocked);
  return (
    <Button variant={locked ? 'primary' : 'secondary'} size="l" aria-pressed={locked} onClick={() => lockOrientation(!locked)}
      aria-label={locked ? "Libérer l'orientation de l'écran" : "Figer l'écran dans son orientation"}
      title={locked ? 'Orientation figée : toucher pour la libérer' : "Figer l'écran dans son orientation"}>
      <IconLock size={20} open={!locked} />
    </Button>
  );
}

/** Écran gardé allumé tant que `on`, sur la page qui le demande seulement. */
const useScreenOnWhile = (on: boolean): void => {
  useEffect(() => {
    if (!on) return undefined;
    keepScreenOn(true);
    return () => keepScreenOn(false);
  }, [on]);
};

function RecordingScreen() {
  const recorder = useRecorder();
  const openSession = useOpenSession();
  const followed = useFollowedTrace();
  const [picking, setPicking] = useState(false);
  const native = isNativeApp();
  const { open: shown, toggle: toggleShown } = useOpenSections<'carte'>('recording', RECORDING_SECTION_DEFAULTS);

  // Famille puis activité : celle demandée par l'adresse (« Lancer » d'une page de l'Entraînement, `?activite=`),
  // sinon celle de la trace suivie, sinon la dernière enregistrée.
  // Seules les visibles sont proposées : une activité cachée dans Réglages n'est pas reprise (§10, point 100).
  const [params] = useSearchParams();
  const { activities, families, isShown } = useVisibility();
  const shownActivities = useMemo(() => activities.filter(isShown), [activities, isShown]);
  const [chosenId, setChosenId] = useState<string | null>(() => {
    const last = lastRecordActivity();
    const asked = shownActivities.find((a) => a.id === params.get('activite'));
    return (asked ?? shownActivities.find((a) => a.id === followed?.activityId) ?? (last && isShown(last) ? last : null) ?? shownActivities[0])?.id ?? null;
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
  // Entraînement : le type d'abord (Fractionné, Tests, Muscu), puis ses activités (à pied, vélo), 24/10.
  const kinds = family === 'fractionne' ? trainingKindsOf(familyActivities) : [];
  const chosenKind = kinds.length > 0 && chosen ? trainingKind(chosen.base) : null;
  const rowActivities = chosenKind ? familyActivities.filter((a) => trainingKind(a.base) === chosenKind) : familyActivities;
  /** Un type choisi : la dernière activité enregistrée de ce type, sinon la première. */
  const pickKind = (kind: TrainingKind) => {
    const own = familyActivities.filter((a) => trainingKind(a.base) === kind);
    const last = lastRecordActivity();
    setChosenId((own.find((a) => a.id === last?.id) ?? own[0])?.id ?? null);
  };
  // Tests : le test choisi sous « Tests » (rangée « Test »), celui de l'adresse (`&test=`, « Lancer » d'un protocole), sinon la FC max.
  // La FC repos s'y choisit aussi, mais se fait sur sa page, sans enregistreur ni GPS (les sessions sans GPS viendront avec la muscu).
  const [testId, setTestId] = useState<FitnessTestId | RestingHrTestId>(() => {
    const asked = params.get('test');
    return isFitnessTestId(asked) || asked === RESTING_HR_TEST.id ? asked : 'fc-max';
  });
  const isTest = chosen !== null && isTestSport(chosen.base);
  // Muscu : sans position, la ceinture seule (obligatoire), ni source ni trace à suivre.
  const heartOnly = chosen !== null && !hasPositions(chosen.base);
  const restingChosen = isTest && testId === RESTING_HR_TEST.id;
  const guidedTestId: FitnessTestId = isFitnessTestId(testId) ? testId : 'fc-max';
  const navigate = useNavigate();
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
  // Pumping foil : proposé par l'activité de surf ou de voile (foil et pumping cochés dans Réglages), coché d'office ; la case vaut pour cet enregistrement.
  const pumpingOffered = chosen !== null && effectiveFoil(chosen) === true && effectivePumping(chosen) === true;
  const [pumpChoice, setPumpChoice] = useState<{ activityId: string; measure: boolean } | null>(null);
  const measurePumping = pumpingOffered && (pumpChoice?.activityId === chosen.id ? pumpChoice.measure : true);
  // Cadence à pied : proposée par l'activité (course, marche, fractionné à pied), cochée d'office sauf si Réglages la décoche ; la case vaut pour cet enregistrement.
  const cadenceSetting = chosen ? effectiveCadence(chosen) : null;
  const [cadenceChoice, setCadenceChoice] = useState<{ activityId: string; measure: boolean } | null>(null);
  const measureCadence = chosen !== null && cadenceSetting !== null &&
    (cadenceChoice?.activityId === chosen.id ? cadenceChoice.measure : cadenceSetting);
  // Ceinture cardio : proposée par l'activité (course, vélo, fractionné), cochée d'office si Réglages le dit, et toujours pour un test ;
  // la case vaut pour cet enregistrement.
  const heartRateOffered = chosen ? effectiveHeartRate(chosen) : null;
  const heartRateSetting = heartRateOffered === null ? null : heartRateOffered || isTest;
  const retainedBelt = useMemo(() => savedBelt(), []);
  // Dans le navigateur, la muscu prend la FC d'exemple.
  const belt = heartOnly && !native ? EXAMPLE_BELT : retainedBelt;
  const [heartRateChoice, setHeartRateChoice] = useState<{ activityId: string; measure: boolean } | null>(null);
  const measureHeartRate = chosen !== null && heartRateSetting !== null && belt !== null && !restingChosen &&
    (heartOnly || (heartRateChoice?.activityId === chosen.id ? heartRateChoice.measure : heartRateSetting));
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
  const beltWarmup = useBeltWarmup(belt, (heartOnly || (native && sourceChoice === 'device')) && measureHeartRate && !busy && pending === null);
  const beltLive = useBeltLive();
  // Satellites : sur le téléphone, tant que le GPS tourne (coupé en pause manuelle).
  const satellites = useSatellites(native && sourceChoice === 'device' && recorder.status === 'recording');
  const missingPermissions = useMissingPermissions();
  const [analyzing, setAnalyzing] = useState(false);
  // Durée couverte par les positions : celle du GPS ; la durée affichée de la session suit l'horloge (`useRecordingClock`).
  const pointsDurationMs = recordingDurationMs(stats);
  const meanIntervalS = stats.pointCount > 1 ? pointsDurationMs / 1000 / (stats.pointCount - 1) : null;
  // Muscu : pas de départ sans la ceinture connectée (décision du 25/10).
  const beltMissing = heartOnly && (belt === null || beltLive.state !== 'connected');
  const canStart = !busy && pending === null && chosen !== null && !restingChosen
    && (heartOnly ? !beltMissing : sourceChoice === 'device' || replay !== null);
  const liveActivity = recorder.activity ?? chosen;
  // Session sans position, en cours ou choisie : ni carte, ni GPS, ni trace suivie.
  const liveHeartOnly = liveActivity !== null && !hasPositions(liveActivity.base);
  const mapReduced = busy && !shown.carte && !liveHeartOnly;
  // Téléphone tourné : les grands chiffres à gauche de la carte, sans avoir à la réduire.
  const landscape = usePhoneLandscape();
  const summaryShown = (mapReduced || (busy && landscape)) && liveActivity !== null && !liveHeartOnly;
  // Horloge : la durée tourne en pause automatique ; l'heure, si la carte réduite l'affiche, bat chaque seconde.
  const { nowMs, durationMs } = useRecordingClock(summaryShown && effectiveLiveFields(liveActivity).includes('clock'));
  // Compteur : pour le fractionné choisi (au repos) ou enregistré, pas pour un test, et tant qu'une séance ou le chrono est lancé.
  const counterOpen = useIntervalTimerOpen();
  const stopwatchOpen = useStopwatchOpen();
  const counterActivity = busy ? liveActivity : pending ? null : chosen;
  const counterFamily = busy ? (liveActivity ? activityFamily(liveActivity) : null) : pending ? null : family;
  // Muscu : le compteur sur les séances du Timer, lançable avant ou pendant l'enregistrement.
  const counterTimer = counterActivity !== null && !hasPositions(counterActivity.base);
  const showCounter = counterOpen || stopwatchOpen
    || (counterFamily === 'fractionne' && (counterActivity === null || isIntervalSport(counterActivity.base) || counterTimer));
  // Carte du test : à la place du compteur, pour un test choisi au repos ou guidé pendant l'enregistrement.
  const fitnessTest = useFitnessTest();
  const showTest = busy ? fitnessTest.active : pending === null && isTest && !restingChosen;
  // Écran allumé tant qu'un enregistrement (pause comprise), une séance du compteur (pause comprise) ou le chrono en marche, sur cette page seulement.
  const counterRunning = useIntervalTimerRunning();
  const stopwatchRunning = useStopwatchRunning();
  useScreenOnWhile(busy || counterRunning || stopwatchRunning);
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
  // Au mètre près : un nouveau calcul sans avancée ne redécoupe pas la trace suivie, et la carte ne la redessine pas.
  const progressM = progress ? Math.round(progress.progressM) : null;
  const guide = useMemo(() => {
    // Sur un parcours de balises, il va de balise en balise : fait jusqu'à la dernière laissée, à faire ensuite.
    if (courseMarksOf) return { done: courseMarksOf.slice(0, leftMarks), remaining: courseMarksOf.slice(Math.max(0, leftMarks - 1)) };
    return followed && progressM !== null ? splitFollowedTrace(followed, progressM) : { done: [], remaining: followed?.points ?? [] };
  }, [followed, progressM, courseMarksOf, leftMarks]);
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
      setReplayError(errorMessage(err, 'Lecture du fichier impossible.'));
    }
  };

  /**
   * « Analyser » : range la session, puis l'ouvre si elle est entrée dans la mémoire. Une sortie à pied
   * ou à vélo faite avec le compteur d'intervalles : on demande d'abord si elle passe en Fractionné, seule
   * famille à avoir l'onglet « fractionné » (19/10) ; sinon elle reste dans la sienne, sans cet onglet.
   */
  const handleAnalyze = async () => {
    const pending = recorder.pending;
    const intervalActivity = pending?.activity && pending.intervals.length > 0
      ? intervalActivityFor(pending.activity, activitiesOfFamily(shownActivities, 'fractionne'))
      : null;
    const toIntervals = intervalActivity !== null && pending?.activity && window.confirm(
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
      } else if (result.sport !== null) {
        openSession(result.libraryFile, sportFamily(result.sport));
      }
      // Session à classer (journal sans en-tête) : rangée sans activité, elle se classe depuis la bibliothèque.
    }
  };

  const handleDiscard = () => {
    if (window.confirm('Jeter cette session ? Elle ne sera pas rangée dans la mémoire, et ne pourra pas être récupérée.')) {
      void discardPendingSession();
    }
  };

  /** Ce que mesurent les capteurs pendant l'enregistrement : sauts (pumping en surf, sauts et pumping en voile sur foil), cadence. */
  const motionWhat = (() => {
    const setup = recorder.motionSetup;
    const what: string[] = [];
    const treatment = liveActivity ? sportTreatment(liveActivity.base) : null;
    const pumpingToo = treatment === 'voile' && setup?.foil === true && liveActivity !== null && effectivePumping(liveActivity) === true;
    if (setup?.jumps !== false) what.push(treatment === 'surf' ? 'Pumping' : pumpingToo ? 'Sauts et pumping' : 'Sauts');
    if (setup?.cadence) what.push(what.length > 0 ? 'cadence' : 'Cadence');
    return what.join(' et ');
  })();

  const handleStart = () => {
    if (!chosen) return;
    if (heartOnly) {
      if (!belt) return;
      rememberRecordActivity(chosen.id);
      void beltWarmup.handOver(() => startRecording(chosen, null, { heartRate: belt }));
      return;
    }
    // Test sans ceinture connectée (ni FC dans le fichier rejoué) : on demande, sans bloquer.
    const replayHasHr = sourceChoice === 'replay' && replay !== null && replay.fixes.some((f) => f.heartRateBpm !== undefined);
    const beltReady = native && sourceChoice === 'device' && measureHeartRate && beltLive.state === 'connected';
    if (isTest && !beltReady && !replayHasHr && !window.confirm(
      `Aucune ceinture cardio connectée. Le test ${FITNESS_TESTS[guidedTestId].label} guide l'échauffement sur la FC et en mesure le maximum : `
      + "sans elle, ni l'un ni l'autre. Démarrer quand même ?"
    )) return;
    rememberRecordActivity(chosen.id);
    if (isTest) armFitnessTest(guidedTestId);
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
    <div className="ui-page rec-page">
      <PageHeader title="Enregistrer" subtitle="Une position par seconde, gardée brute : l'analyse se fait ensuite." />

      {!busy && !pending && <Card className="rec-options">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: 'var(--text-m)' }}>
          {/* Boutons glissants en cascade : la famille, puis ses activités ; en Entraînement, le type d'entraînement entre les deux,
              et ses activités seulement s'il en a plusieurs ; sous Tests, le test et son protocole. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <SegmentedControl fit label="Famille" items={families.map((f) => ({ key: f, label: FAMILY_LABEL[f] }))} value={family}
              accent={FAMILY_ACCENT[family]} onChange={pickFamily} />
            {kinds.length > 0 && (
              <SegmentedControl label="Type" items={kinds.map((k) => ({ key: k, label: TRAINING_KIND_LABEL[k] }))} value={chosenKind ?? kinds[0]}
                accent={FAMILY_ACCENT[family]} onChange={pickKind} />
            )}
            {rowActivities.length > (chosenKind ? 1 : 0) && (
              <SegmentedControl label="Activité" value={chosenId ?? ''} accent={FAMILY_ACCENT[family]} onChange={setChosenId}
                items={rowActivities.map((a) => ({ key: a.id, label: chosenKind ? kindActivityLabel(a, chosenKind) : a.name, title: a.name }))} />
            )}
            {isTest && (
              <>
                <SegmentedControl label="Test" value={testId} accent={FAMILY_ACCENT[family]} onChange={setTestId}
                  items={[
                    ...FITNESS_TEST_IDS.map((id) => ({ key: id, label: FITNESS_TESTS[id].label })),
                    { key: RESTING_HR_TEST.id, label: RESTING_HR_TEST.label },
                  ]} />
                <Link to={`/fractionne/tests/${testId}`} style={{ fontSize: 'var(--text-s)' }}>Voir le protocole</Link>
              </>
            )}
          </div>
          {familyActivities.length === 0 && (
            <div className="ui-alert ui-alert--warning">
              Aucune activité {FAMILY_NOUN[family]} : ajoutez-en une dans <Link to="/parametres">Réglages</Link>.
            </div>
          )}

          {chosen && jumpSettings && native && !restingChosen && (
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

          {chosen && cadenceSetting !== null && native && !restingChosen && (
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

          {chosen && heartRateSetting !== null && (native || heartOnly) && !restingChosen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {/* Muscu : la ceinture d'office, la case ne se décoche pas. */}
                <input type="checkbox" checked={measureHeartRate} disabled={belt === null || heartOnly}
                  onChange={(e) => setHeartRateChoice({ activityId: chosen.id, measure: e.target.checked })} />
                <span>Ceinture cardio</span>
              </label>
              <span style={{ color: 'var(--muted)', fontSize: 'var(--text-s)', marginLeft: '26px' }}>
                {belt === null
                  ? <>Aucune ceinture choisie : <Link to="/parametres">Réglages</Link>, bloc « Capteurs ».{heartOnly && ' La muscu se fait avec elle.'}</>
                  : belt === EXAMPLE_BELT
                    ? "FC d'exemple du navigateur, pour éprouver la muscu : la vraie ceinture est sur le téléphone."
                    : heartOnly
                      ? `${belt.name}, portée et humidifiée : la muscu se fait avec elle, sans GPS.`
                      : `${belt.name}, portée et humidifiée : elle n'émet qu'au contact de la peau.`}
              </span>
              {measureHeartRate && (sourceChoice === 'device' || heartOnly) && (
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

          {restingChosen || heartOnly ? null : native ? (
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
          {isManualPause(recorder) && (
            <Button variant="record" size="l" style={{ flex: 1 }} onClick={() => void resumeRecording()}>
              <IconPlay size={20} />
              Reprendre
            </Button>
          )}
          <StopButton status={recorder.status} />
        </div>
      ) : !pending && restingChosen ? (
        // FC repos : pas d'enregistrement, le test se fait sur sa page.
        <Card>
          <p style={{ margin: '0 0 var(--space-3)', lineHeight: 1.5 }}>
            Test de {RESTING_HR_TEST.durationS / 60} min, assis ou allongé, ceinture cardio portée, sans GPS : il se fait sur sa page.
          </p>
          <Button variant="record" size="l" block onClick={() => navigate(`/fractionne/tests/${RESTING_HR_TEST.id}`)}>
            Ouvrir le test
          </Button>
        </Card>
      ) : !pending && (
        // Au repos, la moitié du bouton choisit une trace à suivre ; l'un sous l'autre quand la place manque (écran
        // étroit, texte d'Android agrandi).
        <div className="rec-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          <Button variant="record" size="l" style={{ flex: '1 1 130px' }} onClick={handleStart} disabled={!canStart}>
            <span className="ui-record-dot" />
            Démarrer
          </Button>
          {!heartOnly && (
            <Button variant="secondary" size="l" style={{ flex: '1 1 130px' }} onClick={() => setPicking((p) => !p)} aria-expanded={picking}>
              <IconRoute size={20} />
              Suivre une trace
            </Button>
          )}
          {beltMissing && (
            <p style={{ margin: 0, flexBasis: '100%', fontSize: 'var(--text-s)', color: 'var(--muted)', lineHeight: 1.5 }}>
              {belt === null
                ? 'La muscu se fait avec la ceinture cardio : choisissez-la dans Réglages, bloc « Capteurs ».'
                : "La muscu se fait avec la ceinture cardio : « Démarrer » attend qu'elle soit connectée. Portez-la, électrodes humidifiées."}
            </p>
          )}
        </div>
      )}

      {(recorder.status === 'recording' || recorder.status === 'paused') && (canLockOrientation() ? (
        <div style={{ display: 'flex', gap: '10px' }}>
          <NoteButton style={{ flex: 1 }} />
          <OrientationLockButton />
        </div>
      ) : <NoteButton />)}

      {busy && (
        // Source du GPS et activité : au-dessus de la carte, pour rester visibles carte ouverte.
        <div className="rec-status">
          {recorder.sourceLabel && <span className="rec-status__source">{recorder.sourceLabel}</span>}
          {liveActivity && (
            // Changer d'activité en route, d'une famille à l'autre comprise : la session sera rangée sous la nouvelle.
            <label className="rec-status__activity">
              <span className="ui-eyebrow">Activité</span>
              <ActivitySelect
                activities={activities.filter((a) => hasPositions(a.base) === !liveHeartOnly)}
                value={liveActivity.id}
                extra={liveActivity}
                className="ui-field"
                disabled={recorder.status !== 'recording' && recorder.status !== 'paused'}
                onChange={changeLiveActivity} />
            </label>
          )}
        </div>
      )}

      {picking && !busy && !pending && !heartOnly && <FollowTracePicker onClose={() => setPicking(false)} onPicked={proposeActivityOf} />}

      {followed && !liveHeartOnly && (
        <div className="ui-alert" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <IconRoute size={18} />
          <span style={{ flex: 1 }}>
            Trace suivie : <strong>{followed.name}</strong>{followed.source === 'session' ? ' (session)' : ''}
            {liveActivity && <> · {formatDistance(followedLengthM, effectiveDistanceUnit(liveActivity), 1)}</>}
          </span>
          <Button size="s" variant="ghost" onClick={clearFollowedTrace}>Retirer</Button>
        </div>
      )}

      {isManualPause(recorder) && (
        <div className="ui-alert ui-alert--warning">
          {liveHeartOnly
            ? 'En pause : les mesures de la ceinture ne sont pas gardées.'
            : `En pause : le GPS est coupé pour économiser la batterie${recorder.measuringMotion ? ', et la mesure des capteurs aussi' : ''}.`}
        </div>
      )}
      {busy && recorder.measuringMotion && recorder.status !== 'paused' && (
        <div className="ui-alert">{motionWhat} : les capteurs du téléphone mesurent.</div>
      )}
      {isAutoPause(recorder) && (
        <div className="ui-alert ui-alert--warning">En pause automatique : aucun mouvement détecté. Reprend dès que vous bougez.</div>
      )}

      {recorder.error && <div className="ui-alert ui-alert--danger">{recorder.error}</div>}

      {showCounter && <IntervalCard kind={counterTimer ? 'timer' : 'fractionne'} recording={busy} muscu={counterTimer} />}

      {showTest && <FitnessTestCard testId={guidedTestId} activity={liveActivity} />}

      {markGuide.active && liveActivity && <MarkGuideCard view={markGuide} activity={liveActivity} />}

      {(busy || (followed && !pending)) && !mapReduced && !liveHeartOnly && (
        // Au repos, un aperçu de la trace suivie, sans position : remonté à chaque trace pour s'y cadrer. Sur un téléphone
        // tourné, la carte se fixe à droite (`RecordingPage.css`).
        <div className="rec-map">
          <LiveMap key={busy ? 'direct' : `apercu-${followed?.name}-${followed?.points.length}`}
            segments={busy ? live.segments : []} position={busy ? getLastFix() : null} height="45vh"
            guide={guide.remaining} guideDone={guide.done} travel={travel}
            marks={mapMarks} validationRadiusM={markGuide.active ? markGuide.validationRadiusM : undefined}
            notes={busy ? recorder.marks : undefined}
            color={FAMILY_SHADES[liveActivity ? sportFamily(liveActivity.base) : 'voile'][0]}
            family={liveActivity ? activityFamily(liveActivity) : family}
            overlay={busy ? (
              <Button size="s" onClick={() => toggleShown('carte')} style={{ boxShadow: '0 1px 5px color-mix(in srgb, var(--shadow-color) 25%, transparent)' }}>
                Réduire la carte
              </Button>
            ) : undefined} />
        </div>
      )}

      {/* Carte réduite : elle n'est plus dessinée, les vitesses prennent sa place ; tourné, elles sont à côté d'elle. */}
      {mapReduced && !liveHeartOnly && <Button variant="secondary" block onClick={() => toggleShown('carte')}>Afficher la carte</Button>}
      {summaryShown && liveActivity && (
        <LiveSummary items={liveSummaryItems(liveActivity, {
          stats: live.stats,
          durationMs,
          nowMs,
          remainingM: courseMarksOf ? (markGuide.active ? markGuide.remainingM : null) : progress?.remainingM ?? null,
          headingDeg: travel?.headingDeg ?? null,
          markDistanceM: markGuide.active ? markGuide.distanceM : null,
          markBearingDeg: markGuide.active ? markGuide.bearingDeg : null,
          heartRateBpm: recorder.heartRate?.bpm ?? null,
          heartRateZoneBounds: readHeartRateZoneBounds(liveActivity),
        })} />
      )}

      {busy && (
        <Card heading="En cours">
          {recorder.heartRate && <BpmTile belt={recorder.heartRate} />}
          <div style={STAT_GRID}>
            <Stat label="Durée" value={formatClock(durationMs)} />
            {liveActivity && followed && (courseMarksOf && markGuide.active
              ? courseStatItems(liveActivity, markGuide)
              : followStatItems(liveActivity, progress, followedLengthM)
            ).map((item) => <Stat key={item.label} {...item} />)}
            {liveActivity && liveStatItems(liveActivity, live.stats, recorder.heartRate?.bpm ?? null).map((item) => <Stat key={item.label} {...item} />)}
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

      {(busy || stats.pointCount > 0) && !liveHeartOnly && (
        <Card heading={busy ? undefined : 'Dernier enregistrement'}>
          <details open={!busy}>
            <summary className="ui-eyebrow" style={{ cursor: 'pointer', marginBottom: 'var(--space-2)' }}>GPS</summary>
            <div style={STAT_GRID}>
              <Stat label="Durée" value={formatClock(pointsDurationMs)} />
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
            {pending.activity && (
              <SavedSessionShare gpx={pending.content} activity={pending.activity} fileName={pending.fileName} libraryFile={null} />
            )}
          </span>
        )}>
          <p style={{ margin: '0 0 14px', lineHeight: 1.5 }}>
            {pending.activity?.name ?? 'À classer'}, {pending.pointCount} {pending.sport === null || hasPositions(pending.sport) ? 'points' : 'mesures de la ceinture'}.<br />
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
            {saved.activity && (
              <SavedSessionShare gpx={saved.content} activity={saved.activity} fileName={saved.fileName} libraryFile={saved.libraryFile} />
            )}
          </span>
        )}>
          <p style={{ margin: '0 0 14px', lineHeight: 1.5 }}>
            {saved.activity?.name ?? 'À classer'}, {saved.pointCount} {saved.sport === null || hasPositions(saved.sport) ? 'points' : 'mesures de la ceinture'}.<br />
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
            {saved.libraryFile && saved.sport !== null && (
              <Button variant="primary" onClick={() => openSession(saved.libraryFile!, sportFamily(saved.sport!))}>
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

/**
 * Enregistrer en mode Timer : la carte du compteur seule, sur les séances du
 * Timer, écran allumé tant qu'une séance ou le chrono tourne. Rien n'y
 * démarre le GPS ; « Enregistrer une session » rend la page ordinaire.
 */
function TimerScreen() {
  const counterRunning = useIntervalTimerRunning();
  const stopwatchRunning = useStopwatchRunning();
  useScreenOnWhile(counterRunning || stopwatchRunning);
  return (
    <div className="ui-page rec-page" style={{ '--help-accent': FAMILY_ACCENT.fractionne } as React.CSSProperties}>
      <PageHeader title="Timer" back={{ to: WORKOUT_LISTS.timer.listPath, label: 'Séances' }}
        subtitle="Le compteur seul : sans GPS, aucune session n'est enregistrée." />
      <IntervalCard kind="timer" recording={false} />
      <Link to="/enregistrer" replace style={{ fontSize: 'var(--text-s)', alignSelf: 'flex-start' }}>Enregistrer une session</Link>
    </div>
  );
}

/** Enregistrer : en mode Timer (`?minuterie`) tant que rien n'enregistre, sinon la page ordinaire. */
function RecordingPage() {
  const [params] = useSearchParams();
  const idle = useRecorderStatus() === 'idle';
  return params.has('minuterie') && idle ? <TimerScreen /> : <RecordingScreen />;
}

export default RecordingPage;
