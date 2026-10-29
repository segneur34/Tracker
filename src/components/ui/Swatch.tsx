/**
 * Pastille de couleur de 10 × 10 px devant un libellé (tranche, phase,
 * podium) : carrée aux coins arrondis, ou ronde. `gap` la sépare du texte
 * qui suit ; `bordered` la cerne d'un trait fin (couleur pâle sur fond clair).
 */
export default function Swatch({ color, round = false, gap = false, bordered = false, opacity }: {
  color: string;
  round?: boolean;
  gap?: boolean;
  bordered?: boolean;
  opacity?: number;
}) {
  return (
    <span style={{
      display: 'inline-block', width: '10px', height: '10px', borderRadius: round ? '50%' : '2px', backgroundColor: color,
      ...(gap ? { marginRight: '6px' } : {}), ...(bordered ? { border: '1px solid var(--line)' } : {}), ...(opacity !== undefined ? { opacity } : {}),
    }} />
  );
}
