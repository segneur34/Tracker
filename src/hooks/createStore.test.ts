import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createListeners, createStore, createTickingStore } from './createStore';

describe('createListeners', () => {
  it('prévient les abonnés et ne prévient plus un désabonné', () => {
    const listeners = createListeners();
    const a = vi.fn();
    const b = vi.fn();
    const offA = listeners.subscribe(a);
    listeners.subscribe(b);
    listeners.notify();
    offA();
    listeners.notify();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    expect(listeners.size()).toBe(1);
  });
});

describe('createStore', () => {
  it('rend l\'état, le remplace et le fusionne en prévenant', () => {
    const store = createStore({ n: 1, label: 'a' });
    const listener = vi.fn();
    store.subscribe(listener);
    store.patch({ n: 2 });
    expect(store.get()).toEqual({ n: 2, label: 'a' });
    store.set({ n: 3, label: 'b' });
    expect(store.get()).toEqual({ n: 3, label: 'b' });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('createTickingStore', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = () => {
    let count = 0;
    let running = false;
    const store = createTickingStore({
      initial: { count: 0, running: false },
      compute: () => ({ count: ++count, running }),
      isRunning: (view) => view.running,
      hasWork: () => running,
      intervalMs: 100,
    });
    return { store, start: () => { running = true; store.publish(); } };
  };

  it('ne bat que si une page regarde un état qui avance', () => {
    const { store, start } = make();
    start();
    expect(store.get().count).toBe(1);
    vi.advanceTimersByTime(500);
    expect(store.get().count).toBe(1);
    const off = store.subscribe(() => undefined);
    vi.advanceTimersByTime(300);
    expect(store.get().count).toBeGreaterThanOrEqual(4);
    off();
    const frozen = store.get().count;
    vi.advanceTimersByTime(500);
    expect(store.get().count).toBe(frozen);
  });

  it('rafraîchit la vue d\'une page qui arrive', async () => {
    const { store, start } = make();
    start();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    await Promise.resolve();
    expect(listener).toHaveBeenCalled();
    off();
  });
});
