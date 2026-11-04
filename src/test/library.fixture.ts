import { vi } from 'vitest';

/** Fichier de test seulement : le code de l'application ne l'importe pas. Aides des tests de la bibliothèque. */

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Relève les minuteries réelles posées pendant un test ; la fonction rendue efface celles qui n'ont pas encore sonné.
 * Une bibliothèque ouverte par un test et laissée derrière lui garde ses écritures différées (fiche à 800 ms, cache à
 * 1 s) : sans cela, elles sonneraient pendant un test suivant et écriraient dans ses faux fichiers. À poser dans
 * `beforeEach`, la fonction rendue appelée dans `afterEach`.
 */
export const trackTestTimers = (): (() => void) => {
  const spy = vi.spyOn(globalThis, 'setTimeout');
  return () => {
    for (const result of spy.mock.results) if (result.type === 'return') clearTimeout(result.value);
    spy.mockRestore();
  };
};

/** Un tour de boucle : la suite de ce qui attendait une minuterie de 0 ms. */
export const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * Attend la fin du balayage de fond de la bibliothèque, au plus `maxTurns` tours, puis un tour de plus.
 * Lève à la borne : un balayage qui ne finit pas fait échouer le test, au lieu de le laisser passer sur un état à moitié fait.
 */
export const settle = async (library: { readLibraryState(): { scanning: unknown } }, maxTurns = 20_000): Promise<void> => {
  for (let i = 0; library.readLibraryState().scanning !== null; i++) {
    if (i >= maxTurns) throw new Error(`balayage encore en cours après ${maxTurns} tours`);
    await tick();
  }
  await tick();
};

/** GPX de trois points à 10 s d'écart, en `<trkpt lat lon><time>` (la forme que lit l'expression régulière des tests), `time(s)` donnant l'heure de la seconde 0, 10 et 20. */
export const threePointGpx = (time: (second: number) => string): string =>
  '<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>'
  + [0, 10, 20].map((s, i) => `<trkpt lat="${43.6 + i * 0.0003}" lon="3.8"><time>${time(s)}</time></trkpt>`).join('')
  + '</trkseg></trk></gpx>';

/** Le même, parti le 27/10/2026 à 10 h `minute` (UTC). */
export const gpxAt = (minute: number): string => threePointGpx((s) => `2026-10-27T10:${pad(minute)}:${pad(s)}Z`);

/** Le même, parti le 27/10/2026 à `hhmm` (« 10:30 », UTC). */
export const gpxAtTime = (hhmm: string): string => threePointGpx((s) => `2026-10-27T${hhmm}:${pad(s)}Z`);

/**
 * Lance `action` sous une horloge simulée (minuteries seules, la date reste vraie), avance l'horloge de `ms`
 * puis attend la fin de l'action : les écritures différées (fiche à 800 ms, cache à 1 s) partent sans attente réelle.
 * L'action est lancée avant d'avancer l'horloge : ce qu'elle programme part avec la simulée. Une action pas encore
 * finie à `ms` reçoit encore ses pauses de 0 ms (au plus `maxTurns` tours), puis lève. Horloge rendue après.
 */
export const underFakeClock = async (ms: number, action: () => unknown = () => undefined, maxTurns = 1000): Promise<void> => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldClearNativeTimers: true });
  try {
    let done = false;
    const running = Promise.resolve(action()).finally(() => {
      done = true;
    });
    // Un échec de l'action pendant que l'horloge avance remonte par `await running`, pas en rejet non traité.
    running.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; !done; i++) {
      if (i >= maxTurns) throw new Error(`action encore en cours après ${ms} ms simulées et ${maxTurns} tours`);
      await vi.advanceTimersByTimeAsync(0);
    }
    await running;
  } finally {
    vi.useRealTimers();
  }
};
