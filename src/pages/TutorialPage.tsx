import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import LessonIcon from '../components/LessonIcon';
import PageBackdrop from '../components/PageBackdrop';
import Card from '../components/ui/Card';
import PageHeader from '../components/ui/PageHeader';
import { useFavoriteBackdrop } from '../hooks/useFavoriteBackdrop';
import { useLessonPath, useTutorials } from '../hooks/useTutorials';
import { LESSONS } from '../tutorials/lessons';
import '../components/Tutorials.css';

/**
 * Une leçon des tutoriels (`/tutoriels/:id`, lot 147) : titre, quelques
 * paragraphes, « Essayer » vers la page dont elle parle, la précédente et la
 * suivante du programme. L'ouvrir la marque lue. Son adresse s'ouvre toujours,
 * même d'une famille cachée ; le retour mène à la liste (`/tutoriels`), d'où
 * qu'on vienne.
 */
function TutorialPage() {
  const { id } = useParams();
  const backdrop = useFavoriteBackdrop();
  const { lessons, read } = useTutorials();
  const lesson = LESSONS.find((l) => l.id === id) ?? null;
  const tryPath = useLessonPath(lesson);
  useEffect(() => {
    if (lesson) read(lesson.id);
  }, [lesson, read]);
  if (!lesson) return <Navigate to="/tutoriels" replace />;

  // Précédente et suivante parmi les leçons montrées ; une leçon d'une famille cachée se place dans le programme entier.
  const order = lessons.some((l) => l.id === lesson.id) ? lessons : LESSONS;
  const at = order.findIndex((l) => l.id === lesson.id);
  const previous = at > 0 ? order[at - 1] : null;
  const next = at >= 0 && at < order.length - 1 ? order[at + 1] : null;

  return (
    <div className="ui-page ui-page--backdrop">
      <PageBackdrop variant={backdrop} />
      <PageHeader title={lesson.title} back={{ to: '/tutoriels', label: 'Toutes les leçons' }}
        subtitle={`Leçon ${at + 1} sur ${order.length}`} />
      <Card className="tutorial-lesson">
        <div className="tutorial-lesson__head">
          <span className="tutorial-icon" aria-hidden="true"><LessonIcon icon={lesson.icon} size={18} /></span>
          <p className="tutorial-card__hook">{lesson.hook}</p>
        </div>
        {lesson.body.map((text) => <p key={text}>{text}</p>)}
        {tryPath && <Link to={tryPath} className="ui-btn ui-btn--primary tutorial-lesson__try">Essayer</Link>}
      </Card>
      <nav className="tutorial-nav" aria-label="Leçons">
        {previous ? <Link to={`/tutoriels/${previous.id}`} className="ui-btn ui-btn--ghost">Leçon précédente</Link> : <span />}
        {next && <Link to={`/tutoriels/${next.id}`} className="ui-btn ui-btn--ghost">Leçon suivante</Link>}
      </nav>
    </div>
  );
}

export default TutorialPage;
