import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resume = vi.hoisted(() => ({ listeners: new Set<() => void>() }));

vi.mock('./permissions', () => ({
  onAppResume: (listener: () => void) => {
    resume.listeners.add(listener);
    return () => resume.listeners.delete(listener);
  },
}));

import { isForeground, onForeground } from './screen';

/** Page factice : son état, et le changement qui prévient ses écouteurs. */
const stubPage = (initial: DocumentVisibilityState = 'visible') => {
  const listeners = new Set<() => void>();
  const page = {
    visibilityState: initial,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal('document', page);
  return {
    listeners,
    set: (state: DocumentVisibilityState) => {
      page.visibilityState = state;
      listeners.forEach((listener) => listener());
    },
  };
};

const fireResume = () => resume.listeners.forEach((listener) => listener());

describe('retour au premier plan', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resume.listeners.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('prévient quand la page redevient visible, pas quand elle se cache', () => {
    const page = stubPage();
    const listener = vi.fn();
    onForeground(listener);
    page.set('hidden');
    expect(listener).not.toHaveBeenCalled();
    expect(isForeground()).toBe(false);
    page.set('visible');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(isForeground()).toBe(true);
  });

  it('prévient au signal du système, sans changement de la page', () => {
    stubPage();
    const listener = vi.fn();
    onForeground(listener);
    fireResume();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('un même retour, signalé deux fois, ne prévient qu’une fois', () => {
    const page = stubPage('hidden');
    const listener = vi.fn();
    onForeground(listener);
    page.set('visible');
    fireResume();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('un signal du système reçu page encore cachée attend la page', () => {
    const page = stubPage('hidden');
    const listener = vi.fn();
    onForeground(listener);
    fireResume();
    expect(listener).not.toHaveBeenCalled();
    page.set('visible');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('deux retours distincts préviennent deux fois', () => {
    const page = stubPage();
    const listener = vi.fn();
    onForeground(listener);
    page.set('hidden');
    page.set('visible');
    vi.advanceTimersByTime(5000);
    page.set('hidden');
    page.set('visible');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('le désabonnement retire les deux écoutes', () => {
    const page = stubPage();
    const listener = vi.fn();
    const stop = onForeground(listener);
    stop();
    expect(page.listeners.size).toBe(0);
    expect(resume.listeners.size).toBe(0);
    page.set('hidden');
    page.set('visible');
    fireResume();
    expect(listener).not.toHaveBeenCalled();
  });

  it('sans page, sans effet', () => {
    const listener = vi.fn();
    const stop = onForeground(listener);
    expect(resume.listeners.size).toBe(0);
    stop();
    expect(listener).not.toHaveBeenCalled();
  });
});
