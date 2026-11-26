import { describe, expect, it } from 'vitest';
import { createLatestRequest, type LatestOutcome } from './latestRequest';

/** La dernière demande gagne (lot 235), sur un calcul dont chaque réponse est rendue à la main. */

interface Deferred {
  input: number;
  resolve(value: string): void;
  reject(error: Error): void;
}

const manual = () => {
  const calls: Deferred[] = [];
  const compute = (input: number) => new Promise<string>((resolve, reject) => {
    calls.push({ input, resolve, reject });
  });
  return { calls, latest: createLatestRequest(compute) };
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('createLatestRequest', () => {
  it('trois demandes rapides : la première et la dernière calculées, seule la dernière rendue comme bonne', async () => {
    const { calls, latest } = manual();
    const outcomes: LatestOutcome<string>[] = [];
    const first = latest.run(1).then((o) => outcomes.push(o));
    const second = latest.run(2).then((o) => outcomes.push(o));
    const third = latest.run(3);
    await flush();
    // La deuxième, remplacée en attente, est rendue dépassée sans calcul.
    expect(calls.map((c) => c.input)).toEqual([1]);
    await second;
    expect(outcomes).toEqual([{ current: false }]);
    calls[0].resolve('un');
    await first;
    // La première revient alors qu'une plus récente existe : dépassée elle aussi.
    expect(outcomes).toEqual([{ current: false }, { current: false }]);
    await flush();
    expect(calls.map((c) => c.input)).toEqual([1, 3]);
    calls[1].resolve('trois');
    expect(await third).toEqual({ current: true, value: 'trois' });
  });

  it('une demande seule est rendue comme bonne ; la suivante repart aussitôt', async () => {
    const { calls, latest } = manual();
    const a = latest.run(1);
    calls[0].resolve('un');
    expect(await a).toEqual({ current: true, value: 'un' });
    const b = latest.run(2);
    await flush();
    expect(calls).toHaveLength(2);
    calls[1].resolve('deux');
    expect(await b).toEqual({ current: true, value: 'deux' });
  });

  it('cancel : la demande en attente et celle en vol rendues dépassées, la suivante repart', async () => {
    const { calls, latest } = manual();
    const flying = latest.run(1);
    const waiting = latest.run(2);
    latest.cancel();
    expect(await waiting).toEqual({ current: false });
    calls[0].resolve('un');
    expect(await flying).toEqual({ current: false });
    await flush();
    // La demande annulée en attente n'est jamais calculée.
    expect(calls).toHaveLength(1);
    const next = latest.run(3);
    await flush();
    calls[1].resolve('trois');
    expect(await next).toEqual({ current: true, value: 'trois' });
  });

  it('erreur : rejetée pour la dernière demande, dépassée pour une ancienne', async () => {
    const { calls, latest } = manual();
    const old = latest.run(1);
    const last = latest.run(2);
    calls[0].reject(new Error('ancienne'));
    expect(await old).toEqual({ current: false });
    await flush();
    calls[1].reject(new Error('dernière'));
    await expect(last).rejects.toThrow('dernière');
    // Un calcul qui lève sans rendre de promesse est rejeté de même, et la demande suivante repart.
    const throwing = createLatestRequest((input: number): Promise<number> => {
      if (input < 0) throw new Error('négatif');
      return Promise.resolve(input * 2);
    });
    await expect(throwing.run(-1)).rejects.toThrow('négatif');
    expect(await throwing.run(4)).toEqual({ current: true, value: 8 });
  });
});
