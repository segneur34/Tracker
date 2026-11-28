import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isRecordingActive } from '../hooks/useRecorder';
import {
  answerPhoneSyncQuestion, cancelPhoneSyncWait, declineFirstSync, leavePhoneSyncQuestion, phoneSyncStep, reopenPhoneSyncQuestion,
  startFirstSync, synchronizeWithPhone, usePhoneSync, type PhoneSyncAnswer, type PhoneSyncStep,
} from '../hooks/useSessionLibrary';
import { routeStore } from '../hooks/routeFiles';
import {
  SYNC_RUNNING_TITLE, SYNC_WINDOW_TITLE, computerScanText, describeFirstStart, describeNoPhone, describePhoneSync, describeQuestion,
  describeWait, safetyCopyProgressText, syncProgressText, syncStepText, syncSubtitle, type SyncQuestion, type SyncReport,
  type SyncReportRow, type SyncWait,
} from '../library/syncReport';
import { phoneCableAvailable } from '../platform/phoneCable';
import { IconChevronRight, IconRefresh } from './icons';
import Button from './ui/Button';
import Dialog from './ui/Dialog';
import './PhoneSyncButton.css';

/**
 * « Synchroniser avec le téléphone », dans Réglages › Mémoire du programme Windows (lot 242-2, fenêtre de Gtracker
 * validée par l'utilisateur le 22/11, décisions A2, B1 et C1) : met à jour l'ordinateur et le téléphone branché par
 * câble, en un clic. Une fenêtre suit la synchronisation : son titre dit l'étape, le sous-titre le téléphone et par où
 * il est lu ; une phrase et une barre pendant l'avancement ; la seule question possible (suppressions en nombre, ou
 * sessions de la corbeille encore sur le téléphone), à deux réponses qui la règlent pour de bon ; puis le compte rendu,
 * une ligne par geste qui se déplie en noms, les exceptions dans un encadré, et « Fermer », accompagné de
 * « Recommencer » quand quelque chose a mal tourné. Fermer la question ne décide rien : le compte rendu de ce qui est
 * fait le rappelle, avec « Répondre ». Fermée en route, la synchronisation continue, et une question attend : le bouton
 * rouvre la fenêtre où elle en est. Téléphone pas là ou pas prêt, liaison tombée, ordinateur occupé : la fenêtre
 * attend en disant quoi faire, repart seule, et « Annuler » arrête l'attente. Première synchronisation d'un téléphone :
 * un écran de départ, avec « Commencer » (le fermer arrête tout) ; le compte rendu dit où est la copie de sécurité.
 * Absent ailleurs (navigateur, téléphone, coquille plus ancienne).
 */

const run = () => void synchronizeWithPhone({ recording: isRecordingActive });

/** Titre et sous-titre de la fenêtre à cette étape, et le compte rendu quand elle en est à l'issue. */
const windowOf = (step: PhoneSyncStep): { title: string; subtitle: string | null; said: SyncReport | null } => {
  switch (step.step) {
    case 'idle':
    case 'searching':
      return { title: SYNC_WINDOW_TITLE, subtitle: null, said: null };
    case 'waiting': {
      const text = describeWait(step.wait);
      return { title: text.title, subtitle: text.subtitle, said: null };
    }
    case 'noPhone':
      return { title: describeNoPhone().title, subtitle: null, said: null };
    case 'firstStart':
      return { title: describeFirstStart(step.phone).title, subtitle: syncSubtitle(step.phone), said: null };
    case 'computerBusy':
    case 'comparing':
    case 'safetyCopy':
    case 'syncing':
      return { title: SYNC_RUNNING_TITLE, subtitle: syncSubtitle(step.phone), said: null };
    case 'question':
      return { title: describeQuestion(step.question).title, subtitle: syncSubtitle(step.result.phone), said: null };
    default: {
      const said = describePhoneSync(step.result, step.unanswered ?? null, step.answerFailed ?? null);
      const subtitle = step.result.kind === 'synced' ? syncSubtitle(step.result.phone) : null;
      return { title: said.title, subtitle, said };
    }
  }
};

