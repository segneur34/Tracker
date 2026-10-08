import { useState } from 'react';
import Button from './ui/Button';
import Card from './ui/Card';
import { IconPause, IconPlay } from './icons';
import {
  closeIntervals, pauseIntervals, resumeIntervals, skipIntervalPhase, startIntervals, stopIntervals, useIntervalTimer,
} from '../hooks/useIntervalTimer';
import { removeIntervalPreset, saveIntervalPreset, useIntervalSettings } from '../hooks/useSportSettings';
import {
  INTERVAL_LEAD_IN_S, INTERVAL_LIMITS, MAX_INTERVAL_PRESETS, formatIntervalClock, phaseName, sameWorkout, sanitizeWorkout, workoutDurationS, workoutLabel,
  type IntervalWorkout,
} from '../recording/intervalTimer';
import './IntervalCard.css';

/**
 * Compteur du fractionné, sur la page Enregistrer (§10, point 89) : la
 * séance (répétitions, travail, repos), les séances gardées, « Lancer le
 * compteur », puis la phase en cours en grand et ses commandes. Il vit à côté
 * de l'enregistrement sans en dépendre : lancé avant, pendant ou sans lui.
 */

const range = (from: number, to: number, step = 1): number[] =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

const REPS = range(INTERVAL_LIMITS.reps.min, INTERVAL_LIMITS.reps.max);
const MINUTES = range(0, Math.floor(INTERVAL_LIMITS.workS.max / 60));
/** Secondes proposées, de 5 en 5 : la précision d'une séance de fractionné. */
const SECONDS = range(0, 55, 5);

/** Une durée en minutes et secondes, deux listes. */
function DurationField({ label, seconds, onChange }: { label: string; seconds: number; onChange: (s: number) => void }) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  // Une valeur gardée hors du pas de 5 s reste proposée telle quelle.
  const secondChoices = SECONDS.includes(rest) ? SECONDS : [...SECONDS, rest].sort((a, b) => a - b);
  return (
    <div className="ivl-field">
      <span className="ui-eyebrow">{label}</span>
      <span className="ivl-field__pair">
        <select value={minutes} aria-label={`${label}, minutes`} className="ui-field" onChange={(e) => onChange(Number(e.target.value) * 60 + rest)}>
          {MINUTES.map((m) => <option key={m} value={m}>{m} min</option>)}
        </select>
        <select value={rest} aria-label={`${label}, secondes`} className="ui-field" onChange={(e) => onChange(minutes * 60 + Number(e.target.value))}>
          {secondChoices.map((s) => <option key={s} value={s}>{String(s).padStart(2, '0')} s</option>)}
        </select>
      </span>
    </div>
  );
}

