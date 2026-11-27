// Appairage d'un téléphone au programme Windows par un code tapé, et registre des téléphones appairés. Calcul pur :
// l'horloge et l'aléa sont passés en paramètre, rien ne touche au réseau ni au disque.
//
// ---------- Déroulé (messages décrits dans `trames.ts`) ----------
//
// 1. Sur le PC, l'utilisateur ouvre une fenêtre d'appairage : 2 minutes, un code de 6 chiffres affiché (tiré
//    uniformément de 000000 à 999999). Trois codes faux ferment la fenêtre ; un appairage réussi aussi, et une
//    onzième tentative commencée (au plus dix par fenêtre).
// 2. Le téléphone se connecte en TLS, sans rien vérifier encore, et lit l'empreinte du certificat du PC : SHA-256 des
//    octets DER du certificat, 32 octets. Il tire son scalaire x et envoie `appairer` avec `nonceTelephone` (32 octets
//    tirés au hasard) et sa part SPAKE2 `partA`, calculée avec le code tapé par l'utilisateur et cette empreinte.
// 3. Le PC tire un scalaire y neuf pour cette seule tentative, calcule sa part `partB` avec le code affiché et
//    l'empreinte de son propre certificat, et répond `defi` avec `noncePc` (32 octets tirés au hasard) et `partB`.
//    Une `partA` qui n'est pas un point admis, ou qui donne une clé neutre (part fabriquée sur un code deviné juste),
//    compte aussitôt comme un code faux, avant toute réponse ; le PC répond pourtant `defi` après le même calcul,
//    puis refuse la `preuve` comme une confirmation fausse : rien ne distingue ce refus de celui d'un code deviné
//    faux, ni dans les messages ni dans leur délai.
// 4. Le téléphone calcule les clés et envoie `preuve` : sa confirmation cA.
// 5. Le PC vérifie cA (à temps constant). Fausse : `refus` (raison `code`), un échec de plus. Juste : `appaire`,
//    avec sa confirmation cB et un jeton de 32 octets tiré au hasard ; la fenêtre se ferme.
// 6. Le téléphone vérifie cB avant de rien garder ; juste, il garde le jeton, l'empreinte du certificat (fixée :
//    toute liaison suivante dont le certificat a une autre empreinte est refusée), l'identifiant du PC.
// Le code ne circule jamais, et rien de ce qui circule ne permet de l'essayer hors ligne : chaque tentative n'essaie
//    qu'un code, et le PC ne dit rien qui dépende du code tant que le téléphone n'a pas confirmé le connaître. Un
//    faux PC n'obtient du téléphone qu'une confirmation qu'il ne peut pas vérifier, et ne sait pas fabriquer cB. Un
//    relais vers le vrai PC échoue : les deux liaisons TLS ont deux empreintes, donc deux transcriptions.
//
// Formules de l'échange (RFC 9382, suite P256-SHA256-HKDF-HMAC, identités et étiquettes) : en tête de `spake2.ts`.
// Les octets circulent en hexadécimal minuscule. Un `appairer` sans `partA` est refusé avec la raison `version`.
//
// ---------- Jeton ----------
//
// Au retour, le téléphone envoie `bonjour` avec son jeton (hexadécimal minuscule, 64 chiffres), par la liaison TLS
// dont il a vérifié l'empreinte. Le PC ne garde que le hachage du jeton : SHA-256 de ses 32 octets bruts, en
// hexadécimal minuscule. Un jeton de 256 bits tiré au hasard n'a pas besoin d'un hachage lent.
//
// ---------- Registre (profil du PC, jamais le dossier mémoire) ----------
//
//   { "version": 1, "telephones": [ { "id": "<16 octets en hexadécimal>", "nom": "Pixel 8",
//     "hachage": "<SHA-256 du jeton en hexadécimal>", "ajouteLe": <ms>, "vuLe": <ms ou null> } ] }
//
// `vuLe` est l'heure de la dernière arrivée du téléphone : posée à l'appairage (sa première liaison, `ajouter`) et à
// chaque présentation par le jeton (`arrivee`). `null` ne se lit que dans un registre écrit avant cette règle.
// Un PC accepte plusieurs téléphones ; retirer un téléphone révoque son jeton.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { ErreurDisque } from './disque'
import type { ClesSpake2, EtatSpake2 } from './spake2'
import { ErreurSpake2, commencerAppairage, confirmationValide, conclure as conclureSpake2, tirerScalaire } from './spake2'
import type { RaisonRefus } from './trames'
import { TAILLE_EMPREINTE, TAILLE_IDENTIFIANT, TAILLE_JETON, TAILLE_NONCE, TAILLE_PART_SPAKE2, TAILLE_PREUVE, nomAdmis } from './trames'

