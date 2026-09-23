import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReplaySource, type LocationFix } from './location';

const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
const OPTIONS = { intervalMs: 1000, distanceFilterM: 0, notificationTitle: '', notificationText: '' };
const track: LocationFix[] = [0, 1, 2, 5, 10].map((s) => ({ timeMs: T0 + s * 1000, lat: 43, lon: 3 }));

describe('createReplaySource', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('émet chaque position à son heure, divisée par le facteur, avec l\'heure d\'origine', async () => {
    const received: number[] = [];
    await createReplaySource(track, 10).start(OPTIONS, (f) => received.push(f.timeMs), () => {});

    expect(received).toEqual([T0]);
    await vi.advanceTimersByTimeAsync(200);
    expect(received).toEqual([T0, T0 + 1000, T0 + 2000]);
    await vi.advanceTimersByTimeAsync(900);
    expect(received).toHaveLength(5);
    expect(received[4]).toBe(T0 + 10_000);
  });

  it('n\'émet plus rien une fois arrêté', async () => {
    const received: number[] = [];
    const stop = await createReplaySource(track, 1).start(OPTIONS, (f) => received.push(f.timeMs), () => {});
    await vi.advanceTimersByTimeAsync(1500);
    await stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(received).toEqual([T0, T0 + 1000]);
  });

  it('rattrape d\'un coup les positions échues quand la minuterie prend du retard', async () => {
    const received: number[] = [];
    await createReplaySource(track, 1).start(OPTIONS, (f) => received.push(f.timeMs), () => {});
    // Horloge avancée sans laisser tourner les minuteries, comme un onglet mis en sommeil.
    vi.setSystemTime(Date.now() + 6000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(received).toEqual([T0, T0 + 1000, T0 + 2000, T0 + 5000]);
  });
});
