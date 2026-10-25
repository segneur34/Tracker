import PageHeader from '../components/ui/PageHeader';
import { IconChevronRight, IconPulse } from '../components/icons';
import { Link } from 'react-router-dom';
import { FAMILY_ACCENT } from '../core/activities';
import './TrainingPages.css';

/**
 * Tests (24/10), depuis la page Entraînement : la liste des tests,
 * chacun vers son protocole : la FC max (guidée par bips), la FC repos (à la
 * ceinture seule, sans GPS) ; la VMA (VAMeval) viendra.
 */
function TestsPage() {
  return (
    <div className="ui-page train-page" style={{ '--help-accent': FAMILY_ACCENT.fractionne } as React.CSSProperties}>
      <PageHeader title="Tests" back={{ to: '/fractionne', label: 'Entraînement' }}
        subtitle="Des tests à faire avec une ceinture cardio : le protocole, puis « Lancer » (FC max) ou « Démarrer » (FC repos)." />
      <nav className="train-hub" aria-label="Tests">
        <Link to="/fractionne/tests/fc-max" className="train-tile">
          <span className="train-tile__icon" aria-hidden="true"><IconPulse size={22} /></span>
          <span className="train-tile__text">
            <span className="train-tile__title">FC max</span>
            <span className="train-tile__sub">Échauffement, rampe de +0,6 km/h par minute jusqu'à ne plus tenir, récupération</span>
          </span>
          <IconChevronRight size={18} className="train-tile__go" />
        </Link>
        <Link to="/fractionne/tests/fc-repos" className="train-tile">
          <span className="train-tile__icon" aria-hidden="true"><IconPulse size={22} /></span>
          <span className="train-tile__text">
            <span className="train-tile__title">FC repos</span>
            <span className="train-tile__sub">3 minutes immobile, la ceinture seule, sans GPS : la moyenne de 30 s la plus basse, après la première minute</span>
          </span>
          <IconChevronRight size={18} className="train-tile__go" />
        </Link>
      </nav>
      <p className="train-hint">La VMA (VAMeval) viendra ici.</p>
    </div>
  );
}

export default TestsPage;
