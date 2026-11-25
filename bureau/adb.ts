// Le dossier du téléphone par le débogage USB, en LECTURE SEULE : `adb.exe`, l'outil de Google, cherché sur le poste
// (il n'est pas livré avec le programme), lancé par un tableau d'arguments (`execFile`, sans shell de Windows ni chaîne
// de commande). Sans Electron.
//
// Commandes lancées, et elles seules : `version`, `start-server`, `devices -l`, `shell` avec l'un des trois textes
// fixes du listage (`commandesListage`), et `pull -a` d'un fichier du dernier listage (le chemin passe en argument, par
// le protocole de copie d'adb, sans shell). Aucune commande qui écrive, renomme ou retire quoi que ce soit sur le
// téléphone n'existe ici ; un test relit ce fichier pour le garantir.
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
// téléphone prêt (`-s`), et une lecture celle du dernier listage seulement.
//
// Chaque commande a son délai maximal ; les commandes passent l'une après l'autre (la file est celle des gestionnaires
// de `telephone.ts`).

import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { connect } from 'node:net'
import path from 'node:path'
import { ErreurDisque } from './disque'
import type { DossierDistant, EtatTelephone, FichierTelephone, FichierVu } from './telephone'
import { NOM_RACINE, RACINE_ESSAI, commeLeTelephone, fichiersAdmis, pasPret, racineAbsente, sansReel } from './telephone'

/** Dossier du téléphone lu par défaut, dans sa mémoire partagée. */
export const RACINE_DISTANTE = `/sdcard/Documents/${NOM_RACINE}`

/** Chemin du dossier lu sur le téléphone : `Documents/Tracker`, ou une racine d'essai (`RACINE_ESSAI`) ; tout autre nom lève. */
export function racineDistante(nomRacine: string = NOM_RACINE): string {
  if (nomRacine !== NOM_RACINE && !RACINE_ESSAI.test(nomRacine)) throw new ErreurDisque('UNKNOWN', `Racine du téléphone refusée : ${nomRacine.slice(0, 60)}`)
  return `/sdcard/Documents/${nomRacine}`
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
 * - `repli` : `stat` sur les fichiers de la racine et de `sessions/` (le mode écarte les dossiers).
 */
export function commandesListage(racine: string = RACINE_DISTANTE): CommandesListage {
  return {
    listage: `find ${racine} -maxdepth 2 -type f -exec stat -c '%f %s %Y %n' {} +`,
    racine: `stat -c '%f' ${racine}`,
    repli: `stat -c '%f %s %Y %n' ${racine}/* ${racine}/sessions/*`,
  }
}

const PAR_DEFAUT = commandesListage()
export const COMMANDE_LISTAGE = PAR_DEFAUT.listage
export const COMMANDE_RACINE = PAR_DEFAUT.racine
export const COMMANDE_LISTAGE_REPLI = PAR_DEFAUT.repli

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
  const racine = racineDistante(nomRacine)
  const textes = commandesListage(racine)
  const lancer = options.lanceur ?? lanceurReel
  const sonder = options.sonde ?? ((cible: CibleServeur) => sonderServeur(cible))
  const existe = options.existe ?? estUnFichier
  const journal = options.journal ?? (() => undefined)
  /** L'outil trouvé et la version de serveur qu'il porte ; recherché à nouveau tant qu'il manque. */
  let outil: Outil | null = null
  /** Série du téléphone prêt au dernier état. */
  let serie: string | null = null
  /** Nom réel sur le téléphone de chaque fichier du dernier listage, par chemin montré (`commeLeTelephone`). */
  let reels = new Map<string, string>()
  /** Série de l'appareil du dernier listage réussi : la seule que vise une lecture ; `null` sans listage valable. */
  let listeSerie: string | null = null

  function oublierListage(): void {
    reels = new Map()
    listeSerie = null
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
   * Seul passage des commandes qui parlent au serveur (`devices`, `shell`, `pull`, et `start-server` qu'il lance
   * lui-même) : le serveur visé est sondé juste avant chacune. Pas de serveur sur ce poste : le nôtre est lancé. Un
   * serveur d'une autre version, une réponse étrangère ou un serveur que la sonde ne sait pas viser : `null`, et rien
   * n'est lancé. Les commandes héritent de l'environnement, donc visent le même serveur que la sonde.
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

  /** État du téléphone. Un autre appareil que celui du dernier listage (ou plus aucun, ou une panne) fait oublier ce listage. */
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

  /** Une commande `shell` à texte fixe sur le téléphone prêt. */
  async function shell(o: Outil, s: string, texte: string): Promise<Sortie> {
    const sortie = await parLeServeur(o, ['-s', s, 'shell', texte], DELAIS.listage)
    if (sortie === null) throw pasPret('occupe')
    if (sortie.delaiDepasse) throw new ErreurDisque('UNKNOWN', 'Le téléphone ne répond pas (délai dépassé).')
    const perdu = erreurAdb(`${sortie.stderr}\n${sortie.stdout}`)
    if (perdu !== null) throw new ErreurDisque('UNKNOWN', `Le téléphone ne répond plus : ${perdu}`)
    return sortie
  }

  /** Le listage, fichiers vus comme le téléphone les voit. */
  async function listerVus(o: Outil, s: string): Promise<FichierVu[]> {
    const sortie = await shell(o, s, textes.listage)
    const fichiers = lireListageVu(sortie.stdout, racine)
    if (fichiers.length > 0 || sortie.code === 0) return fichiers
    const texte = `${sortie.stderr}\n${sortie.stdout}`
    if (dossierManquant(texte)) throw racineAbsente(nomRacine)
    // Rien de lisible et une erreur qui n'est pas « absent » : `find` du téléphone ne connaît pas `-exec … +`.
    journal(`listage par find impossible, repli sur stat : ${texte.trim().slice(0, 200)}`)
    const r = await shell(o, s, textes.racine)
    if (r.code !== 0) {
      if (dossierManquant(`${r.stderr}\n${r.stdout}`)) throw racineAbsente(nomRacine)
      throw new ErreurDisque('UNKNOWN', `Listage du téléphone impossible : ${(r.stderr || r.stdout).trim().slice(0, 300)}`)
    }
    // Un motif sans fichier (`sessions/` vide) reste tel quel et donne une erreur : les lignes lues suffisent.
    return lireListageVu((await shell(o, s, textes.repli)).stdout, racine)
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
      if (o === null || s === null || reel === undefined) throw new ErreurDisque('UNKNOWN', "Le téléphone n'a pas été listé.")
      const distant = `${racine}/${reel}`
      const sortie = await parLeServeur(o, ['-s', s, 'pull', '-a', distant, fichierLocal], delaiLecture(fichier.taille))
      if (sortie === null) throw pasPret('occupe')
      if (sortie.delaiDepasse) throw new ErreurDisque('UNKNOWN', `Lecture de « ${fichier.chemin} » trop longue (délai dépassé).`)
      if (sortie.code !== 0) {
        throw new ErreurDisque('UNKNOWN', `Lecture de « ${fichier.chemin} » impossible : ${(sortie.stderr || sortie.stdout).trim().slice(0, 300)}`)
      }
    },
  }
}