function PhoneSyncButton() {
  const [available] = useState(phoneCableAvailable);
  const [open, setOpen] = useState(false);
  const step = usePhoneSync();
  const navigate = useNavigate();

  // La synchronisation a pu changer les itinéraires de l'ordinateur : leur liste est relue à son issue, question
  // comprise (les itinéraires sont faits avant qu'elle soit posée).
  const ended = step.step === 'over' || step.step === 'question';
  useEffect(() => {
    if (ended) routeStore.reload();
  }, [ended]);

  if (!available) return null;

  // Une question en attente se rouvre telle quelle ; une synchronisation en cours n'est pas doublée.
  const start = () => {
    setOpen(true);
    const now = phoneSyncStep().step;
    if (now === 'idle' || now === 'over') run();
  };
  const close = () => setOpen(false);
  // Annuler l'attente (ou fermer pendant l'attente) : la fenêtre se ferme, sauf si une passe partielle laisse un compte
  // rendu de ce qui est fait, qu'elle montre alors.
  const cancel = () => {
    void cancelPhoneSyncWait().then(() => {
      if (phoneSyncStep().step === 'idle') close();
    });
  };
  const pair = () => {
    cancel();
    navigate('/parametres');
  };
  const declineStart = () => {
    declineFirstSync();
    close();
  };
  const view = windowOf(step);
  // Fermer la question ne décide rien : la fenêtre passe au compte rendu de ce qui est fait, qui la rappelle. Fermer
  // l'écran de départ arrête la synchronisation, rien n'étant fait. Fermer pendant une attente vaut « Annuler » ;
  // pendant l'échange, la synchronisation continue.
  const onClose = step.step === 'question' ? leavePhoneSyncQuestion
    : step.step === 'firstStart' ? declineStart
      : step.step === 'waiting' || step.step === 'noPhone' ? cancel : close;

  return (
    <>
      <Button className="phone-sync" onClick={start}>
        <IconRefresh size={18} />
        Synchroniser avec le téléphone
      </Button>
      {open && (
        <Dialog title={view.title} onClose={onClose} className="phone-sync__dialog">
          {view.subtitle !== null && <p className="phone-sync__subtitle">{view.subtitle}</p>}
          {step.step === 'question' ? <QuestionView question={step.question} />
            : step.step === 'waiting' ? <WaitView wait={step.wait} onCancel={cancel} />
              : step.step === 'noPhone' ? <NoPhoneView onClose={cancel} onPair={pair} />
                : step.step === 'firstStart' ? <FirstStartView phone={step.phone} />
                  : view.said !== null ? <ReportView said={view.said} onClose={close} />
                    : <ProgressView step={step} />}
        </Dialog>
      )}
    </>
  );
}

const answer = (a: PhoneSyncAnswer) => () => void answerPhoneSyncQuestion(a);

/** Avancement : une phrase et une barre, sans nombres tant que le total n'est pas connu. */
function ProgressView({ step }: { step: PhoneSyncStep }) {
  const busy = step.step === 'computerBusy';
  const text = step.step === 'syncing' ? syncProgressText(step.done, step.total)
    : busy ? computerScanText(step.done, step.total)
      : step.step === 'safetyCopy' ? safetyCopyProgressText(0, 0)
        : syncStepText(step.step === 'comparing' ? 'comparing' : 'searching');
  const counted = (step.step === 'syncing' || busy) && step.total > 0;
  return (
    <div className="phone-sync__body" aria-live="polite">
      <p className="num">{text}</p>
      <progress className="phone-sync__bar" value={counted ? step.done : undefined} max={counted ? step.total : undefined} aria-label={text} />
      <p className="phone-sync__hint">
        {busy ? "L'échange avec le téléphone commence juste après." : 'Vous pouvez fermer cette fenêtre : la synchronisation continue.'}
      </p>
    </div>
  );
}

/** L'attente : quoi faire sur le téléphone, et « Annuler ». Elle repart seule. */
function WaitView({ wait, onCancel }: { wait: SyncWait; onCancel: () => void }) {
  const text = describeWait(wait);
  return (
    <>
      <div className="phone-sync__body" aria-live="polite">
        {text.lead !== null && <p>{text.lead}</p>}
        {text.folder !== null && <code className="phone-sync__folder">{text.folder}</code>}
        {text.steps.length > 0 && (
          <>
            <p>Sur le téléphone :</p>
            <ul className="phone-sync__steps">{text.steps.map((s) => <li key={s}>{s}</li>)}</ul>
          </>
        )}
        {text.closing !== null && <p><strong>{text.closing}</strong></p>}
        {text.notes.map((note) => <p key={note} className="phone-sync__hint">{note}</p>)}
        {wait.detail !== null && <Detail text={wait.detail} />}
      </div>
      <div className="phone-sync__actions">
        <Button variant="primary" onClick={onCancel}>Annuler</Button>
      </div>
    </>
  );
}

