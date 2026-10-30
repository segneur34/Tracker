import { describe, expect, it } from 'vitest';
import { createHistoryGuard } from './leaveGuard';

/**
 * Historique de navigateur minimal : une pile d'entrées, `back()` qui
 * recule puis prévient (`popstate`) à la demande, comme le navigateur le fait
 * un peu plus tard.
 */
const makeBrowser = (answers: boolean[]) => {
  const entries: Array<{ href: string; guard: boolean }> = [{ href: '/a', guard: false }, { href: '/s', guard: false }];
  let at = 1;
  let queued = 0;
  const asked: number[] = [];
  const guard = createHistoryGuard(
    {
      pushGuard: () => {
        entries.splice(at + 1);
        entries.push({ href: entries[at].href, guard: true });
        at += 1;
      },
      back: () => {
        queued += 1;
      },
      onGuard: () => entries[at].guard,
      href: () => entries[at].href,
    },
    () => {
      asked.push(at);
      return answers.shift() ?? false;
    }
  );
  /** Le navigateur exécute les retours demandés, chacun suivi de son `popstate`. */
  const flush = () => {
    while (queued > 0) {
      queued -= 1;
      if (at > 0) at -= 1;
      guard.popstate();
    }
  };
  return {
    guard,
    asked,
    flush,
    /** Bouton « précédent » de l'utilisateur. */
    userBack: () => {
      queued += 1;
      flush();
    },
    /** Navigation du routeur (lien) : une nouvelle entrée sans marque. */
    navigate: (href: string) => {
      entries.splice(at + 1);
      entries.push({ href, guard: false });
      at += 1;
    },
    here: () => ({ ...entries[at], at, length: entries.length }),
  };
};

describe('createHistoryGuard', () => {
  it('pose une seule entrée garde, même armée deux fois', () => {
    const b = makeBrowser([]);
    b.guard.arm();
    b.guard.arm();
    expect(b.here()).toEqual({ href: '/s', guard: true, at: 2, length: 3 });
  });

  it('retour refusé : on reste sur la page, la garde est remise', () => {
    const b = makeBrowser([false, false]);
    b.guard.arm();
    b.userBack();
    expect(b.here()).toEqual({ href: '/s', guard: true, at: 2, length: 3 });
    b.userBack();
    expect(b.asked).toHaveLength(2);
    expect(b.here().href).toBe('/s');
  });

  it('retour accepté : on part vraiment, une entrée de plus en arrière', () => {
    const b = makeBrowser([true]);
    b.guard.arm();
    b.userBack();
    expect(b.here().href).toBe('/a');
    expect(b.here().guard).toBe(false);
    // L'avertissement levé après coup ne touche plus à l'historique.
    b.guard.disarm();
    b.flush();
    expect(b.here().href).toBe('/a');
  });

  it('levée propre (Enregistrer, Annuler) : la garde est retirée sans question', () => {
    const b = makeBrowser([]);
    b.guard.arm();
    b.guard.disarm();
    b.flush();
    expect(b.here()).toEqual({ href: '/s', guard: false, at: 1, length: 3 });
    expect(b.asked).toHaveLength(0);
    // Un retour ensuite part sans demander.
    b.userBack();
    expect(b.here().href).toBe('/a');
    expect(b.asked).toHaveLength(0);
  });

  it('levée puis reposée avant le retrait : la garde est remise en tête', () => {
    const b = makeBrowser([false]);
    b.guard.arm();
    b.guard.disarm();
    b.guard.arm();
    b.flush();
    expect(b.here()).toEqual({ href: '/s', guard: true, at: 2, length: 3 });
    b.userBack();
    expect(b.asked).toHaveLength(1);
    expect(b.here().href).toBe('/s');
  });

  it('levée puis reposée après le retrait : une garde, pas deux', () => {
    const b = makeBrowser([]);
    b.guard.arm();
    b.guard.disarm();
    b.flush();
    b.guard.arm();
    expect(b.here()).toEqual({ href: '/s', guard: true, at: 2, length: 3 });
  });

  it('départ par un lien : la garde reste dessous et se traverse sans question au retour', () => {
    const b = makeBrowser([]);
    b.guard.arm();
    b.navigate('/liste');
    b.guard.disarm();
    b.flush();
    expect(b.here()).toEqual({ href: '/liste', guard: false, at: 3, length: 4 });
    b.userBack();
    expect(b.here()).toEqual({ href: '/s', guard: false, at: 1, length: 4 });
    expect(b.asked).toHaveLength(0);
  });

  it('un popstate sans garde posée ne fait rien', () => {
    const b = makeBrowser([]);
    b.userBack();
    expect(b.here().href).toBe('/a');
    expect(b.asked).toHaveLength(0);
  });
});
