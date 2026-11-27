// Certificat auto-signé du serveur sans fil du PC, fabriqué sans bibliothèque : un petit encodeur DER suffit, la
// clé et la signature viennent de `node:crypto`. Le téléphone ne vérifie aucune chaîne de confiance : il fixe à
// l'appairage l'empreinte du certificat et refuse ensuite tout certificat d'une autre empreinte.
//
// ---------- Ce qui est fabriqué ----------
//
// - Clé : ECDSA sur la courbe P-256 (prime256v1), que Node et Android savent servir en TLS.
// - Certificat X.509 version 3 : numéro de série de 16 octets tirés au hasard (positif), émetteur et sujet
//   « CN=Tracker » (le nom donné), validité du jour précédent (marge pour une horloge en retard) au
//   31/12/9999 23:59:59 UTC (« sans échéance », RFC 5280), une seule extension : « basicConstraints », critique,
//   pas une autorité. Signature ecdsa-with-SHA256 (OID 1.2.840.10045.4.3.2).
// - Empreinte : SHA-256 des octets DER du certificat, 32 octets ; c'est elle qui entre dans les preuves d'appairage
//   et que le téléphone garde. Écrite pour un humain comme X509Certificate.fingerprint256 : « AB:CD:… ».
//
// Le PC fabrique son certificat une fois et le garde dans son profil, clé chiffrée par le système ; changer de
// certificat oblige à réappairer chaque téléphone.

import { X509Certificate, createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import type { Alea } from './appairage'

/** Nom porté par le certificat. */
export const NOM_CERTIFICAT = 'Tracker'

/** Marge avant l'heure de fabrication, contre une horloge en retard. */
const MARGE_DEBUT_MS = 24 * 3600 * 1000

/** Fin de validité « sans échéance » de la RFC 5280. */
const FIN_SANS_ECHEANCE_MS = Date.UTC(9999, 11, 31, 23, 59, 59)

const OID_ECDSA_SHA256 = '1.2.840.10045.4.3.2'
const OID_NOM_COMMUN = '2.5.4.3'
const OID_CONTRAINTES_DE_BASE = '2.5.29.19'

// ---------- encodeur DER ----------

function longueurDer(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n])
  const octets: number[] = []
  for (let v = n; v > 0; v = Math.floor(v / 256)) octets.unshift(v % 256)
  return Buffer.from([0x80 | octets.length, ...octets])
}

/** Un élément DER : étiquette, longueur, contenu. */
function tlv(etiquette: number, ...contenus: Uint8Array[]): Buffer {
  const contenu = Buffer.concat(contenus)
  return Buffer.concat([Buffer.from([etiquette]), longueurDer(contenu.length), contenu])
}

const sequence = (...contenus: Uint8Array[]) => tlv(0x30, ...contenus)
const ensemble = (...contenus: Uint8Array[]) => tlv(0x31, ...contenus)
/** Étiquette de contexte explicite `[n]`. */
const explicite = (n: number, contenu: Uint8Array) => tlv(0xa0 | n, contenu)

/** Entier positif à partir de ses octets gros-boutistes : zéros de tête retirés, un octet nul ajouté si le bit de signe est levé. */
function entier(octets: Uint8Array): Buffer {
  let debut = 0
  while (debut < octets.length - 1 && octets[debut] === 0) debut++
  const utiles = Buffer.from(octets.subarray(debut))
  return tlv(0x02, utiles.length > 0 && utiles[0] & 0x80 ? Buffer.concat([Buffer.from([0]), utiles]) : utiles)
}

function identifiantObjet(oid: string): Buffer {
  const parts = oid.split('.').map(Number)
  const octets: number[] = [40 * parts[0] + parts[1]]
  for (const p of parts.slice(2)) {
    const groupes: number[] = []
    for (let v = p; ; v = Math.floor(v / 128)) {
      groupes.unshift(v % 128)
      if (v < 128) break
    }
    octets.push(...groupes.map((g, i) => (i < groupes.length - 1 ? g | 0x80 : g)))
  }
  return tlv(0x06, Buffer.from(octets))
}

const texteUtf8 = (texte: string) => tlv(0x0c, Buffer.from(texte, 'utf8'))

