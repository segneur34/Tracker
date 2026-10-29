import { useCallback, useState } from 'react';
import { sessionActivity, type Activity } from '../core/activities';
import type { SportFamily } from '../core/sportProfiles';
import type { LibrarySession } from '../library/record';
import { useChangeSessionActivity, useSessionFromUrl } from './useLibraryNavigation';
import { useSessionDraft } from './useSessionDraft';
import { readStoredActivities } from './useSportSettings';

export interface AnalysisSessionInput {
  /** Famille du module : l'activité changée vers une autre famille fait changer la session de module. */
  family: SportFamily;
  activity: Activity;
  setActivity: (id: string) => void;
  /** Lit le GPX de la session (`content`) rangé sous `file` : chargeur du module. */
  load: (content: string, file: string) => void;
  /** Fichier dont la trace est lue par le module (celui passé à `load`), `null` avant. */
  loadedFile: string | null;
  /**
   * Fichier du brouillon : `shown` (défaut), la session affichée ; `requested`,
   * la session demandée par l'adresse dès que sa trace est lue, même sortie
   * de la mémoire depuis (la voile, comme avant le lot 62).
   */
  draftFor?: 'shown' | 'requested';
}

/**
 * Session d'un module d'analyse, la même pour les quatre : la session de la
 * mémoire désignée par l'adresse (`useSessionFromUrl`), dont l'activité devient
 * celle du module avant que le module lise son GPX (`load`) ; le fichier
 * affiché, seulement quand la trace lue est bien celle de l'adresse ; le
 * brouillon de la session (`useSessionDraft`), écrit dans sa fiche par
 * « Enregistrer la session » ; la liste des activités et le changement
 * d'activité de l'onglet réglages (`useChangeSessionActivity`).
 */
export const useAnalysisSession = ({ family, activity, setActivity, load, loadedFile, draftFor = 'shown' }: AnalysisSessionInput) => {
  // Session de la mémoire désignée par l'URL : son activité devient celle du module.
  const receiveSession = useCallback(
    (content: string, session: LibrarySession) => {
      const recorded = sessionActivity(readStoredActivities(), session.record.activityId, session.record.sport);
      if (recorded && recorded.id !== activity.id) setActivity(recorded.id);
      load(content, session.file);
    },
    [activity.id, setActivity, load]
  );
  const { file: sessionFile, requested, error } = useSessionFromUrl(receiveSession);
  /** Fichier de la session affichée : la trace lue est celle de l'adresse, et la session est dans la mémoire. */
  const shownFile = sessionFile !== null && loadedFile === sessionFile ? sessionFile : null;
  const draftFile = draftFor === 'requested' ? (requested !== null && loadedFile === requested ? requested : null) : shownFile;
  // Brouillon de la session : écrit dans sa fiche par « Enregistrer la session ». Aucun pour un GPX lu hors de la mémoire.
  const draft = useSessionDraft(draftFile);
  /**
   * Changer d'activité l'écrit aussi dans la fiche de la session ; vers une
   * activité d'une autre famille, la session part dans le module de celle-ci.
   */
  const [allActivities] = useState(readStoredActivities);
  const changeActivity = useChangeSessionActivity(family, setActivity);

  return {
    /** Session demandée par l'URL, connue ou non de la mémoire, `null` si aucune. */
    requested,
    /** Fichier de la session de la mémoire désignée par l'URL, `null` sinon. */
    sessionFile,
    /** Fichier de la session affichée (sa trace lue), `null` sinon. */
    shownFile,
    /** Session absente de la mémoire, ou GPX illisible. */
    error,
    draft,
    allActivities,
    changeActivity,
  };
};
