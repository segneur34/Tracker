// Trames de la liaison sans fil entre le programme Windows et le téléphone : découpage d'un flux d'octets en
// messages, et forme de chaque message. Calcul pur, sans réseau : la socket TLS qui porte ces trames est ailleurs.
//
// Le PC écoute, le téléphone se connecte par TLS et se présente (appairage par code, ou jeton déjà reçu) ; ensuite
// le PC envoie les commandes (`lister`, `lire`, `ping`, et pour un téléphone qui annonce la capacité « ecriture » :
// `listerTout`, `ecrire`, `valider`, `deplacer`, `listerCorbeille`) et le téléphone y répond.
//
// Aucune commande n'efface un fichier de l'utilisateur : ce que l'ordinateur retire du téléphone est déplacé dans la
// corbeille du téléphone (`deplacer`). Le seul effacement est celui du provisoire d'une écriture ratée, par le
// téléphone lui-même. Un `effacer` serait un message inconnu, qui ferme la liaison.
//
// Compatibilité : la version du protocole reste 1 ; ce qu'un téléphone sait de plus s'annonce dans le champ facultatif
// `capacites` de `appairer` et `bonjour`. Un PC n'envoie jamais à un téléphone une commande dont il n'a pas annoncé
// la capacité (un téléphone plus ancien ferme la liaison sur un `type` inconnu). La capacité « ecriture » vaut à la
// fois listage complet (racine, `sessions/`, `itineraires/`, `reglages/`, `journaux/`), listage du dossier entier,
// écriture, déplacement vers la corbeille et listage de la corbeille, jamais l'un sans l'autre : écrire sans lister
// `reglages/` ferait recopier une copie ancienne par-dessus le fichier de réglages du téléphone.
//
// ---------- Format d'une trame (à reproduire tel quel côté téléphone) ----------
//
//   octets 0 à 3   longueur N de l'en-tête, entier non signé sur 32 bits, gros-boutiste (octet de poids fort d'abord)
//   octets 4 à 7   longueur M du corps, même codage
//   N octets       l'en-tête : un objet JSON encodé en UTF-8, sans marque d'ordre d'octets ; il porte toujours un
//                  champ `type` (texte non vide) ; des champs inconnus sont ignorés, l'ordre des champs est libre
//   M octets       le corps, octets bruts ; vide (M = 0) pour tous les messages sauf `bloc` et `ecrire`
//
// Limites, vérifiées dès les 8 premiers octets, avant de rien attendre de plus :
//   1 ≤ N ≤ 8 388 608 (8 Mio, de quoi lister des milliers de sessions) ; 16 384 tant que le téléphone ne s'est pas
//   présenté (`LIMITES_ACCUEIL`) ;
//   0 ≤ M ≤ 1 048 576 (1 Mio, la taille d'un bloc de lecture ou d'écriture) ; 0 tant que le téléphone ne s'est pas
//   présenté.
// Une trame hors limites, un en-tête qui n'est pas de l'UTF-8 valide ou pas un objet JSON à `type` texte, ou un flux
// qui s'arrête au milieu d'une trame, sont des erreurs de la liaison : on la ferme.
//
// ---------- Messages (champ `type` de l'en-tête) ----------
//
// Conventions : `nonce…`, `preuve`, `jeton` et `identifiantPc` sont des octets écrits en hexadécimal minuscule
// (64 chiffres pour 32 octets, 32 chiffres pour 16 octets) ; `id`, `debut`, `longueur`, `taille`, `version` sont des
// entiers JSON positifs ou nuls ; `dateMs` est une date en millisecondes depuis le 1er janvier 1970 (UTC) ; `nom`
// est un texte de 1 à 100 caractères sans caractère de contrôle. Les chemins sont relatifs au dossier mémoire du
// téléphone (`Documents/Tracker`), `/` comme séparateur.
//
// Accueil, téléphone vers PC (premier message de la liaison) :
//   appairer   { version, nom, nonceTelephone, partA?, capacites? }   demande d'appairage par le code affiché sur le
//                                                       PC ; partA : la part SPAKE2 du téléphone, 65 octets (130
//                                                       chiffres) ; sans elle, le PC refuse (raison `version`)
//   bonjour    { version, nom, jeton, capacites? }      téléphone déjà appairé, il présente son jeton
//   capacites, facultatif : tableau de textes, ce que le téléphone sait faire en plus du protocole de base ; seule
//   lue par le PC, « ecriture » (`CAPACITES`) ; un téléphone annonce aussi « spake2 » dans `appairer`
//   (`CAPACITE_SPAKE2`), que le PC ignore : c'est la présence de `partA` qui compte. Un texte inconnu est ignoré, un
//   doublon compte une fois ; absent, le téléphone ne sait que lire (`lister` limité à la racine et à `sessions/`).
//   Un `capacites` qui n'est pas un tableau de textes rend le message invalide.
// Appairage (échange SPAKE2 et confirmations : `spake2.ts` ; déroulé : `appairage.ts`) :
//   defi       { noncePc, partB? }                      PC vers téléphone, réponse à `appairer` ; partB : la part
//                                                       SPAKE2 du PC, 65 octets ; le PC l'envoie toujours, et un
//                                                       téléphone s'arrête (`version`) sur un `defi` sans elle, sans
//                                                       rien prouver
//   preuve     { preuve }                               téléphone vers PC : sa confirmation cA, 32 octets
//   appaire    { preuve, jeton, identifiantPc, nomPc }  PC vers téléphone : sa confirmation cB et un jeton de 32 octets
//   bienvenue  { identifiantPc, nomPc }                 PC vers téléphone, réponse à un `bonjour` au jeton connu
//   refus      { raison }                               PC vers téléphone, puis le PC ferme la liaison ;
//                                                       raison : code, fenetre, nonce, jeton ou version
// Commandes, PC vers téléphone, chacune avec un `id` (entier de 0 à 2 147 483 647) que la réponse reprend :
//   lister     { id }                                   fichiers du dossier mémoire : racine et `sessions/` ; avec la
//                                                       capacité « ecriture », aussi `itineraires/`, `reglages/` et
//                                                       `journaux/` (`DOSSIERS_LISTES`). Réponse : `liste`
//   lire       { id, chemin, debut, longueur }          octets [debut, debut + longueur) d'un fichier listé par
//                                                       `lister` (`cheminAdmis`) ou par `listerTout`
//                                                       (`cheminBrutAdmis`) ; 1 ≤ longueur ≤ 1 048 576. Réponse : `bloc`
//   ping       { id }                                   la liaison vit-elle encore. Réponse : `pong`
// Commandes de la capacité « ecriture », seulement vers un téléphone qui l'a annoncée :
//   listerTout { id }                                   tout le dossier mémoire, à toute profondeur, sous les noms
//                                                       réels (provisoires et corbeille compris), en lecture seule,
//                                                       pour la copie de sécurité. Réponse : `listeTout`
//   ecrire     { id, chemin, debut, taille } + corps    un bloc du fichier `chemin` (`cheminEcrivable` : fichier posé
//                                                       dans `sessions/`, `itineraires/` ou `reglages/`, ou
//                                                       `tracker.json`, `fc-repos.json`), de `taille` octets en tout,
//                                                       aux octets [debut, debut + M) ; seule commande à corps ;
//                                                       debut + M ≤ taille ; M ≥ 1, sauf pour un fichier vide
//                                                       (taille 0 : un seul `ecrire`, debut 0, corps vide). Blocs dans
//                                                       l'ordre : le premier (debut 0) ouvre le fichier provisoire,
//                                                       chacun commence où le précédent finit. Réponse : `fait`
//   valider    { id, chemin, taille }                   fin de l'écriture : le téléphone relit la taille du provisoire,
//                                                       qui doit valoir `taille`, puis le met à la place de `chemin`.
//                                                       Réponse : `ecrit`
//   deplacer   { id, chemin, taille, dateMs, vers }     déplace le fichier `chemin` (`cheminRetirable` : posé dans
//                                                       `sessions/` ou `itineraires/`) vers `vers`, dans la corbeille
//                                                       du téléphone (`destinationCorbeilleAdmise` :
//                                                       `corbeille/<sous-dossier>/<même nom>`). Refusé (`erreur`) si
//                                                       sa taille ou sa date ne sont plus `taille` et `dateMs`, si
//                                                       `vers` est déjà pris, ou pendant un enregistrement ; sans effet
//                                                       si `chemin` n'existe plus. Réponse : `fait`
//   listerCorbeille { id }                              noms des sous-dossiers de `corbeille/`, pour en choisir un
//                                                       libre ; aucun si elle n'existe pas. Réponse : `listeCorbeille`
// Règles du téléphone pour l'écriture : une seule écriture à la fois par liaison ; le provisoire est
// `chemin.tracker-new` si `chemin` n'existe pas, `chemin.tracker-tmp` s'il existe, jamais montré dans `liste` ; un
// `ecrire` de debut 0 abandonne l'écriture non validée en cours (provisoire effacé) ; un bloc hors d'ordre, un `chemin`
// ou une `taille` qui changent en route, un `valider` sans écriture en cours ou de taille fausse répondent `erreur` et
// effacent le provisoire, l'original intact ; la liaison coupée efface le provisoire. Un téléphone qui enregistre une
// session (ou tient un autre service de premier plan) répond `erreur` de code PERMISSION à `ecrire` et à `deplacer`.
// Réponses, téléphone vers PC :
//   liste      { id, fichiers: [{ chemin, taille, dateMs }] }   un fichier de la racine ou d'un des
//                                                       `DOSSIERS_LISTES` (règles de `cheminAdmis`) ; les autres sont
//                                                       écartés
//   listeTout  { id, fichiers: [{ chemin, taille, dateMs, ordinaire }] }   réponse à `listerTout` : chaque élément
//                                                       du dossier, chemin réel tel quel ; `ordinaire` faux pour ce qui
//                                                       n'est pas un fichier ordinaire. Rien n'est écarté : un champ
//                                                       mal formé rend le message invalide
//   listeCorbeille { id, dossiers: [texte] }            réponse à `listerCorbeille` : noms des sous-dossiers
//   bloc       { id, debut, longueur } + corps          les octets lus ; `longueur` égale la taille du corps, plus
//                                                       courte que demandée seulement à la fin du fichier
//   pong       { id, enregistre? }                      enregistre, booléen facultatif : vrai quand le téléphone
//                                                       enregistre une session (il refuse alors d'écrire)
//   ecrit      { id, chemin, taille, dateMs }           réponse à `valider` : le fichier tel qu'il est désormais sur le
//                                                       téléphone (`dateMs` entier positif ou nul)
//   fait       { id }                                   réponse à `ecrire` et à `deplacer`
//   erreur     { id, code, message }                    code : NOT_FOUND, PERMISSION, NO_SPACE ou UNKNOWN ;
//                                                       message : phrase en clair, 500 caractères au plus ; réponse
//                                                       possible à toute commande

