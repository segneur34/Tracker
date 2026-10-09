import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Activity } from '../core/activities';
import { sportFamily, type SportFamily } from '../core/sportProfiles';
import type { LibrarySession } from '../library/record';
import { confirmLeave } from './leaveGuard';
import { librarySession, loadFullSession, loadSessionGpx, updateSessionRecord, useLibrarySelector, useLibrarySession } from './useSessionLibrary';
import { readStoredActivities } from './useSportSettings';

/**
 * Passage de la bibliothèque aux modules d'analyse.
 *
 * La session à analyser est dans l'URL (`/voile/analyse?session=<fichier>`) :
 * un rechargement la rouvre, et le retour arrière ramène à la liste.
 */

/** Bibliothèque d'une famille, filtrée sur une activité si `activityId` est donné. */
export const libraryPath = (family: SportFamily, activityId?: string): string =>
  `/${family}${activityId ? `?activite=${encodeURIComponent(activityId)}` : ''}`;

/** Module d'analyse d'une famille, ouvert sur une session de la mémoire si `file` est donné. */
export const analysisPath = (family: SportFamily, file?: string | null): string =>
  `/${family}/analyse${file ? `?session=${encodeURIComponent(file)}` : ''}`;

/** Famille d'une session : celle de son support, sinon `fallback` pour une session à classer. */
export const sessionFamily = (session: LibrarySession | undefined, fallback: SportFamily): SportFamily =>
  session?.record.sport ? sportFamily(session.record.sport) : fallback;

/** Ouvre une session de la mémoire dans le module qui l'analyse. */
export const useOpenSession = () => {
  const navigate = useNavigate();
  return useCallback(
    (file: string, fallback: SportFamily) => navigate(analysisPath(sessionFamily(librarySession(file), fallback), file)),
    [navigate]
  );
};

/**
 * Changement d'activité depuis un module d'analyse. Dans la famille du module,
 * l'activité du module suit (`setActivity`) et la fiche de la session est
 * réécrite, comme avant. Vers l'autre famille, la session change de module :
 * on quitte la page (le brouillon est abandonné, après confirmation,
 * `confirmLeave`), la fiche prend le nouveau support, et le module de l'autre
 * famille l'ouvre, résumé recalculé en arrière-plan. Sans fiche (`file` nul,
 * GPX lu hors de la mémoire), rien ne change de famille.
 *
 * L'activité de base d'un calcul n'est pas une activité de la liste : la fiche
 * n'en garde que le calcul.
 */
export const useChangeSessionActivity = (family: SportFamily, setActivity: (id: string) => void) => {
  const navigate = useNavigate();
  return useCallback(
    (file: string | null, next: Activity) => {
      const listed = readStoredActivities().some((a) => a.id === next.id);
      const patch = { sport: next.base, activityId: listed ? next.id : null };
      const nextFamily = sportFamily(next.base);
      if (nextFamily === family) {
        setActivity(next.id);
        if (file) updateSessionRecord(file, patch);
        return;
      }
      if (!file || !confirmLeave()) return;
      updateSessionRecord(file, patch);
      navigate(analysisPath(nextFamily, file), { replace: true });
    },
    [family, setActivity, navigate]
  );
};

/**
 * Côté module : charge la session désignée par l'URL, une seule fois par
 * fichier, dès que la bibliothèque la connaît. Sa fiche est relue en entier
 * avant le GPX (`loadSessionGpx`) : altitude, voies et sauts rangés sont là
 * dès que la trace existe.
 *
 * Le chargement ne dépend que du nom du fichier. `onLoad` change d'identité à
 * chaque changement de réglage (`setSport`), et la fiche à chaque écriture
 * (notes, nombre de manœuvres) : s'ils relançaient l'effet, la trace serait
 * rechargée en boucle, comme au §10, point 39. D'où les références à part.
 */
export const useSessionFromUrl = (onLoad: (content: string, session: LibrarySession) => void) => {
  const [params] = useSearchParams();
  const requested = params.get('session');
  const session = useLibrarySession(requested);
  /** Bibliothèque ouverte et balayée : une session encore inconnue n'y est pas. */
  const settled = useLibrarySelector((s) => s.status === 'ready' && s.scanning === null);
  const known = session !== undefined;

  const latest = useRef({ onLoad, session });
  useEffect(() => {
    latest.current = { onLoad, session };
  });

  const loadedFor = useRef<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  useEffect(() => {
    if (requested === null || !known || loadedFor.current === requested) return;
    loadedFor.current = requested;
    void loadSessionGpx(requested).then((text) => {
      if (loadedFor.current !== requested) return;
      // La session relue en entier, plus récente que celle du dernier rendu.
      const current = librarySession(requested) ?? latest.current.session;
      if (text === null || !current) {
        setReadError('GPX introuvable dans la mémoire.');
        return;
      }
      setReadError(null);
      latest.current.onLoad(text, current);
    });
  }, [requested, known]);

  // Fiche redevenue partielle sous l'analyse ouverte (cas de secours) : relue en entier.
  const partial = session?.partial === true;
  useEffect(() => {
    if (partial && requested !== null && loadedFor.current === requested) void loadFullSession(requested);
  }, [partial, requested]);

  const missing = requested !== null && !known && settled;
  return {
    /** Session demandée par l'URL, connue ou non de la mémoire, `null` si aucune. */
    requested,
    /** Fichier de la session chargée depuis la mémoire, `null` sinon. */
    file: known ? requested : null,
    session,
    error: missing ? 'Cette session n\'est pas dans la mémoire.' : readError,
  };
};
