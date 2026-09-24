import { registerPlugin } from '@capacitor/core';
import { isNativeApp } from './runtime';
import { jsonStore } from './storage';

/**
 * Le dossier mémoire : seul point d'accès autorisé (`docs/ETAT_DU_PROJET.md` §6).
 *
 * La mémoire de l'application est un dossier ordinaire, qu'on copie pour la
 * sauvegarder ou la déplacer d'un appareil à l'autre :
 *
 *     Tracker/
 *       tracker.json, reglages.json, LISEZMOI.txt
 *       sessions/   un GPX et sa fiche JSON par session
 *
 * Ce module ne sait rien de ce contenu : il lit, écrit et liste des fichiers
 * texte par chemin relatif (`sessions/x.gpx`). La bibliothèque
 * (`hooks/useSessionLibrary.ts`) en tire le sens.
 *
 * Dans le navigateur, une seule implémentation, sur les poignées de dossier
 * du navigateur :
 * - par défaut, la mémoire privée du navigateur (OPFS) : rien à choisir, elle
 *   marche partout, mais on ne la voit pas depuis l'explorateur de fichiers ;
 * - sur demande, un vrai dossier du PC (Chrome et Edge), par exemple la copie
 *   du dossier du téléphone. Sa poignée est gardée dans IndexedDB ; si le
 *   navigateur n'a pas gardé l'autorisation, il faut la redonner d'un geste.
 *
 * Sur le téléphone, l'utilisateur désigne une fois le dossier (en principe
 * `Documents/Tracker`) par le sélecteur d'Android ; le plugin maison
 * `MemoryFolder` (`android/…/MemoryFolderPlugin.java`) garde l'autorisation
 * et y lit et écrit, y compris les fichiers copiés depuis le PC. Tant
 * qu'aucun dossier n'est accessible, les sessions enregistrées attendent dans
 * un dossier privé (`pendingFolder`).
 */

export interface FolderEntry {
  name: string;
  kind: 'file' | 'directory';
  /** Taille en octets, 0 pour un dossier. */
  size: number;
  /** Date de dernière modification, en millisecondes. */
  mtimeMs: number;
}

/** `browser` : mémoire privée du navigateur ; `picked` : dossier choisi sur le PC ; `device` : dossier du téléphone. */
export type MemoryKind = 'browser' | 'picked' | 'device';

export interface MemoryFolder {
  kind: MemoryKind;
  /** Où se trouve le dossier, en clair. */
  label: string;
  /** Contenu d'un sous-dossier (`''` pour la racine) ; vide s'il n'existe pas. */
  list(dir: string): Promise<FolderEntry[]>;
  /** Contenu d'un fichier texte, `null` s'il n'existe pas. */
  readText(path: string): Promise<string | null>;
  /** Écrit un fichier texte, en créant les dossiers qui manquent. */
  writeText(path: string, text: string): Promise<void>;
  /** Efface un fichier ; sans effet s'il n'existe pas. */
  remove(path: string): Promise<void>;
}

export type MemoryAccess =
  | { state: 'ready'; folder: MemoryFolder }
  /** Un dossier a été choisi, mais le navigateur demande de redonner l'autorisation. */
  | { state: 'needs-permission'; label: string }
  /** Aucun dossier accessible : les sessions enregistrées attendent (`pendingFolder`). */
  | { state: 'unavailable'; reason: string };

const splitPath = (path: string): string[] => path.split('/').filter((part) => part !== '');

const isNotFound = (err: unknown): boolean =>
  err instanceof DOMException && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError');

// --- Navigateur : poignées de dossier ---

