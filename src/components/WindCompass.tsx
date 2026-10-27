import type { CSSProperties } from 'react';

/**
 * Boussole du vent : la flèche rouge part du côté d'où vient le vent et pointe
 * vers le centre. Petite dans l'onglet « général » de la voile, à côté du
 * bouton « Régler » qui ouvre la grande sur la carte (`WindAdjustOverlay`).
 */
function WindCompass({ windAngle, size = 120 }: { windAngle: number; size?: number }) {
  const center = size / 2;
  const small = size < 90;
  const label = (text: string, style: CSSProperties) => (
    <span style={{ position: 'absolute', fontSize: small ? '9px' : '10px', fontWeight: 'bold', color: 'var(--muted)', ...style }}>{text}</span>
  );
  return (
    <div style={{ position: 'relative', width: `${size}px`, height: `${size}px`, background: 'var(--surface)', borderRadius: '50%', border: '2px solid var(--ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 5px color-mix(in srgb, var(--shadow-color) 10%, transparent)', flexShrink: 0, boxSizing: 'border-box' }}>
      {label(small ? 'N' : 'N(0°)', { top: 2, left: '50%', transform: 'translateX(-50%)' })}
      {label(small ? 'S' : 'S(180°)', { bottom: 2, left: '50%', transform: 'translateX(-50%)' })}
      {label(small ? 'E' : 'E(90°)', { right: 3, top: '50%', transform: 'translateY(-50%)' })}
      {label(small ? 'O' : 'O(270°)', { left: 3, top: '50%', transform: 'translateY(-50%)' })}
      <svg width={size} height={size} style={{ position: 'absolute', transform: `rotate(${windAngle}deg)`, transition: 'transform 0.3s ease' }}>
        <line x1={center} y1={size * 0.2} x2={center} y2={center} stroke="red" strokeWidth={small ? 2 : 3} />
        <polygon points={`${center - 5},${center - 10} ${center + 5},${center - 10} ${center},${center + 2}`} fill="red" />
      </svg>
    </div>
  );
}

export default WindCompass;
