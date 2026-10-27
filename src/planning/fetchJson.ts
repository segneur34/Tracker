/**
 * Appel d'un service public (calcul d'itinéraire, recherche de lieux,
 * OpenStreetMap, altitude de l'IGN), commun à la planification : un échec
 * se dit toujours en clair, jamais par le message brut du navigateur.
 *
 * - Pas de réseau : `noNetwork`.
 * - Pas de réponse avant `timeoutMs` (s'il est donné) : `timeout`. Le délai
 *   couvre la réponse et la lecture de son corps : une connexion qui reste
 *   ouverte sans rien rendre finit en échec, que l'on peut réessayer.
 * - Abandon par l'appelant (`init.signal`) : l'`AbortError` est relancée
 *   telle quelle, pour que l'appelant la distingue d'un échec.
 * - Réponse qui n'est pas du JSON (portail captif d'un Wi-Fi, page d'erreur
 *   d'un relais) : `unreadable` (`readJson`).
 */

/** Messages d'un appel, en clair. */
export interface FetchMessages {
  noNetwork: string;
  /** Pas de réponse dans le délai ; requis avec `timeoutMs`. */
  timeout?: string;
  /** Délai accordé à la réponse et à son corps, en millisecondes ; aucun s'il manque. */
  timeoutMs?: number;
}

export const isAbortError = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError';

/**
 * Appelle `url`, puis lit la réponse par `read`, dans le délai donné. Les
 * erreurs levées par `read` passent telles quelles, sauf celle d'un délai
 * dépassé pendant la lecture, traduite.
 */
export const fetchWithin = async <T>(
  url: string,
  init: RequestInit,
  { noNetwork, timeout, timeoutMs }: FetchMessages,
  read: (response: Response) => Promise<T>
): Promise<T> => {
  const outer = init.signal ?? undefined;
  if (outer?.aborted) throw new DOMException('Abandon', 'AbortError');
  const controller = new AbortController();
  let timedOut = false;
  const timer = timeoutMs !== undefined
    ? setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs)
    : undefined;
  const forward = () => controller.abort();
  outer?.addEventListener('abort', forward, { once: true });
  const failure = (err: unknown): Error => (timedOut ? new Error(timeout ?? noNetwork) : err instanceof Error ? err : new Error(noNetwork));
  try {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (timedOut) throw new Error(timeout ?? noNetwork);
      if (isAbortError(err)) throw err;
      throw new Error(noNetwork);
    }
    try {
      return await read(response);
    } catch (err) {
      throw failure(err);
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    outer?.removeEventListener('abort', forward);
  }
};

/** Corps JSON d'une réponse ; `unreadable` s'il n'en est pas. Un abandon pendant la lecture est relancé tel quel. */
export const readJson = async (response: Response, unreadable: string): Promise<unknown> => {
  try {
    return await response.json();
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new Error(unreadable);
  }
};

/** Corps texte d'une réponse en erreur, vide s'il ne se lit pas. */
export const readErrorBody = (response: Response): Promise<string> => response.text().catch(() => '');

/** Messages de `fetchJson` : ceux de `fetchWithin`, la réponse illisible, et celui d'un code d'erreur. */
export interface FetchJsonMessages extends FetchMessages {
  unreadable: string;
  httpError: (status: number, body: string) => string;
}

/** JSON rendu par `url` ; lève une erreur au message lisible (voir l'en-tête). */
export const fetchJson = (url: string, init: RequestInit, messages: FetchJsonMessages): Promise<unknown> =>
  fetchWithin(url, init, messages, async (response) => {
    if (!response.ok) throw new Error(messages.httpError(response.status, await readErrorBody(response)));
    return readJson(response, messages.unreadable);
  });
