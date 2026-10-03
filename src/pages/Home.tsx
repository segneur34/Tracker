import { useState } from 'react';
import { Link } from 'react-router-dom';
import ActivityChart from '../components/ActivityChart';
import MemoryStatus from '../components/MemoryStatus';
import RouteList from '../components/RouteList';
import { IconBike, IconChevronRight, IconRoute, IconRun, IconSail } from '../components/icons';
import PageHeader from '../components/ui/PageHeader';
import { useRouteLibrary } from '../hooks/useRouteLibrary';
import { useSessionLibrary } from '../hooks/useSessionLibrary';
import { readStoredActivities } from '../hooks/useSportSettings';

/**
 * Accueil : enregistrer ou planifier un itinéraire, le graphe d'activités et
 * ses totaux (dès qu'il y a des sessions), les deux modules, puis les
 * derniers itinéraires planifiés (dès que la mémoire est prête), dont la carte
 * mène à la liste complète.
 */

/** Itinéraires montrés sur l'accueil, les derniers rangés ; les autres sont dans la liste complète. */
const HOME_ROUTES = 3;

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
  const { routes } = useRouteLibrary();
  // Relues à l'ouverture de la page : les activités se changent dans Réglages.
  const [activities] = useState(readStoredActivities);
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

      <Link to="/velo" style={cardStyle}>
        <span style={{ ...titleStyle, color: 'var(--velo)' }}><IconBike /> Vélo</span>
        <span style={{ color: 'var(--muted)', fontSize: 'var(--text-m)', lineHeight: 1.5 }}>
          Vitesse, dénivelé, zones de pente, meilleurs segments, puissance et énergie.
        </span>
      </Link>

      {status === 'ready' && (
        <div style={cardStyle}>
          <Link to="/itineraires/liste" style={{ ...titleStyle, color: 'var(--ink)', textDecoration: 'none' }}>
            <IconRoute /> <span style={{ flex: 1 }}>Itinéraires planifiés ({routes.length})</span> <IconChevronRight />
          </Link>
          {routes.length > 0 ? (
            <>
              <RouteList routes={routes.slice(0, HOME_ROUTES)} activities={activities} />
              <Link to="/itineraires/liste" style={{ fontSize: 'var(--text-m)', fontWeight: 600 }}>
                {routes.length > HOME_ROUTES ? `Voir les ${routes.length} itinéraires` : 'Trier et voir tous les itinéraires'}
              </Link>
            </>
          ) : (
            <span style={{ color: 'var(--muted)', fontSize: 'var(--text-m)', lineHeight: 1.5 }}>
              Aucun itinéraire pour l'instant. <Link to="/itineraires">Planifier</Link> un parcours pour le retrouver ici.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default Home;
