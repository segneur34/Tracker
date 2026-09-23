import { useNavigate } from 'react-router-dom';

function Home() {
  const navigate = useNavigate();

  return (
    <div style={{ padding: '40px', fontFamily: 'sans-serif', maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
      <h1 style={{ fontSize: '2.5rem', marginBottom: '10px' }}>Tracker Sportif Multi-Activités</h1>
      <p style={{ color: '#666', marginBottom: '40px' }}>Sélectionnez le module d'analyse à utiliser.</p>

      <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', flexWrap: 'wrap' }}>
        
        <div 
          onClick={() => navigate('/voile')}
          style={{ flex: '1 1 300px', padding: '30px', backgroundColor: '#f0f4f8', border: '2px solid #1976d2', borderRadius: '12px', cursor: 'pointer', transition: 'transform 0.2s', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-5px)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
        >
          <h2 style={{ color: '#1976d2', margin: '0 0 15px 0' }}>⛵ Voile / Wingfoil</h2>
          <p style={{ color: '#555', margin: 0, fontSize: '14px', lineHeight: '1.5' }}>
            Analyse VMG, polaires de vitesse, détection de virements/empannages et estimation du vent. Unité : Nœuds.
          </p>
        </div>

        <div 
          onClick={() => navigate('/course')}
          style={{ flex: '1 1 300px', padding: '30px', backgroundColor: '#fdf3f0', border: '2px solid #e64a19', borderRadius: '12px', cursor: 'pointer', transition: 'transform 0.2s', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-5px)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
        >
          <h2 style={{ color: '#e64a19', margin: '0 0 15px 0' }}>🏃 Course à pied</h2>
          <p style={{ color: '#555', margin: 0, fontSize: '14px', lineHeight: '1.5' }}>
            Analyse d'allure (min/km), dénivelé positif/négatif, vitesse et segmentation kilométrique.
          </p>
        </div>

      </div>
    </div>
  );
}

export default Home;