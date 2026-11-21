import type { FolderEntry, MemoryFolder } from './memoryFolder';
import { desktopBridge, type BridgeAnswer, type BridgeErrorCode, type DesktopMemoryBridge, type DesktopRoot } from './desktopBridge';
import { plainError } from './errorText';

/**
 * Dossier mémoire du programme Windows : un vrai dossier du disque, lu et écrit par la coquille (`desktopBridge.ts`).
 * La page ne passe que des chemins relatifs ; l'écriture sans fichier laissé à moitié, la réparation des écritures
 * interrompues et le contrôle des chemins sont du côté de la coquille.
 */

/** Le pont de la mémoire ; lève hors du programme Windows. */
const memoryBridge = (): DesktopMemoryBridge => {
  const bridge = desktopBridge();
  if (!bridge) throw Object.assign(new Error('Programme Windows absent : pas de dossier du disque.'), { code: 'UNKNOWN' });
  return bridge.memoire;
};

/**
 * Phrase à montrer pour une erreur de la coquille : tirée de son code (`plainError`) ;
 * la phrase de la coquille, écrite en français, ne sert qu'à défaut de code connu (`UNKNOWN`).
 */
export const bridgeErrorText = (code: BridgeErrorCode, message: string): string =>
  plainError(Object.assign(new Error(message), { code }));

/**
 * Valeur d'une réponse du pont ; un refus devient une `Error` dont le `code` est lu par `fileErrorCode`, et dont le
 * message est déjà la phrase à montrer (`bridgeErrorText`). Une promesse rejetée (pont rompu) garde son erreur.
 */
export const bridgeValue = async <T,>(call: Promise<BridgeAnswer<T>>): Promise<T> => {
  const answer = await call;
  if (answer.ok) return answer.valeur;
  throw Object.assign(new Error(bridgeErrorText(answer.code, answer.message)), { code: answer.code });
};

/** Appel de la mémoire du pont, rendu en valeur (`bridgeValue`). */
export const callDiskMemory = <T,>(call: (memory: DesktopMemoryBridge) => Promise<BridgeAnswer<T>>): Promise<T> =>
  bridgeValue(call(memoryBridge()));

const splitPath = (path: string): string[] => path.split('/').filter((part) => part !== '');

/** Octets tels que la page les attend : un `Uint8Array` simple, quelle que soit la vue rendue par le pont. */
const plainBytes = (bytes: Uint8Array): Uint8Array =>
  bytes.constructor === Uint8Array ? bytes : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Octets à envoyer : la vue seule, jamais le reste du tampon qui la porte. */
const exactBytes = (bytes: Uint8Array): Uint8Array =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();

export interface DiskFolderOptions {
  /** Où se trouve le dossier, en clair : son chemin complet. */
  label: string;
  /** Sous-dossier de la racine qui tient la mémoire (`Tracker` quand le parent a été choisi), sinon `''`. */
  base?: string;
}

/**
 * Dossier mémoire sur le disque. `racine` : `memoire` pour le dossier retenu, `candidat` pour lire le dossier
 * proposé ou choisi avant de l'adopter (la coquille y refuse toute écriture).
 */
export const createDiskFolder = (racine: DesktopRoot, { label, base = '' }: DiskFolderOptions): MemoryFolder => {
  const at = (path: string) => ({ racine, chemin: [...splitPath(base), ...splitPath(path)].join('/') });
  return {
    kind: 'disk',
    label,
    list: async (path) => (await callDiskMemory((m) => m.lister(at(path)))).map((e): FolderEntry => ({
      name: e.name, kind: e.kind, size: e.size, mtimeMs: e.mtimeMs,
    })),
    readText: (path) => callDiskMemory((m) => m.lireTexte(at(path))),
    writeText: async (path, text) => {
      await callDiskMemory((m) => m.ecrireTexte({ ...at(path), texte: text }));
    },
    readBytes: async (path) => {
      const bytes = await callDiskMemory((m) => m.lireOctets(at(path)));
      return bytes === null ? null : plainBytes(bytes);
    },
    stat: async (path) => {
      const found = await callDiskMemory((m) => m.stat(at(path)));
      return found === null ? null : { size: found.size, mtimeMs: found.mtimeMs };
    },
    writeBytes: async (path, bytes) => {
      await callDiskMemory((m) => m.ecrireOctets({ ...at(path), octets: exactBytes(bytes) }));
    },
    remove: async (path) => {
      await callDiskMemory((m) => m.effacer(at(path)));
    },
  };
};
