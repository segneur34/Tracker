import { afterEach, describe, expect, it, vi } from 'vitest';
import { IGN_REQUEST_TIMEOUT_MS, IGN_RESOURCE, fetchIgnElevations, ignErrorMessage, ignRequestBody, parseIgnElevations } from './ignAltimetry';

describe("altimétrie de l'IGN", () => {
  it('joint longitudes et latitudes par des barres', () => {
    const body = ignRequestBody([
      { lat: 43.6108, lon: 3.8767 },
      { lat: 43.611, lon: 3.877 },
    ]);
    expect(body).toEqual({ lon: '3.876700|3.877000', lat: '43.610800|43.611000', resource: IGN_RESOURCE, zonly: 'true' });
  });

  it('lit les altitudes, -99999 hors couverture', () => {
    // Réponse relevée le 07/10/2026 : deux points de Montpellier, un en mer.
    expect(parseIgnElevations({ elevations: [47.54, 46.87, -99999.0] }, 3)).toEqual([47.54, 46.87, null]);
  });

  it('refuse une réponse mal formée ou incomplète', () => {
    expect(() => parseIgnElevations({ elevations: [47.54] }, 2)).toThrow();
    expect(() => parseIgnElevations({ elevations: [47.54, 'x'] }, 2)).toThrow();
    expect(() => parseIgnElevations([47.54], 1)).toThrow();
    expect(() => parseIgnElevations(null, 0)).toThrow();
  });

  it("donne un message clair sur une erreur du serveur", () => {
    expect(ignErrorMessage(429)).toMatch(/occupé/);
    expect(ignErrorMessage(500)).toMatch(/500/);
  });
});

/** `fetch` qui ne répond jamais, mais s'arrête sur abandon, comme le navigateur. */
const hangingFetch = (_url: string, init?: RequestInit): Promise<Response> =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Abandon', 'AbortError')));
  });

describe("altimétrie de l'IGN sans réponse (B3)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('échoue au bout du délai, par défaut 30 s par paquet, au lieu de rester en recherche', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch);
    expect(IGN_REQUEST_TIMEOUT_MS).toBe(30_000);
    const outcome = expect(fetchIgnElevations([{ lat: 43.6, lon: 3.85 }])).rejects.toThrow("Le service d'altitude de l'IGN ne répond pas");
    await vi.advanceTimersByTimeAsync(IGN_REQUEST_TIMEOUT_MS);
    await outcome;
  });

  it('prend le délai donné', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch);
    const outcome = expect(fetchIgnElevations([{ lat: 43.6, lon: 3.85 }], undefined, 2_000)).rejects.toThrow('ne répond pas');
    await vi.advanceTimersByTimeAsync(2_000);
    await outcome;
  });
});
