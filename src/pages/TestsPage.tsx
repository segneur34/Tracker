import { IconChevronRight, IconPulse } from '../components/icons';
import { Link, Navigate } from 'react-router-dom';
import { WORKOUT_LISTS } from '../recording/workoutLists';
import './TrainingPages.css';

/**
 * Tuiles des tests (24/10), chacune vers son protocole : la FC max (guidée
 * par bips), la FC repos (à la ceinture seule, sans GPS), la FC de nuit (lot
 * 213, une session de la ceinture seule toute la nuit) ; la VMA (VAMeval)
 * viendra. Rangées sous la liste des séances de « Fractionné et tests »
 * (lot I du 25/10).
 */
export function TestTiles() {
  return (
    <nav className="train-hub" aria-label="Tests">
      <Link to="/fractionne/tests/fc-max" className="train-tile">
        <span className="train-tile__icon" aria-hidden="true"><IconPulse size={16} /></span>
        <span className="train-tile__text">
          <span className="ui-subtitle">FC max</span>
          <span className="train-tile__sub">Échauffement, rampe de +0,6 km/h par minute jusqu'à ne plus tenir, récupération</span>
        </span>
        <IconChevronRight size={14} className="train-tile__go" />
      </Link>
      <Link to="/fractionne/tests/fc-repos" className="train-tile">
        <span className="train-tile__icon" aria-hidden="true"><IconPulse size={16} /></span>
        <span className="train-tile__text">
          <span className="ui-subtitle">FC repos</span>
          <span className="train-tile__sub">3 minutes immobile, la ceinture seule, sans GPS : la moyenne de 30 s la plus basse, après la première minute</span>
        </span>
        <IconChevronRight size={14} className="train-tile__go" />
      </Link>
      <Link to="/fractionne/tests/fc-nuit" className="train-tile">
        <span className="train-tile__icon" aria-hidden="true"><IconPulse size={16} /></span>
        <span className="train-tile__text">
          <span className="ui-subtitle">FC de nuit</span>
          <span className="train-tile__sub">La ceinture portée toute la nuit, sans GPS : la FC la plus basse, sa place, les sursauts, nuit après nuit</span>
        </span>
        <IconChevronRight size={14} className="train-tile__go" />
      </Link>
    </nav>
  );
}

/**
 * Ancienne page des tests (`/fractionne/tests`) : ses tuiles sont passées
 * sous les séances de « Fractionné et tests » ; l'adresse y mène, pour
 * qu'un lien gardé marche encore.
 */
function TestsPage() {
  return <Navigate to={WORKOUT_LISTS.fractionne.listPath} replace />;
}

export default TestsPage;