/** Source d'octets aléatoires ; `randomBytes` de Node hors des tests. */
export type Alea = (taille: number) => Uint8Array

/** Heure courante en millisecondes ; `Date.now` hors des tests. */
export type Horloge = () => number

/** Nombre de chiffres du code. */
export const CHIFFRES_CODE = 6

/** Durée d'une fenêtre d'appairage. */
export const DUREE_FENETRE_MS = 120_000

/** Codes faux (confirmations fausses ou parts refusées) qui ferment la fenêtre. */
export const ECHECS_MAX = 3

/**
 * Tentatives commencées par fenêtre. Un vrai téléphone en fait une, quelques-unes s'il perd la liaison ; au-delà,
 * c'est un hôte du réseau qui enchaîne les `appairer` sans confirmer : la tentative de trop est refusée et ferme la
 * fenêtre, si bien que la mémoire et le calcul dépensés par fenêtre restent bornés (l'utilisateur en rouvre une).
 */
export const TENTATIVES_MAX = 10

/** Tailles des octets de l'appairage, tenues par `trames.ts` qui lit les messages. */
export { TAILLE_EMPREINTE, TAILLE_IDENTIFIANT, TAILLE_JETON, TAILLE_NONCE, TAILLE_PART_SPAKE2, TAILLE_PREUVE }

/** Version du registre écrit dans le profil. */
export const VERSION_REGISTRE = 1

// ---------- outils ----------

/** Octets en hexadécimal minuscule. */
export function enHex(octets: Uint8Array): string {
  return Buffer.from(octets).toString('hex')
}

/** Octets d'un texte hexadécimal minuscule de `taille` octets, `null` s'il n'en est pas un. */
export function depuisHex(texte: string, taille: number): Uint8Array | null {
  if (texte.length !== taille * 2 || !/^[0-9a-f]*$/.test(texte)) return null
  return Buffer.from(texte, 'hex')
}

