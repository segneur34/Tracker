import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import type { Server } from 'node:net'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CibleServeur, CommandeShell, Lanceur, LieuxDistants, Sonde, Sortie } from './adb'
import {
  COMMANDE_LISTAGE,
  COMMANDE_LISTAGE_REPLI,
  COMMANDE_RACINE,
  COMMANDE_SERVICES,
  DELAIS,
  cheminsAdb,
  chercherAdb,
  cibleServeur,
  citerShell,
  commandesListage,
  delaiLecture,
  dossierAdb,
  echecDuShell,
  etatDesAppareils,
  lieuxDistants,
  lireAppareils,
  lireListage,
  lireModes,
  lireReponseVersion,
  lireServices,
  lireStat,
  lireVersionAdb,
  racineDistante,
  sonderServeur,
  texteShell,
} from './adb'
import type { FichierTelephone } from './telephone'
import { MESSAGE_ENREGISTREMENT, PAQUET_APPLICATION, SERVICES_APPLICATION } from './telephone'

/** Sortie réelle de `adb version` sur un poste de développement. */
const VERSION_REELLE = `Android Debug Bridge version 1.0.41
Version 37.0.1-15733141
Installed as C:\\Users\\moi\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe
Running on Windows 10.0.26300
`

describe('lecture des sorties d’adb', () => {
  it('lit les appareils de devices -l, sans en-tête ni lignes du démarrage du serveur', () => {
    const sortie = [
      '* daemon not running; starting now at tcp:5037',
      '* daemon started successfully',
      'List of devices attached',
      'abc123                 device usb:1-1 product:garnet_global model:Redmi_Note_13_Pro_5G device:garnet transport_id:3',
      'def456                 unauthorized usb:1-2 transport_id:4',
      '',
    ].join('\r\n')
    expect(lireAppareils(sortie)).toEqual([
      { serie: 'abc123', etat: 'device', modele: 'Redmi Note 13 Pro 5G' },
      { serie: 'def456', etat: 'unauthorized', modele: null },
    ])
  })

  it('donne l’état : plusieurs appareils refusés, sinon le seul, prêt, à autoriser ou hors ligne, sinon absent', () => {
    const a = (serie: string, etat: string, modele: string | null = null) => ({ serie, etat, modele })
    expect(etatDesAppareils([a('y', 'device', 'Pixel 8')])).toEqual({ etat: { etat: 'pret', nom: 'Pixel 8' }, serie: 'y' })
    expect(etatDesAppareils([a('y', 'device')])).toEqual({ etat: { etat: 'pret', nom: 'y' }, serie: 'y' })
    expect(etatDesAppareils([a('x', 'unauthorized')]).etat).toEqual({ etat: 'autorisation' })
    expect(etatDesAppareils([a('z', 'offline')]).etat).toEqual({ etat: 'horsLigne' })
    expect(etatDesAppareils([])).toEqual({ etat: { etat: 'absent' }, serie: null })
    expect(etatDesAppareils(lireAppareils('List of devices attached\n\n'))).toEqual({ etat: { etat: 'absent' }, serie: null })
    // Deux appareils, quels que soient leurs états : refus, aucune série retenue.
    expect(etatDesAppareils([a('x', 'device', 'A'), a('y', 'device', 'B')])).toEqual({ etat: { etat: 'plusieurs', nombre: 2 }, serie: null })
    expect(etatDesAppareils([a('x', 'unauthorized'), a('y', 'device', 'Pixel 8')])).toEqual({ etat: { etat: 'plusieurs', nombre: 2 }, serie: null })
    expect(etatDesAppareils([a('x', 'offline'), a('y', 'device'), a('emulator-5554', 'device')]).etat).toEqual({ etat: 'plusieurs', nombre: 3 })
  })

  it('lit la version du serveur dans adb version et dans la réponse à host:version', () => {
    expect(lireVersionAdb(VERSION_REELLE)).toBe(41)
    expect(lireVersionAdb('bonjour')).toBeNull()
    expect(lireReponseVersion('OKAY0004001f')).toEqual({ etat: 'version', version: 31 })
    expect(lireReponseVersion('OKAY00040029')).toEqual({ etat: 'version', version: 41 })
    expect(lireReponseVersion('OKAY000')).toEqual({ etat: 'incomplet' })
    expect(lireReponseVersion('OKAY000400')).toEqual({ etat: 'incomplet' })
    expect(lireReponseVersion('OK')).toEqual({ etat: 'incomplet' })
    expect(lireReponseVersion('FAIL0004nope')).toEqual({ etat: 'etranger' })
    expect(lireReponseVersion('HTTP/1.1 400')).toEqual({ etat: 'etranger' })
    expect(lireReponseVersion('OKAY0004002900')).toEqual({ etat: 'etranger' })
  })

  it('lit le listage : préfixe retiré, espaces et accents gardés, sous-dossiers listés gardés, dossiers et chemins refusés écartés', () => {
    const r = '/sdcard/Documents/Tracker'
    const sortie = [
      `81b0 1234 1763495253 ${r}/sessions/Sortie du 18 novembre é.gpx`,
      `81b0 20 1763495000 ${r}/tracker.json\r`,
      `81b0 5 1763495000 ${r}/itineraires/tour.gpx`,
      `81b0 5 1763495000 ${r}/reglages/telephone.json`,
      `41f9 3452 1763495000 ${r}/sessions`,
      `81b0 5 1763495000 ${r}/sessions/..`,
      `81b0 5 1763495000 ${r}/../secret.txt`,
      `81b0 5 1763495000 ${r}/sessions/a\\b.gpx`,
      `81b0 5 1763495000 ${r}/sessions/c:d.gpx`,
      `81b0 5 1763495000 ${r}//etc/passwd`,
      `81b0 5 1763495000 /sdcard/Download/a.gpx`,
      `81b0 5 1763495000 /sdcard/Documents/Tracker-essai/sessions/z.gpx`,
      `81b0 5 1763495000 ${r}/synchro/a.json`,
      'stat: /sdcard/Documents/Tracker/sessions/*: No such file or directory',
      '',
    ].join('\n')
    expect(lireListage(sortie)).toEqual([
      { chemin: 'itineraires/tour.gpx', taille: 5, dateMs: 1763495000000 },
      { chemin: 'reglages/telephone.json', taille: 5, dateMs: 1763495000000 },
      { chemin: 'sessions/Sortie du 18 novembre é.gpx', taille: 1234, dateMs: 1763495253000 },
      { chemin: 'tracker.json', taille: 20, dateMs: 1763495000000 },
    ])
  })

  it('voit les écritures interrompues comme le téléphone : .tracker-new caché, .tracker-tmp seul montré sous son nom', () => {
    const r = '/sdcard/Documents/Tracker'
    const sortie = [
      `81b0 10 1763495000 ${r}/sessions/a.gpx`,
      `81b0 11 1763495000 ${r}/sessions/a.gpx.tracker-tmp`,
      `81b0 12 1763495000 ${r}/sessions/b.json.tracker-tmp`,
      `81b0 13 1763495000 ${r}/sessions/c.gpx.tracker-new`,
    ].join('\n')
    expect(lireListage(sortie)).toEqual([
      { chemin: 'sessions/a.gpx', taille: 10, dateMs: 1763495000000 },
      { chemin: 'sessions/b.json', taille: 12, dateMs: 1763495000000 },
    ])
  })
})

describe('racine du téléphone', () => {
  it('Documents/Tracker par défaut, une racine d’essai bornée, rien d’autre', () => {
    expect(racineDistante()).toBe('/sdcard/Documents/Tracker')
    expect(racineDistante('Tracker-essai')).toBe('/sdcard/Documents/Tracker-essai')
    expect(racineDistante('Tracker-essai-2')).toBe('/sdcard/Documents/Tracker-essai-2')
    for (const nom of ['Gtracker', 'tracker', 'Tracker-essai-A', 'Tracker-essai/..', '../Tracker', 'Tracker essai', "Tracker-essai'; ls"]) {
      expect(() => racineDistante(nom)).toThrow('refusée')
    }
  })

  it('les textes du listage suivent la racine, sans rien qui écrive ni enchaîne', () => {
    expect(commandesListage()).toEqual({ listage: COMMANDE_LISTAGE, racine: COMMANDE_RACINE, repli: COMMANDE_LISTAGE_REPLI })
    expect(COMMANDE_LISTAGE).toBe("find /sdcard/Documents/Tracker -maxdepth 2 -type f -exec stat -c '%f %s %Y %n' {} +")
    expect(commandesListage(racineDistante('Tracker-essai')).listage).toBe("find /sdcard/Documents/Tracker-essai -maxdepth 2 -type f -exec stat -c '%f %s %Y %n' {} +")
  })
})

describe('recherche d’adb', () => {
  const dossiers = { profil: 'C:\\Users\\moi\\AppData\\Roaming\\Tracker', programme: 'C:\\Programmes\\Tracker' }
  const env = {
    Path: 'C:\\Windows;"C:\\outils adb";relatif',
    ANDROID_HOME: 'D:\\sdk',
    ANDROID_SDK_ROOT: 'E:\\sdk',
    LOCALAPPDATA: 'C:\\Users\\moi\\AppData\\Local',
  }

  it('cherche dans l’ordre : PATH, ANDROID_HOME, ANDROID_SDK_ROOT, le SDK d’Android Studio, le profil, le programme', () => {
    expect(cheminsAdb(env, dossiers)).toEqual([
      'C:\\Windows\\adb.exe',
      'C:\\outils adb\\adb.exe',
      'D:\\sdk\\platform-tools\\adb.exe',
      'E:\\sdk\\platform-tools\\adb.exe',
      'C:\\Users\\moi\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe',
      'C:\\Users\\moi\\AppData\\Roaming\\Tracker\\platform-tools\\adb.exe',
      'C:\\Programmes\\Tracker\\platform-tools\\adb.exe',
    ])
  })

  it('rend le premier trouvé, ou rien', () => {
    const present = (...fichiers: string[]) => (f: string) => fichiers.includes(f)
    expect(chercherAdb(env, dossiers, present('E:\\sdk\\platform-tools\\adb.exe', 'C:\\outils adb\\adb.exe'))).toBe('C:\\outils adb\\adb.exe')
    expect(chercherAdb(env, dossiers, present('C:\\Programmes\\Tracker\\platform-tools\\adb.exe'))).toBe('C:\\Programmes\\Tracker\\platform-tools\\adb.exe')
    expect(chercherAdb({}, dossiers, present())).toBeNull()
  })

  it('vise le serveur de ANDROID_ADB_SERVER_PORT quand ADB_SERVER_SOCKET est absente', () => {
    expect(cibleServeur({})).toEqual({ hote: '127.0.0.1', port: 5037 })
    expect(cibleServeur({ ANDROID_ADB_SERVER_PORT: '5038' })).toEqual({ hote: '127.0.0.1', port: 5038 })
    expect(cibleServeur({ ANDROID_ADB_SERVER_PORT: 'x' })).toEqual({ hote: '127.0.0.1', port: 5037 })
    expect(cibleServeur({ ANDROID_ADB_SERVER_PORT: '70000', ADB_SERVER_SOCKET: '  ' })).toEqual({ hote: '127.0.0.1', port: 5037 })
  })

  it('vise le serveur de ADB_SERVER_SOCKET sous une forme tcp: lisible, avant ANDROID_ADB_SERVER_PORT', () => {
    expect(cibleServeur({ ADB_SERVER_SOCKET: 'tcp:5039', ANDROID_ADB_SERVER_PORT: '5038' })).toEqual({ hote: '127.0.0.1', port: 5039 })
    expect(cibleServeur({ adb_server_socket: 'tcp:poste.local:6000' })).toEqual({ hote: 'poste.local', port: 6000 })
    expect(cibleServeur({ ADB_SERVER_SOCKET: 'tcp:[::1]:5037' })).toEqual({ hote: '::1', port: 5037 })
  })

  it('ne vise rien sous toute autre forme de ADB_SERVER_SOCKET', () => {
    for (const socket of ['localabstract:adb', 'local:/tmp/adb', 'tcp:', 'tcp:hote:', 'tcp:99999', 'tcp:a b:5037', '5037', 'vsock:2:5037']) {
      expect(cibleServeur({ ADB_SERVER_SOCKET: socket })).toBeNull()
    }
  })
})