import { ErreurDisque } from './disque'
import type { CodeErreur } from './disque'
import type { FichierBrut, FichierTelephone } from './telephone'
import { TAILLE_CONFIRMATION, TAILLE_PART } from './spake2'
import { LONGUEUR_MAX_BRUT, cheminAdmis, cheminBrutAdmis, cheminEcrivable, cheminRetirable, destinationCorbeilleAdmise, fichiersAdmis } from './telephone'

/**
 * Version du protocole, portée par `appairer` et `bonjour`. Elle reste à 1 : un PC refuse toute autre version, si
 * bien que la changer couperait un téléphone à jour d'un programme ancien, et inversement ; ce qui s'ajoute passe par
 * `capacites`.
 */
export const PROTOCOLE_SANS_FIL = 1

/**
 * Capacité d'un téléphone qui liste aussi `itineraires/`, `reglages/` et `journaux/`, et reçoit `listerTout`,
 * `ecrire`, `valider`, `deplacer` et `listerCorbeille`.
 */
export const CAPACITE_ECRITURE = 'ecriture'

/**
 * Capacité d'un téléphone qui s'appaire par l'échange SPAKE2. Annoncée dans `appairer`, jamais lue par le PC : c'est
 * le champ `partA` qui fait l'échange, et un `appairer` sans lui est refusé.
 */
