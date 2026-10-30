import { describe, expect, it } from 'vitest';

/**
 * Sens des dépendances entre dossiers de `src/` (lot 71, fiche
 * `docs/backlog/52-assainissement.md`, « Architecture cible »). Le test lit les
 * `import` et `export … from` de chaque fichier et vérifie qu'ils vont dans le
 * sens permis :
 *
 *   core  →  domaines  →  settings  →  hooks  →  components  →  pages
 *   platform → core seulement ; theme → core seulement
 *
 * Les domaines se lisent du bas vers le haut : sailing et surfing (feuilles),
 * running, cycling, planning, recording, library. Un domaine importe `core/`
 * et les domaines plus bas que lui, jamais l'inverse ; seuls `recording/` et
 * `library/` lisent `platform/` (position, capteurs, dossier mémoire).
 *
 * Les fichiers de test, les fixtures et `src/test/` ne sont pas contrôlés ;
 * les feuilles de style non plus (seuls les modules `.ts` et `.tsx` comptent).
 *
 * `EXCEPTIONS` est une dette nommée : chaque ligne est un import qui va à
 * rebours, avec la raison. La liste ne doit que diminuer ; une ligne qui n'a
 * plus d'objet fait échouer le test, il faut alors la retirer.
 */

interface Fs {
  readdirSync(dir: URL, options: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
  readFileSync(file: URL, encoding: 'utf8'): string;
}
// Les types de Node ne sont pas ceux de l'app (voir `hooks/mediaQueries.test.ts`) : le peu qui sert est décrit à la main.
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;

const SRC = new URL('./', import.meta.url);

/** Les sept domaines, du plus bas au plus haut. */
const DOMAINS = ['sailing', 'surfing', 'running', 'cycling', 'planning', 'recording', 'library'] as const;

/** Dossiers que chaque dossier a le droit d'importer, en plus de lui-même. */
const ALLOWED: Record<string, readonly string[]> = {
  core: [],
  sailing: ['core'],
  surfing: ['core'],
  running: ['core'],
  cycling: ['core', 'running'],
  planning: ['core', 'running', 'cycling'],
  recording: ['core', 'platform', 'sailing', 'surfing', 'running', 'cycling', 'planning'],
  library: ['core', 'platform', ...DOMAINS],
  settings: ['core', ...DOMAINS],
  platform: ['core'],
  theme: ['core'],
  hooks: ['core', 'platform', 'theme', ...DOMAINS, 'settings'],
  components: ['core', 'platform', 'theme', ...DOMAINS, 'settings', 'hooks'],
  pages: ['core', 'platform', 'theme', ...DOMAINS, 'settings', 'hooks', 'components', 'assets'],
};

/** Fichiers à la racine de `src/` (`main.tsx`, `App.tsx`) : ils assemblent tout, sans règle. */
const ROOT = '(racine)';

/** `de → vers` (fichiers sans extension) : imports à rebours, avec leur raison. À ne faire que diminuer. */
const EXCEPTIONS: Record<string, string> = {
  // Le revêtement (catégories de voie) est une notion de la planification que l'énergie à vélo et à pied lit.
  'cycling/energy → planning/surface': 'catégories de revêtement, lues avant de pouvoir descendre dans le noyau (lot 82)',
  'cycling/energyView → planning/surface': 'idem',
  'running/energyView → planning/surface': 'idem (type seul)',
  // Les résultats de test et le détecteur d'intervalles lisent des types et des bornes du compteur de l'enregistrement.
  'running/fitnessTestResults → recording/fitnessTest': 'protocole du test de FC max (type)',
  'running/restingHrResults → recording/restingHrTest': 'protocole du test de FC repos (type)',
  'running/intervalDetection → recording/intervalTimer': 'INTERVAL_LIMITS, bornes du compteur',
  'planning/routeRecord → recording/markGuide': 'réglages de balise rangés avec l\'itinéraire (lot 82)',
  // Le hook de l'axe du temps lit les échelles et le survol des composants de graphe.
  'hooks/useTimeChartAxis → components/chartAxes': 'échelles du graphe',
  'hooks/useTimeChartAxis → components/chartHover': 'survol du graphe',
};

const sourceFiles = (dir: URL, prefix = ''): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name === 'test' && prefix === '' ? [] : sourceFiles(new URL(`${e.name}/`, dir), `${prefix}${e.name}/`);
    const isSource = /\.(ts|tsx)$/.test(e.name) && !/\.(test|fixture)\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts');
    return isSource ? [`${prefix}${e.name}`] : [];
  });

