import { Link } from 'react-router-dom';
import { IconChevronRight, IconPulse, IconStopwatch } from './icons';
import { useIntervalSettings } from '../hooks/useSportSettings';
import '../pages/TrainingPages.css';

/**
 * Tuiles de la page Entraînement (24/10), sous son bandeau, chacune vers sa
 * page : Fractionné (séances du compteur d'intervalles), Tests (FC max,
 * puis d'autres) ; Muscu viendra.
 * La liste des sessions suit, inchangée.
 */
function TrainingHub() {
  const { presets } = useIntervalSettings();
  return (
    <nav className="train-hub" aria-label="Types d'entraînement">
      <Link to="/fractionne/seances" className="train-tile">
        <span className="train-tile__icon" aria-hidden="true"><IconStopwatch size={16} /></span>
        <span className="train-tile__text">
          <span className="train-tile__title">Fractionné</span>
          <span className="train-tile__sub">
            Compteur d'intervalles : {presets.length} séance{presets.length > 1 ? 's' : ''} gardée{presets.length > 1 ? 's' : ''}
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
    </nav>
  );
}

export default TrainingHub;
