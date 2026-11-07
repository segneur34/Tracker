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
 * land (commun à la course, au vélo et à l'Entraînement : pente, dépense,
 * altitude du terrain, lignes des graphes, séance cardio ; lot 187), running,
 * cycling, planning, recording, library. Un domaine importe `core/` et les
 * domaines plus bas que lui, jamais l'inverse ; seuls `recording/` et
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

/** Les huit domaines, du plus bas au plus haut. */
const DOMAINS = ['sailing', 'surfing', 'land', 'running', 'cycling', 'planning', 'recording', 'library'] as const;

/** Dossiers que chaque dossier a le droit d'importer, en plus de lui-même. */
const ALLOWED: Record<string, readonly string[]> = {
  core: [],
  sailing: ['core'],
  surfing: ['core'],
  land: ['core'],
  running: ['core', 'land'],
  cycling: ['core', 'land', 'running'],
  planning: ['core', 'land', 'running', 'cycling'],
  recording: ['core', 'platform', 'sailing', 'surfing', 'land', 'running', 'cycling', 'planning'],
  library: ['core', 'platform', ...DOMAINS],
  settings: ['core', ...DOMAINS],
  // Programme des tutoriels (lot 147), calcul pur : le noyau seul ; lu par les hooks, les composants et les pages.
  tutorials: ['core'],
  platform: ['core'],
  theme: ['core'],
  hooks: ['core', 'platform', 'theme', ...DOMAINS, 'settings', 'tutorials'],
  components: ['core', 'platform', 'theme', ...DOMAINS, 'settings', 'tutorials', 'hooks'],
  pages: ['core', 'platform', 'theme', ...DOMAINS, 'settings', 'tutorials', 'hooks', 'components', 'assets'],
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

/**
 * Couture de la version voile et surf (lot 187, fiche `docs/backlog/154-vente-extraction-voile-surf.md`) : le
 * transverse (`core/`, `platform/`, `theme/`, `tutorials/`, `library/`, `settings/`, `hooks/`, `components/`, `pages/`,
 * `recording/`, `planning/`) n'importe ni `running/`, ni `cycling/`, ni `land/`, ce qui part de la version vendue,
 * sauf deux listes nommées, qui ne font que diminuer : les fichiers de la terre encore rangés dans le transverse
 * (`LAND_FILES`, ils partiront avec les lots E3 à E5) et la couture des fichiers gardés (`SEAM` : réglages, résumé,
 * fiche, direct, à découdre un fil à la fois). Une entrée sans objet fait échouer le test : il faut alors la retirer.
 */
const TRANSVERSE = ['core', 'platform', 'theme', 'tutorials', 'library', 'settings', 'hooks', 'components', 'pages', 'recording', 'planning'];
const LAND_TARGETS = ['running', 'cycling', 'land'];

/** Fichiers de la terre rangés dans le transverse (sans extension) : tout ce qu'ils importent de la terre est admis. */
const LAND_FILES = [
  'components/CadencePanel', 'components/FitnessTestPanel', 'components/IntervalAnalysis', 'components/KilometerSplitsTable',
  'components/StatsLevelPanel', 'components/GradeGradientLegend',
  'hooks/useRestingHrTest', 'hooks/useTerrainElevation',
  'library/restingHrStore', 'library/statsLevel',
  'pages/LandModule', 'pages/landModules', 'pages/MuscuModule', 'pages/RestingHrTestPage',
  'planning/duration',
];

/** La couture : imports « fichier → cible » des fichiers gardés dans la version vendue. */
const SEAM = [
  'hooks/useLiveRecording → running/energy', 'hooks/useLiveRecording → cycling/energy',
  'hooks/useRecorder → running/cadence',
  'hooks/useSportSettings → running/energy', 'hooks/useSportSettings → cycling/energy', 'hooks/useSportSettings → land/grade',
  'library/record → running/fitnessTestResults', 'library/record → running/energy', 'library/record → cycling/energy', 'library/record → land/terrainElevation',
  'library/summary → running/fitnessTestResults', 'library/summary → running/cadence', 'library/summary → cycling/energy', 'library/summary → land/grade',
  'library/summary → land/terrainElevation',
  'library/summaryOptions → cycling/energy',
  'library/stats → land/heartRateSession',
  'pages/SessionLibrary → land/heartRateSession',
  'pages/SettingsPage → running/energy', 'pages/SettingsPage → cycling/energy', 'pages/SettingsPage → land/grade',
  'pages/PlanningPage → land/grade',
  'planning/route → land/grade',
  'planning/importedElevation → land/terrainElevation',
  'recording/gpxWriter → running/cadence',
  'recording/liveStats → running/energy', 'recording/liveStats → cycling/energy', 'recording/liveStats → land/grade',
  'settings/activityPresets → running/energy', 'settings/activityPresets → land/grade',
  'settings/activitySettings → running/energy', 'settings/activitySettings → cycling/energy', 'settings/activitySettings → cycling/cyclingConfig',
  'settings/activitySettings → land/grade',
];

describe('couture de la version voile et surf : le transverse n’importe ni running/, ni cycling/, ni land/ (lot 187)', () => {
  const seams = edges().filter((e) => TRANSVERSE.includes(groupOf(e.from)) && LAND_TARGETS.includes(groupOf(e.to)));
  const names = seams.map(edgeName);

  it('lit bien la couture (garde-fou du test lui-même)', () => {
    expect(names).toContain('library/summary → land/grade');
    expect(LAND_FILES.every((f) => !f.includes('.'))).toBe(true);
  });

  it('aucun import de la terre hors des fichiers de la terre et de la couture nommée', () => {
    const unexpected = seams.filter((e) => !LAND_FILES.includes(e.from)).map(edgeName).filter((name) => !SEAM.includes(name));
    expect(unexpected).toEqual([]);
  });

  it('chaque fichier de la terre listé importe encore la terre (la liste ne fait que diminuer)', () => {
    const importing = new Set(seams.map((e) => e.from));
    expect(LAND_FILES.filter((f) => !importing.has(f))).toEqual([]);
  });

  it('chaque fil de la couture existe encore (la liste ne fait que diminuer)', () => {
    const present = new Set(names);
    expect(SEAM.filter((name) => !present.has(name))).toEqual([]);
  });
});

/**
 * Règle 12 de `CLAUDE.md` : stockage, fichiers, position, son, vibreur, capteurs, ceinture, notification, écran allumé
 * et orientation passent par `src/platform/`. Hors de ce dossier, aucune de ces API du navigateur ni aucun paquet
 * natif (`@capacitor/*`, `@capgo/*`, importé de façon statique ou dynamique, ou en type seul) : chacun a sa version
 * navigateur et téléphone dans `platform/`, choisie par `isNativeApp()`. Les commentaires ne comptent pas.
 */
const PLATFORM_ONLY: readonly [string, RegExp][] = [
  ['localStorage', /\blocalStorage\b/],
  ['sessionStorage', /\bsessionStorage\b/],
  ['navigator.geolocation, vibrate, wakeLock, bluetooth ou storage', /\bnavigator\s*\.\s*(?:geolocation|vibrate|wakeLock|bluetooth|storage)\b/],
  ['screen.orientation', /\bscreen\s*\.\s*orientation\b/],
  ['DeviceMotionEvent ou DeviceOrientationEvent', /\bDevice(?:Motion|Orientation)Event\b/],
  ['AudioContext (Web Audio)', /\b(?:webkit)?AudioContext\b/],
  ['showDirectoryPicker', /\bshowDirectoryPicker\b/],
  ['new Notification', /\bnew\s+Notification\b/],
  ['paquet @capacitor ou @capgo', /['"`]@(?:capacitor|capgo)\//],
];

/** Texte d'un fichier sans ses commentaires : lignes de commentaire et de bloc retirées, fin de ligne « // … » coupée. */
const withoutComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line.replace(/\s\/\/\s.*$/, '')))
    .join('\n');

/** Usages d'une API réservée à `platform/` dans les fichiers de `files`, en « fichier:ligne  nom ». */
const platformUses = (files: string[]): string[] =>
  files.flatMap((file) => {
    const lines = withoutComments(fs.readFileSync(new URL(file, SRC), 'utf8')).split('\n');
    return lines.flatMap((line, i) => PLATFORM_ONLY.filter(([, re]) => re.test(line)).map(([name]) => `${file}:${i + 1}  ${name}`));
  });

describe('règle 12 : les API de l’appareil seulement dans platform/', () => {
  const files = sourceFiles(SRC);
  const inPlatform = files.filter((file) => file.startsWith('platform/'));
  const outside = files.filter((file) => !file.startsWith('platform/'));

  it('lit bien platform/ (garde-fou du test lui-même)', () => {
    const uses = platformUses(inPlatform);
    expect(uses.some((u) => u.startsWith('platform/location.ts:') && u.includes('navigator.geolocation'))).toBe(true);
    expect(uses.some((u) => u.startsWith('platform/storage.ts:') && u.endsWith('localStorage'))).toBe(true);
    expect(uses.some((u) => u.includes('@capacitor'))).toBe(true);
    expect(outside.length).toBeGreaterThan(200);
  });

  it('les commentaires ne comptent pas, le code si', () => {
    const probe = '/** localStorage */\n// navigator.vibrate(1)\nconst a = 1; // new Notification\nconst b = window.localStorage;';
    const lines = withoutComments(probe).split('\n');
    expect(lines.map((line) => PLATFORM_ONLY.some(([, re]) => re.test(line)))).toEqual([false, false, false, true]);
    expect(PLATFORM_ONLY.some(([, re]) => re.test("await import('@capgo/background-geolocation')"))).toBe(true);
  });

  it('aucun usage hors de platform/', () => {
    expect(platformUses(outside)).toEqual([]);
  });
});
