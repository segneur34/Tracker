import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTutorials } from '../hooks/useTutorials';
import { dayKey, todayLesson } from '../tutorials/tutorials';
import { IconClose } from './icons';
import LessonIcon from './LessonIcon';
import Card from './ui/Card';
import './Tutorials.css';

/**
 * Décision de la carte pour ce lancement : prise une fois, à la première décision de la garde. Bloquée par
 * la mémoire, les autorisations ou le pop-up du profil, elle attend le lancement suivant (un état du module).
 */
let decidedThisLaunch: 'blocked' | 'free' | null = null;

/**
 * Carte « Aujourd'hui : … » de l'accueil (lot 147) : la leçon du jour d'ouverture,
 * son accroche, « Lire » qui ouvre la leçon, et une croix qui la ferme pour la
 * journée ; rien une fois la leçon lue, ou au-delà du programme. Le jour est
 * compté à chaque passage sur l'accueil (une fois par jour). `gate` : la garde
 * de l'accueil (`tutorialCardGate`), qui la fait passer après les autres cartes.
 */
function TutorialOfDay({ gate }: { gate: 'wait' | 'blocked' | 'free' }) {
  const { state, hiddenFamilies, open, dismiss } = useTutorials();
  const [today] = useState(() => dayKey(new Date()));
  useEffect(() => {
    open(today);
  }, [open, today]);
  useEffect(() => {
    if (decidedThisLaunch === null && gate !== 'wait') decidedThisLaunch = gate;
  }, [gate]);

  const decided = decidedThisLaunch ?? (gate === 'wait' ? null : gate);
  if (decided !== 'free') return null;
  const lesson = todayLesson(state, today, hiddenFamilies);
  if (!lesson) return null;

  return (
    <Card className="tutorial-card" aria-label="Leçon du jour">
      <div className="tutorial-card__head">
        <span className="tutorial-icon" aria-hidden="true"><LessonIcon icon={lesson.icon} size={18} /></span>
        <h2 className="ui-card__title tutorial-card__title">Aujourd'hui : {lesson.title}</h2>
        <button type="button" className="tutorial-card__close" aria-label="Fermer pour aujourd'hui" title="Fermer pour aujourd'hui"
          onClick={() => dismiss(today)}>
          <IconClose size={18} />
        </button>
      </div>
      <p className="tutorial-card__hook">{lesson.hook}</p>
      <Link to={`/tutoriels/${lesson.id}`} className="ui-btn ui-btn--primary ui-btn--s tutorial-card__read">Lire</Link>
    </Card>
  );
}

export default TutorialOfDay;
