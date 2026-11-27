// Le dossier du téléphone par le débogage USB : `adb.exe`, l'outil de Google, cherché sur le poste (il n'est pas livré
// avec le programme), lancé par un tableau d'arguments (`execFile`, sans shell de Windows ni chaîne de commande). Sans
// Electron.
//
// Commandes lancées, et elles seules (liste fermée, un test relit ce fichier pour la garantir) :
// - `version`, `start-server`, `devices -l` ;
// - `pull -a` d'un fichier du dernier listage, `push` d'un fichier du PC vers `nom.tracker-new` sous la racine (chemins
//   passés en arguments, par le protocole de copie d'adb, sans shell) ;
// - `shell` avec un texte que seul `texteShell` fabrique, d'après une `CommandeShell` dont chaque chemin est vérifié :
//   les textes fixes du listage, `dumpsys activity services <paquet>`, `stat -c` d'un fichier ou de dossiers,
//   `mv -f nom.tracker-new nom` sous la racine, `mv` d'un fichier de `sessions/` ou d'`itineraires/` vers un dépôt de
//   la corbeille de la racine (`corbeille/<dossier>/`, qui tient déjà `depose.json`), le listage des sous-dossiers de
//   cette corbeille, le listage entier de la racine pour la copie de sécurité (`listageTout`, lecture seule, lu par
//   `pull` fichier par fichier), et `rm -f` d'un seul `nom.tracker-new` sous la racine, le provisoire d'un envoi raté,
//   jamais un fichier de l'utilisateur. Rien n'est écrit hors de la racine.
// Les sorties d'`adb shell` sont lues en UTF-8 (`lanceurReel`), comme le téléphone les écrit : un nom accentué se
// relit tel quel.
// Le shell du téléphone recolle la commande : chaque nom y passe entre apostrophes (`citerShell`). Jamais
// `kill-server`, jamais `rm` d'un autre nom, jamais `-r`.
//
// Écriture d'un fichier : relue l'activité de l'application (aucun service de premier plan, `lireServices`), `push`
// vers `nom.tracker-new`, taille relue par `stat`, puis `mv -f` sur le nom. Sur un échec, le provisoire est retiré et
// le fichier d'arrivée n'a pas été touché. Retrait : `mv` vers un dépôt de la corbeille du téléphone, après relecture
// du fichier (taille et date du listage), du dépôt (sa fiche `depose.json` présente) et de la place visée (libre),
// puis relecture des deux.
//
// Liaison tenue par un autre : un seul serveur adb tient le téléphone. Un client d'une autre version que le serveur en
// place l'arrête pour lancer le sien, ce qui couperait l'outil de l'utilisateur (Android Studio, scrcpy, la coquille de
// Gtracker). Avant toute commande qui parle au serveur, et par un seul passage (`parLeServeur`), une sonde lui demande
// sa version (`host:version`, au serveur que désigne l'environnement comme adb le lit : `cibleServeur`) et la compare à
// celle de notre `adb version` (qui ne le touche pas) : pas de serveur, on lance le nôtre (`start-server`) ; même
// version, on s'y joint ; autre version, réponse étrangère ou serveur que la sonde ne sait pas viser, état `occupe` et
// aucune commande. Le serveur d'un autre n'est jamais arrêté.
//
// Plusieurs appareils branchés (ou un émulateur ouvert) : état `plusieurs`, refusé. Les commandes visent la série du
// téléphone prêt (`-s`) ; une lecture, une écriture ou un retrait celle du dernier listage seulement, et une écriture
// ou un retrait revoit d'abord la liste des appareils : un seul, le même, sinon refus.
//
// Chaque commande a son délai maximal ; les commandes passent l'une après l'autre (la file est celle des gestionnaires
// de `telephone.ts`).

import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { connect } from 'node:net'
import path from 'node:path'
import { ErreurDisque, SUFFIXE_NEUF, SUFFIXE_REMPLACEMENT, segmentAdmis } from './disque'
import type { DossierDistant, EtatTelephone, FichierBrut, FichierTelephone, FichierVu } from './telephone'
import {
  DEPOT_TELEPHONE,
  FICHIER_DEPOT,
  NOM_RACINE,
  PAQUET_APPLICATION,
  RACINE_ESSAI,
  SERVICES_APPLICATION,
  changeDepuisListage,
  cheminEcrivable,
  cheminRefuse,
  cheminRetirable,
  commeLeTelephone,
  corbeillePrise,
  depotSansFiche,
  destinationCorbeilleAdmise,
  dossierDepotAdmis,
  enregistrementEnCours,
  ficheDepot,
  fichiersAdmis,
  nomProvisoire,
  pasListe,
  pasPret,
  racineAbsente,
  sansReel,
} from './telephone'

/** Dossier sous lequel vit la mémoire du téléphone. */
const DOCUMENTS = '/sdcard/Documents'

/** Dossier du téléphone lu par défaut, dans sa mémoire partagée. */
export const RACINE_DISTANTE = `${DOCUMENTS}/${NOM_RACINE}`

/** Chemin du dossier lu sur le téléphone : `Documents/Tracker`, ou une racine d'essai (`RACINE_ESSAI`) ; tout autre nom lève. */
export function racineDistante(nomRacine: string = NOM_RACINE): string {
  if (nomRacine !== NOM_RACINE && !RACINE_ESSAI.test(nomRacine)) throw new ErreurDisque('UNKNOWN', `Racine du téléphone refusée : ${nomRacine.slice(0, 60)}`)
  return `${DOCUMENTS}/${nomRacine}`
}

/** Le seul lieu où une commande peut écrire : la racine lue (sa corbeille comprise, `corbeille/`), chemin absolu. */
export type LieuxDistants = { racine: string }

/** Racine d'un nom de racine admis (`racineDistante`). */
export function lieuxDistants(nomRacine: string = NOM_RACINE): LieuxDistants {
  return { racine: racineDistante(nomRacine) }
}

/** Sous-dossier où l'utilisateur peut poser l'outil, dans le profil du programme ou à côté de `Tracker.exe`. */
export const DOSSIER_OUTILS = 'platform-tools'

/** Nom de l'outil sur Windows. */
const ADB = 'adb.exe'

/** Port du serveur adb quand `ANDROID_ADB_SERVER_PORT` ne le change pas. */
export const PORT_SERVEUR = 5037

/** Délais maximaux, en millisecondes. */
export const DELAIS = Object.freeze({
  /** `adb version`, `adb devices -l`. */
  court: 5_000,
  /** `adb start-server` : le serveur prend quelques secondes à démarrer. */
  demarrage: 15_000,
  /** Le listage du dossier, en une commande. */
  listage: 20_000,
  /** Une lecture : cette base, plus `parMo` par mégaoctet. */
  lecture: 20_000,
  parMo: 1_000,
  /** La sonde du serveur. */
  sonde: 1_000,
  /**
   * Durée pendant laquelle une écriture se fie à la dernière lecture de l'activité de l'application (« aucun service en
   * cours ») au lieu d'en refaire une : `dumpsys` coûte un aller-retour au téléphone par fichier. Une mise de côté la
   * relit toujours. Un enregistrement commencé pendant ce temps n'écrit rien dans la mémoire avant son arrêt.
   */
  activite: 3_000,
})

/** Taille maximale de ce qu'une commande peut écrire sur sa sortie (un listage de quelques milliers de fichiers). */
const SORTIE_MAX = 16 * 1024 * 1024

/** Les trois textes fixes du listage d'une racine. */
export type CommandesListage = { listage: string; racine: string; repli: string }

