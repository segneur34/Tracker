// Le dossier mémoire du programme Windows, tenu par le processus principal : le dossier retenu, le dossier proposé ou
// choisi (le « candidat »), et les gestionnaires des canaux `memoire:*`. Sans Electron à l'exécution : la fenêtre de
// choix de Windows est passée en paramètre (`choisirDossier`), si bien que tout se teste sur des dossiers temporaires.
//
// Sécurité :
// - la page ne donne jamais de chemin absolu : elle désigne une racine (`memoire` ou `candidat`) et un chemin relatif,
//   contrôlé par `disque.ts` ; le dossier retenu et le candidat ne viennent que d'ici (proposition, fenêtre de Windows) ;
// - le candidat est en lecture seule : la page y applique ses règles (sous-dossier d'une mémoire, descente dans
//   `Tracker`) avant de l'adopter ;
// - rien n'est créé sur le disque avant `adopter`, et un dossier retenu introuvable n'est jamais recréé.
//
// Le dossier retenu est gardé dans `coquille.json`, dans le dossier du profil (hors du dossier mémoire), écrit sans
// jamais être laissé à moitié ; un fichier abîmé vaut « aucun dossier retenu ».
//
// Mode d'essai (`TRACKER_BANC=1`) seulement, `optionsDepuisEnvironnement` lit :
//   TRACKER_MEMOIRE        dossier retenu d'avance, tant que `coquille.json` n'en retient aucun
//   TRACKER_DOCUMENTS      remplace Documents (sinon un dossier du profil d'essai : jamais le vrai Documents)
//   TRACKER_BANC_DOSSIER   réponse de la fenêtre de choix (absente ou vide : l'utilisateur renonce)

import { mkdir, readFile, readdir, rename, stat } from 'node:fs/promises'
import path from 'node:path'
import type { CodeErreur, DossierDisque, DossierPropose, Entree, Etat } from './disque'
import {
  ErreurDisque,
  NOM_MEMOIRE,
  avecEssais,
  codeDe,
  dossierDisque,
  dossierPropose,
  ecrireAtomique,
  erreurDisque,
  estDansOneDrive,
  estTemporaire,
} from './disque'
import type { Gestionnaire, Reponse } from './pont'
import { enReponse, uneALaFois } from './pont'

/** Fichier du profil qui retient le dossier mémoire. */
export const FICHIER_COQUILLE = 'coquille.json'

/** Titre de la fenêtre de choix tant que la page n'en passe pas. */
const TITRE_CHOIX = 'Dossier mémoire de Tracker'

export type Racine = 'memoire' | 'candidat'

export type OuvertureMemoire =
  /** Aucun dossier retenu : premier lancement, ou dossier oublié. */
  | { etat: 'aucun' }
  /** Le dossier retenu s'ouvre. */
  | { etat: 'pret'; chemin: string; oneDrive: boolean }
  /** Le dossier retenu n'existe plus (renommé, déplacé, disque débranché) : il n'est pas recréé. */
  | { etat: 'introuvable'; chemin: string; oneDrive: boolean }
  /**
   * Le dossier retenu existe mais ne se lit pas, ou `coquille.json` lui-même ne se lit pas (tenu par un autre
   * programme, accès refusé) : `chemin` vaut alors `null`, le dossier retenu n'étant pas connu. `detail` dit pourquoi.
   * Ce n'est pas « aucun » : rien ne doit être proposé à neuf, sous peine de faire oublier le vrai dossier.
   */
  | { etat: 'illisible'; chemin: string | null; oneDrive: boolean; code: CodeErreur; detail: string }

export type Choix = {
  /** Chemin complet du dossier choisi. */
  chemin: string
  /** Son nom (le chemin entier pour la racine d'un disque). */
  nom: string
  /** Noms de ce qu'il contient, sans les temporaires des écritures. */
  noms: string[]
  oneDrive: boolean
}

export type Adoption = { chemin: string; oneDrive: boolean }

