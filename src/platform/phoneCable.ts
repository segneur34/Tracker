import { desktopBridge, type BridgeAnswer, type DesktopPhoneBridge, type DesktopPhoneFile, type DesktopPhoneState } from './desktopBridge';
import { bridgeValue } from './diskMemory';
import type { FolderEntry, ImportEntry, MemoryFolder } from './memoryFolder';
import { isDesktopApp } from './runtime';

/** Dossier de la corbeille à la racine de la mémoire (`TRASH_DIR` de `library/trash.ts`, tenu égal par un test). */
export const PHONE_TRASH_DIR = 'corbeille';

/**
 * Le téléphone branché par câble au programme Windows : son état, le contenu de son dossier `Documents/Tracker`
 * (racine, `sessions/`, `itineraires/`, `reglages/`, `journaux/`), ses fichiers à importer, lus un par un au moment
 * de les ranger, et ce dossier sous la forme d'un dossier mémoire (`phoneMemoryFolder`, sorte `phone`) qui écrit par
 * la coquille et dépose dans la corbeille de la mémoire du téléphone. Rien n'efface jamais un fichier du téléphone :
 * le pont n'en a pas le moyen. Ailleurs (navigateur, téléphone, coquille plus ancienne), rien de cela n'existe.
 */

export type PhoneState = DesktopPhoneState;

/** Fichier du téléphone : chemin relatif à `Documents/Tracker`, séparé par `/` ; taille en octets. */
export interface PhoneFile {
  path: string;
  size: number;
}

/** Le pont du téléphone, `null` hors du programme Windows ou dans une coquille qui ne le lit pas. */
const phoneBridge = (): DesktopPhoneBridge | null => {
  if (!isDesktopApp()) return null;
  const phone = desktopBridge()?.telephone;
  return phone && typeof phone.etat === 'function' && typeof phone.lister === 'function' && typeof phone.lireOctets === 'function'
    ? phone
    : null;
};

/** Vrai dans le programme Windows dont la coquille lit le téléphone branché. */
export const phoneCableAvailable = (): boolean => phoneBridge() !== null;

const requirePhone = (): DesktopPhoneBridge => {
  const phone = phoneBridge();
  if (!phone) throw Object.assign(new Error('Ce programme ne sait pas lire un téléphone branché.'), { code: 'UNKNOWN' });
  return phone;
};

/** État du téléphone ; lève sur une panne imprévue, avec la phrase à montrer. */
export const phoneState = (): Promise<PhoneState> => bridgeValue(requirePhone().etat());

/**
 * Fichiers de la racine et des sous-dossiers listés du dossier `Documents/Tracker` du téléphone ; `null` si ce
 * dossier n'y est pas. Lève si le téléphone n'est pas prêt ou s'est perdu en route.
 */
export const listPhoneFiles = async (): Promise<PhoneFile[] | null> => {
  const files = await listedFiles();
  return files === null ? null : files.map((f) => ({ path: f.chemin, size: f.taille }));
};

/** Le listage de la coquille, date comprise ; `null` sans dossier `Documents/Tracker`. */
const listedFiles = async (): Promise<DesktopPhoneFile[] | null> => {
  const answer = await requirePhone().lister();
  if (!answer.ok && answer.code === 'NOT_FOUND') return null;
  return phoneValue(Promise.resolve(answer));
};

/** Pont d'une coquille qui sait écrire et mettre de côté sur le téléphone. */
type WritablePhoneBridge = DesktopPhoneBridge & Required<Pick<DesktopPhoneBridge, 'enregistrement' | 'ecrireOctets' | 'listerCorbeille' | 'mettreDeCote'>>;

const writable = (phone: DesktopPhoneBridge | null): phone is WritablePhoneBridge =>
  typeof phone?.enregistrement === 'function'
  && typeof phone.ecrireOctets === 'function'
  && typeof phone.listerCorbeille === 'function'
  && typeof phone.mettreDeCote === 'function';

/** Vrai dans le programme Windows dont la coquille sait écrire et mettre de côté sur le téléphone ; faux pour une plus ancienne. */
export const phoneCanWrite = (): boolean => writable(phoneBridge());