export const CAPACITE_SPAKE2 = 'spake2'

/** Capacités lues par le PC, dans l'ordre où `lireMessage` les rend. */
export const CAPACITES = [CAPACITE_ECRITURE] as const

/** Capacités qu'un message peut porter ; à la lecture, seules restent celles de `CAPACITES`. */
export type Capacite = (typeof CAPACITES)[number] | typeof CAPACITE_SPAKE2

/**
 * Port TCP où le PC écoute d'abord (puis les 9 suivants s'il est pris). Différent de celui de Gtracker (48217) : les
 * deux programmes cohabitent sur un même PC sans écouter au même endroit.
 */
export const PORT_SANS_FIL = 48247

/** Taille d'un bloc de lecture ou d'écriture : une commande `lire` ne demande jamais plus, un `ecrire` n'en porte jamais plus. */
export const TAILLE_BLOC = 1_048_576

/** Taille des deux longueurs qui ouvrent chaque trame. */
export const TAILLE_PREFIXE = 8

/**
 * Taille d'un nonce, du jeton, d'une empreinte de certificat et d'une preuve, en octets. Tenues ici, où les messages
 * les lisent, et reprises par `appairage.ts`, qui importe déjà ce module.
 */
export const TAILLE_NONCE = 32
export const TAILLE_JETON = 32
export const TAILLE_EMPREINTE = 32
export const TAILLE_PREUVE = TAILLE_CONFIRMATION

/** Taille d'une part SPAKE2 (`partA`, `partB`), en octets. */
export const TAILLE_PART_SPAKE2 = TAILLE_PART

/** Taille de l'identifiant d'un PC ou d'un téléphone appairé, en octets. */
export const TAILLE_IDENTIFIANT = 16

/** Plus grand identifiant de commande, celui d'un entier signé sur 32 bits (le `int` du téléphone). */
export const ID_MAX = 2_147_483_647

/** Plus long nom d'appareil admis, en caractères. */
export const NOM_MAX = 100

/** Plus long message d'erreur gardé, en caractères ; au-delà, il est coupé. */
export const MESSAGE_MAX = 500

/** Tailles admises d'une trame, en octets. */
export type Limites = { enTete: number; corps: number }

/** Limites d'une liaison où le téléphone s'est présenté. */
export const LIMITES: Readonly<Limites> = Object.freeze({ enTete: 8_388_608, corps: TAILLE_BLOC })

