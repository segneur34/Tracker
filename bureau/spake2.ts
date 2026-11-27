// Échange authentifié par mot de passe SPAKE2 (RFC 9382), suite P256-SHA256-HKDF-HMAC, qui relie un téléphone au
// programme Windows par le code de 6 chiffres affiché sur le PC. Calcul pur, commun au PC (par `appairage.ts`) et à
// la page du téléphone : ni `node:`, ni réseau, ni horloge ; l'aléa est passé en paramètre. Toutes les opérations
// de courbe (multiplication à temps constant, addition, décodage et validation des points) sont celles de
// `@noble/curves` ; ce module n'assemble que le protocole, à la lettre de la RFC, dont il rejoue les vecteurs.
//
// ---------- Rôles et identités ----------
//
//   A = le téléphone, B = le PC. idA = « tracker-telephone » en ASCII ; idB = l'empreinte du certificat TLS que le
//   téléphone a vue (SHA-256 des octets DER, 32 octets bruts), ce qui lie l'échange à la liaison : un relais entre
//   deux liaisons TLS donne deux empreintes, donc deux transcriptions, et les confirmations ne concordent pas.
//   AAD = « tracker-appairage-1 » en ASCII.
//   Ces identités et l'étiquette du code diffèrent de celles de Gtracker : un téléphone Tracker relié par erreur à un
//   PC Gtracker échoue comme sur un code faux, et rien n'est gardé.
//
// ---------- Scalaire du code ----------
//
//   w = OS2IP(SHA-512(« tracker-spake2-w » ‖ 0x00 ‖ code en ASCII)) mod n, n l'ordre du groupe de P-256 : 512 bits
//   réduits modulo un ordre de 256 bits, soit 256 bits de plus que nécessaire, sans biais mesurable.
//
// ---------- Échange ----------
//
//   A tire x dans [1, n), envoie pA = x·G + w·M ; B tire y dans [1, n), envoie pB = y·G + w·N. Les points circulent
//   en SEC1 non compressé (65 octets, 0x04 ‖ X ‖ Y). Chacun décode et valide le point reçu (sur la courbe, non
//   neutre), puis calcule K = x·(pB − w·N) chez A, K = y·(pA − w·M) chez B (cofacteur 1 sur P-256) ; K neutre est
//   refusé.
//
//   TT = len(idA) ‖ idA ‖ len(idB) ‖ idB ‖ len(pA) ‖ pA ‖ len(pB) ‖ pB ‖ len(K) ‖ K ‖ len(w) ‖ w
//   où len est la longueur en octets sur 8 octets petit-boutistes, K en SEC1 non compressé et w en gros-boutiste
//   sur 32 octets.
//   Ke ‖ Ka = SHA-256(TT), 16 octets chacun ; KcA ‖ KcB = HKDF-SHA256(Ka, sel vide, « ConfirmationKeys » ‖ AAD, 32).
//   cA = HMAC-SHA256(KcA, TT), cB = HMAC-SHA256(KcB, TT), 32 octets chacun.
//
//   Le téléphone confirme le premier (cA) ; le PC vérifie cA avant de rien envoyer qui dépende du code, puis rend cB,
//   que le téléphone vérifie avant de rien garder. Un intrus actif n'essaie qu'un code par échange, et rien de ce
//   qui circule ne permet d'en tester d'autres hors ligne. x et y ne servent qu'une fois.

import { p256 } from '@noble/curves/nist.js'
import { bytesToNumberBE, equalBytes, numberToBytesBE } from '@noble/curves/utils.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

/** Source d'octets aléatoires sûre (aléa du système) ; une suite fixée dans les tests. */
export type AleaSpake2 = (taille: number) => Uint8Array

/** A = le téléphone, qui commence et confirme le premier ; B = le PC. */
export type RoleSpake2 = 'A' | 'B'

/** Identités et données associées de la transcription, en octets bruts. */
export type IdentitesSpake2 = { idA: Uint8Array; idB: Uint8Array; aad: Uint8Array }

/** Identité du téléphone (idA). */
export const ID_TELEPHONE = 'tracker-telephone'

/** Données associées (AAD) de l'appairage. */
export const AAD_APPAIRAGE = 'tracker-appairage-1'

/** Étiquette qui sépare le hachage du code de tout autre usage du même code. */
export const ETIQUETTE_SCALAIRE_CODE = 'tracker-spake2-w'

/** Taille d'une part (pA ou pB) et de K, en SEC1 non compressé. */
export const TAILLE_PART = 65

/** Taille d'une confirmation (cA ou cB), sortie de HMAC-SHA256. */
export const TAILLE_CONFIRMATION = 32

/** Taille de l'empreinte du certificat qui sert d'identité au PC. */
export const TAILLE_EMPREINTE_SPAKE2 = 32