/**
 * Textes du listage, fixes pour une racine (le nom de la racine est borné par `racineDistante`, sans espace ni
 * caractère que le shell du téléphone interpréterait) :
 * - `listage` : les fichiers de la racine et de ses sous-dossiers, chacun en « mode-en-hexadécimal taille
 *   date-en-secondes chemin », en une commande ;
 * - `racine` : repli si `find … -exec … +` manque sur le téléphone, le dossier existe-t-il ?
 * - `repli` : `stat` sur les fichiers de la racine et des sous-dossiers listés (le mode écarte les dossiers).
 */
export function commandesListage(racine: string = RACINE_DISTANTE): CommandesListage {
  return {
    listage: `find ${racine} -maxdepth 2 -type f -exec stat -c '%f %s %Y %n' {} +`,
    racine: `stat -c '%f' ${racine}`,
    repli: `stat -c '%f %s %Y %n' ${racine}/* ${['sessions', 'itineraires', 'reglages', 'journaux'].map((d) => `${racine}/${d}/*`).join(' ')}`,
  }
}

const PAR_DEFAUT = commandesListage()
export const COMMANDE_LISTAGE = PAR_DEFAUT.listage
export const COMMANDE_RACINE = PAR_DEFAUT.racine
export const COMMANDE_LISTAGE_REPLI = PAR_DEFAUT.repli

/** Ce que l'application du téléphone fait tourner : ses services, filtrés sur son paquet. */
export const COMMANDE_SERVICES = `dumpsys activity services ${PAQUET_APPLICATION}`

/**
 * Un texte cité pour le shell du téléphone (`adb shell` recolle ses arguments en une seule ligne de commande) : entre
 * apostrophes, où rien n'est interprété (espaces, `$`, accent grave, `;`, `\`, retour à la ligne), chaque apostrophe
 * fermant la citation, échappée, puis la rouvrant (`'\''`). Un caractère nul est refusé : il couperait la commande.
 */
export function citerShell(texte: string): string {
  if (texte.includes('\0')) throw new ErreurDisque('UNKNOWN', 'Nom refusé pour le téléphone : caractère nul.')
  return `'${texte.replace(/'/g, `'\\''`)}'`
}

/**
 * Les seules commandes `shell` envoyées au téléphone ; `texteShell` en fait le texte après avoir vérifié chaque
 * chemin (absolu, sur le téléphone) :
 * - `listage`, `racine`, `repli` : les textes fixes du listage de la racine (`commandesListage`) ;
 * - `services` : `dumpsys activity services <paquet>` ;
 * - `stat` : mode, taille et date d'un fichier de la racine (écrivable ou retirable, ou d'un dépôt de la corbeille,
 *   provisoires compris) ;
 * - `statDossiers` : mode de la corbeille de la racine ou d'un de ses dépôts ;
 * - `renommer` : `mv -f nom.tracker-new nom`, `nom` écrivable sous la racine ;
 * - `deplacer` : `mv` d'un fichier retirable de la racine (ou de son `.tracker-tmp`) vers un dépôt de la corbeille,
 *   même nom, même suffixe ;
 * - `listageCorbeille`, `repliCorbeille` : ce que tient la corbeille de la racine, à son premier niveau ;
 * - `effacerProvisoire` : `rm -f` d'un seul `nom.tracker-new`, `nom` écrivable sous la racine.
 */
export type CommandeShell =
  | { sorte: 'listage' | 'racine' | 'repli' | 'services' | 'listageTout' | 'listageCorbeille' | 'repliCorbeille' }
  | { sorte: 'stat'; chemin: string }
  | { sorte: 'statDossiers'; chemins: readonly string[] }
  | { sorte: 'renommer'; de: string; vers: string }
  | { sorte: 'deplacer'; de: string; vers: string }
  | { sorte: 'effacerProvisoire'; chemin: string }

/** Le chemin relatif à `dossier` d'un chemin absolu du téléphone, `null` s'il n'est pas dessous. */
function sous(chemin: string, dossier: string): string | null {
  return chemin.startsWith(`${dossier}/`) ? chemin.slice(dossier.length + 1) : null
}

/** `nom` sans le suffixe `suffixe`, et s'il le portait. */
function sansSuffixe(nom: string, suffixe: string): { base: string; avec: boolean } {
  return nom.endsWith(suffixe) && nom.length > suffixe.length ? { base: nom.slice(0, -suffixe.length), avec: true } : { base: nom, avec: false }
}

/** Un fichier d'un dépôt de la corbeille, relatif à la racine (`corbeille/<dossier>/<nom>`, `.tracker-tmp` admis). */
function relatifDepotAdmis(relatif: string): { base: string; avec: boolean } | null {
  const segments = relatif.split('/')
  if (segments.length !== 3 || segments[0] !== DEPOT_TELEPHONE || !dossierDepotAdmis(segments[1])) return null
  const { base, avec } = sansSuffixe(segments[2], SUFFIXE_REMPLACEMENT)
  return segmentAdmis(base) ? { base: `${segments[0]}/${segments[1]}/${base}`, avec } : null
}

/** Le relatif d'un fichier de la racine admis pour `stat` : écrivable, retirable ou d'un dépôt, avec ou sans suffixe provisoire. */
function relatifRacineAdmis(relatif: string): boolean {
  const neuf = sansSuffixe(relatif, SUFFIXE_NEUF)
  const base = neuf.avec ? neuf.base : sansSuffixe(relatif, SUFFIXE_REMPLACEMENT).base
  return cheminEcrivable(base) || cheminRetirable(base) || relatifDepotAdmis(relatif) !== null
}

/** Un dossier de la corbeille admis : elle-même (`<racine>/corbeille`), ou un de ses dépôts. */
function dossierCorbeilleOuDepot(chemin: string, racine: string): boolean {
  const relatif = sous(chemin, racine)
  if (relatif === null) return false
  const [corbeille, depot, ...reste] = relatif.split('/')
  return corbeille === DEPOT_TELEPHONE && reste.length === 0 && (depot === undefined || dossierDepotAdmis(depot))
}

/**
 * Le texte d'une commande `shell`, seul passage des commandes au téléphone : chaque chemin est vérifié contre les
 * lieux (`racine`, `corbeille`) et les listes fermées de `telephone.ts`, puis cité. Lève `PERMISSION` sur tout chemin
 * hors liste, sans rien lancer.
 */
export function texteShell(commande: CommandeShell, lieux: LieuxDistants): string {
  const { racine } = lieux
  const corbeille = `${racine}/${DEPOT_TELEPHONE}`
  const refus = (detail: string) => cheminRefuse(detail)
  switch (commande.sorte) {
    case 'listage':
    case 'racine':
    case 'repli':
      return commandesListage(racine)[commande.sorte]
    case 'services':
      return COMMANDE_SERVICES
    case 'listageTout':
      return `find ${racine} ! -type d -exec stat -c '%f %s %Y %n' {} +`
    case 'stat': {
      const dansRacine = sous(commande.chemin, racine)
      if (dansRacine === null || !relatifRacineAdmis(dansRacine)) throw refus(commande.chemin)
      return `stat -c '%f %s %Y' ${citerShell(commande.chemin)}`
    }
    case 'statDossiers': {
      if (commande.chemins.length === 0 || commande.chemins.some((c) => !dossierCorbeilleOuDepot(c, racine))) throw refus(commande.chemins.join(' '))
      return `stat -c '%f %n' ${commande.chemins.map(citerShell).join(' ')}`
    }
    case 'renommer': {
      const vers = sous(commande.vers, racine)
      if (vers === null || !cheminEcrivable(vers) || commande.de !== nomProvisoire(commande.vers)) throw refus(`${commande.de} → ${commande.vers}`)
      return `mv -f ${citerShell(commande.de)} ${citerShell(commande.vers)}`
    }
    case 'deplacer': {
      const de = sous(commande.de, racine)
      const vers = sous(commande.vers, racine)
      const source = de === null ? null : sansSuffixe(de, SUFFIXE_REMPLACEMENT)
      const destination = vers === null ? null : relatifDepotAdmis(vers)
      if (source === null || destination === null || !destinationCorbeilleAdmise(source.base, destination.base)) {
        throw refus(`${commande.de} → ${commande.vers}`)
      }
      // Un remplacement interrompu caché ne part que sous un nom qui le reste ; l'original, sous un nom ordinaire, ou
      // le `.tracker-tmp` que le téléphone montre sous le nom de l'original, sous ce nom.
      if (destination.avec && !source.avec) throw refus(`${commande.de} → ${commande.vers}`)
      return `mv ${citerShell(commande.de)} ${citerShell(commande.vers)}`
    }
    case 'listageCorbeille':
      return `find ${corbeille} -maxdepth 1 -exec stat -c '%f %s %Y %n' {} +`
    case 'repliCorbeille':
      return `stat -c '%f %s %Y %n' ${corbeille}/*`
    case 'effacerProvisoire': {
      const relatif = sous(commande.chemin, racine)
      const nom = relatif === null ? null : sansSuffixe(relatif, SUFFIXE_NEUF)
      if (nom === null || !nom.avec || !cheminEcrivable(nom.base)) throw refus(commande.chemin)
      return `rm -f ${citerShell(commande.chemin)}`
    }
  }
}

/**
 * Valeur d'une variable d'environnement, sans égard à la casse de son nom (comme Windows), espaces retirés ;
 * `undefined` si vide. L'environnement passé peut être une copie en objet simple, sensible à la casse.
 */
export function variable(env: Record<string, string | undefined>, nom: string): string | undefined {
  const cle = Object.keys(env).find((k) => k.toLowerCase() === nom.toLowerCase())
  const v = cle === undefined ? undefined : env[cle]?.trim()
  return v ? v : undefined
}

// ---------- lecture des sorties d'adb (calcul pur) ----------

/** Un appareil lu dans `adb devices -l`. */
export type Appareil = { serie: string; etat: string; modele: string | null }

/** Appareils de la sortie de `adb devices -l`, sans l'en-tête ni les lignes du démarrage du serveur. */
export function lireAppareils(sortie: string): Appareil[] {
  const appareils: Appareil[] = []
  for (const brute of sortie.split('\n')) {
    const ligne = brute.trim()
    if (ligne === '' || ligne.startsWith('*') || ligne.startsWith('List of devices')) continue
    const morceaux = ligne.split(/\s+/)
    if (morceaux.length < 2) continue
    const [serie, etat] = morceaux
    const modele = morceaux.find((m) => m.startsWith('model:'))?.slice('model:'.length) ?? null
    appareils.push({ serie, etat, modele: modele ? modele.replace(/_/g, ' ') : null })
  }
  return appareils
}

/**
 * État d'après les appareils : plusieurs appareils, refusés ; sinon le seul, prêt, à autoriser ou hors ligne ; sinon
 * absent.
 */
export function etatDesAppareils(appareils: Appareil[]): { etat: EtatTelephone; serie: string | null } {
  if (appareils.length > 1) return { etat: { etat: 'plusieurs', nombre: appareils.length }, serie: null }
  const seul = appareils[0]
  if (seul?.etat === 'device') return { etat: { etat: 'pret', nom: seul.modele ?? seul.serie }, serie: seul.serie }
  if (seul?.etat === 'unauthorized') return { etat: { etat: 'autorisation' }, serie: null }
  if (seul?.etat === 'offline') return { etat: { etat: 'horsLigne' }, serie: null }
  return { etat: { etat: 'absent' }, serie: null }
}

/**
 * Version du serveur que porte notre outil, lue dans `adb version` (« Android Debug Bridge version 1.0.41 » : 41) ;
 * c'est le nombre que le serveur rend à `host:version`. `null` si la sortie n'est pas celle d'adb.
 */
export function lireVersionAdb(sortie: string): number | null {
  const m = /Android Debug Bridge version \d+\.\d+\.(\d+)/.exec(sortie)
  return m ? Number(m[1]) : null
}

/**
 * Réponse du serveur à `host:version` : `OKAY`, la longueur en 4 chiffres hexadécimaux, puis la version en
 * hexadécimal (`OKAY0004001f` : 31). `incomplet` tant que la réponse peut encore être la bonne ; `etranger` sinon.
 */
export function lireReponseVersion(recu: string): { etat: 'version'; version: number } | { etat: 'incomplet' } | { etat: 'etranger' } {
  const attendu = 'OKAY'
  if (!attendu.startsWith(recu.slice(0, 4)) || (recu.length >= 4 && recu.slice(0, 4) !== attendu)) return { etat: 'etranger' }
  if (recu.length < 8) return /^[0-9a-fA-F]*$/.test(recu.slice(4)) ? { etat: 'incomplet' } : { etat: 'etranger' }
  const longueurHex = recu.slice(4, 8)
  if (!/^[0-9a-fA-F]{4}$/.test(longueurHex)) return { etat: 'etranger' }
  const longueur = parseInt(longueurHex, 16)
  if (longueur < 1 || longueur > 8) return { etat: 'etranger' }
  const valeur = recu.slice(8, 8 + longueur)
  if (!/^[0-9a-fA-F]*$/.test(valeur)) return { etat: 'etranger' }
  if (valeur.length < longueur) return { etat: 'incomplet' }
  if (recu.length > 8 + longueur) return { etat: 'etranger' }
  return { etat: 'version', version: parseInt(valeur, 16) }
}

/** Mode d'un fichier ordinaire (`S_IFREG`), lu dans le mode en hexadécimal de `stat -c %f`. */
const MODE_FICHIER = 0x8000
const MODE_DOSSIER = 0x4000
const MASQUE_TYPE = 0xf000

/**
 * Fichiers d'un listage `stat -c '%f %s %Y %n'`, tels que le téléphone les voit (`commeLeTelephone`), avec leur nom
 * réel : préfixe `racine/` retiré, fichiers ordinaires de la racine et de `sessions/` seulement, chemins refusés écartés
 * (`fichiersAdmis`). Une ligne illisible est sautée.
 */
export function lireListageVu(sortie: string, racine = RACINE_DISTANTE): FichierVu[] {
  const prefixe = `${racine}/`
  const fichiers: FichierTelephone[] = []
  for (const brute of sortie.split('\n')) {
    const ligne = brute.endsWith('\r') ? brute.slice(0, -1) : brute
    const m = /^([0-9a-fA-F]+) (\d+) (\d+) (.+)$/.exec(ligne)
    if (!m) continue
    if ((parseInt(m[1], 16) & MASQUE_TYPE) !== MODE_FICHIER) continue
    const complet = m[4]
    if (!complet.startsWith(prefixe)) continue
    fichiers.push({ chemin: complet.slice(prefixe.length), taille: Number(m[2]), dateMs: Number(m[3]) * 1000 })
  }
  return fichiersAdmis(commeLeTelephone(fichiers))
}

/** Fichiers d'un listage, tels que la page les reçoit (`lireListageVu` sans les noms réels). */
export function lireListage(sortie: string, racine = RACINE_DISTANTE): FichierTelephone[] {
  return lireListageVu(sortie, racine).map(sansReel)
}

/** Mode, taille et date d'un fichier, lus dans la sortie d'un `stat` (`texteShell`) ; `null` si elle n'en porte pas. */
export function lireStat(sortie: string): { mode: number; taille: number; dateMs: number } | null {
  const m = /^([0-9a-fA-F]+) (\d+) (\d+)\r?$/m.exec(sortie)
  return m ? { mode: parseInt(m[1], 16), taille: Number(m[2]), dateMs: Number(m[3]) * 1000 } : null
}

/** Mode de chaque chemin lu dans la sortie d'un `statDossiers` (« mode chemin » par ligne) ; les absents n'y sont pas. */
export function lireModes(sortie: string): Map<string, number> {
  const modes = new Map<string, number>()
  for (const brute of sortie.split('\n')) {
    const m = /^([0-9a-fA-F]+) (.+?)\r?$/.exec(brute)
    if (m) modes.set(m[2], parseInt(m[1], 16))
  }
  return modes
}

/** Vrai si le mode lu par `stat -c %f` est celui d'un fichier ordinaire (pas un lien, pas un dossier). */
export function estFichierOrdinaire(mode: number): boolean {
  return (mode & MASQUE_TYPE) === MODE_FICHIER
}

/** Vrai si le mode lu par `stat -c %f` est celui d'un dossier (pas un lien). */
export function estDossier(mode: number): boolean {
  return (mode & MASQUE_TYPE) === MODE_DOSSIER
}

/**
 * Vrai si une commande muette en cas de réussite (`mv`, `mkdir`, `rm -f`) a échoué : code non nul, ou message
 * d'erreur (un téléphone ancien rend toujours 0 à `adb shell`).
 */
export function echecDuShell(sortie: { code: number; stderr: string; stdout: string }): boolean {
  return sortie.code !== 0 || sortie.stderr.trim() !== '' || sortie.stdout.trim() !== ''
}

/** Ce que l'application du téléphone fait tourner, lu dans `dumpsys activity services <paquet>`. */
export type ActiviteApplication =
  /** Aucun de ses services : on peut écrire. */
  | { etat: 'libre' }
  /** Un service de premier plan, ou l'un de ses services connus (`SERVICES_APPLICATION`) : rien n'est écrit. */
  | { etat: 'occupee'; services: string[] }
  /** Une sortie qu'on ne sait pas lire : rien n'est écrit non plus. */
  | { etat: 'illisible' }

/**
 * Lit la sortie de `dumpsys activity services <paquet>` (`COMMANDE_SERVICES`). Sans l'en-tête « ACTIVITY MANAGER
 * SERVICES », illisible. Chaque `ServiceRecord{… u0 <paquet>/<classe> …}` du paquet est un bloc, jusqu'au suivant :
 * l'application est occupée si l'un d'eux est l'un de ses services connus (`SERVICES_APPLICATION`, au premier plan ou
 * non), ou porte `isForeground=true`. Prudente : dans le doute, on n'écrit pas.
 */
export function lireServices(sortie: string, paquet: string = PAQUET_APPLICATION): ActiviteApplication {
  if (!/ACTIVITY MANAGER SERVICES/.test(sortie)) return { etat: 'illisible' }
  const services: string[] = []
  let courant: { classe: string; connu: boolean } | null = null
  let premierPlan = false
  const clore = () => {
    if (courant && (courant.connu || premierPlan) && !services.includes(courant.classe)) services.push(courant.classe)
    courant = null
    premierPlan = false
  }
  for (const ligne of sortie.split('\n')) {
    const m = /ServiceRecord\{\S+ u\d+ ([\w.]+)\/([\w.$]+)/.exec(ligne)
    if (m) {
      clore()
      if (m[1] !== paquet) continue
      const classe = m[2].startsWith('.') ? `${paquet}${m[2]}` : m[2]
      const court = classe.slice(classe.lastIndexOf('.') + 1)
      courant = { classe: court, connu: (SERVICES_APPLICATION as readonly string[]).includes(court) }
      continue
    }
    if (courant && /\bisForeground=true\b/.test(ligne)) premierPlan = true
  }
  clore()
  return services.length > 0 ? { etat: 'occupee', services } : { etat: 'libre' }
}

/**
 * Vrai si la sortie dit que la commande de listage n'est pas connue du téléphone (`find` sans `-exec … +`) : seul cas
 * où l'on se replie sur `stat`. Toute autre erreur d'un listage est une erreur.
 */
function commandeInconnue(texte: string): boolean {
  return /\b(unknown|unrecognized|invalid|bad) (option|argument|primary|predicate)|missing argument|: not found\b|inaccessible or not found/i.test(texte)
}

/**
 * Vrai si un repli `stat` (motifs `dossier/*`) n'a échoué que sur ses motifs sans fichier : chaque ligne qui n'est
 * pas une ligne de `stat` dit « No such file or directory » d'un motif en `/*`. Une autre erreur (accès refusé, sortie
 * coupée) le rend incomplet.
 */
function repliComplet(sortie: { code: number; stdout: string; stderr: string; delaiDepasse: boolean }): boolean {
  if (sortie.delaiDepasse) return false
  if (sortie.code === 0) return true
  return `${sortie.stderr}\n${sortie.stdout}`.split('\n').every((brute) => {
    const ligne = brute.replace(/\r$/, '')
    return ligne.trim() === '' || /^[0-9a-fA-F]+ \d+ \d+ .+$/.test(ligne) || (/No such file or directory/i.test(ligne) && /\/\*/.test(ligne))
  })
}

/** Erreur d'un listage qui n'a pas été complet : rien ne se décide sur lui. */
function listageIncomplet(texte: string): ErreurDisque {
  return new ErreurDisque('UNKNOWN', `Listage du téléphone incomplet : ${texte.trim().slice(0, 300) || 'erreur sans message'}`)
}

/** Vrai si la sortie dit qu'un chemin n'existe pas sur le téléphone. */
function dossierManquant(texte: string): boolean {
  return /No such file or directory/i.test(texte)
}

/** Première ligne d'erreur d'adb lui-même (appareil perdu, serveur injoignable), `null` s'il n'y en a pas. */
function erreurAdb(texte: string): string | null {
  return /^(adb: )?error: .*$/m.exec(texte)?.[0] ?? null
}

// ---------- recherche de l'outil ----------

/**
 * Dossier où l'utilisateur peut copier le dossier `platform-tools` de l'outil s'il n'est pas sur le poste : le profil
 * du programme (l'outil y est alors cherché dans `platform-tools`).
 */
export function dossierAdbConseille(profil: string): string {
  return path.win32.resolve(profil)
}

/**
 * Chemins où chercher `adb.exe`, dans l'ordre : chaque dossier du PATH, `ANDROID_HOME` et `ANDROID_SDK_ROOT`
 * (`platform-tools`), le SDK d'Android Studio (`%LOCALAPPDATA%\Android\Sdk\platform-tools`), puis `platform-tools`
 * dans le profil du programme et à côté de `Tracker.exe`.
 */
export function cheminsAdb(env: Record<string, string | undefined>, dossiers: { profil: string; programme: string }): string[] {
  const p = path.win32
  const chemins: string[] = []
  for (const brut of (variable(env, 'PATH') ?? '').split(';')) {
    const dossier = brut.trim().replace(/^"(.*)"$/, '$1')
    if (dossier !== '' && p.isAbsolute(dossier)) chemins.push(p.join(dossier, ADB))
  }
  for (const nom of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    const sdk = variable(env, nom)
    if (sdk && p.isAbsolute(sdk)) chemins.push(p.join(sdk, DOSSIER_OUTILS, ADB))
  }
  const local = variable(env, 'LOCALAPPDATA')
  if (local && p.isAbsolute(local)) chemins.push(p.join(local, 'Android', 'Sdk', DOSSIER_OUTILS, ADB))
  chemins.push(p.join(dossiers.profil, DOSSIER_OUTILS, ADB))
  chemins.push(p.join(dossiers.programme, DOSSIER_OUTILS, ADB))
  return chemins
}

/** Premier `adb.exe` trouvé, `null` s'il n'y en a aucun. */
export function chercherAdb(
  env: Record<string, string | undefined>,
  dossiers: { profil: string; programme: string },
  existe: (fichier: string) => boolean,
): string | null {
  return cheminsAdb(env, dossiers).find(existe) ?? null
}

function estUnFichier(fichier: string): boolean {
  try {
    return statSync(fichier).isFile()
  } catch {
    return false
  }
}

// ---------- lancement et sonde ----------

/** Ce que rend une commande : son code de sortie (-1 si elle n'a pas pu tourner), ses sorties, et si son délai a été dépassé. */
export type Sortie = { code: number; stdout: string; stderr: string; delaiDepasse: boolean }

/** Lance un programme sur un tableau d'arguments, avec un délai maximal ; ne rejette jamais. */
export type Lanceur = (programme: string, args: readonly string[], delaiMs: number) => Promise<Sortie>

/** Le lanceur réel : `execFile`, sans shell, fenêtre cachée, délai et taille de sortie bornés. */
export const lanceurReel: Lanceur = (programme, args, delaiMs) =>
  new Promise((fin) => {
    execFile(
      programme,
      [...args],
      { windowsHide: true, timeout: delaiMs, maxBuffer: SORTIE_MAX, encoding: 'utf8', shell: false },
      (erreur, stdout, stderr) => {
        if (!erreur) return fin({ code: 0, stdout, stderr, delaiDepasse: false })
        const e = erreur as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null }
        // Un code en lettres (`ENOENT`, sortie trop longue) : la commande n'a pas tourné jusqu'au bout, délai ou non.
        const code = typeof e.code === 'number' ? e.code : -1
        const delaiDepasse = typeof e.code !== 'string' && e.killed === true && e.signal != null
        fin({ code, stdout: stdout ?? '', stderr: `${stderr ?? ''}${code === -1 ? e.message : ''}`, delaiDepasse })
      },
    )
  })

/** Réponse de la sonde du serveur : pas de serveur, sa version, ou autre chose qui tient le port. */
export type Sonde = { etat: 'aucun' } | { etat: 'version'; version: number } | { etat: 'etranger' }

/** Le serveur adb visé : son hôte et son port. */
export type CibleServeur = { hote: string; port: number }

/** Hôte du serveur quand rien ne désigne un autre : celui où adb lance et cherche le sien. */
const HOTE_LOCAL = '127.0.0.1'

/** Demande sa version au serveur `cible`, sans attendre plus de `delaiMs`. */
export function sonderServeur(cible: CibleServeur, delaiMs: number = DELAIS.sonde): Promise<Sonde> {
  return new Promise((fin) => {
    let fini = false
    let recu = ''
    const prise = connect({ host: cible.hote, port: cible.port })
    const finir = (sonde: Sonde) => {
      if (fini) return
      fini = true
      clearTimeout(minuteur)
      prise.destroy()
      fin(sonde)
    }
    const minuteur = setTimeout(() => finir({ etat: 'etranger' }), delaiMs)
    prise.setEncoding('latin1')
    prise.on('connect', () => prise.write('000chost:version'))
    prise.on('data', (morceau: string) => {
      recu += morceau
      const lu = lireReponseVersion(recu)
      if (lu.etat !== 'incomplet') finir(lu)
    })
    prise.on('error', (e: NodeJS.ErrnoException) => finir(e.code === 'ECONNREFUSED' ? { etat: 'aucun' } : { etat: 'etranger' }))
    prise.on('close', () => {
      const lu = lireReponseVersion(recu)
      finir(lu.etat === 'version' ? lu : { etat: 'etranger' })
    })
  })
}

/** Port lu dans un texte, `null` s'il n'est pas un port valable. */
function lirePort(brut: string): number | null {
  const port = /^\d{1,5}$/.test(brut) ? Number(brut) : NaN
  return port >= 1 && port <= 65535 ? port : null
}

/**
 * Le serveur que nos commandes joindront, lu comme adb le lit : `ADB_SERVER_SOCKET` d'abord (`tcp:port`, ou
 * `tcp:hote:port`, hôte entre crochets pour une adresse IPv6), sinon `ANDROID_ADB_SERVER_PORT` sur 127.0.0.1, sinon
 * 127.0.0.1:5037. `null` si `ADB_SERVER_SOCKET` désigne un serveur que la sonde ne sait pas joindre (socket locale,
 * valeur illisible) : on ne lancerait alors aucune commande, faute de savoir à qui elle parlerait.
 */
export function cibleServeur(env: Record<string, string | undefined>): CibleServeur | null {
  const socket = variable(env, 'ADB_SERVER_SOCKET')
  if (socket !== undefined) {
    const m = /^tcp:(?:(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):)?(\d+)$/.exec(socket)
    const port = m ? lirePort(m[2]) : null
    if (!m || port === null) return null
    const hote = m[1] === undefined ? HOTE_LOCAL : m[1].replace(/^\[(.*)\]$/, '$1')
    return { hote, port }
  }
  return { hote: HOTE_LOCAL, port: lirePort(variable(env, 'ANDROID_ADB_SERVER_PORT') ?? '') ?? PORT_SERVEUR }
}

/** Vrai si le serveur visé est sur ce poste, le seul où nous lançons le nôtre quand il n'y en a aucun. */
function estLocal(cible: CibleServeur): boolean {
  return cible.hote === HOTE_LOCAL || cible.hote === '::1' || cible.hote.toLowerCase() === 'localhost'
}

// ---------- le dossier du téléphone par le débogage USB ----------

export type OptionsAdb = {
  env: Record<string, string | undefined>
  /** Dossier du profil du programme. */
  profil: string
  /** Dossier de `Tracker.exe`. */
  programme: string
  /** Nom du dossier lu sous `Documents` : `Tracker` par défaut, ou une racine d'essai. */
  nomRacine?: string
  lanceur?: Lanceur
  /** Horloge, en ms (celle du poste par défaut) : seulement pour la durée de `DELAIS.activite`. */
  horloge?: () => number
  sonde?: (cible: CibleServeur) => Promise<Sonde>
  existe?: (fichier: string) => boolean
  journal?: (message: string) => void
}

/** Délai d'une lecture d'après la taille du fichier. */
export function delaiLecture(taille: number): number {
  return DELAIS.lecture + Math.ceil(taille / 1_000_000) * DELAIS.parMo
}

type Outil = { adb: string; version: number }

export function dossierAdb(options: OptionsAdb): DossierDistant {
  const { env, profil, programme } = options
  const nomRacine = options.nomRacine ?? NOM_RACINE
  const lieux = lieuxDistants(nomRacine)
  const { racine } = lieux
  const corbeille = `${racine}/${DEPOT_TELEPHONE}`
  const lancer = options.lanceur ?? lanceurReel
  const sonder = options.sonde ?? ((cible: CibleServeur) => sonderServeur(cible))
  const existe = options.existe ?? estUnFichier
  const journal = options.journal ?? (() => undefined)
  const horloge = options.horloge ?? Date.now
  /** L'outil trouvé et la version de serveur qu'il porte ; recherché à nouveau tant qu'il manque. */
  let outil: Outil | null = null
  /** Série du téléphone prêt au dernier état. */
  let serie: string | null = null
  /** Nom réel sur le téléphone de chaque fichier du dernier listage, par chemin montré (`commeLeTelephone`). */
  let reels = new Map<string, string>()
  /** Série de l'appareil du dernier listage réussi : la seule que visent lecture, écriture et retrait ; `null` sans listage valable. */
  let listeSerie: string | null = null
  /** Chemins réels et tailles du dernier `listerTout` : les seuls que `lireBrut` lit. */
  let tous = new Map<string, number>()
  /** Instant de la dernière lecture de l'activité qui a trouvé l'application libre ; `null` : à relire. */
  let libreLe: number | null = null

  function oublierListage(): void {
    reels = new Map()
    listeSerie = null
    libreLe = null
  }

  /** L'outil, ou `null` s'il n'est pas sur le poste. */
  async function trouverOutil(): Promise<Outil | null> {
    const adb = chercherAdb(env, { profil, programme }, existe)
    if (adb === null) {
      outil = null
      return null
    }
    if (outil?.adb === adb) return outil
    const s = await lancer(adb, ['version'], DELAIS.court)
    const version = s.code === 0 ? lireVersionAdb(s.stdout) : null
    if (version === null) throw new ErreurDisque('UNKNOWN', `L'outil adb ne répond pas : ${adb}`)
    journal(`adb : ${adb}, serveur ${version}`)
    outil = { adb, version }
    return outil
  }

  /**
   * Seul passage des commandes qui parlent au serveur (`devices`, `shell`, `pull`, `push`, et `start-server` qu'il
   * lance lui-même) : le serveur visé est sondé juste avant chacune. Pas de serveur sur ce poste : le nôtre est lancé.
   * Un serveur d'une autre version, une réponse étrangère ou un serveur que la sonde ne sait pas viser : `null`, et
   * rien n'est lancé. Les commandes héritent de l'environnement, donc visent le même serveur que la sonde.
   */
  async function parLeServeur(o: Outil, args: readonly string[], delaiMs: number): Promise<Sortie | null> {
    const cible = cibleServeur(env)
    if (cible === null) {
      journal('ADB_SERVER_SOCKET désigne un serveur que la sonde ne sait pas joindre : aucune commande')
      return null
    }
    let sonde = await sonder(cible)
    if (sonde.etat === 'aucun') {
      if (!estLocal(cible)) throw new ErreurDisque('UNKNOWN', `Le serveur adb désigné (${cible.hote}:${cible.port}) ne répond pas.`)
      const s = await lancer(o.adb, ['start-server'], DELAIS.demarrage)
      sonde = await sonder(cible)
      if (sonde.etat === 'aucun') {
        const detail = (s.stderr || s.stdout).trim().slice(0, 300)
        if (s.delaiDepasse) throw new ErreurDisque('UNKNOWN', `Le serveur adb ne démarre pas (délai dépassé) : ${detail}`)
        throw new ErreurDisque('UNKNOWN', `Le serveur adb ne démarre pas : ${detail}`)
      }
    }
    if (sonde.etat !== 'version' || sonde.version !== o.version) {
      journal(`liaison tenue par un autre programme sur ${cible.hote}:${cible.port}`)
      return null
    }
    return lancer(o.adb, args, delaiMs)
  }

  async function lireEtat(): Promise<EtatTelephone> {
    serie = null
    const o = await trouverOutil()
    if (o === null) return { etat: 'adbIntrouvable', dossier: dossierAdbConseille(profil) }
    const s = await parLeServeur(o, ['devices', '-l'], DELAIS.court)
    if (s === null) return { etat: 'occupe' }
    if (s.delaiDepasse) throw new ErreurDisque('UNKNOWN', 'Le serveur adb ne répond pas (délai dépassé).')
    if (s.code !== 0) throw new ErreurDisque('UNKNOWN', `Liste des appareils impossible : ${(s.stderr || s.stdout).trim().slice(0, 300)}`)
    const lu = etatDesAppareils(lireAppareils(s.stdout))
    serie = lu.serie
    return lu.etat
  }

  /**
   * État du téléphone. Un autre appareil que celui du dernier listage (ou plus aucun, plusieurs, ou une panne) fait
   * oublier ce listage : lire, écrire et retirer demandent alors un nouveau listage.
   */
  async function etat(): Promise<EtatTelephone> {
    try {
      const e = await lireEtat()
      if (listeSerie !== null && serie !== listeSerie) oublierListage()
      return e
    } catch (erreur) {
      oublierListage()
      throw erreur
    }
  }

  /** Une commande `shell` sur le téléphone prêt, au texte fabriqué par `texteShell` seulement. */
  async function shell(o: Outil, s: string, commande: CommandeShell): Promise<Sortie> {
    const texte = texteShell(commande, lieux)
    const sortie = await parLeServeur(o, ['-s', s, 'shell', texte], DELAIS.listage)
    if (sortie === null) throw pasPret('occupe')
    if (sortie.delaiDepasse) throw new ErreurDisque('UNKNOWN', 'Le téléphone ne répond pas (délai dépassé).')
    const perdu = erreurAdb(`${sortie.stderr}\n${sortie.stdout}`)
    if (perdu !== null) throw new ErreurDisque('UNKNOWN', `Le téléphone ne répond plus : ${perdu}`)
    return sortie
  }

  /** Une commande muette en cas de réussite (`mv`, `mkdir`) : lève, avec la phrase donnée, si elle a parlé ou échoué. */
  async function shellMuet(o: Outil, s: string, commande: CommandeShell, phrase: string): Promise<void> {
    const sortie = await shell(o, s, commande)
    if (echecDuShell(sortie)) throw new ErreurDisque('UNKNOWN', `${phrase} : ${(sortie.stderr || sortie.stdout).trim().slice(0, 300)}`)
  }

  /** Le listage, fichiers vus comme le téléphone les voit. */
  async function listerVus(o: Outil, s: string): Promise<FichierVu[]> {
    const sortie = await shell(o, s, { sorte: 'listage' })
    const fichiers = lireListageVu(sortie.stdout, racine)
    if (sortie.code === 0 && !sortie.delaiDepasse) return fichiers
    // Un code non nul n'est jamais un listage complet, même avec des lignes lues (fichier disparu en route, accès
    // refusé, sortie coupée) : seul le dossier absent, ou la commande inconnue sans rien de lu, ont une suite.
    const texte = `${sortie.stderr}\n${sortie.stdout}`
    const rienLu = sortie.stdout.trim() === ''
    if (rienLu && dossierManquant(texte)) throw racineAbsente(nomRacine)
    if (!rienLu || !commandeInconnue(texte)) throw listageIncomplet(texte)
    journal(`listage par find impossible, repli sur stat : ${texte.trim().slice(0, 200)}`)
    const r = await shell(o, s, { sorte: 'racine' })
    if (r.code !== 0) {
      if (dossierManquant(`${r.stderr}\n${r.stdout}`)) throw racineAbsente(nomRacine)
      throw new ErreurDisque('UNKNOWN', `Listage du téléphone impossible : ${(r.stderr || r.stdout).trim().slice(0, 300)}`)
    }
    // Un motif sans fichier (`sessions/` vide) reste tel quel et donne une erreur, sans gravité ; toute autre erreur
    // rend le repli incomplet.
    const repli = await shell(o, s, { sorte: 'repli' })
    if (!repliComplet(repli)) throw listageIncomplet(`${repli.stderr}\n${repli.stdout}`)
    return lireListageVu(repli.stdout, racine)
  }

  /**
   * L'outil et la série du dernier listage réussi, la seule que visent lecture, écriture et retrait (`-s`). Lève,
   * sans rien lancer, s'il n'y a pas de listage valable.
   */
  function liaison(): { o: Outil; s: string } {
    const o = outil
    const s = listeSerie
    if (o === null || s === null) throw pasListe()
    return { o, s }
  }

  /**
   * Avant une écriture ou un retrait : la liaison du dernier listage, le même appareil seul branché (sinon le listage
   * est oublié et rien n'est écrit), et l'application du téléphone sans service en cours (sinon refus). L'activité est
   * relue à chaque fois pour un retrait (`fraiche`) ; une écriture se fie à une lecture « libre » de moins de
   * `DELAIS.activite`.
   */
  async function liaisonPourEcrire(fraiche: boolean): Promise<{ o: Outil; s: string }> {
    const { o, s } = liaison()
    const appareils = await parLeServeur(o, ['devices', '-l'], DELAIS.court)
    if (appareils === null) throw pasPret('occupe')
    if (appareils.delaiDepasse || appareils.code !== 0) throw new ErreurDisque('UNKNOWN', 'Le serveur adb ne répond pas.')
    const lu = etatDesAppareils(lireAppareils(appareils.stdout))
    if (lu.etat.etat !== 'pret' || lu.serie !== s) {
      oublierListage()
      throw lu.etat.etat === 'plusieurs' ? pasPret('plusieurs') : pasListe()
    }
    const recente = libreLe !== null && horloge() - libreLe >= 0 && horloge() - libreLe < DELAIS.activite
    if (fraiche || !recente) {
      const activite = await lireActivite(o, s)
      if (activite.etat === 'occupee') {
        journal(`téléphone occupé (${activite.services.join(', ')}) : rien n'est écrit`)
        throw enregistrementEnCours()
      }
      if (activite.etat === 'illisible') throw new ErreurDisque('PERMISSION', "On ne sait pas si le téléphone enregistre une session : rien n'y est écrit.")
    }
    return { o, s }
  }

  async function lireActivite(o: Outil, s: string): Promise<ActiviteApplication> {
    libreLe = null
    const sortie = await shell(o, s, { sorte: 'services' })
    const lu = lireServices(sortie.stdout)
    if (lu.etat === 'libre') libreLe = horloge()
    if (lu.etat === 'illisible') journal(`activité de l'application illisible : ${(sortie.stderr || sortie.stdout).trim().slice(0, 200)}`)
    return lu
  }

  /** Lève si l'un de ces dossiers existe sans être un vrai dossier (un lien, un fichier) : rien n'est écrit à travers. */
  async function exigerDossiers(o: Outil, s: string, chemins: readonly string[]): Promise<void> {
    const modes = lireModes((await shell(o, s, { sorte: 'statDossiers', chemins })).stdout)
    for (const [chemin, mode] of modes) {
      if (!estDossier(mode)) throw new ErreurDisque('PERMISSION', `« ${chemin} » n'est pas un dossier sur le téléphone.`)
    }
  }

  /** Mode, taille et date d'un fichier du téléphone ; `null` s'il n'existe pas. */
  async function statDistant(o: Outil, s: string, distant: string): Promise<{ mode: number; taille: number; dateMs: number } | null> {
    const sortie = await shell(o, s, { sorte: 'stat', chemin: distant })
    const lu = lireStat(sortie.stdout)
    if (lu !== null) return lu
    if (dossierManquant(`${sortie.stderr}\n${sortie.stdout}`)) return null
    throw new ErreurDisque('UNKNOWN', `Lecture de l'état d'un fichier du téléphone impossible : ${(sortie.stderr || sortie.stdout).trim().slice(0, 300)}`)
  }

  /**
   * Retire le provisoire d'un envoi raté, et lui seul (`nom.tracker-new`, `texteShell` refuse tout autre nom) ; sans
   * effet s'il n'existe pas. Un échec est seulement noté : le téléphone efface lui-même un `.tracker-new` resté seul.
   */
  async function retirerProvisoire(o: Outil, s: string, provisoire: string): Promise<void> {
    try {
      const sortie = await shell(o, s, { sorte: 'effacerProvisoire', chemin: provisoire })
      if (echecDuShell(sortie)) journal(`provisoire non retiré : ${(sortie.stderr || sortie.stdout).trim().slice(0, 200)}`)
    } catch (e) {
      journal(`provisoire non retiré : ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** Seule lecture d'un fichier du téléphone : `pull -a` du fichier `reel` (sous la racine) vers `fichierLocal`. */
  async function tirer(o: Outil, s: string, reel: string, fichier: FichierTelephone, fichierLocal: string): Promise<void> {
    const distant = `${racine}/${reel}`
    const sortie = await parLeServeur(o, ['-s', s, 'pull', '-a', distant, fichierLocal], delaiLecture(fichier.taille))
    if (sortie === null) throw pasPret('occupe')
    if (sortie.delaiDepasse) throw new ErreurDisque('UNKNOWN', `Lecture de « ${fichier.chemin} » trop longue (délai dépassé).`)
    if (sortie.code !== 0) {
      throw new ErreurDisque('UNKNOWN', `Lecture de « ${fichier.chemin} » impossible : ${(sortie.stderr || sortie.stdout).trim().slice(0, 300)}`)
    }
  }

  /** Les sous-dossiers de la corbeille, lus dans une sortie de `stat -c '%f %s %Y %n'` : leurs noms. */
  function lireCorbeille(sortie: string): string[] {
    const prefixe = `${corbeille}/`
    const noms: string[] = []
    for (const brute of sortie.split('\n')) {
      const m = /^([0-9a-fA-F]+) \d+ \d+ (.+?)\r?$/.exec(brute)
      if (!m || !estDossier(parseInt(m[1], 16)) || !m[2].startsWith(prefixe)) continue
      const nom = m[2].slice(prefixe.length)
      if (nom !== '' && !nom.includes('/')) noms.push(nom)
    }
    return noms
  }

  return {
    etat,

    async lister() {
      const e = await etat()
      const o = outil
      const s = serie
      oublierListage()
      if (e.etat !== 'pret' || o === null || s === null) throw pasPret(e.etat)
      const vus = await listerVus(o, s)
      reels = new Map(vus.map((f) => [f.chemin, f.reel]))
      listeSerie = s
      return vus.map(sansReel)
    },

    // Seulement un fichier du dernier listage, sur la série de ce listage : un autre appareil branché depuis n'est
    // jamais lu.
    async lire(fichier, fichierLocal) {
      const o = outil
      const s = listeSerie
      const reel = reels.get(fichier.chemin)
      if (o === null || s === null || reel === undefined) throw pasListe()
      await tirer(o, s, reel, fichier, fichierLocal)
    },

    async listerTout() {
      const { o, s } = liaison()
      tous = new Map()
      const sortie = await shell(o, s, { sorte: 'listageTout' })
      const texte = `${sortie.stderr}\n${sortie.stdout}`
      if (sortie.code !== 0 || sortie.delaiDepasse) {
        if (sortie.stdout.trim() === '' && dossierManquant(texte)) throw racineAbsente(nomRacine)
        throw listageIncomplet(texte)
      }
      const prefixe = `${racine}/`
      const trouves: FichierBrut[] = []
      for (const brute of sortie.stdout.split('\n')) {
        const ligne = brute.endsWith('\r') ? brute.slice(0, -1) : brute
        if (ligne.trim() === '') continue
        const m = /^([0-9a-fA-F]+) (\d+) (\d+) (.+)$/.exec(ligne)
        // Une ligne illisible (nom coupé par un retour à la ligne) rend le listage incomplet : rien n'est écarté en silence.
        if (!m || !m[4].startsWith(prefixe)) throw listageIncomplet(`ligne illisible : ${ligne.slice(0, 200)}`)
        trouves.push({ chemin: m[4].slice(prefixe.length), taille: Number(m[2]), dateMs: Number(m[3]) * 1000, ordinaire: estFichierOrdinaire(parseInt(m[1], 16)) })
      }
      tous = new Map(trouves.map((f) => [f.chemin, f.taille]))
      return trouves.sort((a, b) => (a.chemin < b.chemin ? -1 : a.chemin > b.chemin ? 1 : 0))
    },

    async lireBrut(fichier, fichierLocal) {
      const { o, s } = liaison()
      if (tous.get(fichier.chemin) !== fichier.taille) throw new ErreurDisque('UNKNOWN', `Fichier absent du dernier listage complet : « ${fichier.chemin.slice(0, 200)} ».`)
      await tirer(o, s, fichier.chemin, fichier, fichierLocal)
    },

    async enregistrement() {
      const { o, s } = liaison()
      const activite = await lireActivite(o, s)
      if (activite.etat === 'illisible') throw new ErreurDisque('UNKNOWN', "On ne sait pas lire ce que fait l'application du téléphone.")
      return activite.etat === 'occupee'
    },

    async ecrire(chemin, fichierLocal, taille) {
      if (!cheminEcrivable(chemin)) throw cheminRefuse(chemin)
      const distant = `${racine}/${chemin}`
      const provisoire = nomProvisoire(distant)
      // Vérifiés avant toute commande : le texte du renommage et celui de l'effacement du provisoire.
      texteShell({ sorte: 'renommer', de: provisoire, vers: distant }, lieux)
      texteShell({ sorte: 'effacerProvisoire', chemin: provisoire }, lieux)
      const depot = ficheDepot(chemin) ? distant.slice(0, distant.lastIndexOf('/')) : null
      if (depot !== null) texteShell({ sorte: 'statDossiers', chemins: [corbeille, depot] }, lieux)
      const { o, s } = await liaisonPourEcrire(false)
      const avant = await statDistant(o, s, distant)
      if (avant !== null && !estFichierOrdinaire(avant.mode)) throw new ErreurDisque('PERMISSION', `« ${chemin} » n'est pas un fichier sur le téléphone.`)
      if (depot !== null) {
        // Une fiche de dépôt ne s'écrit que dans un dépôt neuf, jamais par-dessus une autre, ni à travers un lien.
        if (avant !== null) throw corbeillePrise(chemin)
        await exigerDossiers(o, s, [corbeille, depot])
      }
      try {
        const envoi = await parLeServeur(o, ['-s', s, 'push', fichierLocal, provisoire], delaiLecture(taille))
        if (envoi === null) throw pasPret('occupe')
        if (envoi.delaiDepasse) throw new ErreurDisque('UNKNOWN', `Écriture de « ${chemin} » trop longue (délai dépassé).`)
        if (envoi.code !== 0) {
          throw new ErreurDisque('UNKNOWN', `Écriture de « ${chemin} » impossible : ${(envoi.stderr || envoi.stdout).trim().slice(0, 300)}`)
        }
        const lu = await statDistant(o, s, provisoire)
        if (lu === null || !estFichierOrdinaire(lu.mode) || lu.taille !== taille) {
          throw new ErreurDisque('UNKNOWN', `Écriture incomplète de « ${chemin} » : ${lu?.taille ?? 0} octets sur ${taille}.`)
        }
        await shellMuet(o, s, { sorte: 'renommer', de: provisoire, vers: distant }, `Renommage de « ${chemin} » impossible`)
        reels.set(chemin, chemin)
        return { chemin, taille: lu.taille, dateMs: lu.dateMs }
      } catch (e) {
        await retirerProvisoire(o, s, provisoire)
        throw e
      }
    },

    async mettreDeCote(fichier, vers) {
      if (!destinationCorbeilleAdmise(fichier.chemin, vers)) throw cheminRefuse(`${fichier.chemin} → ${String(vers)}`)
      const reel = reels.get(fichier.chemin)
      if (reel === undefined) throw pasListe()
      const source = `${racine}/${reel}`
      const cible = `${racine}/${vers}`
      const dossier = cible.slice(0, cible.lastIndexOf('/'))
      const fiche = `${dossier}/${FICHIER_DEPOT}`
      // Le remplacement interrompu caché à côté (`nom.tracker-tmp` à côté de `nom`) part aussi, et d'abord : seul, le
      // téléphone lui rendrait le nom de l'original.
      const cache = reel === fichier.chemin ? `${source}${SUFFIXE_REMPLACEMENT}` : null
      // Vérifiés avant toute commande : chaque texte que ce retrait peut envoyer.
      texteShell({ sorte: 'deplacer', de: source, vers: cible }, lieux)
      if (cache !== null) texteShell({ sorte: 'deplacer', de: cache, vers: `${cible}${SUFFIXE_REMPLACEMENT}` }, lieux)
      texteShell({ sorte: 'stat', chemin: fiche }, lieux)
      texteShell({ sorte: 'statDossiers', chemins: [corbeille, dossier] }, lieux)
      const { o, s } = await liaisonPourEcrire(true)
      const lu = await statDistant(o, s, source)
      if (lu === null) {
        reels.delete(fichier.chemin)
        return
      }
      if (!estFichierOrdinaire(lu.mode)) throw new ErreurDisque('PERMISSION', `« ${fichier.chemin} » n'est pas un fichier sur le téléphone.`)
      if (lu.taille !== fichier.taille || lu.dateMs !== fichier.dateMs) throw changeDepuisListage(fichier.chemin)
      const luCache = cache === null ? null : await statDistant(o, s, cache)
      if (luCache !== null && !estFichierOrdinaire(luCache.mode)) throw new ErreurDisque('PERMISSION', `« ${fichier.chemin} » a à côté autre chose qu'un fichier.`)
      // Le dépôt doit être ouvert : sa fiche, écrite avant tout déplacement, le garde de la purge du téléphone.
      const ouvert = await statDistant(o, s, fiche)
      if (ouvert === null || !estFichierOrdinaire(ouvert.mode)) throw depotSansFiche(String(vers))
      if ((await statDistant(o, s, cible)) !== null) throw corbeillePrise(String(vers))
      if (luCache !== null && (await statDistant(o, s, `${cible}${SUFFIXE_REMPLACEMENT}`)) !== null) throw corbeillePrise(`${String(vers)}${SUFFIXE_REMPLACEMENT}`)
      // La corbeille et le dépôt : de vrais dossiers (rien n'est écrit à travers un lien).
      await exigerDossiers(o, s, [corbeille, dossier])
      if (luCache !== null && cache !== null) {
        await shellMuet(o, s, { sorte: 'deplacer', de: cache, vers: `${cible}${SUFFIXE_REMPLACEMENT}` }, `Mise de côté de « ${fichier.chemin} » impossible`)
      }
      await shellMuet(o, s, { sorte: 'deplacer', de: source, vers: cible }, `Mise de côté de « ${fichier.chemin} » impossible`)
      reels.delete(fichier.chemin)
      // Relu : le fichier est dans la corbeille, et plus rien sous son nom ne le ferait revenir.
      const arrive = await statDistant(o, s, cible)
      if (arrive === null || arrive.taille !== lu.taille) throw new ErreurDisque('UNKNOWN', `« ${fichier.chemin} » n'est pas arrivé dans la corbeille du téléphone.`)
      for (const reste of cache === null ? [source] : [source, cache]) {
        if ((await statDistant(o, s, reste)) !== null) throw changeDepuisListage(fichier.chemin)
      }
    },

    async listerCorbeille() {
      const { o, s } = liaison()
      const sortie = await shell(o, s, { sorte: 'listageCorbeille' })
      const noms = lireCorbeille(sortie.stdout)
      if (sortie.code === 0 && !sortie.delaiDepasse) return noms.sort()
      const texte = `${sortie.stderr}\n${sortie.stdout}`
      const rienLu = sortie.stdout.trim() === ''
      if (rienLu && dossierManquant(texte)) return []
      if (!rienLu || !commandeInconnue(texte)) throw listageIncomplet(texte)
      journal(`listage de la corbeille par find impossible, repli sur stat : ${texte.trim().slice(0, 200)}`)
      const repli = await shell(o, s, { sorte: 'repliCorbeille' })
      if (!repliComplet(repli)) throw listageIncomplet(`${repli.stderr}\n${repli.stdout}`)
      return lireCorbeille(repli.stdout).sort()
    },
  }
}
