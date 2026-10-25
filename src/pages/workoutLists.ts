import { DEFAULT_TIMER_WORKOUT, workoutBlocks, type IntervalBlock, type WorkoutKind } from '../recording/intervalTimer';

/**
 * Les deux listes de séances de l'Entraînement (25/10), sur les mêmes pages
 * (`TrainingSessionsPage`, `TrainingSessionEditPage`) : le Fractionné, lancé
 * avec une activité, et le Timer, hors de toute activité, sans GPS ni
 * session. Ce qui les distingue à l'écran : titres, mots, adresses, blocs
 * d'une séance neuve.
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
    title: 'Fractionné',
    subtitle: "Le compteur d'intervalles : des séances faites de blocs, gardées pour être relancées toutes faites.",
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
    title: 'Timer',
    subtitle: 'Des minuteries à blocs, hors fractionné (muscu, gainage…) : le compteur seul, sans GPS ni session.',
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
