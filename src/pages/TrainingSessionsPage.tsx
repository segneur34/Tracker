import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import PageHeader from '../components/ui/PageHeader';
import { IconChevronDown, IconChevronUp, IconPlay } from '../components/icons';
import { FAMILY_ACCENT, activitiesOfFamily } from '../core/activities';
import { isIntervalSport } from '../core/sportProfiles';
import { useRecorderStatus } from '../hooks/useRecorder';
import {
  lastRecordActivity, rememberIntervalWorkout, removeIntervalPreset, saveIntervalPreset, useIntervalSettings, useVisibility,
} from '../hooks/useSportSettings';
import {
  MAX_INTERVAL_PRESETS, formatIntervalClock, workoutDurationS, workoutLabel,
  type IntervalPreset, type WorkoutKind,
} from '../recording/intervalTimer';
import { TIMER_RECORD_PATH, WORKOUT_LISTS } from './workoutLists';
import './TrainingPages.css';

/**
 * Fractionné (24/10) et Timer (25/10), depuis la page Entraînement : les
 * séances du compteur d'intervalles, gardées, chacun sa liste
 * (`WORKOUT_LISTS`), en liste simplifiée (titre, « Lancer », flèche) ;
 * « Créer » et « Modifier » ouvrent la page d'édition
 * (`TrainingSessionEditPage`, 25/10), « Dupliquer » et « Retirer » restent ici.
 * « Lancer » met la séance dans la carte du compteur (retenue comme la
 * dernière lancée) et ouvre Enregistrer : en Fractionné, prêt sur la dernière
 * activité de fractionné enregistrée, sinon la première (à pied ou vélo se
 * change là), le bouton rond démarre ; au Timer, le compteur seul, sans GPS
 * ni session, et pas pendant un enregistrement.
 */

function TrainingSessionsPage({ kind }: { kind: WorkoutKind }) {
  const navigate = useNavigate();
  const list = WORKOUT_LISTS[kind];
  const timer = kind === 'timer';
  const { presets } = useIntervalSettings(kind);
  const recording = useRecorderStatus() !== 'idle';
  const { activities, isShown } = useVisibility();
  // Les activités de fractionné visibles : celles qu'on peut lancer avec le compteur.
  const intervalActivities = useMemo(
    () => activitiesOfFamily(activities.filter(isShown), 'fractionne').filter((a) => isIntervalSport(a.base)),
    [activities, isShown]
  );
  const activity = useMemo(() => {
    const last = lastRecordActivity();
    return intervalActivities.find((a) => a.id === last?.id) ?? intervalActivities[0] ?? null;
  }, [intervalActivities]);
  const [openId, setOpenId] = useState<string | null>(null);

  // Où « Lancer » mène : le Timer, hors d'un enregistrement ; le Fractionné, sur son activité.
  const launchPath = timer
    ? (recording ? null : TIMER_RECORD_PATH)
    : activity && `/enregistrer?activite=${encodeURIComponent(activity.id)}`;
  const launch = (preset: { workout: IntervalPreset['workout'] }) => {
    if (!launchPath) return;
    rememberIntervalWorkout(kind, preset.workout);
    navigate(launchPath);
  };
  const askRemove = (preset: IntervalPreset) => {
    if (window.confirm(`Retirer la séance « ${preset.name} » ?`)) {
      removeIntervalPreset(kind, preset.id);
      setOpenId(null);
    }
  };
  const full = presets.length >= MAX_INTERVAL_PRESETS;
  const accent = FAMILY_ACCENT.fractionne;

  return (
    <div className="ui-page train-page" style={{ '--help-accent': accent } as React.CSSProperties}>
      <PageHeader title={list.title} back={{ to: '/fractionne', label: 'Entraînement' }} subtitle={list.subtitle} />

      {timer && recording && (
        <div className="ui-alert">Un enregistrement est en cours : le Timer se lance une fois la session arrêtée.</div>
      )}
      {!timer && intervalActivities.length === 0 && (
        <div className="ui-alert ui-alert--warning">
          Aucune activité de fractionné visible : ajoutez-en une, ou ré-affichez-la, dans <Link to="/parametres">Réglages</Link>.
        </div>
      )}

      {presets.length > 0 ? (
        <ul className="train-list" aria-label="Séances gardées">
          {presets.map((preset) => (
            <li key={preset.id} className="ui-card train-item">
              <div className="train-item__head">
                <span className="train-item__name">{preset.name}</span>
                <Button variant="primary" size="s" disabled={!launchPath} onClick={() => launch(preset)}>
                  <IconPlay size={16} />
                  Lancer
                </Button>
                <button type="button" className="train-item__toggle" aria-expanded={openId === preset.id}
                  aria-label={`${openId === preset.id ? 'Replier' : 'Déplier'} : ${preset.name}`}
                  onClick={() => setOpenId(openId === preset.id ? null : preset.id)}>
                  {openId === preset.id ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />}
                </button>
              </div>
              {openId === preset.id && (
                <div className="train-item__body">
                  <div className="train-item__text">
                    {preset.name !== workoutLabel(preset.workout) && <span className="train-item__detail">{workoutLabel(preset.workout)}</span>}
                    <span className="train-item__detail num">{formatIntervalClock(workoutDurationS(preset.workout))} en tout</span>
                  </div>
                  <div className="train-item__actions">
                    <Button size="s" onClick={() => navigate(`${list.editPath}?id=${encodeURIComponent(preset.id)}`)}>Modifier</Button>
                    <Button size="s" disabled={full} onClick={() => saveIntervalPreset(kind, `${preset.name} (copie)`.slice(0, 40), preset.workout)}>Dupliquer</Button>
                    <Button size="s" variant="ghost" onClick={() => askRemove(preset)}>Retirer</Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Card><p className="train-hint">{list.empty}</p></Card>
      )}

      <div className="train-actions">
        <Button variant="primary" disabled={full} onClick={() => navigate(list.editPath)}>{list.create}</Button>
        {full && <span className="train-hint">{MAX_INTERVAL_PRESETS} séances au plus : retirez-en une.</span>}
      </div>
    </div>
  );
}

export default TrainingSessionsPage;
