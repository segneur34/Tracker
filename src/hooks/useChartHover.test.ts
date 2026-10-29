import { describe, expect, it } from 'vitest';
import { createHoverStore, getHoveredIndex, setHoveredIndex } from './useChartHover';

describe('createHoverStore', () => {
  it('prévient ses abonnés quand la valeur change, et seulement alors', () => {
    const store = createHoverStore<{ t: number }>();
    const row = { t: 1 };
    let calls = 0;
    const off = store.subscribe(() => {
      calls += 1;
    });
    store.set(row);
    store.set(row);
    expect(store.get()).toBe(row);
    expect(calls).toBe(1);
    store.set(null);
    expect(calls).toBe(2);
    off();
    store.set(row);
    expect(calls).toBe(2);
  });

  it('deux magasins ne se mêlent pas, ni au point de trace commun', () => {
    const a = createHoverStore<number>();
    const b = createHoverStore<number>();
    setHoveredIndex(null);
    a.set(3);
    expect(b.get()).toBeNull();
    expect(getHoveredIndex()).toBeNull();
    setHoveredIndex(7);
    expect(a.get()).toBe(3);
    expect(getHoveredIndex()).toBe(7);
    setHoveredIndex(null);
  });
});
