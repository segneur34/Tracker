// Le « dossier distant » : le dossier `Documents/Tracker` du téléphone branché, vu du processus principal, en LECTURE
// SEULE. Une interface (le débogage USB dans `adb.ts`), sa mise en œuvre « dossier local » pour les tests et le banc,
// et les gestionnaires des canaux `telephone:*` du pont. Sans Electron.
//
// Lecture seule : l'interface n'a rien pour écrire, renommer ni retirer sur le téléphone. Seul le dossier temporaire
// des lectures, côté PC, reçoit des fichiers, et il les perd aussitôt lus.
//
// Sécurité :
// - la page ne désigne un fichier que par un chemin rendu par le dernier listage : `lireOctets` refuse tout autre
//   chemin, si bien qu'elle ne peut pas atteindre un fichier quelconque du téléphone ;
// - les chemins sont relatifs à `Documents/Tracker`, séparés par `/`, sans `.` ni `..`, et se limitent aux fichiers de
//   la racine et de `sessions/` (`cheminAdmis`) ;
// - une lecture dont la taille diffère de celle du listage échoue, et son fichier temporaire est effacé ;
// - le dossier temporaire n'est jamais dans la mémoire du programme (vérifié à chaque listage).
//
// Mode d'essai (`TRACKER_BANC=1`) seulement, `telephoneDepuisEnvironnement` lit :
//   TRACKER_BANC_TELEPHONE          dossier local qui joue la mémoire partagée du téléphone (son `/sdcard`) ;
//                                   son sous-dossier `Documents/Tracker` est celui qui est lu
//   TRACKER_BANC_TELEPHONE_ETAT     état imposé : pret, absent, autorisation, horsLigne, adbIntrouvable, occupe ou plusieurs
//   TRACKER_BANC_TELEPHONE_COUPURE  téléphone débranché après ce nombre de lectures réussies
//   TRACKER_BANC_RACINE_TELEPHONE   racine déplacée vers `Documents/<valeur>`, valeur bornée à `Tracker-essai` ou
//                                   `Tracker-essai-<minuscules et chiffres>` (`RACINE_ESSAI`) ; sans dossier local,
//                                   c'est le vrai téléphone qui est lu, sur cette racine seulement
// Hors de ce mode, aucune de ces variables n'est lue : le vrai téléphone, sur `Documents/Tracker`.

import { copyFile, mkdir, readFile, readdir, stat, unlink, utimes } from 'node:fs/promises'
import path from 'node:path'
import { ErreurDisque, SUFFIXE_NEUF, SUFFIXE_REMPLACEMENT, avecEssais, codeDe, segmentAdmis } from './disque'
import type { Gestionnaire } from './pont'
import { enReponse } from './pont'

/** État du téléphone, tel que la page le lit. */
export type EtatTelephone =
  /** Un téléphone prêt à être lu ; `nom` est son modèle, pour le message. */
  | { etat: 'pret'; nom: string }
  /** Rien de branché, ou rien de vu. */
  | { etat: 'absent' }
  /** Le téléphone attend que l'utilisateur accepte cet ordinateur. */
  | { etat: 'autorisation' }
  /** Le téléphone est vu mais ne répond pas. */
  | { etat: 'horsLigne' }
  /** L'outil du débogage USB n'est pas sur le poste ; `dossier` est celui où copier son dossier `platform-tools`. */
  | { etat: 'adbIntrouvable'; dossier: string }
  /** Un autre programme tient la liaison avec le téléphone : on n'y touche pas. */
  | { etat: 'occupe' }
  /** Plusieurs appareils sont branchés (ou un émulateur est ouvert) : refusé, pour ne jamais lire le mauvais. */
  | { etat: 'plusieurs'; nombre: number }

/** Valeurs de `etat`, dans l'ordre du type. */
export const ETATS_TELEPHONE = ['pret', 'absent', 'autorisation', 'horsLigne', 'adbIntrouvable', 'occupe', 'plusieurs'] as const satisfies readonly EtatTelephone['etat'][]

