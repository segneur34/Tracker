import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchJson } from './fetchJson';

const MESSAGES = {
  noNetwork: 'Pas de réseau.',
  timeout: 'Le serveur ne répond pas.',
  timeoutMs: 60_000,
  unreadable: 'Réponse illisible.',
  httpError: (status: number, body: string) => `Erreur ${status} ${body}`,
};

/** `fetch` qui ne répond jamais, mais s'arrête sur abandon, comme le navigateur. */
const hangingFetch = (_url: string, init?: RequestInit): Promise<Response> =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Abandon', 'AbortError')));
  });

describe('appel d\'un service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('rend le JSON de la réponse', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"a":1}', { status: 200 }));
    await expect(fetchJson('https://x', {}, MESSAGES)).resolves.toEqual({ a: 1 });
  });

  it('une page HTML (portail captif) donne le message illisible, pas celui du navigateur', async () => {
    vi.stubGlobal('fetch', async () => new Response('<!DOCTYPE html><html></html>', { status: 200 }));
    await expect(fetchJson('https://x', {}, MESSAGES)).rejects.toThrow('Réponse illisible.');
  });

  it('un code d\'erreur passe par son message, corps compris', async () => {
    vi.stubGlobal('fetch', async () => new Response('occupé', { status: 503 }));
    await expect(fetchJson('https://x', {}, MESSAGES)).rejects.toThrow('Erreur 503 occupé');
  });

  it('sans réseau : le message en clair', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(fetchJson('https://x', {}, MESSAGES)).rejects.toThrow('Pas de réseau.');
  });

  it('sans réponse dans le délai : échec lisible', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    const call = fetchJson('https://x', {}, MESSAGES);
    const outcome = expect(call).rejects.toThrow('Le serveur ne répond pas.');
    await vi.advanceTimersByTimeAsync(60_000);
    await outcome;
  });

  it('un corps qui n\'arrive pas compte aussi dans le délai', async () => {
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: () => hangingFetch('', init),
    }));
    const call = fetchJson('https://x', {}, MESSAGES);
    const outcome = expect(call).rejects.toThrow('Le serveur ne répond pas.');
    await vi.advanceTimersByTimeAsync(60_000);
    await outcome;
  });

  it('abandon par l\'appelant : AbortError relancée, pas un échec', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    const controller = new AbortController();
    const call = fetchJson('https://x', { signal: controller.signal }, MESSAGES);
    controller.abort();
    await expect(call).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('sans délai demandé, rien ne coupe l\'appel', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    let settled = false;
    void fetchJson('https://x', {}, { ...MESSAGES, timeoutMs: undefined }).finally(() => {
      settled = true;
    }).catch(() => {});
    await vi.advanceTimersByTimeAsync(600_000);
    expect(settled).toBe(false);
  });
});