/** Aucun téléphone connu : cela se fait une fois, par un code (sans-fil, lot 250). */
function NoPhoneView({ onClose, onPair }: { onClose: () => void; onPair: () => void }) {
  return (
    <>
      <div className="phone-sync__body">
        <p>{describeNoPhone().text}</p>
      </div>
      <div className="phone-sync__actions">
        <Button variant="secondary" onClick={onClose}>Fermer</Button>
        <Button variant="primary" onClick={onPair}>Relier mon téléphone</Button>
      </div>
    </>
  );
}

/** Lignes qui se déplient en noms : le geste, ce qu'il a touché, puis la liste. */
function Rows({ rows, open = false }: { rows: SyncReportRow[]; open?: boolean }) {
  return (
    <div className="phone-sync__rows">
      {rows.map((row, i) => (
        <details key={`${row.label}-${i}`} className="phone-sync__row" open={open}>
          <summary>
            <strong className="phone-sync__row-label">{row.label}</strong>
            <span className="phone-sync__row-text num">{row.text}</span>
            <IconChevronRight size={14} className="phone-sync__row-mark" aria-hidden="true" />
          </summary>
          <ul className="phone-sync__names num">
            {row.names.map((name, j) => <li key={`${name}-${j}`}>{name}</li>)}
          </ul>
        </details>
      ))}
    </div>
  );
}

/** Une raison technique, repliée sous « Détail ». */
function Detail({ text }: { text: string }) {
  return (
    <details className="phone-sync__detail">
      <summary>Détail</summary>
      <p>{text}</p>
    </details>
  );
}

/** Écran de départ d'une première synchronisation : ce qui va se passer, la copie de sécurité, puis « Commencer ». */
function FirstStartView({ phone }: { phone: string }) {
  const text = describeFirstStart(phone);
  return (
    <>
      <div className="phone-sync__body">
        <p>{text.lead}</p>
        <p>{text.copy}</p>
      </div>
      <div className="phone-sync__actions">
        <Button variant="primary" onClick={startFirstSync}>Commencer</Button>
      </div>
    </>
  );
}

function ReportView({ said, onClose }: { said: SyncReport; onClose: () => void }) {
  const extra = said.action === 'restart' ? { label: 'Recommencer', onClick: run }
    : said.action === 'retry' ? { label: 'Réessayer', onClick: run }
      : said.action === 'answer' ? { label: 'Répondre', onClick: reopenPhoneSyncQuestion }
        : null;
  return (
    <>
      <div className="phone-sync__body" aria-live="polite">
        {said.paragraphs.map((text, i) => <p key={i}>{text}</p>)}
        {said.folder && <code className="phone-sync__folder">{said.folder}</code>}
        {said.detail && <Detail text={said.detail} />}
        {said.rows.length > 0 && <Rows rows={said.rows} />}
        {said.notes.map((note, i) => (
          <div key={i} className="phone-sync__note">
            <p>{note.text}</p>
            {note.detail && <Detail text={note.detail} />}
          </div>
        ))}
      </div>
      <div className="phone-sync__actions">
        {extra && <Button variant="primary" onClick={extra.onClick}>{extra.label}</Button>}
        <Button variant={extra ? 'secondary' : 'primary'} onClick={onClose}>Fermer</Button>
      </div>
    </>
  );
}

function QuestionView({ question }: { question: SyncQuestion }) {
  const text = describeQuestion(question);
  const guard = question.kind === 'guard';
  return (
    <>
      <div className="phone-sync__body">
        <p>{text.intro}</p>
        {text.rows.length > 0 && <Rows rows={text.rows} open />}
        {text.names.length > 0 && (
          <ul className="phone-sync__names phone-sync__names--list num">
            {text.names.map((name, i) => <li key={`${name}-${i}`}>{name}</li>)}
          </ul>
        )}
        {text.ask !== null && <p>{text.ask}</p>}
      </div>
      <div className="phone-sync__actions">
        <Button variant="secondary" onClick={answer(guard ? 'keepAll' : 'keepHeld')}>{text.keepLabel}</Button>
        <Button variant="danger" onClick={answer(guard ? 'deleteBoth' : 'removeHeld')}>{text.removeLabel}</Button>
      </div>
      <p className="phone-sync__hint">{text.hint}</p>
    </>
  );
}

export default PhoneSyncButton;