/** Limites avant que le téléphone se soit présenté : un inconnu ne fait pas réserver plus que ces quelques octets. */
export const LIMITES_ACCUEIL: Readonly<Limites> = Object.freeze({ enTete: 16_384, corps: 0 })

/** Raisons d'un refus du PC. */
export const RAISONS_REFUS = ['code', 'fenetre', 'nonce', 'jeton', 'version'] as const
export type RaisonRefus = (typeof RAISONS_REFUS)[number]

const CODES_ERREUR = ['NOT_FOUND', 'PERMISSION', 'NO_SPACE', 'UNKNOWN'] as const satisfies readonly CodeErreur[]

/** Ce qui ne va pas dans le flux ou dans un message. */
export type RaisonTrame =
  /** Longueur d'en-tête nulle. */
  | 'EN_TETE_VIDE'
  /** En-tête plus long que la limite. */
  | 'EN_TETE_TROP_LONG'
  /** Corps plus long que la limite. */
  | 'CORPS_TROP_LONG'
  /** En-tête qui n'est pas de l'UTF-8 valide, pas un objet JSON, ou sans `type` texte. */
  | 'EN_TETE_ILLISIBLE'
  /** Flux arrêté au milieu d'une trame. */
  | 'TRONQUEE'
  /** `type` inconnu de ce protocole. */
  | 'MESSAGE_INCONNU'
  /** `type` connu mais champs manquants, mal typés ou hors bornes. */
  | 'MESSAGE_INVALIDE'

/** Erreur de la liaison sans fil ; un `ErreurDisque` de code `UNKNOWN`, pour passer telle quelle par le pont. */
export class ErreurTrame extends ErreurDisque {
  raison: RaisonTrame
  constructor(raison: RaisonTrame, message: string) {
    super('UNKNOWN', message)
    this.name = 'ErreurTrame'
    this.raison = raison
  }
}

/** En-tête d'une trame : un objet JSON qui porte au moins `type`. */
export type EnTete = { type: string } & Record<string, unknown>

/** Une trame reçue en entier. */
export type Trame = { enTete: EnTete; corps: Uint8Array }

// ---------- encodage et décodage des trames ----------

function verifierTailles(n: number, m: number, limites: Limites): void {
  if (n === 0) throw new ErreurTrame('EN_TETE_VIDE', 'Trame sans en-tête.')
  if (n > limites.enTete) throw new ErreurTrame('EN_TETE_TROP_LONG', `En-tête de ${n} octets, plus que les ${limites.enTete} admis.`)
  if (m > limites.corps) throw new ErreurTrame('CORPS_TROP_LONG', `Corps de ${m} octets, plus que les ${limites.corps} admis.`)
}

/** Octets d'une trame. Lève `ErreurTrame` si elle dépasse les limites. */
export function encoderTrame(enTete: EnTete, corps: Uint8Array = new Uint8Array(0), limites: Limites = LIMITES): Uint8Array {
  const texte = Buffer.from(JSON.stringify(enTete), 'utf8')
  verifierTailles(texte.length, corps.length, limites)
  const sortie = Buffer.alloc(TAILLE_PREFIXE + texte.length + corps.length)
  sortie.writeUInt32BE(texte.length, 0)
  sortie.writeUInt32BE(corps.length, 4)
  texte.copy(sortie, TAILLE_PREFIXE)
  sortie.set(corps, TAILLE_PREFIXE + texte.length)
  return sortie
}

/** UTF-8 strict qui garde une marque d'ordre d'octets en tête : le JSON la refuse alors, comme le format le veut. */
const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

function lireEnTete(octets: Uint8Array): EnTete {
  let valeur: unknown
  try {
    valeur = JSON.parse(UTF8_STRICT.decode(octets))
  } catch {
    throw new ErreurTrame('EN_TETE_ILLISIBLE', "En-tête illisible : ni de l'UTF-8 valide ni du JSON.")
  }
  if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) throw new ErreurTrame('EN_TETE_ILLISIBLE', "L'en-tête n'est pas un objet JSON.")
  const type = (valeur as Record<string, unknown>).type
  if (typeof type !== 'string' || type === '') throw new ErreurTrame('EN_TETE_ILLISIBLE', "L'en-tête n'a pas de champ « type ».")
  return valeur as EnTete
}

/**
 * Découpe un flux d'octets en trames, quels que soient les morceaux reçus (une trame en plusieurs morceaux, plusieurs
 * trames dans un seul). Après une erreur, le décodeur est hors d'usage : chaque appel relève la même erreur.
 */
export class DecodeurTrames {
  /** Limites appliquées aux trames dont les longueurs ne sont pas encore lues ; se resserre ou s'élargit en route. */
  limites: Limites
  private morceaux: Buffer[] = []
  private recus = 0
  private attendu: { n: number; m: number } | null = null
  private erreur: ErreurTrame | null = null

  /**
   * Par défaut, les limites de l'accueil : un inconnu ne fait rien réserver de plus que quelques octets. Les limites
   * larges (`LIMITES`) se posent explicitement, une fois le téléphone reconnu.
   */
  constructor(limites: Limites = LIMITES_ACCUEIL) {
    this.limites = limites
  }

