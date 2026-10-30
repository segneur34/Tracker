import type { FolderEntry, MemoryFolder } from '../platform/memoryFolder';

/** Fichier de test seulement : le code de l'application ne l'importe pas. */

/** Fichiers directs (ou du sous-dossier `dir`) du faux dossier, `sizeOf` donnant la taille de chacun. */
export const fakeEntries = (files: Map<string, string>, dir: string, sizeOf: (path: string) => number = () => 1): FolderEntry[] =>
  [...files.keys()]
    .filter((path) => (dir === '' ? !path.includes('/') : path.startsWith(`${dir}/`)))
    .map((path) => ({ name: dir === '' ? path : path.slice(dir.length + 1), kind: 'file' as const, size: sizeOf(path), mtimeMs: 1 }));

/**
 * Faux dossier mémoire en mémoire vive : `files` (chemin → texte) en est le contenu, `log` reçoit
 * « write chemin » et « remove chemin » dans l'ordre. Les octets ne s'écrivent pas. `overrides` remplace
 * une opération (suppression différée, écriture refusée…).
 */
export const createFakeFolder = (
  files: Map<string, string>,
  log: string[],
  overrides: Partial<MemoryFolder> = {},
  sizeOf?: (path: string) => number,
): MemoryFolder => ({
  kind: 'picked',
  label: 'Tracker',
  list: async (dir) => fakeEntries(files, dir, sizeOf),
  readText: async (path) => files.get(path) ?? null,
  writeText: async (path, text) => {
    log.push(`write ${path}`);
    files.set(path, text);
  },
  readBytes: async () => null,
  writeBytes: async () => undefined,
  remove: async (path) => {
    log.push(`remove ${path}`);
    files.delete(path);
  },
  ...overrides,
});
