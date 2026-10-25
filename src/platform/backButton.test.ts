import { describe, expect, it, vi } from 'vitest';
import { dispatchBack, pushBackLayer, setBackNavigator } from './backButton';

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