  /** Octets reçus et pas encore rendus en trame. */
  get enAttente(): number {
    return this.recus + (this.attendu ? TAILLE_PREFIXE : 0)
  }

  /** Ajoute un morceau du flux et rend les trames qu'il complète, dans l'ordre. Lève `ErreurTrame`. */
  pousser(morceau: Uint8Array): Trame[] {
    if (this.erreur) throw this.erreur
    if (morceau.length > 0) {
      this.morceaux.push(Buffer.from(morceau))
      this.recus += morceau.length
    }
    const trames: Trame[] = []
    for (;;) {
      if (!this.attendu) {
        if (this.recus < TAILLE_PREFIXE) break
        const prefixe = this.prendre(TAILLE_PREFIXE)
        const n = prefixe.readUInt32BE(0)
        const m = prefixe.readUInt32BE(4)
        try {
          verifierTailles(n, m, this.limites)
        } catch (e) {
          throw this.echouer(e as ErreurTrame)
        }
        this.attendu = { n, m }
      }
      const { n, m } = this.attendu
      if (this.recus < n + m) break
      const octets = this.prendre(n + m)
      this.attendu = null
      try {
        trames.push({ enTete: lireEnTete(octets.subarray(0, n)), corps: octets.subarray(n) })
      } catch (e) {
        throw this.echouer(e as ErreurTrame)
      }
    }
    return trames
  }

  /** Fin du flux : lève `TRONQUEE` si une trame était commencée. */
  fin(): void {
    if (this.erreur) throw this.erreur
    if (this.enAttente > 0) throw this.echouer(new ErreurTrame('TRONQUEE', `Liaison coupée au milieu d'une trame (${this.enAttente} octets en attente).`))
  }

  private echouer(erreur: ErreurTrame): ErreurTrame {
    this.erreur = erreur
    this.morceaux = []
    this.recus = 0
    this.attendu = null
    return erreur
  }

  /** Retire `taille` octets du début du flux reçu, dans un tampon neuf (jamais une vue sur un morceau reçu). */
  private prendre(taille: number): Buffer {
    const sortie = Buffer.alloc(taille)
    let place = 0
    while (place < taille) {
      const premier = this.morceaux[0]
      const pris = Math.min(premier.length, taille - place)
      premier.copy(sortie, place, 0, pris)
      place += pris
      if (pris === premier.length) this.morceaux.shift()
      else this.morceaux[0] = premier.subarray(pris)
    }
    this.recus -= taille
    return sortie
  }
}

// ---------- messages ----------

/**
 * Demande d'appairage du téléphone ; `partA`, sa part SPAKE2, sans laquelle le PC refuse ; `capacites`, absent d'un
 * téléphone qui ne sait que lire, ne garde à la lecture que les capacités connues, sans doublon, dans l'ordre de
 * `CAPACITES`.
 */
export type MessageAppairer = { type: 'appairer'; version: number; nom: string; nonceTelephone: string; partA?: string; capacites?: Capacite[] }
/** Téléphone déjà appairé qui présente son jeton ; `capacites` comme pour `appairer`. */
export type MessageBonjour = { type: 'bonjour'; version: number; nom: string; jeton: string; capacites?: Capacite[] }
/** Réponse du PC à `appairer` ; `partB`, sa part SPAKE2, toujours envoyée. */
export type MessageDefi = { type: 'defi'; noncePc: string; partB?: string }
export type MessagePreuve = { type: 'preuve'; preuve: string }
export type MessageAppaire = { type: 'appaire'; preuve: string; jeton: string; identifiantPc: string; nomPc: string }
export type MessageBienvenue = { type: 'bienvenue'; identifiantPc: string; nomPc: string }
export type MessageRefus = { type: 'refus'; raison: RaisonRefus }

export type CommandeLister = { type: 'lister'; id: number }
export type CommandeLire = { type: 'lire'; id: number; chemin: string; debut: number; longueur: number }
export type CommandePing = { type: 'ping'; id: number }
/** Tout le dossier mémoire, à toute profondeur, sous les noms réels : lecture seule, pour la copie de sécurité. */
export type CommandeListerTout = { type: 'listerTout'; id: number }
/** Un bloc d'un fichier à écrire, de `taille` octets en tout ; `octets` est le corps de la trame. */
export type CommandeEcrire = { type: 'ecrire'; id: number; chemin: string; debut: number; taille: number; octets: Uint8Array }
/** Fin d'une écriture : le provisoire, de `taille` octets, prend la place de `chemin`. */
export type CommandeValider = { type: 'valider'; id: number; chemin: string; taille: number }
/** Déplacement de `chemin`, tel que listé (`taille`, `dateMs`), vers `vers` dans la corbeille du téléphone. */
export type CommandeDeplacer = { type: 'deplacer'; id: number; chemin: string; taille: number; dateMs: number; vers: string }
/** Noms des sous-dossiers de la corbeille du téléphone. */
export type CommandeListerCorbeille = { type: 'listerCorbeille'; id: number }
/** Commandes de la capacité « ecriture », envoyées seulement à un téléphone qui a annoncé `CAPACITE_ECRITURE`. */
export type CommandeEcriture = CommandeListerTout | CommandeEcrire | CommandeValider | CommandeDeplacer | CommandeListerCorbeille
/** Commandes du PC. */
export type Commande = CommandeLister | CommandeLire | CommandePing | CommandeEcriture

