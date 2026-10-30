/**
 * Octets ↔ base64, pour les fichiers binaires (capteurs) qui traversent le
 * pont de Capacitor, qui ne transporte que du texte.
 */

/** Par tranches : `String.fromCharCode` refuse un trop grand nombre d'arguments. */
const SLICE = 0x8000;

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + SLICE));
  }
  return btoa(binary);
};

export const base64ToBytes = (base64: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** Blob du type donné, tiré d'un contenu base64 (une tuile lue par le greffon). */
export const base64ToBlob = (base64: string, type: string): Blob => new Blob([base64ToBytes(base64)], { type });

/** Contenu d'un blob en base64, sans l'en-tête de l'URL de données. */
export const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
