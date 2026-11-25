import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import type { Server } from 'node:net'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CibleServeur, Lanceur, Sonde, Sortie } from './adb'
import {
  COMMANDE_LISTAGE,
  COMMANDE_LISTAGE_REPLI,
  COMMANDE_RACINE,
  DELAIS,
  cheminsAdb,
  chercherAdb,
  cibleServeur,
  commandesListage,
  delaiLecture,
  dossierAdb,
  etatDesAppareils,
  lireAppareils,
  lireListage,
  lireReponseVersion,
  lireVersionAdb,
  racineDistante,
  sonderServeur,
} from './adb'

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

  it('lit le listage : préfixe retiré, espaces et accents gardés, dossiers et chemins refusés écartés', () => {
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
      'stat: /sdcard/Documents/Tracker/sessions/*: No such file or directory',
      '',
    ].join('\n')
    expect(lireListage(sortie)).toEqual([
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
  options: { demarre?: boolean; env?: Record<string, string>; nomRacine?: string } = {},
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
        [`shell:${COMMANDE_LISTAGE}`]: { code: 1, stderr: 'x' },
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
    const f = faux({ ...ADB_OK, [`shell:${COMMANDE_LISTAGE}`]: { code: 1, stderr: 'x' } }, (n) => (n <= 2 ? NOTRE_SERVEUR : { etat: 'version', version: 40 }))
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
    const absent = faux({ ...ADB_OK, [`shell:${COMMANDE_LISTAGE}`]: { code: 1, stderr: 'bad' }, [`shell:${COMMANDE_RACINE}`]: { code: 1, stderr: 'stat: No such file or directory' } }, NOTRE_SERVEUR)
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

describe('lecture seule et liaison respectée', () => {
  it('n’emploie que des commandes de lecture, jamais l’arrêt du serveur', async () => {
    // Tous les chemins du code ensemble, puis chaque commande émise passée au crible.
    const vues: (readonly string[])[] = []
    const noter = (f: ReturnType<typeof faux>) => vues.push(...f.appels.map((a) => a.args))
    const pret = faux(
      {
        ...ADB_OK,
        [`shell:${COMMANDE_LISTAGE}`]: { code: 1, stderr: 'x' },
        [`shell:${COMMANDE_RACINE}`]: { stdout: '41f9' },
        [`shell:${COMMANDE_LISTAGE_REPLI}`]: { stdout: '81b0 1 1763495000 /sdcard/Documents/Tracker/tracker.json\n' },
      },
      { etat: 'aucun' },
    )
    await pret.t.lister()
    await pret.t.lire({ chemin: 'tracker.json', taille: 1, dateMs: 0 }, TEMP)
    noter(pret)
    for (const serveur of [{ etat: 'version', version: 40 }, { etat: 'etranger' }] as Sonde[]) {
      const f = faux(ADB_OK, serveur)
      await f.t.etat()
      noter(f)
    }
    const deux = faux({ ...ADB_OK, devices: { stdout: LISTE_DEUX } }, NOTRE_SERVEUR)
    await deux.t.lister().catch(() => undefined)
    noter(deux)
    const permis = new Set(['version', 'start-server', 'devices', 'shell', 'pull'])
    const textes = new Set([COMMANDE_LISTAGE, COMMANDE_RACINE, COMMANDE_LISTAGE_REPLI])
    for (const args of vues) {
      const verbe = args[0] === '-s' ? args[2] : args[0]
      expect(permis.has(verbe)).toBe(true)
      if (verbe === 'shell') expect(textes.has(args[3])).toBe(true)
      if (verbe === 'pull') expect(args.slice(3, 4)).toEqual(['-a'])
      expect(args.join(' ')).not.toMatch(/kill-server/)
    }
    expect(new Set(vues.map((a) => (a[0] === '-s' ? a[2] : a[0])))).toEqual(permis)
  })

  it('n’a dans son code aucune commande qui écrit sur le téléphone ou arrête le serveur', () => {
    for (const fichier of ['adb.ts', 'telephone.ts']) {
      const source = readFileSync(path.join(__dirname, fichier), 'utf8')
      expect(source).not.toMatch(/kill-server/)
      expect(source).not.toMatch(/['"`](push|rm|mv|cp|mkdir|touch|install|uninstall|reboot|root|remount|sideload|disable-verity|tcpip|forward|reverse)['"`\s]/)
      expect(source).not.toMatch(/\bshell:\s*true/)
      expect(source).not.toMatch(/(?<![.\w])(exec|spawn|execSync|spawnSync|execFileSync)\(/)
    }
    const adb = readFileSync(path.join(__dirname, 'adb.ts'), 'utf8')
    expect(adb).toContain("import { execFile } from 'node:child_process'")
    expect(adb).toContain('shell: false')
    // Trois lancements seulement : `version` (qui ne parle pas au serveur), `start-server` juste après la sonde, et le
    // passage unique `parLeServeur`, sonde comprise ; une commande de plus ne peut passer que par lui.
    expect([...adb.matchAll(/\blancer\(/g)]).toHaveLength(3)
    expect(adb).toMatch(/lancer\(adb, \['version'\], DELAIS\.court\)/)
    expect(adb).toMatch(/lancer\(o\.adb, \['start-server'\], DELAIS\.demarrage\)/)
    expect(adb).toMatch(/return lancer\(o\.adb, args, delaiMs\)/)
    // Les seuls appels à `parLeServeur` : appareils, shell à texte fixe, lecture.
    expect([...adb.matchAll(/parLeServeur\(o, (\[[^\]]*\]|args)/g)].map((m) => m[1])).toEqual([
      "['devices', '-l']",
      "['-s', s, 'shell', texte]",
      "['-s', s, 'pull', '-a', distant, fichierLocal]",
    ])
    expect(readFileSync(path.join(__dirname, 'telephone.ts'), 'utf8')).not.toContain('child_process')
    for (const racine of ['/sdcard/Documents/Tracker', '/sdcard/Documents/Tracker-essai-1']) {
      for (const texte of Object.values(commandesListage(racine))) {
        expect(texte).not.toMatch(/\b(rm|mv|cp|mkdir|touch|chmod|chown|dd|tee)\b|>|;|&&|\||`|\$/)
      }
    }
  })
})
