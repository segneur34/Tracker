import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXIT_FLUSH_MAX_MS, dispatchBack, exitAfter, pushBackLayer, setBackNavigator } from './backButton';

describe('exitAfter (lot 232)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ferme une fois les écritures vidées, sans attendre le plafond', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    let finish: () => void = () => undefined;
    const beforeExit = vi.fn(() => new Promise<void>((resolve) => {
      finish = () => {
        order.push('écrit');
        resolve();
      };
    }));
    const exit = vi.fn(() => order.push('fermé'));
    const done = exitAfter(beforeExit, exit);
    await vi.advanceTimersByTimeAsync(500);
    expect(exit).not.toHaveBeenCalled();
    finish();
    await done;
    expect(order).toEqual(['écrit', 'fermé']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ferme quand même au plafond si les écritures ne finissent pas, ou échouent', async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const done = exitAfter(() => new Promise<void>(() => undefined), exit);
    await vi.advanceTimersByTimeAsync(EXIT_FLUSH_MAX_MS - 1);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(exit).toHaveBeenCalledTimes(1);

    await exitAfter(() => Promise.reject(new Error('disque plein')), exit);
    expect(exit).toHaveBeenCalledTimes(2);
  });

  it('une seconde touche retour pendant l\'attente ne ferme pas deux fois ; sans tâche, ferme aussitôt', async () => {
    let finish: () => void = () => undefined;
    const exit = vi.fn();
    const first = exitAfter(() => new Promise<void>((resolve) => { finish = resolve; }), exit);
    await exitAfter(async () => undefined, exit);
    finish();
    await first;
    expect(exit).toHaveBeenCalledTimes(1);
    await exitAfter(undefined, exit);
    expect(exit).toHaveBeenCalledTimes(2);
  });
});

describe('dispatchBack', () => {
  it('ferme la vue du dessus avant la page, sans demander pour le brouillon', () => {
    const navigate = vi.fn(() => true);
    const removeNavigator = setBackNavigator(navigate);
    const closeA = vi.fn();
    const closeB = vi.fn();
    pushBackLayer(closeA);
    pushBackLayer(closeB);
    const canLeave = vi.fn(() => false);

    expect(dispatchBack(canLeave)).toBe('layer');
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(closeA).not.toHaveBeenCalled();
    expect(dispatchBack(canLeave)).toBe('layer');
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(canLeave).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();

    expect(dispatchBack(canLeave)).toBe('held');
    expect(dispatchBack(() => true)).toBe('page');
    expect(navigate).toHaveBeenCalledTimes(1);
    removeNavigator();
    expect(dispatchBack()).toBe('none');
  });

  it('oublie une vue retirée (fermée autrement)', () => {
    const close = vi.fn();
    const remove = pushBackLayer(close);
    remove();
    expect(dispatchBack()).toBe('none');
    expect(close).not.toHaveBeenCalled();
  });
});