export type ReponseListe = { type: 'liste'; id: number; fichiers: FichierTelephone[] }
/** Réponse à `listerTout` : chaque élément du dossier, chemin réel tel quel, trié par chemin. */
export type ReponseListeTout = { type: 'listeTout'; id: number; fichiers: FichierBrut[] }
/** Réponse à `listerCorbeille` : noms des sous-dossiers de la corbeille, triés, sans doublon. */
export type ReponseListeCorbeille = { type: 'listeCorbeille'; id: number; dossiers: string[] }
/** Octets lus ; `longueur` de l'en-tête est la taille de `octets`, posée à l'encodage. */
export type ReponseBloc = { type: 'bloc'; id: number; debut: number; octets: Uint8Array }
/** `enregistre`, absent d'un téléphone qui ne le dit pas : vrai quand il enregistre une session et refuse d'écrire. */
export type ReponsePong = { type: 'pong'; id: number; enregistre?: boolean }
/** Réponse à `valider` : le fichier tel qu'il est désormais sur le téléphone. */
export type ReponseEcrit = { type: 'ecrit'; id: number } & FichierTelephone
/** Réponse à `ecrire` et à `deplacer`. */
export type ReponseFait = { type: 'fait'; id: number }
export type ReponseErreur = { type: 'erreur'; id: number; code: CodeErreur; message: string }
/** Réponses du téléphone. */
export type ReponseTelephone = ReponseListe | ReponseListeTout | ReponseListeCorbeille | ReponseBloc | ReponsePong | ReponseEcrit | ReponseFait | ReponseErreur

/** Messages de l'accueil et de l'appairage. */
export type MessageAccueil = MessageAppairer | MessageBonjour | MessageDefi | MessagePreuve | MessageAppaire | MessageBienvenue | MessageRefus

/** Tout message de la liaison. */
export type Message = MessageAccueil | Commande | ReponseTelephone

/** Octets d'un message. Lève `ErreurTrame` s'il dépasse les limites. */
export function encoderMessage(message: Message, limites: Limites = LIMITES): Uint8Array {
  if (message.type === 'bloc') {
    const { octets, ...reste } = message
    return encoderTrame({ ...reste, longueur: octets.length }, octets, limites)
  }
  if (message.type === 'ecrire') {
    const { octets, ...reste } = message
    return encoderTrame(reste, octets, limites)
  }
  return encoderTrame(message, undefined, limites)
}

/** Les capacités annoncées par le téléphone, vides s'il n'en annonce aucune. */
export function capacitesDe(m: MessageAppairer | MessageBonjour): readonly Capacite[] {
  return m.capacites ?? []
}

/** Vrai pour un nom d'appareil : 1 à `NOM_MAX` caractères, sans caractère de contrôle (C0, effacement, C1). */
export function nomAdmis(nom: string): boolean {
  if (nom.length === 0 || nom.length > NOM_MAX) return false
  for (let i = 0; i < nom.length; i++) {
    const c = nom.charCodeAt(i)
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return false
  }
  return true
}

/** Vrai pour un chemin qu'une commande `lire` peut demander : listable (`cheminAdmis`) ou réel (`cheminBrutAdmis`). */
export function cheminLisible(chemin: unknown): chemin is string {
  return typeof chemin === 'string' && (cheminAdmis(chemin) || cheminBrutAdmis(chemin))
}

function invalide(type: string, champ: string): ErreurTrame {
  return new ErreurTrame('MESSAGE_INVALIDE', `Message « ${type} » mal formé : champ « ${champ} ».`)
}

