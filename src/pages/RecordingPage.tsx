import { useState, type ChangeEvent } from 'react';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import PageHeader from '../components/ui/PageHeader';
import { IconPause, IconPlay } from '../components/icons';
import { parseGpx } from '../core/gpxParser';
import { SPORT_PROFILES, sportFamily } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import { formatClock, formatSpeed } from '../core/units';
import LiveMap from '../components/LiveMap';
import { useLiveRecording } from '../hooks/useLiveRecording';
import { effectiveSpeedUnit } from '../hooks/useSportSettings';
import { useOpenSession } from '../hooks/useLibraryNavigation';
import {
  analyzePendingSession, discardPendingSession, dismissRecorderResult, getLastFix, pauseRecording, resumeRecording,
  startRecording, stopRecording, useRecorder,
} from '../hooks/useRecorder';
import { LIVE_STATS_DEFAULTS, type LiveStats } from '../recording/liveStats';
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
 * Dans le navigateur, une source « rejeu » relit un GPX en accéléré : toute la
 * chaîne s'éprouve sur le PC, jusqu'à l'analyse de la session obtenue.
 */

const SPORTS = Object.values(SPORT_PROFILES);
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

/** Couleur de la trace sur la carte en direct, celle de la famille (donnée de carte, donc en dur). */
const TRACK_COLOR = { voile: '#1565c0', course: '#bf360c' } as const;

const formatDistance = (m: number): string => `${(m / 1000).toFixed(2)} km`;
const formatMeters = (m: number | null): string => (m === null ? '—' : `${Math.round(m)} m`);
const recentWindowLabel = `${Math.round(LIVE_STATS_DEFAULTS.recentWindowS / 60)} min`;

/** Statistiques en direct propres à la famille du support. */
const liveStatItems = (sport: SportType, live: LiveStats): { label: string; value: string }[] => {
  const unit = effectiveSpeedUnit(sport);
  if (sportFamily(sport) === 'voile') {
    return [
      ...LIVE_STATS_DEFAULTS.topDurationsS.map((d, i) => ({
        label: `Top ${d} s (${recentWindowLabel})`,
        value: formatSpeed(live.recentTopsMs[i] ?? null, unit),
      })),
      { label: 'Distance', value: formatDistance(live.distanceM) },
    ];
  }
  return [
    { label: 'Allure', value: formatSpeed(live.currentSpeedMs, unit) },
    { label: 'Distance', value: formatDistance(live.distanceM) },
    { label: `Dernier ${LIVE_STATS_DEFAULTS.lastDistanceM / 1000} km`, value: formatSpeed(live.lastDistanceSpeedMs, unit) },
    { label: 'Allure moyenne', value: formatSpeed(live.averageSpeedMs, unit) },
    { label: 'D+', value: formatMeters(live.elevationGainM) },
    { label: 'D−', value: formatMeters(live.elevationLossM) },
    { label: `D+ ${recentWindowLabel}`, value: formatMeters(live.recentGainM) },
  ];
};

function RecordingPage() {
  const recorder = useRecorder();
  const openSession = useOpenSession();
  const native = isNativeApp();

  const [sport, setSport] = useState<SportType>('wingfoil');
  const [sourceChoice, setSourceChoice] = useState<SourceChoice>('device');
  const [replay, setReplay] = useState<ReplayTrack | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replaySpeed, setReplaySpeed] = useState(60);

  const busy = recorder.status !== 'idle';
  const { stats, pending, saved } = recorder;
  const [analyzing, setAnalyzing] = useState(false);
  const durationMs = recordingDurationMs(stats);
  const meanIntervalS = stats.pointCount > 1 ? durationMs / 1000 / (stats.pointCount - 1) : null;
  const canStart = !busy && pending === null && (sourceChoice === 'device' || replay !== null);
  const liveSport = recorder.sport ?? sport;
  const live = useLiveRecording(busy ? liveSport : null, stats.pointCount);

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
    const source = sourceChoice === 'replay' && replay
      ? createReplaySource(replay.fixes, replaySpeed)
      : deviceLocationSource();
    void startRecording(sport, source);
  };

  return (
    <div className="ui-page">
      <PageHeader title="Enregistrer" subtitle="Une position par seconde, gardée brute : l'analyse se fait ensuite." />

      {!busy && !pending && <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: 'var(--text-m)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span className="ui-eyebrow">Support</span>
            <select value={sport} disabled={busy} onChange={(e) => setSport(e.target.value as SportType)} className="ui-field">
              {SPORTS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>

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
        <Button variant="record" size="l" block onClick={handleStart} disabled={!canStart}>
          <span className="ui-record-dot" />
          Démarrer
        </Button>
      )}

      {recorder.status === 'paused' && recorder.pausedReason === 'manual' && (
        <div className="ui-alert ui-alert--warning">En pause : le GPS est coupé pour économiser la batterie.</div>
      )}
      {recorder.status === 'paused' && recorder.pausedReason === 'auto' && (
        <div className="ui-alert ui-alert--warning">En pause automatique : aucun mouvement détecté. Reprend dès que vous bougez.</div>
      )}

      {recorder.error && <div className="ui-alert ui-alert--danger">{recorder.error}</div>}

      {busy && (
        <LiveMap segments={live.segments} position={getLastFix()} height="45vh"
          color={sportFamily(liveSport) === 'voile' ? TRACK_COLOR.voile : TRACK_COLOR.course} />
      )}

      {busy && (
        <Card heading={`En cours : ${SPORT_PROFILES[liveSport].label}`}>
          {recorder.sourceLabel && (
            <p style={{ margin: '-6px 0 12px', color: 'var(--muted)', fontSize: 'var(--text-s)' }}>{recorder.sourceLabel}</p>
          )}
          <div style={STAT_GRID}>
            <Stat label="Durée" value={formatClock(durationMs)} />
            {liveStatItems(liveSport, live.stats).map((item) => <Stat key={item.label} {...item} />)}
          </div>
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
            {SPORT_PROFILES[pending.sport].label}, {pending.pointCount} points.<br />
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
            {SPORT_PROFILES[saved.sport].label}, {saved.pointCount} points.<br />
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