/** Un fichier du téléphone : chemin relatif à `Documents/Tracker`, taille en octets, date de modification à la seconde. */
export type FichierTelephone = { chemin: string; taille: number; dateMs: number }

/** Le dossier `Documents/Tracker` d'un téléphone, en lecture seule. */
export interface DossierDistant {
  /** État du téléphone ; lève seulement sur une panne imprévue de l'outil. */
  etat(): Promise<EtatTelephone>
  /**
   * Fichiers de la racine et de `sessions/`, triés par chemin, tels que l'application du téléphone les voit.
   * `NOT_FOUND` si le dossier n'existe pas sur le téléphone ; une erreur si le téléphone n'est pas prêt.
   */
  lister(): Promise<FichierTelephone[]>
  /**
   * Copie un fichier rendu par le dernier `lister` vers `fichierLocal` (chemin absolu sur le PC), en gardant sa date
   * de modification. Le fichier entier est passé, pour que le canal règle son délai sur la taille.
   */
  lire(fichier: FichierTelephone, fichierLocal: string): Promise<void>
}

/** Nom du dossier mémoire du téléphone, sous `Documents`. */
export const NOM_RACINE = 'Tracker'

/** Noms admis pour la racine déplacée du mode d'essai : jamais le vrai `Tracker`. */
export const RACINE_ESSAI = /^Tracker-essai(-[a-z0-9]+)?$/

/** Sous-dossier du dossier du téléphone dont les fichiers sont listés, en plus de ceux de la racine. */
export const DOSSIER_SESSIONS = 'sessions'

/**
 * Vrai pour un chemin relatif listable : un fichier de la racine ou de `sessions/`, chaque segment admis sur le disque
 * du PC (`segmentAdmis` : ni vide, ni `.` ou `..`, ni caractère interdit par Windows, antislash et deux-points compris,
 * ni nom provisoire), puisque c'est là qu'il sera rangé. Un chemin absolu commence par un segment vide : refusé.
 */
export function cheminAdmis(chemin: string): boolean {
  const segments = chemin.split('/')
  if (segments.length === 2 && segments[0] !== DOSSIER_SESSIONS) return false
  if (segments.length !== 1 && segments.length !== 2) return false
  return segments.every(segmentAdmis)
}

/** Un fichier tel que le téléphone le montre (`chemin`), et le nom qu'il porte vraiment sur le téléphone (`reel`). */
export type FichierVu = FichierTelephone & { reel: string }

/**
 * Fichiers tels que l'application du téléphone les voit, dossier par dossier (règle de `finishInterruptedReplace` du
 * greffon du dossier mémoire) : `nom.tracker-new` (création interrompue) est caché ; `nom.tracker-tmp` à côté de `nom`
 * (remplacement interrompu, l'original intact) est caché ; `nom.tracker-tmp` seul (l'original déjà retiré) est montré
 * sous `nom`. Suffixes en casse exacte, comme sur le téléphone.
 */
export function commeLeTelephone(bruts: readonly FichierTelephone[]): FichierVu[] {
  const parDossier = new Map<string, FichierTelephone[]>()
  for (const f of bruts) {
    const i = f.chemin.lastIndexOf('/')
    const dossier = i < 0 ? '' : f.chemin.slice(0, i + 1)
    parDossier.set(dossier, [...(parDossier.get(dossier) ?? []), f])
  }
  const vus: FichierVu[] = []
  for (const [dossier, fichiers] of parDossier) {
    const noms = new Set(fichiers.map((f) => f.chemin.slice(dossier.length)))
    for (const f of fichiers) {
      const nom = f.chemin.slice(dossier.length)
      if (nom.endsWith(SUFFIXE_NEUF) && nom.length > SUFFIXE_NEUF.length) continue
      if (nom.endsWith(SUFFIXE_REMPLACEMENT) && nom.length > SUFFIXE_REMPLACEMENT.length) {
        const original = nom.slice(0, -SUFFIXE_REMPLACEMENT.length)
        if (noms.has(original)) continue
        noms.add(original)
        vus.push({ ...f, chemin: dossier + original, reel: f.chemin })
        continue
      }
      vus.push({ ...f, reel: f.chemin })
    }
  }
  return vus
}