describe('sonde du serveur', () => {
  let serveur: Server | null = null
  afterEach(async () => {
    await new Promise<void>((fin) => (serveur ? serveur.close(() => fin()) : fin()))
    serveur = null
  })

  /** Un serveur local qui répond `reponse` (ou se tait si `null`) ; rend son adresse. */
  async function ecouter(reponse: string | null): Promise<CibleServeur> {
    const s = createServer((prise) => {
      prise.on('error', () => undefined)
      prise.once('data', () => {
        if (reponse !== null) prise.end(reponse)
      })
    })
    serveur = s
    await new Promise<void>((fin) => s.listen(0, '127.0.0.1', () => fin()))
    const adresse = s.address()
    return { hote: '127.0.0.1', port: typeof adresse === 'object' && adresse !== null ? adresse.port : 0 }
  }

  it('lit la version d’un serveur adb', async () => {
    expect(await sonderServeur(await ecouter('OKAY00040029'), 500)).toEqual({ etat: 'version', version: 41 })
  })

  it('reconnaît une réponse étrangère ou un silence', async () => {
    expect(await sonderServeur(await ecouter('HTTP/1.1 400 Bad Request\r\n\r\n'), 500)).toEqual({ etat: 'etranger' })
    await new Promise<void>((fin) => serveur!.close(() => fin()))
    expect(await sonderServeur(await ecouter(null), 100)).toEqual({ etat: 'etranger' })
  })

  it('reconnaît l’absence de serveur', async () => {
    const cible = await ecouter(null)
    await new Promise<void>((fin) => serveur!.close(() => fin()))
    serveur = null
    expect(await sonderServeur(cible, 500)).toEqual({ etat: 'aucun' })
  })
})

// ---------- le dossier du téléphone, sur un faux adb ----------

const ADB = 'C:\\sdk\\platform-tools\\adb.exe'
const PROFIL = 'C:\\profil'
const LISTE_PRET = 'List of devices attached\nSERIE1 device usb:1 model:Redmi_Note transport_id:1\n'
const LISTE_DEUX = 'List of devices attached\nSERIE1 device usb:1 model:Redmi_Note transport_id:1\nSERIE2 device usb:2 model:Pixel transport_id:2\n'
const TEMP = 'C:\\profil\\telephone-lecture\\1.tracker-tmp'

type Reponses = Partial<Record<string, Partial<Sortie> | ((args: readonly string[]) => Partial<Sortie>)>>

/**
 * Un faux adb : `reponses` par verbe (`version`, `start-server`, `devices`, `shell:<texte>`, `pull`) ; chaque appel est
 * noté avec son délai, et la suite des sondes et des commandes dans `suite` (`sonde`, puis le verbe, ou `shell:<texte>`).
 * Le serveur est décrit par `serveur` (sondé ; fonction du numéro de la sonde, à partir de 1), qui devient le nôtre
 * après `start-server`.
 */
function faux(
  reponses: Reponses,
  serveur: Sonde | ((numero: number) => Sonde),
  options: { demarre?: boolean; env?: Record<string, string>; nomRacine?: string; horloge?: () => number } = {},
) {
  const appels: { args: readonly string[]; delai: number }[] = []
  const suite: string[] = []
  let demarre = false
  let numero = 0
  const lanceur: Lanceur = async (programme, args, delai) => {
    expect(programme).toBe(ADB)
    appels.push({ args, delai })
    const verbe = args[0] === '-s' ? args[2] : args[0]
    const cle = verbe === 'shell' ? `shell:${args[3]}` : verbe
    suite.push(cle)
    if (verbe === 'start-server' && options.demarre !== false) demarre = true
    const r = reponses[cle]
    const partiel = typeof r === 'function' ? r(args) : r
    return { code: 0, stdout: '', stderr: '', delaiDepasse: false, ...partiel }
  }
  const sondes: CibleServeur[] = []
  const t = dossierAdb({
    env: { ANDROID_HOME: 'C:\\sdk', ...options.env },
    profil: PROFIL,
    programme: 'C:\\programme',
    nomRacine: options.nomRacine,
    horloge: options.horloge,
    lanceur,
    sonde: async (cible) => {
      sondes.push(cible)
      suite.push('sonde')
      numero++
      if (demarre) return NOTRE_SERVEUR
      return typeof serveur === 'function' ? serveur(numero) : serveur
    },
    existe: (f) => f === ADB,
  })
  return { t, appels, sondes, suite, verbes: () => appels.map((a) => (a.args[0] === '-s' ? a.args[2] : a.args[0])) }
}

const ADB_OK = { version: { stdout: VERSION_REELLE }, devices: { stdout: LISTE_PRET } }
const NOTRE_SERVEUR: Sonde = { etat: 'version', version: 41 }
const UN_FICHIER = `81b0 3 1763495000 /sdcard/Documents/Tracker/sessions/a b.gpx\n81b0 1 1763495000 /sdcard/Documents/Tracker/sessions/a.json\n`

