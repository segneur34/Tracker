import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Dialog from '../components/ui/Dialog';
import PageHeader from '../components/ui/PageHeader';
import WorkoutBlocksEditor from '../components/WorkoutBlocksEditor';
import { IconClose } from '../components/icons';
import { FAMILY_ACCENT } from '../core/activities';
import { saveIntervalPreset, updateIntervalPreset, useIntervalSettings } from '../hooks/useSportSettings';
import {
  MAX_INTERVAL_PRESETS, workoutBlocks, workoutFromBlocks, workoutLabel,
  type IntervalBlock,
} from '../recording/intervalTimer';
import './TrainingPages.css';

/**
 * Seconde page des séances du Fractionné (25/10) : le détail d'une séance,
 * nouvelle (sans `?id=`) ou gardée (`?id=`), bloc par bloc. « Enregistrer »
 * garde et ramène à la liste ; la croix et le retour d'Android y renvoient
 * aussi, la croix demandant d'abord s'il y a des changements à perdre.
 */

const LIST = '/fractionne/seances';

const snapshot = (name: string, blocks: IntervalBlock[]) => JSON.stringify([name, blocks]);

const NEW_BLOCKS: IntervalBlock[] = [
  { kind: 'libre', label: 'Échauffement', durationS: 600 },
  { kind: 'series', reps: 3, workS: 180, restS: 60 },
  { kind: 'libre', label: 'Retour au calme', durationS: 600 },
];

interface EditorProps {
  id: string | null;
  initialName: string;
  initialBlocks: IntervalBlock[];
}

function Editor({ id, initialName, initialBlocks }: EditorProps) {
  const navigate = useNavigate();
  const [name, setName] = useState(initialName);
  const [blocks, setBlocks] = useState(initialBlocks);
  const [initial] = useState(() => snapshot(initialName, initialBlocks));
  const [askClose, setAskClose] = useState(false);
  const workout = workoutFromBlocks(blocks);
  const accent = FAMILY_ACCENT.fractionne;

  const leave = () => navigate(LIST, { replace: true });
  const save = () => {
    if (!workout) return;
    if (id) updateIntervalPreset(id, name, workout);
    else saveIntervalPreset(name, workout);
    leave();
  };
  // La croix ferme tout de suite s'il n'y a rien à perdre, sinon demande.
  const requestClose = () => {
    if (snapshot(name, blocks) !== initial) setAskClose(true);
    else leave();
  };

  return (
    <div className="ui-page train-page" style={{ '--help-accent': accent } as React.CSSProperties}>
      <PageHeader title={id ? 'Modifier le compteur' : 'Nouveau compteur'} back={{ to: LIST, label: 'Séances' }} />
      <Card className="train-editor">
        <button type="button" className="train-editor__close" aria-label="Fermer l'éditeur" onClick={requestClose}><IconClose size={18} /></button>
        <label className="train-editor__name">
          <span className="ui-eyebrow">Nom</span>
          <input value={name} maxLength={40} placeholder={workout ? workoutLabel(workout) : ''} aria-label="Nom de la séance"
            className="ui-field" onChange={(e) => setName(e.target.value)} />
        </label>
        <WorkoutBlocksEditor blocks={blocks} onChange={setBlocks} />
        <div className="ivl-actions">
          <Button variant="primary" disabled={!workout} onClick={save}>Enregistrer</Button>
          <Button variant="ghost" onClick={leave}>Annuler</Button>
        </div>
      </Card>

      {askClose && (
        <Dialog title="Fermer l'éditeur ?" onClose={() => setAskClose(false)}>
          <p className="train-hint">La séance a des changements non enregistrés.</p>
          <div className="ivl-actions">
            <Button variant="primary" disabled={!workout} onClick={save}>Enregistrer</Button>
            <Button onClick={leave}>Ne pas enregistrer</Button>
            <Button variant="ghost" onClick={() => setAskClose(false)}>Continuer</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function TrainingSessionEditPage() {
  const { presets } = useIntervalSettings();
  const [params] = useSearchParams();
  const id = params.get('id');
  const preset = id ? presets.find((p) => p.id === id) : null;
  // Séance inconnue, ou liste pleine à la création : retour à la liste.
  if (id && !preset) return <Navigate to={LIST} replace />;
  if (!id && presets.length >= MAX_INTERVAL_PRESETS) return <Navigate to={LIST} replace />;
  return preset
    ? <Editor key={preset.id} id={preset.id} initialName={preset.name} initialBlocks={workoutBlocks(preset.workout)} />
    : <Editor key="new" id={null} initialName="" initialBlocks={NEW_BLOCKS} />;
}

export default TrainingSessionEditPage;
