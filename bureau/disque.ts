// Le dossier mémoire sur le disque, côté processus principal : Node pur, sans Electron, pour être testé sur un vrai
// dossier temporaire.
//
// La page ne donne jamais de chemin absolu : chaque chemin reçu est relatif à une racine tenue ici (`dossierDisque`),
// découpé sur `/` et contrôlé segment par segment (`resoudre`). La racine elle-même n'est jamais créée par une
// lecture ni par une écriture : un dossier débranché ou renommé répond « introuvable » au lieu de renaître vide.
//
// Écriture sans jamais laisser un fichier à moitié écrit, même convention que le dossier mémoire du téléphone :
// un fichier existant est d'abord écrit à côté sous `nom.tracker-tmp`, un fichier neuf sous `nom.tracker-new`,
// forcé sur le disque, puis renommé sur son nom (sous Windows, le renommage remplace la cible d'un coup). Une coupure
// laisse un temporaire, que la lecture suivante du dossier répare (`lister`) :
// - `nom.tracker-new` : création interrompue, effacé (la fiche se refait depuis le GPX) ;
// - `nom.tracker-tmp` à côté de `nom` : l'original est intact, le temporaire, peut-être incomplet, est effacé ;
// - `nom.tracker-tmp` seul : l'original avait été retiré (copie d'un téléphone), le temporaire reprend son nom.
// Un antivirus ou OneDrive qui tient un fichier un instant fait échouer le renommage (`EPERM`, `EBUSY`, `EACCES`) :
// l'écriture est reprise quelques fois avant d'abandonner (`avecEssais`).
//
// Liens et jonctions : le contrôle du texte d'un chemin (`resoudre`) ne voit pas un lien symbolique ou une jonction déjà
// posé dans le dossier (copie, archive reçue) qui mènerait ailleurs sur le disque. Aucune lecture, écriture, création ni
// suppression ne traverse donc un lien : avant chacune, le chemin réel du plus long ancêtre existant doit être le même
// que son chemin écrit sous la racine réelle (`exigerSansLien`), sinon `PERMISSION`. Le listage tait les liens. Seule la
// racine elle-même peut être un lien (un dossier choisi par l'utilisateur) : la comparaison part de sa forme réelle.

import type { Dirent } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, realpath, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

/** Suffixe du fichier écrit à côté de celui qu'il remplace, le temps de l'échange. */
export const SUFFIXE_REMPLACEMENT = '.tracker-tmp'

/** Suffixe d'un fichier neuf, le temps de l'écrire. */
export const SUFFIXE_NEUF = '.tracker-new'

/** Nom du dossier mémoire, celui que la page sait reconnaître et dans lequel elle peut demander de descendre. */
export const NOM_MEMOIRE = 'Tracker'

/** Longueur au-delà de laquelle un chemin reçu est refusé sans examen. */
const LONGUEUR_MAX = 1024

/** Attentes entre deux essais d'une écriture refusée un instant (antivirus, synchronisation), en millisecondes. */
export const ATTENTES_ESSAIS = [20, 50, 100, 200, 400]

/** Erreurs passagères : un autre programme tient le fichier. */
const PASSAGERES = new Set(['EPERM', 'EBUSY', 'EACCES'])

/** Codes rendus à la page, les mêmes que ceux du dossier mémoire du téléphone. */
export type CodeErreur = 'NOT_FOUND' | 'PERMISSION' | 'NO_SPACE' | 'UNKNOWN'

/** Erreur du dossier mémoire : un code lisible par la page et une phrase en clair. */
export class ErreurDisque extends Error {
  code: CodeErreur
  constructor(code: CodeErreur, message: string) {
    super(message)
    this.name = 'ErreurDisque'
    this.code = code
  }
}

/** Code d'une erreur de Node (`ENOENT`…), `undefined` s'il n'y en a pas. */
function codeNode(e: unknown): string | undefined {
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined
  return typeof code === 'string' ? code : undefined
}

/** Code rendu à la page pour une erreur de Node. */
export function codeDe(e: unknown): CodeErreur {
  if (e instanceof ErreurDisque) return e.code
  switch (codeNode(e)) {
    case 'ENOENT':
    case 'ENOTDIR':
      return 'NOT_FOUND'
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return 'PERMISSION'
    case 'ENOSPC':
    case 'EDQUOT':
      return 'NO_SPACE'
    default:
      return 'UNKNOWN'
  }
}

