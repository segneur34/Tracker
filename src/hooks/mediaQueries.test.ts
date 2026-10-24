import { describe, expect, it } from 'vitest';
import { NARROW_QUERY, PHONE_LANDSCAPE_QUERY, WIDE_QUERY } from './useNarrowScreen';

// Lus sur le disque : Vitest rend vide un CSS importé, même brut. Les types de Node ne sont pas ceux de l'app :
// le peu qui sert ici est décrit à la main.
interface Fs {
  readdirSync(dir: URL, options: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
  readFileSync(file: URL, encoding: 'utf8'): string;
}
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;

const cssFiles = (dir: URL): URL[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? cssFiles(new URL(`${e.name}/`, dir)) : e.name.endsWith('.css') ? [new URL(e.name, dir)] : []);

const SRC = new URL('../', import.meta.url);

/** Les `@media` de chaque fichier CSS de `src/`, sans l'accolade. */
const mediaQueries = (): { file: string; query: string }[] =>
  cssFiles(SRC).flatMap((url) =>
    [...fs.readFileSync(url, 'utf8').matchAll(/@media\s+([^{]+)\{/g)].map((m) => ({ file: url.pathname, query: m[1].trim() })));

describe('rupture téléphone / ordinateur', () => {
  it('chaque @media de la rupture de 768 px reprend la requête de useNarrowScreen, téléphone tourné compris', () => {
    const atBreak = mediaQueries().filter(({ query }) => /76[78]/.test(query));
    expect(atBreak.length).toBeGreaterThan(10);
    for (const { file, query } of atBreak) {
      expect([NARROW_QUERY, WIDE_QUERY], file).toContain(query);
    }
  });

  it('les règles du téléphone tourné passent par la même requête', () => {
    const landscape = mediaQueries().filter(({ query }) => /orientation|499/.test(query) && !/76[78]/.test(query));
    expect(landscape.length).toBeGreaterThan(5);
    for (const { file, query } of landscape) expect(query, file).toBe(PHONE_LANDSCAPE_QUERY);
  });
});
