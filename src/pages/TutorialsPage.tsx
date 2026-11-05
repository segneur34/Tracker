import { Link } from 'react-router-dom';
import LessonIcon from '../components/LessonIcon';
import PageBackdrop from '../components/PageBackdrop';
import { IconCheck, IconChevronRight } from '../components/icons';
import PageHeader from '../components/ui/PageHeader';
import { useFavoriteBackdrop } from '../hooks/useFavoriteBackdrop';
import { useTutorials } from '../hooks/useTutorials';
import '../components/Tutorials.css';

/**
 * Tous les tutoriels (`/tutoriels`, lot 147) : les leçons dans l'ordre du
 * programme, celles des familles cachées retirées, une coche sur celles lues ;
 * ouverte depuis Réglages › Tutoriels, où le retour ramène.
 */
function TutorialsPage() {
  const backdrop = useFavoriteBackdrop();
  const { state, lessons } = useTutorials();
  const readCount = lessons.filter((l) => state.read.includes(l.id)).length;
  return (
    <div className="ui-page ui-page--backdrop">
      <PageBackdrop variant={backdrop} />
      <PageHeader title="Tutoriels" back={{ to: '/parametres', label: 'Réglages' }}
        subtitle={`${readCount} ${readCount >= 2 ? 'lues' : 'lue'} sur ${lessons.length}`} />
      <ol className="tutorial-list" aria-label="Leçons">
        {lessons.map((lesson) => {
          const read = state.read.includes(lesson.id);
          return (
            <li key={lesson.id}>
              <Link to={`/tutoriels/${lesson.id}`} className="tutorial-row">
                <span className="tutorial-icon" aria-hidden="true"><LessonIcon icon={lesson.icon} size={18} /></span>
                <span className="tutorial-row__text">
                  <span className="tutorial-row__title">{lesson.title}</span>
                  <span className="tutorial-row__hook">{lesson.hook}</span>
                </span>
                {read && <span className="tutorial-row__read" role="img" aria-label="lue"><IconCheck size={18} /></span>}
                <IconChevronRight size={14} className="tutorial-row__go" />
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default TutorialsPage;
