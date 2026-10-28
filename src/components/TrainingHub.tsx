import { Link } from 'react-router-dom';
import { IconChevronRight, IconStopwatch, IconTimer } from './icons';
import { useIntervalSettings } from '../hooks/useSportSettings';
import { WORKOUT_LISTS } from '../pages/workoutLists';
import '../pages/TrainingPages.css';

const savedCount = (n: number) => `${n} séance${n > 1 ? 's' : ''} gardée${n > 1 ? 's' : ''}`;

/**
 * Tuiles de la page Entraînement, sous son bandeau, chacune vers sa page
 * (lot I du 25/10, deux tuiles) : « Fractionné et tests » (séances du
 * compteur d'intervalles, et les tests FC max et FC repos sous elles),
 * « Muscu et timer » (séances du Timer, lancées seules ou en muscu, avec la
 * ceinture). La liste des sessions suit, inchangée.
 */
function TrainingHub() {
  const { presets } = useIntervalSettings('fractionne');
  const { presets: timerPresets } = useIntervalSettings('timer');
  return (
    <nav className="train-hub" aria-label="Types d'entraînement">
      <Link to={WORKOUT_LISTS.fractionne.listPath} className="train-tile">
        <span className="train-tile__icon" aria-hidden="true"><IconStopwatch size={16} /></span>
        <span className="train-tile__text">
          <span className="train-tile__title">{WORKOUT_LISTS.fractionne.title}</span>
          <span className="train-tile__sub">
            Compteur d'intervalles : {savedCount(presets.length)} ; FC max, FC repos
          </span>
        </span>
        <IconChevronRight size={14} className="train-tile__go" />
      </Link>
      <Link to={WORKOUT_LISTS.timer.listPath} className="train-tile">
        <span className="train-tile__icon" aria-hidden="true"><IconTimer size={16} /></span>
        <span className="train-tile__text">
          <span className="train-tile__title">{WORKOUT_LISTS.timer.title}</span>
          <span className="train-tile__sub">Minuteries, seules ou avec la ceinture : {savedCount(timerPresets.length)}</span>
        </span>
        <IconChevronRight size={14} className="train-tile__go" />
      </Link>
    </nav>
  );
}

export default TrainingHub;