/** Lecture des champs d'un en-tête, chacune levant `MESSAGE_INVALIDE` sur un champ manquant ou hors bornes. */
function lecteur(enTete: EnTete) {
  const type = enTete.type
  const entier = (champ: string, min: number, max: number): number => {
    const v = enTete[champ]
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) throw invalide(type, champ)
    return v
  }
  const hex = (champ: string, octets: number): string => {
    const v = enTete[champ]
    if (typeof v !== 'string' || v.length !== octets * 2 || !/^[0-9a-f]*$/.test(v)) throw invalide(type, champ)
    return v
  }
  /** Un champ d'octets facultatif : rien s'il est absent, mais mal formé, il rend le message invalide. */
  const hexFacultatif = <C extends string>(champ: C, octets: number): { [K in C]?: string } =>
    enTete[champ] === undefined ? {} : ({ [champ]: hex(champ, octets) } as { [K in C]?: string })
  const nom = (champ: string): string => {
    const v = enTete[champ]
    if (typeof v !== 'string' || !nomAdmis(v)) throw invalide(type, champ)
    return v
  }
  const chemin = (admis: (chemin: string) => boolean): string => {
    const v = enTete.chemin
    if (typeof v !== 'string' || !admis(v)) throw invalide(type, 'chemin')
    return v
  }
  /** Les capacités connues, sans doublon, dans l'ordre de `CAPACITES` ; rien si le champ est absent. */
  const capacites = (): { capacites?: Capacite[] } => {
    const v = enTete.capacites
    if (v === undefined) return {}
    if (!Array.isArray(v) || v.some((c) => typeof c !== 'string')) throw invalide(type, 'capacites')
    return { capacites: CAPACITES.filter((c) => v.includes(c)) }
  }
  return {
    id: () => entier('id', 0, ID_MAX),
    version: () => entier('version', 0, ID_MAX),
    position: (champ: string) => entier(champ, 0, Number.MAX_SAFE_INTEGER),
    entier,
    hex,
    hexFacultatif,
    nom,
    chemin,
    capacites,
  }
}

/** Les champs d'un fichier de `liste`, sans encore juger son chemin ; `null` si un champ est mal typé. */
function fichierBrut(v: unknown): FichierTelephone | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const { chemin, taille, dateMs } = v as Record<string, unknown>
  if (typeof chemin !== 'string' || typeof taille !== 'number' || typeof dateMs !== 'number') return null
  return { chemin, taille, dateMs }
}

/**
 * Un élément de `listeTout`, `null` s'il est mal formé : chemin texte de 1 à `LONGUEUR_MAX_BRUT` caractères (tel
 * quel : la copie de sécurité refuse elle-même un nom qu'elle ne sait pas recopier), taille entière positive ou
 * nulle, date entière positive ou nulle, `ordinaire` booléen.
 */
function elementBrut(v: unknown): FichierBrut | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const { chemin, taille, dateMs, ordinaire } = v as Record<string, unknown>
  if (typeof chemin !== 'string' || chemin.length === 0 || chemin.length > LONGUEUR_MAX_BRUT) return null
  if (typeof taille !== 'number' || !Number.isSafeInteger(taille) || taille < 0) return null
  if (typeof dateMs !== 'number' || !Number.isSafeInteger(dateMs) || dateMs < 0) return null
  if (typeof ordinaire !== 'boolean') return null
  return { chemin, taille, dateMs, ordinaire }
}

const parChemin = (a: { chemin: string }, b: { chemin: string }) => (a.chemin < b.chemin ? -1 : a.chemin > b.chemin ? 1 : 0)

/**
 * Le message porté par une trame, champs vérifiés. Lève `MESSAGE_INCONNU` sur un `type` inconnu (dont `effacer`, qui
 * n'existe pas dans ce protocole), `MESSAGE_INVALIDE` sur un champ manquant, mal typé ou hors bornes. Dans une
 * `liste`, les fichiers dont le chemin (`cheminAdmis`), la taille ou la date ne sont pas admis sont écartés, comme
 * ceux du câble (`fichiersAdmis`) ; la liste rendue est triée par chemin. `lire` ne porte qu'un chemin de
 * `cheminLisible`, `ecrire`, `valider` et `ecrit` qu'un chemin de `cheminEcrivable`, `deplacer` qu'un chemin de
 * `cheminRetirable` vers une destination de `destinationCorbeilleAdmise`.
 */
