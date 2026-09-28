import { useCallback, useEffect, useState } from 'react';
import { TILE_CACHE_DEFAULTS, tileCacheUsage, tilesToEvict, type TileCacheUsage } from '../core/tiles';
import { jsonStore } from '../platform/storage';
import { tileStore } from '../platform/tileCache';

/**
 * Cartes sans réseau : plafond de la place occupée par les tuiles gardées,
 * propre à l'appareil (clé `tracker.tileCache`, hors de `reglages.json`), et
 * contrôle de ce plafond au fil des tuiles gardées.
 */

const STORAGE_KEY = 'tracker.tileCache';
const MIN_CAP_MB = 10;
const MAX_CAP_MB = 20_000;

interface TileCacheSettings {
  capMb?: number;
}

const isValidCap = (value: unknown): value is number =>
  typeof value === 'number' && isFinite(value) && value >= MIN_CAP_MB && value <= MAX_CAP_MB;

export const tileCapMb = (): number => {
  const value = jsonStore.read<TileCacheSettings>(STORAGE_KEY)?.capMb;
  return isValidCap(value) ? value : TILE_CACHE_DEFAULTS.capMb;
};

const evictTiles = async (): Promise<void> => {
  const keys = tilesToEvict(await tileStore.list(), tileCapMb() * 1e6);
  if (keys.length > 0) await tileStore.remove(keys);
};

let lastEvictMs = 0;

/** À appeler après chaque tuile gardée : contrôle le plafond, au plus une fois par intervalle. */
export const noteTileSaved = (): void => {
  const now = Date.now();
  if (now - lastEvictMs < TILE_CACHE_DEFAULTS.evictIntervalMs) return;
  lastEvictMs = now;
  void evictTiles();
};

/** Place occupée, plafond et vidage, pour la page Réglages. */
export const useTileCache = () => {
  const [usage, setUsage] = useState<TileCacheUsage | null>(null);
  const [capMb, setCapMbState] = useState(tileCapMb);
  /** Incrémenté après chaque changement : la place occupée est recomptée. */
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    void tileStore.list().then((entries) => {
      if (!cancelled) setUsage(tileCacheUsage(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  /** `null` revient au défaut. Un plafond abaissé efface aussitôt les plus anciennes. */
  const setCapMb = useCallback(async (next: number | null) => {
    if (next !== null && !isValidCap(next)) return;
    jsonStore.write(STORAGE_KEY, next === null ? {} : { capMb: next });
    setCapMbState(tileCapMb());
    await evictTiles();
    refresh();
  }, [refresh]);

  const clear = useCallback(async () => {
    await tileStore.clear();
    refresh();
  }, [refresh]);

  return { usage, capMb, setCapMb, clear };
};
