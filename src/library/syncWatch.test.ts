import { describe, expect, it, vi } from 'vitest';
import { markerText } from './folderLayout';
import { markerTextWithSync } from './syncBase';
import { SYNC_MARKER_POLL_MS, createSyncMarkerWatch, pollWhileVisible, type VisibilitySource } from './syncWatch';

const synced = (atMs: number): string => markerTextWithSync(markerText(), atMs) as string;
const reading = (text: string | null) => () => Promise.resolve(text);

/** Page factice : sa visibilité se change à la main, et chaque changement prévient les abonnés. */
const fakePage = (initial: boolean): VisibilitySource & { set(visible: boolean): void; listeners(): number } => {
  let visible = initial;
  const listeners = new Set<() => void>();
  return {
    visible: () => visible,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      visible = next;
      for (const listener of listeners) listener();
    },
    listeners: () => listeners.size,
  };
};

describe('guet du marqueur au retour au premier plan', () => {
  it('relecture lancée une fois quand l’instant change, jamais sinon', async () => {
    const refresh = vi.fn(() => Promise.resolve());
    const watch = createSyncMarkerWatch(refresh);
    watch.note('dossier', markerText());
    expect(await watch.check('dossier', reading(markerText()))).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    expect(await watch.check('dossier', reading(synced(1000)))).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    // Retours suivants sans synchronisation : rien.
    expect(await watch.check('dossier', reading(synced(1000)))).toBe(false);
    expect(await watch.check('dossier', reading(synced(1000)))).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
    // Synchronisation suivante : une fois de plus.
    expect(await watch.check('dossier', reading(synced(2000)))).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('une relecture voulue retient l’instant : le retour suivant ne relit pas', async () => {
    const refresh = vi.fn(() => Promise.resolve());
    const watch = createSyncMarkerWatch(refresh);
    watch.note('dossier', markerText());
    watch.note('dossier', synced(1000));
    expect(await watch.check('dossier', reading(synced(1000)))).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('marqueur absent, sans instant ou illisible : rien, et l’instant retenu ne bouge pas', async () => {
    const refresh = vi.fn(() => Promise.resolve());
    const watch = createSyncMarkerWatch(refresh);
    watch.note('dossier', synced(1000));
    expect(await watch.check('dossier', reading(null))).toBe(false);
    expect(await watch.check('dossier', reading('{abîmé'))).toBe(false);
    expect(await watch.check('dossier', () => Promise.reject(new Error('illisible')))).toBe(false);
    expect(await watch.check('dossier', reading(synced(1000)))).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('premier regard sur un autre dossier : retenu sans relecture', async () => {
    const refresh = vi.fn(() => Promise.resolve());
    const watch = createSyncMarkerWatch(refresh);
    watch.note('ancien', synced(1000));
    expect(await watch.check('neuf', reading(synced(5000)))).toBe(false);
    expect(await watch.check('neuf', reading(synced(5000)))).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('deux retours rapprochés ne lancent qu’une relecture', async () => {
    const refresh = vi.fn(() => Promise.resolve());
    const watch = createSyncMarkerWatch(refresh);
    watch.note('dossier', markerText());
    const results = await Promise.all([watch.check('dossier', reading(synced(1000))), watch.check('dossier', reading(synced(1000)))]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('page visible : la relecture lente voit la synchronisation sans passage par l’arrière-plan, puis plus rien', async () => {
    vi.useFakeTimers();
    try {
      const refresh = vi.fn(() => Promise.resolve());
      const watch = createSyncMarkerWatch(refresh);
      let marker = markerText();
      watch.note('dossier', marker);
      const page = fakePage(true);
      const stop = pollWhileVisible(() => void watch.check('dossier', () => Promise.resolve(marker)), page);
      await vi.advanceTimersByTimeAsync(SYNC_MARKER_POLL_MS * 3);
      expect(refresh).not.toHaveBeenCalled();
      marker = synced(1000);
      await vi.advanceTimersByTimeAsync(SYNC_MARKER_POLL_MS);
      expect(refresh).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(SYNC_MARKER_POLL_MS * 5);
      expect(refresh).toHaveBeenCalledTimes(1);
      stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('page cachée : aucune lecture ; jamais deux minuteries ; une lecture qui échoue est retentée au tour suivant', async () => {
    vi.useFakeTimers();
    try {
      let fails = true;
      const read = vi.fn(() => (fails ? Promise.reject(new Error('illisible')) : Promise.resolve(synced(1000))));
      const refresh = vi.fn(() => Promise.resolve());
      const watch = createSyncMarkerWatch(refresh);
      watch.note('dossier', markerText());
      const page = fakePage(false);
      const stop = pollWhileVisible(() => void watch.check('dossier', read), page);
      await vi.advanceTimersByTimeAsync(SYNC_MARKER_POLL_MS * 4);
      expect(read).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      page.set(true);
      page.set(true);
      page.set(true);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(SYNC_MARKER_POLL_MS);
      expect(read).toHaveBeenCalledTimes(1);
      expect(refresh).not.toHaveBeenCalled();
      fails = false;
      await vi.advanceTimersByTimeAsync(SYNC_MARKER_POLL_MS);
      expect(refresh).toHaveBeenCalledTimes(1);
      page.set(false);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(SYNC_MARKER_POLL_MS * 4);
      expect(read).toHaveBeenCalledTimes(2);
      stop();
      expect(page.listeners()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('une relecture qui échoue ne lève pas', async () => {
    const watch = createSyncMarkerWatch(() => Promise.reject(new Error('dossier perdu')));
    watch.note('dossier', markerText());
    expect(await watch.check('dossier', reading(synced(1000)))).toBe(true);
  });
});
