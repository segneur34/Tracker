import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import ActivitySelect from '../components/ActivitySelect';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import FollowTracePicker from '../components/FollowTracePicker';
import IntervalCard from '../components/IntervalCard';
import PageHeader from '../components/ui/PageHeader';
import { IconPause, IconPlay, IconRoute } from '../components/icons';
import { parseGpx } from '../core/gpxParser';
import { FAMILY_ACCENT, FAMILY_LABEL, FAMILY_SHADES, activitiesOfFamily, activityFamily, type Activity } from '../core/activities';
import { SPORT_FAMILIES, sportFamily, sportTreatment, type SportFamily } from '../core/sportProfiles';
import { METERS_PER_DISTANCE_UNIT, formatClock, formatDistance, formatShortDistance, formatSpeed } from '../core/units';
import LiveMap from '../components/LiveMap';
import { REFERENCE_RIDER_KG, cyclingEnergyParams } from '../cycling/energy';
import { clearFollowedTrace, useFollowedTrace } from '../hooks/useFollowedTrace';
import { useIntervalTimerOpen } from '../hooks/useIntervalTimer';
import { useLiveRecording } from '../hooks/useLiveRecording';
import { setBeepsMuted, skipMark, useMarkGuide, type MarkGuideView } from '../hooks/useMarkGuide';
import { useOpenSections } from '../hooks/useOpenSections';
import { useRunnerProfile } from '../hooks/useRunnerProfile';
import {
  effectiveBikeSetup, effectiveDistanceUnit, effectiveFoil, effectiveJumpSettings, effectiveLiveFields, effectiveSpeedUnit, lastRecordActivity,
  readStoredActivities, rememberRecordActivity,
} from '../hooks/useSportSettings';
import { getMotionCapabilities, type MotionCapabilities } from '../platform/motion';
import { JUMP_PLACEMENT_LABEL } from '../recording/jumpSettings';
import { useOpenSession } from '../hooks/useLibraryNavigation';
import {
  analyzePendingSession, changeRecordingActivity, discardPendingSession, dismissRecorderResult, getLastFix, getLiveFixes, pauseRecording,
  resumeRecording, startRecording, stopRecording, useRecorder,
} from '../hooks/useRecorder';
import {
  followProgress, followedTraceLengthM, splitFollowedTrace, type FollowProgress, type FollowedTrace,
} from '../recording/followedTrace';
import { travelHeading } from '../recording/heading';
import {
  liveFieldLabel, liveFieldValue, type LiveFieldContext, type LiveFieldUnits,
} from '../recording/liveFields';
import { LIVE_LEG_DEFAULTS, type LiveLeg } from '../recording/liveLegs';
import { courseMarks, markName } from '../recording/markGuide';
import { LIVE_STATS_DEFAULTS, type LiveEnergySetup, type LiveStats } from '../recording/liveStats';
import { runningEnergyParams } from '../running/energy';
import { canDownloadFiles, downloadTextFile, readPickedFile } from '../platform/files';
import { createReplaySource, deviceLocationSource, type LocationFix } from '../platform/location';
import { isNativeApp } from '../platform/runtime';
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
    <span className="num" style={{ fontSize: '24px', fontWeight: 700 }}>{value}</span>
  </div>
);

const STAT_GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--space-2)' } as const;

/** Nom d'une famille dans « Aucune activité … ». */
const FAMILY_NOUN: Record<SportFamily, string> = { voile: 'voile', course: 'course', velo: 'vélo', fractionne: 'de fractionné' };

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

/** Modèle de la puissance et de l'énergie en direct, celui de l'analyse ; aucun en voile. */
const liveEnergySetup = (activity: Activity, weightKg: number | null, economyMlKgKm: number | null): LiveEnergySetup | undefined => {
  const family = sportTreatment(activity.base);
  if (family === 'course') return { family, params: runningEnergyParams(economyMlKgKm), massKg: weightKg };
  if (family === 'velo') {
    const { bikeType, bikeKg } = effectiveBikeSetup(activity);
    return { family, params: cyclingEnergyParams(bikeType, bikeKg, weightKg ?? REFERENCE_RIDER_KG) };
  }
  return undefined;
};

/** Carte de l'enregistrement en cours, réduite ou non ; mémorisé sur l'appareil. */
const RECORDING_SECTION_DEFAULTS = { carte: true };

