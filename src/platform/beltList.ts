import type { HeartRateBelt } from './heartRate';

/**
 * Appareils cardio retenus sur ce téléphone (lot 198) : ceintures, montres en
 * diffusion. L'application s'en souvient de plusieurs et n'en lit qu'un à la
 * fois, l'appareil actif, gardé à part sous l'ancienne clé (`savedBelt`). Ici,
 * les calculs purs sur la liste ; la lecture et l'écriture sont dans
 * `platform/heartRate.ts`. Les entrées lues du stockage peuvent être gelées :
 * rien n'est modifié en place, chaque calcul rend une liste neuve.
 */

/** Vrai pour un appareil retenu lisible : adresse et nom, type d'adresse facultatif. */
export const isBelt = (value: unknown): value is HeartRateBelt =>
  typeof value === 'object' && value !== null &&
  typeof (value as HeartRateBelt).address === 'string' && typeof (value as HeartRateBelt).name === 'string' &&
  ((value as HeartRateBelt).random === undefined || typeof (value as HeartRateBelt).random === 'boolean');

/** L'appareil réduit à ce qui se retient : adresse, nom, type d'adresse s'il est connu (pas la force du signal d'une recherche). */
export const beltEntry = (belt: HeartRateBelt): HeartRateBelt => ({
  address: belt.address,
  name: belt.name,
  ...(belt.random !== undefined && { random: belt.random }),
});

/**
 * Liste retenue, telle qu'elle doit se lire : `stored` (la nouvelle clé, brute)
 * et `active` (l'ancienne clé). Liste absente ou illisible : celle de l'appareil
 * actif seul, ou vide, sans rien effacer. Entrées illisibles écartées, adresses
 * en double fondues (la première reste). Appareil actif absent de la liste
 * (choisi par une version d'avant la liste) : ajouté en tête.
 */
export const readBeltList = (stored: unknown, active: HeartRateBelt | null): HeartRateBelt[] => {
  const list: HeartRateBelt[] = [];
  if (Array.isArray(stored)) {
    for (const item of stored) {
      if (isBelt(item) && !list.some((b) => b.address === item.address)) list.push(beltEntry(item));
    }
  }
  if (active && !list.some((b) => b.address === active.address)) list.unshift(beltEntry(active));
  return list;
};

/** Ajoute `belt` à la fin de la liste ; déjà retenu (même adresse), son entrée prend le nom et le type d'adresse donnés, à sa place. */
export const addBelt = (list: readonly HeartRateBelt[], belt: HeartRateBelt): HeartRateBelt[] => {
  const entry = beltEntry(belt);
  return list.some((b) => b.address === entry.address)
    ? list.map((b) => (b.address === entry.address ? { ...entry, ...(entry.random === undefined && b.random !== undefined && { random: b.random }) } : b))
    : [...list, entry];
};

/**
 * Oublie l'appareil d'adresse `address`. Rend la liste restante et l'appareil
 * actif ensuite : inchangé si un autre était actif ; si c'était l'actif, celui
 * qui le suivait dans la liste (ou le dernier), `null` si la liste est vide.
 */
export const forgetBelt = (
  list: readonly HeartRateBelt[], address: string, active: HeartRateBelt | null,
): { list: HeartRateBelt[]; active: HeartRateBelt | null } => {
  const index = list.findIndex((b) => b.address === address);
  const rest = list.filter((b) => b.address !== address);
  if (active === null || active.address !== address) return { list: rest, active };
  const next = rest[Math.min(Math.max(index, 0), rest.length - 1)] ?? null;
  return { list: rest, active: next };
};

/**
 * Type d'adresse appris par la recherche du greffon (`random`) pour l'appareil
 * d'adresse `address` : posé sur son entrée s'il ne l'avait pas. La même liste
 * (même objet) si rien ne change, pour ne rien récrire.
 */
export const learnBeltAddressType = (
  list: readonly HeartRateBelt[], address: string | undefined, random: boolean | undefined,
): readonly HeartRateBelt[] => {
  if (address === undefined || random === undefined) return list;
  if (!list.some((b) => b.address === address && b.random === undefined)) return list;
  return list.map((b) => (b.address === address && b.random === undefined ? { ...b, random } : b));
};

/** Fin de l'adresse ajoutée à un nom porté par plusieurs appareils : ses deux derniers octets. */
const ADDRESS_TAIL_CHARS = 5;

/**
 * Nom montré de chaque appareil de la liste, dans son ordre : son nom, suivi de
 * la fin de son adresse (« HRM-Dual · EE:FF ») s'il est porté par un autre.
 */
export const beltLabels = (list: readonly HeartRateBelt[]): string[] =>
  list.map((b) => (list.some((o) => o !== b && o.name === b.name)
    ? `${b.name} · ${b.address.slice(-ADDRESS_TAIL_CHARS)}`
    : b.name));
