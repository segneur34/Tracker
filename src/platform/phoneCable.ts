import { desktopBridge, type DesktopPhoneBridge, type DesktopPhoneState } from './desktopBridge';
import { bridgeValue } from './diskMemory';
import type { ImportEntry } from './memoryFolder';
import { isDesktopApp } from './runtime';

/**
 * Le téléphone branché par câble au programme Windows : son état, le contenu de son dossier `Documents/Tracker`
 * (racine et `sessions/`), et ses fichiers à importer, lus un par un au moment de les ranger. Lecture seule : rien
 * n'est jamais écrit sur le téléphone, le pont n'en a pas le moyen. Ailleurs (navigateur, téléphone, coquille plus
 * ancienne), rien de cela n'existe.
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
 * Fichiers de la racine et de `sessions/` du dossier `Documents/Tracker` du téléphone ; `null` si ce dossier n'y est
 * pas. Lève si le téléphone n'est pas prêt ou s'est perdu en route.
 */
export const listPhoneFiles = async (): Promise<PhoneFile[] | null> => {
  const answer = await requirePhone().lister();
  if (!answer.ok && answer.code === 'NOT_FOUND') return null;
  return (await bridgeValue(Promise.resolve(answer))).map((f) => ({ path: f.chemin, size: f.taille }));
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
