// Le journal daté du programme : `journal.txt` dans le profil, une ligne horodatée par événement (liaisons du
// téléphone, états lus, étapes que la page y note), pour comprendre après coup une attente ou une coupure sur le poste
// de l'utilisateur, qui n'a ni console ni outil de développement.
//
// - Une ligne : `AAAA-MM-JJ HH:MM:SS.mmm message`, à l'heure locale ; retours à la ligne et caractères de contrôle
//   remplacés par des espaces, message borné (`LONGUEUR_LIGNE_MAX`).
// - Borné : quand une ligne ferait passer `journal.txt` au-delà de `TAILLE_JOURNAL_MAX`, il devient `journal.1.txt`
//   (l'ancien est remplacé) et un neuf commence ; le disque n'en garde jamais plus du double.
// - Écrit à la suite, de façon synchrone : l'ordre est celui des événements et une ligne écrite survit à un arrêt
//   brutal. Une écriture qui échoue est perdue sans rien casser : le journal ne doit jamais gêner le programme.
// - Rien de personnel n'y entre : ni contenu de fichier, ni nom (de session, de téléphone, de l'utilisateur), ni chemin,
//   ni adresse web, ni adresse réseau du poste ou d'un téléphone. Les modules de la coquille donnent ces détails à part, pour la seule sortie du mode d'essai
//   (`Journaliser`), et un filet les retire de ce qui en porterait encore, un message d'erreur du système par exemple
//   (`sansDonneesPersonnelles`). Les étapes de la page sont bornées (`LONGUEUR_NOTE_MAX`).

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'
import type { DossierDistant, EtatTelephone } from './telephone'

export const FICHIER_JOURNAL = 'journal.txt'
export const FICHIER_JOURNAL_ANCIEN = 'journal.1.txt'

/** Taille au-delà de laquelle le journal bascule sur `journal.1.txt` : 256 Kio, quelques milliers de lignes. */
export const TAILLE_JOURNAL_MAX = 256 * 1024

/** Longueur d'un message, en caractères, au-delà de laquelle il est coupé : une ligne reste lisible et petite. */
export const LONGUEUR_LIGNE_MAX = 1_000

/** Longueur d'une étape envoyée par la page (`coquille:noter`), en caractères. */
export const LONGUEUR_NOTE_MAX = 300

export type OptionsJournal = {
  /** Dossier du journal : le profil du programme. */
  dossier: string
  tailleMax?: number
  /** Heure de chaque ligne, en millisecondes depuis 1970. */
  horloge?: () => number
  /** Dossiers remplacés par « <dossier personnel> » dans chaque ligne : le dossier personnel de Windows. */
  masques?: readonly string[]
}

export type Journal = {
  /** Écrit une ligne datée ; ne lève jamais. */
  noter(message: string): void
}

const deux = (n: number) => String(n).padStart(2, '0')

