import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Veille de la ceinture dans le navigateur : muette pour la FC de nuit (lot 213), l'alerte écrite gardée. */

vi.mock('./runtime', () => ({ isNativeApp: () => false }));

const { armBeltWatch, disarmBeltWatch, onBeltLost } = await import('./beeper');

describe('veille de la ceinture', () => {
  let vibrate: ReturnType<typeof vi.fn>;
  /** Lignes consignées par `console.debug`. */
  let logged: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    logged = [];
    vi.spyOn(console, 'debug').mockImplementation((line: unknown) => { logged.push(String(line)); });
  });

  afterEach(async () => {
    await disarmBeltWatch();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const bipLines = () => logged.filter((line) => line.startsWith('[bips]'));

  it('ordinaire : son et vibration à l’échéance, puis les abonnés', async () => {
    const lost = vi.fn();
    const off = onBeltLost(lost);
    await armBeltWatch(60_000);
    vi.advanceTimersByTime(59_999);
    expect(lost).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(bipLines()).toHaveLength(1);
    off();
  });

  it('muette : ni son ni vibration, mais les abonnés sont prévenus (alerte de la page, notification)', async () => {
    const lost = vi.fn();
    const off = onBeltLost(lost);
    await armBeltWatch(60_000, { silent: true });
    vi.advanceTimersByTime(60_000);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(vibrate).not.toHaveBeenCalled();
    expect(bipLines()).toEqual([]);
    off();
  });
});
