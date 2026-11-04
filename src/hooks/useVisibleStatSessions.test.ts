import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from '../core/activities';
import type { LibrarySession } from '../library/record';
import { statsMetric } from '../library/stats';
import { sessionRecord } from '../test/record.fixture';

/** Foil des Statistiques (et donc « % de vol » en voile) : une seule lecture, `sessionFoil`. */

const stored = new Map<string, string>();

beforeEach(() => {
  stored.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => stored.set(k, v),
    removeItem: (k: string) => stored.delete(k),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const wing: Activity = { id: 'wingfoil', name: 'Voile', base: 'wingfoil', color: '#000' };
const surf: Activity = { id: 'surf', name: 'Surf', base: 'surf', color: '#000' };

const session = (record: LibrarySession['record']): LibrarySession => ({ file: record.gpx, record, readOnly: false, warning: null });

const convert = async (activities: Activity[], sessions: LibrarySession[], foils: Record<string, boolean>) => {
  stored.set('tracker.sportSettings', JSON.stringify({ foils }));
  vi.resetModules();
  const { visibleStatSessions } = await import('./useVisibleStatSessions');
  return visibleStatSessions(sessions, activities, () => true).all;
};

describe('foil des Statistiques', () => {
  it('surf : le foil porté par la fiche, pas celui de cet appareil', async () => {
    const carried = sessionRecord({ sport: 'surf', activityId: 'surf' }, { activitySettings: { threshold: null, foil: false } });
    const [one] = await convert([surf], [session(carried)], { surf: true });
    expect(one.foil).toBe(false);
  });

  it('surf, ancienne fiche : le foil de son empreinte ; le sien avant tout', async () => {
    const old = sessionRecord({ sport: 'surf', activityId: 'surf' }, { optionsKey: JSON.stringify([null, null, true, null]) });
    expect((await convert([surf], [session(old)], { surf: false }))[0].foil).toBe(true);
    const own = { ...old, analysis: { ...sessionRecord().analysis, foil: false } as never };
    expect((await convert([surf], [session(own)], { surf: true }))[0].foil).toBe(false);
  });

  it('% de vol en voile : 50 % sur foil, rien sinon', async () => {
    const record = sessionRecord({ sport: 'wingfoil', activityId: 'wingfoil' }, { movingTimeS: 1800, inMotionS: 3600 });
    const vol = statsMetric('vol');
    const valueOf = (all: Awaited<ReturnType<typeof convert>>) => vol.series[0].value(all[0]);
    expect(valueOf(await convert([wing], [session(record)], { wingfoil: true }))).toBe(50);
    expect(valueOf(await convert([wing], [session(record)], { wingfoil: false }))).toBeNull();
  });
});