export function lireMessage(trame: Trame): Message {
  const { enTete, corps } = trame
  const l = lecteur(enTete)
  const type = enTete.type
  if (type !== 'bloc' && type !== 'ecrire' && corps.length > 0) throw invalide(type, 'corps')
  switch (type) {
    case 'appairer':
      return {
        type,
        version: l.version(),
        nom: l.nom('nom'),
        nonceTelephone: l.hex('nonceTelephone', TAILLE_NONCE),
        ...l.hexFacultatif('partA', TAILLE_PART_SPAKE2),
        ...l.capacites(),
      }
    case 'bonjour':
      return { type, version: l.version(), nom: l.nom('nom'), jeton: l.hex('jeton', TAILLE_JETON), ...l.capacites() }
    case 'defi':
      return { type, noncePc: l.hex('noncePc', TAILLE_NONCE), ...l.hexFacultatif('partB', TAILLE_PART_SPAKE2) }
    case 'preuve':
      return { type, preuve: l.hex('preuve', TAILLE_PREUVE) }
    case 'appaire':
      return {
        type,
        preuve: l.hex('preuve', TAILLE_PREUVE),
        jeton: l.hex('jeton', TAILLE_JETON),
        identifiantPc: l.hex('identifiantPc', TAILLE_IDENTIFIANT),
        nomPc: l.nom('nomPc'),
      }
    case 'bienvenue':
      return { type, identifiantPc: l.hex('identifiantPc', TAILLE_IDENTIFIANT), nomPc: l.nom('nomPc') }
    case 'refus': {
      const raison = enTete.raison
      if (!(RAISONS_REFUS as readonly unknown[]).includes(raison)) throw invalide(type, 'raison')
      return { type, raison: raison as RaisonRefus }
    }
    case 'lister':
    case 'ping':
    case 'listerTout':
    case 'listerCorbeille':
      return { type, id: l.id() }
    case 'lire':
      return { type, id: l.id(), chemin: l.chemin(cheminLisible), debut: l.position('debut'), longueur: l.entier('longueur', 1, TAILLE_BLOC) }
    case 'ecrire': {
      const id = l.id()
      const chemin = l.chemin(cheminEcrivable)
      const debut = l.position('debut')
      const taille = l.position('taille')
      // Un corps vide n'est admis que pour un fichier vide ; aucun bloc ne déborde la taille annoncée.
      if ((corps.length === 0 && taille !== 0) || debut + corps.length > taille) throw invalide(type, 'corps')
      return { type, id, chemin, debut, taille, octets: corps }
    }
    case 'valider':
      return { type, id: l.id(), chemin: l.chemin(cheminEcrivable), taille: l.position('taille') }
    case 'deplacer': {
      const id = l.id()
      const chemin = l.chemin(cheminRetirable)
      const taille = l.position('taille')
      const dateMs = l.position('dateMs')
      const vers = enTete.vers
      if (typeof vers !== 'string' || !destinationCorbeilleAdmise(chemin, vers)) throw invalide(type, 'vers')
      return { type, id, chemin, taille, dateMs, vers }
    }
    case 'liste': {
      const fichiers = enTete.fichiers
      if (!Array.isArray(fichiers)) throw invalide(type, 'fichiers')
      const bruts = fichiers.map(fichierBrut)
      if (bruts.some((f) => f === null)) throw invalide(type, 'fichiers')
      return { type, id: l.id(), fichiers: fichiersAdmis(bruts as FichierTelephone[]) }
    }
    case 'listeTout': {
      const fichiers = enTete.fichiers
      if (!Array.isArray(fichiers)) throw invalide(type, 'fichiers')
      const elements = fichiers.map(elementBrut)
      if (elements.some((f) => f === null)) throw invalide(type, 'fichiers')
      return { type, id: l.id(), fichiers: (elements as FichierBrut[]).sort(parChemin) }
    }
    case 'listeCorbeille': {
      const dossiers = enTete.dossiers
      if (!Array.isArray(dossiers) || dossiers.some((d) => typeof d !== 'string' || d === '')) throw invalide(type, 'dossiers')
      return { type, id: l.id(), dossiers: [...new Set(dossiers as string[])].sort() }
    }
    case 'ecrit':
      return { type, id: l.id(), chemin: l.chemin(cheminEcrivable), taille: l.position('taille'), dateMs: l.position('dateMs') }
    case 'fait':
      return { type, id: l.id() }
    case 'bloc': {
      const id = l.id()
      const debut = l.position('debut')
      if (l.entier('longueur', 0, TAILLE_BLOC) !== corps.length) throw invalide(type, 'longueur')
      return { type, id, debut, octets: corps }
    }
    case 'pong': {
      const id = l.id()
      const enregistre = enTete.enregistre
      if (enregistre !== undefined && typeof enregistre !== 'boolean') throw invalide(type, 'enregistre')
      return enregistre === undefined ? { type, id } : { type, id, enregistre }
    }
    case 'erreur': {
      const code = (CODES_ERREUR as readonly unknown[]).includes(enTete.code) ? (enTete.code as CodeErreur) : 'UNKNOWN'
      const message = typeof enTete.message === 'string' ? enTete.message.slice(0, MESSAGE_MAX) : ''
      return { type, id: l.id(), code, message }
    }
    default:
      throw new ErreurTrame('MESSAGE_INCONNU', `Message inconnu : « ${type.slice(0, 40)} ».`)
  }
}

/**
 * Les commandes `lire` d'un fichier entier, sans `id`, produites une à une au fil de la lecture (jamais toutes d'avance) :
 * blocs de `TAILLE_BLOC` octets, le dernier plus court ; aucun pour un fichier vide.
 */
export function* blocsDeLecture(taille: number): Generator<{ debut: number; longueur: number }> {
  for (let debut = 0; debut < taille; debut += TAILLE_BLOC) yield { debut, longueur: Math.min(TAILLE_BLOC, taille - debut) }
}

/**
 * Les blocs des commandes `ecrire` d'un fichier entier, produits un à un : ceux de `blocsDeLecture`, sauf pour un
 * fichier vide, qui s'écrit par un seul bloc vide (le téléphone ouvre le provisoire au bloc de début 0).
 */
export function* blocsDEcriture(taille: number): Generator<{ debut: number; longueur: number }> {
  if (taille === 0) yield { debut: 0, longueur: 0 }
  else yield* blocsDeLecture(taille)
}