/** M et N de P-256, points compressés recopiés de la RFC 9382, section 6. */
export const M_P256 = '02886e2f97ace46e55ba9dd7242579f2993b64e16ef3dcab95afd497333d8fa12f'
export const N_P256 = '03d8bbd6c639c62937b04d997f38c3770719c629d7014d49a24b4f98baa1292b49'

const Point = p256.Point
type PointP256 = ReturnType<typeof Point.fromBytes>

/** Ordre du groupe (n), et taille d'un scalaire en octets. */
const ORDRE = Point.Fn.ORDER
const TAILLE_SCALAIRE = 32

/** Décodés et validés une fois (la bibliothèque refuse un point hors de la courbe). */
const POINT_M = Point.fromHex(M_P256)
const POINT_N = Point.fromHex(N_P256)

const ETIQUETTE_CONFIRMATION = utf8ToBytes('ConfirmationKeys')

/** Raison d'un refus : code non admis, scalaire hors de [1, n), part reçue invalide, K neutre, identité mal formée. */
export type RaisonSpake2 = 'code' | 'scalaire' | 'part' | 'cle' | 'identite'

export class ErreurSpake2 extends Error {
  readonly raison: RaisonSpake2
  constructor(raison: RaisonSpake2, message: string) {
    super(message)
    this.raison = raison
  }
}

// ---------- octets ----------

/** Octets en hexadécimal minuscule. */
export function octetsEnHex(octets: Uint8Array): string {
  return bytesToHex(octets)
}

/** Octets d'un texte hexadécimal minuscule de `taille` octets exactement, `null` s'il n'en est pas un. */
export function octetsDepuisHex(texte: string, taille: number): Uint8Array | null {
  if (texte.length !== taille * 2 || !/^[0-9a-f]*$/.test(texte)) return null
  return hexToBytes(texte)
}

/** Longueur d'une suite d'octets sur 8 octets petit-boutistes, suivie de la suite. */
function avecLongueur(octets: Uint8Array): Uint8Array {
  const longueur = new Uint8Array(8)
  new DataView(longueur.buffer).setBigUint64(0, BigInt(octets.length), true)
  return concatBytes(longueur, octets)
}

function exigerScalaire(s: bigint, quoi: string): void {
  if (s <= 0n || s >= ORDRE) throw new ErreurSpake2('scalaire', `${quoi} hors de [1, n).`)
}

// ---------- scalaires ----------

/** w tiré du code : chiffres ASCII seulement (la longueur du code est vérifiée par l'appelant). */
export function scalaireDuCode(code: string): bigint {
  if (!/^[0-9]+$/.test(code)) throw new ErreurSpake2('code', 'Le code ne compte que des chiffres.')
  const w = bytesToNumberBE(sha512(concatBytes(utf8ToBytes(ETIQUETTE_SCALAIRE_CODE), Uint8Array.of(0), utf8ToBytes(code)))) % ORDRE
  exigerScalaire(w, 'Scalaire du code')
  return w
}

/** Scalaire secret (x ou y) tiré uniformément dans [1, n), par rejet : 32 octets sont retirés tant qu'ils tombent hors de l'intervalle. */
export function tirerScalaire(alea: AleaSpake2): bigint {
  for (;;) {
    const octets = alea(TAILLE_SCALAIRE)
    if (octets.length !== TAILLE_SCALAIRE) throw new ErreurSpake2('scalaire', `Aléa : ${TAILLE_SCALAIRE} octets attendus, ${octets.length} reçus.`)
    const s = bytesToNumberBE(octets)
    if (s > 0n && s < ORDRE) return s
  }
}

// ---------- identités ----------

/** Identités de l'appairage : le téléphone, l'empreinte du certificat vue par le téléphone, et l'AAD. */
export function identitesAppairage(empreinte: Uint8Array): IdentitesSpake2 {
  if (empreinte.length !== TAILLE_EMPREINTE_SPAKE2) {
    throw new ErreurSpake2('identite', `Empreinte : ${TAILLE_EMPREINTE_SPAKE2} octets attendus, ${empreinte.length} reçus.`)
  }
  return { idA: utf8ToBytes(ID_TELEPHONE), idB: Uint8Array.from(empreinte), aad: utf8ToBytes(AAD_APPAIRAGE) }
}

// ---------- échange ----------

/** Ce que garde un côté entre sa part et la part de l'autre. Les scalaires sont secrets et ne servent qu'une fois. */
export type EtatSpake2 = {
  readonly role: RoleSpake2
  readonly w: bigint
  readonly secret: bigint
  readonly identites: IdentitesSpake2
  /** Sa part (pA pour A, pB pour B), 65 octets à envoyer à l'autre. */
  readonly part: Uint8Array
}