const createHandleFolder = (root: FileSystemDirectoryHandle, kind: MemoryKind, label: string): MemoryFolder => {
  const dirAt = async (parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> => {
    let dir = root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  };

  return {
    kind,
    label,
    list: async (path) => {
      let dir: FileSystemDirectoryHandle;
      try {
        dir = await dirAt(splitPath(path), false);
      } catch (err) {
        if (isNotFound(err)) return [];
        throw err;
      }
      const entries: FolderEntry[] = [];
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'directory') {
          entries.push({ name, kind: 'directory', size: 0, mtimeMs: 0 });
        } else {
          const file = await handle.getFile();
          entries.push({ name, kind: 'file', size: file.size, mtimeMs: file.lastModified });
        }
      }
      return entries;
    },
    readText: async (path) => {
      const parts = splitPath(path);
      const name = parts.pop();
      if (!name) return null;
      try {
        const dir = await dirAt(parts, false);
        const file = await (await dir.getFileHandle(name)).getFile();
        return await file.text();
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    writeText: async (path, text) => {
      const parts = splitPath(path);
      const name = parts.pop();
      if (!name) throw new Error(`Chemin invalide : ${path}`);
      const dir = await dirAt(parts, true);
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writable.write(text);
      await writable.close();
    },
    remove: async (path) => {
      const parts = splitPath(path);
      const name = parts.pop();
      if (!name) return;
      try {
        await (await dirAt(parts, false)).removeEntry(name);
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    },
  };
};

/** Nom du dossier mémoire, dans la mémoire privée du navigateur comme sur le téléphone. */
export const MEMORY_FOLDER_NAME = 'Tracker';

const openBrowserMemory = async (): Promise<MemoryFolder> => {
  // Demande au navigateur de ne pas vider cette mémoire quand le disque se remplit.
  void navigator.storage.persist?.().catch(() => false);
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(MEMORY_FOLDER_NAME, { create: true });
  return createHandleFolder(dir, 'browser', 'mémoire de ce navigateur');
};

// Poignée du dossier choisi, gardée dans IndexedDB : on ne peut la mettre ni
// dans `localStorage` ni en JSON.
const HANDLE_DB = 'tracker-memoire';
const HANDLE_STORE = 'poignees';
const HANDLE_KEY = 'dossier';

const withHandleStore = <T,>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open(HANDLE_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(HANDLE_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = run(db.transaction(HANDLE_STORE, mode).objectStore(HANDLE_STORE));
      request.onsuccess = () => {
        resolve(request.result);
        db.close();
      };
      request.onerror = () => {
        reject(request.error);
        db.close();
      };
    };
  });

const readSavedHandle = async (): Promise<FileSystemDirectoryHandle | null> => {
  try {
    const handle = await withHandleStore<unknown>('readonly', (store) => store.get(HANDLE_KEY));
    return handle instanceof FileSystemDirectoryHandle ? handle : null;
  } catch {
    return null;
  }
};

const READ_WRITE: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' };

/**
 * Faut-il descendre dans `Tracker` ? Si l'utilisateur a désigné le dossier
 * parent (`Documents`) au lieu du dossier `Tracker` lui-même, oui : c'est
 * l'erreur la plus probable, et elle éparpillerait sinon des fichiers dans
 * `Documents`. `names` : le contenu du dossier désigné.
 */
export const shouldDescendIntoMemory = (pickedName: string, names: ReadonlySet<string>): boolean =>
  pickedName.split('/').pop() !== MEMORY_FOLDER_NAME &&
  !names.has('tracker.json') &&
  !names.has('sessions') &&
  names.has(MEMORY_FOLDER_NAME);

/** Le dossier mémoire dans le dossier désigné (`shouldDescendIntoMemory`). */
const resolveMemoryRoot = async (picked: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> => {
  const names = new Set<string>();
  for await (const name of picked.keys()) names.add(name);
  if (!shouldDescendIntoMemory(picked.name, names)) return picked;
  try {
    return await picked.getDirectoryHandle(MEMORY_FOLDER_NAME);
  } catch {
    return picked;
  }
};

const pickedFolder = async (handle: FileSystemDirectoryHandle): Promise<MemoryFolder> => {
  const root = await resolveMemoryRoot(handle);
  const label = root === handle ? `dossier « ${handle.name} »` : `dossier « ${handle.name}/${root.name} »`;
  return createHandleFolder(root, 'picked', label);
};

// --- Téléphone : dossier choisi par le sélecteur d'Android ---

interface NativeEntry {
  name: string;
  kind: 'file' | 'directory';
  size: number;
  mtimeMs: number;
}

/** Plugin maison, `android/app/src/main/java/io/github/segneur/tracker/MemoryFolderPlugin.java`. */
interface MemoryFolderPlugin {
  /** `persist: false` : accès le temps de la lecture, pas gardé par Android. */
  pickFolder(options?: { persist?: boolean }): Promise<{ uri: string | null; name?: string }>;
  hasAccess(options: { uri: string }): Promise<{ granted: boolean }>;
  list(options: { uri: string; path: string }): Promise<{ entries: NativeEntry[] }>;
  readText(options: { uri: string; path: string }): Promise<{ text: string | null }>;
  writeText(options: { uri: string; path: string; text: string }): Promise<void>;
  remove(options: { uri: string; path: string }): Promise<void>;
}

const nativeFolder = registerPlugin<MemoryFolderPlugin>('MemoryFolder');

/** Dossier choisi sur le téléphone, gardé d'un lancement à l'autre. */
const DEVICE_FOLDER_KEY = 'tracker.memoryFolder';

interface DeviceFolderChoice {
  /** Adresse du dossier désigné, telle qu'Android la rend. */
  uri: string;
  /** Sous-dossier `Tracker` si l'on a désigné son parent, sinon `''`. */
  base: string;
  label: string;
}

const createDeviceFolder = ({ uri, base, label }: DeviceFolderChoice): MemoryFolder => {
  const full = (path: string) => [...splitPath(base), ...splitPath(path)].join('/');
  return {
    kind: 'device',
    label,
    list: async (path) => (await nativeFolder.list({ uri, path: full(path) })).entries,
    readText: async (path) => (await nativeFolder.readText({ uri, path: full(path) })).text,
    writeText: async (path, text) => {
      await nativeFolder.writeText({ uri, path: full(path), text });
    },
    remove: async (path) => {
      await nativeFolder.remove({ uri, path: full(path) });
    },
  };
};

const pickDeviceFolder = async (): Promise<MemoryFolder | null> => {
  const { uri, name } = await nativeFolder.pickFolder();
  if (!uri) return null;
  const pickedName = name ?? 'dossier choisi';
  const { entries } = await nativeFolder.list({ uri, path: '' });
  const descend = shouldDescendIntoMemory(pickedName, new Set(entries.map((e) => e.name)));
  const choice: DeviceFolderChoice = {
    uri,
    base: descend ? MEMORY_FOLDER_NAME : '',
    label: `dossier « ${descend ? `${pickedName}/${MEMORY_FOLDER_NAME}` : pickedName} »`,
  };
  jsonStore.write(DEVICE_FOLDER_KEY, choice);
  return createDeviceFolder(choice);
};

const readDeviceChoice = (): DeviceFolderChoice | null => {
  const choice = jsonStore.read<DeviceFolderChoice>(DEVICE_FOLDER_KEY);
  return choice && typeof choice.uri === 'string' && typeof choice.label === 'string'
    ? { uri: choice.uri, base: typeof choice.base === 'string' ? choice.base : '', label: choice.label }
    : null;
};

const openDeviceFolder = async (): Promise<MemoryAccess> => {
  const choice = readDeviceChoice();
  if (!choice) return { state: 'unavailable', reason: 'Aucun dossier mémoire choisi.' };
  const { granted } = await nativeFolder.hasAccess({ uri: choice.uri });
  return granted
    ? { state: 'ready', folder: createDeviceFolder(choice) }
    : { state: 'needs-permission', label: choice.label };
};

// --- Téléphone : sessions d'un autre dossier, à ajouter à la mémoire ---

type NamedEntry = Pick<FolderEntry, 'name' | 'kind'>;

/**
 * Fichiers à reprendre d'un dossier Tracker copié : GPX et fiches, à sa racine
 * et dans `sessions/`. `root` et `sessions` : contenu de ces deux dossiers.
 */
export const folderImportPaths = (root: readonly NamedEntry[], sessions: readonly NamedEntry[]): string[] => {
  const wanted = (e: NamedEntry) => e.kind === 'file' && /\.(gpx|json)$/i.test(e.name);
  return [
    ...root.filter(wanted).map((e) => e.name),
    ...sessions.filter(wanted).map((e) => `sessions/${e.name}`),
  ];
};

/**
 * Sur le téléphone, fait désigner un dossier (par exemple un dossier Tracker
 * copié depuis le PC) et en rend les GPX et les fiches, sous la même forme
 * que le sélecteur de fichiers du navigateur. `null` si l'utilisateur renonce.
 * L'accès au dossier n'est pas gardé : il n'est lu qu'une fois.
 */
export const pickFolderToImport = async (): Promise<File[] | null> => {
  if (!isNativeApp()) return null;
  const { uri, name } = await nativeFolder.pickFolder({ persist: false });
  if (!uri) return null;
  const root = (await nativeFolder.list({ uri, path: '' })).entries;
  const base = shouldDescendIntoMemory(name ?? '', new Set(root.map((e) => e.name))) ? MEMORY_FOLDER_NAME : '';
  const full = (path: string) => [...splitPath(base), ...splitPath(path)].join('/');
  const list = async (path: string) => (await nativeFolder.list({ uri, path: full(path) })).entries;
  const paths = folderImportPaths(base ? await list('') : root, await list('sessions'));
  const files: File[] = [];
  for (const path of paths) {
    const { text } = await nativeFolder.readText({ uri, path: full(path) });
    if (text !== null) files.push(new File([text], path.split('/').pop()!));
  }
  return files;
};

// --- Choix du dossier, navigateur et téléphone ---

/** Vrai si l'on peut choisir un vrai dossier : sur le téléphone, et dans Chrome et Edge sur ordinateur. */
export const canChooseFolder = (): boolean =>
  isNativeApp() || (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function');

/**
 * Ouvre le sélecteur de dossier, à appeler depuis un clic. Rend `null` si
 * l'utilisateur renonce. Le dossier choisi devient la mémoire.
 */
export const chooseMemoryFolder = async (): Promise<MemoryFolder | null> => {
  if (isNativeApp()) return pickDeviceFolder();
  if (!canChooseFolder()) return null;
  // La fenêtre s'ouvre sur le dossier en service, s'il y en a un : c'est le seul moyen d'en
  // voir le chemin complet, que le navigateur ne donne pas. Sinon, sur Documents.
  const current = await readSavedHandle();
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker!(
      current ? { mode: 'readwrite', startIn: current } : { id: 'tracker-memoire', mode: 'readwrite', startIn: 'documents' }
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
  await withHandleStore('readwrite', (store) => store.put(handle, HANDLE_KEY));
  return pickedFolder(handle);
};

/**
 * Redonne l'autorisation au dossier choisi, à appeler depuis un clic. Sur le
 * téléphone, Android ne sait que le faire désigner à nouveau.
 */
export const reconnectMemoryFolder = async (): Promise<MemoryFolder | null> => {
  if (isNativeApp()) return pickDeviceFolder();
  const handle = await readSavedHandle();
  if (!handle) return null;
  const state = (await handle.requestPermission?.(READ_WRITE)) ?? 'granted';
  return state === 'granted' ? pickedFolder(handle) : null;
};

/** Oublie le dossier choisi : la mémoire revient à celle du navigateur. */
export const forgetChosenFolder = async (): Promise<void> => {
  if (isNativeApp()) {
    jsonStore.write(DEVICE_FOLDER_KEY, null);
    return;
  }
  try {
    await withHandleStore('readwrite', (store) => store.delete(HANDLE_KEY));
  } catch {
    // Rien à oublier.
  }
};

/** Mémoire en service au démarrage : le dossier choisi s'il est accessible, sinon celle du navigateur. */
export const openMemoryFolder = async (): Promise<MemoryAccess> => {
  if (isNativeApp()) return openDeviceFolder();
  const handle = await readSavedHandle();
  if (handle) {
    const state = (await handle.queryPermission?.(READ_WRITE)) ?? 'granted';
    if (state === 'granted') return { state: 'ready', folder: await pickedFolder(handle) };
    return { state: 'needs-permission', label: `dossier « ${handle.name} »` };
  }
  try {
    return { state: 'ready', folder: await openBrowserMemory() };
  } catch (err) {
    return {
      state: 'unavailable',
      reason: err instanceof Error && err.message ? err.message : 'Ce navigateur ne permet pas de garder les sessions.',
    };
  }
};

// --- Téléphone : sessions en attente d'un dossier ---

const filesystem = () => import('@capacitor/filesystem');

/**
 * Dossier privé de l'application, sur le téléphone. Les sessions enregistrées
 * y attendent qu'un dossier mémoire soit accessible : un enregistrement ne
 * doit jamais échouer faute de dossier.
 */
const createPrivateFolder = (base: string): MemoryFolder => {
  const full = (path: string) => [base, ...splitPath(path)].join('/');
  return {
    kind: 'device',
    label: 'dossier privé de l\'application',
    list: async (path) => {
      const { Filesystem, Directory } = await filesystem();
      try {
        const { files } = await Filesystem.readdir({ path: full(path), directory: Directory.Data });
        return files.map((f) => ({
          name: f.name,
          kind: f.type === 'directory' ? 'directory' : 'file',
          size: f.size,
          mtimeMs: f.mtime,
        }));
      } catch {
        return [];
      }
    },
    readText: async (path) => {
      const { Filesystem, Directory, Encoding } = await filesystem();
      try {
        const { data } = await Filesystem.readFile({ path: full(path), directory: Directory.Data, encoding: Encoding.UTF8 });
        return typeof data === 'string' ? data : null;
      } catch {
        return null;
      }
    },
    writeText: async (path, text) => {
      const { Filesystem, Directory, Encoding } = await filesystem();
      await Filesystem.writeFile({
        path: full(path),
        data: text,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
        recursive: true,
      });
    },
    remove: async (path) => {
      const { Filesystem, Directory } = await filesystem();
      try {
        await Filesystem.deleteFile({ path: full(path), directory: Directory.Data });
      } catch {
        // Déjà absent.
      }
    },
  };
};

/**
 * Sessions en attente d'un dossier : dossier privé sur le téléphone, `null`
 * dans le navigateur, où la mémoire du navigateur est toujours là.
 */
export const pendingFolder = (): MemoryFolder | null => (isNativeApp() ? createPrivateFolder('en-attente') : null);
