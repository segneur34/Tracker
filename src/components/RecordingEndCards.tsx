import { useEffect, useRef, useState } from 'react';
import { FAMILY_ACCENT, activitiesOfFamily, intervalActivityFor, type Activity } from '../core/activities';
import { hasPositions, sportFamily } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import { useOpenSession } from '../hooks/useLibraryNavigation';
import {
  continuePendingSession, discardFailedSession, dismissRecorderResult, savePendingSession, type PendingSession, type SavedSession,
} from '../hooks/useRecorder';
import { librarySession, updateSessionRecord } from '../hooks/useSessionLibrary';
import { useGearGroups } from '../hooks/useSportSettings';
import { DISCARD_HOLD_MS } from '../library/discardOutcome';
import { EMPTY_NOTES, type GearChoice } from '../library/notes';
import { canDownloadFiles, downloadTextFile } from '../platform/files';
import { deviceLocationSource } from '../platform/location';
import SavedSessionShare from './SavedSessionShare';
import SessionEndGear from './SessionEndGear';
import { IconTrash } from './icons';
import Button from './ui/Button';
import Card from './ui/Card';
import Dialog from './ui/Dialog';
import HoldButton from './ui/HoldButton';
import SegmentedControl from './ui/SegmentedControl';

/**
 * Cartes de fin d'enregistrement de la page Enregistrer (lot 212). La session est rangée dès « Finir » : la carte
 * « Session terminée » (`SavedSessionCard`) en donne le matériel, la question du fractionné et « Ouvrir l'analyse », et
 * s'efface d'elle-même au profit de l'analyse quand il n'y a rien à demander. Une session hors de la mémoire
 * (`PendingSessionCard`) n'a que deux raisons d'être : son rangement a échoué (« Réessayer », ou « Jeter la session »,
 * seul « Jeter » de l'écran de fin), ou c'est une session interrompue qu'on peut encore continuer (« Continuer
 * l'enregistrement » ou « Finir »).
 */

/** Ce que la session terminée a gardé : ses points, ou sans position les mesures de la ceinture, ou sa durée seule (lot 210). */
const keptText = (sport: SportType | null, pointCount: number): string =>
  sport === null || hasPositions(sport) ? `${pointCount} points` : pointCount > 0 ? `${pointCount} mesures de la ceinture` : 'durée seule';

/** Ce qui est dit quand le matériel choisi à la fin n'a pas pu entrer dans la fiche de la session rangée. */
const GEAR_NOT_WRITTEN = "Le matériel choisi n'a pas pu être écrit dans la fiche : choisissez-le de nouveau dans l'onglet « matériel et notes » de l'analyse.";

/** Capture des capteurs illisible au rangement : la session est rangée sans elle, le fichier reste (lot 212). */
const MOTION_LEFT_TEXT = "Les mesures des capteurs n'ont pas pu être lues : la session est rangée sans elles, et leur fichier reste sur l'appareil.";

/**
 * Écrit le matériel choisi à la fin dans la fiche de la session rangée, sans toucher au reste de ses notes. Rend faux
 * s'il n'y est pas entré (fiche en lecture seule, session sortie de la mémoire).
 */
const writeEndGear = (file: string, gear: GearChoice[] | null): boolean => {
  const notes = librarySession(file)?.record.notes ?? null;
  updateSessionRecord(file, { notes: { ...EMPTY_NOTES, ...notes, gear, savedAt: Date.now() } });
  return librarySession(file)?.record.notes?.gear === gear;
};

const getDiscardHoldMs = () => DISCARD_HOLD_MS;

/**
 * « Jeter la session » de la carte « Rangement impossible » (lot 212) : une écriture qui échoue toujours bloquerait
 * sinon tout nouvel enregistrement. Appui long d'une seconde (`HoldButton`, comme dans l'analyse), puis une
 * confirmation ; journal et capture effacés, la page revient au repos (`discardFailedSession`).
 */
