// Découverte du PC sur le réseau local : la question que le téléphone diffuse en UDP, la réponse du PC, et le tri
// des adresses IPv4 privées du PC. Calcul pur, octets seulement : les sockets sont ailleurs.
//
// Le téléphone essaie d'abord la dernière adresse connue du PC ; sinon il diffuse une question (adresse de
// diffusion de son réseau, ou 255.255.255.255) vers le port UDP 48248 ; chaque PC Tracker à l'écoute répond à
// l'adresse et au port d'où vient la question. L'adresse du PC est l'adresse source de la réponse (elle n'est pas
// dans le paquet). Le téléphone garde la réponse dont le nonce est celui de sa question et, s'il est déjà appairé,
// dont l'identifiant de sonde est celui de son PC pour ce nonce. Une réponse n'est pas une preuve : l'empreinte du
// certificat, vérifiée à la liaison TLS, l'est.
//
// Un seul format, à l'octet de version 2. L'identifiant du PC n'y part jamais en clair : la réponse porte à sa place
// l'identifiant de sonde, qui ne vaut que pour le nonce de la question : les 16 premiers octets de
// HMAC-SHA256(clé = les 16 octets de l'identifiant du PC, « tracker-sonde » en ASCII ‖ les 16 octets du nonce)
// (`identifiantDeSonde`). Un hôte du réseau ne peut ni suivre un PC d'une question à l'autre, ni répondre à sa place
// sous l'identifiant attendu par un téléphone appairé, qui seul connaît la clé. L'octet de version 1 (identifiant
// en clair) n'est jamais admis. Le nom du PC ne part pas : le téléphone ne s'en sert pas, et il n'a pas à partir chez
// tout hôte qui le demande.
//
// Signature et port diffèrent de ceux de Gtracker (« GTRK », UDP 48218), au même format : les deux programmes
// cohabitent sur un même PC, et un téléphone Tracker ne prend jamais un PC Gtracker pour le sien.
//
// ---------- Question (téléphone vers PC), 22 octets exactement ----------
//
//   octets 0 à 3     « TRKR » en ASCII : 0x54 0x52 0x4B 0x52
//   octet 4          version du format : 2
//   octet 5          sorte de paquet : 0x01 (question)
//   octets 6 à 21    nonce de la question, 16 octets tirés au hasard
//
// ---------- Réponse (PC vers téléphone), 41 octets exactement ----------
//
//   octets 0 à 3     « TRKR »
//   octet 4          version du format : 2
//   octet 5          sorte de paquet : 0x02 (réponse)
//   octets 6 à 21    nonce de la question, recopié
//   octets 22 et 23  port TCP du serveur TLS du PC, entier non signé sur 16 bits, gros-boutiste, de 1 à 65 535
//   octets 24 à 39   identifiant de sonde, 16 octets
//   octet 40         longueur du nom du PC : toujours 0
//
// Tout autre paquet (autre signature, autre version, autre sorte, autre longueur, port nul, nom non vide) est
// étranger et ignoré sans réponse.

import { createHmac } from 'node:crypto'

/** Port UDP où le PC attend les questions. */
export const PORT_SONDE = 48248

/** Signature qui ouvre chaque paquet. */
export const SIGNATURE_SONDE = Uint8Array.from([0x54, 0x52, 0x4b, 0x52])

/**
 * Octet de version du format, la trace de l'identifiant à la place de l'identifiant du PC. Jamais 1 : une application
 * qui attend l'octet 1 lit l'identifiant en clair.
 */
export const VERSION_SONDE_V2 = 2
export const VERSIONS_SONDE = [VERSION_SONDE_V2] as const

export const SORTE_QUESTION = 0x01
export const SORTE_REPONSE = 0x02

/** Étiquette de l'identifiant de sonde. */
export const ETIQUETTE_SONDE = 'tracker-sonde'

/** Taille du nonce d'une question et de l'identifiant du PC, en octets. */
export const TAILLE_NONCE_SONDE = 16
export const TAILLE_IDENTIFIANT_PC = 16

/** Plus long nom du PC envoyé au téléphone reconnu par la liaison chiffrée, en octets UTF-8. */
export const NOM_PC_MAX_OCTETS = 64

const TAILLE_QUESTION = 6 + TAILLE_NONCE_SONDE
const TAILLE_REPONSE = 6 + TAILLE_NONCE_SONDE + 2 + TAILLE_IDENTIFIANT_PC + 1

/** Réponse du PC ; `identifiant` est l'identifiant de sonde (`identifiantDeSonde`), jamais celui du PC. */
export type ReponseSonde = { nonce: Uint8Array; port: number; identifiant: Uint8Array }

