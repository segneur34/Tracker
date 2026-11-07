import { describe, expect, it } from 'vitest';

/**
 * Configuration Capacitor (lot 188) : l'agent ajouté à celui de la WebView, envoyé avec chaque tuile, nomme
 * l'application, sa version et un contact public (OpenStreetMap l'exige). La version vient de `package.json`.
 */

// Les types de Node ne sont pas ceux de l'app (voir `androidManifest.test.ts`) : le peu qui sert est décrit à la main.
interface Fs {
  readFileSync(file: URL, encoding: 'utf8'): string;
}
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;
const repoUrl = (path: string): URL => new URL(`../../${path}`, import.meta.url);

const PACKAGE = JSON.parse(fs.readFileSync(repoUrl('package.json'), 'utf8')) as { version: string };
const SOURCE = fs.readFileSync(repoUrl('capacitor.config.ts'), 'utf8');
const config = ((await import(/* @vite-ignore */ repoUrl('capacitor.config.ts').href)) as {
  default: { android?: { appendUserAgent?: string } };
}).default;

describe('configuration Capacitor : agent identifiant', () => {
  const agent = config.android?.appendUserAgent ?? '';

  it('a la forme « Tracker/<version> (+page GitHub) »', () => {
    expect(agent).toMatch(/^Tracker\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/segneur34\)$/);
  });

  it('porte la version de package.json', () => {
    expect(agent).toBe(`Tracker/${PACKAGE.version} (+https://github.com/segneur34)`);
  });

  it('la version n\'est pas recopiée à la main dans le fichier', () => {
    expect(SOURCE).not.toContain(PACKAGE.version);
  });

  it('aucune adresse e-mail', () => {
    expect(agent).not.toContain('@');
    expect(SOURCE).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});