/** Erreur de Node mise en `ErreurDisque` : `phrase : détail`. Une `ErreurDisque` passe telle quelle. */
export function erreurDisque(e: unknown, phrase: string): ErreurDisque {
  if (e instanceof ErreurDisque) return e
  const detail = e instanceof Error ? e.message : String(e)
  return new ErreurDisque(codeDe(e), `${phrase} : ${detail}`)
}

// ---------- chemins ----------

/** Caractères qu'un nom de fichier de Windows ne peut pas porter, deux-points (flux de NTFS) compris. */
const CARACTERES_INTERDITS = /[\\:<>"|?*]/

/** Vrai si le texte porte un caractère de contrôle (nul compris). */
function aUnCaractereDeControle(texte: string): boolean {
  for (let i = 0; i < texte.length; i++) {
    const c = texte.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return true
  }
  return false
}

/** Noms réservés de Windows, seuls ou suivis d'une extension (`CON`, `nul.txt`, `COM1.json`). */
const NOMS_RESERVES = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]) *(\.|$)/i

/** Vrai si le nom porte l'un des suffixes des écritures en cours. */
export function estTemporaire(nom: string): boolean {
  const bas = nom.toLowerCase()
  return (bas.endsWith(SUFFIXE_REMPLACEMENT) && bas.length > SUFFIXE_REMPLACEMENT.length) || (bas.endsWith(SUFFIXE_NEUF) && bas.length > SUFFIXE_NEUF.length)
}

/** Vrai si le segment est un nom de fichier ou de dossier admis. */
export function segmentAdmis(segment: string): boolean {
  if (segment === '' || segment === '.' || segment === '..') return false
  if (CARACTERES_INTERDITS.test(segment) || aUnCaractereDeControle(segment)) return false
  // Windows retire en silence un point ou une espace finale : `a.` et `a` seraient le même fichier.
  if (segment.endsWith('.') || segment.endsWith(' ')) return false
  if (NOMS_RESERVES.test(segment)) return false
  const bas = segment.toLowerCase()
  return !bas.endsWith(SUFFIXE_REMPLACEMENT) && !bas.endsWith(SUFFIXE_NEUF)
}

/**
 * Chemin absolu d'un chemin relatif à la racine, ou `ErreurDisque` s'il est refusé : chemin vide (sauf
 * `racineAdmise`, pour lister la racine), segment vide (chemin absolu, `//`, barre finale), `.` ou `..`, caractère
 * interdit (lettre de lecteur et barre oblique inverse comprises), point ou espace finale, nom réservé de Windows,
 * suffixe d'une écriture en cours. Le chemin obtenu reste sous la racine, vérifié une seconde fois sur le texte après
 * la jonction des segments. Contrôle du texte seulement : les liens et jonctions du disque sont refusés à part, par
 * `exigerSansLien` du dossier.
 */
export function resoudre(racine: string, chemin: unknown, racineAdmise = false): string {
  if (typeof chemin !== 'string') throw new ErreurDisque('UNKNOWN', 'Chemin refusé : ce n’est pas un texte.')
  if (chemin === '' && racineAdmise) return path.resolve(racine)
  const refus = new ErreurDisque('UNKNOWN', `Chemin refusé : « ${chemin.slice(0, 200)} ».`)
  if (chemin.length > LONGUEUR_MAX) throw refus
  const segments = chemin.split('/')
  if (!segments.every(segmentAdmis)) throw refus
  const base = path.resolve(racine)
  const absolu = path.join(base, ...segments)
  const relatif = path.relative(base, absolu)
  if (relatif === '' || relatif.startsWith('..') || path.isAbsolute(relatif)) throw refus
  return absolu
}

// ---------- OneDrive et dossier proposé ----------

/** Variables d'environnement de Windows qui désignent les dossiers de OneDrive (personnel et professionnel). */
const VARIABLES_ONEDRIVE = ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']

/** Chemin de Windows comparable : absolu, sans barre finale, en minuscules (le disque ignore la casse). */
function comparable(chemin: string): string {
  return path.win32.resolve(chemin).replace(/\\+$/, '').toLowerCase()
}