/** Égalité de deux suites d'octets dont la durée ne dépend pas du contenu (seulement des longueurs). */
export function egalATempsConstant(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function exigerTaille(octets: Uint8Array, taille: number, quoi: string): void {
  if (octets.length !== taille) throw new ErreurDisque('UNKNOWN', `${quoi} : ${taille} octets attendus, ${octets.length} reçus.`)
}

/** Code de 6 chiffres, tiré sans biais : un entier de 32 bits est retiré tant qu'il tombe dans la dernière tranche incomplète. */
export function tirerCode(alea: Alea = randomBytes): string {
  const tranches = 10 ** CHIFFRES_CODE
  const plafond = Math.floor(2 ** 32 / tranches) * tranches
  for (;;) {
    const octets = alea(4)
    const v = Buffer.from(octets).readUInt32BE(0)
    if (v < plafond) return String(v % tranches).padStart(CHIFFRES_CODE, '0')
  }
}

/** Jeton de 32 octets. */
export function tirerJeton(alea: Alea = randomBytes): Uint8Array {
  const jeton = alea(TAILLE_JETON)
  exigerTaille(jeton, TAILLE_JETON, 'Jeton')
  return jeton
}

/** Hachage d'un jeton tel que le PC le garde : SHA-256 de ses octets bruts, en hexadécimal minuscule. */
export function hacherJeton(jeton: Uint8Array): string {
  exigerTaille(jeton, TAILLE_JETON, 'Jeton')
  return createHash('sha256').update(jeton).digest('hex')
}

/** Identifiant de 16 octets en hexadécimal minuscule : celui du PC (tiré une fois, gardé dans le profil) ou d'un téléphone appairé. */
export function tirerIdentifiant(alea: Alea = randomBytes): string {
  const octets = alea(TAILLE_IDENTIFIANT)
  exigerTaille(octets, TAILLE_IDENTIFIANT, 'Identifiant')
  return enHex(octets)
}

// ---------- la fenêtre d'appairage ----------

/**
 * Le calcul d'une tentative admise (décodage, masque, multiplication par un scalaire, transcription, dérivations),
 * refait et jeté quand la part reçue est refusée : une clé neutre est détectée avant la multiplication par y, et
 * sans ce calcul le `defi` partirait nettement plus tôt. Le délai n'est pas tout à fait celui d'une tentative admise
 * (le leurre refait en plus le masque w·M) ; cet écart n'apprend rien de plus à l'intrus : son essai est compté comme
 * un code faux avant toute réponse, et il n'a éprouvé qu'un seul code, comme un essai honnête. Le calcul porte sur un
 * scalaire neuf et sur la part du PC, jamais sur y, qui ne sert qu'à un seul `conclure`. Rien n'en sort.
 */
function calculLeurre(etat: EtatSpake2, alea: Alea): void {
  const leurre: EtatSpake2 = { ...etat, secret: tirerScalaire(alea) }
  try {
    conclureSpake2(leurre, etat.part)
  } catch (e) {
    // pB − w·M neutre : probabilité négligeable, et rien à en dire de plus.
    if (!(e instanceof ErreurSpake2)) throw e
  }
}

/** Issue d'une tentative : le jeton à donner au téléphone avec la confirmation cB du PC, ou la raison du refus. */
export type ConclusionAppairage =
  | { ok: true; confirmationB: Uint8Array; jeton: Uint8Array }
  | { ok: false; raison: RaisonRefus; fenetreFermee: boolean }

/**
 * Une tentative commencée : le `noncePc` et la part `partB` à envoyer dans `defi`, et la vérification de la
 * confirmation cA du téléphone, une seule fois.
 */
export type TentativeAppairage = { ok: true; noncePc: Uint8Array; partB: Uint8Array; conclure(confirmationA: Uint8Array): ConclusionAppairage }

export type OptionsFenetre = {
  /** Empreinte SHA-256 du certificat que le PC présente, 32 octets : l'identité du PC dans l'échange (idB). */
  empreinte: Uint8Array
  horloge?: Horloge
  alea?: Alea
  dureeMs?: number
  echecsMax?: number
  tentativesMax?: number
}

/**
 * Une fenêtre d'appairage : son code, sa fin, ses échecs. Plusieurs tentatives peuvent courir ensemble ; la première
 * qui réussit ferme la fenêtre. Un même `nonceTelephone` ne sert qu'une fois, une tentative ne se conclut qu'une fois,
 * et une fenêtre n'en commence pas plus de `TENTATIVES_MAX` : la suivante la ferme.
 */
export class FenetreAppairage {
  /** Le code à afficher. */
  readonly code: string
  /** Heure où la fenêtre se ferme d'elle-même, en millisecondes. */
  readonly expireA: number
  /** Empreinte du certificat du PC, son identité (idB) dans chaque échange de la fenêtre ; publique par nature. */
  readonly empreinte: Uint8Array
  private readonly horloge: Horloge
  private readonly alea: Alea
  private readonly echecsMax: number
  private readonly tentativesMax: number
  private echecsVus = 0
  private fermee = false
  private readonly noncesVus = new Set<string>()

  constructor(options: OptionsFenetre) {
    exigerTaille(options.empreinte, TAILLE_EMPREINTE, 'Empreinte du certificat')
    this.empreinte = Uint8Array.from(options.empreinte)
    this.horloge = options.horloge ?? Date.now
    this.alea = options.alea ?? randomBytes
    this.echecsMax = options.echecsMax ?? ECHECS_MAX
    this.tentativesMax = options.tentativesMax ?? TENTATIVES_MAX
    this.code = tirerCode(this.alea)
    this.expireA = this.horloge() + (options.dureeMs ?? DUREE_FENETRE_MS)
  }

  /** Codes faux reçus : confirmations fausses et parts refusées. */
  get echecs(): number {
    return this.echecsVus
  }

  /** Vrai tant que la fenêtre admet une tentative : ni expirée, ni fermée par un succès, trois échecs ou `fermer`. */
  ouverte(): boolean {
    return this.ouverteSansEchecs(0)
  }

  /** Vrai si la fenêtre serait ouverte avec `retires` codes faux de moins. */
  private ouverteSansEchecs(retires: number): boolean {
    return !this.fermee && this.echecsVus - retires < this.echecsMax && this.horloge() < this.expireA
  }

  /** Millisecondes avant la fermeture, 0 si elle est fermée. */
  restantMs(): number {
    return this.ouverte() ? this.expireA - this.horloge() : 0
  }

  /** Ferme la fenêtre : plus aucune tentative ne réussit, même commencée. */
  fermer(): void {
    this.fermee = true
  }

  /** Tentatives commencées. */
  get tentatives(): number {
    return this.noncesVus.size
  }

  /**
   * Commence une tentative sur le `nonceTelephone` et la part `partA` reçus dans `appairer`. Refus `fenetre` si elle
   * est fermée, ou si `TENTATIVES_MAX` tentatives sont déjà commencées (la fenêtre se ferme alors) ; refus `nonce` sur
   * un nonce déjà vu. Une part qui n'est pas un point admis, ou qui donne une clé neutre, compte aussitôt comme un
   * code faux : une clé neutre ne vient que d'une part fabriquée sur le code juste. La tentative est pourtant rendue,
   * avec sa `partB`, après un calcul de même nature qu'une tentative admise (`calculLeurre`), et sa conclusion est celle d'une confirmation
   * fausse, quelle que soit la confirmation reçue : la réponse n'en dit pas plus qu'un code deviné faux.
   */
  commencer(nonceTelephone: Uint8Array, partA: Uint8Array): TentativeAppairage | { ok: false; raison: RaisonRefus } {
    exigerTaille(nonceTelephone, TAILLE_NONCE, 'Nonce du téléphone')
    exigerTaille(partA, TAILLE_PART_SPAKE2, 'Part du téléphone')
    if (!this.ouverte()) return { ok: false, raison: 'fenetre' }
    const cle = enHex(nonceTelephone)
    if (this.noncesVus.has(cle)) return { ok: false, raison: 'nonce' }
    if (this.noncesVus.size >= this.tentativesMax) {
      this.fermee = true
      return { ok: false, raison: 'fenetre' }
    }
    this.noncesVus.add(cle)
    const noncePc = Uint8Array.from(this.alea(TAILLE_NONCE))
    exigerTaille(noncePc, TAILLE_NONCE, 'Nonce du PC')
    // Un état SPAKE2 par tentative, y neuf (aléa du système hors des tests), conclu une seule fois, ici : il n'est
    // gardé nulle part, et seules les clés de la tentative restent, jusqu'à la vérification de cA.
    const etat = commencerAppairage('B', this.code, this.empreinte, this.alea)
    let cles: ClesSpake2 | null = null
    try {
      cles = conclureSpake2(etat, partA)
    } catch (e) {
      if (!(e instanceof ErreurSpake2)) throw e
      // Compté avant toute réponse, que le téléphone poursuive ou non : un seul code éprouvé, comme un essai honnête.
      this.echecsVus++
      calculLeurre(etat, this.alea)
    }
    let conclue = false
    return {
      ok: true,
      noncePc,
      partB: etat.part,
      conclure: (confirmationA: Uint8Array): ConclusionAppairage => {
        if (conclue) return { ok: false, raison: 'nonce', fenetreFermee: !this.ouverte() }
        conclue = true
        const lues = cles
        cles = null
        if (lues === null) {
          // Code faux déjà compté : même issue qu'une confirmation fausse, jugée sur la fenêtre telle qu'elle était
          // sans lui, et même comparaison à temps constant.
          egalATempsConstant(confirmationA, new Uint8Array(TAILLE_PREUVE))
          if (!this.ouverteSansEchecs(1)) return { ok: false, raison: 'fenetre', fenetreFermee: true }
          return { ok: false, raison: 'code', fenetreFermee: !this.ouverte() }
        }
        if (!this.ouverte()) return { ok: false, raison: 'fenetre', fenetreFermee: true }
        if (!confirmationValide(lues, confirmationA)) {
          this.echecsVus++
          return { ok: false, raison: 'code', fenetreFermee: !this.ouverte() }
        }
        this.fermee = true
        return { ok: true, confirmationB: lues.confirmationEnvoyee, jeton: tirerJeton(this.alea) }
      },
    }
  }
}

// ---------- registre des téléphones appairés ----------

/** Un téléphone appairé, tel que le profil le garde. */
export type TelephoneAppaire = { id: string; nom: string; hachage: string; ajouteLe: number; vuLe: number | null }

/** Ce que la page peut voir d'un téléphone appairé : rien du jeton. */
export type TelephoneVisible = Omit<TelephoneAppaire, 'hachage'>

function telephoneLu(v: unknown): TelephoneAppaire | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const { id, nom, hachage, ajouteLe, vuLe } = v as Record<string, unknown>
  if (typeof id !== 'string' || depuisHex(id, TAILLE_IDENTIFIANT) === null) return null
  if (typeof nom !== 'string' || !nomAdmis(nom)) return null
  if (typeof hachage !== 'string' || depuisHex(hachage, 32) === null) return null
  if (typeof ajouteLe !== 'number' || !Number.isFinite(ajouteLe)) return null
  if (vuLe !== null && (typeof vuLe !== 'number' || !Number.isFinite(vuLe))) return null
  return { id, nom, hachage, ajouteLe, vuLe }
}

