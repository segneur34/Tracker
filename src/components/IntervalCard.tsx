import { useState } from 'react';
import { Link } from 'react-router-dom';
import Button from './ui/Button';
import Card from './ui/Card';
import HoldButton from './ui/HoldButton';
import { IconPause, IconPlay } from './icons';
import {
  closeIntervals, pauseIntervals, resumeIntervals, skipIntervalPhase, startIntervals, stopIntervals, useIntervalTimer,
  type IntervalTimerView,
} from '../hooks/useIntervalTimer';
import {
  lapStopwatch, pauseStopwatch, resetStopwatch, resumeStopwatch, startStopwatchRun, useStopwatch,
} from '../hooks/useStopwatch';
import { removeIntervalPreset, saveIntervalPreset, useIntervalSettings } from '../hooks/useSportSettings';
import {
  INTERVAL_LEAD_IN_S, MAX_INTERVAL_PRESETS, formatIntervalClock, phaseName, sameWorkout, workoutBlocks, workoutDurationS, workoutFromBlocks, workoutLabel,
  type IntervalBlock, type WorkoutKind,
} from '../recording/intervalTimer';
import { formatStopwatch, type StopwatchState } from '../recording/stopwatch';
import { WORKOUT_LISTS } from '../pages/workoutLists';
import WorkoutBlocksEditor from './WorkoutBlocksEditor';
import './IntervalCard.css';

/**
 * Compteur du fractionné, sur la page Enregistrer (§10, point 89) : la
 * séance, bloc par bloc (`WorkoutBlocksEditor`), les séances gardées
 * (gérées aussi sur la page Séances), « Lancer le compteur », puis la phase
 * en cours en grand et ses commandes. Il vit à côté
 * de l'enregistrement sans en dépendre : lancé avant, pendant ou sans lui.
 * Une bascule montre à sa place le chronomètre libre (`useStopwatch`).
 * Au Timer (25/10), les séances sont celles du Timer, et la séance lancée
 * n'ira dans aucune session.
 */

/** Choix de la séance, séances gardées du genre, lancement. */
function WorkoutEditor({ kind, recording }: { kind: WorkoutKind; recording: boolean }) {
  const { presets, last } = useIntervalSettings(kind);
  const [blocks, setBlocks] = useState<IntervalBlock[]>(() => workoutBlocks(last));
  const [naming, setNaming] = useState<string | null>(null);
  const workout = workoutFromBlocks(blocks);
  const save = () => {
    if (naming === null || !workout) return;
    saveIntervalPreset(kind, naming, workout);
    setNaming(null);
  };
  const askRemove = (id: string, name: string) => {
    if (window.confirm(`Retirer la séance « ${name} » ?`)) removeIntervalPreset(kind, id);
  };

  return (
    <>
      {presets.length > 0 && (
        <div className="ivl-presets" aria-label="Séances gardées">
          {presets.map((p) => (
            <span key={p.id} className="ivl-preset">
              <button type="button" className="ivl-preset__pick" aria-pressed={workout !== null && sameWorkout(p.workout, workout)}
                onClick={() => setBlocks(workoutBlocks(p.workout))} title={workoutLabel(p.workout)}>
                {p.name}
                {p.name !== workoutLabel(p.workout) && <span className="ivl-preset__detail">{workoutLabel(p.workout)}</span>}
              </button>
              <button type="button" className="ivl-preset__remove" aria-label={`Retirer ${p.name}`} onClick={() => askRemove(p.id, p.name)}>×</button>
            </span>
          ))}
        </div>
      )}
      <WorkoutBlocksEditor blocks={blocks} onChange={setBlocks} />
      {naming !== null ? (
        <div className="ivl-actions">
          <input value={naming} maxLength={40} autoFocus placeholder={workout ? workoutLabel(workout) : ''} aria-label="Nom de la séance"
            className="ui-field ivl-name" onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setNaming(null); }} />
          <Button onClick={save} disabled={!workout}>Garder</Button>
          <Button variant="ghost" onClick={() => setNaming(null)}>Annuler</Button>
        </div>
      ) : (
        <div className="ivl-actions">
          <Button variant="primary" size="l" className="ivl-launch" disabled={!workout} onClick={() => workout && startIntervals(workout, kind)}>
            <IconPlay size={20} />
            Lancer le compteur
          </Button>
          <Button onClick={() => setNaming('')} disabled={!workout || presets.length >= MAX_INTERVAL_PRESETS}>Garder cette séance</Button>
        </div>
      )}
      <p className="ivl-note">
        {kind === 'timer'
          ? 'Sans GPS ni session : le compteur seul.'
          : recording
            ? "Les répétitions faites pendant l'enregistrement sont rangées avec la session."
            : 'Le compteur tourne seul ou avec un enregistrement, lancé avant ou après lui.'}
        {' '}<Link to={WORKOUT_LISTS[kind].listPath}>Gérer les séances</Link>
      </p>
    </>
  );
}

