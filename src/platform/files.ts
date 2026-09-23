import { isNativeApp } from './runtime';

/**
 * Fichiers de l'application : seul point d'accès autorisé.
 *
 * Sur le téléphone, deux emplacements aux rôles distincts :
 * - le journal de l'enregistrement en cours, dans le dossier privé de
 *   l'application : personne n'a à le voir, il ne sert qu'à survivre à un
 *   arrêt brutal ;
 * - les sessions terminées, un GPX chacune, dans `Documents/Tracker` : visibles
 *   depuis le PC par câble USB, lisibles par d'autres applications, et
 *   conservées si l'application est désinstallée.
 *
 * Dans le navigateur, le journal vit en mémoire et rien n'est écrit : le GPX
 * se télécharge d'un clic (`downloadTextFile`).
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

/** Dossier des sessions, sous `Documents` du téléphone. */
export const SESSIONS_FOLDER = 'Tracker';

/**
 * Range une session terminée et rend, en clair, l'endroit où elle se trouve.
 * Dans le navigateur, rien n'est écrit : la session reste en mémoire, prête à
 * être analysée ou téléchargée.
 */
export const saveSessionFile = async (fileName: string, content: string): Promise<string> => {
  if (!isNativeApp()) return 'mémoire du navigateur (à télécharger)';
  const { Filesystem, Directory, Encoding } = await filesystem();
  await Filesystem.writeFile({
    path: `${SESSIONS_FOLDER}/${fileName}`,
    data: content,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  return `Documents/${SESSIONS_FOLDER}/${fileName}`;
};

/** Faux sur le téléphone, où les sessions sont déjà rangées dans `Documents`. */
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

/** Contenu texte d'un fichier choisi par l'utilisateur. */
export const readPickedFile = (file: File): Promise<string> => file.text();