function entete(sorte: number): Buffer {
  return Buffer.from([...SIGNATURE_SONDE, VERSION_SONDE_V2, sorte])
}

/** Vrai si le paquet a la signature et la sorte données, quelle que soit sa version. */
function signeDe(paquet: Uint8Array, sorte: number): boolean {
  return SIGNATURE_SONDE.every((o, i) => paquet[i] === o) && paquet[5] === sorte
}

/** Vrai si le paquet a l'en-tête d'un paquet de cette sorte, dans la version du format. */
function enteteDe(paquet: Uint8Array, sorte: number): boolean {
  return signeDe(paquet, sorte) && (VERSIONS_SONDE as readonly number[]).includes(paquet[4])
}

function exigerTaille(octets: Uint8Array, taille: number, quoi: string): void {
  if (octets.length !== taille) throw new RangeError(`${quoi} : ${taille} octets attendus, ${octets.length} reçus.`)
}

/**
 * Identifiant de sonde : les 16 premiers octets de HMAC-SHA256(clé = identifiant du PC, « tracker-sonde » ‖ nonce
 * de la question).
 */
export function identifiantDeSonde(identifiantPc: Uint8Array, nonce: Uint8Array): Uint8Array {
  exigerTaille(identifiantPc, TAILLE_IDENTIFIANT_PC, 'Identifiant du PC')
  exigerTaille(nonce, TAILLE_NONCE_SONDE, 'Nonce de la question')
  const hmac = createHmac('sha256', identifiantPc)
  hmac.update(Buffer.from(ETIQUETTE_SONDE, 'ascii'))
  hmac.update(nonce)
  return Uint8Array.from(hmac.digest().subarray(0, TAILLE_IDENTIFIANT_PC))
}

/** Octets d'une question. */
export function encoderQuestion(nonce: Uint8Array): Uint8Array {
  exigerTaille(nonce, TAILLE_NONCE_SONDE, 'Nonce de la question')
  return Buffer.concat([entete(SORTE_QUESTION), nonce])
}

/** Le nonce d'une question, `null` pour un paquet étranger. */
export function decoderQuestion(paquet: Uint8Array): { nonce: Uint8Array } | null {
  if (paquet.length !== TAILLE_QUESTION || !enteteDe(paquet, SORTE_QUESTION)) return null
  return { nonce: Uint8Array.from(paquet.subarray(6)) }
}

/**
 * Vrai pour une question à la taille et à la signature du format mais d'une autre version, que `decoderQuestion`
 * écarte : le PC le note au journal, sans répondre.
 */
export function questionDAutreVersion(paquet: Uint8Array): boolean {
  return paquet.length === TAILLE_QUESTION && signeDe(paquet, SORTE_QUESTION) && !enteteDe(paquet, SORTE_QUESTION)
}

/**
 * Nom du PC tel qu'il part au téléphone reconnu, par la liaison chiffrée : caractères de contrôle retirés, coupé à
 * 64 octets UTF-8 sans couper un caractère. Le nom de l'ordinateur sous Windows peut dépasser.
 */
export function nomPcPourSonde(nom: string): string {
  let sortie = ''
  for (const c of nom) {
    const code = c.codePointAt(0) ?? 0
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue
    if (Buffer.byteLength(sortie + c, 'utf8') > NOM_PC_MAX_OCTETS) break
    sortie += c
  }
  return sortie
}

/** Octets d'une réponse ; `identifiant` est l'identifiant de sonde (`identifiantDeSonde`). */
export function encoderReponse(reponse: ReponseSonde): Uint8Array {
  exigerTaille(reponse.nonce, TAILLE_NONCE_SONDE, 'Nonce de la question')
  exigerTaille(reponse.identifiant, TAILLE_IDENTIFIANT_PC, 'Identifiant de sonde')
  if (!Number.isInteger(reponse.port) || reponse.port < 1 || reponse.port > 65535) throw new RangeError(`Port hors bornes : ${reponse.port}.`)
  const port = Buffer.alloc(2)
  port.writeUInt16BE(reponse.port, 0)
  return Buffer.concat([entete(SORTE_REPONSE), reponse.nonce, port, reponse.identifiant, Buffer.from([0])])
}

/** La réponse d'un PC, `null` pour un paquet étranger. */
export function decoderReponse(paquet: Uint8Array): ReponseSonde | null {
  if (paquet.length !== TAILLE_REPONSE || !enteteDe(paquet, SORTE_REPONSE)) return null
  const octets = Buffer.from(paquet)
  if (octets[TAILLE_REPONSE - 1] !== 0) return null
  const port = octets.readUInt16BE(6 + TAILLE_NONCE_SONDE)
  if (port === 0) return null
  return {
    nonce: Uint8Array.from(octets.subarray(6, 6 + TAILLE_NONCE_SONDE)),
    port,
    identifiant: Uint8Array.from(octets.subarray(8 + TAILLE_NONCE_SONDE, 8 + TAILLE_NONCE_SONDE + TAILLE_IDENTIFIANT_PC)),
  }
}

