// Copie de sécurité faite avant la première synchronisation d'un téléphone : le dossier mémoire de l'ordinateur et
// le dossier `Documents/Tracker` du téléphone, ENTIERS (toute profondeur, provisoires compris), copiés côte à côte sous
// `<Documents>\Tracker-copies\<AAAA-MM-JJ HH-MM-SS>\` (`ordinateur\` et `telephone\`). Rien n'est effacé ni écrasé :
// un dossier du même nom (deux copies dans la même seconde) en fait un autre, suivi de « (2) ». Une copie qui échoue
// en route garde ce qu'elle a déjà copié, sous un nom qui le dit (« incomplète »), et l'erreur remonte : la
// synchronisation n'a alors pas lieu. Le dossier des copies n'est jamais dans la mémoire, ni ne la contient. Sans
// Electron.

import { cp, lstat, mkdir, readdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { ErreurDisque, codeDe, segmentCopiable } from './disque'
import type { DossierDistant } from './telephone'

/** Dossier des copies, sous Documents. */
export const DOSSIER_COPIES = 'Tracker-copies'

/** Sous-dossier de la copie du dossier mémoire de l'ordinateur. */
export const COPIE_ORDINATEUR = 'ordinateur'

/** Sous-dossier de la copie du dossier du téléphone. */
export const COPIE_TELEPHONE = 'telephone'

const deux = (n: number): string => String(n).padStart(2, '0')

/** Nom du dossier d'une copie : date et heure locales, « 2026-11-21 14-03-12 ». */
export function nomCopie(date: Date): string {
  return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())} ${deux(date.getHours())}-${deux(date.getMinutes())}-${deux(date.getSeconds())}`
}

/**
 * Vrai si `dedans` est `dossier` ou l'un de ses sous-dossiers (casse ignorée, comme sur le disque de Windows). Un
 * sous-dossier dont le nom commence par deux points (`..x`) reste dedans ; seul `..` en tête de chemin en sort.
 */
function estSous(dedans: string, dossier: string): boolean {
  const relatif = path.relative(path.resolve(dossier).toLowerCase(), path.resolve(dedans).toLowerCase())
  if (relatif === '') return true
  const sort = relatif === '..' || relatif.startsWith(`..${path.sep}`) || relatif.startsWith('../')
  return !sort && !path.isAbsolute(relatif)
}

/** Vrai si l'un des deux dossiers est dans l'autre (ou si c'est le même). */
export function seRecouvrent(a: string, b: string): boolean {
  return estSous(a, b) || estSous(b, a)
}

/** Crée un dossier neuf de ce nom, ou suivi de « (2) », « (3) »… s'il existe déjà ; rend son chemin. */
async function dossierNeuf(parent: string, nom: string): Promise<string> {
  await mkdir(parent, { recursive: true })
  for (let rang = 1; rang < 100; rang++) {
    const chemin = path.join(parent, rang === 1 ? nom : `${nom} (${rang})`)
    try {
      await mkdir(chemin)
      return chemin
    } catch (e) {
      if ((e as { code?: string }).code !== 'EEXIST') throw e
    }
  }
  throw new ErreurDisque('UNKNOWN', `Trop de copies de sécurité du même nom dans « ${parent} ».`)
}

export type OptionsCopie = {
  /** Dossier mémoire de l'ordinateur, chemin absolu. */
  memoire: string
  /** Le téléphone, lu par son canal (son listage, puis chaque fichier). */
  telephone: DossierDistant
  /** Dossier qui reçoit les copies. */
  copies: string
  maintenant?: Date
}

/** Un fichier d'un dossier, par chemin relatif séparé par `/`, et ce qui n'est ni fichier ni dossier (lien…). */
type Inventaire = { fichiers: Map<string, number>; autres: string[] }

/** Tout ce que porte un dossier du disque, à toute profondeur, sans suivre un lien. */
async function inventaire(dossier: string, prefixe = '', vu: Inventaire = { fichiers: new Map(), autres: [] }): Promise<Inventaire> {
  for (const entree of await readdir(dossier, { withFileTypes: true })) {
    const chemin = prefixe + entree.name
    const s = await lstat(path.join(dossier, entree.name))
    if (s.isDirectory()) await inventaire(path.join(dossier, entree.name), `${chemin}/`, vu)
    else if (s.isFile()) vu.fichiers.set(chemin, s.size)
    else vu.autres.push(chemin)
  }
  return vu
}

/** « a, b, c et 4 autres » : de quoi nommer les fichiers en cause sans noyer le message. */
function nommer(chemins: readonly string[]): string {
  const montres = chemins.slice(0, 5).map((c) => `« ${c.slice(0, 120)} »`).join(', ')
  return chemins.length > 5 ? `${montres} et ${chemins.length - 5} autre${chemins.length - 5 > 1 ? 's' : ''}` : montres
}

/** Ce que la copie `copie` ne tient pas à la même taille que `attendu` (manquant, autre taille), et ce qu'elle a de trop. */
function ecarts(attendu: ReadonlyMap<string, number>, copie: ReadonlyMap<string, number>): string[] {
  const manquants = [...attendu].filter(([chemin, taille]) => copie.get(chemin) !== taille).map(([chemin]) => chemin)
  const deTrop = [...copie.keys()].filter((chemin) => !attendu.has(chemin))
  return [...manquants, ...deTrop]
}

/**
 * Fait la copie de sécurité des deux dossiers ENTIERS, à toute profondeur, provisoires compris, et rend le chemin de
 * son dossier. Elle ne se dit faite que si chaque fichier est copié : un fichier qui ne peut pas l'être (nom que Windows
 * refuse, lien, lecture ratée, taille différente) la fait échouer en le nommant, et la synchronisation n'a pas lieu. À
 * la fin, les deux copies sont relues, compte et tailles, contre les listages.
 */
export async function copieSecurite({ memoire, telephone, copies, maintenant = new Date() }: OptionsCopie): Promise<string> {
  if (seRecouvrent(copies, memoire)) {
    throw new ErreurDisque('UNKNOWN', 'Les copies de sécurité seraient rangées dans la mémoire : refusé.')
  }
  // Avant de créer quoi que ce soit : tout ce qui est à copier, de chaque côté, et ce qui ne se copierait pas.
  const ordinateur = await inventaire(memoire)
  if (ordinateur.autres.length > 0) {
    throw new ErreurDisque('UNKNOWN', `Copie de sécurité impossible : ${nommer(ordinateur.autres)} dans la mémoire de l'ordinateur ne ${ordinateur.autres.length > 1 ? 'sont' : 'est'} pas un fichier ordinaire.`)
  }
  const duTelephone = await telephone.listerTout()
  const refuses = duTelephone.filter((f) => !f.ordinaire || !f.chemin.split('/').every(segmentCopiable)).map((f) => f.chemin)
  if (refuses.length > 0) {
    throw new ErreurDisque('UNKNOWN', `Copie de sécurité impossible : ${nommer(refuses)} du téléphone ne ${refuses.length > 1 ? 'peuvent' : 'peut'} pas être copié${refuses.length > 1 ? 's' : ''} sur cet ordinateur.`)
  }
  const dossier = await dossierNeuf(copies, nomCopie(maintenant))
  try {
    const versOrdinateur = path.join(dossier, COPIE_ORDINATEUR)
    await cp(memoire, versOrdinateur, { recursive: true, preserveTimestamps: true, errorOnExist: true, force: false })
    const versTelephone = path.join(dossier, COPIE_TELEPHONE)
    await mkdir(versTelephone, { recursive: true })
    for (const fichier of duTelephone) {
      const local = path.join(versTelephone, ...fichier.chemin.split('/'))
      await mkdir(path.dirname(local), { recursive: true })
      try {
        await telephone.lireBrut(fichier, local)
      } catch (e) {
        throw new ErreurDisque('UNKNOWN', `Copie de sécurité impossible : « ${fichier.chemin} » du téléphone ne se lit pas (${e instanceof Error ? e.message : String(e)}).`)
      }
    }
    // Relue à la fin : chaque fichier listé est là, à la même taille, et rien d'autre.
    const manque = [
      ...ecarts(ordinateur.fichiers, (await inventaire(versOrdinateur)).fichiers).map((c) => `ordinateur/${c}`),
      ...ecarts(new Map(duTelephone.map((f) => [f.chemin, f.taille])), (await inventaire(versTelephone)).fichiers).map((c) => `téléphone/${c}`),
    ]
    if (manque.length > 0) throw new ErreurDisque('UNKNOWN', `Copie de sécurité incomplète : ${nommer(manque)}.`)
    return dossier
  } catch (e) {
    await rename(dossier, `${dossier} incomplète`).catch(() => undefined)
    if (e instanceof ErreurDisque) throw e
    throw new ErreurDisque(codeDe(e), `Copie de sécurité impossible : ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Vrai si `chemin` est une copie de sécurité encore là : un dossier sous `copies` (jamais ailleurs), qui porte ses deux
 * sous-dossiers `ordinateur` et `telephone` et n'est pas vide. Une copie dite « incomplète » n'en est pas une.
 */
export async function copieValable(chemin: string, copies: string): Promise<boolean> {
  if (chemin.length > 1000 || !path.isAbsolute(chemin) || /incomplète$/.test(chemin)) return false
  const relatif = path.relative(path.resolve(copies), path.resolve(chemin))
  if (relatif === '' || relatif.startsWith('..') || path.isAbsolute(relatif)) return false
  try {
    const noms = await readdir(chemin)
    return noms.includes(COPIE_ORDINATEUR) && noms.includes(COPIE_TELEPHONE) && (await fichiersDeCopie(chemin)) > 0
  } catch {
    return false
  }
}

/** Nombre de fichiers d'une copie (ses deux sous-dossiers), pour les tests et le compte rendu. */
export async function fichiersDeCopie(dossier: string): Promise<number> {
  let nombre = 0
  for (const entree of await readdir(dossier, { withFileTypes: true })) {
    nombre += entree.isDirectory() ? await fichiersDeCopie(path.join(dossier, entree.name)) : 1
  }
  return nombre
}