/** Date DER : UTCTime de 1950 à 2049, GeneralizedTime au-delà (RFC 5280), à la seconde, en UTC. */
function date(ms: number): Buffer {
  const d = new Date(Math.floor(ms / 1000) * 1000)
  const deux = (n: number) => String(n).padStart(2, '0')
  const reste = `${deux(d.getUTCMonth() + 1)}${deux(d.getUTCDate())}${deux(d.getUTCHours())}${deux(d.getUTCMinutes())}${deux(d.getUTCSeconds())}Z`
  const annee = d.getUTCFullYear()
  if (annee >= 1950 && annee < 2050) return tlv(0x17, Buffer.from(deux(annee % 100) + reste, 'ascii'))
  return tlv(0x18, Buffer.from(String(annee).padStart(4, '0') + reste, 'ascii'))
}

function nom(texte: string): Buffer {
  return sequence(ensemble(sequence(identifiantObjet(OID_NOM_COMMUN), texteUtf8(texte))))
}

// ---------- certificat ----------

/** Un certificat fabriqué : PEM du certificat et de sa clé (PKCS#8), octets DER, empreinte SHA-256. */
export type CertificatFabrique = { certificat: string; cle: string; der: Uint8Array; empreinte: Uint8Array }

export type OptionsCertificat = {
  /** Heure de fabrication, en millisecondes. */
  maintenant?: number
  /** Source du numéro de série. */
  alea?: Alea
  /** Paire de clés P-256 ; une neuve sinon. */
  cles?: { publicKey: KeyObject; privateKey: KeyObject }
  /** Nom commun de l'émetteur et du sujet. */
  nom?: string
}

function enPem(der: Uint8Array): string {
  const lignes = Buffer.from(der).toString('base64').match(/.{1,64}/g) ?? []
  return `-----BEGIN CERTIFICATE-----\n${lignes.join('\n')}\n-----END CERTIFICATE-----\n`
}

/** Octets DER d'un certificat en PEM, ou ceux donnés tels quels. */
function derDe(certificat: string | Uint8Array): Uint8Array {
  if (typeof certificat !== 'string') return certificat
  return new X509Certificate(certificat).raw
}

/** Empreinte SHA-256 d'un certificat (PEM ou DER), 32 octets. */
export function empreinteCertificat(certificat: string | Uint8Array): Uint8Array {
  return createHash('sha256').update(derDe(certificat)).digest()
}

/** Empreinte pour un humain : octets en hexadécimal majuscule séparés par « : », comme `fingerprint256`. */
export function empreinteLisible(empreinte: Uint8Array): string {
  return (Buffer.from(empreinte).toString('hex').toUpperCase().match(/../g) ?? []).join(':')
}

/** Fabrique un certificat auto-signé et sa clé. */
export function fabriquerCertificat(options: OptionsCertificat = {}): CertificatFabrique {
  const maintenant = options.maintenant ?? Date.now()
  const { publicKey, privateKey } = options.cles ?? generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const serie = Buffer.from((options.alea ?? randomBytes)(16))
  // Premier octet entre 0x40 et 0x7f : le numéro est positif et garde ses 16 octets.
  serie[0] = (serie[0] & 0x7f) | 0x40
  const algorithme = sequence(identifiantObjet(OID_ECDSA_SHA256))
  const emetteur = nom(options.nom ?? NOM_CERTIFICAT)
  const contraintes = sequence(identifiantObjet(OID_CONTRAINTES_DE_BASE), tlv(0x01, Buffer.from([0xff])), tlv(0x04, sequence()))
  const aSigner = sequence(
    explicite(0, entier(Buffer.from([2]))),
    entier(serie),
    algorithme,
    emetteur,
    sequence(date(maintenant - MARGE_DEBUT_MS), date(FIN_SANS_ECHEANCE_MS)),
    emetteur,
    publicKey.export({ type: 'spki', format: 'der' }),
    explicite(3, sequence(contraintes)),
  )
  const signature = sign('sha256', aSigner, privateKey)
  const der = sequence(aSigner, algorithme, tlv(0x03, Buffer.from([0]), signature))
  return {
    certificat: enPem(der),
    cle: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    der,
    empreinte: empreinteCertificat(der),
  }
}

/**
 * Vrai si le certificat relu du profil peut servir : lisible, signé par sa propre clé, apparié à la clé donnée,
 * valide à `maintenant`. Faux sur tout défaut (le PC en fabrique alors un autre, et les téléphones se réappairent).
 */
export function certificatUtilisable(certificat: string, cle: string, maintenant: number = Date.now()): boolean {
  try {
    const x = new X509Certificate(certificat)
    const privee = createPrivateKey(cle)
    if (!x.checkPrivateKey(privee) || !x.verify(x.publicKey)) return false
    return Date.parse(x.validFrom) <= maintenant && maintenant <= Date.parse(x.validTo)
  } catch {
    return false
  }
}