/** Vrai si le chemin est dans un dossier de OneDrive, d'après les variables de Windows (`env`). */
export function estDansOneDrive(chemin: string, env: Record<string, string | undefined>): boolean {
  const cible = comparable(chemin)
  return VARIABLES_ONEDRIVE.some((nom) => {
    const racine = env[nom]?.trim()
    if (!racine) return false
    const base = comparable(racine)
    return cible === base || cible.startsWith(`${base}\\`)
  })
}

export type DossierPropose = {
  /** Chemin complet du dossier proposé (il peut ne pas exister encore). */
  chemin: string
  /** Vrai si le dossier proposé est lui-même dans OneDrive. */
  oneDrive: boolean
  /** Vrai si Documents est dans OneDrive, d'où un dossier proposé hors de Documents. */
  documentsOneDrive: boolean
}

/**
 * Dossier mémoire proposé au premier lancement : `Documents\Tracker` ; si Documents est dans OneDrive, le dossier de
 * l'utilisateur (`maison`) à la place, hors OneDrive : la synchronisation et les renommages des écritures se gênent.
 */
export function dossierPropose(documents: string, maison: string, env: Record<string, string | undefined>): DossierPropose {
  const documentsOneDrive = estDansOneDrive(documents, env)
  const chemin = path.join(documentsOneDrive ? maison : documents, NOM_MEMOIRE)
  return { chemin, oneDrive: estDansOneDrive(chemin, env), documentsOneDrive }
}

// ---------- écritures ----------

const pause = (ms: number) => new Promise<void>((fin) => setTimeout(fin, ms))

/**
 * Lance `action`, reprise après chaque attente de `attentes` tant qu'elle échoue sur une erreur passagère (`codes`,
 * par défaut `EPERM`, `EBUSY`, `EACCES`) ; toute autre erreur, ou la dernière, remonte.
 */
export async function avecEssais<T>(
  action: () => Promise<T>,
  attentes: readonly number[] = ATTENTES_ESSAIS,
  codes: ReadonlySet<string> = PASSAGERES,
): Promise<T> {
  for (let essai = 0; ; essai++) {
    try {
      return await action()
    } catch (e) {
      const code = codeNode(e)
      if (essai >= attentes.length || code === undefined || !codes.has(code)) throw e
      await pause(attentes[essai])
    }
  }
}

/**
 * File par fichier (la clé est le fichier visé, jamais son temporaire) : écritures, effacements et réparations d'un
 * même fichier passent l'un après l'autre, dans l'ordre de leurs appels.
 */
const file = new Map<string, Promise<unknown>>()

const cleDe = (absolu: string) => path.resolve(absolu).toLowerCase()

function enFile<T>(absolu: string, action: () => Promise<T>): Promise<T> {
  const cle = cleDe(absolu)
  const avant = file.get(cle) ?? Promise.resolve()
  const suite = avant.then(action, action)
  file.set(cle, suite)
  const liberer = () => {
    if (file.get(cle) === suite) file.delete(cle)
  }
  suite.then(liberer, liberer)
  return suite
}

async function effacerSansErreur(absolu: string): Promise<void> {
  try {
    await unlink(absolu)
  } catch {
    // Laissé tel quel : la prochaine lecture du dossier le retirera.
  }
}

/** Efface un fichier, repris sur une erreur passagère ; sans effet s'il n'existe pas. */
async function retirer(absolu: string): Promise<void> {
  await avecEssais(async () => {
    try {
      await unlink(absolu)
    } catch (e) {
      if (codeDe(e) !== 'NOT_FOUND') throw e
    }
  })
}

/** Vrai si quelque chose porte ce nom sur le disque, à l'instant. */
async function existe(absolu: string): Promise<boolean> {
  try {
    await lstat(absolu)
    return true
  } catch (e) {
    if (codeDe(e) === 'NOT_FOUND') return false
    throw e
  }
}

