import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SAILING_SPORTS } from '../core/sportProfiles';
import type { SportType } from '../core/types';

/**
 * Passage d'une session d'une page à un module d'analyse : la page
 * d'enregistrement ouvre la session terminée dans le module voile ou course,
 * qui la charge par `loadGpxContent` comme un fichier choisi à la main.
 *
 * La session voyage dans l'état de navigation, puis en est retirée une fois
 * chargée : un retour arrière ou un rechargement ne la recharge pas.
 */

export interface IncomingSession {
  content: string;
  fileName: string;
  sport: SportType;
}

const STATE_KEY = 'incomingSession';

/** Module d'analyse d'un support. */
export const analysisPath = (sport: SportType): string => (SAILING_SPORTS.includes(sport) ? '/voile' : '/course');

/** Ouvre une session dans le module qui l'analyse. */
export const useOpenSession = () => {
  const navigate = useNavigate();
  return useCallback(
    (session: IncomingSession) => navigate(analysisPath(session.sport), { state: { [STATE_KEY]: session } }),
    [navigate]
  );
};

/**
 * Côté module : appelle `onReceive` avec la session transmise, une seule fois.
 *
 * La session reste dans l'état de navigation tant que son effacement n'est
 * pas appliqué, et `onReceive` change d'identité dès qu'il écrit un réglage
 * (`setSport`). Sans garde, l'effet se relançait à chaque rendu, rechargeait
 * la trace, et les graphes Recharts ouverts emballaient la boucle jusqu'à
 * « Maximum update depth exceeded » : page blanche (§10, point 39). D'où la
 * session déjà traitée, retenue par identité, et le dernier `onReceive` rangé
 * à part pour que l'effet ne dépende que de la session reçue.
 */
export const useIncomingSession = (onReceive: (session: IncomingSession) => void): void => {
  const location = useLocation();
  const navigate = useNavigate();
  const incoming = (location.state as Record<string, IncomingSession | undefined> | null)?.[STATE_KEY];

  const handled = useRef<IncomingSession | null>(null);
  const receive = useRef(onReceive);
  useEffect(() => {
    receive.current = onReceive;
  }, [onReceive]);

  useEffect(() => {
    if (!incoming || handled.current === incoming) return;
    handled.current = incoming;
    receive.current(incoming);
    navigate(location.pathname, { replace: true, state: null });
  }, [incoming, navigate, location.pathname]);
};