/** Les téléphones appairés à ce PC. */
export class RegistreTelephones {
  private telephones: TelephoneAppaire[]

  constructor(telephones: TelephoneAppaire[] = []) {
    this.telephones = telephones.map((t) => ({ ...t }))
  }

  /**
   * Registre relu du profil. Un texte absent ou illisible donne un registre vide (les téléphones se réappaireront) ;
   * une entrée mal formée ou en double (même identifiant) est écartée, les autres restent.
   */
  static depuisJson(texte: string | null): RegistreTelephones {
    if (texte === null) return new RegistreTelephones()
    let valeur: unknown
    try {
      valeur = JSON.parse(texte)
    } catch {
      return new RegistreTelephones()
    }
    const liste = typeof valeur === 'object' && valeur !== null ? (valeur as Record<string, unknown>).telephones : undefined
    if (!Array.isArray(liste)) return new RegistreTelephones()
    const ids = new Set<string>()
    const telephones: TelephoneAppaire[] = []
    for (const brut of liste) {
      const t = telephoneLu(brut)
      if (t === null || ids.has(t.id)) continue
      ids.add(t.id)
      telephones.push(t)
    }
    return new RegistreTelephones(telephones)
  }

  /** Texte à écrire dans le profil. */
  enJson(): string {
    return JSON.stringify({ version: VERSION_REGISTRE, telephones: this.telephones }, null, 2) + '\n'
  }

