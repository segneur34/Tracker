import { registerPlugin } from '@capacitor/core';
import { isNativeApp } from './runtime';

/**
 * Fichiers de l'application hors du dossier mémoire : seul point d'accès
 * autorisé, avec `memoryFolder.ts` qui tient les sessions.
 *
 * - Le journal de l'enregistrement en cours, dans le dossier privé de
 *   l'application sur le téléphone : personne n'a à le voir, il ne sert qu'à
 *   survivre à un arrêt brutal. Dans le navigateur, il vit en mémoire.
 * - Les fichiers choisis par l'utilisateur (`readPickedFile`) et le
 *   téléchargement d'un GPX dans le navigateur (`downloadTextFile`), ou
 *   dans Téléchargements, téléphone compris (`saveToDownloads`).
 */

/** Fichier texte asynchrone. La lecture d'un fichier absent rend `null`. */
export interface TextFile {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  append(text: string): Promise<void>;
  remove(): Promise<void>;
}

/** Fichier en mémoire : perdu au rechargement de la page. */
export const createMemoryFile = (): TextFile => {
  let content: string | null = null;
  return {
    read: async () => content,
    write: async (text) => {
      content = text;
    },
    append: async (text) => {
      content = (content ?? '') + text;
    },
    remove: async () => {
      content = null;
    },
  };
};

const filesystem = () => import('@capacitor/filesystem');

/** Fichier du dossier privé de l'application, sur le téléphone. */
const createPrivateFile = (path: string): TextFile => ({
  read: async () => {
    const { Filesystem, Directory, Encoding } = await filesystem();
    try {
      const { data } = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 });
      return typeof data === 'string' ? data : null;
    } catch {
      // Fichier absent : c'est le cas normal quand aucun enregistrement n'est en cours.
      return null;
    }
  },
  write: async (text) => {
    const { Filesystem, Directory, Encoding } = await filesystem();
    await Filesystem.writeFile({ path, data: text, directory: Directory.Data, encoding: Encoding.UTF8 });
  },
  append: async (text) => {
    const { Filesystem, Directory, Encoding } = await filesystem();
    await Filesystem.appendFile({ path, data: text, directory: Directory.Data, encoding: Encoding.UTF8 });
  },
  remove: async () => {
    const { Filesystem, Directory } = await filesystem();
    try {
      await Filesystem.deleteFile({ path, directory: Directory.Data });
    } catch {
      // Déjà absent.
    }
  },
});

/** Journal de l'enregistrement en cours. */
export const recordingJournal: TextFile = isNativeApp()
  ? createPrivateFile('recording-journal.jsonl')
  : createMemoryFile();

/** Faux sur le téléphone, où les sessions sont dans le dossier mémoire. */
export const canDownloadFiles = (): boolean => !isNativeApp();

/** Propose un fichier texte au téléchargement, dans le navigateur. */
export const downloadTextFile = (fileName: string, content: string, mimeType = 'application/gpx+xml'): void => {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Libérée au tour suivant : certains navigateurs lisent l'URL après le clic.
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

interface DownloadsPlugin {
  saveText(options: { name: string; text: string }): Promise<{ uri: string }>;
}

const downloads = registerPlugin<DownloadsPlugin>('Downloads');

/**
 * Dépose un fichier texte dans le dossier Téléchargements : par le navigateur
 * sur le PC, par `DownloadsPlugin.java` (MediaStore, Android 10 et plus, sans
 * permission) sur le téléphone. Un échec y est levé, message en clair.
 */
export const saveToDownloads = async (fileName: string, content: string): Promise<void> => {
  if (!isNativeApp()) {
    downloadTextFile(fileName, content);
    return;
  }
  await downloads.saveText({ name: fileName, text: content });
};

/** Nom de fichier sans les caractères refusés par Windows ou Android, espaces resserrées. */
export const safeFileName = (name: string): string => name.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();

/** Contenu texte d'un fichier choisi par l'utilisateur. */
export const readPickedFile = (file: File): Promise<string> => file.text();

/** Contenu binaire d'un fichier choisi par l'utilisateur (capteurs d'une session importée). */
export const readPickedBytes = async (file: File): Promise<Uint8Array> => new Uint8Array(await file.arrayBuffer());