// ---------- adresses IPv4 privées ----------

/** Une adresse IPv4 privée du PC, son masque, l'adresse de diffusion de son réseau et le nom de sa carte. */
export type AdressePrivee = { adresse: string; masque: string; diffusion: string; carte: string }

/** Ce que `os.networkInterfaces()` donne de chaque adresse (la famille est un nombre sur d'anciennes versions de Node). */
export type InfoAdresse = { address: string; netmask: string; family: string | number; internal: boolean }

/** Une adresse IPv4 écrite « a.b.c.d » en entier non signé de 32 bits, `null` si elle est mal écrite. */
export function lireIPv4(texte: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(texte)
  if (!m) return null
  const octets = m.slice(1).map(Number)
  if (octets.some((o) => o > 255)) return null
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0
}

/** Un entier non signé de 32 bits écrit « a.b.c.d ». */
export function ecrireIPv4(n: number): string {
  return [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.')
}

/** Rang d'une adresse privée (RFC 1918) : 0 pour 192.168/16, 1 pour 10/8, 2 pour 172.16/12 ; `null` si elle n'est pas privée. */
function rangPrive(n: number): number | null {
  if (n >>> 16 === 0xc0a8) return 0
  if (n >>> 24 === 10) return 1
  if (n >>> 20 === 0xac1) return 2
  return null
}

/**
 * Vrai pour une adresse IPv4 privée (RFC 1918 : 10/8, 172.16/12, 192.168/16) : le serveur n'écoute que sur
 * celles-là. Ni lien local (169.254/16), ni partage d'opérateur (100.64/10), ni boucle locale.
 */
export function adressePrivee(adresse: string): boolean {
  const n = lireIPv4(adresse)
  return n !== null && rangPrive(n) !== null
}

/** Adresse de diffusion du réseau d'une adresse et de son masque, `null` si l'une est mal écrite. */
export function adresseDeDiffusion(adresse: string, masque: string): string | null {
  const a = lireIPv4(adresse)
  const m = lireIPv4(masque)
  if (a === null || m === null) return null
  return ecrireIPv4((a | ~m) >>> 0)
}

/** Vrai si deux adresses sont dans le même réseau pour ce masque. */
export function memeReseau(a: string, b: string, masque: string): boolean {
  const x = lireIPv4(a)
  const y = lireIPv4(b)
  const m = lireIPv4(masque)
  return x !== null && y !== null && m !== null && ((x & m) >>> 0) === ((y & m) >>> 0)
}

/** Cartes réseau d'une machine virtuelle ou d'un conteneur, d'après leur nom : rangées après les vraies. */
const CARTE_VIRTUELLE = /virtual|vmware|vethernet|hyper-v|wsl|docker|vbox/i

/**
 * Adresses IPv4 privées du PC, d'après `os.networkInterfaces()` : ni boucle locale, ni adresse publique, chacune une
 * fois. Ordre : les cartes qui ne semblent pas virtuelles d'abord, puis 192.168/16, 10/8, 172.16/12, puis par nom
 * de carte et par adresse. Le serveur écoute sur toutes ; l'ordre sert à choisir celle qu'on affiche.
 */
export function adressesPrivees(cartes: Record<string, readonly InfoAdresse[] | undefined>): AdressePrivee[] {
  const vues = new Map<string, AdressePrivee & { rang: number; virtuelle: boolean; valeur: number }>()
  for (const [carte, infos] of Object.entries(cartes)) {
    for (const info of infos ?? []) {
      if (info.internal || (info.family !== 'IPv4' && info.family !== 4)) continue
      const valeur = lireIPv4(info.address)
      const rang = valeur === null ? null : rangPrive(valeur)
      const diffusion = adresseDeDiffusion(info.address, info.netmask)
      if (valeur === null || rang === null || diffusion === null || vues.has(info.address)) continue
      vues.set(info.address, { adresse: info.address, masque: info.netmask, diffusion, carte, rang, virtuelle: CARTE_VIRTUELLE.test(carte), valeur })
    }
  }
  return [...vues.values()]
    .sort((a, b) => Number(a.virtuelle) - Number(b.virtuelle) || a.rang - b.rang || (a.carte < b.carte ? -1 : a.carte > b.carte ? 1 : 0) || a.valeur - b.valeur)
    .map(({ adresse, masque, diffusion, carte }) => ({ adresse, masque, diffusion, carte }))
}
