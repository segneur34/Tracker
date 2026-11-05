import { registerPlugin } from '@capacitor/core';
import { errorMessage } from '../core/basics';
import { isNativeApp } from './runtime';

/**
 * Fichiers de l'application hors du dossier mémoire : seul point d'accès
 * autorisé, avec `memoryFolder.ts` qui tient les sessions.
 *
 * - Le journal de l'enregistrement en cours, dans le dossier privé de
 *   l'application sur le téléphone : personne n'a à le voir, il ne sert qu'à
 *   survivre à un arrêt brutal. Dans le navigateur, il vit en mémoire.
 * - Les fichiers choisis par l'utilisateur (`readPickedFile`) et le
 *   téléchargement d'un GPX ou d'une image dans le navigateur
 *   (`downloadTextFile`, `downloadBlob`), ou
 *   dans Téléchargements, téléphone compris (`saveToDownloads`).
 */

/**
 * Fichier texte asynchrone. La lecture d'un fichier absent rend `null` ; celle
 * d'un fichier présent mais illisible lève une erreur : il ne doit pas être
 * pris pour absent, puis écrasé.
 */
export interface TextFile {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  append(text: string): Promise<void>;
  remove(): Promise<void>;
  /**
   * Met le fichier de côté sous un autre nom, horodaté, à côté de lui, et
   * rend ce nom : le nom d'origine est libre, rien n'est perdu. Lève une
   * erreur si le fichier n'a pas pu être déplacé.
   */
  setAside(): Promise<string>;
}

/** Nom d'un fichier mis de côté : `journal.jsonl` devient `journal-2026-11-03T14-25-01-123Z.jsonl`. */
export const setAsideName = (path: string, nowMs: number): string => {
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-');
  const dot = path.lastIndexOf('.');
  return dot > path.lastIndexOf('/') ? `${path.slice(0, dot)}-${stamp}${path.slice(dot)}` : `${path}-${stamp}`;
};

/** Fichier en mémoire : perdu au rechargement de la page. Un fichier mis de côté y est gardé jusque-là. */
export const createMemoryFile = (name = 'fichier.txt'): TextFile => {
  let content: string | null = null;
  const aside = new Map<string, string>();
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
    setAside: async () => {
      const to = setAsideName(name, Date.now());
      if (content !== null) aside.set(to, content);
      content = null;
      return to;
    },
  };
};

let filesystemLoad: Promise<typeof import('@capacitor/filesystem')> | null = null;

/**
 * Greffon de fichiers de Capacitor, chargé au premier besoin : le seul chargement, pour `files.ts`, `memoryFolder.ts`,
 * `tileCache.ts`. Une seule fois, et gardé : une minute après le passage en arrière-plan, un `import()` ne rend plus la
 * main avant le retour de la page (vu le 04/11, écran éteint : le journal d'une course sans écriture pendant 12 min),
 * alors que les positions arrivent toujours. Un échec n'est pas gardé.
 */
export const filesystem = (): Promise<typeof import('@capacitor/filesystem')> => {
  filesystemLoad ??= import('@capacitor/filesystem').catch((err: unknown) => {
    filesystemLoad = null;
    throw err;
  });
  return filesystemLoad;
};

/** Code du greffon Filesystem pour un fichier qui n'existe pas (`FilesystemErrors.doesNotExist`). */
const FILESYSTEM_DOES_NOT_EXIST = 'OS-PLUG-FILE-0008';

/**
 * L'erreur du greffon Filesystem prouve-t-elle que le fichier n'existe pas ? Son code, ou le texte
 * d'une erreur du système rendue telle quelle. Toute autre erreur ne dit rien de sa présence.
 */
export const isMissingPrivateFile = (err: unknown): boolean =>
  (err as { code?: unknown } | null)?.code === FILESYSTEM_DOES_NOT_EXIST
  || /does not exist|enoent|no such file/i.test(errorMessage(err, ''));

/** Fichier du dossier privé de l'application, sur le téléphone. */
const createPrivateFile = (path: string): TextFile => ({
  read: async () => {
    const { Filesystem, Directory, Encoding } = await filesystem();
    try {
      const { data } = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 });
      if (typeof data !== 'string') throw new Error('contenu inattendu');
      return data;
    } catch (err) {
      // Fichier absent : c'est le cas normal quand aucun enregistrement n'est en cours.
      if (isMissingPrivateFile(err) || !(await privateFileExists(path))) return null;
      // Présent mais illisible (trop gros pour le pont, erreur passagère du stockage) : jamais pris pour absent.
      throw err;
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
  setAside: async () => {
    const { Filesystem, Directory } = await filesystem();
    const to = setAsideName(path, Date.now());
    await Filesystem.rename({ from: path, to, directory: Directory.Data, toDirectory: Directory.Data });
    return to;
  },
});