const requireWriter = (): WritablePhoneBridge => {
  const phone = requirePhone();
  if (!writable(phone)) throw Object.assign(new Error('Ce programme est trop ancien pour écrire sur le téléphone : installez sa dernière version.'), { code: 'UNKNOWN' });
  return phone;
};

/**
 * Phrase de la coquille quand le téléphone enregistre une session (`MESSAGE_ENREGISTREMENT` de `bureau/telephone.ts`,
 * tenue égale par un test) : une écriture ou un retrait refusé pour cette raison la porte.
 */
export const PHONE_RECORDING_MESSAGE = "Le téléphone enregistre une session : rien n'y est écrit pendant ce temps.";

/**
 * Valeur d'une réponse de la coquille pour une écriture ou un retrait. Un refus garde la phrase de la coquille et son
 * code : `bridgeValue` mettrait un `PERMISSION` en « Autorisation refusée », qui ne veut rien dire pour le téléphone.
 * Un refus parce que le téléphone enregistre est marqué (`isPhoneRecordingError`).
 */
const phoneValue = async <T,>(call: Promise<BridgeAnswer<T>>): Promise<T> => {
  const answer = await call;
  if (answer.ok) return answer.valeur;
  throw Object.assign(new Error(answer.message), { code: answer.code, phoneRecording: answer.message === PHONE_RECORDING_MESSAGE });
};

/** Vrai si l'erreur dit que le téléphone enregistre une session : rien n'y a été écrit ni retiré. */
export const isPhoneRecordingError = (err: unknown): boolean =>
  err instanceof Error && (err as Error & { phoneRecording?: unknown }).phoneRecording === true;

/**
 * Copie de sécurité des deux dossiers, faite par la coquille avant la première synchronisation d'un téléphone ; rend
 * le chemin de la copie. Lève, avec la phrase à montrer, si elle n'a pas pu se faire ou si la coquille ne la sait pas :
 * la synchronisation est alors refusée.
 */
export const phoneSafetyCopy = async (): Promise<string> => {
  const phone = requirePhone();
  if (typeof phone.copieSecurite !== 'function') {
    throw Object.assign(new Error('ce programme est trop ancien pour faire la copie de sécurité ; installez sa dernière version'), { code: 'UNKNOWN' });
  }
  return phoneValue(phone.copieSecurite());
};

/**
 * Vrai si la copie de sécurité `path` (rendue par `phoneSafetyCopy`) est encore là et non vide ; faux dans le doute,
 * ou pour une coquille qui ne sait pas le dire : la copie est alors refaite.
 */
export const phoneSafetyCopyExists = async (path: string): Promise<boolean> => {
  const phone = requirePhone();
  if (typeof phone.copieExiste !== 'function') return false;
  return phoneValue(phone.copieExiste({ chemin: path })).catch(() => false);
};

/** Vrai si l'application du téléphone enregistre une session (rien n'y est alors écrit) ; après un `listPhoneFiles`. */
export const phoneIsRecording = (): Promise<boolean> => phoneValue(requireWriter().enregistrement());

/**
 * Le dossier `Documents/Tracker` du téléphone branché, sous la forme d'un dossier mémoire, et ce qu'il sait de plus :
 * déposer un fichier dans la corbeille de sa mémoire, dire les sous-dossiers qu'elle tient, dire si le téléphone
 * enregistre.
 */
export interface PhoneMemoryFolder extends MemoryFolder {
  kind: 'phone';
  /**
   * Déplace un fichier du dernier listage (`sessions/` ou `itineraires/`) dans un dépôt de la corbeille, sous `to`
   * (`corbeille/<dépôt>/<même nom>`, voir `phoneDepositPaths`), sans jamais écraser ce qui y est ; la coquille le
   * refuse si le dépôt ne tient pas déjà `depose.json`. Sans effet pour un fichier que le dernier listage ne porte pas.
   */
  moveAside(path: string, to: string): Promise<void>;
  /** Noms des sous-dossiers de la corbeille de la mémoire du téléphone, pour y choisir un dépôt neuf (`trashDirName`). */
  asideTaken(): Promise<string[]>;
  /** Vrai si l'application du téléphone enregistre une session : rien n'y est alors écrit ni retiré. */
  recording(): Promise<boolean>;
}

