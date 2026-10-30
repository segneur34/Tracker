import { registerPlugin } from '@capacitor/core';
import { bytesToBase64 } from '../core/base64';
import { downloadBlob } from './files';
import { isNativeApp } from './runtime';

/**
 * Partage d'un fichier vers une autre application (messagerie, réseau
 * social…) : seul point d'accès autorisé.
 *
 * - Sur le téléphone, le menu de partage d'Android (`ShareFilePlugin.java`),
 *   le fichier posé dans le cache de l'application.
 * - Dans le navigateur, le partage du système s'il accepte les fichiers
 *   (Chrome sous Android et Windows) ; sinon, le fichier est téléchargé.
 */

interface ShareFilePlugin {
  shareFile(options: { name: string; data: string; mimeType: string; title: string }): Promise<void>;
}

const shareFilePlugin = registerPlugin<ShareFilePlugin>('ShareFile');

/** Ce qu'est devenu le fichier : confié au menu de partage, téléchargé faute de partage, ou partage abandonné. */
export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/** Partage `blob` sous le nom `fileName` ; `title` est le titre du menu de partage. Un échec est levé, message en clair. */
export const shareFile = async (blob: Blob, fileName: string, title: string): Promise<ShareOutcome> => {
  if (isNativeApp()) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await shareFilePlugin.shareFile({ name: fileName, data: bytesToBase64(bytes), mimeType: blob.type || 'image/png', title });
    return 'shared';
  }
  const file = new File([blob], fileName, { type: blob.type });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      throw err;
    }
  }
  downloadBlob(fileName, blob);
  return 'downloaded';
};
