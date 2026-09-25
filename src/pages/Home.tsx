import { Link } from 'react-router-dom';
import ActivityChart from '../components/ActivityChart';
import MemoryStatus from '../components/MemoryStatus';
import { IconRoute, IconRun, IconSail } from '../components/icons';
import PageHeader from '../components/ui/PageHeader';
import { useSessionLibrary } from '../hooks/useSessionLibrary';

/**
 * Accueil : enregistrer ou planifier un itinéraire, le graphe d'activités et
 * ses totaux (dès qu'il y a des sessions), puis les deux modules.
 */

const cardStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  padding: '18px',
  borderRadius: 'var(--radius-l)',
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  color: 'var(--ink)',
  textDecoration: 'none',
} as const;

const titleStyle = { display: 'flex', alignItems: 'center', gap: '10px', fontSize: 'var(--text-l)', fontWeight: 700 } as const;

function Home() {
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const { status, sessions } = useSessionLibrary();
  // Premier lancement sur le téléphone, ou dossier devenu inaccessible : la mémoire d'abord.
  const memoryNeedsAction = status === 'unavailable' || status === 'needs-permission';

  return (
    <div className="ui-page">
      <PageHeader title="Tracker" aside={<span style={{ color: 'var(--muted)', fontSize: 'var(--text-m)' }}>{today}</span>} />

      {memoryNeedsAction && <MemoryStatus />}

      <div style={{ ...cardStyle, gap: '14px' }}>
        <span className="ui-eyebrow">Nouvelle session</span>
        <div style={{ display: 'flex', gap: '10px' }}>
          <Link to="/enregistrer" className="ui-btn ui-btn--record ui-btn--l" style={{ flex: 1 }}>
            <span className="ui-record-dot" />
            Enregistrer
          </Link>
          <Link to="/itineraires" className="ui-btn ui-btn--secondary ui-btn--l" style={{ flex: 1 }}>
            <IconRoute size={20} />
            Planifier
          </Link>
        </div>
      </div>

      {sessions.length > 0 && <ActivityChart />}

      <Link to="/voile" style={cardStyle}>
        <span style={{ ...titleStyle, color: 'var(--voile)' }}><IconSail /> Voile</span>
        <span style={{ color: 'var(--muted)', fontSize: 'var(--text-m)', lineHeight: 1.5 }}>
          Wingfoil, planche, kite, bateau : vitesse, tops, virements et empannages, vent, VMG.
        </span>
      </Link>

      <Link to="/course" style={cardStyle}>
        <span style={{ ...titleStyle, color: 'var(--course)' }}><IconRun /> Course à pied</span>
        <span style={{ color: 'var(--muted)', fontSize: 'var(--text-m)', lineHeight: 1.5 }}>
          Allure, dénivelé, zones de pente, vitesse et altitude.
        </span>
      </Link>
    </div>
  );
}

export default Home;
