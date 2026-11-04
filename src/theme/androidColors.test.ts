import { describe, expect, it } from 'vitest';

/**
 * Le fond derrière les barres d'Android (`tracker_colors.xml`, clair et nuit)
 * est le `--bg` du thème correspondant (lot 158) : un changement de l'un sans
 * l'autre laisserait une bande de couleur étrangère sous l'heure et la
 * navigation.
 */

interface Fs {
  readFileSync(file: URL, encoding: 'utf8'): string;
}
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;

const tokens = fs.readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const androidColor = (dir: string): string => {
  const xml = fs.readFileSync(new URL(`../../android/app/src/main/res/${dir}/tracker_colors.xml`, import.meta.url), 'utf8');
  return /<color name="tracker_background">(#[0-9A-Fa-f]{6})<\/color>/.exec(xml)?.[1]?.toLowerCase() ?? 'introuvable';
};
/** Premier `--bg` après `selector` dans tokens.css. */
const cssBg = (selector: string): string => {
  const from = tokens.indexOf(selector);
  return new RegExp('--bg:\\s*(#[0-9A-Fa-f]{6})', 'i').exec(tokens.slice(from))?.[1]?.toLowerCase() ?? 'introuvable';
};

describe('fond des barres d\'Android', () => {
  it('clair : --bg du thème clair', () => {
    expect(androidColor('values')).toBe(cssBg(':root {'));
  });

  it('nuit : --bg du thème sombre', () => {
    expect(androidColor('values-night')).toBe(cssBg(":root[data-theme='dark'] {"));
  });
});
