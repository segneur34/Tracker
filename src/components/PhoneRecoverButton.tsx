import { useState } from 'react';
import {
  canImportSessions, dismissPhoneRecovery, recoverFromPhone, useLibraryFields, usePhoneRecovery, type PhoneRecoveryStep,
} from '../hooks/useSessionLibrary';
import { describePhoneRecovery } from '../library/phoneRecovery';
import { phoneCableAvailable } from '../platform/phoneCable';
import { IconDownload } from './icons';
import Button from './ui/Button';
import './PhoneRecoverButton.css';

/**
 * « Récupérer les sessions du téléphone », dans Réglages › Mémoire du programme Windows (élément 217, lot 2) : range
 * sur l'ordinateur les sessions du téléphone branché par câble qu'il n'a pas encore, sans rien écrire sur le téléphone.
 * Le bouton va dans la rangée de « Mettre à jour » ; la progression et l'issue (`PhoneRecoverProgress`) dessous, avec
 * « Réessayer » quand le téléphone n'était pas prêt. Absent ailleurs (navigateur, téléphone, coquille plus ancienne).
 */
function PhoneRecoverButton() {
  const [available] = useState(phoneCableAvailable);
  const library = useLibraryFields('status', 'memoryReadOnly', 'importing');
  const step = usePhoneRecovery();
  if (!available) return null;
  const running = step.step === 'searching' || step.step === 'reading';
  return (
    <Button
      className="phone-recover"
      disabled={running || library.importing || !canImportSessions(library)}
      onClick={() => void recoverFromPhone()}
    >
      <IconDownload size={18} />
      Récupérer les sessions du téléphone
    </Button>
  );
}

/** Progression puis issue de la récupération ; rien tant qu'elle n'a pas été lancée, ni après « Fermer ». */
export function PhoneRecoverProgress() {
  const [available] = useState(phoneCableAvailable);
  const step = usePhoneRecovery();
  if (!available || step.step === 'idle') return null;
  return (
    <div className="phone-recover__panel" aria-live="polite">
      <StepView step={step} />
    </div>
  );
}

/** « 1 fichier sur 50 », « 12 fichiers sur 50 ». */
const filesRead = (done: number, total: number): string => `${done} fichier${done > 1 ? 's' : ''} sur ${total}`;

function StepView({ step }: { step: Exclude<PhoneRecoveryStep, { step: 'idle' }> }) {
  if (step.step === 'searching') return <p className="phone-recover__text">Recherche du téléphone…</p>;
  if (step.step === 'reading') {
    return (
      <>
        <p className="phone-recover__text">Lecture du téléphone {step.phone}…</p>
        <p className="phone-recover__text phone-recover__count num">{filesRead(step.done, step.total)}</p>
      </>
    );
  }
  const said = describePhoneRecovery(step.outcome);
  return (
    <>
      {said.paragraphs.map((text, i) => <p key={i} className="phone-recover__text">{text}</p>)}
      {said.folder && <code className="phone-recover__folder">{said.folder}</code>}
      <div className="phone-recover__actions">
        {said.retry && <Button variant="primary" size="s" onClick={() => void recoverFromPhone()}>Réessayer</Button>}
        <Button size="s" onClick={dismissPhoneRecovery}>Fermer</Button>
      </div>
    </>
  );
}

export default PhoneRecoverButton;