/** Clés et confirmations d'un échange conclu. */
export type ClesSpake2 = {
  readonly partA: Uint8Array
  readonly partB: Uint8Array
  /** K en SEC1 non compressé ; il n'est jamais une clé à lui seul. */
  readonly k: Uint8Array
  readonly transcription: Uint8Array
  readonly ke: Uint8Array
  readonly ka: Uint8Array
  readonly kcA: Uint8Array
  readonly kcB: Uint8Array
  readonly confirmationA: Uint8Array
  readonly confirmationB: Uint8Array
  /** Sa confirmation, à envoyer (cA pour A, cB pour B). */
  readonly confirmationEnvoyee: Uint8Array
  /** Celle que l'autre doit envoyer (cB pour A, cA pour B). */
  readonly confirmationAttendue: Uint8Array
}

/**
 * Sa part : pA = x·G + w·M pour A, pB = y·G + w·N pour B. `w` et `secret` sont passés tels quels pour rejouer les
 * vecteurs de la RFC ; l'appairage passe par `commencerAppairage`.
 */
export function commencer(role: RoleSpake2, w: bigint, secret: bigint, identites: IdentitesSpake2): EtatSpake2 {
  exigerScalaire(w, 'w')
  exigerScalaire(secret, role === 'A' ? 'x' : 'y')
  const part = Point.BASE.multiply(secret).add((role === 'A' ? POINT_M : POINT_N).multiply(w))
  return { role, w, secret, identites, part: part.toBytes(false) }
}

/** Sa part pour l'appairage : w tiré du code, identités de l'appairage, scalaire secret neuf. */
export function commencerAppairage(role: RoleSpake2, code: string, empreinte: Uint8Array, alea: AleaSpake2): EtatSpake2 {
  return commencer(role, scalaireDuCode(code), tirerScalaire(alea), identitesAppairage(empreinte))
}

/** Le point d'une part reçue : 65 octets SEC1 non compressés, sur la courbe, non neutre. */
function lirePart(octets: Uint8Array): PointP256 {
  if (octets.length !== TAILLE_PART || octets[0] !== 0x04) {
    throw new ErreurSpake2('part', `Part : ${TAILLE_PART} octets SEC1 non compressés attendus.`)
  }
  let point: PointP256
  try {
    point = Point.fromBytes(octets)
  } catch {
    throw new ErreurSpake2('part', 'Part : point invalide.')
  }
  if (point.is0()) throw new ErreurSpake2('part', 'Part : point neutre.')
  return point
}

/**
 * Clés et confirmations, une fois la part de l'autre reçue. Lève `ErreurSpake2` (raison `part` ou `cle`) si la part
 * est invalide ou si K est neutre : l'échange s'arrête là, sans rien envoyer.
 */
export function conclure(etat: EtatSpake2, partAutre: Uint8Array): ClesSpake2 {
  const recu = lirePart(partAutre)
  const masque = (etat.role === 'A' ? POINT_N : POINT_M).multiply(etat.w)
  const sansMasque = recu.subtract(masque)
  if (sansMasque.is0()) throw new ErreurSpake2('cle', 'K neutre.')
  const pointK = sansMasque.multiply(etat.secret)
  if (pointK.is0()) throw new ErreurSpake2('cle', 'K neutre.')
  const k = pointK.toBytes(false)
  const partA = etat.role === 'A' ? etat.part : Uint8Array.from(partAutre)
  const partB = etat.role === 'A' ? Uint8Array.from(partAutre) : etat.part
  const { idA, idB, aad } = etat.identites
  const transcription = concatBytes(
    avecLongueur(idA),
    avecLongueur(idB),
    avecLongueur(partA),
    avecLongueur(partB),
    avecLongueur(k),
    avecLongueur(numberToBytesBE(etat.w, TAILLE_SCALAIRE)),
  )
  const empreinteTT = sha256(transcription)
  const ke = empreinteTT.slice(0, 16)
  const ka = empreinteTT.slice(16, 32)
  const kc = hkdf(sha256, ka, undefined, concatBytes(ETIQUETTE_CONFIRMATION, aad), 32)
  const kcA = kc.slice(0, 16)
  const kcB = kc.slice(16, 32)
  const confirmationA = hmac(sha256, kcA, transcription)
  const confirmationB = hmac(sha256, kcB, transcription)
  return {
    partA,
    partB,
    k,
    transcription,
    ke,
    ka,
    kcA,
    kcB,
    confirmationA,
    confirmationB,
    confirmationEnvoyee: etat.role === 'A' ? confirmationA : confirmationB,
    confirmationAttendue: etat.role === 'A' ? confirmationB : confirmationA,
  }
}

/** Vrai si la confirmation reçue de l'autre est celle qu'on attend ; comparaison dont la durée ne dépend pas du contenu. */
export function confirmationValide(cles: ClesSpake2, recue: Uint8Array): boolean {
  if (recue.length !== TAILLE_CONFIRMATION) return false
  return equalBytes(cles.confirmationAttendue, recue)
}