/** Une passe d'écriture : le temporaire écrit, forcé sur le disque, puis renommé ; effacé si l'une des étapes échoue. */
async function unePasse(absolu: string, octets: Uint8Array): Promise<void> {
  let existe = false
  try {
    const avant = await lstat(absolu)
    if (avant.isDirectory()) throw new ErreurDisque('UNKNOWN', `Écriture impossible : un dossier porte le nom « ${path.basename(absolu)} ».`)
    existe = true
  } catch (e) {
    if (e instanceof ErreurDisque) throw e
    if (codeNode(e) !== 'ENOENT') throw e
  }
  const temporaire = absolu + (existe ? SUFFIXE_REMPLACEMENT : SUFFIXE_NEUF)
  try {
    const poignee = await open(temporaire, 'w')
    try {
      await poignee.writeFile(octets)
      await poignee.sync()
    } finally {
      await poignee.close()
    }
    await rename(temporaire, absolu)
  } catch (e) {
    await effacerSansErreur(temporaire)
    throw e
  }
}

/**
 * Écrit un fichier à un chemin absolu sans jamais le laisser à moitié écrit (voir l'en-tête), à la suite des autres
 * écritures du même fichier. Le dossier parent doit exister.
 */
export function ecrireAtomique(absolu: string, octets: Uint8Array): Promise<void> {
  return enFile(absolu, () => avecEssais(() => unePasse(absolu, octets)))
}

// ---------- le dossier ----------

export type Entree = {
  name: string
  kind: 'file' | 'directory'
  /** Taille en octets, 0 pour un dossier. */
  size: number
  /** Date de dernière modification, en millisecondes entières. */
  mtimeMs: number
}

export type Etat = { size: number; mtimeMs: number }

export interface DossierDisque {
  /** Chemin absolu de la racine. */
  readonly racine: string
  readonly lectureSeule: boolean
  /** Contenu d'un sous-dossier (`''` : la racine), sans les temporaires ; vide s'il n'existe pas. */
  lister(chemin: string): Promise<Entree[]>
  /** Texte d'un fichier en UTF-8, sans marque d'ordre des octets en tête ; `null` s'il n'existe pas. */
  lireTexte(chemin: string): Promise<string | null>
  /** Octets d'un fichier, `null` s'il n'existe pas. */
  lireOctets(chemin: string): Promise<Uint8Array | null>
  /** Taille et date d'un fichier ; `null` s'il n'existe pas ou si c'est un dossier. */
  stat(chemin: string): Promise<Etat | null>
  /** Écrit un texte en UTF-8, en créant les sous-dossiers qui manquent (jamais la racine). */
  ecrireTexte(chemin: string, texte: string): Promise<void>
  /** Écrit des octets, en créant les sous-dossiers qui manquent (jamais la racine). */
  ecrireOctets(chemin: string, octets: Uint8Array): Promise<void>
  /** Efface un fichier ; sans effet s'il n'existe pas. Un dossier n'est jamais effacé. */
  effacer(chemin: string): Promise<void>
}

const RACINE_INTROUVABLE = 'Le dossier mémoire est introuvable'

/**
 * Le dossier mémoire de racine `racine` (chemin absolu). Toute erreur est une `ErreurDisque`. Une racine absente
 * donne `NOT_FOUND` à toute opération qui l'atteint, sans être recréée. En lecture seule (dossier proposé ou choisi,
 * pas encore retenu), rien ne s'écrit ni ne s'efface, les temporaires ne sont pas réparés mais seulement tus, et une
 * racine absente (dossier proposé, créé seulement quand il est retenu) se lit comme un dossier vide.
 */
