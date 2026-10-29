/**
 * Cases « Foil » et « Pumping » de l'onglet réglages (voile et surf). Chacune
 * dit si sa valeur est celle de l'activité (`…IsDefault`, rien de saisi dans la
 * fiche) ; le pumping ne se montre qu'en foil, et en voile que si le profil le permet.
 */
export default function FoilPumpingFields({ foilTitle, foil, foilIsDefault, onFoilChange, showPumping, pumping, pumpingIsDefault, onPumpingChange }: {
  /** Infobulle de la case Foil (le support change d'un module à l'autre). */
  foilTitle: string;
  foil: boolean;
  foilIsDefault: boolean;
  onFoilChange: (foil: boolean) => void;
  showPumping: boolean;
  pumping: boolean;
  pumpingIsDefault: boolean;
  onPumpingChange: (pumping: boolean) => void;
}) {
  const labelStyle = { display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-s)' } as const;
  const hintStyle = { color: 'var(--muted)', fontSize: 'var(--text-xs)' } as const;
  return (
    <>
      <label style={labelStyle} title={foilTitle}>
        <input type="checkbox" checked={foil} onChange={(e) => onFoilChange(e.target.checked)} />
        <strong>Foil</strong>
        {foilIsDefault && <span style={hintStyle}>(supposé : celui de l'activité)</span>}
      </label>
      {showPumping && (
        <label style={labelStyle}
          title="Pumping des vols par les capteurs du téléphone, pour cette session, enregistré avec elle. Celui de l'activité se règle dans Réglages.">
          <input type="checkbox" checked={pumping} onChange={(e) => onPumpingChange(e.target.checked)} />
          <strong>Pumping</strong>
          {pumpingIsDefault && <span style={hintStyle}>(celui de l'activité)</span>}
        </label>
      )}
    </>
  );
}