/** Fichiers admis (`cheminAdmis`), triés par chemin ; un chemin vu deux fois (nom coupé par un retour à la ligne) est écarté. */
export function fichiersAdmis<F extends FichierTelephone>(fichiers: F[]): F[] {
  const vus = new Map<string, number>()
  for (const f of fichiers) vus.set(f.chemin, (vus.get(f.chemin) ?? 0) + 1)
  return fichiers
    .filter((f) => cheminAdmis(f.chemin) && vus.get(f.chemin) === 1 && Number.isSafeInteger(f.taille) && f.taille >= 0 && Number.isFinite(f.dateMs))
    .sort((a, b) => (a.chemin < b.chemin ? -1 : a.chemin > b.chemin ? 1 : 0))
}

/** Le fichier montré, sans le nom réel (ce que la page reçoit). */
export function sansReel({ chemin, taille, dateMs }: FichierVu): FichierTelephone {
  return { chemin, taille, dateMs }
}

/** Erreur rendue quand le téléphone n'est pas prêt pour un listage ou une lecture. */
export function pasPret(etat: EtatTelephone['etat']): ErreurDisque {
  return new ErreurDisque('UNKNOWN', `Le téléphone n'est pas prêt (${etat}).`)
}

/** Erreur rendue quand le dossier mémoire est absent du téléphone. */
export function racineAbsente(nomRacine: string): ErreurDisque {
  return new ErreurDisque('NOT_FOUND', `Le dossier Documents/${nomRacine} est absent du téléphone.`)
}

// ---------- le dossier local, pour les tests et le banc ----------

/** Nom du téléphone d'essai. */
export const NOM_TELEPHONE_ESSAI = "Téléphone d'essai"

export type OptionsDossierLocal = {
  /** État imposé, à la place de celui que donne le dossier. */
  etatImpose?: EtatTelephone | null
  /** Téléphone débranché après ce nombre de lectures réussies. */
  coupureApres?: number | null
  /** Nom de la racine sous `Documents` : `Tracker` par défaut. */
  nomRacine?: string
}

/**
 * Un dossier local qui joue la mémoire partagée du téléphone (`stockage`, son `/sdcard`) : le dossier lu est
 * `stockage/Documents/Tracker`. Il n'est jamais modifié (aucune fonction ici n'y écrit). Stockage absent : téléphone
 * absent.
 */