export function dossierDisque(racine: string, { lectureSeule = false }: { lectureSeule?: boolean } = {}): DossierDisque {
  const base = path.resolve(racine)

  /** Lève `NOT_FOUND` si la racine n'est plus un dossier ; en lecture seule, une racine absente se lit comme vide. */
  async function exigerRacine(): Promise<void> {
    let estDossier = false
    try {
      estDossier = (await stat(base)).isDirectory()
    } catch (e) {
      if (codeDe(e) !== 'NOT_FOUND') throw erreurDisque(e, 'Lecture du dossier impossible')
      if (lectureSeule) return
    }
    if (!estDossier) throw new ErreurDisque('NOT_FOUND', `${RACINE_INTROUVABLE} : ${base}`)
  }

  /** Après un `ENOENT` : `null` si seul le fichier manque, `NOT_FOUND` si c'est la racine. */
  async function absent(): Promise<null> {
    await exigerRacine()
    return null
  }

  /**
   * Lève `PERMISSION` si le chemin passe par un lien symbolique ou une jonction sous la racine : le chemin réel
   * (`realpath`) de son plus long ancêtre existant doit être le chemin écrit de cet ancêtre, posé sous la racine réelle
   * (la racine peut être un lien). Deux `realpath` d'ordinaire (la racine, le chemin) ; un de plus par niveau qui
   * n'existe pas encore. Une racine absente : rien n'existe dessous, rien à traverser (l'opération dira `NOT_FOUND`).
   */
  async function exigerSansLien(absolu: string): Promise<void> {
    let racineReelle: string
    try {
      racineReelle = await realpath(base)
    } catch (e) {
      if (codeDe(e) === 'NOT_FOUND') return
      throw erreurDisque(e, 'Lecture du dossier impossible')
    }
    for (let courant = absolu; ; courant = path.dirname(courant)) {
      let reel: string
      try {
        reel = await realpath(courant)
      } catch (e) {
        if (codeDe(e) === 'NOT_FOUND' && courant !== base) continue
        throw erreurDisque(e, 'Lecture du dossier impossible')
      }
      if (cleDe(reel) !== cleDe(path.join(racineReelle, path.relative(base, courant)))) {
        throw new ErreurDisque('PERMISSION', `Chemin refusé : « ${path.relative(base, absolu)} » passe par un lien ou une jonction.`)
      }
      return
    }
  }

  function exigerEcriture(): void {
    if (lectureSeule) throw new ErreurDisque('PERMISSION', 'Ce dossier n’est pas encore retenu comme dossier mémoire : rien ne s’y écrit.')
  }

  /** Crée les sous-dossiers du chemin un par un depuis la racine, qui doit exister. */
  async function creerParents(absolu: string): Promise<void> {
    const segments = path.relative(base, path.dirname(absolu)).split(path.sep).filter((s) => s !== '')
    let courant = base
    for (const segment of segments) {
      courant = path.join(courant, segment)
      try {
        await mkdir(courant)
      } catch (e) {
        if (codeNode(e) === 'EEXIST') continue
        if (codeDe(e) === 'NOT_FOUND') await exigerRacine()
        throw e
      }
    }
  }

  async function entree(dossier: string, nom: string): Promise<Entree | null> {
    try {
      // `lstat` : un lien ou une jonction n'est pas suivi, et il n'est pas montré.
      const s = await lstat(path.join(dossier, nom))
      if (s.isSymbolicLink()) return null
      if (s.isDirectory()) return { name: nom, kind: 'directory', size: 0, mtimeMs: Math.round(s.mtimeMs) }
      if (s.isFile()) return { name: nom, kind: 'file', size: s.size, mtimeMs: Math.round(s.mtimeMs) }
      return null
    } catch {
      // Retiré entre-temps, ou fichier du système qui ne se décrit pas : il n'est pas montré.
      return null
    }
  }

  /**
   * Répare un temporaire trouvé par `lister` ; rend le nom sous lequel montrer le fichier qu'il concerne, s'il
   * existe après la réparation et que le listage ne l'a pas encore vu, `null` sinon. La réparation prend la file du
   * fichier visé : une écriture en cours finit d'abord (son temporaire n'est pas orphelin), aucune ne commence pendant,
   * et l'existence du fichier visé est relue sur le disque au moment d'agir, jamais d'après le listage.
   */
  async function reparer(dossier: string, nom: string, noms: Set<string>): Promise<string | null> {
    const absolu = path.join(dossier, nom)
    const suffixe = nom.toLowerCase().endsWith(SUFFIXE_NEUF) ? SUFFIXE_NEUF : SUFFIXE_REMPLACEMENT
    const original = nom.slice(0, nom.length - suffixe.length)
    const cible = path.join(dossier, original)
    let montre: boolean
    try {
      montre = await enFile(cible, async () => {
        // Déjà repris ou effacé par l'écriture ou l'effacement qui tenait la file.
        if (!(await existe(absolu))) return existe(cible)
        if (suffixe === SUFFIXE_NEUF || (await existe(cible))) {
          await effacerSansErreur(absolu)
          return existe(cible)
        }
        await rename(absolu, cible)
        return true
      })
    } catch {
      // Laissé tel quel : rien n'est perdu, l'échange sera repris à la prochaine lecture.
      return null
    }
    if (!montre || noms.has(original.toLowerCase())) return null
    noms.add(original.toLowerCase())
    return original
  }

  async function ecrire(chemin: string, octets: Uint8Array): Promise<void> {
    exigerEcriture()
    const absolu = resoudre(base, chemin)
    try {
      // Mise en file dès l'appel, sous-dossiers compris : deux écritures lancées dans un ordre aboutissent dans cet ordre.
      await enFile(absolu, async () => {
        await exigerSansLien(absolu)
        await creerParents(absolu)
        await avecEssais(() => unePasse(absolu, octets))
      })
    } catch (e) {
      if (codeDe(e) === 'NOT_FOUND') await exigerRacine()
      throw erreurDisque(e, 'Écriture impossible')
    }
  }

  async function lire(chemin: string): Promise<Buffer | null> {
    const absolu = resoudre(base, chemin)
    await exigerSansLien(absolu)
    try {
      return await readFile(absolu)
    } catch (e) {
      if (codeDe(e) === 'NOT_FOUND') return absent()
      // Un dossier à ce nom : pas de fichier à lire.
      if (codeNode(e) === 'EISDIR') return null
      throw erreurDisque(e, 'Lecture impossible')
    }
  }

  return {
    racine: base,
    lectureSeule,

    async lister(chemin) {
      const dossier = resoudre(base, chemin, true)
      await exigerSansLien(dossier)
      let contenu: Dirent[]
      try {
        contenu = await readdir(dossier, { withFileTypes: true })
      } catch (e) {
        if (codeDe(e) === 'NOT_FOUND') {
          await exigerRacine()
          if (dossier === base && !lectureSeule) throw new ErreurDisque('NOT_FOUND', `${RACINE_INTROUVABLE} : ${base}`)
          return []
        }
        throw erreurDisque(e, 'Lecture du dossier impossible')
      }
      const noms = new Set(contenu.map((d) => d.name.toLowerCase()))
      const entrees: Entree[] = []
      for (const d of contenu) {
        let nom: string | null = d.name
        // Un lien ou une jonction n'est ni réparé ni montré (`entree` le relit par `lstat`, qui tranche).
        if (estTemporaire(d.name)) nom = !lectureSeule && d.isFile() ? await reparer(dossier, d.name, noms) : null
        if (nom === null) continue
        const e = await entree(dossier, nom)
        if (e) entrees.push(e)
      }
      return entrees
    },

    async lireTexte(chemin) {
      const octets = await lire(chemin)
      if (octets === null) return null
      const texte = octets.toString('utf8')
      return texte.charCodeAt(0) === 0xfeff ? texte.slice(1) : texte
    },

    async lireOctets(chemin) {
      const octets = await lire(chemin)
      return octets === null ? null : new Uint8Array(octets.buffer, octets.byteOffset, octets.byteLength)
    },

    async stat(chemin) {
      const absolu = resoudre(base, chemin)
      await exigerSansLien(absolu)
      try {
        const s = await stat(absolu)
        return s.isFile() ? { size: s.size, mtimeMs: Math.round(s.mtimeMs) } : null
      } catch (e) {
        if (codeDe(e) === 'NOT_FOUND') return absent()
        throw erreurDisque(e, 'Lecture du fichier impossible')
      }
    },

    ecrireTexte(chemin, texte) {
      return ecrire(chemin, Buffer.from(texte, 'utf8'))
    },

    ecrireOctets(chemin, octets) {
      return ecrire(chemin, octets)
    },

    async effacer(chemin) {
      exigerEcriture()
      const absolu = resoudre(base, chemin)
      try {
        await enFile(absolu, async () => {
          await exigerSansLien(absolu)
          let s = null
          try {
            s = await lstat(absolu)
          } catch (e) {
            if (codeDe(e) !== 'NOT_FOUND') throw e
            await exigerRacine()
          }
          if (s?.isDirectory()) throw new ErreurDisque('UNKNOWN', `Suppression refusée : « ${chemin} » est un dossier.`)
          if (s) await retirer(absolu)
          // Un temporaire laissé par une écriture interrompue ferait revenir le fichier au listage suivant.
          await retirer(absolu + SUFFIXE_REMPLACEMENT)
          await retirer(absolu + SUFFIXE_NEUF)
        })
      } catch (e) {
        if (codeDe(e) === 'NOT_FOUND') await exigerRacine()
        throw erreurDisque(e, 'Suppression impossible')
      }
    },
  }
}
