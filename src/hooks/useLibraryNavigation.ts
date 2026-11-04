import { plainError } from '../platform/errorText';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Activity } from '../core/activities';
import { sportFamily, type SportFamily } from '../core/sportProfiles';
import type { LibrarySession } from '../library/record';
import { analysisPath, sessionFamily } from '../core/parentPage';
import { confirmLeave } from './leaveGuard';
import { librarySession, loadFullSession, loadSessionGpx, updateSessionRecord, useLibrarySelector, useLibrarySession } from './useSessionLibrary';
import { readStoredActivities } from './useSportSettings';

/**
 * Passage de la bibliothèque aux modules d'analyse.
 *
 * La session à analyser est dans l'URL (`/voile/analyse?session=<fichier>`) :
 * un rechargement la rouvre, et le retour arrière ramène à la liste.
 */

/** Ouvre une session de la mémoire dans le module qui l'analyse. */
export const useOpenSession = () => {
  const navigate = useNavigate();
  return useCallback(
    (file: string, fallback: SportFamily, fromActivityId?: string | null) =>
      navigate(analysisPath(sessionFamily(librarySession(file), fallback), file, fromActivityId)),
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
 * Issue de la lecture du GPX d'une analyse : son texte, ou l'erreur à dire.
 * `retry` : la lecture a levé (accès au dossier perdu, carte retirée), elle
 * sera refaite quand la session reparaîtra dans la mémoire.
 */
export type GpxLoadOutcome = { text: string } | { error: string; retry: boolean };

/** Lecture du GPX d'une analyse (`loadSessionGpx`), sans jamais lever. */
export const loadGpxOutcome = async (load: Promise<string | null>): Promise<GpxLoadOutcome> => {
  try {
    const text = await load;
    return text === null ? { error: 'GPX introuvable dans la mémoire.', retry: false } : { text };
  } catch (err) {
    return { error: plainError(err, 'GPX illisible.'), retry: true };
  }
};

/**
 * Suite à donner à une lecture du GPX terminée : `drop`, la page l'a quittée
 * (analyse démontée, autre session demandée, session sortie de la mémoire)
 * et rien n'est lu ni écrit, ce qui épargne à la page suivante la lecture du
 * texte ; `retry`, l'erreur est dite et la lecture refaite quand la session
 * reparaîtra ; `error`, l'erreur est dite ; `deliver`, le texte va au module.
 */
export const gpxLoadAction = (outcome: GpxLoadOutcome, alive: boolean): 'drop' | 'error' | 'retry' | 'deliver' => {
  if (!alive) return 'drop';
  if ('error' in outcome) return outcome.retry ? 'retry' : 'error';
  return 'deliver';
};

/**
 * Session de l'adresse en cours de lecture : demandée, connue de la
 * bibliothèque prête (`known`, `ready`), sans erreur, et dont le texte n'est
 * pas encore remis au module (`deliveredFor`, fichier de la dernière trace
 * remise). Le module la calcule dans le rendu même où elle lui est remise :
 * « Lecture de la session… » tient jusqu'au rendu de la trace. Mémoire pas
 * encore ouverte, non autorisée ou perdue, session inconnue : rien n'est lu,
 * la page reste muette (les messages de la mémoire sont ailleurs).
 */
export const sessionReading = ({ requested, ready, known, deliveredFor, error }: {
  requested: string | null;
  /** Bibliothèque ouverte (`status === 'ready'`). */
  ready: boolean;
  /** Session demandée connue de la bibliothèque. */
  known: boolean;
  deliveredFor: string | null;
  error: string | null;
}): boolean => requested !== null && ready && known && deliveredFor !== requested && error === null;

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
 *
 * Quitter la page, ou demander une autre session, abandonne la lecture en
 * cours (nettoyage de l'effet, `gpxLoadAction`) : son texte n'est pas lu, et
 * la session sera relue si on y revient (double passage de `StrictMode`,
 * dossier perdu puis rouvert).
 */
export const useSessionFromUrl = (onLoad: (content: string, session: LibrarySession) => void) => {
  const [params] = useSearchParams();
  const requested = params.get('session');
  const session = useLibrarySession(requested);
  /** Bibliothèque ouverte et balayée : une session encore inconnue n'y est pas. */
  const settled = useLibrarySelector((s) => s.status === 'ready' && s.scanning === null);
  /** Bibliothèque ouverte : la mémoire est lisible. */
  const ready = useLibrarySelector((s) => s.status === 'ready');
  const known = session !== undefined;

  const latest = useRef({ onLoad, session });
  useEffect(() => {
    latest.current = { onLoad, session };
  });

  const loadedFor = useRef<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  /** Fichier de la dernière trace remise au module (`onLoad`). */
  const [deliveredFor, setDeliveredFor] = useState<string | null>(null);
  useEffect(() => {
    if (requested === null || !known || loadedFor.current === requested) return;
    loadedFor.current = requested;
    /** Faux dès le nettoyage de l'effet : la lecture est abandonnée. */
    let alive = true;
    /** Vrai quand la lecture a abouti (trace remise ou erreur dite). */
    let done = false;
    void loadGpxOutcome(loadSessionGpx(requested)).then((outcome) => {
      const action = gpxLoadAction(outcome, alive);
      if (action === 'drop') return;
      done = true;
      if ('error' in outcome) {
        // Lecture qui a levé : refaite quand la session reparaît (dossier rouvert).
        if (action === 'retry') loadedFor.current = null;
        setReadError(outcome.error);
        return;
      }
      // La session relue en entier, plus récente que celle du dernier rendu.
      const current = librarySession(requested) ?? latest.current.session;
      if (!current) {
        setReadError('GPX introuvable dans la mémoire.');
        return;
      }
      setReadError(null);
      // Dans le même rappel que la trace : un seul rendu, où la lecture prend fin.
      setDeliveredFor(requested);
      latest.current.onLoad(outcome.text, current);
    });
    return () => {
      alive = false;
      // Lecture abandonnée : à refaire quand la session sera de nouveau demandée.
      if (!done && loadedFor.current === requested) loadedFor.current = null;
    };
  }, [requested, known]);

  // Fiche redevenue partielle sous l'analyse ouverte (cas de secours) : relue en entier.
  const partial = session?.partial === true;
  useEffect(() => {
    if (partial && requested !== null && loadedFor.current === requested) void loadFullSession(requested);
  }, [partial, requested]);

  const missing = requested !== null && !known && settled;
  const error = missing ? 'Cette session n\'est pas dans la mémoire.' : readError;
  return {
    /** Session demandée par l'URL, connue ou non de la mémoire, `null` si aucune. */
    requested,
    /** Fichier de la session chargée depuis la mémoire, `null` sinon. */
    file: known ? requested : null,
    session,
    error,
    /** Session demandée dont la trace n'est pas encore remise au module : « Lecture de la session… ». */
    reading: sessionReading({ requested, ready, known, deliveredFor, error }),
  };
};
