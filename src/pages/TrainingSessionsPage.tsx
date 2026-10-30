import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import PageHeader from '../components/ui/PageHeader';
import { IconChevronDown, IconChevronUp, IconPlay } from '../components/icons';
import { FAMILY_ACCENT, activitiesOfFamily } from '../core/activities';
import { isIntervalSport, trainingKind } from '../core/sportProfiles';
import { isIntervalTimerActive, startIntervals } from '../hooks/useIntervalTimer';
import { useRecorderStatus } from '../hooks/useRecorder';
import {
  lastRecordedOrFirst, rememberIntervalWorkout, removeIntervalPreset, saveIntervalPreset, useIntervalSettings, useVisibility,
} from '../hooks/useSportSettings';
import {
  MAX_INTERVAL_PRESETS, formatIntervalClock, workoutDurationS, workoutLabel,
  type IntervalPreset, type WorkoutKind,
} from '../recording/intervalTimer';
import { TestTiles } from './TestsPage';
import { TIMER_RECORD_PATH, WORKOUT_LISTS, recordPath } from '../recording/workoutLists';
import './TrainingPages.css';

/**
 * Fractionné (24/10) et Timer (25/10), depuis la page Entraînement : les
 * séances du compteur d'intervalles, gardées, chacun sa liste
 * (`WORKOUT_LISTS`), en liste simplifiée (titre, « Lancer », flèche) ;
 * « Créer » et « Modifier » ouvrent la page d'édition
 * (`TrainingSessionEditPage`, 25/10), « Dupliquer » et « Retirer » restent ici.
 * « Lancer », en Fractionné, met la séance dans la carte du compteur (retenue
 * comme la dernière lancée) et ouvre Enregistrer prêt sur la dernière
 * activité de fractionné enregistrée, sinon la première (à pied ou vélo se
 * change là), le bouton rond démarre ; au Timer (26/10), il lance la séance
 * tout de suite et ouvre la page du compteur, sans GPS ni session, et pas
 * pendant un enregistrement ; une séance du compteur en cours n'est
 * remplacée qu'après confirmation.
 *
 * Muscu et timer (lot I du 25/10) : chaque séance se lance en « Timer » (le
 * compteur seul, comme avant) ou en « Muscu » : Enregistrer ouvert sur la
 * dernière activité de muscu, la séance mise dans la carte du compteur, sans
 * la démarrer ; « Démarrer » (ceinture connectée) lance la session, et le
 * compteur se lance d'un geste. Un lien sous la liste ouvre la muscu sans
 * séance. Fractionné et tests : la rangée des tests sous la liste.
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
  const activity = useMemo(() => lastRecordedOrFirst(intervalActivities), [intervalActivities]);
  // Muscu : la dernière activité de muscu enregistrée, sinon la première visible.
  const muscu = useMemo(() => {
    return lastRecordedOrFirst(activitiesOfFamily(activities.filter(isShown), 'fractionne').filter((a) => trainingKind(a.base) === 'muscu'));
  }, [activities, isShown]);
  const muscuPath = timer && !recording && muscu ? recordPath(muscu.id) : null;
  /** « Muscu » : la séance dans la carte du compteur d'Enregistrer, prête, sans la démarrer. */
  const launchMuscu = (preset: { workout: IntervalPreset['workout'] }) => {
    if (!muscuPath) return;
    rememberIntervalWorkout('timer', preset.workout);
    navigate(muscuPath);
  };
  const [openId, setOpenId] = useState<string | null>(null);

  // Où « Lancer » mène : le Timer, hors d'un enregistrement ; le Fractionné, sur son activité.
  const launchPath = timer
    ? (recording ? null : TIMER_RECORD_PATH)
    : activity && recordPath(activity.id);
  const launch = (preset: { workout: IntervalPreset['workout'] }) => {
    if (!launchPath) return;
    if (timer) {
      if (isIntervalTimerActive() && !window.confirm("Une séance du compteur est en cours : l'arrêter et lancer celle-ci ?")) return;
      startIntervals(preset.workout, 'timer');
    } else {
      rememberIntervalWorkout(kind, preset.workout);
    }
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
        <div className="ui-alert">Un enregistrement est en cours : le Timer et la muscu se lancent une fois la session arrêtée.</div>
      )}
      {timer && !muscu && (
        <div className="ui-alert ui-alert--warning">
          Aucune activité de muscu visible : ajoutez-en une, ou ré-affichez-la, dans <Link to="/parametres">Réglages</Link>.
        </div>
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
              <div className={`train-item__head${timer ? ' train-item__head--timer' : ''}`}>
                <span className="train-item__name">{preset.name}</span>
                <button type="button" className="train-item__toggle" aria-expanded={openId === preset.id}
                  aria-label={`${openId === preset.id ? 'Replier' : 'Déplier'} : ${preset.name}`}
                  onClick={() => setOpenId(openId === preset.id ? null : preset.id)}>
                  {openId === preset.id ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />}
                </button>
                <div className="train-item__buttons">
                  <Button variant="primary" size="s" disabled={!launchPath} onClick={() => launch(preset)}>
                    <IconPlay size={16} />
                    {timer ? 'Timer' : 'Lancer'}
                  </Button>
                  {timer && (
                    <Button variant="primary" size="s" disabled={!muscuPath} onClick={() => launchMuscu(preset)}
                      title="Enregistrer la séance avec la ceinture cardio">
                      <span className="ui-record-dot" />
                      Enregistrer
                    </Button>
                  )}
                </div>
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
        <Card><p className="ui-hint">{list.empty}</p></Card>
      )}

      <div className="train-actions">
        <Button variant="primary" disabled={full} onClick={() => navigate(list.editPath)}>{list.create}</Button>
        {full && <span className="ui-hint">{MAX_INTERVAL_PRESETS} séances au plus : retirez-en une.</span>}
      </div>

      {timer && muscuPath && (
        <Link to={muscuPath} className="ui-hint" style={{ alignSelf: 'flex-start' }}>Enregistrer sans séance</Link>
      )}

      {!timer && (
        <section className="train-tests" aria-label="Tests">
          <h2 className="ui-eyebrow" style={{ margin: 0 }}>Tests</h2>
          <TestTiles />
        </section>
      )}
    </div>
  );
}

export default TrainingSessionsPage;