export function dossierLocal(stockage: string | null, options: OptionsDossierLocal = {}): DossierDistant {
  const nomRacine = options.nomRacine ?? NOM_RACINE
  const racine = stockage === null ? null : path.join(path.resolve(stockage), 'Documents', nomRacine)
  const coupure = options.coupureApres ?? null
  let lectures = 0
  let debranche = false
  /** Nom réel de chaque fichier du dernier listage, par chemin montré. */
  let reels = new Map<string, string>()

  async function etat(): Promise<EtatTelephone> {
    if (debranche) return { etat: 'absent' }
    if (options.etatImpose) return options.etatImpose
    if (stockage === null) return { etat: 'absent' }
    try {
      return (await stat(stockage)).isDirectory() ? { etat: 'pret', nom: NOM_TELEPHONE_ESSAI } : { etat: 'absent' }
    } catch {
      return { etat: 'absent' }
    }
  }

  async function exigerPret(): Promise<string> {
    const e = await etat()
    if (e.etat !== 'pret' || racine === null) throw pasPret(e.etat)
    return racine
  }

  /** Fichiers d'un dossier du téléphone d'essai, provisoires compris, à la seconde près comme ceux du débogage USB. */
  async function fichiersDe(dossier: string, prefixe: string): Promise<FichierTelephone[]> {
    const fichiers: FichierTelephone[] = []
    for (const entree of await readdir(dossier, { withFileTypes: true })) {
      if (!entree.isFile()) continue
      const s = await stat(path.join(dossier, entree.name))
      fichiers.push({ chemin: prefixe + entree.name, taille: s.size, dateMs: Math.floor(s.mtimeMs / 1000) * 1000 })
    }
    return fichiers
  }

  return {
    etat,

    async lister() {
      const r = await exigerPret()
      let fichiers: FichierTelephone[]
      try {
        if (!(await stat(r)).isDirectory()) throw racineAbsente(nomRacine)
        fichiers = await fichiersDe(r, '')
      } catch (e) {
        if (codeDe(e) === 'NOT_FOUND') throw racineAbsente(nomRacine)
        throw e
      }
      try {
        fichiers.push(...(await fichiersDe(path.join(r, DOSSIER_SESSIONS), `${DOSSIER_SESSIONS}/`)))
      } catch (e) {
        if (codeDe(e) !== 'NOT_FOUND') throw e
      }
      const vus = fichiersAdmis(commeLeTelephone(fichiers))
      reels = new Map(vus.map((f) => [f.chemin, f.reel]))
      return vus.map(sansReel)
    },

    async lire(fichier, fichierLocal) {
      const r = await exigerPret()
      if (coupure !== null && lectures >= coupure) {
        debranche = true
        throw new ErreurDisque('UNKNOWN', 'Le téléphone a été débranché pendant la lecture.')
      }
      if (!cheminAdmis(fichier.chemin)) throw new ErreurDisque('UNKNOWN', 'Chemin refusé.')
      await copyFile(path.join(r, ...(reels.get(fichier.chemin) ?? fichier.chemin).split('/')), fichierLocal)
      const date = new Date(fichier.dateMs)
      await utimes(fichierLocal, date, date)
      lectures++
    },
  }
}

// ---------- les canaux de la page ----------

/** Canaux servis ; le pont de la page (`preload.ts`) porte les mêmes noms. Aucun n'écrit sur le téléphone. */
export const CANAUX_TELEPHONE = ['etat', 'lister', 'lireOctets'] as const

/** Nom du dossier temporaire des lectures, dans le profil du programme. */
export const DOSSIER_LECTURES = 'telephone-lecture'

/** Efface un fichier, repris si un autre programme le tient un instant ; sans effet s'il n'existe pas. */
async function effacer(absolu: string): Promise<void> {
  try {
    await avecEssais(async () => {
      try {
        await unlink(absolu)
      } catch (e) {
        if (codeDe(e) !== 'NOT_FOUND') throw e
      }
    })
  } catch {
    // Laissé tel quel : le prochain listage ou le prochain démarrage videra le dossier.
  }
}

/**
 * Vide le dossier temporaire des lectures : seuls les fichiers qu'il a reçus (suffixe `.tracker-tmp`) sont effacés,
 * rien d'autre, même si le dossier venait à en porter. Sans effet s'il n'existe pas.
 */
export async function viderLectures(dossierTemp: string): Promise<void> {
  let noms: string[]
  try {
    noms = await readdir(dossierTemp)
  } catch {
    return
  }
  for (const nom of noms) if (nom.toLowerCase().endsWith(SUFFIXE_REMPLACEMENT)) await effacer(path.join(dossierTemp, nom))
}

/** Vrai si `dedans` est `dossier` ou l'un de ses sous-dossiers (casse ignorée, comme sur le disque de Windows). */
function estSous(dedans: string, dossier: string): boolean {
  const relatif = path.relative(path.resolve(dossier).toLowerCase(), path.resolve(dedans).toLowerCase())
  return relatif === '' || (!relatif.startsWith('..') && !path.isAbsolute(relatif))
}

export type OptionsGestionnaires = {
  /** Dossier mémoire retenu, `null` s'il n'y en a pas : le dossier temporaire ne doit jamais s'y trouver. */
  memoire?: () => Promise<string | null>
}

