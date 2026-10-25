import { Link } from 'react-router-dom';
import { IconChevronRight, IconPulse, IconStopwatch, IconTimer } from './icons';
import { useIntervalSettings } from '../hooks/useSportSettings';
import '../pages/TrainingPages.css';

const savedCount = (n: number) => `${n} séance${n > 1 ? 's' : ''} gardée${n > 1 ? 's' : ''}`;

/**
 * Tuiles de la page Entraînement (24/10), sous son bandeau, chacune vers sa
 * page : Fractionné (séances du compteur d'intervalles), Tests (FC max,
 * puis d'autres), Timer (minuteries hors fractionné, 25/10) ; Muscu viendra.
 * La liste des sessions suit, inchangée.
 */
function TrainingHub() {
  const { presets } = useIntervalSettings('fractionne');
  const { presets: timerPresets } = useIntervalSettings('timer');
  return (
    <nav className="train-hub" aria-label="Types d'entraînement">
      <Link to="/fractionne/seances" className="train-tile">
        <span className="train-tile__icon" aria-hidden="true"><IconStopwatch size={16} /></span>
        <span className="train-tile__text">
          <span className="train-tile__title">Fractionné</span>
          <span className="train-tile__sub">
            Compteur d'intervalles : {savedCount(presets.length)}
          </span>
        </span>
        <IconChevronRight size={14} className="train-tile__go" />
      </Link>
      <Link to="/fractionne/tests" className="train-tile">
        <span className="train-tile__icon" aria-hidden="true"><IconPulse size={16} /></span>
        <span className="train-tile__text">
          <span className="train-tile__title">Tests</span>
          <span className="train-tile__sub">FC max, guidée par bips</span>
        </span>
        <IconChevronRight size={14} className="train-tile__go" />
      </Link>
      <Link to="/fractionne/timer" className="train-tile">
        <span className="train-tile__icon" aria-hidden="true"><IconTimer size={16} /></span>
        <span className="train-tile__text">
          <span className="train-tile__title">Timer</span>
          <span className="train-tile__sub">Minuteries hors fractionné : {savedCount(timerPresets.length)}</span>
        </span>
        <IconChevronRight size={14} className="train-tile__go" />
      </Link>
    </nav>
  );
}

export default TrainingHub;
