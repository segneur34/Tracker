import { isFiniteNumber } from '../core/basics';

/**
 * Images finies des vignettes de la bibliothèque (trace sur son fond de
 * carte), gardées sur l'appareil d'un lancement à l'autre (lot 121, décision
 * du 01/11) : calculs purs de l'index que tient `library/previewImageStore.ts`
 * et des fichiers que range `platform/previewImages.ts`. Une entrée par
 * session, sous `previewKey(folderLabel, file)` comme les traces réduites
 * (`previewTracks.ts`), avec la clé complète de son image : une image d'une
 * autre clé (taille, densité, bornes, trace) n'est jamais montrée.
 */

/**
 * Version du dessin des vignettes : à augmenter dès que l'image change
 * (`TRACK_PREVIEW`, fond de Leaflet, dégradé, ordre de peinture, réduction des
 * points) ; toutes les images gardées sont alors oubliées.
 */
export const PREVIEW_IMAGE_VERSION = 1;

/** Version de l'index rangé : l'augmenter oublie toutes les images gardées. */
export const PREVIEW_IMAGE_INDEX_VERSION = 1;

/** Borne des images gardées en octets (somme des PNG) et calme avant de réécrire l'index. */
export const PREVIEW_IMAGE_DEFAULTS = { maxBytes: 10e6, writeDelayMs: 2000 } as const;

export interface PreviewImageStoreOptions {
  maxBytes: number;
  writeDelayMs: number;
}

/** Ce dont l'image d'une vignette dépend. */
export interface PreviewImageParts {
  /** Clé de la trace en mémoire : dossier, fichier, calcul, allure imposée, famille. */
  cacheKey: string;
  /** Empreinte de la trace gardée (`previewFingerprint`) : bornes, nombre de points, versions. */
  fingerprint: string;
  width: number;
  height: number;
  pixelRatio: number;
  /** Thème économe : la trace seule, sans fond. */
  eco: boolean;
  minMs: number;
  maxMs: number;
}

/**
 * Clé de l'image d'une vignette, en mémoire comme sur l'appareil : tout ce
 * dont elle dépend, et la version du dessin.
 */
export const previewImageKey = ({ cacheKey, fingerprint, width, height, pixelRatio, eco, minMs, maxMs }: PreviewImageParts): string =>
  `${cacheKey}|${width}x${height}@${pixelRatio}|${eco ? 'econome' : 'plan'}|${minMs}|${maxMs}|${fingerprint}|v${PREVIEW_IMAGE_VERSION}`;

/** Hachage cyrb53 : 53 bits, stable d'un lancement à l'autre. */
const cyrb53 = (text: string): number => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

/**
 * Nom du fichier de l'image `imageKey` de la session `sessionKey` : court,
 * stable, sans caractère réservé ; deux images différentes ne partagent pas
 * de fichier, si bien qu'un index en retard ne montre jamais une image
 * fausse, au pire une image manquante.
 */
export const previewImageName = (sessionKey: string, imageKey: string): string =>
  cyrb53(`${sessionKey}\n${imageKey}`).toString(36);

/** Entrée de l'index : clé complète de l'image, nom de son fichier, poids, dernière vue (ms). */
export interface StoredPreviewImage {
  image: string;
  name: string;
  bytes: number;
  usedAt: number;
}

/** Index rangé sur l'appareil. */
export interface PreviewImageIndex {
  version: number;
  entries: Record<string, StoredPreviewImage>;
}

const isStoredPreviewImage = (value: unknown): value is StoredPreviewImage => {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Partial<StoredPreviewImage>;
  return typeof e.image === 'string'
    && typeof e.name === 'string' && /^[0-9a-z]+$/.test(e.name)
    && isFiniteNumber(e.bytes) && e.bytes >= 0
    && isFiniteNumber(e.usedAt);
};

/**
 * Entrées d'un index lu sur l'appareil : illisible ou d'une autre version, il
 * est vide ; une entrée abîmée est oubliée seule.
 */
export const parsePreviewImageIndex = (raw: unknown): Map<string, StoredPreviewImage> => {
  const entries = new Map<string, StoredPreviewImage>();
  if (typeof raw !== 'object' || raw === null) return entries;
  const index = raw as Partial<PreviewImageIndex>;
  if (index.version !== PREVIEW_IMAGE_INDEX_VERSION || typeof index.entries !== 'object' || index.entries === null) return entries;
  for (const [key, entry] of Object.entries(index.entries)) if (isStoredPreviewImage(entry)) entries.set(key, entry);
  return entries;
};

/**
 * Vrai si chaque tuile du fond était là au dessin : gardée ou reçue (un
 * `Blob`), et lisible. Une case vide (hors réseau) ou agrandie d'une tuile
 * d'un zoom inférieur (une adresse de données) donne une image incomplète,
 * qui n'est pas gardée.
 */
export const allTilesPresent = (tiles: ReadonlyArray<{ content: unknown; image: unknown }>): boolean =>
  tiles.every((t) => t.content instanceof Blob && t.image !== null && t.image !== undefined);