export type OptionsMemoire = {
  /** Dossier du profil de la coquille, où vit `coquille.json`. */
  profil: string
  /** Documents de l'utilisateur. */
  documents: string
  /** Dossier de l'utilisateur, proposé à la place de Documents quand celui-ci est dans OneDrive. */
  maison: string
  /** Variables d'environnement, pour reconnaître OneDrive. */
  env: Record<string, string | undefined>
  /** Dossier retenu d'avance (mode d'essai), tant que `coquille.json` n'en retient aucun. */
  memoireEssai?: string | null
  /** Fenêtre de choix d'un dossier : chemin absolu choisi, `null` si l'utilisateur renonce. */
  choisirDossier: (demande: { titre: string; depart: string }) => Promise<string | null>
  /** Lecture d'un fichier du profil (`coquille.json`) ; `readFile` par défaut, remplacée par les tests. */
  lireFichier?: (fichier: string) => Promise<Buffer>
}

export interface Memoire {
  ouvrir(): Promise<Reponse<OuvertureMemoire>>
  proposer(): Promise<Reponse<DossierPropose>>
  choisir(argument: unknown): Promise<Reponse<Choix | null>>
  adopter(argument: unknown): Promise<Reponse<Adoption>>
  oublier(): Promise<Reponse<null>>
  lister(argument: unknown): Promise<Reponse<Entree[]>>
  lireTexte(argument: unknown): Promise<Reponse<string | null>>
  lireOctets(argument: unknown): Promise<Reponse<Uint8Array | null>>
  stat(argument: unknown): Promise<Reponse<Etat | null>>
  ecrireTexte(argument: unknown): Promise<Reponse<null>>
  ecrireOctets(argument: unknown): Promise<Reponse<null>>
  effacer(argument: unknown): Promise<Reponse<null>>
  /** Efface un sous-dossier vide (corbeille du programme Windows) ; refusé s'il contient encore quelque chose. */
  effacerDossier(argument: unknown): Promise<Reponse<null>>
}

/** Canaux servis, dans l'ordre de `Memoire` ; le pont de la page (`preload.ts`) porte les mêmes noms. */
export const CANAUX_MEMOIRE = [
  'ouvrir',
  'proposer',
  'choisir',
  'adopter',
  'oublier',
  'lister',
  'lireTexte',
  'lireOctets',
  'stat',
  'ecrireTexte',
  'ecrireOctets',
  'effacer',
  'effacerDossier',
] as const satisfies readonly (keyof Memoire)[]

// ---------- arguments ----------

const refus = (quoi: string) => new ErreurDisque('UNKNOWN', `Message mal formé : ${quoi}.`)

function objet(argument: unknown): Record<string, unknown> {
  if (typeof argument !== 'object' || argument === null || Array.isArray(argument)) throw refus('un objet est attendu')
  return argument as Record<string, unknown>
}

function texte(a: Record<string, unknown>, cle: string): string {
  const v = a[cle]
  if (typeof v !== 'string') throw refus(`« ${cle} » doit être un texte`)
  return v
}

/** Vrai pour un tableau d'octets (`Uint8Array` ou `Buffer`), quel que soit le contexte qui l'a créé. */
function estOctets(v: unknown): v is Uint8Array {
  return ArrayBuffer.isView(v) && Object.prototype.toString.call(v) === '[object Uint8Array]'
}

function racineDe(a: Record<string, unknown>): Racine {
  const r = a.racine
  if (r !== 'memoire' && r !== 'candidat') throw refus('« racine » vaut « memoire » ou « candidat »')
  return r
}

// ---------- coquille.json ----------

/** Erreurs passagères à la lecture de `coquille.json` : fichier tenu un instant, trop de fichiers ouverts. */
const PASSAGERES_COQUILLE: ReadonlySet<string> = new Set(['EPERM', 'EBUSY', 'EACCES', 'EMFILE', 'ENFILE'])

type LectureCoquille =
  /** Pas de fichier : rien de retenu. */
  | { etat: 'absent' }
  | { etat: 'lu'; contenu: Record<string, unknown> }
  /** Contenu qui n'est pas celui de la coquille (JSON invalide, `dossier` illisible) : rien de retenu. */
  | { etat: 'abime' }
  /** Le fichier ne se lit pas, même après quelques essais : on ne sait pas ce qui est retenu. */
  | { etat: 'illisible'; code: CodeErreur; detail: string }

