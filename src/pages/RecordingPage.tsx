import { useState, type ChangeEvent } from 'react';
import ModuleNav from '../components/ModuleNav';
import { CARD_STYLE } from '../components/styles';
import { parseGpx } from '../core/gpxParser';
import { SPORT_PROFILES } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import { useOpenSession } from '../hooks/useIncomingSession';
import { dismissRecorderResult, startRecording, stopRecording, useRecorder } from '../hooks/useRecorder';
import { canDownloadFiles, downloadTextFile, readPickedFile } from '../platform/files';
import { createReplaySource, deviceLocationSource, type LocationFix } from '../platform/location';
import { isNativeApp } from '../platform/runtime';
import { fixesFromRawPoints } from '../recording/session';

/**
 * Enregistrement d'une session : support, démarrer, arrêter, et ce qu'il faut
 * pour juger en direct que l'enregistrement tient (points, durée, plus long
 * trou, précision). Volontairement sobre : cette page deviendra l'onglet
 * « Enregistrer » de la future navigation.
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

const pad = (n: number): string => String(n).padStart(2, '0');

/** Durée en `h:mm:ss`. */
const formatClock = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
};

const BUTTON_STYLE = {
  padding: '14px 28px',
  fontSize: '18px',
  fontWeight: 'bold',
  border: 'none',
  borderRadius: '10px',
  color: '#fff',
  cursor: 'pointer',
} as const;

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div style={{ flex: '1 1 130px' }}>
    <div style={{ fontSize: '13px', color: '#666' }}>{label}</div>
    <div style={{ fontSize: '26px', fontWeight: 'bold' }}>{value}</div>
  </div>
);

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
  const { stats, saved } = recorder;
  const durationMs = stats.firstMs !== null && stats.lastMs !== null ? stats.lastMs - stats.firstMs : 0;
  const meanIntervalS = stats.pointCount > 1 ? durationMs / 1000 / (stats.pointCount - 1) : null;
  const canStart = !busy && (sourceChoice === 'device' || replay !== null);

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

  const handleStart = () => {
    const source = sourceChoice === 'replay' && replay
      ? createReplaySource(replay.fixes, replaySpeed)
      : deviceLocationSource();
    void startRecording(sport, source);
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '760px', margin: '0 auto' }}>
      <ModuleNav />
      <h1 style={{ fontSize: '1.8rem' }}>Enregistrer une session</h1>

      <div style={{ ...CARD_STYLE, display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '16px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <strong>Support :</strong>
          <select value={sport} disabled={busy} onChange={(e) => setSport(e.target.value as SportType)}
            style={{ padding: '8px', fontSize: '16px' }}>
            {SPORTS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>

        {native ? (
          <div><strong>Source :</strong> GPS du téléphone</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <strong>Source :</strong>
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
                  <select value={replaySpeed} disabled={busy} onChange={(e) => setReplaySpeed(Number(e.target.value))}>
                    {REPLAY_SPEEDS.map((s) => <option key={s} value={s}>×{s}</option>)}
                  </select>
                </label>
                {replay && <span style={{ color: '#555' }}>{replay.fixes.length} points</span>}
              </div>
            )}
            {replayError && <div style={{ color: '#c62828' }}>{replayError}</div>}
          </div>
        )}

        <div>
          {busy ? (
            <button type="button" onClick={() => void stopRecording()} disabled={recorder.status !== 'recording'}
              style={{ ...BUTTON_STYLE, backgroundColor: '#c62828' }}>
              {recorder.status === 'stopping' ? 'Enregistrement du fichier…' : '■ Arrêter'}
            </button>
          ) : (
            <button type="button" onClick={handleStart} disabled={!canStart}
              style={{ ...BUTTON_STYLE, backgroundColor: canStart ? '#2e7d32' : '#9e9e9e' }}>
              ● Démarrer
            </button>
          )}
        </div>
      </div>

      {recorder.error && (
        <div style={{ ...CARD_STYLE, backgroundColor: '#ffebee', color: '#b71c1c' }}>{recorder.error}</div>
      )}

      {(busy || stats.pointCount > 0) && (
        <div style={{ ...CARD_STYLE, marginTop: '16px' }}>
          <div style={{ marginBottom: '10px', color: '#555' }}>
            {busy ? `En cours : ${SPORT_PROFILES[recorder.sport ?? sport].label}, ${recorder.sourceLabel}` : 'Dernier enregistrement'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
            <Stat label="Durée" value={formatClock(durationMs)} />
            <Stat label="Points" value={String(stats.pointCount)} />
            <Stat label="Intervalle moyen" value={meanIntervalS === null ? '—' : `${meanIntervalS.toFixed(1)} s`} />
            <Stat label="Plus long trou" value={`${Math.round(stats.longestGapS)} s`} />
            <Stat label="Précision" value={stats.lastAccuracyM === null ? '—' : `${Math.round(stats.lastAccuracyM)} m`} />
          </div>
        </div>
      )}

      {saved && (
        <div style={{ ...CARD_STYLE, marginTop: '16px', backgroundColor: '#e8f5e9' }}>
          <strong>{saved.recovered ? 'Session interrompue récupérée' : 'Session enregistrée'}</strong>
          <p style={{ margin: '8px 0' }}>
            {SPORT_PROFILES[saved.sport].label}, {saved.pointCount} points.<br />
            Rangée dans : {saved.location}
          </p>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button type="button" style={{ ...BUTTON_STYLE, backgroundColor: '#1976d2', fontSize: '16px' }}
              onClick={() => openSession({ content: saved.content, fileName: saved.fileName, sport: saved.sport })}>
              Analyser
            </button>
            {canDownloadFiles() && (
              <button type="button" style={{ ...BUTTON_STYLE, backgroundColor: '#455a64', fontSize: '16px' }}
                onClick={() => downloadTextFile(saved.fileName, saved.content)}>
                Télécharger le GPX
              </button>
            )}
            <button type="button" style={{ ...BUTTON_STYLE, backgroundColor: '#9e9e9e', fontSize: '16px' }}
              onClick={dismissRecorderResult}>
              Fermer
            </button>
          </div>
        </div>
      )}

      {native && !busy && (
        <div style={{ marginTop: '20px', fontSize: '14px', color: '#555', lineHeight: 1.5 }}>
          Pour un enregistrement écran éteint : autoriser la position et les notifications au premier démarrage ;
          dans les réglages de l'application, activer le démarrage automatique et mettre la batterie en « Aucune
          restriction ». Pendant l'enregistrement, ne pas balayer l'application hors des applications récentes.
        </div>
      )}
    </div>
  );
}

export default RecordingPage;