  /** Téléphones appairés, dans l'ordre d'appairage, sans leur hachage. */
  liste(): TelephoneVisible[] {
    return this.telephones.map(({ hachage: _hachage, ...visible }) => visible)
  }

  /**
   * Inscrit un téléphone qui vient de recevoir `jeton`, et rend sa fiche visible. L'appairage est sa première
   * arrivée : `vuLe` vaut `maintenant`, comme `ajouteLe`.
   */
  ajouter(nom: string, jeton: Uint8Array, maintenant: number, alea: Alea = randomBytes): TelephoneVisible {
    if (!nomAdmis(nom)) throw new ErreurDisque('UNKNOWN', "Nom de téléphone refusé.")
    let id = tirerIdentifiant(alea)
    while (this.telephones.some((t) => t.id === id)) id = tirerIdentifiant(alea)
    const telephone: TelephoneAppaire = { id, nom, hachage: hacherJeton(jeton), ajouteLe: maintenant, vuLe: maintenant }
    this.telephones.push(telephone)
    const { hachage: _hachage, ...visible } = telephone
    return visible
  }

  /** Retire un téléphone : son jeton ne vaut plus rien. Faux s'il n'était pas inscrit. */
  retirer(id: string): boolean {
    const avant = this.telephones.length
    this.telephones = this.telephones.filter((t) => t.id !== id)
    return this.telephones.length !== avant
  }

  /**
   * Le téléphone dont `jetonHex` est le jeton, `null` si aucun (jeton mal formé, inconnu ou révoqué). Tous les
   * hachages sont comparés, à temps constant, sans s'arrêter au premier trouvé.
   */
  verifier(jetonHex: string): TelephoneVisible | null {
    const jeton = depuisHex(jetonHex, TAILLE_JETON)
    if (jeton === null) return null
    const recu = Buffer.from(hacherJeton(jeton), 'hex')
    let trouve: TelephoneAppaire | null = null
    for (const t of this.telephones) {
      if (egalATempsConstant(recu, Buffer.from(t.hachage, 'hex')) && trouve === null) trouve = t
    }
    if (trouve === null) return null
    const { hachage: _hachage, ...visible } = trouve
    return visible
  }

  /** Note l'heure de la dernière liaison d'un téléphone ; sans effet s'il n'est pas inscrit. */
  marquerVu(id: string, maintenant: number): void {
    const t = this.telephones.find((x) => x.id === id)
    if (t) t.vuLe = maintenant
  }

  /**
   * Arrivée d'un téléphone qui présente son jeton (`bonjour`) : le téléphone reconnu (`verifier`), son `vuLe` posé à
   * `maintenant` ; `null`, et rien de changé, si le jeton est mal formé, inconnu ou révoqué. Seule entrée du serveur
   * pour un `bonjour` : aucune arrivée reconnue ne laisse `vuLe` en arrière.
   */
  arrivee(jetonHex: string, maintenant: number): TelephoneVisible | null {
    const telephone = this.verifier(jetonHex)
    if (telephone === null) return null
    this.marquerVu(telephone.id, maintenant)
    return { ...telephone, vuLe: maintenant }
  }
}