/** File qui fait passer les actions une à une, dans l'ordre des appels. */
export type FileTelephone = <T>(action: () => Promise<T>) => Promise<T>

/** Une action à la fois, dans l'ordre des appels : le téléphone ne reçoit jamais deux commandes ensemble. */
export function enSerie(): FileTelephone {
  let queue: Promise<unknown> = Promise.resolve()
  return <T>(action: () => Promise<T>) => {
    const suite = queue.then(action, action)
    queue = suite.catch(() => undefined)
    return suite
  }
}

/** Champs d'un message reçu de la page, `{}` s'il n'est pas un objet. */
function champs(argument: unknown): Record<string, unknown> {
  return typeof argument === 'object' && argument !== null && !Array.isArray(argument) ? (argument as Record<string, unknown>) : {}
}

/**
 * Gestionnaires des canaux `telephone:*`, à brancher par `brancherCanaux` :
 * - `telephone:etat` rend un `EtatTelephone` ; un téléphone qui n'est plus prêt fait oublier le dernier listage ;
 * - `telephone:lister` rend les `FichierTelephone` (`NOT_FOUND` si `Documents/Tracker` est absent), et vide le
 *   dossier temporaire ;
 * - `telephone:lireOctets({ chemin })` rend les octets d'un fichier du dernier listage, et d'aucun autre ; le fichier
 *   temporaire est effacé, réussite ou échec.
 */
export function gestionnairesTelephone(dossier: DossierDistant, dossierTemp: string, options: OptionsGestionnaires = {}): Record<string, Gestionnaire> {
  const serie = enSerie()
  /** Fichiers du dernier listage réussi, par chemin ; vide après un listage en échec. */
  let dernier = new Map<string, FichierTelephone>()
  let numero = 0

  /** Refuse un dossier temporaire placé dans la mémoire (ou qui la contient). */
  async function verifierTemp(): Promise<void> {
    const memoire = options.memoire ? await options.memoire() : null
    if (memoire !== null && (estSous(dossierTemp, memoire) || estSous(memoire, dossierTemp))) {
      throw new ErreurDisque('UNKNOWN', 'Le dossier temporaire des lectures du téléphone est dans la mémoire : refusé.')
    }
  }

  return {
    'telephone:etat': () =>
      enReponse(() =>
        serie(async () => {
          try {
            const e = await dossier.etat()
            if (e.etat !== 'pret') dernier = new Map()
            return e
          } catch (erreur) {
            dernier = new Map()
            throw erreur
          }
        }),
      ),

    'telephone:lister': () =>
      enReponse(() =>
        serie(async () => {
          dernier = new Map()
          await verifierTemp()
          await viderLectures(dossierTemp)
          const fichiers = await dossier.lister()
          dernier = new Map(fichiers.map((f) => [f.chemin, f]))
          return fichiers
        }),
      ),

    'telephone:lireOctets': (argument) =>
      enReponse(() =>
        serie(async (): Promise<Uint8Array> => {
          const chemin = champs(argument).chemin
          if (typeof chemin !== 'string') throw new ErreurDisque('UNKNOWN', 'Message mal formé : « chemin » doit être un texte.')
          const fichier = dernier.get(chemin)
          if (!fichier) throw new ErreurDisque('UNKNOWN', `Fichier absent du dernier listage du téléphone : « ${chemin.slice(0, 200)} ».`)
          await mkdir(dossierTemp, { recursive: true })
          const local = path.join(dossierTemp, `${++numero}${SUFFIXE_REMPLACEMENT}`)
          try {
            await dossier.lire(fichier, local)
            const taille = (await stat(local)).size
            if (taille !== fichier.taille) {
              throw new ErreurDisque('UNKNOWN', `Lecture incomplète de « ${chemin} » : ${taille} octets reçus sur ${fichier.taille}.`)
            }
            return await readFile(local)
          } finally {
            await effacer(local)
          }
        }),
      ),
  }
}

// ---------- choix du téléphone d'après l'environnement ----------

