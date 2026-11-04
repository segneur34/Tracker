import { describe, expect, it } from 'vitest';
import { CHART_ZOOM_MIN_FRACTION } from '../core/displayConfig';
import { chartZoomSource, createChartZoomStore, currentZoomView } from './useChartZoom';

const FULL = { min: 0, max: 100 };

/** Source sur un magasin neuf, avec le nombre de notifications reçues. */
const sourceWithCount = (full = FULL, key: unknown = 'a') => {
  const store = createChartZoomStore();
  const source = chartZoomSource(store, full, key);
  let notified = 0;
  source.subscribe(() => notified++);
  return { store, source, notified: () => notified };
};

describe('zoom hors du module (lot 127)', () => {
  it('set : plage bornée à l\'étendue et à la largeur minimale', () => {
    const { source } = sourceWithCount();
    expect(source.minSpan).toBe(100 * CHART_ZOOM_MIN_FRACTION);
    source.set({ min: 90, max: 130 });
    expect(source.get()).toEqual({ min: 60, max: 100 });
    source.set({ min: 50, max: 50 });
    expect(source.get()!.max - source.get()!.min).toBeCloseTo(source.minSpan, 9);
    expect(source.get()!.min + source.get()!.max).toBeCloseTo(100, 9);
    // Plage qui couvre tout : tout voir.
    source.set({ min: -5, max: 120 });
    expect(source.get()).toBeNull();
    expect(currentZoomView(source)).toBeNull();
  });

  it('aucune notification pour une plage identique, une par changement', () => {
    const { source, notified } = sourceWithCount();
    source.set({ min: 10, max: 20 });
    const first = source.get();
    expect(notified()).toBe(1);
    source.set({ min: 10, max: 20 });
    expect(notified()).toBe(1);
    // Même instantané : `useSyncExternalStore` ne redessine rien.
    expect(source.get()).toBe(first);
    source.set({ min: 10, max: 25 });
    expect(notified()).toBe(2);
  });

  it('reset notifie une fois', () => {
    const { source, notified } = sourceWithCount();
    source.set({ min: 10, max: 20 });
    source.reset();
    source.reset();
    expect(notified()).toBe(2);
    expect(source.get()).toBeNull();
  });

  it('deux magasins indépendants : zoomer l\'un ne touche pas l\'autre', () => {
    const a = sourceWithCount();
    const b = sourceWithCount();
    a.source.set({ min: 10, max: 20 });
    expect(b.source.get()).toBeNull();
    expect(b.notified()).toBe(0);
  });

  it('autre session : tout voir, la plage de la précédente ne se lit plus', () => {
    const { store, source } = sourceWithCount(FULL, 'a');
    source.set({ min: 10, max: 20 });
    const next = chartZoomSource(store, FULL, 'b');
    expect(next.get()).toBeNull();
    next.set({ min: 30, max: 40 });
    expect(source.get()).toBeNull();
    expect(next.get()).toEqual({ min: 30, max: 40 });
  });

  it('étendue changée : la plage affichée reste dedans ; sans étendue, rien à zoomer', () => {
    const { store, source } = sourceWithCount();
    source.set({ min: 70, max: 90 });
    const shrunk = chartZoomSource(store, { min: 0, max: 80 }, 'a');
    expect(currentZoomView(shrunk)).toEqual({ min: 60, max: 80 });
    const empty = chartZoomSource(createChartZoomStore(), null, 'a');
    empty.set({ min: 1, max: 2 });
    expect(empty.get()).toBeNull();
    expect(empty.minSpan).toBe(0);
  });
});
