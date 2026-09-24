import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { sportFamily, type SportFamily } from '../core/sportProfiles';
import type { LibrarySession } from '../library/record';
import { findLibrarySession, importFiles, librarySession, readSessionGpx, useSessionLibrary } from './useSessionLibrary';

/**
 * Passage de la bibliothèque aux modules d'analyse.
 *
 * La session à analyser est dans l'URL (`/voile/analyse?session=<fichier>`) :
 * un rechargement la rouvre, et le retour arrière ramène à la liste.
 */

/** Bibliothèque d'une famille. */
export const libraryPath = (family: SportFamily): string => `/${family}`;

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
 * Importe un GPX choisi dans un module d'analyse, puis l'ouvre depuis la
 * mémoire. Rend faux si la session n'a pas pu y entrer (GPX illisible, aucune
 * mémoire accessible) : au module de la charger directement.
 */
export const useImportAndOpen = (fallback: SportFamily) => {
  const openSession = useOpenSession();
  return useCallback(
    async (file: File): Promise<boolean> => {
      const report = await importFiles([file]);
      const target = report.added[0] ?? report.existing[0];
      if (!target) return false;
      openSession(target, fallback);
      return true;
    },
    [openSession, fallback]
  );
};

/**
 * Côté module : charge la session désignée par l'URL, une seule fois par
 * fichier, dès que la bibliothèque la connaît.
 *
 * Le chargement ne dépend que du nom du fichier. `onLoad` change d'identité à
 * chaque changement de réglage (`setSport`), et la fiche à chaque écriture
 * (notes, nombre de manœuvres) : s'ils relançaient l'effet, la trace serait
 * rechargée en boucle, comme au §10, point 39. D'où les références à part.
 */
export const useSessionFromUrl = (onLoad: (content: string, session: LibrarySession) => void) => {
  const [params] = useSearchParams();
  const requested = params.get('session');
  const library = useSessionLibrary();
  const session = findLibrarySession(library.sessions, requested);
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
    void readSessionGpx(requested).then((text) => {
      if (loadedFor.current !== requested) return;
      const current = latest.current.session;
      if (text === null || !current) {
        setReadError('GPX introuvable dans la mémoire.');
        return;
      }
      setReadError(null);
      latest.current.onLoad(text, current);
    });
  }, [requested, known]);

  const missing = requested !== null && !known && library.status === 'ready' && library.scanning === null;
  return {
    /** Fichier de la session chargée depuis la mémoire, `null` sinon. */
    file: known ? requested : null,
    session,
    error: missing ? 'Cette session n\'est pas dans la mémoire.' : readError,
  };
};
