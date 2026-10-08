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

export const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};
