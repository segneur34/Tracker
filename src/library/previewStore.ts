import { onPageHidden, previewDocument, type PreviewBackend } from '../platform/previewStore';
import {
  PREVIEW_FORMAT_VERSION, PREVIEW_STORE_DEFAULTS, decodePreview, encodePreview, parsePreviewDocument, previewEntriesToEvict,
  previewEntryBytes, unknownPreviewKeys, type PreviewDocument, type PreviewStoreOptions, type PreviewTrack, type StoredPreview,
} from './previewTracks';

/**
 * Traces réduites des vignettes de la bibliothèque, gardées sur l'appareil
 * d'un lancement à l'autre (lot 118). Un seul document par appareil
 * (`platform/previewStore.ts`), lu une fois au premier besoin, tenu en
 * mémoire, réécrit `writeDelayMs` après le dernier changement et aussitôt
 * quand la page est quittée ou cachée. Aucune erreur ne remonte : un document
 * illisible est un document vide.
 */

export interface PreviewStore {
  /** Trace gardée sous `key` si son empreinte est `fp` (sinon `null`) ; la marque vue. */
  stored(key: string, fp: string): Promise<PreviewTrack | null>;
  /** Garde la trace d'une vignette, à la place de celle de même clé ; une trace plus grosse que la borne ne l'est pas. */
  keep(key: string, fp: string, track: PreviewTrack): Promise<void>;
  /** Oublie les traces des sessions que la bibliothèque complète ne porte pas (`unknownPreviewKeys`). */
  prune(folderLabel: string | null, files: Iterable<string>): Promise<void>;
  /** Réécrit le document s'il a changé depuis sa dernière écriture. */
  flush(): Promise<void>;
}

interface HeldEntry {
  stored: StoredPreview;
  bytes: number;
}

/**
 * Magasin sur `backend`. La date de dernière vue d'une trace relue n'est
 * rangée qu'avec la prochaine écriture (une trace gardée ou oubliée) : relire
 * les vignettes ne réécrit pas le document à chaque lancement.
 */
export const createPreviewStore = (backend: PreviewBackend, options: PreviewStoreOptions = PREVIEW_STORE_DEFAULTS): PreviewStore => {
  let held: Promise<Map<string, HeldEntry>> | null = null;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const load = async (): Promise<Map<string, HeldEntry>> => {
    let raw: unknown = null;
    try {
      const text = await backend.read();
      raw = text === null ? null : JSON.parse(text);
    } catch {
      raw = null;
    }
    const entries = new Map<string, HeldEntry>();
    for (const [key, stored] of parsePreviewDocument(raw)) entries.set(key, { stored, bytes: previewEntryBytes(key, stored) });
    return entries;
  };

  const entries = (): Promise<Map<string, HeldEntry>> => (held ??= load());

  const flush = async (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty || !held) return;
    dirty = false;
    const doc: PreviewDocument = { version: PREVIEW_FORMAT_VERSION, entries: {} };
    for (const [key, entry] of await held) doc.entries[key] = entry.stored;
    try {
      await backend.write(JSON.stringify(doc));
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

  return {
    stored: async (key, fp) => {
      const entry = (await entries()).get(key);
      if (!entry || entry.stored.fp !== fp) return null;
      entry.stored.usedAt = Date.now();
      return decodePreview(entry.stored);
    },
    keep: async (key, fp, track) => {
      const known = await entries();
      const stored = encodePreview(track, fp, Date.now());
      const bytes = previewEntryBytes(key, stored);
      if (bytes > options.maxBytes) {
        if (known.delete(key)) schedule();
        return;
      }
      known.set(key, { stored, bytes });
      const evicted = previewEntriesToEvict(
        [...known].map(([k, e]) => ({ key: k, bytes: e.bytes, usedAt: e.stored.usedAt })),
        options.maxBytes
      );
      for (const k of evicted) known.delete(k);
      schedule();
    },
    prune: async (folderLabel, files) => {
      const known = await entries();
      const unknown = unknownPreviewKeys(known.keys(), folderLabel, files);
      if (unknown.length === 0) return;
      for (const key of unknown) known.delete(key);
      schedule();
    },
    flush,
  };
};

const createAppStore = (): PreviewStore => {
  const store = createPreviewStore(previewDocument);
  onPageHidden(() => void store.flush());
  return store;
};

/** Magasin de l'appareil. */
export const previewStore: PreviewStore = createAppStore();