/** Choix de la séance, séances gardées, lancement. */
function WorkoutEditor({ recording }: { recording: boolean }) {
  const { presets, last } = useIntervalSettings();
  const [workout, setWorkout] = useState<IntervalWorkout>(last);
  const [naming, setNaming] = useState<string | null>(null);
  const valid = sanitizeWorkout(workout) !== null;
  const set = (patch: Partial<IntervalWorkout>) => setWorkout((w) => ({ ...w, ...patch }));
  const save = () => {
    if (naming === null || !valid) return;
    saveIntervalPreset(naming, workout);
    setNaming(null);
  };
  const askRemove = (id: string, name: string) => {
    if (window.confirm(`Retirer la séance « ${name} » ?`)) removeIntervalPreset(id);
  };

  return (
    <>
      {presets.length > 0 && (
        <div className="ivl-presets" aria-label="Séances gardées">
          {presets.map((p) => (
            <span key={p.id} className="ivl-preset">
              <button type="button" className="ivl-preset__pick" aria-pressed={sameWorkout(p.workout, workout)} onClick={() => setWorkout(p.workout)}
                title={workoutLabel(p.workout)}>
                {p.name}
                {p.name !== workoutLabel(p.workout) && <span className="ivl-preset__detail">{workoutLabel(p.workout)}</span>}
              </button>
              <button type="button" className="ivl-preset__remove" aria-label={`Retirer ${p.name}`} onClick={() => askRemove(p.id, p.name)}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="ivl-fields">
        <div className="ivl-field">
          <span className="ui-eyebrow">Répétitions</span>
          <select value={workout.reps} aria-label="Répétitions" className="ui-field" onChange={(e) => set({ reps: Number(e.target.value) })}>
            {REPS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <DurationField label="Travail" seconds={workout.workS} onChange={(workS) => set({ workS })} />
        <DurationField label="Repos" seconds={workout.restS} onChange={(restS) => set({ restS })} />
      </div>
      <p className="ivl-summary">
        {valid
          ? <>{workoutLabel(workout)} · {formatIntervalClock(workoutDurationS(workout))} en tout</>
          : `Travail de ${INTERVAL_LIMITS.workS.min} s à ${INTERVAL_LIMITS.workS.max / 60} min, repos de ${INTERVAL_LIMITS.restS.max / 60} min au plus.`}
      </p>
      {naming !== null ? (
        <div className="ivl-actions">
          <input value={naming} maxLength={40} autoFocus placeholder={workoutLabel(workout)} aria-label="Nom de la séance"
            className="ui-field ivl-name" onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setNaming(null); }} />
          <Button onClick={save} disabled={!valid}>Garder</Button>
          <Button variant="ghost" onClick={() => setNaming(null)}>Annuler</Button>
        </div>
      ) : (
        <div className="ivl-actions">
          <Button variant="primary" size="l" className="ivl-launch" disabled={!valid} onClick={() => startIntervals(workout)}>
            <IconPlay size={20} />
            Lancer le compteur
          </Button>
          <Button onClick={() => setNaming('')} disabled={!valid || presets.length >= MAX_INTERVAL_PRESETS}>Garder cette séance</Button>
        </div>
      )}
      <p className="ivl-note">
        {recording
          ? 'Les répétitions faites pendant l\'enregistrement sont rangées avec la session.'
          : 'Le compteur tourne seul ou avec un enregistrement, lancé avant ou après lui.'}
      </p>
    </>
  );
}

/** Compteur du fractionné : la séance à lancer, ou celle en cours. `recording` : un enregistrement tourne. */
function IntervalCard({ recording }: { recording: boolean }) {
  const { run, state, error } = useIntervalTimer();

  if (!run || !state) {
    return (
      <Card heading="Compteur" className="ivl">
        <WorkoutEditor recording={recording} />
      </Card>
    );
  }

  const reps = run.workout.reps;
  if (state.status === 'finished' || state.status === 'stopped') {
    return (
      <Card heading="Compteur" className="ivl">
        <div className="ivl-done">
          <strong>{state.status === 'finished' ? 'Séance terminée' : 'Séance arrêtée'}</strong>
          <span>{workoutLabel(run.workout)}</span>
        </div>
        <div className="ivl-actions">
          <Button onClick={closeIntervals}>Fermer</Button>
        </div>
      </Card>
    );
  }

  const phase = state.phase!;
  const paused = state.status === 'paused';
  const phaseMs = (phase.endS - phase.startS) * 1000;
  const done = phaseMs > 0 ? Math.min(1, 1 - state.remainingMs / phaseMs) : 1;
  // Reste de la séance, compte à rebours du départ ôté.
  const leftS = Math.min(workoutDurationS(run.workout), workoutDurationS(run.workout) + INTERVAL_LEAD_IN_S - state.elapsedS);
  return (
    <Card heading="Compteur" className={`ivl ivl--${phase.kind}`}>
      <div className="ivl-live" aria-live="polite">
        <span className="ivl-live__phase">{phaseName(phase, reps)}{paused ? ' · en pause' : ''}</span>
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
        <Button variant="danger" onClick={stopIntervals}>Arrêter</Button>
      </div>
      {error && <div className="ui-alert ui-alert--danger">{error}</div>}
    </Card>
  );
}

export default IntervalCard;
