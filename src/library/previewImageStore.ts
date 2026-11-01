import { previewImageFiles, type PreviewImageBackend } from '../platform/previewImages';
import { onPageHidden } from '../platform/previewStore';
import {
  PREVIEW_IMAGE_DEFAULTS, PREVIEW_IMAGE_INDEX_VERSION, parsePreviewImageIndex, previewImageName,
  type PreviewImageIndex, type PreviewImageStoreOptions, type StoredPreviewImage,
} from './previewImages';
import { previewEntriesToEvict, unknownPreviewKeys } from './previewTracks';

/**
 * Images finies des vignettes de la bibliothèque, gardées sur l'appareil d'un
 * lancement à l'autre (lot 121) : un PNG par session, sous la clé complète de
 * son image (`previewImageKey`), et un index lu une fois au premier besoin,
 * tenu en mémoire, réécrit `writeDelayMs` après le dernier changement et
 * aussitôt quand la page est cachée. Les moins récemment vues sont oubliées
 * d'abord au-delà de `maxBytes`. Aucune erreur ne remonte : un index illisible
 * est un index vide, une image illisible une image absente.
 *
 * Ordre d'écriture : l'image sous son propre nom (tiré de sa clé), puis
 * l'index en mémoire, puis l'ancienne image effacée. Deux images différentes
 * n'ayant jamais le même nom, un arrêt brutal laisse au pire une entrée sans
 * fichier (retirée à la lecture) ou un fichier sans entrée (effacé au
 * lancement suivant), jamais une image fausse.
 */

export interface PreviewImageStore {
  /** Image gardée de la session `sessionKey` si sa clé est `imageKey` (sinon `null`) ; la marque vue. */
  stored(sessionKey: string, imageKey: string): Promise<Blob | null>;
  /** Garde l'image d'une session, à la place de la précédente ; une image plus grosse que la borne ne l'est pas. */
  keep(sessionKey: string, imageKey: string, png: Blob): Promise<void>;
  /** Oublie les images des sessions que la bibliothèque complète ne porte pas (`unknownPreviewKeys`). */
  prune(folderLabel: string | null, files: Iterable<string>): Promise<void>;
  /** Réécrit l'index s'il a changé depuis sa dernière écriture. */
  flush(): Promise<void>;
}

/**
 * Magasin sur `backend`. La date de dernière vue d'une image relue n'est
 * rangée qu'avec la prochaine écriture de l'index : relire les vignettes ne
 * réécrit rien à chaque lancement.
 */
export const createPreviewImageStore = (
  backend: PreviewImageBackend,
  options: PreviewImageStoreOptions = PREVIEW_IMAGE_DEFAULTS
): PreviewImageStore => {
  let held: Promise<Map<string, StoredPreviewImage>> | null = null;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Images en cours d'écriture, pas encore dans l'index : le ménage des orphelins ne les touche pas. */
  const writing = new Set<string>();

  const flush = async (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty || !held) return;
    dirty = false;
    const index: PreviewImageIndex = { version: PREVIEW_IMAGE_INDEX_VERSION, entries: {} };
    for (const [key, entry] of await held) index.entries[key] = entry;
    try {
      await backend.writeIndex(JSON.stringify(index));
    } catch {
      // Disque plein ou refusé : les vignettes restent affichées, simplement pas gardées.
      dirty = true;
    }
  };

  const schedule = (): void => {
    dirty = true;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, options.writeDelayMs);
  };

  const removeFiles = async (names: readonly string[]): Promise<void> => {
    if (names.length === 0) return;
    try {
      await backend.remove(names);
    } catch {
      // Laissées là : effacées comme orphelines au lancement suivant.
    }
  };

  /**
   * Ménage du chargement, en arrière-plan : les images qu'aucune entrée ne
   * nomme sont effacées, les entrées lues dont l'image manque sont retirées.
   */
  const tidy = async (entries: Map<string, StoredPreviewImage>, loaded: ReadonlyArray<[string, StoredPreviewImage]>): Promise<void> => {
    let present: Set<string>;
    try {
      present = new Set(await backend.names());
    } catch {
      return;
    }
    let changed = false;
    for (const [key, entry] of loaded) {
      if (entries.get(key) === entry && !present.has(entry.name)) {
        entries.delete(key);
        changed = true;
      }
    }
    const named = new Set([...entries.values()].map((e) => e.name));
    const orphans = [...present].filter((name) => !named.has(name) && !writing.has(name));
    if (changed) schedule();
    await removeFiles(orphans);
  };

  const load = async (): Promise<Map<string, StoredPreviewImage>> => {
    let raw: unknown = null;
    try {
      const text = await backend.readIndex();
      raw = text === null ? null : JSON.parse(text);
    } catch {
      raw = null;
    }
    const entries = parsePreviewImageIndex(raw);
    void tidy(entries, [...entries]);
    return entries;
  };

  const entries = (): Promise<Map<string, StoredPreviewImage>> => (held ??= load());

  return {
    stored: async (sessionKey, imageKey) => {
      const known = await entries();
      const entry = known.get(sessionKey);
      if (!entry || entry.image !== imageKey) return null;
      let png: Blob | null = null;
      try {
        png = await backend.read(entry.name);
      } catch {
        png = null;
      }
      if (!png) {
        // Image perdue : l'entrée part, la vignette sera redessinée et regardée.
        if (known.get(sessionKey) === entry) {
          known.delete(sessionKey);
          schedule();
        }
        return null;
      }
      entry.usedAt = Date.now();
      return png;
    },
    keep: async (sessionKey, imageKey, png) => {
      const known = await entries();
      const current = known.get(sessionKey);
      if (current?.image === imageKey) {
        current.usedAt = Date.now();
        return;
      }
      if (png.size > options.maxBytes) {
        if (current) {
          known.delete(sessionKey);
          schedule();
          await removeFiles([current.name]);
        }
        return;
      }
      const name = previewImageName(sessionKey, imageKey);
      writing.add(name);
      try {
        await backend.write(name, png);
      } catch {
        // Disque plein ou refusé : la vignette reste affichée, simplement pas gardée.
        writing.delete(name);
        return;
      }
      // Relue après l'écriture : une autre image de la session a pu être gardée entre-temps.
      const previous = known.get(sessionKey);
      // En fin d'index : à date de vue égale, la plus récente gardée part la dernière.
      known.delete(sessionKey);
      known.set(sessionKey, { image: imageKey, name, bytes: png.size, usedAt: Date.now() });
      writing.delete(name);
      const evicted = previewEntriesToEvict(
        [...known].map(([key, e]) => ({ key, bytes: e.bytes, usedAt: e.usedAt })),
        options.maxBytes
      );
      const stale = previous && previous.name !== name ? [previous.name] : [];
      for (const key of evicted) {
        const entry = known.get(key);
        if (!entry) continue;
        known.delete(key);
        stale.push(entry.name);
      }
      schedule();
      await removeFiles(stale);
    },
    prune: async (folderLabel, files) => {
      const known = await entries();
      const unknown = unknownPreviewKeys(known.keys(), folderLabel, files);
      if (unknown.length === 0) return;
      const names: string[] = [];
      for (const key of unknown) {
        const entry = known.get(key);
        if (entry) names.push(entry.name);
        known.delete(key);
      }
      schedule();
      await removeFiles(names);
    },
    flush,
  };
};

const createAppStore = (): PreviewImageStore => {
  const store = createPreviewImageStore(previewImageFiles);
  onPageHidden(() => void store.flush());
  return store;
};

/** Magasin de l'appareil. */
export const previewImageStore: PreviewImageStore = createAppStore();
