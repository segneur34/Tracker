import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_JOURNAL_LINE_MAX, desktopJournalAvailable, noteJournal, onDesktopClose } from './desktopBridge';

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

describe('journal du programme Windows, vu de la page', () => {
  it('sans effet hors du programme Windows et dans une coquille sans journal', () => {
    expect(desktopJournalAvailable()).toBe(false);
    expect(() => noteJournal('synchronisation : départ')).not.toThrow();
    shell({});
    expect(desktopJournalAvailable()).toBe(false);
    expect(() => noteJournal('synchronisation : départ')).not.toThrow();
  });

  it('envoie la ligne à la coquille, sans les blancs autour, coupée à 300 caractères, jamais vide', () => {
    const recues: unknown[] = [];
    shell({ noter: async (argument: unknown) => (recues.push(argument), { ok: true, valeur: null }) });
    expect(desktopJournalAvailable()).toBe(true);
    noteJournal('  attente du téléphone  ');
    noteJournal('   ');
    noteJournal('é'.repeat(DESKTOP_JOURNAL_LINE_MAX + 20));
    expect(recues).toEqual([{ texte: 'attente du téléphone' }, { texte: 'é'.repeat(DESKTOP_JOURNAL_LINE_MAX) }]);
  });

  it('ne laisse passer ni un refus ni une panne du pont', async () => {
    shell({ noter: async () => Promise.reject(new Error('fenêtre fermée')) });
    expect(() => noteJournal('a')).not.toThrow();
    shell({
      noter: () => {
        throw new Error('pont refermé');
      },
    });
    expect(() => noteJournal('b')).not.toThrow();
    // La promesse rejetée du premier appel est avalée : rien ne remonte comme rejet non traité.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
