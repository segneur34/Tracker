import { describe, expect, it } from 'vitest';

/**
 * Ce que le worker des traces emporte (lot 126 B) : en suivant les imports réels depuis `library/trackWorker.ts`
 * (les `import type` s'effacent à la compilation et ne comptent pas), aucun fichier de `platform/`, `hooks/`,
 * `components/`, `pages/`, `settings/` ni `theme/`, aucun paquet npm (React compris), et ni `DOMParser`, ni
 * `document.`, ni `localStorage`, ni `navigator` dans le code atteint (commentaires exclus). Un worker n'a ni DOM ni
 * greffon Capacitor ; ce qui en lirait un casserait le worker sur le téléphone, et seulement là.
 */

interface Fs {
  readFileSync(file: URL, encoding: 'utf8'): string;
  existsSync(file: URL): boolean;
}
// Les types de Node ne sont pas ceux de l'app (voir `architecture.test.ts`) : le peu qui sert est décrit à la main.
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;

const SRC = new URL('../', import.meta.url);
const ENTRY = 'library/trackWorker.ts';

const FORBIDDEN_DIRS = ['platform', 'hooks', 'components', 'pages', 'settings', 'theme'];

const FORBIDDEN_CODE: readonly [string, RegExp][] = [
  ['DOMParser', /\bDOMParser\b/],
  ['document.', /\bdocument\s*\./],
  ['localStorage', /\blocalStorage\b/],
  ['navigator', /\bnavigator\b/],
];

/** Texte sans commentaires (blocs, lignes, fins de ligne « // … »), comme `architecture.test.ts`. */
const withoutComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line.replace(/\s\/\/\s.*$/, '')))
    .join('\n');

/** Spécificateurs importés pour leur valeur : `import … from`, `import '…'`, `export … from`, `import('…')`, hors `import type` et `export type`. */
const valueSpecifiersOf = (text: string): string[] => {
  const found: string[] = [];
  for (const m of text.matchAll(/^import\s+(type\s)?[^'";]*?from\s*['"]([^'"]+)['"]/gm)) if (!m[1]) found.push(m[2]);
  for (const m of text.matchAll(/^import\s*['"]([^'"]+)['"]/gm)) found.push(m[1]);
  for (const m of text.matchAll(/^export\s+(type\s)?(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s*from\s*['"]([^'"]+)['"]/gm)) if (!m[1]) found.push(m[2]);
  for (const m of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(m[1]);
  return found;
};

/** Fichier visé par un spécificateur relatif, depuis `src/` (`../core/geo` depuis `library/x.ts` → `core/geo.ts`). */
const resolve = (fromFile: string, spec: string): string => {
  const parts = fromFile.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  const base = parts.join('/');
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (/\.tsx?$/.test(candidate) && fs.existsSync(new URL(candidate, SRC))) return candidate;
  }
  throw new Error(`import introuvable : ${spec} depuis ${fromFile}`);
};

/** Fichiers atteints depuis l'entrée, et paquets importés (spécificateurs non relatifs). */
const reached = (): { files: string[]; packages: string[] } => {
  const files = new Set<string>([ENTRY]);
  const packages = new Set<string>();
  const queue = [ENTRY];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    for (const spec of valueSpecifiersOf(fs.readFileSync(new URL(file, SRC), 'utf8'))) {
      if (!spec.startsWith('.')) {
        packages.add(`${spec}  (depuis ${file})`);
        continue;
      }
      // Une feuille de style ou une image n'a rien à faire dans un worker : le test la signale comme un paquet.
      if (/\.(css|svg|png|jpg|webp|json)$/.test(spec)) {
        packages.add(`${spec}  (depuis ${file})`);
        continue;
      }
      const target = resolve(file, spec);
      if (!files.has(target)) {
        files.add(target);
        queue.push(target);
      }
    }
  }
  return { files: [...files].sort(), packages: [...packages].sort() };
};

describe('worker des traces : ni React, ni platform/, ni DOM dans ce qu’il emporte', () => {
  const { files, packages } = reached();

  it('suit bien les imports (garde-fou du test lui-même)', () => {
    expect(files).toContain('library/trackWorkerProtocol.ts');
    expect(files).toContain('core/prepareTrack.ts');
    expect(files).toContain('core/gpxParser.ts');
    expect(files).toContain('library/summary.ts');
    expect(files.length).toBeGreaterThan(20);
    // Un `import type` ne compte pas, un import de valeur à côté d'un type si.
    expect(valueSpecifiersOf("import type { A } from './a';\nimport { b, type C } from './b';\nexport type { D } from './d';\nexport * from './e';"))
      .toEqual(['./b', './e']);
  });

  it('aucun fichier des dossiers de l’interface ou de la plateforme', () => {
    expect(files.filter((file) => FORBIDDEN_DIRS.includes(file.split('/')[0]))).toEqual([]);
  });

  it('aucun paquet npm', () => {
    expect(packages).toEqual([]);
  });

  it('ni DOM, ni stockage, ni navigateur dans le code atteint', () => {
    const uses = files.flatMap((file) =>
      withoutComments(fs.readFileSync(new URL(file, SRC), 'utf8')).split('\n').flatMap((line, i) =>
        FORBIDDEN_CODE.filter(([, re]) => re.test(line)).map(([name]) => `${file}:${i + 1}  ${name}`)));
    expect(uses).toEqual([]);
  });
});
