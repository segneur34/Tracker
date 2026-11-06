import { describe, expect, it } from 'vitest';

/**
 * Découpage de la bibliothèque (lot 113) : chaque partie de `hooks/sessionLibrary/` n'importe que les parties
 * avant elle (aucun cycle, aucun import à rebours) ; le point d'entrée `hooks/useSessionLibrary.ts` garde ses
 * exports, et le code de l'application ne passe que par lui.
 */

interface Fs {
  readdirSync(dir: URL, options: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
  readFileSync(file: URL, encoding: 'utf8'): string;
}
// Les types de Node ne sont pas ceux de l'app (voir `hooks/mediaQueries.test.ts`) : le peu qui sert est décrit à la main.
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;

const HERE = new URL('./', import.meta.url);
const SRC = new URL('../../', import.meta.url);

/** Les couches, de la plus basse à la plus haute. */
const LAYERS = [
  'store', 'memory', 'summarySettings', 'recordWrites', 'cache', 'scan', 'summaryQueue', 'deviceSettings',
  'addSession', 'pending', 'importer', 'incoming', 'sessionRecords', 'lifecycle',
] as const;

/** Valeurs exportées par le point d'entrée, les mêmes qu'avant le découpage (et cinq types). */
const ENTRY_VALUES = [
  'adoptSettingsFile', 'answerImportQuestion', 'canChooseMemoryFolder', 'canImportSessions', 'chooseFolder', 'currentMemoryFolder', 'dismissIncomingNotice', 'dismissLibraryMessage',
  'dismissSettingsOffer', 'findLibrarySession', 'hasSessionMotion', 'importEntries', 'importFiles', 'importFromFolder',
  'importSettingsFile', 'librarySession', 'loadFullSession', 'loadSessionGpx', 'openLibrary', 'queueOutdatedRefresh',
  'readLibraryState', 'readSessionExport', 'readSessionGpx', 'readSessionMotion', 'reconnectFolder', 'refreshLibrary',
  'removeSession', 'renameDevice', 'reportStartupError', 'saveRecordedSession', 'settingsUpgraded', 'startIncomingFiles', 'startLibraryUi',
  'summarizeGpxText', 'switchToBrowserMemory', 'updateSessionRecord', 'useLibraryFields', 'useLibrarySelector',
  'useLibrarySession', 'useSessionName',
];
const ENTRY_TYPES = ['AddResult', 'AddStatus', 'LibraryState', 'LibraryStatus', 'SettingsFileInfo'];

const isCode = (name: string): boolean => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.fixture\.ts$/.test(name);

/** Modules importés ou réexportés par un texte (`from '…'`, `import('…')`). */
const importsOf = (text: string): string[] =>
  [...text.matchAll(/\bfrom\s+'([^']+)'|\bimport\(\s*'([^']+)'\s*\)/g)].map((m) => m[1] ?? m[2]);

/** Fichiers de code de `src/`, chemins relatifs à `src/`. */
const codeFiles = (dir: URL, prefix = ''): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name === 'test' ? [] : codeFiles(new URL(`${e.name}/`, dir), `${prefix}${e.name}/`);
    return isCode(e.name) ? [`${prefix}${e.name}`] : [];
  });

describe('couches de la bibliothèque (lot 113)', () => {
  it('chaque partie est rangée dans une couche, et seules elles sont dans le dossier', () => {
    const parts = fs.readdirSync(HERE, { withFileTypes: true }).map((e) => e.name).filter(isCode).map((n) => n.replace(/\.ts$/, ''));
    expect([...parts].sort()).toEqual([...LAYERS].sort());
  });

  it("chaque partie n'importe que des couches plus basses", () => {
    const backwards: string[] = [];
    let read = 0;
    LAYERS.forEach((layer, index) => {
      const text = fs.readFileSync(new URL(`${layer}.ts`, HERE), 'utf8');
      for (const spec of importsOf(text)) {
        const m = /^\.\/([\w]+)$/.exec(spec);
        if (!m) {
          // Hors du dossier : jamais le point d'entrée, qui est au-dessus de toutes les couches.
          if (/useSessionLibrary$/.test(spec)) backwards.push(`${layer} → ${spec}`);
          continue;
        }
        read += 1;
        const target = LAYERS.indexOf(m[1] as (typeof LAYERS)[number]);
        if (target < 0 || target >= index) backwards.push(`${layer} → ${m[1]}`);
      }
    });
    expect(backwards).toEqual([]);
    // Garde-fou du test lui-même : les imports entre parties sont bien lus.
    expect(read).toBeGreaterThan(LAYERS.length);
  });

  it("le code de l'application ne passe que par le point d'entrée", () => {
    const files = codeFiles(SRC);
    expect(files.length).toBeGreaterThan(100);
    const direct = files.filter((file) => !file.startsWith('hooks/sessionLibrary/') && file !== 'hooks/useSessionLibrary.ts')
      .filter((file) => importsOf(fs.readFileSync(new URL(file, SRC), 'utf8')).some((spec) => /sessionLibrary\//.test(spec)));
    expect(direct).toEqual([]);
  });

  it("le point d'entrée garde ses exports : les mêmes valeurs, et ses types réexportés", async () => {
    const entry = await import('../useSessionLibrary');
    expect(Object.keys(entry).sort()).toEqual([...ENTRY_VALUES].sort());
    const text = fs.readFileSync(new URL('../useSessionLibrary.ts', import.meta.url), 'utf8');
    const types = [...text.matchAll(/export type \{([^}]*)\}/g)].flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean));
    expect(types.sort()).toEqual(ENTRY_TYPES);
  });
});