/**
 * Faux seulement sur une preuve que le fichier n'existe pas dans le dossier privé de l'application :
 * une erreur passagère du stockage le laisse présent, pour qu'un journal illisible ne soit jamais écrasé.
 */
const privateFileExists = async (path: string): Promise<boolean> => {
  const { Filesystem, Directory } = await filesystem();
  try {
    await Filesystem.stat({ path, directory: Directory.Data });
    return true;
  } catch (err) {
    return !isMissingPrivateFile(err);
  }
};

/** Nom du journal de l'enregistrement en cours ; un journal illisible est mis de côté à côté (`recording-journal-<horodatage>.jsonl`). */
const RECORDING_JOURNAL = 'recording-journal.jsonl';

/** Journal de l'enregistrement en cours. */
export const recordingJournal: TextFile = isNativeApp()
  ? createPrivateFile(RECORDING_JOURNAL)
  : createMemoryFile(RECORDING_JOURNAL);

/** Faux sur le téléphone, où les sessions sont dans le dossier mémoire. */
export const canDownloadFiles = (): boolean => !isNativeApp();

/** Propose un fichier texte au téléchargement, dans le navigateur. */
export const downloadTextFile = (fileName: string, content: string, mimeType = 'application/gpx+xml'): void =>
  downloadBlob(fileName, new Blob([content], { type: mimeType }));

/** Propose un fichier au téléchargement, dans le navigateur (l'image de partage, faute de partage). */
export const downloadBlob = (fileName: string, blob: Blob): void => {
  const url = URL.createObjectURL(blob);
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

/** Noms que Windows réserve à ses périphériques, avec ou sans extension, quelle que soit la casse. */
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** Caractères refusés par Windows ou Android dans un nom (les caractères de contrôle s'y ajoutent). */
const FORBIDDEN_NAME_CHARS = String.raw`\/:*?"<>|`;

/** Longueur maximale d'un nom, en caractères : laisse la place de l'extension sous les 255 octets des systèmes de fichiers. */
const FILE_NAME_MAX_LENGTH = 100;

/**
 * Nom de fichier sûr, pour un nom neuf (téléchargement, partage) : sans les
 * caractères refusés par Windows ou Android ni les caractères de contrôle,
 * espaces resserrées, sans point en tête ni en fin, un nom réservé de Windows
 * suivi de « _ », borné à `FILE_NAME_MAX_LENGTH` caractères. Les noms de la
 * mémoire ne passent pas par ici.
 */
export const safeFileName = (name: string): string => {
  const replaced = Array.from(name, (c) => (FORBIDDEN_NAME_CHARS.includes(c) || c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c)).join('');
  const cleaned = replaced.replace(/\s+/g, ' ').trim();
  const bounded = Array.from(cleaned).slice(0, FILE_NAME_MAX_LENGTH).join('');
  const plain = bounded.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  return WINDOWS_RESERVED_NAME.test(plain.split('.')[0].trim()) ? `${plain}_` : plain;
};

/** Contenu texte d'un fichier choisi par l'utilisateur. */
export const readPickedFile = (file: File): Promise<string> => file.text();

/** Contenu binaire d'un fichier choisi par l'utilisateur (capteurs d'une session importée). */
export const readPickedBytes = async (file: File): Promise<Uint8Array> => new Uint8Array(await file.arrayBuffer());

/**
 * Image choisie par l'utilisateur (photo du Profil), recadrée au carré central
 * et réduite à `sizePx` de côté, en data URL JPEG : quelques dizaines de Ko,
 * qui tiennent dans le stockage. L'orientation de l'appareil photo (EXIF) est
 * appliquée au décodage. Un fichier qui n'est pas une image lève une erreur.
 */
export const readPickedImage = async (file: File, sizePx: number): Promise<string> => {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = sizePx;
    canvas.height = sizePx;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image impossible à réduire.');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, sizePx, sizePx);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    bitmap.close();
  }
};
