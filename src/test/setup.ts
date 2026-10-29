import { afterAll, vi } from 'vitest';

/**
 * Mise en place des tests : le fuseau est fixé avant toute date, pour que les
 * tests construits à l'heure locale (`stats`, `rootGrowth`) prouvent quelque
 * chose sur une machine réglée en UTC comme ailleurs.
 */
// Les types de node ne sont pas chargés dans le projet de l'application : `process` s'atteint par globalThis.
(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'Europe/Paris';

// Les tests ne sont plus isolés par fichier : chacun rend au suivant des horloges, globales et espions propres.
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Registre de modules vidé avant chaque fichier : l'état des modules de l'application (stockage, service GPS) ne passe
// pas d'un fichier au suivant, mais les bibliothèques externes restent chargées.
vi.resetModules();