/** Appui qui arrête la séance du compteur (25/10) : 1 s, pour qu'un geste involontaire ne la coupe pas. */
const COUNTER_STOP_HOLD_MS = 1000;
const counterStopHoldMs = () => COUNTER_STOP_HOLD_MS;

/** Vue « Compteur » : la séance à lancer, ou celle en cours. `recording` : un enregistrement tourne. */
function CounterView({ kind, recording, timer }: { kind: WorkoutKind; recording: boolean; timer: IntervalTimerView }) {
  const { run, state, error } = timer;

  if (!run || !state) return <WorkoutEditor kind={kind} recording={recording} />;

  if (state.status === 'finished' || state.status === 'stopped') {
    return (
      <>
        <div className="ivl-done">
          <strong>{state.status === 'finished' ? 'Séance terminée' : 'Séance arrêtée'}</strong>
          <span>{workoutLabel(run.workout)}</span>
        </div>
        <div className="ivl-actions">
          <Button onClick={closeIntervals}>Fermer</Button>
        </div>
      </>
    );
  }

  const phase = state.phase!;
  const paused = state.status === 'paused';
  const phaseMs = (phase.endS - phase.startS) * 1000;
  const done = phaseMs > 0 ? Math.min(1, 1 - state.remainingMs / phaseMs) : 1;
  // Reste de la séance, compte à rebours du départ ôté.
  const leftS = Math.min(workoutDurationS(run.workout), workoutDurationS(run.workout) + INTERVAL_LEAD_IN_S - state.elapsedS);
  return (
    <>
      <div className="ivl-live" aria-live="polite">
        <span className="ivl-live__phase">{phaseName(phase)}{paused ? ' · en pause' : ''}</span>
        <span className="ivl-live__clock num">{formatIntervalClock(state.remainingMs / 1000)}</span>
        <span className="ivl-live__bar" aria-hidden="true"><span style={{ width: `${Math.round(done * 100)}%` }} /></span>
        <span className="ivl-live__left">{workoutLabel(run.workout)} · reste {formatIntervalClock(leftS)}</span>
      </div>
      <div className="ivl-actions">
        {paused ? (
          <Button variant="primary" onClick={resumeIntervals}><IconPlay size={18} />Reprendre</Button>
        ) : (
          <Button onClick={pauseIntervals}><IconPause size={18} />Pause</Button>
        )}
        <Button onClick={skipIntervalPhase}>Passer</Button>
        <HoldButton onHold={stopIntervals} getHoldMs={counterStopHoldMs} label="Arrêter" dialTitle="Arrêter la séance" />
      </div>
      {error && <div className="ui-alert ui-alert--danger">{error}</div>}
    </>
  );
}

