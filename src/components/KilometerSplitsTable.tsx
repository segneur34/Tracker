import { useState } from 'react';
import ChartFold from './ChartFold';
import type { KilometerSplit } from '../running/kilometerSplits';
import {
  DISTANCE_UNIT_SYMBOL, formatDecimal, formatShortDuration, formatSpeedValue, speedUnitLabel, toDisplayDistance, toDisplaySpeed, type DistanceUnit, type SpeedUnit,
} from '../core/units';

const CELL = { padding: '0.4em 0.6em', textAlign: 'center' } as const;

/**
 * Tranches d'un kilomètre (ou d'un mille, selon l'unité de distance de
 * l'activité), repliées d'office sous « Par kilomètre » dans l'onglet « tops »
 * à pied et à vélo (05/11) : temps total, allure ou vitesse dans l'unité de
 * l'activité, temps en mouvement s'il y a eu des arrêts, dénivelés et FC
 * moyenne s'ils sont connus ; la dernière tranche, partielle, avec sa
 * distance. Pas de surbrillance sur la carte.
 */
export default function KilometerSplitsTable({ splits, speedUnit, distanceUnit }: {
  splits: readonly KilometerSplit[];
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
}) {
  const [open, setOpen] = useState(false);
  if (splits.length === 0) return null;
  const symbol = DISTANCE_UNIT_SYMBOL[distanceUnit];
  const withMoving = splits.some((s) => s.movingS !== null && s.durationS - s.movingS >= 1);
  const withElevation = splits.some((s) => s.gainM !== null);
  const withHr = splits.some((s) => s.heartRateBpm !== null);
  return (
    <div className="ui-stack-8 ui-mt-12">
      <ChartFold label={distanceUnit === 'nm' ? 'Par mille' : 'Par kilomètre'} open={open} onToggle={() => setOpen(!open)} />
      {open && (
        <div className="an-man-scroll">
          <table className="ui-table">
            <thead>
              <tr className="ui-sunken">
                <th style={{ ...CELL, textAlign: 'left' }}>{symbol}</th>
                <th style={CELL}>Temps</th>
                {withMoving && <th style={CELL}>En mouvement</th>}
                <th style={CELL}>{speedUnit === 'minkm' ? 'Allure' : 'Vitesse'} ({speedUnitLabel(speedUnit, distanceUnit)})</th>
                {withElevation && <th style={CELL}>D+ / D-</th>}
                {withHr && <th style={CELL}>FC</th>}
              </tr>
            </thead>
            <tbody>
              {splits.map((s) => (
                <tr key={s.rank} className="ui-table__row">
                  <td style={{ ...CELL, textAlign: 'left', fontWeight: 700 }}>
                    {s.partial ? `${formatDecimal(toDisplayDistance(s.distanceM, distanceUnit), 1)} ${symbol}` : s.rank}
                  </td>
                  <td style={CELL}>{formatShortDuration(s.durationS)}</td>
                  {withMoving && <td style={CELL}>{s.movingS === null ? '—' : formatShortDuration(s.movingS)}</td>}
                  <td style={{ ...CELL, fontWeight: 700 }}>{s.speedMs > 0 ? formatSpeedValue(toDisplaySpeed(s.speedMs, speedUnit, distanceUnit), speedUnit) : '—'}</td>
                  {withElevation && (
                    <td style={CELL}>{s.gainM === null || s.lossM === null ? '—' : `+${Math.round(s.gainM)} / -${Math.round(s.lossM)} m`}</td>
                  )}
                  {withHr && <td style={CELL}>{s.heartRateBpm === null ? '—' : `${Math.round(s.heartRateBpm)} bpm`}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
