import { useEffect, useState } from 'react';
import { watchSatellites, type SatelliteCount } from '../platform/location';

/**
 * Satellites du GPS, suivis tant que `active` (enregistrement en cours, GPS
 * allumé) ; `null` avant le premier état reçu, au repos et dans le navigateur.
 */
export function useSatellites(active: boolean): SatelliteCount | null {
  const [count, setCount] = useState<SatelliteCount | null>(null);
  useEffect(() => {
    if (!active) return undefined;
    const stop = watchSatellites(setCount);
    return () => {
      stop();
      setCount(null);
    };
  }, [active]);
  return count;
}
