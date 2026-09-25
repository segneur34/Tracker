import { useEffect, useState } from 'react';
import { watchCompassHeading } from '../platform/compass';

/**
 * Cap de la boussole, arrondi au degré, tant que `active` ; `null` sans
 * boussole ou avant sa première mesure.
 */
export const useCompassHeading = (active: boolean): number | null => {
  const [heading, setHeading] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const stop = watchCompassHeading((deg) => setHeading(Math.round(deg) % 360));
    return () => {
      stop();
      setHeading(null);
    };
  }, [active]);
  return active ? heading : null;
};
