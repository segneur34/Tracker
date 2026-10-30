import { useCallback, useEffect, useState } from 'react';
import { tileCacheUsageByBase } from '../core/mapBase';
import { tileCacheUsage, type TileCacheUsage } from '../core/tiles';
import { evictTiles, isValidTileCap, tileCapMb, tileStore, writeTileCapMb } from '../platform/tileCache';

/**
 * Cartes sans réseau, pour la page Réglages : place occupée par les tuiles
 * gardées, plafond propre à l'appareil (`platform/tileCache.ts`, qui le
 * contrôle au fil des tuiles gardées) et vidage.
 */

/** Place occupée, plafond et vidage, pour la page Réglages. */
export const useTileCache = () => {
  const [usage, setUsage] = useState<TileCacheUsage | null>(null);
  /** Part du fond satellite, dont les photos pèsent plus que le plan. */
  const [satellite, setSatellite] = useState<TileCacheUsage | null>(null);
  const [capMb, setCapMbState] = useState(tileCapMb);
  /** Incrémenté après chaque changement : la place occupée est recomptée. */
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    void tileStore.list().then((entries) => {
      if (cancelled) return;
      setUsage(tileCacheUsage(entries));
      setSatellite(tileCacheUsageByBase(entries).satellite);
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  /** `null` revient au défaut. Un plafond abaissé efface aussitôt les plus anciennes. */
  const setCapMb = useCallback(async (next: number | null) => {
    if (next !== null && !isValidTileCap(next)) return;
    writeTileCapMb(next);
    setCapMbState(tileCapMb());
    await evictTiles();
    refresh();
  }, [refresh]);

  const clear = useCallback(async () => {
    await tileStore.clear();
    refresh();
  }, [refresh]);

  return { usage, satellite, capMb, setCapMb, clear };
};
