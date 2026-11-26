import { useState } from 'react';
import {
  canImportSessions, cancelPhoneSync, confirmPhoneSync, dismissPhoneSync, startPhoneSync, useLibraryFields, usePhoneSync, type PhoneSyncStep,
} from '../hooks/useSessionLibrary';
import type { SyncConfirmation } from '../library/syncReport';
import { phoneCableAvailable } from '../platform/phoneCable';
import { IconRefresh } from './icons';
import Button from './ui/Button';
import './PhoneSyncButton.css';

/**
 * « Synchroniser avec le téléphone », dans Réglages › Mémoire du programme Windows (élément 217) : met l'ordinateur
 * et le téléphone branché par câble à jour l'un de l'autre. Le bouton va dans la rangée de « Mettre à jour » ; les
 * étapes, la confirmation chiffrée et le compte rendu (`PhoneSyncPanel`) dessous. Rien n'est écrit avant la
 * confirmation ; « Synchroniser sans rien supprimer » est le choix principal. Absent ailleurs (navigateur, téléphone,
 * coquille plus ancienne).
 */
function PhoneSyncButton() {
  const [available] = useState(phoneCableAvailable);
  const library = useLibraryFields('status', 'memoryReadOnly', 'importing');
  const step = usePhoneSync();
  if (!available) return null;
  const busy = step.step !== 'idle' && step.step !== 'over';
  return (
    <Button className="phone-sync" disabled={busy || library.importing || !canImportSessions(library)} onClick={() => void startPhoneSync()}>
      <IconRefresh size={18} />
      Synchroniser avec le téléphone
    </Button>
  );
}

/** Étapes, confirmation puis compte rendu de la synchronisation ; rien tant qu'elle n'a pas été lancée, ni après « Fermer ». */
export function PhoneSyncPanel() {
  const [available] = useState(phoneCableAvailable);
  const step = usePhoneSync();
  if (!available || step.step === 'idle') return null;
  return (
    <div className="phone-sync__panel" aria-live="polite">
      <StepView step={step} />
    </div>
  );
}

/** « 1 fichier sur 50 », « 12 fichiers sur 50 ». */
const filesDone = (done: number, total: number): string => `${done} fichier${done > 1 ? 's' : ''} sur ${total}`;

/** Ce qui serait retiré, nommé : « Sur le téléphone : … », « Sur l'ordinateur : … ». */
function Removals({ confirmation }: { confirmation: SyncConfirmation }) {
  const { sessions, routes } = confirmation.removals;
  const from = (side: 'phone' | 'computer') => [...sessions.filter((s) => s.side === side), ...routes.filter((r) => r.side === side)].map((x) => x.label);
  const groups = [
    { label: "Supprimé sur l'ordinateur, à retirer du téléphone (mis de côté dans son dossier Documents/Tracker-corbeille)", names: from('phone') },
    { label: "Supprimé sur le téléphone, à mettre dans la corbeille de l'ordinateur (30 jours)", names: from('computer') },
  ].filter((g) => g.names.length > 0);
  if (groups.length === 0) return null;
  return (
    <details className="phone-sync__details">
      <summary className="phone-sync__text">Voir ce qui serait retiré</summary>
      {groups.map((g) => (
        <div key={g.label}>
          <p className="phone-sync__text phone-sync__muted">{g.label} :</p>
          <ul className="phone-sync__list">{g.names.map((name, i) => <li key={i}>{name}</li>)}</ul>
        </div>
      ))}
    </details>
  );
}

function StepView({ step }: { step: Exclude<PhoneSyncStep, { step: 'idle' }> }) {
  switch (step.step) {
    case 'searching':
      return <p className="phone-sync__text">Recherche du téléphone…</p>;
    case 'comparing':
      return <p className="phone-sync__text">Comparaison de l'ordinateur et du téléphone {step.phone}…</p>;
    case 'safetyCopy':
      return <p className="phone-sync__text">Copie de sécurité des deux dossiers, avant toute écriture…</p>;
    case 'syncing':
      return (
        <>
          <p className="phone-sync__text">Synchronisation avec le téléphone {step.phone}…</p>
          {step.total > 0 && <p className="phone-sync__text phone-sync__muted num">{filesDone(step.done, step.total)}</p>}
        </>
      );
    case 'confirm': {
      const { confirmation } = step;
      const toRemove = confirmation.numbers.toRemove;
      return (
        <>
          <p className="phone-sync__text phone-sync__headline">{confirmation.counts ?? (step.interrupted ? 'Rien à copier : la synchronisation précédente, coupée en route, sera terminée.' : "Rien à copier : seules les fiches des deux appareils seront remises d'accord.")}</p>
          {step.first && <p className="phone-sync__text">Une copie de sécurité des deux dossiers sera faite d'abord, dans Documents\Tracker-copies.</p>}
          {confirmation.notes.map((note, i) => <p key={i} className="phone-sync__text phone-sync__muted">{note}</p>)}
          <Removals confirmation={confirmation} />
          <div className="phone-sync__actions">
            <Button variant="primary" size="s" onClick={() => void confirmPhoneSync(false)}>Synchroniser sans rien supprimer</Button>
            {toRemove > 0 && (
              <Button variant="danger" size="s" onClick={() => void confirmPhoneSync(true)}>
                Synchroniser et retirer {toRemove === 1 ? "l'élément" : `les ${toRemove} éléments`}
              </Button>
            )}
            <Button size="s" onClick={cancelPhoneSync}>Annuler</Button>
          </div>
        </>
      );
    }
    case 'over': {
      const { report, folder } = step;
      return (
        <>
          <p className="phone-sync__text phone-sync__headline">{report.title}</p>
          {report.paragraphs.map((text, i) => <p key={`p${i}`} className="phone-sync__text">{text}</p>)}
          {folder && <code className="phone-sync__folder">{folder}</code>}
          {report.rows.length > 0 && (
            <ul className="phone-sync__list">
              {report.rows.map((row, i) => (
                <li key={`r${i}`}>
                  <strong>{row.label}</strong> : {row.text}
                  {row.names.length > 0 && (
                    <details className="phone-sync__details">
                      <summary className="phone-sync__muted">Lesquels</summary>
                      <ul className="phone-sync__list">{row.names.map((name, k) => <li key={k}>{name}</li>)}</ul>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
          {report.notes.map((text, i) => <p key={`n${i}`} className="phone-sync__text phone-sync__muted">{text}</p>)}
          <div className="phone-sync__actions">
            {report.retry && <Button variant="primary" size="s" onClick={() => void startPhoneSync()}>Réessayer</Button>}
            <Button size="s" onClick={dismissPhoneSync}>Fermer</Button>
          </div>
        </>
      );
    }
  }
}

export default PhoneSyncButton;
