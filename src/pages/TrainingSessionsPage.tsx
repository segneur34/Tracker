import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Dialog from '../components/ui/Dialog';
import PageHeader from '../components/ui/PageHeader';
import WorkoutBlocksEditor from '../components/WorkoutBlocksEditor';
import { IconChevronDown, IconChevronUp, IconClose, IconPlay } from '../components/icons';
import { FAMILY_ACCENT, activitiesOfFamily } from '../core/activities';
import { isIntervalSport } from '../core/sportProfiles';
import {
  lastRecordActivity, rememberIntervalWorkout, removeIntervalPreset, saveIntervalPreset, updateIntervalPreset, useIntervalSettings, useVisibility,
} from '../hooks/useSportSettings';
import {
  MAX_INTERVAL_PRESETS, formatIntervalClock, workoutBlocks, workoutDurationS, workoutFromBlocks, workoutLabel,
  type IntervalBlock, type IntervalPreset,
} from '../recording/intervalTimer';
import './TrainingPages.css';

/**
 * Fractionné (24/10), depuis la page Entraînement : les séances du compteur
 * d'intervalles, gardées, à créer, modifier, dupliquer ou retirer, bloc par
 * bloc (`WorkoutBlocksEditor`), et « Lancer », qui ouvre Enregistrer prêt en
 * Fractionné (la dernière activité de fractionné enregistrée, sinon la
 * première ; à pied ou vélo se change là), la séance dans la carte du
 * compteur (retenue comme la dernière lancée). Le bouton rond démarre.
 */

/** Séance en cours d'écriture : une nouvelle, ou une gardée qu'on modifie. */
interface Draft {
  id: string | null;
  name: string;
  blocks: IntervalBlock[];
  /** Nom et blocs à l'ouverture : pour savoir si la croix a des changements à signaler. */
  initial: string;
}

const snapshot = (name: string, blocks: IntervalBlock[]) => JSON.stringify([name, blocks]);

const NEW_BLOCKS: IntervalBlock[] = [
  { kind: 'libre', label: 'Échauffement', durationS: 600 },
  { kind: 'series', reps: 3, workS: 180, restS: 60 },
  { kind: 'libre', label: 'Retour au calme', durationS: 600 },
];

function TrainingSessionsPage() {
  const navigate = useNavigate();
  const { presets } = useIntervalSettings();
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
  const [draft, setDraft] = useState<Draft | null>(null);
  const [askClose, setAskClose] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const draftWorkout = draft ? workoutFromBlocks(draft.blocks) : null;

  const launch = (preset: { workout: IntervalPreset['workout'] }) => {
    if (!activity) return;
    rememberIntervalWorkout(preset.workout);
    navigate(`/enregistrer?activite=${encodeURIComponent(activity.id)}`);
  };
  const saveDraft = () => {
    if (!draft || !draftWorkout) return;
    if (draft.id) updateIntervalPreset(draft.id, draft.name, draftWorkout);
    else saveIntervalPreset(draft.name, draftWorkout);
    setDraft(null);
    setAskClose(false);
  };
  const closeDraft = () => {
    setDraft(null);
    setAskClose(false);
  };
  // La croix ferme tout de suite s'il n'y a rien à perdre, sinon demande.
  const requestClose = () => {
    if (draft && snapshot(draft.name, draft.blocks) !== draft.initial) setAskClose(true);
    else closeDraft();
  };
  const askRemove = (preset: IntervalPreset) => {
    if (window.confirm(`Retirer la séance « ${preset.name} » ?`)) {
      removeIntervalPreset(preset.id);
      setOpenId(null);
    }
  };
  const full = presets.length >= MAX_INTERVAL_PRESETS;
  const accent = FAMILY_ACCENT.fractionne;

  return (
    <div className="ui-page train-page" style={{ '--help-accent': accent } as React.CSSProperties}>
      <PageHeader title="Fractionné" back={{ to: '/fractionne', label: 'Entraînement' }}
        subtitle="Le compteur d'intervalles : des séances faites de blocs, gardées pour être relancées toutes faites." />

      {intervalActivities.length === 0 && (
        <div className="ui-alert ui-alert--warning">
          Aucune activité de fractionné visible : ajoutez-en une, ou ré-affichez-la, dans <Link to="/parametres">Réglages</Link>.
        </div>
      )}

      {draft && (
        <Card heading={draft.id ? 'Modifier la séance' : 'Nouvelle séance'} className="train-editor">
          <button type="button" className="train-editor__close" aria-label="Fermer l'éditeur" onClick={requestClose}><IconClose size={18} /></button>
          <label className="train-editor__name">
            <span className="ui-eyebrow">Nom</span>
            <input value={draft.name} maxLength={40} placeholder={draftWorkout ? workoutLabel(draftWorkout) : ''} aria-label="Nom de la séance"
              className="ui-field" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <WorkoutBlocksEditor blocks={draft.blocks} onChange={(blocks) => setDraft({ ...draft, blocks })} />
          <div className="ivl-actions">
            <Button variant="primary" disabled={!draftWorkout} onClick={saveDraft}>{draft.id ? 'Enregistrer les changements' : 'Garder la séance'}</Button>
            <Button variant="ghost" onClick={closeDraft}>Annuler</Button>
          </div>
        </Card>
      )}

      {draft && askClose && (
        <Dialog title="Fermer l'éditeur ?" onClose={() => setAskClose(false)}>
          <p className="train-hint">La séance a des changements non enregistrés.</p>
          <div className="ivl-actions">
            <Button variant="primary" disabled={!draftWorkout} onClick={saveDraft}>Enregistrer</Button>
            <Button onClick={closeDraft}>Ne pas enregistrer</Button>
            <Button variant="ghost" onClick={() => setAskClose(false)}>Continuer</Button>
          </div>
        </Dialog>
      )}

      {!draft && (
        <div className="train-actions">
          <Button variant="primary" disabled={full} onClick={() => setDraft({ id: null, name: '', blocks: NEW_BLOCKS, initial: snapshot('', NEW_BLOCKS) })}>Nouvelle séance</Button>
          {full && <span className="train-hint">{MAX_INTERVAL_PRESETS} séances au plus : retirez-en une.</span>}
        </div>
      )}

      {presets.length > 0 ? (
        <ul className="train-list" aria-label="Séances gardées">
          {presets.map((preset) => (
            <li key={preset.id} className="ui-card train-item">
              <div className="train-item__head">
                <span className="train-item__name">{preset.name}</span>
                <Button variant="primary" size="s" disabled={!activity} onClick={() => launch(preset)}>
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
                    <Button size="s" onClick={() => setDraft({ id: preset.id, name: preset.name, blocks: workoutBlocks(preset.workout), initial: snapshot(preset.name, workoutBlocks(preset.workout)) })}>Modifier</Button>
                    <Button size="s" disabled={full} onClick={() => saveIntervalPreset(`${preset.name} (copie)`.slice(0, 40), preset.workout)}>Dupliquer</Button>
                    <Button size="s" variant="ghost" onClick={() => askRemove(preset)}>Retirer</Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Card><p className="train-hint">Aucune séance gardée : créez-en une, ou gardez celle que vous lancez au compteur d'Enregistrer.</p></Card>
      )}
    </div>
  );
}

export default TrainingSessionsPage;