/** Chemin relatif sans barre en trop (`/sessions/` comme `sessions`). */
const cleanPath = (path: string): string => path.split('/').filter((part) => part !== '').join('/');

/** Octets à envoyer : la vue seule, jamais le reste du tampon qui la porte. */
const exactBytes = (bytes: Uint8Array): Uint8Array =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();

/**
 * Le dossier `Documents/Tracker` du téléphone branché, sous la forme de tout dossier mémoire (sorte `phone`), pour le
 * comparer au dossier du PC et y recopier des fichiers. Il tient le dernier listage du téléphone :
 * - `list` relit le téléphone à chaque appel (les dossiers se déduisent des fichiers : un dossier vide n'apparaît pas) ;
 * - `readBytes`, `readText` et `stat` répondent d'après ce listage, fait au premier besoin : `null` pour un fichier
 *   qu'il ne porte pas ;
 * - `writeBytes` et `writeText` écrivent par la coquille (`nom.tracker-new`, taille relue, `mv -f`) et tiennent le
 *   listage à jour, date du téléphone comprise ;
 * - `remove` lève toujours : rien ne s'efface du téléphone, un retrait passe par `moveAside`.
 * La coquille n'admet l'écriture que dans sa liste fermée (`sessions/`, `itineraires/`, `reglages/`, `tracker.json`,
 * `fc-repos.json`, et `corbeille/<dépôt>/depose.json` seul), le retrait que de `sessions/` et d'`itineraires/` vers un
 * dépôt qui tient `depose.json`, et rien pendant un enregistrement : ailleurs, ces appels lèvent. Lève dans une coquille trop ancienne pour écrire (`phoneCanWrite`).
 */
export const phoneMemoryFolder = (label: string): PhoneMemoryFolder => {
  const phone = requireWriter();
  let listed: Map<string, DesktopPhoneFile> | null = null;

  const refresh = async (): Promise<Map<string, DesktopPhoneFile>> => {
    listed = null;
    const fresh = new Map(((await listedFiles()) ?? []).map((f) => [f.chemin, f]));
    listed = fresh;
    return fresh;
  };
  const current = (): Promise<Map<string, DesktopPhoneFile>> => (listed ? Promise.resolve(listed) : refresh());

  const readBytes = async (path: string): Promise<Uint8Array | null> => {
    const chemin = cleanPath(path);
    if (!(await current()).has(chemin)) return null;
    return phoneValue(phone.lireOctets({ chemin }));
  };

  const writeBytes = async (path: string, bytes: Uint8Array): Promise<void> => {
    const chemin = cleanPath(path);
    const files = await current();
    const written = await phoneValue(phone.ecrireOctets({ chemin, octets: exactBytes(bytes) }));
    files.set(chemin, written);
  };

  return {
    kind: 'phone',
    label,
    list: async (dir) => {
      const prefix = cleanPath(dir) === '' ? '' : `${cleanPath(dir)}/`;
      const entries: FolderEntry[] = [];
      const dirs = new Set<string>();
      for (const f of (await refresh()).values()) {
        if (!f.chemin.startsWith(prefix)) continue;
        const rest = f.chemin.slice(prefix.length);
        const cut = rest.indexOf('/');
        if (cut < 0) entries.push({ name: rest, kind: 'file', size: f.taille, mtimeMs: f.dateMs });
        else dirs.add(rest.slice(0, cut));
      }
      for (const name of dirs) entries.push({ name, kind: 'directory', size: 0, mtimeMs: 0 });
      return entries;
    },
    readBytes,
    readText: async (path) => {
      const bytes = await readBytes(path);
      return bytes === null ? null : new TextDecoder().decode(bytes);
    },
    stat: async (path) => {
      const f = (await current()).get(cleanPath(path));
      return f ? { size: f.taille, mtimeMs: f.dateMs } : null;
    },
    writeBytes,
    writeText: (path, text) => writeBytes(path, new TextEncoder().encode(text)),
    remove: async (path) => {
      throw Object.assign(new Error(`Rien ne s'efface du téléphone (${path}) : un retrait passe par sa corbeille.`), { code: 'UNKNOWN' });
    },
    moveAside: async (path, to) => {
      const chemin = cleanPath(path);
      const files = await current();
      if (!files.has(chemin)) return;
      await phoneValue(phone.mettreDeCote({ chemin, vers: to }));
      files.delete(chemin);
    },
    asideTaken: () => phoneValue(phone.listerCorbeille({ dossier: PHONE_TRASH_DIR })),
    recording: async () => {
      await current();
      return phoneValue(phone.enregistrement());
    },
  };
};

