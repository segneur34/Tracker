import { DEFAULT_TIMER_WORKOUT, workoutBlocks, type IntervalBlock, type WorkoutKind } from './intervalTimer';

/**
 * Les deux listes de séances de l'Entraînement (25/10), sur les mêmes pages
 * (`TrainingSessionsPage`, `TrainingSessionEditPage`) : le Fractionné, lancé
 * avec une activité, avec les tests sous sa liste ; le Timer, lancé seul,
 * sans GPS ni session, ou en Muscu, enregistré avec la ceinture (lot I du
 * 25/10 : une seule liste pour les deux). Ce qui les distingue à l'écran :
 * titres, mots, adresses, blocs d'une séance neuve.
 */
export interface WorkoutList {
  title: string;
  subtitle: string;
  /** Adresse de la liste ; l'édition est en dessous (`/editer`). */
  listPath: string;
  editPath: string;
  create: string;
  newTitle: string;
  editTitle: string;
  empty: string;
  /** Blocs d'une séance neuve. */
  newBlocks: IntervalBlock[];
}

export const WORKOUT_LISTS: Record<WorkoutKind, WorkoutList> = {
  fractionne: {
    title: 'Fractionné et tests',
    subtitle: "Le compteur d'intervalles : des séances faites de blocs, gardées pour être relancées toutes faites ; et les tests à la ceinture cardio.",
    listPath: '/fractionne/seances',
    editPath: '/fractionne/seances/editer',
    create: 'Créer un compteur',
    newTitle: 'Nouveau compteur',
    editTitle: 'Modifier le compteur',
    empty: "Aucune séance gardée : créez-en une, ou gardez celle que vous lancez au compteur d'Enregistrer.",
    newBlocks: [
      { kind: 'libre', label: 'Échauffement', durationS: 600 },
      { kind: 'series', reps: 3, workS: 180, restS: 60 },
      { kind: 'libre', label: 'Retour au calme', durationS: 600 },
    ],
  },
  timer: {
    title: 'Muscu et timer',
    subtitle: "Des minuteries à blocs, hors fractionné : « Timer » lance le compteur seul, sans GPS ni session ; « Enregistrer » enregistre la séance avec la ceinture cardio.",
    listPath: '/fractionne/timer',
    editPath: '/fractionne/timer/editer',
    create: 'Créer une séance',
    newTitle: 'Nouvelle séance',
    editTitle: 'Modifier la séance',
    empty: 'Aucune séance gardée : créez-en une.',
    newBlocks: workoutBlocks(DEFAULT_TIMER_WORKOUT),
  },
};

/** Enregistrer en mode Timer : le compteur seul (`RecordingPage`). */
export const TIMER_RECORD_PATH = '/enregistrer?minuterie=1';

/** Enregistrer sur une activité, prêt à lancer ; `test` : le test guidé de la rangée « Test » (`&test=`). */
export const recordPath = (activityId: string, test?: string): string =>
  `/enregistrer?activite=${encodeURIComponent(activityId)}${test ? `&test=${test}` : ''}`;