/** Dossier retenu par `coquille.json`, s'il y en a un, lisible et absolu. */
function dossierDe(coquille: Record<string, unknown>): string | null {
  const d = coquille.dossier
  return typeof d === 'string' && path.isAbsolute(d) ? path.resolve(d) : null
}

async function lireCoquille(fichier: string, lire: (fichier: string) => Promise<Buffer>): Promise<LectureCoquille> {
  let brut: string
  try {
    brut = (await avecEssais(() => lire(fichier), undefined, PASSAGERES_COQUILLE)).toString('utf8')
  } catch (e) {
    const code = codeDe(e)
    if (code === 'NOT_FOUND') return { etat: 'absent' }
    return { etat: 'illisible', code, detail: code === 'PERMISSION' ? 'accès refusé' : e instanceof Error ? e.message : String(e) }
  }
  // Un éditeur de Windows peut l'avoir enregistré avec une marque d'ordre des octets.
  if (brut.charCodeAt(0) === 0xfeff) brut = brut.slice(1)
  let lu: unknown
  try {
    lu = JSON.parse(brut)
  } catch {
    return { etat: 'abime' }
  }
  if (typeof lu !== 'object' || lu === null || Array.isArray(lu)) return { etat: 'abime' }
  const contenu = lu as Record<string, unknown>
  if (contenu.dossier !== undefined && dossierDe(contenu) === null) return { etat: 'abime' }
  return { etat: 'lu', contenu }
}

/** Erreur d'un `coquille.json` qui ne se lit pas. */
const coquilleIllisible = (lu: { code: CodeErreur; detail: string }) =>
  new ErreurDisque(lu.code, `Le fichier ${FICHIER_COQUILLE} du profil ne se lit pas : ${lu.detail}`)

/**
 * Récrit `coquille.json` avec `dossier` (ou sans dossier retenu), autres clés gardées. Un fichier qui ne se lit pas
 * n'est jamais récrit (erreur) ; un fichier abîmé est d'abord mis de côté sous un autre nom, jamais écrasé.
 */
async function ecrireCoquille(profil: string, dossier: string | null, lire: (fichier: string) => Promise<Buffer>): Promise<void> {
  const fichier = path.join(profil, FICHIER_COQUILLE)
  const lu = await lireCoquille(fichier, lire)
  if (lu.etat === 'illisible') throw coquilleIllisible(lu)
  if (lu.etat === 'abime') await rename(fichier, path.join(profil, `coquille-abimee-${Date.now()}.json`))
  const coquille = lu.etat === 'lu' ? lu.contenu : {}
  if (dossier === null) delete coquille.dossier
  else coquille.dossier = dossier
  await mkdir(profil, { recursive: true })
  await ecrireAtomique(fichier, Buffer.from(`${JSON.stringify(coquille, null, 2)}\n`, 'utf8'))
}

// ---------- la mémoire ----------