function FailedSessionDiscard({ disabled }: { disabled: boolean }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const discard = async () => {
    setBusy(true);
    // Échec : l'alerte de la page le dit, la session reste.
    await discardFailedSession();
    setBusy(false);
    setAsking(false);
  };
  return (
    <>
      <HoldButton onHold={() => setAsking(true)} getHoldMs={getDiscardHoldMs} label="Jeter la session" hintAction="jeter" disabled={disabled}
        lead={<IconTrash size={18} />} dialTitle="Jeter la session" color="var(--danger)" icon={<IconTrash size={48} />} />
      {asking && (
        <Dialog title="Jeter cette session ?" onClose={() => { if (!busy) setAsking(false); }}>
          <p className="ui-hint">Son journal et ses mesures de capteurs seront effacés de l'appareil, sans retour possible.</p>
          <div className="ui-dialog__actions">
            <Button variant="danger" disabled={busy} onClick={() => void discard()}>Jeter définitivement</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setAsking(false)}>Garder</Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

/** Titre et menu « … » communs aux deux cartes. */
function EndHeading({ title, content, activity, fileName, libraryFile }: {
  title: string; content: string; activity: Activity | null; fileName: string; libraryFile: string | null;
}) {
  return (
    <span className="ui-flex-between">
      {title}
      {activity && <SavedSessionShare gpx={content} activity={activity} fileName={fileName} libraryFile={libraryFile} />}
    </span>
  );
}

/**
 * Session hors de la mémoire : rangement en cours (dès l'arrêt), en échec (« Réessayer », « Télécharger le GPX »,
 * journal gardé), ou session interrompue fraîche (« Continuer l'enregistrement », « Finir », même chemin que l'arrêt).
 */
export function PendingSessionCard({ pending, analyzing, rangeFailed }: { pending: PendingSession; analyzing: boolean; rangeFailed: boolean }) {
  const title = rangeFailed ? 'Rangement impossible' : pending.recovered ? 'Session interrompue récupérée' : 'Session terminée';
  const what = `${pending.activity?.name ?? 'À classer'}, ${keptText(pending.sport, pending.pointCount)}.`;
  const explanation = rangeFailed
    ? "Elle n'a pas pu être rangée dans la mémoire. Rien n'est perdu, son journal reste sur l'appareil ; aucun nouvel enregistrement avant qu'elle soit rangée ou jetée."
    : pending.canContinue
      ? "Coupée il y a peu : « Continuer l'enregistrement » la reprend, « Finir » la range dans la mémoire."
      : 'Rangement dans la mémoire…';
  return (
    <Card heading={<EndHeading title={title} content={pending.content} activity={pending.activity} fileName={pending.fileName} libraryFile={null} />}>
      <p className="rec-saved-text">
        {what}<br />
        <span className="ui-muted ui-text-s">{explanation}</span>
      </p>
      {(rangeFailed || pending.canContinue) && (
        <div className="ui-row-10 ui-wrap">
          {pending.canContinue && !rangeFailed && (
            <Button variant="primary" onClick={() => void continuePendingSession(deviceLocationSource())} disabled={analyzing}>
              Continuer l'enregistrement
            </Button>
          )}
          <Button variant={rangeFailed ? 'primary' : 'secondary'} onClick={() => void savePendingSession()} disabled={analyzing}>
            {analyzing ? 'Rangement…' : rangeFailed ? 'Réessayer' : 'Finir'}
          </Button>
          {pending.canContinue && rangeFailed && (
            <Button onClick={() => void continuePendingSession(deviceLocationSource())} disabled={analyzing}>
              Continuer l'enregistrement
            </Button>
          )}
          {rangeFailed && canDownloadFiles() && (
            <Button onClick={() => downloadTextFile(pending.fileName, pending.content)}>
              Télécharger le GPX
            </Button>
          )}
          {rangeFailed && <FailedSessionDiscard disabled={analyzing} />}
        </div>
      )}
    </Card>
  );
}

/** Rangement de la session dans sa famille, ou en Fractionné (question du compteur d'intervalles). */
type IntervalChoice = 'reste' | 'fractionne';

/**
 * « Session terminée » : la session est rangée. Matériel (`SessionEndGear`) et question du fractionné, si la session
 * a servi le compteur d'intervalles, sont écrits dans sa fiche dès qu'ils changent ; « Ouvrir l'analyse » l'ouvre.
 * Rien à demander ni à dire, et la page a vu l'arrêt (`arrivedHere`) : l'analyse s'ouvre aussitôt. Une session rangée
 * d'office au lancement (`rangedBy: 'recovery'`) ne s'ouvre jamais d'elle-même. Sans fichier dans la mémoire (pas de
 * dossier, aucune mémoire), seulement « Télécharger le GPX ».
 */
export function SavedSessionCard({ saved, arrivedHere, activities, native }: {
  saved: SavedSession;
  /** La page était ouverte quand la session a été rangée (pas rouverte sur une carte déjà là). */
  arrivedHere: boolean;
  /** Activités de l'utilisateur, visibles seulement : l'activité de Fractionné proposée en est une. */
  activities: Activity[];
  native: boolean;
}) {
  const openSession = useOpenSession();
  const file = saved.libraryFile;
  const { activity } = saved;
  // Matériel choisi, vide d'office (lot 143, 131) ; la carte est rendue pour une seule session (`key`).
  const [gear, setGear] = useState<GearChoice[] | null>(null);
  const [gearNotWritten, setGearNotWritten] = useState(false);
  const gearGroups = useGearGroups(file ? activity : null);
  const asksGear = gearGroups !== null && gearGroups.length > 0;
  // Sortie à pied ou à vélo faite avec le compteur : seule la famille Fractionné a l'onglet « fractionné » (19/10).
  const intervalActivity = file && activity && saved.intervals.length > 0
    ? intervalActivityFor(activity, activitiesOfFamily(activities, 'fractionne'))
    : null;
  const [intervalChoice, setIntervalChoice] = useState<IntervalChoice>('reste');

  const chooseGear = (next: GearChoice[] | null) => {
    setGear(next);
    if (file) setGearNotWritten(!writeEndGear(file, next));
  };
  const chooseInterval = (next: IntervalChoice) => {
    setIntervalChoice(next);
    if (!file || !activity || !intervalActivity) return;
    const target = next === 'fractionne' ? intervalActivity : activity;
    const listed = activities.some((a) => a.id === target.id);
    updateSessionRecord(file, { sport: target.base, activityId: listed ? target.id : null });
  };
  const open = () => {
    if (!file || saved.sport === null) return;
    const fallback = intervalChoice === 'fractionne' && intervalActivity ? 'fractionne' : sportFamily(saved.sport);
    dismissRecorderResult();
    openSession(file, fallback);
  };

  // Rien à demander ni à dire : l'analyse tout de suite, une fois (le double passage du mode strict compris).
  const opened = useRef(false);
  const direct = arrivedHere && saved.rangedBy === 'finish' && file !== null && saved.sport !== null
    && !asksGear && intervalActivity === null && saved.motionLeft === null && saved.warning === null;
  useEffect(() => {
    if (!direct || opened.current || file === null || saved.sport === null) return;
    opened.current = true;
    dismissRecorderResult();
    openSession(file, sportFamily(saved.sport));
  }, [direct, file, saved.sport, openSession]);

  const title = saved.rangedBy === 'recovery' ? 'Session interrompue récupérée et rangée' : 'Session terminée';
  return (
    <Card heading={<EndHeading title={title} content={saved.content} activity={activity} fileName={saved.fileName} libraryFile={file} />}>
      <p className="rec-saved-text">
        {activity?.name ?? 'À classer'}, {keptText(saved.sport, saved.pointCount)}.<br />
        <span className="ui-muted ui-text-s rec-break-all">Rangée dans : {saved.location}</span>
        {saved.motionLeft && (
          <>
            <br />
            <span className="ui-text-s">{MOTION_LEFT_TEXT}</span>
          </>
        )}
        {gearNotWritten && (
          <>
            <br />
            <span className="ui-text-s">{GEAR_NOT_WRITTEN}</span>
          </>
        )}
        {!file && native && (
          <>
            <br />
            <span className="ui-muted ui-text-s">
              Pour l'analyser, choisissez le dossier mémoire (Réglages › Mémoire) : elle y sera rangée.
            </span>
          </>
        )}
      </p>
      {intervalActivity && activity && (
        <div className="rec-end-choice" data-testid="rec-end-intervals">
          <strong className="ui-subtitle">Compteur d'intervalles utilisé : ranger la session en</strong>
          <SegmentedControl label="Ranger la session en" value={intervalChoice} accent={FAMILY_ACCENT.fractionne} onChange={chooseInterval}
            items={[{ key: 'reste', label: activity.name }, { key: 'fractionne', label: intervalActivity.name }]} />
          <span className="ui-muted ui-text-s">
            En « {intervalActivity.name} », elle a l'onglet fractionné ; en « {activity.name} », elle ne l'a pas.
          </span>
        </div>
      )}
      {file && <SessionEndGear activity={activity} gear={gear} onChange={chooseGear} />}
      <div className="ui-row-10 ui-wrap">
        {file && saved.sport !== null && (
          <Button variant="primary" onClick={open}>
            Ouvrir l'analyse
          </Button>
        )}
        {!file && canDownloadFiles() && (
          <Button onClick={() => downloadTextFile(saved.fileName, saved.content)}>
            Télécharger le GPX
          </Button>
        )}
        <Button variant="ghost" onClick={dismissRecorderResult}>
          Fermer
        </Button>
      </div>
    </Card>
  );
}
