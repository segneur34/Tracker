import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { PolarBin } from '../sailing/wind';
import { ALTITUDE_COLOR } from './chartStyle';
import { commaDecimal } from '../core/units';

/**
 * Polaire de vitesse au vent (vitesse max par angle au vent, vent en haut),
 * qui remplit son parent, positionné : onglet « graphiques » de la voile et
 * réglage du vent sur la carte (`WindAdjustOverlay`).
 */
function SpeedPolarChart({ data, unitSymbol, compact = false }: { data: PolarBin[]; unitSymbol: string; compact?: boolean }) {
  const fontSize = compact ? 9 : 11;
  return (
    <>
      <div style={{ position: 'absolute', top: compact ? 2 : 0, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 10, pointerEvents: 'none' }}>
        <span style={{ fontSize: 9, fontWeight: 'bold', color: '#d32f2f', marginBottom: -2 }}>VENT</span>
        <svg width="12" height="16" viewBox="0 0 24 24">
          <path d="M12 24L0 12h8V0h8v12h8z" fill="#d32f2f" />
        </svg>
      </div>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius={compact ? '72%' : '80%'} data={data}>
            <PolarGrid stroke="var(--chart-grid)" />
            <PolarAngleAxis dataKey="angle" tick={{ fill: 'var(--ink-2)', fontSize }} />
            <PolarRadiusAxis angle={30} domain={[0, 'auto']} tick={{ fill: 'var(--ink)', fontSize, fontWeight: 'bold' }} />
            <Radar name="Vitesse Max" dataKey="vitesse" stroke={ALTITUDE_COLOR} fill={ALTITUDE_COLOR} fillOpacity={0.4} isAnimationActive={!compact} />
            <Tooltip formatter={(value: unknown): [string, string] => [`${commaDecimal(String(value))} ${unitSymbol}`, 'Vmax']} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

export default SpeedPolarChart;