export function creerMemoire(options: OptionsMemoire): Memoire {
  const { profil, env } = options
  const lire = options.lireFichier ?? ((fichier: string) => readFile(fichier))
  /** Dossier retenu : `undefined` tant que `coquille.json` n'a pas été lu. */
  let retenu: string | null | undefined
  /** Dossier proposé ou choisi, en lecture seule jusqu'à `adopter`. */
  let candidat: string | null = null
  /** Vrai après `oublier` : le dossier d'essai retenu d'avance ne revient pas. */
  let essaiOublie = false
  let dossierRetenu: DossierDisque | null = null

  /** Dossier retenu, `null` s'il n'y en a pas ; lève si `coquille.json` ne se lit pas (rien n'est alors supposé). */
  async function chargerRetenu(relire: boolean): Promise<string | null> {
    if (retenu === undefined || relire) {
      retenu = undefined
      const lu = await lireCoquille(path.join(profil, FICHIER_COQUILLE), lire)
      if (lu.etat === 'illisible') throw coquilleIllisible(lu)
      const d = lu.etat === 'lu' ? dossierDe(lu.contenu) : null
      retenu = d ?? (options.memoireEssai && !essaiOublie ? path.resolve(options.memoireEssai) : null)
    }
    return retenu
  }

  const choisirUneFois = uneALaFois((argument: unknown) =>
    enReponse(async (): Promise<Choix | null> => {
      const a = argument === undefined ? {} : objet(argument)
      const titre = typeof a.titre === 'string' && a.titre.trim() !== '' ? a.titre.slice(0, 200) : TITRE_CHOIX
      if (a.documents !== undefined && typeof a.documents !== 'boolean') throw refus('« documents » doit être vrai ou faux')
      const retenuConnu = a.documents === true ? null : await chargerRetenu(false).catch(() => null)
      const choisi = await options.choisirDossier({ titre, depart: retenuConnu ?? options.documents })
      // Renoncement : le candidat d'avant reste.
      if (choisi === null) return null
      if (!path.isAbsolute(choisi)) throw new ErreurDisque('UNKNOWN', 'Dossier choisi illisible.')
      const chemin = path.resolve(choisi)
      let noms: string[]
      try {
        noms = (await readdir(chemin)).filter((n) => !estTemporaire(n))
      } catch (e) {
        throw erreurDisque(e, 'Lecture du dossier choisi impossible')
      }
      candidat = chemin
      return { chemin, nom: path.basename(chemin) || chemin, noms, oneDrive: estDansOneDrive(chemin, env) }
    }),
  )

  async function dossier(racine: Racine): Promise<DossierDisque> {
    if (racine === 'candidat') {
      if (candidat === null) throw new ErreurDisque('NOT_FOUND', 'Aucun dossier proposé ni choisi.')
      return dossierDisque(candidat, { lectureSeule: true })
    }
    const chemin = await chargerRetenu(false)
    if (chemin === null) throw new ErreurDisque('NOT_FOUND', 'Aucun dossier mémoire retenu.')
    if (dossierRetenu?.racine !== chemin) dossierRetenu = dossierDisque(chemin)
    return dossierRetenu
  }

  /** La racine et le chemin d'un message de fichier. */
  async function cible(argument: unknown): Promise<{ d: DossierDisque; chemin: string; a: Record<string, unknown> }> {
    const a = objet(argument)
    const racine = racineDe(a)
    const chemin = texte(a, 'chemin')
    return { d: await dossier(racine), chemin, a }
  }

  return {
    ouvrir: () =>
      enReponse(async (): Promise<OuvertureMemoire> => {
        let chemin: string | null
        try {
          chemin = await chargerRetenu(true)
        } catch (e) {
          return { etat: 'illisible', chemin: null, oneDrive: false, code: codeDe(e), detail: e instanceof Error ? e.message : String(e) }
        }
        if (chemin === null) return { etat: 'aucun' }
        const oneDrive = estDansOneDrive(chemin, env)
        try {
          if (!(await stat(chemin)).isDirectory()) return { etat: 'introuvable', chemin, oneDrive }
          await readdir(chemin)
          return { etat: 'pret', chemin, oneDrive }
        } catch (e) {
          const code = codeDe(e)
          if (code === 'NOT_FOUND') return { etat: 'introuvable', chemin, oneDrive }
          return { etat: 'illisible', chemin, oneDrive, code, detail: code === 'PERMISSION' ? 'accès refusé' : e instanceof Error ? e.message : String(e) }
        }
      }),

    proposer: () =>
      enReponse(async () => {
        const propose = dossierPropose(options.documents, options.maison, env)
        candidat = propose.chemin
        return propose
      }),

    // Une seule fenêtre de choix à la fois : un appel pendant qu'elle est ouverte reçoit la même réponse.
    choisir: (argument) => choisirUneFois(argument),

    adopter: (argument) =>
      enReponse(async (): Promise<Adoption> => {
        const a = argument === undefined ? {} : objet(argument)
        if (a.descendre !== undefined && typeof a.descendre !== 'boolean') throw refus('« descendre » doit être vrai ou faux')
        if (candidat === null) throw new ErreurDisque('NOT_FOUND', 'Aucun dossier proposé ni choisi.')
        const chemin = a.descendre === true ? path.join(candidat, NOM_MEMOIRE) : candidat
        try {
          // Un seul niveau : le dossier proposé naît dans Documents ; un parent absent n'est pas recréé.
          await mkdir(chemin)
        } catch (e) {
          if ((e as { code?: unknown }).code !== 'EEXIST') throw erreurDisque(e, 'Création du dossier mémoire impossible')
        }
        try {
          if (!(await stat(chemin)).isDirectory()) throw new ErreurDisque('UNKNOWN', `Un fichier porte déjà le nom de ce dossier : ${chemin}`)
          await readdir(chemin)
          await ecrireCoquille(profil, chemin, lire)
        } catch (e) {
          throw erreurDisque(e, 'Dossier mémoire impossible à retenir')
        }
        retenu = chemin
        candidat = null
        return { chemin, oneDrive: estDansOneDrive(chemin, env) }
      }),

    oublier: () =>
      enReponse(async () => {
        await ecrireCoquille(profil, null, lire)
        retenu = null
        essaiOublie = true
        candidat = null
        dossierRetenu = null
        return null
      }),

    lister: (argument) =>
      enReponse(async () => {
        const { d, chemin } = await cible(argument)
        return d.lister(chemin)
      }),

    lireTexte: (argument) =>
      enReponse(async () => {
        const { d, chemin } = await cible(argument)
        return d.lireTexte(chemin)
      }),

    lireOctets: (argument) =>
      enReponse(async () => {
        const { d, chemin } = await cible(argument)
        return d.lireOctets(chemin)
      }),

    stat: (argument) =>
      enReponse(async () => {
        const { d, chemin } = await cible(argument)
        return d.stat(chemin)
      }),

    ecrireTexte: (argument) =>
      enReponse(async () => {
        const { d, chemin, a } = await cible(argument)
        await d.ecrireTexte(chemin, texte(a, 'texte'))
        return null
      }),

    ecrireOctets: (argument) =>
      enReponse(async () => {
        const { d, chemin, a } = await cible(argument)
        if (!estOctets(a.octets)) throw refus('« octets » doit être un Uint8Array')
        await d.ecrireOctets(chemin, a.octets)
        return null
      }),

    effacer: (argument) =>
      enReponse(async () => {
        const { d, chemin } = await cible(argument)
        await d.effacer(chemin)
        return null
      }),

    effacerDossier: (argument) =>
      enReponse(async () => {
        const { d, chemin } = await cible(argument)
        await d.effacerDossier(chemin)
        return null
      }),
  }
}

