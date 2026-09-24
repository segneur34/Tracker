import { Link } from 'react-router-dom';
import MemoryStatus from '../components/MemoryStatus';
import { IconRun, IconSail } from '../components/icons';
import PageHeader from '../components/ui/PageHeader';
import { useSessionLibrary } from '../hooks/useSessionLibrary';

/**
 * Accueil. Version d'attente : les deux modules et l'enregistrement. Le
 * tableau de bord (graphe d'activités, totaux, dernières sessions) arrive
 * avec la bibliothèque des sessions.
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
  const { status } = useSessionLibrary();
  // Premier lancement sur le téléphone, ou dossier devenu inaccessible : la mémoire d'abord.
  const memoryNeedsAction = status === 'unavailable' || status === 'needs-permission';

  return (
    <div className="ui-page">
      <PageHeader title="Tracker" aside={<span style={{ color: 'var(--muted)', fontSize: 'var(--text-m)' }}>{today}</span>} />

      {memoryNeedsAction && <MemoryStatus />}

      <Link to="/enregistrer" style={{ ...cardStyle, gap: '14px' }}>
        <span className="ui-eyebrow">Nouvelle session</span>
        <span className="ui-btn ui-btn--record ui-btn--l ui-btn--block">
          <span className="ui-record-dot" />
          Enregistrer
        </span>
      </Link>

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