/** Erreur d'une lecture après que le téléphone a été débranché. */
const unpluggedError = (): Error => Object.assign(new Error('téléphone débranché'), { code: 'UNKNOWN' });

/** Fichiers à importer depuis le téléphone, et ce qui s'est passé pendant leur lecture. */
export interface PhoneImport {
  entries: ImportEntry[];
  /** Vrai dès qu'une lecture a échoué et que le téléphone n'était plus prêt : les lectures suivantes échouent aussitôt. */
  unplugged(): boolean;
}

const extensionOf = (path: string): string => /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';

/** Clé qui rapproche un GPX de sa fiche et de ses capteurs : chemin sans extension, en minuscules. */
const keyOf = (path: string): string => path.replace(/\.(gpx|fit|json|imu)$/i, '').toLowerCase();

/**
 * Les fichiers `paths` du téléphone (rendus par le dernier `listPhoneFiles`), en `ImportEntry` lus à la demande par
 * le pont. `onRead` est appelé après chaque fichier lu, une fois par chemin.
 *
 * Une session entre entière ou pas du tout : lire un GPX lit aussi sa fiche (`.json`) et ses capteurs (`.imu`), gardés
 * jusqu'à ce que l'import les demande ; si l'un d'eux échoue, la lecture du GPX échoue et rien n'est rangé.
 *
 * Débranchement : à la première lecture en échec, l'état du téléphone est redemandé ; s'il n'est plus prêt, cette
 * lecture et toutes les suivantes échouent aussitôt (`unplugged`), sans plus rien demander au téléphone.
 */
export const phoneImportEntries = (paths: readonly string[], onRead: (path: string) => void = () => undefined): PhoneImport => {
  const phone = requirePhone();
  let unplugged = false;
  const seen = new Set<string>();
  /** Fiches et capteurs lus avec leur GPX, rendus une fois puis relâchés. */
  const held = new Map<string, Uint8Array>();
  const companions = new Map<string, string[]>();
  for (const path of paths) {
    const ext = extensionOf(path);
    if (ext !== 'json' && ext !== 'imu') continue;
    const key = keyOf(path);
    companions.set(key, [...(companions.get(key) ?? []), path]);
  }

  const fetchBytes = async (path: string): Promise<Uint8Array> => {
    if (unplugged) throw unpluggedError();
    let bytes: Uint8Array;
    try {
      bytes = await bridgeValue(phone.lireOctets({ chemin: path }));
    } catch (err) {
      const state = await bridgeValue(phone.etat()).catch(() => null);
      if (state?.etat !== 'pret') {
        unplugged = true;
        throw unpluggedError();
      }
      throw err;
    }
    if (!seen.has(path)) {
      seen.add(path);
      onRead(path);
    }
    return bytes;
  };

  const readBytes = async (path: string): Promise<Uint8Array> => {
    const kept = held.get(path);
    if (kept) {
      held.delete(path);
      return kept;
    }
    if (extensionOf(path) !== 'gpx') return fetchBytes(path);
    const bytes = await fetchBytes(path);
    const others = companions.get(keyOf(path)) ?? [];
    try {
      for (const other of others) held.set(other, await fetchBytes(other));
    } catch (err) {
      for (const other of others) held.delete(other);
      throw err;
    }
    return bytes;
  };

  const entries = paths.map((path): ImportEntry => ({
    name: path.split('/').pop() ?? path,
    key: keyOf(path),
    readBytes: () => readBytes(path),
    readText: async () => new TextDecoder().decode(await readBytes(path)),
  }));
  return { entries, unplugged: () => unplugged };
};