/** Gestionnaires des canaux `memoire:*`, à brancher par `brancherCanaux`. */
export function gestionnairesMemoire(memoire: Memoire): Record<string, Gestionnaire> {
  const gestionnaires: Record<string, Gestionnaire> = {}
  for (const nom of CANAUX_MEMOIRE) {
    const appel = memoire[nom] as (argument: unknown) => Promise<Reponse<unknown>>
    gestionnaires[`memoire:${nom}`] = (argument) => appel(argument)
  }
  return gestionnaires
}

/**
 * Options de la mémoire d'après l'environnement et les dossiers de Windows. Les variables d'essai ne sont lues qu'en
 * mode d'essai (`TRACKER_BANC=1`), où Documents n'est jamais le vrai : `TRACKER_DOCUMENTS`, sinon un dossier du profil.
 */
export function optionsDepuisEnvironnement(
  env: Record<string, string | undefined>,
  dossiers: { profil: string; documents: string; maison: string },
  choisirDossier: OptionsMemoire['choisirDossier'],
  journal: (message: string) => void = () => undefined,
): OptionsMemoire {
  if (env.TRACKER_BANC !== '1') return { ...dossiers, env, memoireEssai: null, choisirDossier }
  const documents = env.TRACKER_DOCUMENTS ? path.resolve(env.TRACKER_DOCUMENTS) : path.join(dossiers.profil, 'Documents-essai')
  return {
    profil: dossiers.profil,
    documents,
    maison: path.dirname(documents),
    env,
    memoireEssai: env.TRACKER_MEMOIRE ? path.resolve(env.TRACKER_MEMOIRE) : null,
    choisirDossier: async ({ depart }) => {
      const reponse = env.TRACKER_BANC_DOSSIER?.trim() ? path.resolve(env.TRACKER_BANC_DOSSIER) : null
      journal(`choix du dossier (depuis ${depart}) : ${reponse ?? 'renoncé'}`)
      return reponse
    },
  }
}
