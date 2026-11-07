/**
 * Moyenne glissante en temps actif (lot 187, sortie de `recording/fitnessTest.ts`) : une fenêtre de mesures
 * récentes, et sa moyenne pondérée par le temps sur les dernières secondes. Sert au test guidé, à l'alerte de
 * zone cardiaque et au test de FC de repos ; rien n'y dépend d'un sport (règle 2 : tout en secondes).
 */

/** Une mesure en temps actif (pauses ôtées), avec la vitesse et la FC si elles y sont. */
export interface WindowSample {
  activeMs: number;
  speedMs?: number;
  hrBpm?: number;
}

/**
 * Moyenne pondérée par le temps d'un champ sur les `windowS` dernières
 * secondes actives : chaque mesure vaut depuis la précédente. `null` si la
 * fenêtre n'en couvre pas la moitié (départ, reprise après un trou).
 * `endMs` : fenêtre finissant à cet instant passé plutôt qu'à `nowMs`.
 */
export const windowMean = (
  window: WindowSample[], field: 'speedMs' | 'hrBpm', windowS: number, nowMs: number, endMs: number = nowMs
): number | null => {
  const fromMs = endMs - windowS * 1000;
  let sum = 0;
  let dur = 0;
  for (let i = window.length - 1; i > 0; i--) {
    const cur = window[i];
    const prevMs = window[i - 1].activeMs;
    if (cur.activeMs <= fromMs) break;
    if (prevMs >= endMs) continue;
    const value = cur[field];
    if (value === undefined) continue;
    const w = Math.min(cur.activeMs, endMs) - Math.max(prevMs, fromMs);
    sum += value * w;
    dur += w;
  }
  return dur >= (windowS * 1000) / 2 ? sum / dur : null;
};
