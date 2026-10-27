/**
 * Mise en place des tests : le fuseau est fixé avant toute date, pour que les
 * tests construits à l'heure locale (`stats`, `rootGrowth`) prouvent quelque
 * chose sur une machine réglée en UTC comme ailleurs.
 */
// Les types de node ne sont pas chargés dans le projet de l'application : `process` s'atteint par globalThis.
(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'Europe/Paris';
