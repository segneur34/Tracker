import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Activity } from '../core/activities';
import { sportFamily, type SportFamily } from '../core/sportProfiles';
import { confirmLeave } from '../hooks/leaveGuard';
import { useOpenSession } from '../hooks/useLibraryNavigation';
import { dismissIncomingNotice, librarySession, updateSessionRecord, useLibraryFields } from '../hooks/useSessionLibrary';
import { useVisibility } from '../hooks/useSportSettings';
import { ActivitySheet } from './ActivitySelect';
import { IconClose } from './icons';
import Button from './ui/Button';

/**
 * Résultat d'un fichier reçu d'une autre application (« Ouvrir avec Tracker », `hooks/sessionLibrary/incoming.ts`), dans le
 * cadre de toutes les pages : la carte de la mémoire n'est pas montée partout. Pas de navigation automatique, un brouillon
 * peut être ouvert : « Voir la session » y passe par `confirmLeave`, comme tout départ. Une session à classer demande son
 * activité avant l'analyse, comme dans une bibliothèque. Un itinéraire reçu (lot 194) s'ouvre de même dans la planification.
 */

/** Module d'une session à classer en lecture seule, qui ne peut pas garder d'activité : aucun n'est plus juste qu'un autre. */
const UNCLASSIFIED_FAMILY: SportFamily = 'course';

function NoticeRow({ id, text, file, route, trouble }: { id: string; text: string; file: string | null; route?: string; trouble: boolean }) {
  const openSession = useOpenSession();
  const navigate = useNavigate();
  const { activities } = useVisibility();
  const [asking, setAsking] = useState(false);

  const see = () => {
    if (file === null) return;
    const session = librarySession(file);
    if (session?.record.sport === null && !session.readOnly) {
      setAsking(true);
      return;
    }
    if (!confirmLeave()) return;
    dismissIncomingNotice(id);
    openSession(file, UNCLASSIFIED_FAMILY);
  };

  const seeRoute = () => {
    if (route === undefined || !confirmLeave()) return;
    dismissIncomingNotice(id);
    navigate(`/itineraires?itineraire=${encodeURIComponent(route)}`);
  };

  const classifyAndOpen = (chosen: Activity) => {
    setAsking(false);
    if (file === null || !confirmLeave()) return;
    updateSessionRecord(file, { sport: chosen.base, activityId: chosen.id });
    dismissIncomingNotice(id);
    openSession(file, sportFamily(chosen.base));
  };

  return (
    <div className={`shell-notice${trouble ? ' shell-notice--trouble' : ''}`} role="status">
      <span className="shell-notice__text">{text}</span>
      <span className="shell-notice__actions">
        {file !== null && <Button size="s" variant="primary" onClick={see}>Voir la session</Button>}
        {route !== undefined && <Button size="s" variant="primary" onClick={seeRoute}>Voir l'itinéraire</Button>}
        <Button size="s" variant="ghost" aria-label="Fermer" title="Fermer" onClick={() => dismissIncomingNotice(id)}>
          <IconClose size={16} />
        </Button>
      </span>
      {asking && (
        <ActivitySheet
          activities={activities}
          value={null}
          heading={{ title: 'Quelle activité ?', hint: "Le fichier ne la dit pas : choisissez-la avant l'analyse. Elle reste dans la fiche de la session." }}
          onChoose={classifyAndOpen}
          onClose={() => setAsking(false)} />
      )}
    </div>
  );
}

function IncomingFileNotice() {
  const { incomingNotices } = useLibraryFields('incomingNotices');
  return <>{incomingNotices.map((notice) => <NoticeRow key={notice.id} {...notice} />)}</>;
}

export default IncomingFileNotice;