/** Spécificateurs relatifs d'un fichier : `import … from`, `import '…'`, `export … from`, `import('…')`. */
const specifiersOf = (text: string): string[] => {
  const found: string[] = [];
  const patterns = [
    /^import\s[^'";]*?from\s*['"]([^'"]+)['"]/gm,
    /^import\s*['"]([^'"]+)['"]/gm,
    /^export\s+(?:type\s+)?(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s*from\s*['"]([^'"]+)['"]/gm,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) found.push(m[1]);
  return found.filter((s) => s.startsWith('.'));
};

/** Chemin de la cible depuis `src/`, sans extension (`../core/geo` depuis `sailing/wind.ts` → `core/geo`). */
const resolveTarget = (fromFile: string, spec: string): string => {
  const parts = fromFile.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/').replace(/\.(ts|tsx)$/, '');
};

const groupOf = (path: string): string => (path.includes('/') ? path.split('/')[0] : ROOT);

interface Edge {
  from: string;
  to: string;
}

const edges = (): Edge[] =>
  sourceFiles(SRC).flatMap((file) =>
    specifiersOf(fs.readFileSync(new URL(file, SRC), 'utf8'))
      // Une feuille de style ou une image : ni module, ni sens à garder.
      .filter((spec) => !/\.(css|svg|png|jpg|webp|json)$/.test(spec))
      .map((spec) => ({ from: file.replace(/\.(ts|tsx)$/, ''), to: resolveTarget(file, spec) })));

const isForbidden = ({ from, to }: Edge): boolean => {
  const source = groupOf(from);
  const target = groupOf(to);
  if (source === ROOT || target === source) return false;
  const allowed = ALLOWED[source];
  return !allowed || !allowed.includes(target);
};

const edgeName = ({ from, to }: Edge): string => `${from} → ${to}`;

describe("sens des dépendances entre dossiers de src/", () => {
  const all = edges();
  const forbidden = all.filter(isForbidden);

  it('lit bien les imports de src/ (garde-fou du test lui-même)', () => {
    expect(all.length).toBeGreaterThan(1000);
    expect(all.some((e) => e.from === 'sailing/wind' && e.to === 'core/angles')).toBe(true);
    expect(all.some((e) => e.from === 'hooks/useRecorder' && e.to === 'recording/session')).toBe(true);
  });

  it('chaque dossier de src/ a une règle', () => {
    const groups = new Set(sourceFiles(SRC).map(groupOf));
    groups.delete(ROOT);
    // `assets` n'a pas de module ; les autres dossiers ont tous leur ligne dans ALLOWED.
    for (const group of groups) expect(Object.keys(ALLOWED), `dossier « ${group} » sans règle`).toContain(group);
  });

  it('aucun import à rebours hors des exceptions nommées', () => {
    const unexpected = forbidden.map(edgeName).filter((name) => !(name in EXCEPTIONS));
    expect(unexpected).toEqual([]);
  });

  it("chaque exception nommée est encore un import à rebours (la liste ne fait que diminuer)", () => {
    const present = new Set(forbidden.map(edgeName));
    const stale = Object.keys(EXCEPTIONS).filter((name) => !present.has(name));
    expect(stale).toEqual([]);
  });

  it("le noyau, la plateforme et le thème n'importent aucun domaine", () => {
    const bad = all.filter((e) => ['core', 'platform', 'theme'].includes(groupOf(e.from)) && DOMAINS.includes(groupOf(e.to) as never));
    expect(bad.map(edgeName)).toEqual([]);
  });
});