function RecordingPage() {
  const recorder = useRecorder();
  const openSession = useOpenSession();
  const followed = useFollowedTrace();
  const [picking, setPicking] = useState(false);
  const native = isNativeApp();
  const { open: shown, toggle: toggleShown } = useOpenSections<'carte'>('recording', RECORDING_SECTION_DEFAULTS);

  // Famille puis activité : celle de la trace suivie d'abord, sinon la dernière enregistrée.
  const [activities] = useState(readStoredActivities);
  const [chosenId, setChosenId] = useState<string | null>(
    () => (activities.find((a) => a.id === followed?.activityId) ?? lastRecordActivity() ?? activities[0])?.id ?? null
  );
  const chosen = activities.find((a) => a.id === chosenId) ?? null;
  const [family, setFamily] = useState<SportFamily>(chosen ? sportFamily(chosen.base) : 'voile');
  const familyActivities = activitiesOfFamily(activities, family);
  const pickFamily = (next: SportFamily) => {
    setFamily(next);
    setChosenId(activitiesOfFamily(activities, next)[0]?.id ?? null);
  };
  const pickActivity = (activity: Activity) => {
    setFamily(sportFamily(activity.base));
    setChosenId(activity.id);
  };
  /** Une trace choisie propose son activité (celle de l'itinéraire, ou de la session). */
  const proposeActivityOf = (trace: FollowedTrace) => {
    const activity = activities.find((a) => a.id === trace.activityId);
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
  const [analyzing, setAnalyzing] = useState(false);
  const durationMs = recordingDurationMs(stats);
  const meanIntervalS = stats.pointCount > 1 ? durationMs / 1000 / (stats.pointCount - 1) : null;
  const canStart = !busy && pending === null && chosen !== null && (sourceChoice === 'device' || replay !== null);
  const liveActivity = recorder.activity ?? chosen;
  const mapReduced = busy && !shown.carte;
  // Compteur : pour le fractionné choisi (au repos) ou enregistré, et tant qu'une séance est lancée.
  const counterOpen = useIntervalTimerOpen();
  const counterFamily = busy ? (liveActivity ? activityFamily(liveActivity) : null) : pending ? null : family;
  const showCounter = counterOpen || counterFamily === 'fractionne';
  const { profile: runner } = useRunnerProfile();
  const energy = useMemo(
    () => (liveActivity ? liveEnergySetup(liveActivity, runner.weightKg, runner.economyMlKgKm) : undefined),
    [liveActivity, runner.weightKg, runner.economyMlKgKm]
  );
  const live = useLiveRecording(busy && liveActivity ? liveActivity.base : null, stats.pointCount, {
    lastDistanceM: liveActivity ? METERS_PER_DISTANCE_UNIT[effectiveDistanceUnit(liveActivity)] : undefined,
    energy,
  });

  // Parcours de voile : la trace suivie a des balises et l'activité est de voile. L'avancement se compte par balises.
  const markGuide = useMarkGuide();
  const courseMarksOf = followed?.marks && liveActivity && sportFamily(liveActivity.base) === 'voile' ? followed.marks : null;
  /** Balises laissées derrière soi : toutes celles d'avant la visée. */
  const leftMarks = markGuide.active ? markGuide.target : 0;

  // Avancement sur la trace suivie, recalculé avec la trace en direct (toutes les 2 s au plus).
  const followedLengthM = useMemo(() => (followed ? followedTraceLengthM(followed) : 0), [followed]);
  const progress = useMemo(
    () => (busy && followed && !courseMarksOf ? followProgress(followed, live.segments) : null),
    [busy, followed, courseMarksOf, live.segments]
  );
  const guide = useMemo(() => {
    // En voile, le parcours va de balise en balise : fait jusqu'à la dernière laissée, à faire ensuite.
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

  /** « Analyser » : range la session, puis l'ouvre si elle est entrée dans la mémoire. */
  const handleAnalyze = async () => {
    setAnalyzing(true);
    const result = await analyzePendingSession();
    setAnalyzing(false);
    if (result?.libraryFile) {
      dismissRecorderResult();
      openSession(result.libraryFile, sportFamily(result.sport));
    }
  };

  const handleDiscard = () => {
    if (window.confirm('Jeter cette session ? Elle ne sera pas rangée dans la mémoire, et ne pourra pas être récupérée.')) {
      void discardPendingSession();
    }
  };

  const handleStart = () => {
    if (!chosen) return;
    rememberRecordActivity(chosen.id);
    const source = sourceChoice === 'replay' && replay
      ? createReplaySource(replay.fixes, replaySpeed)
      : deviceLocationSource();
    const jumps = measureJumps && jumpSettings && motionCaps?.available && sourceChoice === 'device'
      ? { placement: jumpSettings.placement, foil: effectiveFoil(chosen) ?? false }
      : null;
    void startRecording(chosen, source, { jumps });
  };

  return (
    <div className="ui-page">
      <PageHeader title="Enregistrer" subtitle="Une position par seconde, gardée brute : l'analyse se fait ensuite." />

      {!busy && !pending && <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: 'var(--text-m)' }}>
          <div className="ui-tabs" role="group" aria-label="Famille" style={{ paddingBottom: 0 }}>
            {SPORT_FAMILIES.map((f) => (
              <button key={f} type="button" className="ui-tab" aria-pressed={family === f}
                style={{ '--tab-accent': FAMILY_ACCENT[f] } as React.CSSProperties}
                onClick={() => pickFamily(f)}>
                {FAMILY_LABEL[f]}
              </button>
            ))}
          </div>
          {familyActivities.length > 0 ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span className="ui-eyebrow">Activité</span>
              <select value={chosenId ?? ''} disabled={busy} onChange={(e) => setChosenId(e.target.value)} className="ui-field">
                {familyActivities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          ) : (
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
          <Button
            variant="danger" size="l" style={{ flex: 1 }}
            onClick={() => void stopRecording()}
            disabled={recorder.status === 'starting' || recorder.status === 'stopping'}>
            <span className="ui-record-dot ui-record-dot--stop" />
            {recorder.status === 'stopping' ? 'Enregistrement du fichier…' : 'Arrêter'}
          </Button>
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
          En pause : le GPS est coupé pour économiser la batterie{recorder.measuringJumps ? ', et la mesure des sauts aussi' : ''}.
        </div>
      )}
      {busy && recorder.measuringJumps && recorder.status !== 'paused' && (
        <div className="ui-alert">Sauts : les capteurs du téléphone mesurent.</div>
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
          color={FAMILY_SHADES[liveActivity ? sportFamily(liveActivity.base) : 'voile'][0]}
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
            </div>
          </details>
        </Card>
      )}

      {pending && (
        <Card heading={pending.recovered ? 'Session interrompue récupérée' : 'Session terminée'}>
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
        <Card heading="Session rangée">
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
          Pour un enregistrement écran éteint : autoriser la position et les notifications au premier démarrage ;
          dans les réglages de l'application, activer le démarrage automatique et mettre la batterie en « Aucune
          restriction ». Pendant l'enregistrement, ne pas balayer l'application hors des applications récentes.
        </p>
      )}
    </div>
  );
}

export default RecordingPage;
