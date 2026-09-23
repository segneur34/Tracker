import { NavLink } from 'react-router-dom';

/**
 * Barre de navigation entre les modules, affichée en haut de chaque page
 * d'analyse. Le module courant est mis en évidence.
 */

const MODULES = [
  { to: '/', label: 'Accueil', color: '#555' },
  { to: '/voile', label: '⛵ Voile / Wingfoil', color: '#1976d2' },
  { to: '/course', label: '🏃 Course à pied', color: '#e64a19' },
  { to: '/enregistrer', label: '● Enregistrer', color: '#2e7d32' },
  { to: '/parametres', label: '⚙ Paramètres', color: '#455a64' },
];

function ModuleNav() {
  return (
    <nav
      aria-label="Modules"
      style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px', borderBottom: '1px solid #ddd', paddingBottom: '10px' }}>
      {MODULES.map((m) => (
        <NavLink
          key={m.to}
          to={m.to}
          end={m.to === '/'}
          style={({ isActive }) => ({
            padding: '6px 14px',
            borderRadius: '6px',
            textDecoration: 'none',
            fontSize: '14px',
            fontWeight: isActive ? 'bold' : 'normal',
            color: isActive ? '#fff' : m.color,
            backgroundColor: isActive ? m.color : 'transparent',
            border: `1px solid ${m.color}`,
          })}>
          {m.label}
        </NavLink>
      ))}
    </nav>
  );
}

export default ModuleNav;