/** Le téléphone à lire : le vrai, par le débogage USB, sur une racine ; ou le dossier local du mode d'essai. */
export type ChoixTelephone =
  | { canal: 'adb'; nomRacine: string }
  | { canal: 'local'; stockage: string | null; etatImpose: EtatTelephone | null; coupureApres: number | null; nomRacine: string }

/**
 * Le téléphone que la coquille lit, d'après l'environnement. Hors du mode d'essai (`TRACKER_BANC=1`), aucune variable
 * n'est lue : le vrai téléphone, sur `Documents/Tracker`. En mode d'essai :
 * - `TRACKER_BANC_RACINE_TELEPHONE` illisible (hors de `RACINE_ESSAI`) : téléphone absent, jamais le vrai dossier ;
 * - `TRACKER_BANC_TELEPHONE` posé : ce dossier local joue le téléphone (état imposé et coupure lus), sur la racine
 *   déplacée si elle est donnée ;
 * - sinon, `TRACKER_BANC_RACINE_TELEPHONE` posé : le vrai téléphone, sur la racine déplacée seulement ;
 * - sinon : téléphone absent (le mode d'essai ne lit jamais le vrai `Documents/Tracker`).
 * `dossierAdb` est l'endroit donné par l'état `adbIntrouvable` imposé.
 */
export function telephoneDepuisEnvironnement(
  env: Record<string, string | undefined>,
  dossierAdb: string,
  journal: (message: string) => void = () => undefined,
): ChoixTelephone {
  if (env.TRACKER_BANC !== '1') return { canal: 'adb', nomRacine: NOM_RACINE }
  const absent = (nomRacine: string): ChoixTelephone => ({ canal: 'local', stockage: null, etatImpose: null, coupureApres: null, nomRacine })
  const racineBrute = env.TRACKER_BANC_RACINE_TELEPHONE?.trim() ?? ''
  if (racineBrute !== '' && !RACINE_ESSAI.test(racineBrute)) {
    journal(`racine du téléphone d'essai refusée : ${racineBrute.slice(0, 60)} ; téléphone absent`)
    return absent(NOM_RACINE)
  }
  const nomRacine = racineBrute === '' ? NOM_RACINE : racineBrute
  const stockage = env.TRACKER_BANC_TELEPHONE?.trim() ? path.resolve(env.TRACKER_BANC_TELEPHONE) : null
  if (stockage === null && racineBrute !== '') {
    journal(`vrai téléphone, racine d'essai : Documents/${nomRacine}`)
    return { canal: 'adb', nomRacine }
  }
  const nom = env.TRACKER_BANC_TELEPHONE_ETAT?.trim() ?? ''
  let etatImpose: EtatTelephone | null = null
  if (nom === 'pret') etatImpose = { etat: 'pret', nom: NOM_TELEPHONE_ESSAI }
  else if (nom === 'adbIntrouvable') etatImpose = { etat: 'adbIntrouvable', dossier: dossierAdb }
  else if (nom === 'plusieurs') etatImpose = { etat: 'plusieurs', nombre: 2 }
  else if (nom === 'absent' || nom === 'autorisation' || nom === 'horsLigne' || nom === 'occupe') etatImpose = { etat: nom }
  else if (nom !== '') journal(`état du téléphone d'essai inconnu, ignoré : ${nom}`)
  const brut = env.TRACKER_BANC_TELEPHONE_COUPURE?.trim() ?? ''
  const coupureApres = /^\d+$/.test(brut) ? Number(brut) : null
  if (brut !== '' && coupureApres === null) journal(`coupure du téléphone d'essai illisible, ignorée : ${brut}`)
  journal(`téléphone d'essai : ${stockage ?? 'aucun'}${etatImpose ? `, état ${etatImpose.etat}` : ''}${coupureApres !== null ? `, coupure après ${coupureApres}` : ''}, racine Documents/${nomRacine}`)
  return { canal: 'local', stockage, etatImpose, coupureApres, nomRacine }
}
