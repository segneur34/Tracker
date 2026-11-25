import { afterEach, describe, expect, it, vi } from 'vitest';
import { onDesktopClose } from './desktopBridge';

/** Le pont du programme Windows posé sur la page, avec ce que `extra` y ajoute. */
const shell = (extra: Record<string, unknown>) =>
  vi.stubGlobal('window', { trackerBureau: { version: '0.0.0', memoire: { ouvrir: async () => null }, ...extra } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fermeture du programme Windows, vue de la page (lot 232)', () => {
  it('pose la tâche à attendre ; son échec ne remonte pas à la coquille', async () => {
    let rappel: (() => Promise<void>) | null = null;
    shell({ surFermeture: (r: () => Promise<void>) => { rappel = r; } });
    const task = vi.fn(async () => Promise.reject(new Error('disque plein')));
    onDesktopClose(task);
    expect(rappel).not.toBeNull();
    await expect(rappel!()).resolves.toBeUndefined();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('sans effet hors du programme Windows et dans une coquille plus ancienne', () => {
    const task = vi.fn(async () => undefined);
    expect(() => onDesktopClose(task)).not.toThrow();
    shell({});
    expect(() => onDesktopClose(task)).not.toThrow();
    expect(task).not.toHaveBeenCalled();
  });
});
