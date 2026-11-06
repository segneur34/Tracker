import { describe, expect, it } from 'vitest';

/**
 * Les `id` des panneaux de l'analyse voile sont la clé de leur taille mémorisée (`ResizablePanel`) : le
 * découpage du module en un composant par onglet ne doit en perdre, renommer ni doubler aucun. Le test lit
 * les sources du module et de ses pièces.
 */

interface Fs {
  readdirSync(dir: URL): string[];
  readFileSync(file: URL, encoding: 'utf8'): string;
}
// Les types de Node ne sont pas ceux de l'app (voir `architecture.test.ts`) : le peu qui sert est décrit à la main.
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;

const HERE = new URL('./', import.meta.url);
const MODULE = new URL('../../pages/SailingModule.tsx', import.meta.url);

const sources = (): string => [
  fs.readFileSync(MODULE, 'utf8'),
  ...fs.readdirSync(HERE).filter((f) => f.endsWith('.tsx')).map((f) => fs.readFileSync(new URL(f, HERE), 'utf8')),
].join('\n');

/** Les panneaux de l'analyse voile, tels qu'ils étaient avant le découpage. */
const PANEL_IDS = [
  'sailing.general', 'sailing.tops', 'sailing.carte.manoeuvres', 'sailing.carte.manoeuvres.details', 'sailing.graph.vitesse',
  'sailing.graph.fc', 'sailing.graph.polaire', 'sailing.cardio', 'sailing.carte.vmg', 'sailing.graph.vmg', 'sailing.vols',
  'sailing.pumping', 'sailing.graph.vent', 'sailing.matos', 'sailing.reglages',
];

describe('identifiants des panneaux de la voile', () => {
  const text = sources();
  const count = (s: string) => text.split(s).length - 1;

  it.each(PANEL_IDS)('« %s » figure une fois', (id) => {
    expect(count(`'${id}'`) + count(`"${id}"`)).toBe(1);
  });

  it('les panneaux vides gardent leur forme `sailing.carte.<onglet>.vide`', () => {
    expect(count('id={`sailing.carte.${key}.vide`}')).toBe(1);
    expect(text).toMatch(/renderEmptyPanel = \(key: 'manoeuvres' \| 'vmg' \| 'vent'/);
  });
});