/** L'horodatage d'une ligne, à l'heure locale : `2026-11-22 14:03:07.042`. */
export function horodatage(ms: number): string {
  const d = new Date(ms)
  const date = `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`
  return `${date} ${deux(d.getHours())}:${deux(d.getMinutes())}:${deux(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

/** Le message sur une seule ligne, sans caractère de contrôle, coupé à `longueurMax` caractères. */
export function surUneLigne(message: string, longueurMax = LONGUEUR_LIGNE_MAX): string {
  // Caractères de contrôle (retours à la ligne, tabulations…) et séparateurs de ligne ou de paragraphe d'Unicode.
  const aplati = message.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').trim()
  const lettres = [...aplati]
  return lettres.length > longueurMax ? `${lettres.slice(0, longueurMax - 1).join('')}…` : aplati
}

/** Un nombre de 0 à 255, partie d'une adresse IPv4. */
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'

/** Une adresse IPv4 isolée : quatre nombres, ni collés à un mot ni pris dans un numéro de version plus long. */
const ADRESSE_IPV4 = new RegExp(`(?<![\\w.])${OCTET}(?:\\.${OCTET}){3}(?!\\w|\\.\\d)`, 'g')

/**
 * Le message sans ce qui dirait qui est l'utilisateur ou ce qu'il range : chaque dossier de `masques` (le dossier
 * personnel de Windows, où est son nom), toute adresse web, tout chemin de Windows (entre guillemets en entier, sinon
 * jusqu'au premier blanc), tout chemin du stockage d'Android et toute adresse IPv4 (celle du poste ou d'un téléphone ;
 * le port qui la suit reste). Filet de sûreté pour les messages d'erreur du système ;
 * les appelants ne mettent déjà au journal ni nom ni chemin (`Journaliser`).
 */
export function sansDonneesPersonnelles(message: string, masques: readonly string[] = []): string {
  let texte = message
  for (const masque of masques) {
    const brut = masque.replace(/[\\/]+$/, '')
    if (brut.length < 3) continue
    for (const forme of new Set([brut, brut.replace(/\\/g, '/'), brut.replace(/\//g, '\\')])) {
      texte = texte.replace(new RegExp(forme.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '<dossier personnel>')
    }
  }
  return texte
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"«»]+/gi, '<adresse>')
    .replace(/(['"])(?:[A-Za-z]:[\\/]|\\\\)[^'"]*\1/g, '<chemin>')
    .replace(/(?:\b[A-Za-z]:[\\/]|\\\\)[^\s'"«»,;()]*/g, '<chemin>')
    .replace(/(?<![\w.])\/(?:sdcard|storage|data|mnt)\/[^\s'"«»,;()]*/g, '<chemin>')
    .replace(ADRESSE_IPV4, '<adresse IP>')
}

/** La ligne complète, retour à la ligne compris, sans donnée personnelle (`sansDonneesPersonnelles`). */
export function ligneDuJournal(ms: number, message: string, masques: readonly string[] = []): string {
  return `${horodatage(ms)} ${surUneLigne(sansDonneesPersonnelles(message, masques))}\n`
}

/**
 * Ce que reçoivent les modules de la coquille pour journaliser : `message` va au journal daté et ne porte ni nom, ni
 * chemin, ni adresse web ; `texteEssai`, la même ligne avec ses détails (chemin choisi, nom du téléphone, lien), ne
 * va que sur la sortie du mode d'essai, que le banc lit, et remplace alors `message`.
 */
export type Journaliser = (message: string, texteEssai?: string) => void

/** Le `Journaliser` du programme : `message` au journal daté, `texteEssai ?? message` sur `sortie` (mode d'essai seulement). */
export function journaliseur(fichier: Journal, sortie: ((ligne: string) => void) | null): Journaliser {
  return (message, texteEssai) => {
    sortie?.(texteEssai ?? message)
    fichier.noter(message)
  }
}

/**
 * Le texte d'une étape envoyée par la page (`{ texte }`), mis sur une ligne et borné ; `null` pour un message mal formé
 * ou vide.
 */
export function lireNote(argument: unknown): string | null {
  if (typeof argument !== 'object' || argument === null || Array.isArray(argument)) return null
  const texte = (argument as Record<string, unknown>).texte
  if (typeof texte !== 'string') return null
  const ligne = surUneLigne(texte, LONGUEUR_NOTE_MAX)
  return ligne === '' ? null : ligne
}

/**
 * L'état du téléphone en quelques mots, sans son nom : `prêt (écriture)`, `prêt (lecture seule)`, `prêt`, `absent`,
 * `horsLigne`…
 */
export function resumeEtat(e: EtatTelephone): string {
  if (e.etat !== 'pret') return e.etat
  if (e.ecriture === undefined) return 'prêt'
  return e.ecriture ? 'prêt (écriture)' : 'prêt (lecture seule)'
}

/**
 * Le même dossier, dont chaque lecture de l'état qui change (ou qui échoue après avoir réussi) est notée : la page relit
 * l'état souvent, le journal n'en garde que les changements.
 */
export function suivreEtats(dossier: DossierDistant, noter: (message: string) => void): DossierDistant {
  let dernier: string | null = null
  const changer = (resume: string) => {
    if (resume === dernier) return
    dernier = resume
    noter(`état du téléphone : ${resume}`)
  }
  return {
    ...dossier,
    async etat() {
      try {
        const e = await dossier.etat()
        changer(resumeEtat(e))
        return e
      } catch (erreur) {
        changer(`illisible (${erreur instanceof Error ? erreur.message : String(erreur)})`)
        throw erreur
      }
    },
  }
}

/** Le journal du dossier donné ; le dossier est créé à la première ligne. */
export function creerJournal(options: OptionsJournal): Journal {
  const fichier = path.join(options.dossier, FICHIER_JOURNAL)
  const ancien = path.join(options.dossier, FICHIER_JOURNAL_ANCIEN)
  const tailleMax = options.tailleMax ?? TAILLE_JOURNAL_MAX
  const horloge = options.horloge ?? Date.now
  /** Taille connue du fichier, relue au premier message ; `null` tant qu'elle n'a pas été lue. */
  let taille: number | null = null

  function tailleActuelle(): number {
    if (taille === null) {
      try {
        taille = statSync(fichier).size
      } catch {
        taille = 0
      }
    }
    return taille
  }

  return {
    noter(message) {
      try {
        const ligne = ligneDuJournal(horloge(), message, options.masques)
        const octets = Buffer.byteLength(ligne, 'utf8')
        if (tailleActuelle() > 0 && tailleActuelle() + octets > tailleMax) {
          renameSync(fichier, ancien)
          taille = 0
        }
        mkdirSync(options.dossier, { recursive: true })
        appendFileSync(fichier, ligne, 'utf8')
        taille = tailleActuelle() + octets
      } catch {
        // Le fichier sera relu au prochain message : un journal déplacé ou effacé à la main reprend juste.
        taille = null
      }
    },
  }
}
