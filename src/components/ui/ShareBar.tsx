/**
 * Barre de part d'une tranche (zone, cadence) dans une cellule de tableau :
 * un rail rempli à `share` (0 à 1) dans la couleur de la tranche, et la part
 * en pourcentage entier à droite.
 */
export default function ShareBar({ share, color }: { share: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <div style={{ flex: 1, height: '8px', backgroundColor: 'var(--surface-sunken)', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{ width: `${share * 100}%`, height: '100%', backgroundColor: color }} />
      </div>
      <span style={{ minWidth: '3em', textAlign: 'right', fontSize: 'var(--text-xs)' }}>{Math.round(share * 100)} %</span>
    </div>
  );
}