describe('dossier du téléphone par adb', () => {
  it('dit où copier platform-tools si adb est introuvable, sans rien lancer', async () => {
    const appels: unknown[] = []
    const t = dossierAdb({ env: {}, profil: PROFIL, programme: 'C:\\programme', lanceur: async () => (appels.push(1), { code: 0, stdout: '', stderr: '', delaiDepasse: false }), existe: () => false })
    expect(await t.etat()).toEqual({ etat: 'adbIntrouvable', dossier: 'C:\\profil' })
    expect(appels).toEqual([])
  })

  it('se joint au serveur de même version et lit l’appareil prêt', async () => {
    const f = faux(ADB_OK, NOTRE_SERVEUR)
    expect(await f.t.etat()).toEqual({ etat: 'pret', nom: 'Redmi Note' })
    expect(f.appels.map((a) => a.args)).toEqual([['version'], ['devices', '-l']])
    expect(f.appels.map((a) => a.delai)).toEqual([DELAIS.court, DELAIS.court])
    expect(f.sondes).toEqual([{ hote: '127.0.0.1', port: 5037 }])
  })

  it('refuse deux appareils branchés : état « plusieurs », aucun listage ni lecture', async () => {
    const f = faux({ ...ADB_OK, devices: { stdout: LISTE_DEUX } }, NOTRE_SERVEUR)
    expect(await f.t.etat()).toEqual({ etat: 'plusieurs', nombre: 2 })
    await expect(f.t.lister()).rejects.toThrow('plusieurs')
    await expect(f.t.lire({ chemin: 'sessions/a b.gpx', taille: 3, dateMs: 0 }, TEMP)).rejects.toThrow("pas été listé")
    expect(f.verbes()).toEqual(['version', 'devices', 'devices'])
  })

  it('un second appareil branché après le listage fait oublier ce listage : plus aucune lecture', async () => {
    let liste = LISTE_PRET
    const f = faux({ ...ADB_OK, devices: () => ({ stdout: liste }), [`shell:${COMMANDE_LISTAGE}`]: { stdout: UN_FICHIER } }, NOTRE_SERVEUR)
    await f.t.lister()
    liste = LISTE_DEUX
    expect((await f.t.etat()).etat).toBe('plusieurs')
    await expect(f.t.lire({ chemin: 'sessions/a b.gpx', taille: 3, dateMs: 0 }, TEMP)).rejects.toThrow("pas été listé")
    expect(f.verbes()).not.toContain('pull')
  })

  it('sonde le serveur de ADB_SERVER_SOCKET, et n’en lance pas un ailleurs que sur ce poste', async () => {
    const f = faux(ADB_OK, NOTRE_SERVEUR, { env: { ADB_SERVER_SOCKET: 'tcp:poste.local:6000' } })
    expect((await f.t.etat()).etat).toBe('pret')
    expect(f.sondes).toEqual([{ hote: 'poste.local', port: 6000 }])
    const loin = faux(ADB_OK, { etat: 'aucun' }, { env: { ADB_SERVER_SOCKET: 'tcp:poste.local:6000' } })
    await expect(loin.t.etat()).rejects.toThrow('ne répond pas')
    expect(loin.verbes()).toEqual(['version'])
  })

  it('est occupé, sans sonde ni commande au serveur, si ADB_SERVER_SOCKET a une autre forme', async () => {
    const f = faux(ADB_OK, NOTRE_SERVEUR, { env: { ADB_SERVER_SOCKET: 'localabstract:adb' } })
    expect(await f.t.etat()).toEqual({ etat: 'occupe' })
    await expect(f.t.lister()).rejects.toMatchObject({ code: 'UNKNOWN' })
    expect(f.verbes()).toEqual(['version'])
    expect(f.sondes).toEqual([])
  })

  it('sonde le serveur avant chaque commande qui lui parle, listage et repli compris', async () => {
    const f = faux(
      {
        ...ADB_OK,
        [`shell:${COMMANDE_LISTAGE}`]: { code: 1, stderr: 'find: Unknown option -exec' },
        [`shell:${COMMANDE_RACINE}`]: { stdout: '41f9' },
        [`shell:${COMMANDE_LISTAGE_REPLI}`]: { stdout: '81b0 1 1763495000 /sdcard/Documents/Tracker/tracker.json\n' },
      },
      { etat: 'aucun' },
    )
    await f.t.lister()
    await f.t.lire({ chemin: 'tracker.json', taille: 1, dateMs: 0 }, TEMP)
    expect(f.suite).toEqual([
      'version',
      'sonde',
      'start-server',
      'sonde',
      'devices',
      'sonde',
      `shell:${COMMANDE_LISTAGE}`,
      'sonde',
      `shell:${COMMANDE_RACINE}`,
      'sonde',
      `shell:${COMMANDE_LISTAGE_REPLI}`,
      'sonde',
      'pull',
    ])
  })

  it('arrête le listage sans rien lancer de plus si la liaison est prise entre deux commandes', async () => {
    // Sondes 1 et 2 : notre serveur (appareils, listage) ; à partir de la 3 (première commande du repli), un autre.
    const f = faux({ ...ADB_OK, [`shell:${COMMANDE_LISTAGE}`]: { code: 1, stderr: 'find: Unknown option -exec' } }, (n) => (n <= 2 ? NOTRE_SERVEUR : { etat: 'version', version: 40 }))
    await expect(f.t.lister()).rejects.toThrow('occupe')
    expect(f.suite).toEqual(['version', 'sonde', 'devices', 'sonde', `shell:${COMMANDE_LISTAGE}`, 'sonde'])
  })

  it('lance son serveur s’il n’y en a aucun', async () => {
    const f = faux(ADB_OK, { etat: 'aucun' })
    expect(await f.t.etat()).toEqual({ etat: 'pret', nom: 'Redmi Note' })
    expect(f.verbes()).toEqual(['version', 'start-server', 'devices'])
    expect(f.appels[1].delai).toBe(DELAIS.demarrage)
  })

  it('échoue si son serveur ne démarre pas', async () => {
    const f = faux({ ...ADB_OK, 'start-server': { code: 1, stderr: 'cannot bind' } }, { etat: 'aucun' }, { demarre: false })
    await expect(f.t.etat()).rejects.toThrow('cannot bind')
    expect(f.verbes()).toEqual(['version', 'start-server'])
  })

  it('est occupé, sans aucune commande au serveur, si un autre adb ou un autre programme tient le port', async () => {
    for (const serveur of [{ etat: 'version', version: 40 }, { etat: 'etranger' }] as Sonde[]) {
      const f = faux(ADB_OK, serveur)
      expect(await f.t.etat()).toEqual({ etat: 'occupe' })
      expect(f.verbes()).toEqual(['version'])
      await expect(f.t.lister()).rejects.toMatchObject({ code: 'UNKNOWN' })
      expect(f.verbes()).toEqual(['version'])
    }
  })

  it('lit autorisation (unauthorized), hors ligne (offline) et absent, sans rien lister', async () => {
    const cas: [string, string][] = [
      ['X unauthorized usb:1', 'autorisation'],
      ['X offline', 'horsLigne'],
      ['', 'absent'],
    ]
    for (const [ligne, attendu] of cas) {
      const f = faux({ ...ADB_OK, devices: { stdout: `List of devices attached\n${ligne}\n` } }, NOTRE_SERVEUR)
      expect((await f.t.etat()).etat).toBe(attendu)
      await expect(f.t.lister()).rejects.toMatchObject({ code: 'UNKNOWN' })
      expect(f.verbes()).not.toContain('shell')
    }
  })

  it('liste en une commande au texte fixe, sur la série de l’appareil prêt', async () => {
    const f = faux({ ...ADB_OK, [`shell:${COMMANDE_LISTAGE}`]: { stdout: UN_FICHIER } }, NOTRE_SERVEUR)
    expect(await f.t.lister()).toEqual([
      { chemin: 'sessions/a b.gpx', taille: 3, dateMs: 1763495000000 },
      { chemin: 'sessions/a.json', taille: 1, dateMs: 1763495000000 },
    ])
    const listage = f.appels.at(-1)!
    expect(listage.args).toEqual(['-s', 'SERIE1', 'shell', COMMANDE_LISTAGE])
    expect(listage.delai).toBe(DELAIS.listage)
  })

  it('sur une racine d’essai, ne liste et ne lit que sous Documents/Tracker-essai', async () => {
    const essai = commandesListage('/sdcard/Documents/Tracker-essai')
    const f = faux(
      { ...ADB_OK, [`shell:${essai.listage}`]: { stdout: '81b0 3 1763495000 /sdcard/Documents/Tracker-essai/sessions/a.gpx\n81b0 3 1763495000 /sdcard/Documents/Tracker/sessions/vrai.gpx\n' } },
      NOTRE_SERVEUR,
      { nomRacine: 'Tracker-essai' },
    )
    expect(await f.t.lister()).toEqual([{ chemin: 'sessions/a.gpx', taille: 3, dateMs: 1763495000000 }])
    await f.t.lire({ chemin: 'sessions/a.gpx', taille: 3, dateMs: 0 }, TEMP)
    expect(f.appels.at(-1)!.args).toEqual(['-s', 'SERIE1', 'pull', '-a', '/sdcard/Documents/Tracker-essai/sessions/a.gpx', TEMP])
    for (const a of f.appels) expect(a.args.join(' ')).not.toMatch(/Documents\/Tracker(?!-essai)/)
    expect(() => dossierAdb({ env: {}, profil: PROFIL, programme: 'C:\\p', nomRacine: 'Download' })).toThrow('refusée')
  })

  it('rend NOT_FOUND sans Documents/Tracker, une liste vide pour un dossier vide', async () => {
    const absent = faux({ ...ADB_OK, [`shell:${COMMANDE_LISTAGE}`]: { code: 1, stderr: 'find: /sdcard/Documents/Tracker: No such file or directory' } }, NOTRE_SERVEUR)
    await expect(absent.t.lister()).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const vide = faux({ ...ADB_OK, [`shell:${COMMANDE_LISTAGE}`]: { code: 0 } }, NOTRE_SERVEUR)
    expect(await vide.t.lister()).toEqual([])
  })

  it('se replie sur stat si find ne connaît pas -exec … +', async () => {
    const f = faux(
      {
        ...ADB_OK,
        [`shell:${COMMANDE_LISTAGE}`]: { code: 1, stderr: 'find: Unknown option -exec' },
        [`shell:${COMMANDE_RACINE}`]: { stdout: '41f9\n' },
        [`shell:${COMMANDE_LISTAGE_REPLI}`]: {
          code: 1,
          stdout: '81b0 2 1763495000 /sdcard/Documents/Tracker/tracker.json\n41f9 3452 1763495000 /sdcard/Documents/Tracker/sessions\n',
          stderr: 'stat: /sdcard/Documents/Tracker/sessions/*: No such file or directory',
        },
      },
      NOTRE_SERVEUR,
    )
    expect(await f.t.lister()).toEqual([{ chemin: 'tracker.json', taille: 2, dateMs: 1763495000000 }])
    const absent = faux({ ...ADB_OK, [`shell:${COMMANDE_LISTAGE}`]: { code: 1, stderr: 'find: Unknown option -exec' }, [`shell:${COMMANDE_RACINE}`]: { code: 1, stderr: 'stat: No such file or directory' } }, NOTRE_SERVEUR)
    await expect(absent.t.lister()).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('échoue sur un délai dépassé ou un téléphone perdu pendant le listage', async () => {
    const lent = faux({ ...ADB_OK, [`shell:${COMMANDE_LISTAGE}`]: { code: -1, delaiDepasse: true } }, NOTRE_SERVEUR)
    await expect(lent.t.lister()).rejects.toThrow('délai dépassé')
    const perdu = faux({ ...ADB_OK, [`shell:${COMMANDE_LISTAGE}`]: { code: 1, stderr: "adb: error: device 'SERIE1' not found" } }, NOTRE_SERVEUR)
    await expect(perdu.t.lister()).rejects.toThrow('ne répond plus')
    expect(perdu.verbes().filter((v) => v === 'shell')).toHaveLength(1)
  })

  it('lit un fichier du dernier listage seulement, par pull -a sur sa série, délai réglé sur la taille', async () => {
    const f = faux({ ...ADB_OK, [`shell:${COMMANDE_LISTAGE}`]: { stdout: '81b0 3500000 1763495000 /sdcard/Documents/Tracker/sessions/sortie é.gpx\n' } }, NOTRE_SERVEUR)
    const fichier = { chemin: 'sessions/sortie é.gpx', taille: 3_500_000, dateMs: 0 }
    await expect(f.t.lire(fichier, TEMP)).rejects.toThrow("pas été listé")
    expect(f.appels).toEqual([])
    await f.t.etat()
    await expect(f.t.lire(fichier, TEMP)).rejects.toThrow("pas été listé")
    await f.t.lister()
    for (const chemin of ['sessions/autre.gpx', '../secret.txt', '/sdcard/Documents/Tracker/sessions/sortie é.gpx', 'sessions\\sortie é.gpx']) {
      await expect(f.t.lire({ ...fichier, chemin }, TEMP)).rejects.toThrow("pas été listé")
    }
    expect(f.verbes()).not.toContain('pull')
    await f.t.lire(fichier, TEMP)
    const lecture = f.appels.at(-1)!
    expect(lecture.args).toEqual(['-s', 'SERIE1', 'pull', '-a', '/sdcard/Documents/Tracker/sessions/sortie é.gpx', TEMP])
    expect(lecture.delai).toBe(24_000)
    expect(delaiLecture(0)).toBe(DELAIS.lecture)
  })

  it('fait échouer une lecture trop longue ou refusée', async () => {
    const fichier = { chemin: 'sessions/a b.gpx', taille: 3, dateMs: 0 }
    const lent = faux({ ...ADB_OK, [`shell:${COMMANDE_LISTAGE}`]: { stdout: UN_FICHIER }, pull: { code: -1, delaiDepasse: true } }, NOTRE_SERVEUR)
    await lent.t.lister()
    await expect(lent.t.lire(fichier, TEMP)).rejects.toThrow('délai dépassé')
    const refuse = faux({ ...ADB_OK, [`shell:${COMMANDE_LISTAGE}`]: { stdout: UN_FICHIER }, pull: { code: 1, stderr: "adb: error: failed to stat remote object 'x'" } }, NOTRE_SERVEUR)
    await refuse.t.lister()
    await expect(refuse.t.lire(fichier, TEMP)).rejects.toThrow('failed to stat')
  })

  it('ne lit plus si un autre programme a pris la liaison entre-temps', async () => {
    let serveur: Sonde = NOTRE_SERVEUR
    const appels: string[] = []
    const t = dossierAdb({
      env: { ANDROID_HOME: 'C:\\sdk' },
      profil: PROFIL,
      programme: 'C:\\programme',
      lanceur: async (_p, args) => {
        appels.push(args.join(' '))
        const stdout = args[0] === 'version' ? VERSION_REELLE : args[2] === 'shell' ? UN_FICHIER : LISTE_PRET
        return { code: 0, stdout, stderr: '', delaiDepasse: false }
      },
      sonde: async () => serveur,
      existe: (f) => f === ADB,
    })
    await t.lister()
    serveur = { etat: 'version', version: 39 }
    await expect(t.lire({ chemin: 'sessions/a.json', taille: 1, dateMs: 0 }, TEMP)).rejects.toMatchObject({ code: 'UNKNOWN' })
    expect(appels).toEqual(['version', 'devices -l', `-s SERIE1 shell ${COMMANDE_LISTAGE}`])
  })
})

// ---------- écriture, mise de côté et corbeille, sur un faux adb ----------

const R = '/sdcard/Documents/Tracker'
const C = '/sdcard/Documents/Tracker-corbeille'
const LIEUX = lieuxDistants()
const LOCAL = 'C:\\profil\\telephone-lecture\\1.tracker-tmp'
const JOUR = 'Tracker-corbeille/2026-11-26'
const ABSENT = (distant: string): Partial<Sortie> => ({ code: 1, stderr: `stat: '${distant}': No such file or directory` })

/** Clé du faux adb pour une commande `shell`. */
const cle = (c: CommandeShell, lieux: LieuxDistants = LIEUX) => `shell:${texteShell(c, lieux)}`
const statCle = (chemin: string, lieux: LieuxDistants = LIEUX) => cle({ sorte: 'stat', chemin }, lieux)

const SERVICES_LIBRE = 'ACTIVITY MANAGER SERVICES (dumpsys activity services)\n  (nothing)\n'
/** Sortie de `dumpsys activity services` pendant un enregistrement (forme d'Android 14). */
const SERVICES_ENREGISTREMENT = [
  'ACTIVITY MANAGER SERVICES (dumpsys activity services)',
  '  User 0 active services:',
  '  * ServiceRecord{8f3c2d1 u0 io.github.segneur.tracker/.RecordingService c:io.github.segneur.tracker}',
  '    intent={cmp=io.github.segneur.tracker/.RecordingService}',
  '    packageName=io.github.segneur.tracker',
  '    processName=io.github.segneur.tracker',
  '    app=ProcessRecord{1a2b3c4 12345:io.github.segneur.tracker/u0a321}',
  '    isForeground=true foregroundId=1 types=0x00000008 foregroundNoti=Notification(channel=enregistrement pri=-1)',
  '    createTime=-12m3s45ms startingBgTimeout=--',
  '',
  '  Connection bindings to services:',
  '    (nothing)',
  '',
].join('\n')

const PRET_A_ECRIRE: Reponses = { ...ADB_OK, [`shell:${COMMANDE_SERVICES}`]: { stdout: SERVICES_LIBRE } }

/** Les commandes passées au téléphone, sans les sondes, `version`, `devices` ni le listage. */
const auTelephone = (f: ReturnType<typeof faux>) =>
  f.suite.filter((c) => c !== 'sonde' && c !== 'version' && c !== 'devices' && c !== 'start-server' && c !== `shell:${COMMANDE_LISTAGE}`)

/** Chaque argument passé à adb : jamais l'arrêt du serveur, jamais un nom en `.tracker-tmp` hors d'une mise de côté. */
function sansArretNiTmp(f: ReturnType<typeof faux>): void {
  for (const { args } of f.appels) {
    expect(args).not.toContain('kill-server')
    for (const a of args) if (a.includes('/sdcard/')) expect(a).not.toMatch(/\.tracker-tmp/)
  }
}

/** Un fichier listé sur le téléphone : la ligne du listage et le fichier que la page désigne. */
function liste(chemin: string, taille = 4, reel = chemin): { ligne: string; fichier: FichierTelephone } {
  return { ligne: `81b0 ${taille} 1763495000 ${R}/${reel}\n`, fichier: { chemin, taille, dateMs: 1763495000000 } }
}

describe('services de l’application (dumpsys)', () => {
  it('libre sans service du paquet ; occupée par un service connu, même hors premier plan, ou par un service de premier plan', () => {
    expect(lireServices(SERVICES_LIBRE)).toEqual({ etat: 'libre' })
    expect(lireServices(SERVICES_ENREGISTREMENT)).toEqual({ etat: 'occupee', services: ['RecordingService'] })
    const bloc = (paquet: string, classe: string, premierPlan: boolean) =>
      [`  * ServiceRecord{abc123 u0 ${paquet}/${classe}}`, `    packageName=${paquet}`, `    isForeground=${premierPlan} foregroundId=0`].join('\n')
    const sortie = (...blocs: string[]) => ['ACTIVITY MANAGER SERVICES (dumpsys activity services)', '  User 0 active services:', ...blocs].join('\n')
    expect(lireServices(sortie(bloc(PAQUET_APPLICATION, '.HeartRateService', false)))).toEqual({ etat: 'occupee', services: ['HeartRateService'] })
    expect(lireServices(sortie(bloc(PAQUET_APPLICATION, 'io.github.segneur.tracker.IntervalTimerService', false)))).toEqual({ etat: 'occupee', services: ['IntervalTimerService'] })
    expect(lireServices(sortie(bloc(PAQUET_APPLICATION, '.AutreService', true)))).toEqual({ etat: 'occupee', services: ['AutreService'] })
    // Un service d'arrière-plan d'un greffon, ou le service de premier plan d'une autre application : libre.
    expect(lireServices(sortie(bloc(PAQUET_APPLICATION, '.AutreService', false), bloc('com.autre', '.RecordingService', true)))).toEqual({ etat: 'libre' })
    // Le premier plan suit son bloc, pas le suivant.
    expect(lireServices(sortie(bloc('com.autre', '.X', true), bloc(PAQUET_APPLICATION, '.AutreService', false)))).toEqual({ etat: 'libre' })
  })

  it('illisible sans l’en-tête attendu : rien ne sera écrit', () => {
    for (const s of ['', 'Permission Denial: can\'t dump ActivityManager', "Can't find service: activity"]) expect(lireServices(s)).toEqual({ etat: 'illisible' })
    expect(SERVICES_APPLICATION).toEqual(['RecordingService', 'HeartRateService', 'IntervalTimerService'])
    expect(COMMANDE_SERVICES).toBe('dumpsys activity services io.github.segneur.tracker')
  })

  it('les services connus sont ceux du manifeste de l’application', () => {
    const manifeste = readFileSync(path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8')
    const declares = [...manifeste.matchAll(/<service\s[^>]*android:name="\.(\w+)"/g)].map((m) => m[1]).sort()
    expect(declares).toEqual([...SERVICES_APPLICATION].sort())
    expect(readFileSync(path.join(__dirname, '..', 'android', 'app', 'build.gradle'), 'utf8')).toContain(`applicationId "${PAQUET_APPLICATION}"`)
  })

  it('dit si le téléphone enregistre, sur la série du listage, après un listage seulement', async () => {
    const f = faux({ ...ADB_OK, [`shell:${COMMANDE_SERVICES}`]: { stdout: SERVICES_ENREGISTREMENT } }, NOTRE_SERVEUR)
    await expect(f.t.enregistrement()).rejects.toThrow('pas été listé')
    await f.t.lister()
    expect(await f.t.enregistrement()).toBe(true)
    expect(f.appels.at(-1)!.args).toEqual(['-s', 'SERIE1', 'shell', COMMANDE_SERVICES])
    const libre = faux(PRET_A_ECRIRE, NOTRE_SERVEUR)
    await libre.t.lister()
    expect(await libre.t.enregistrement()).toBe(false)
    const muet = faux({ ...ADB_OK, [`shell:${COMMANDE_SERVICES}`]: { stdout: '' } }, NOTRE_SERVEUR)
    await muet.t.lister()
    await expect(muet.t.enregistrement()).rejects.toMatchObject({ code: 'UNKNOWN' })
  })
})

describe('citerShell', () => {
  it('cite entre apostrophes, rien n’étant interprété : espaces, accents, $, accent grave, ;, retour à la ligne', () => {
    expect(citerShell('a b.gpx')).toBe("'a b.gpx'")
    expect(citerShell('sortie é ç.gpx')).toBe("'sortie é ç.gpx'")
    expect(citerShell('$HOME `id` ; rm -rf / && x | y > z')).toBe("'$HOME `id` ; rm -rf / && x | y > z'")
    expect(citerShell('a\nb')).toBe("'a\nb'")
    expect(citerShell('')).toBe("''")
  })

  it('ferme, échappe et rouvre la citation autour d’une apostrophe, refuse un caractère nul', () => {
    expect(citerShell("l'eau")).toBe(`'l'\\''eau'`)
    expect(() => citerShell('a\u0000b')).toThrow('caractère nul')
  })
})

describe('texteShell, seul passage des commandes au téléphone', () => {
  it('fabrique les textes voulus, noms cités', () => {
    expect(texteShell({ sorte: 'stat', chemin: `${R}/sessions/l'eau.gpx` }, LIEUX)).toBe(`stat -c '%f %s %Y' '${R}/sessions/l'\\''eau.gpx'`)
    expect(texteShell({ sorte: 'renommer', de: `${R}/tracker.json.tracker-new`, vers: `${R}/tracker.json` }, LIEUX)).toBe(`mv -f '${R}/tracker.json.tracker-new' '${R}/tracker.json'`)
    expect(texteShell({ sorte: 'deplacer', de: `${R}/sessions/a.gpx`, vers: `${C}/2026-11-26/sessions/a-2.gpx` }, LIEUX)).toBe(`mv '${R}/sessions/a.gpx' '${C}/2026-11-26/sessions/a-2.gpx'`)
    expect(texteShell({ sorte: 'creerDossier', chemin: `${C}/2026-11-26/itineraires` }, LIEUX)).toBe(`mkdir -p '${C}/2026-11-26/itineraires'`)
    expect(texteShell({ sorte: 'effacerProvisoire', chemin: `${R}/reglages/pc.json.tracker-new` }, LIEUX)).toBe(`rm -f '${R}/reglages/pc.json.tracker-new'`)
    expect(texteShell({ sorte: 'statDossiers', chemins: [C, `${C}/2026-11-26`, `${C}/2026-11-26/sessions`] }, LIEUX)).toBe(`stat -c '%f %n' '${C}' '${C}/2026-11-26' '${C}/2026-11-26/sessions'`)
    expect(texteShell({ sorte: 'listageCorbeille', jour: '2026-11-26' }, LIEUX)).toBe(`find ${C}/2026-11-26 -maxdepth 2 -type f -exec stat -c '%f %s %Y %n' {} +`)
    expect(texteShell({ sorte: 'services' }, LIEUX)).toBe(COMMANDE_SERVICES)
  })

  it('refuse tout chemin hors des lieux et des listes fermées, et tout rm d’un autre nom qu’un .tracker-new', () => {
    const refusees: CommandeShell[] = [
      { sorte: 'stat', chemin: `${R}/../x` },
      { sorte: 'stat', chemin: '/sdcard/Download/a.gpx' },
      { sorte: 'stat', chemin: `${R}/synchro/a.json` },
      { sorte: 'stat', chemin: `${R}/journaux/a.json` },
      { sorte: 'stat', chemin: `${R}/sessions/sous/a.gpx` },
      { sorte: 'stat', chemin: `${C}/2026-11-26/reglages/a.json` },
      { sorte: 'stat', chemin: `${C}/../Tracker/sessions/a.gpx` },
      { sorte: 'renommer', de: `${R}/sessions/a.gpx.tracker-tmp`, vers: `${R}/sessions/a.gpx` },
      { sorte: 'renommer', de: `${R}/sessions/b.gpx.tracker-new`, vers: `${R}/sessions/a.gpx` },
      { sorte: 'renommer', de: `${R}/journaux/a.tracker-new`, vers: `${R}/journaux/a` },
      { sorte: 'renommer', de: `${C}/2026-11-26/sessions/a.gpx.tracker-new`, vers: `${C}/2026-11-26/sessions/a.gpx` },
      { sorte: 'deplacer', de: `${R}/reglages/pc.json`, vers: `${C}/2026-11-26/reglages/pc.json` },
      { sorte: 'deplacer', de: `${R}/sessions/a.gpx`, vers: `${C}/2026-11-26/itineraires/a.gpx` },
      { sorte: 'deplacer', de: `${R}/sessions/a.gpx`, vers: `${R}/sessions/b.gpx` },
      { sorte: 'deplacer', de: `${C}/2026-11-26/sessions/a.gpx`, vers: `${R}/sessions/a.gpx` },
      { sorte: 'deplacer', de: `${R}/sessions/a.gpx`, vers: `${C}/2026-11-26/sessions/a.gpx.tracker-tmp` },
      { sorte: 'deplacer', de: `${R}/sessions/a.gpx`, vers: '/sdcard/Download/a.gpx' },
      { sorte: 'deplacer', de: `${R}/tracker.json`, vers: `${C}/2026-11-26/tracker.json` },
      { sorte: 'creerDossier', chemin: C },
      { sorte: 'creerDossier', chemin: `${C}/2026-11-26` },
      { sorte: 'creerDossier', chemin: `${C}/2026-11-26/reglages` },
      { sorte: 'creerDossier', chemin: `${C}/2026-11-26/sessions/x` },
      { sorte: 'creerDossier', chemin: `${R}/sessions` },
      { sorte: 'statDossiers', chemins: [] },
      { sorte: 'statDossiers', chemins: [R] },
      { sorte: 'listageCorbeille', jour: '2026-11-26/..' },
      { sorte: 'repliCorbeille', jour: '*' },
      { sorte: 'effacerProvisoire', chemin: `${R}/sessions/a.gpx` },
      { sorte: 'effacerProvisoire', chemin: `${R}/sessions/a.gpx.tracker-tmp` },
      { sorte: 'effacerProvisoire', chemin: `${R}/journaux/a.tracker-new` },
      { sorte: 'effacerProvisoire', chemin: `${C}/2026-11-26/sessions/a.gpx.tracker-new` },
      { sorte: 'effacerProvisoire', chemin: '/sdcard/x.tracker-new' },
      { sorte: 'effacerProvisoire', chemin: `${R}/sessions/*.tracker-new` },
    ]
    for (const c of refusees) expect(() => texteShell(c, LIEUX), JSON.stringify(c)).toThrow(expect.objectContaining({ code: 'PERMISSION' }))
  })

  it('sur une racine d’essai, ni le vrai dossier ni la vraie corbeille', () => {
    const essai = lieuxDistants('Tracker-essai')
    expect(essai).toEqual({ racine: '/sdcard/Documents/Tracker-essai', corbeille: '/sdcard/Documents/Tracker-essai-corbeille' })
    expect(() => texteShell({ sorte: 'stat', chemin: `${R}/sessions/a.gpx` }, essai)).toThrow()
    expect(() => texteShell({ sorte: 'creerDossier', chemin: `${C}/2026-11-26/sessions` }, essai)).toThrow()
    expect(() => texteShell({ sorte: 'deplacer', de: `${essai.racine}/sessions/a.gpx`, vers: `${C}/2026-11-26/sessions/a.gpx` }, essai)).toThrow()
  })
})

describe('écriture d’un fichier sur le téléphone', () => {
  it('écrit un fichier neuf : appareils et services relus, stat, push vers .tracker-new, stat du provisoire, mv -f', async () => {
    const distant = `${R}/sessions/sortie d'été.gpx`
    const provisoire = `${distant}.tracker-new`
    const f = faux({ ...PRET_A_ECRIRE, [statCle(distant)]: ABSENT(distant), [statCle(provisoire)]: { stdout: '81b0 5 1763495000\n' } }, NOTRE_SERVEUR)
    await f.t.lister()
    expect(await f.t.ecrire("sessions/sortie d'été.gpx", LOCAL, 5)).toEqual({ chemin: "sessions/sortie d'été.gpx", taille: 5, dateMs: 1763495000000 })
    expect(f.suite.slice(f.suite.lastIndexOf(`shell:${COMMANDE_LISTAGE}`) + 1).filter((c) => c !== 'sonde')).toEqual([
      'devices',
      `shell:${COMMANDE_SERVICES}`,
      statCle(distant),
      'push',
      statCle(provisoire),
      cle({ sorte: 'renommer', de: provisoire, vers: distant }),
    ])
    const envoi = f.appels.find((a) => a.args[2] === 'push')!
    expect(envoi.args).toEqual(['-s', 'SERIE1', 'push', LOCAL, provisoire])
    expect(envoi.delai).toBe(delaiLecture(5))
    expect(f.appels.at(-1)!.args).toEqual(['-s', 'SERIE1', 'shell', `mv -f '${R}/sessions/sortie d'\\''été.gpx.tracker-new' '${R}/sessions/sortie d'\\''été.gpx'`])
    sansArretNiTmp(f)
  })

  it('remplace un fichier qui existe de même : .tracker-new puis mv -f, jamais .tracker-tmp', async () => {
    const distant = `${R}/sessions/a.json`
    const provisoire = `${distant}.tracker-new`
    const f = faux({ ...PRET_A_ECRIRE, [statCle(distant)]: { stdout: '81b0 3 1763400000\n' }, [statCle(provisoire)]: { stdout: '81b0 7 1763495001\n' } }, NOTRE_SERVEUR)
    await f.t.lister()
    expect(await f.t.ecrire('sessions/a.json', LOCAL, 7)).toEqual({ chemin: 'sessions/a.json', taille: 7, dateMs: 1763495001000 })
    expect(auTelephone(f)).toEqual([`shell:${COMMANDE_SERVICES}`, statCle(distant), 'push', statCle(provisoire), cle({ sorte: 'renommer', de: provisoire, vers: distant })])
    sansArretNiTmp(f)
  })

  it('taille fausse : seul le provisoire est retiré (rm -f du .tracker-new), le fichier d’arrivée n’est pas touché', async () => {
    const distant = `${R}/sessions/a.gpx`
    const provisoire = `${distant}.tracker-new`
    const f = faux({ ...PRET_A_ECRIRE, [statCle(distant)]: ABSENT(distant), [statCle(provisoire)]: { stdout: '81b0 4 1763495000\n' } }, NOTRE_SERVEUR)
    await f.t.lister()
    await expect(f.t.ecrire('sessions/a.gpx', LOCAL, 5)).rejects.toThrow('4 octets sur 5')
    expect(auTelephone(f)).toEqual([`shell:${COMMANDE_SERVICES}`, statCle(distant), 'push', statCle(provisoire), cle({ sorte: 'effacerProvisoire', chemin: provisoire })])
    expect(f.appels.at(-1)!.args).toEqual(['-s', 'SERIE1', 'shell', `rm -f '${provisoire}'`])
    sansArretNiTmp(f)
  })

  it('push en échec ou trop long : provisoire retiré, ni stat ni mv', async () => {
    const distant = `${R}/reglages/pc.json`
    const provisoire = `${distant}.tracker-new`
    for (const push of [{ code: 1, stderr: 'adb: error: failed to copy' }, { code: -1, delaiDepasse: true }] as Partial<Sortie>[]) {
      const f = faux({ ...PRET_A_ECRIRE, [statCle(distant)]: ABSENT(distant), push }, NOTRE_SERVEUR)
      await f.t.lister()
      await expect(f.t.ecrire('reglages/pc.json', LOCAL, 5)).rejects.toMatchObject({ code: 'UNKNOWN' })
      expect(auTelephone(f)).toEqual([`shell:${COMMANDE_SERVICES}`, statCle(distant), 'push', cle({ sorte: 'effacerProvisoire', chemin: provisoire })])
    }
  })

  it('mv -f en échec, même muet de code (téléphone ancien) : le provisoire est retiré, l’original reste', async () => {
    const distant = `${R}/tracker.json`
    const provisoire = `${distant}.tracker-new`
    const renommer = cle({ sorte: 'renommer', de: provisoire, vers: distant })
    for (const echec of [{ code: 1, stderr: 'mv: Permission denied' }, { code: 0, stdout: 'mv: Permission denied\n' }] as Partial<Sortie>[]) {
      const f = faux({ ...PRET_A_ECRIRE, [statCle(distant)]: { stdout: '81b0 2 1763400000\n' }, [statCle(provisoire)]: { stdout: '81b0 5 1763495000\n' }, [renommer]: echec }, NOTRE_SERVEUR)
      await f.t.lister()
      await expect(f.t.ecrire('tracker.json', LOCAL, 5)).rejects.toThrow('Permission denied')
      expect(auTelephone(f).slice(-2)).toEqual([renommer, cle({ sorte: 'effacerProvisoire', chemin: provisoire })])
    }
    expect(echecDuShell({ code: 0, stderr: '', stdout: '' })).toBe(false)
  })

  it('refuse d’écrire sur un dossier ou un lien, sans rien envoyer', async () => {
    const distant = `${R}/sessions/x.gpx`
    for (const mode of ['41f9', 'a1ff']) {
      const f = faux({ ...PRET_A_ECRIRE, [statCle(distant)]: { stdout: `${mode} 3452 1763400000\n` } }, NOTRE_SERVEUR)
      await f.t.lister()
      await expect(f.t.ecrire('sessions/x.gpx', LOCAL, 5)).rejects.toMatchObject({ code: 'PERMISSION' })
      expect(auTelephone(f)).toEqual([`shell:${COMMANDE_SERVICES}`, statCle(distant)])
    }
  })

  it('n’écrit rien pendant un enregistrement, ni quand l’activité ne se lit pas', async () => {
    const f = faux({ ...ADB_OK, [`shell:${COMMANDE_SERVICES}`]: { stdout: SERVICES_ENREGISTREMENT } }, NOTRE_SERVEUR)
    await f.t.lister()
    await expect(f.t.ecrire('sessions/a.gpx', LOCAL, 5)).rejects.toEqual(expect.objectContaining({ code: 'PERMISSION', message: MESSAGE_ENREGISTREMENT }))
    await expect(f.t.mettreDeCote(liste('sessions/a.gpx').fichier, `${JOUR}/sessions/a.gpx`)).rejects.toThrow()
    expect(auTelephone(f)).toEqual([`shell:${COMMANDE_SERVICES}`])
    const muet = faux({ ...ADB_OK, [`shell:${COMMANDE_SERVICES}`]: { stdout: 'Permission Denial' } }, NOTRE_SERVEUR)
    await muet.t.lister()
    await expect(muet.t.ecrire('sessions/a.gpx', LOCAL, 5)).rejects.toMatchObject({ code: 'PERMISSION' })
    expect(muet.verbes()).not.toContain('push')
  })

  it('ne lance rien sans listage, ni si la liaison est prise par un autre', async () => {
    const f = faux(PRET_A_ECRIRE, NOTRE_SERVEUR)
    await expect(f.t.ecrire('sessions/a.gpx', LOCAL, 5)).rejects.toThrow("pas été listé")
    await expect(f.t.mettreDeCote(liste('sessions/a.gpx').fichier, `${JOUR}/sessions/a.gpx`)).rejects.toThrow("pas été listé")
    await expect(f.t.listerCorbeille(JOUR)).rejects.toThrow("pas été listé")
    expect(f.appels).toEqual([])
    // Sondes 1 et 2 : notre serveur (appareils, listage) ; à partir de la 3, un autre.
    const pris = faux(PRET_A_ECRIRE, (n) => (n <= 2 ? NOTRE_SERVEUR : { etat: 'version', version: 40 }))
    await pris.t.lister()
    await expect(pris.t.ecrire('sessions/a.gpx', LOCAL, 5)).rejects.toThrow('occupe')
    expect(auTelephone(pris)).toEqual([])
  })

  it('deux appareils branchés depuis le listage : refus, listage oublié, rien envoyé', async () => {
    let appareils = LISTE_PRET
    const f = faux({ ...PRET_A_ECRIRE, devices: () => ({ stdout: appareils }) }, NOTRE_SERVEUR)
    await f.t.lister()
    appareils = LISTE_DEUX
    await expect(f.t.ecrire('sessions/a.gpx', LOCAL, 5)).rejects.toThrow('plusieurs')
    appareils = LISTE_PRET
    await expect(f.t.ecrire('sessions/a.gpx', LOCAL, 5)).rejects.toThrow("pas été listé")
    expect(auTelephone(f)).toEqual([])
  })

  it('un autre téléphone seul à la place de celui du listage : rien ne lui est envoyé', async () => {
    let appareils = LISTE_PRET
    const f = faux({ ...PRET_A_ECRIRE, devices: () => ({ stdout: appareils }) }, NOTRE_SERVEUR)
    await f.t.lister()
    appareils = 'List of devices attached\nSERIE2 device usb:1 model:Autre transport_id:2\n'
    await expect(f.t.ecrire('sessions/a.gpx', LOCAL, 5)).rejects.toThrow("pas été listé")
    await expect(f.t.mettreDeCote(liste('sessions/a.gpx').fichier, `${JOUR}/sessions/a.gpx`)).rejects.toThrow("pas été listé")
    expect(auTelephone(f)).toEqual([])
    for (const { args } of f.appels.filter((a) => a.args[0] === '-s')) expect(args[1]).toBe('SERIE1')
  })

  it('activité relue au plus toutes les 3 s pour les écritures, toujours pour une mise de côté, jamais gardée « occupée »', async () => {
    let maintenant = 0
    let services = SERVICES_LIBRE
    const distant = (n: number) => `${R}/sessions/${n}.json`
    const reponses: Reponses = { ...ADB_OK, [`shell:${COMMANDE_LISTAGE}`]: { stdout: liste('sessions/a.gpx').ligne }, [`shell:${COMMANDE_SERVICES}`]: () => ({ stdout: services }) }
    for (let n = 0; n < 5; n++) {
      reponses[statCle(distant(n))] = ABSENT(distant(n))
      reponses[statCle(`${distant(n)}.tracker-new`)] = { stdout: '81b0 5 1763495000\n' }
    }
    const f = faux(reponses, NOTRE_SERVEUR, { horloge: () => maintenant })
    await f.t.lister()
    const dumpsys = () => f.suite.filter((c) => c === `shell:${COMMANDE_SERVICES}`).length
    await f.t.ecrire('sessions/0.json', LOCAL, 5)
    maintenant = 1_000
    await f.t.ecrire('sessions/1.json', LOCAL, 5)
    maintenant = 2_999
    await f.t.ecrire('sessions/2.json', LOCAL, 5)
    expect(dumpsys()).toBe(1)
    maintenant = 6_000
    await f.t.ecrire('sessions/3.json', LOCAL, 5)
    expect(dumpsys()).toBe(2)
    // Un enregistrement vu une fois n'est jamais « gardé » : chaque écriture relit, et refuse.
    services = SERVICES_ENREGISTREMENT
    maintenant = 9_500
    await expect(f.t.ecrire('sessions/4.json', LOCAL, 5)).rejects.toThrow(MESSAGE_ENREGISTREMENT)
    services = SERVICES_LIBRE
    await f.t.ecrire('sessions/4.json', LOCAL, 5)
    expect(dumpsys()).toBe(4)
    // Une mise de côté relit toujours, même juste après une écriture.
    await f.t.mettreDeCote(liste('sessions/a.gpx').fichier, `${JOUR}/sessions/a.gpx`).catch(() => undefined)
    expect(dumpsys()).toBe(5)
  })

  it('lit les sorties de stat', () => {
    expect(lireStat('81b0 12 1763495000\n')).toEqual({ mode: 0x81b0, taille: 12, dateMs: 1763495000000 })
    expect(lireStat('81b0 12 1763495000\r\n')).toEqual({ mode: 0x81b0, taille: 12, dateMs: 1763495000000 })
    expect(lireStat("stat: 'x': No such file or directory")).toBeNull()
    expect(lireModes(`41f9 ${C}\n41f9 ${C}/2026-11-26\r\nstat: '${C}/2026-11-26/sessions': No such file or directory\n`)).toEqual(new Map([[C, 0x41f9], [`${C}/2026-11-26`, 0x41f9]]))
  })
})

describe('mise de côté sur le téléphone', () => {
  /** Le faux adb, dont les `stat` et `mv` suivent les fichiers présents. */
  function fauxTelephone(fichiers: string[], extra: Reponses = {}, lieux: LieuxDistants = LIEUX) {
    const presents = new Map(fichiers.map((r) => [`${lieux.racine}/${r}`, 4]))
    const dynamique = (args: readonly string[]): Partial<Sortie> => {
      const texte = args[3] ?? ''
      const stat = /^stat -c '%f %s %Y' '(.+)'$/.exec(texte)
      if (stat) return presents.has(stat[1]) ? { stdout: `81b0 ${presents.get(stat[1])} 1763495000\n` } : ABSENT(stat[1])
      const mv = /^mv '(.+)' '(.+)'$/.exec(texte)
      if (mv) {
        presents.set(mv[2], presents.get(mv[1]) ?? 0)
        presents.delete(mv[1])
      }
      return {}
    }
    const f = faux(
      new Proxy({ ...PRET_A_ECRIRE, [`shell:${commandesListage(lieux.racine).listage}`]: () => ({ stdout: [...presents.keys()].map((d) => `81b0 4 1763495000 ${d}\n`).join('') }), ...extra }, {
        get: (cible, nom: string) => cible[nom] ?? (nom.startsWith('shell:stat -c \'%f %s') || nom.startsWith('shell:mv ') ? dynamique : undefined),
      }),
      NOTRE_SERVEUR,
      { nomRacine: lieux.racine.slice('/sdcard/Documents/'.length) },
    )
    return { f, presents }
  }

  it('relit le fichier, la place visée et la corbeille, crée le dossier du jour, déplace, puis relit les deux', async () => {
    const { f, presents } = fauxTelephone(['sessions/a.gpx'])
    const [fichier] = await f.t.lister()
    await f.t.mettreDeCote(fichier, `${JOUR}/sessions/a.gpx`)
    const source = `${R}/sessions/a.gpx`
    const cible = `${C}/2026-11-26/sessions/a.gpx`
    expect(auTelephone(f)).toEqual([
      `shell:${COMMANDE_SERVICES}`,
      statCle(source),
      statCle(`${source}.tracker-tmp`),
      statCle(cible),
      cle({ sorte: 'statDossiers', chemins: [C, `${C}/2026-11-26`, `${C}/2026-11-26/sessions`] }),
      cle({ sorte: 'creerDossier', chemin: `${C}/2026-11-26/sessions` }),
      cle({ sorte: 'deplacer', de: source, vers: cible }),
      statCle(cible),
      statCle(source),
      statCle(`${source}.tracker-tmp`),
    ])
    expect(f.appels.filter((a) => a.args[3]?.startsWith('mv ')).map((a) => a.args)).toEqual([['-s', 'SERIE1', 'shell', `mv '${source}' '${cible}'`]])
    expect([...presents.keys()]).toEqual([cible])
    // Plus au listage : une seconde mise de côté ne lance rien.
    await expect(f.t.mettreDeCote(fichier, `${JOUR}/sessions/a-2.gpx`)).rejects.toThrow("pas été listé")
    for (const { args } of f.appels) expect(args.join(' ')).not.toMatch(/\brm\b|kill-server/)
  })

  it('emporte d’abord le remplacement interrompu caché, sous le même nom suffixé', async () => {
    const { f, presents } = fauxTelephone(['sessions/b.gpx', 'sessions/b.gpx.tracker-tmp'])
    const vus = await f.t.lister()
    expect(vus.map((v) => v.chemin)).toEqual(['sessions/b.gpx'])
    await f.t.mettreDeCote(vus[0], `${JOUR}/sessions/b.gpx`)
    expect(f.appels.filter((a) => a.args[3]?.startsWith('mv ')).map((a) => a.args[3])).toEqual([
      `mv '${R}/sessions/b.gpx.tracker-tmp' '${C}/2026-11-26/sessions/b.gpx.tracker-tmp'`,
      `mv '${R}/sessions/b.gpx' '${C}/2026-11-26/sessions/b.gpx'`,
    ])
    expect([...presents.keys()].sort()).toEqual([`${C}/2026-11-26/sessions/b.gpx`, `${C}/2026-11-26/sessions/b.gpx.tracker-tmp`])
  })

  it('met de côté sous son nom un .tracker-tmp que le téléphone montre à la place de l’original', async () => {
    const { f, presents } = fauxTelephone(['sessions/c.gpx.tracker-tmp'])
    const vus = await f.t.lister()
    expect(vus.map((v) => v.chemin)).toEqual(['sessions/c.gpx'])
    await f.t.mettreDeCote(vus[0], `${JOUR}/sessions/c.gpx`)
    expect(f.appels.filter((a) => a.args[3]?.startsWith('mv ')).map((a) => a.args[3])).toEqual([`mv '${R}/sessions/c.gpx.tracker-tmp' '${C}/2026-11-26/sessions/c.gpx'`])
    expect([...presents.keys()]).toEqual([`${C}/2026-11-26/sessions/c.gpx`])
  })

  it('refuse un fichier changé depuis le listage, une place prise, une corbeille qui n’est pas un dossier : rien de déplacé', async () => {
    const source = `${R}/sessions/a.gpx`
    const change = fauxTelephone(['sessions/a.gpx'])
    const [fichier] = await change.f.t.lister()
    change.presents.set(source, 9)
    await expect(change.f.t.mettreDeCote(fichier, `${JOUR}/sessions/a.gpx`)).rejects.toThrow('changé')
    const prise = fauxTelephone(['sessions/a.gpx'])
    const [f2] = await prise.f.t.lister()
    prise.presents.set(`${C}/2026-11-26/sessions/a.gpx`, 4)
    await expect(prise.f.t.mettreDeCote(f2, `${JOUR}/sessions/a.gpx`)).rejects.toThrow('déjà pris')
    const lien = fauxTelephone(['sessions/a.gpx'], { [cle({ sorte: 'statDossiers', chemins: [C, `${C}/2026-11-26`, `${C}/2026-11-26/sessions`] })]: { stdout: `a1ff ${C}\n` } })
    const [f3] = await lien.f.t.lister()
    await expect(lien.f.t.mettreDeCote(f3, `${JOUR}/sessions/a.gpx`)).rejects.toMatchObject({ code: 'PERMISSION' })
    for (const t of [change, prise, lien]) {
      expect(t.f.appels.filter((a) => /^(mv|mkdir|rm)\b/.test(a.args[3] ?? ''))).toEqual([])
      expect(t.presents.has(source)).toBe(true)
    }
  })

  it('un fichier déjà parti du téléphone : rien à déplacer, pas d’erreur', async () => {
    const { f, presents } = fauxTelephone(['sessions/a.gpx'])
    const [fichier] = await f.t.lister()
    presents.clear()
    await f.t.mettreDeCote(fichier, `${JOUR}/sessions/a.gpx`)
    expect(f.appels.filter((a) => /^(mv|mkdir)\b/.test(a.args[3] ?? ''))).toEqual([])
  })

  it('un mv en échec arrête tout et le dit', async () => {
    const source = `${R}/sessions/a.gpx`
    const cible = `${C}/2026-11-26/sessions/a.gpx`
    const { f, presents } = fauxTelephone(['sessions/a.gpx'], { [cle({ sorte: 'deplacer', de: source, vers: cible })]: { code: 1, stderr: 'mv: Permission denied' } })
    const [fichier] = await f.t.lister()
    await expect(f.t.mettreDeCote(fichier, `${JOUR}/sessions/a.gpx`)).rejects.toThrow('Permission denied')
    expect(auTelephone(f).at(-1)).toBe(cle({ sorte: 'deplacer', de: source, vers: cible }))
    expect(presents.has(source)).toBe(true)
  })

  it('refuse les chemins et destinations hors liste avant toute commande', async () => {
    const { f } = fauxTelephone(['sessions/a.gpx', 'reglages/pc.json', 'tracker.json'])
    await f.t.lister()
    const avant = f.appels.length
    const fichier = (chemin: string): FichierTelephone => ({ chemin, taille: 4, dateMs: 1763495000000 })
    for (const chemin of [...REFUSES, 'reglages/pc.json', 'tracker.json']) await expect(f.t.mettreDeCote(fichier(chemin), `${JOUR}/sessions/a.gpx`), chemin).rejects.toMatchObject({ code: 'PERMISSION' })
    for (const vers of [`${JOUR}/itineraires/a.gpx`, '../a.gpx', `${JOUR}/sessions/../../Tracker/a.gpx`, 'Tracker-corbeille/2026-02-30x/sessions/a.gpx']) {
      await expect(f.t.mettreDeCote(fichier('sessions/a.gpx'), vers), vers).rejects.toMatchObject({ code: 'PERMISSION' })
    }
    for (const chemin of REFUSES) await expect(f.t.ecrire(chemin, LOCAL, 1), chemin).rejects.toMatchObject({ code: 'PERMISSION' })
    for (const d of ['Tracker-corbeille', 'Tracker-corbeille/2026-11-26/sessions', '../x']) await expect(f.t.listerCorbeille(d)).rejects.toMatchObject({ code: 'PERMISSION' })
    expect(f.appels.length).toBe(avant)
  })

  it('sur une racine d’essai, ne vise que Tracker-essai et sa corbeille', async () => {
    const essai = lieuxDistants('Tracker-essai')
    const { f, presents } = fauxTelephone(['sessions/a.gpx'], {}, essai)
    const [fichier] = await f.t.lister()
    await f.t.mettreDeCote(fichier, `${JOUR}/sessions/a.gpx`)
    expect([...presents.keys()]).toEqual(['/sdcard/Documents/Tracker-essai-corbeille/2026-11-26/sessions/a.gpx'])
    for (const a of f.appels) expect(a.args.join(' ')).not.toMatch(/Documents\/Tracker(?!-essai)/)
  })
})

describe('corbeille du téléphone', () => {
  it('liste un jour : fichiers de sessions/ et itineraires/, en chemins vus de la page', async () => {
    const sortie = [
      `81b0 3 1763495000 ${C}/2026-11-26/sessions/a.gpx`,
      `41f9 3452 1763495000 ${C}/2026-11-26/sessions`,
      `81b0 3 1763495000 ${C}/2026-11-26/itineraires/t.json`,
      `81b0 3 1763495000 ${C}/2026-11-26/sessions/b.gpx.tracker-tmp`,
      `81b0 1 1763495000 ${C}/2026-11-26/autre/x`,
      `81b0 1 1763495000 ${C}/2026-11-25/sessions/y.gpx`,
    ].join('\n')
    const f = faux({ ...ADB_OK, [cle({ sorte: 'listageCorbeille', jour: '2026-11-26' })]: { stdout: sortie } }, NOTRE_SERVEUR)
    await f.t.lister()
    expect(await f.t.listerCorbeille(JOUR)).toEqual([`${JOUR}/itineraires/t.json`, `${JOUR}/sessions/a.gpx`, `${JOUR}/sessions/b.gpx.tracker-tmp`])
  })

  it('rend une liste vide si le jour n’existe pas, et se replie sur stat si find ne connaît pas -exec … +', async () => {
    const absent = faux({ ...ADB_OK, [cle({ sorte: 'listageCorbeille', jour: '2026-11-26' })]: { code: 1, stderr: `find: ${C}/2026-11-26: No such file or directory` } }, NOTRE_SERVEUR)
    await absent.t.lister()
    expect(await absent.t.listerCorbeille(JOUR)).toEqual([])
    const repli = faux(
      {
        ...ADB_OK,
        [cle({ sorte: 'listageCorbeille', jour: '2026-11-26' })]: { code: 1, stderr: 'find: Unknown option -exec' },
        [cle({ sorte: 'repliCorbeille', jour: '2026-11-26' })]: { code: 1, stdout: `81b0 3 1763495000 ${C}/2026-11-26/sessions/a.gpx\n`, stderr: `stat: ${C}/2026-11-26/itineraires/*: No such file or directory` },
      },
      NOTRE_SERVEUR,
    )
    await repli.t.lister()
    expect(await repli.t.listerCorbeille(JOUR)).toEqual([`${JOUR}/sessions/a.gpx`])
  })
})

/** Le code d'un fichier, commentaires retirés : ce qu'il peut vraiment lancer. */
function codeSeul(fichier: string): string {
  // Ligne à ligne : un `/*` dans un texte (motif `racine/*` du listage) n'ouvre pas de commentaire.
  let bloc = false
  const lignes: string[] = []
  for (const ligne of readFileSync(path.join(__dirname, fichier), 'utf8').split('\n')) {
    const nette = ligne.trim()
    if (bloc) {
      if (nette.endsWith('*/')) bloc = false
      continue
    }
    if (nette.startsWith('/*')) {
      bloc = !nette.endsWith('*/')
      continue
    }
    if (!nette.startsWith('//')) lignes.push(ligne)
  }
  return lignes.join('\n')
}

describe('liste fermée des commandes et liaison respectée', () => {
  it('n’émet que les commandes voulues, sur tous les chemins du code, jamais l’arrêt du serveur ni un rm d’un fichier de l’utilisateur', async () => {
    const vues: (readonly string[])[] = []
    const noter = (f: ReturnType<typeof faux>) => vues.push(...f.appels.map((a) => a.args))
    const pret = faux(
      {
        ...PRET_A_ECRIRE,
        [`shell:${COMMANDE_LISTAGE}`]: { code: 1, stderr: 'find: Unknown option -exec' },
        [`shell:${COMMANDE_RACINE}`]: { stdout: '41f9' },
        [`shell:${COMMANDE_LISTAGE_REPLI}`]: { stdout: '81b0 1 1763495000 /sdcard/Documents/Tracker/tracker.json\n' },
        [statCle(`${R}/tracker.json`)]: ABSENT(`${R}/tracker.json`),
        [statCle(`${R}/tracker.json.tracker-new`)]: { stdout: '81b0 2 1763495000\n' },
        [statCle(`${R}/fc-repos.json`)]: ABSENT(`${R}/fc-repos.json`),
        push: (args) => (args[4].includes('fc-repos') ? { code: 1, stderr: 'adb: error: failed to copy' } : {}),
        [cle({ sorte: 'listageCorbeille', jour: '2026-11-26' })]: { code: 1, stderr: 'find: Unknown option' },
      },
      { etat: 'aucun' },
    )
    await pret.t.lister()
    await pret.t.lire({ chemin: 'tracker.json', taille: 1, dateMs: 0 }, TEMP)
    await pret.t.enregistrement()
    await pret.t.ecrire('tracker.json', LOCAL, 2)
    await pret.t.ecrire('fc-repos.json', LOCAL, 2).catch(() => undefined)
    await pret.t.listerCorbeille(JOUR)
    noter(pret)
    const retrait = faux(
      {
        ...PRET_A_ECRIRE,
        [`shell:${COMMANDE_LISTAGE}`]: { stdout: `81b0 4 1763495000 ${R}/sessions/b.gpx\n` },
        [statCle(`${R}/sessions/b.gpx`)]: { stdout: '81b0 4 1763495000\n' },
        [statCle(`${R}/sessions/b.gpx.tracker-tmp`)]: { stdout: '81b0 9 1763495000\n' },
        [statCle(`${C}/2026-11-26/sessions/b.gpx`)]: ABSENT(`${C}/2026-11-26/sessions/b.gpx`),
        [statCle(`${C}/2026-11-26/sessions/b.gpx.tracker-tmp`)]: ABSENT(`${C}/2026-11-26/sessions/b.gpx.tracker-tmp`),
      },
      NOTRE_SERVEUR,
    )
    const [b] = await retrait.t.lister()
    await retrait.t.mettreDeCote(b, `${JOUR}/sessions/b.gpx`).catch(() => undefined)
    noter(retrait)
    for (const serveur of [{ etat: 'version', version: 40 }, { etat: 'etranger' }] as Sonde[]) {
      const f = faux(ADB_OK, serveur)
      await f.t.etat()
      noter(f)
    }
    const permis = new Set(['version', 'start-server', 'devices', 'shell', 'pull', 'push'])
    const textesFixes = new Set([COMMANDE_LISTAGE, COMMANDE_RACINE, COMMANDE_LISTAGE_REPLI, COMMANDE_SERVICES])
    const formes = [
      /^stat -c '%f %s %Y' '[^']+'$/,
      /^stat -c '%f %n'( '[^']+')+$/,
      /^mv -f '[^']+\.tracker-new' '[^']+'$/,
      /^mv '\/sdcard\/Documents\/Tracker\/[^']+' '\/sdcard\/Documents\/Tracker-corbeille\/[^']+'$/,
      /^mkdir -p '\/sdcard\/Documents\/Tracker-corbeille\/[^']+'$/,
      /^rm -f '\/sdcard\/Documents\/Tracker\/[^']+\.tracker-new'$/,
      /^find \/sdcard\/Documents\/Tracker-corbeille\/\d{4}-\d{2}-\d{2} -maxdepth 2 -type f -exec stat -c '%f %s %Y %n' \{\} \+$/,
      /^stat -c '%f %s %Y %n' \/sdcard\/Documents\/Tracker-corbeille\/\d{4}-\d{2}-\d{2}\/sessions\/\* \/sdcard\/Documents\/Tracker-corbeille\/\d{4}-\d{2}-\d{2}\/itineraires\/\*$/,
    ]
    for (const args of vues) {
      const verbe = args[0] === '-s' ? args[2] : args[0]
      expect(permis.has(verbe), args.join(' ')).toBe(true)
      if (verbe === 'shell') expect(textesFixes.has(args[3]) || formes.some((f) => f.test(args[3])), args[3]).toBe(true)
      if (verbe === 'pull') expect(args.slice(3, 4)).toEqual(['-a'])
      if (verbe === 'push') expect(args[4]).toMatch(/^\/sdcard\/Documents\/Tracker\/[^/]+(\/[^/]+)?\.tracker-new$/)
      expect(args.join(' ')).not.toMatch(/kill-server/)
      // Un `.tracker-tmp` du téléphone ne se nomme que pour être mis de côté (`mv`) ou relu (`stat`), jamais écrit.
      if (verbe === 'push' || /^(mv -f|rm)\b/.test(args[3] ?? '')) expect(args.join(' ')).not.toMatch(/\/sdcard\/[^ ']*\.tracker-tmp/)
    }
    expect(new Set(vues.map((a) => (a[0] === '-s' ? a[2] : a[0])))).toEqual(permis)
    // Chaque forme a servi : le relevé couvre tout le code.
    for (const forme of formes) expect(vues.some((a) => forme.test(a[3] ?? '')), String(forme)).toBe(true)
  })

  it('n’a dans son code que ces commandes, et un seul passage vers le shell du téléphone', () => {
    const adb = codeSeul('adb.ts')
    expect(adb).not.toMatch(/kill-server/)
    expect(adb).not.toMatch(/\bshell:\s*true/)
    expect(adb).not.toMatch(/(?<![.\w])(exec|spawn|execSync|spawnSync|execFileSync)\(/)
    expect(adb).toContain("import { execFile } from 'node:child_process'")
    expect(adb).toContain('shell: false')
    // Trois lancements seulement : `version` (qui ne parle pas au serveur), `start-server` juste après la sonde, et le
    // passage unique `parLeServeur`, sonde comprise ; une commande de plus ne peut passer que par lui.
    expect([...adb.matchAll(/\blancer\(/g)]).toHaveLength(3)
    expect(adb).toMatch(/lancer\(adb, \['version'\], DELAIS\.court\)/)
    expect(adb).toMatch(/lancer\(o\.adb, \['start-server'\], DELAIS\.demarrage\)/)
    expect(adb).toMatch(/return lancer\(o\.adb, args, delaiMs\)/)
    // Les seuls appels à `parLeServeur` : appareils (état, et avant une écriture), shell, lecture, envoi.
    expect([...adb.matchAll(/parLeServeur\(o, (\[[^\]]*\]|args)/g)].map((m) => m[1])).toEqual([
      "['devices', '-l']",
      "['-s', s, 'shell', texte]",
      "['devices', '-l']",
      "['-s', s, 'pull', '-a', distant, fichierLocal]",
      "['-s', s, 'push', fichierLocal, provisoire]",
    ])
    // Le texte du shell ne vient que de `texteShell`, et chaque commande à écrire y est écrite une fois.
    expect([...adb.matchAll(/'shell', /g)]).toHaveLength(1)
    expect(adb).toContain('const texte = texteShell(commande, lieux)')
    expect([...adb.matchAll(/\brm -f\b/g)]).toHaveLength(1)
    expect([...adb.matchAll(/`rm\b/g)]).toHaveLength(1)
    expect(adb).toContain('return `rm -f ${citerShell(commande.chemin)}`')
    expect(adb).not.toMatch(/\brm -r|\brm -rf|-exec rm|\bunlink\b|\brmdir\b/)
    expect([...adb.matchAll(/`mv -f /g)]).toHaveLength(1)
    expect([...adb.matchAll(/`mv \$\{/g)]).toHaveLength(1)
    expect([...adb.matchAll(/`mkdir -p /g)]).toHaveLength(1)
    expect(adb).not.toMatch(/['"`](cp|touch|chmod|chown|dd|tee|install|uninstall|reboot|root|remount|sideload|tcpip|forward|reverse)['"`\s]/)
    // Le téléphone : aucun lancement de programme, et le seul effacement est celui du provisoire du téléphone d'essai
    // (`unlink(provisoire)`) ou d'un fichier du dossier temporaire du PC (`effacer`).
    const telephone = codeSeul('telephone.ts')
    expect(telephone).not.toContain('child_process')
    expect([...telephone.matchAll(/\bunlink\(/g)].length).toBe(2)
    expect(telephone).toContain('await unlink(provisoire)')
    expect(telephone).not.toMatch(/\brm\(|\brmdir\(/)
    for (const racine of ['/sdcard/Documents/Tracker', '/sdcard/Documents/Tracker-essai-1']) {
      for (const texte of Object.values(commandesListage(racine))) {
        expect(texte).not.toMatch(/\b(rm|mv|cp|mkdir|touch|chmod|chown|dd|tee)\b|>|;|&&|\||`|\$/)
      }
    }
  })
})

/** Chemins refusés à l'écriture et au retrait. */
const REFUSES = [
  '',
  '/sdcard/Documents/Tracker/sessions/a.gpx',
  '/a.gpx',
  'C:\\a.gpx',
  '../a.gpx',
  'sessions/../tracker.json',
  'sessions/..',
  'sessions/.',
  'sessions/',
  'sessions',
  'sessions//a.gpx',
  'sessions/sous/a.gpx',
  'journaux/a.json',
  'en-attente/a.gpx',
  'autre.json',
  'LISEZMOI.txt',
  'lieux.json',
  'TRACKER.JSON',
  'tracker.json/x',
  "sessions/a'; rm -rf /sdcard; '.gpx\n",
  'sessions/a\nb.gpx',
  'sessions/a\rb.gpx',
  'sessions/a\u0000b.gpx',
  'sessions/a\u007fb.gpx',
  'sessions/a.gpx.tracker-tmp',
  'sessions/a.gpx.tracker-new',
  'sessions/a\\b.gpx',
  'sessions/a:b.gpx',
  'sessions/a.gpx ',
  'sessions/nul.gpx',
  `sessions/${'a'.repeat(600)}.gpx`,
]

describe('listages complets ou rien', () => {
  const LIGNES = `81b0 3 1763495000 ${R}/sessions/a.gpx\n81b0 1 1763495000 ${R}/sessions/a.json\n`

  it('un listage au code non nul est une erreur, même avec des lignes lues : rien de plus n’est lancé', async () => {
    for (const echec of [
      { code: 1, stdout: LIGNES, stderr: "find: '/sdcard/Documents/Tracker/sessions/b.gpx': No such file or directory" },
      { code: 1, stdout: LIGNES, stderr: 'find: Permission denied' },
      { code: -1, stdout: LIGNES, stderr: 'maxBuffer exceeded' },
      { code: 1, stdout: '', stderr: 'find: Permission denied' },
    ] as Partial<Sortie>[]) {
      const f = faux({ ...ADB_OK, [`shell:${COMMANDE_LISTAGE}`]: echec }, NOTRE_SERVEUR)
      await expect(f.t.lister()).rejects.toThrow('Listage du téléphone incomplet')
      expect(f.suite.filter((c) => c.startsWith('shell:'))).toEqual([`shell:${COMMANDE_LISTAGE}`])
      await expect(f.t.ecrire('sessions/z.json', LOCAL, 1)).rejects.toThrow('pas été listé')
    }
  })

  it('le repli sur stat ne tolère que ses motifs sans fichier', async () => {
    const base = { ...ADB_OK, [`shell:${COMMANDE_LISTAGE}`]: { code: 1, stderr: 'find: Unknown option -exec' }, [`shell:${COMMANDE_RACINE}`]: { stdout: '41f9\n' } }
    const vide = faux({ ...base, [`shell:${COMMANDE_LISTAGE_REPLI}`]: { code: 1, stdout: LIGNES, stderr: `stat: ${R}/itineraires/*: No such file or directory` } }, NOTRE_SERVEUR)
    expect(await vide.t.lister()).toHaveLength(2)
    const refuse = faux({ ...base, [`shell:${COMMANDE_LISTAGE_REPLI}`]: { code: 1, stdout: LIGNES, stderr: `stat: ${R}/sessions/b.gpx: Permission denied` } }, NOTRE_SERVEUR)
    await expect(refuse.t.lister()).rejects.toThrow('incomplet')
  })

  it('la corbeille du jour : listage partiel refusé, jour absent vide', async () => {
    const jour = cle({ sorte: 'listageCorbeille', jour: '2026-11-26' })
    const partiel = faux({ ...ADB_OK, [jour]: { code: 1, stdout: `81b0 3 1763495000 ${C}/2026-11-26/sessions/a.gpx\n`, stderr: 'find: Permission denied' } }, NOTRE_SERVEUR)
    await partiel.t.lister()
    await expect(partiel.t.listerCorbeille(JOUR)).rejects.toThrow('incomplet')
  })

  it('listage entier pour la copie de sécurité : toute profondeur, provisoires et liens dits, ligne illisible refusée ; lecture du seul listé', async () => {
    const tout = `find ${R} ! -type d -exec stat -c '%f %s %Y %n' {} +`
    const sortie = [
      `81b0 3 1763495000 ${R}/corbeille/x/y/z.json`, `81b0 5 1763495000 ${R}/sessions/a.gpx.tracker-new`, `a1ff 9 1763495000 ${R}/lien`,
    ].join('\n')
    const f = faux({ ...ADB_OK, [`shell:${tout}`]: { stdout: sortie } }, NOTRE_SERVEUR)
    await expect(f.t.listerTout()).rejects.toThrow('pas été listé')
    await f.t.lister()
    expect(await f.t.listerTout()).toEqual([
      { chemin: 'corbeille/x/y/z.json', taille: 3, dateMs: 1763495000000, ordinaire: true },
      { chemin: 'lien', taille: 9, dateMs: 1763495000000, ordinaire: false },
      { chemin: 'sessions/a.gpx.tracker-new', taille: 5, dateMs: 1763495000000, ordinaire: true },
    ])
    await f.t.lireBrut({ chemin: 'corbeille/x/y/z.json', taille: 3, dateMs: 0 }, LOCAL)
    expect(f.appels.at(-1)!.args).toEqual(['-s', 'SERIE1', 'pull', '-a', `${R}/corbeille/x/y/z.json`, LOCAL])
    await expect(f.t.lireBrut({ chemin: '../secret', taille: 3, dateMs: 0 }, LOCAL)).rejects.toThrow('absent du dernier listage')
    await expect(f.t.lireBrut({ chemin: 'corbeille/x/y/z.json', taille: 4, dateMs: 0 }, LOCAL)).rejects.toThrow('absent du dernier listage')
    const coupe = faux({ ...ADB_OK, [`shell:${tout}`]: { stdout: `81b0 3 1763495000 ${R}/a\nb.json\n` } }, NOTRE_SERVEUR)
    await coupe.t.lister()
    await expect(coupe.t.listerTout()).rejects.toThrow('ligne illisible')
    const partiel = faux({ ...ADB_OK, [`shell:${tout}`]: { code: 1, stdout: sortie, stderr: 'find: Permission denied' } }, NOTRE_SERVEUR)
    await partiel.t.lister()
    await expect(partiel.t.listerTout()).rejects.toThrow('incomplet')
  })
})