/** Vue « Chrono » : chronomètre libre, avec ses tours, le dernier en haut. */
function StopwatchView({ state }: { state: StopwatchState | null }) {
  if (!state) {
    return (
      <>
        <div className="ivl-live">
          <span className="ivl-live__clock num">{formatStopwatch(0)}</span>
          <span className="ivl-live__left">Libre, à côté du compteur et de l'enregistrement : départ, tours, arrêt.</span>
        </div>
        <div className="ivl-actions">
          <Button variant="primary" size="l" className="ivl-launch" onClick={startStopwatchRun}><IconPlay size={20} />Départ</Button>
        </div>
      </>
    );
  }
  const paused = state.status === 'paused';
  const best = state.laps.length > 1 ? Math.min(...state.laps.map((l) => l.lapMs)) : null;
  return (
    <>
      <div className="ivl-live">
        {paused && <span className="ivl-live__phase">À l'arrêt</span>}
        <span className="ivl-live__clock num">{formatStopwatch(state.elapsedMs)}</span>
        <span className="ivl-live__left num">Tour {state.laps.length + 1} · {formatStopwatch(state.currentLapMs)}</span>
      </div>
      <div className="ivl-actions">
        {paused ? (
          <>
            <Button variant="primary" onClick={resumeStopwatch}><IconPlay size={18} />Reprendre</Button>
            <Button variant="danger" onClick={resetStopwatch}>Remise à zéro</Button>
          </>
        ) : (
          <>
            <Button variant="primary" onClick={lapStopwatch}>Tour</Button>
            <Button onClick={pauseStopwatch}><IconPause size={18} />Arrêt</Button>
          </>
        )}
      </div>
      {state.laps.length > 0 && (
        <table className="ivl-laps num">
          <thead>
            <tr><th>Tour</th><th>Temps</th><th>Cumul</th></tr>
          </thead>
          <tbody>
            {[...state.laps].reverse().map((lap) => (
              <tr key={lap.n} className={lap.lapMs === best ? 'ivl-laps__best' : undefined}>
                <td>{lap.n}</td>
                <td>{formatStopwatch(lap.lapMs)}</td>
                <td>{formatStopwatch(lap.totalMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

type CardView = 'compteur' | 'chrono';

/**
 * Carte du compteur, deux vues par une bascule : le compteur (séances du
 * fractionné, ou du Timer selon `kind`) et le chronomètre libre. Celle qu'on
 * ne regarde pas, si elle tourne, se rappelle en pastille sur son bouton.
 * `recording` : un enregistrement tourne.
 */
function IntervalCard({ kind = 'fractionne', recording }: { kind?: WorkoutKind; recording: boolean }) {
  const timer = useIntervalTimer();
  const { state: chrono } = useStopwatch();
  const counterLive = timer.state?.status === 'running' || timer.state?.status === 'paused';
  // Ouverte sur le chrono quand lui seul est lancé.
  const [shown, setShown] = useState<CardView>(() => (chrono && !timer.run ? 'chrono' : 'compteur'));

  const counterBadge = shown === 'chrono' && counterLive && timer.run && timer.state?.phase
    ? phaseName(timer.state.phase) : null;
  const chronoBadge = shown === 'compteur' && chrono
    ? `${formatStopwatch(chrono.elapsedMs)}${chrono.status === 'paused' ? ' · arrêt' : ''}` : null;
  const phaseClass = shown === 'compteur' && counterLive && timer.state?.phase ? ` ivl--${timer.state.phase.kind}` : '';

  return (
    <Card className={`ivl${phaseClass}`} aria-label="Compteur">
      <div className="ivl-switch" role="group" aria-label="Compteur ou chrono">
        <button type="button" className="ivl-switch__pick" aria-pressed={shown === 'compteur'} onClick={() => setShown('compteur')}>
          Compteur
          {counterBadge && <span className="ivl-switch__badge num">{counterBadge}</span>}
        </button>
        <button type="button" className="ivl-switch__pick" aria-pressed={shown === 'chrono'} onClick={() => setShown('chrono')}>
          Chrono
          {chronoBadge && <span className="ivl-switch__badge num">{chronoBadge}</span>}
        </button>
      </div>
      {shown === 'compteur' ? <CounterView kind={kind} recording={recording} timer={timer} /> : <StopwatchView state={chrono} />}
    </Card>
  );
}

export default IntervalCard;
