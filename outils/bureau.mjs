// Programme Windows de Tracker (coquille Electron du dossier `bureau/`).
//
//   node outils/bureau.mjs           compile l'application et la coquille, puis lance la coquille sur `dist/` pour essayer
//   node outils/bureau.mjs --exe     compile, puis fabrique le dossier du programme : bureau/sortie/Tracker-win32-x64/
//
// Options :
//   --sans-vite      ne refait pas `dist/` (déjà construit)
//   --compiler       compile seulement, sans lancer ni emballer (pour un lanceur, le banc par exemple)
//   -- <arguments>   passés tels quels à la coquille lancée pour essayer (après `--`)
//
// L'essai tourne sur le profil `bureau/sortie/profil-essai/` (jamais la mémoire du programme installé), sauf si
// `TRACKER_PROFIL` est donné. Les autres variables de la coquille (`TRACKER_BANC`…) passent telles quelles.
//
// Prérequis : `npm install` dans `bureau/` (Electron, l'outil d'emballage et celui des fusibles, `@noble/hashes` à la
// version de la racine, vérifiée par `ecartsDeVersion` avant le regroupement de `spake2.js`). La version vient
// de `package.json` à la racine, la seule du projet ; l'outil d'emballage veut trois nombres sans zéro en tête.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUREAU = join(RACINE, 'bureau')
const COMPILE = join(BUREAU, 'dist')
const SORTIE = join(BUREAU, 'sortie')
const DIST = join(RACINE, 'dist')
const ICONE = join(RACINE, 'outils', 'icone-tracker.ico')
/** Programme Electron téléchargé à l'installation de `bureau/` (sauté si les scripts d'installation sont coupés). */
const ELECTRON = join(BUREAU, 'node_modules', 'electron', 'dist', 'electron.exe')

/**
 * Version de la coquille d'après celle de l'application : `1.0.09` donne `1.0.9`, `0.10.05` donne `0.10.5`.
 * La version affichée par l'application reste celle de `package.json`.
 */
export function versionBureau(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim())
  if (!m) throw new Error(`version illisible : « ${version} » (trois nombres séparés par des points attendus)`)
  return m.slice(1, 4).map((n) => String(Number.parseInt(n, 10))).join('.')
}

/** Contenu du package.json de la coquille compilée : son nom, sa version, son point d'entrée. */
export function paquetDeLaCoquille(version) {
  return {
    name: 'tracker',
    productName: 'Tracker',
    description: 'Tracker',
    version: versionBureau(version),
    trackerVersion: version,
    private: true,
    main: 'main.js',
  }
}

/** Environnement des outils lancés : sans `ELECTRON_RUN_AS_NODE`, qui ferait démarrer Electron comme un simple Node. */
export function environnementPropre(env) {
  const propre = { ...env }
  for (const cle of Object.keys(propre)) if (cle.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete propre[cle]
  return propre
}

function etape(titre, commande, argv) {
  console.log(`· ${titre}`)
  const r = spawnSync(process.execPath, [commande, ...argv], { cwd: RACINE, stdio: 'inherit', env: environnementPropre(process.env) })
  if (r.status !== 0) throw new Error(`${titre} : échec (code ${r.status})`)
}

function modulesDe(depart) {
  for (let dossier = depart; ; dossier = dirname(dossier)) {
    if (existsSync(join(dossier, 'node_modules', 'typescript', 'bin', 'tsc'))) return join(dossier, 'node_modules')
    if (dirname(dossier) === dossier) return join(depart, 'node_modules')
  }
}

/** Paquets du calcul de l'appairage, qui doivent être les mêmes pour la coquille et pour la page. */
export const PAQUETS_APPAIRAGE = ['@noble/curves', '@noble/hashes']

/** Version du paquet que Node trouve en partant du dossier `depuis` (son `node_modules`, puis ceux au-dessus), `null` s'il n'y est pas. */
export function versionInstallee(paquet, depuis) {
  for (let d = depuis; ; d = dirname(d)) {
    const fiche = join(d, 'node_modules', paquet, 'package.json')
    if (existsSync(fiche)) return JSON.parse(readFileSync(fiche, 'utf8')).version
    if (dirname(d) === d) return null
  }
}

/**
 * Écarts de version des paquets de l'appairage entre `bureau/` et la racine, un message par écart, vide s'il n'y en
 * a pas. Ces paquets se résolvent depuis `bureau/` dans le regroupement de la coquille, depuis la racine dans la page
 * (donc dans l'APK) : une autre version dans `bureau/node_modules` (dépendance d'un outil d'emballage, ou installation
 * pas à jour) ferait calculer l'appairage par deux bibliothèques différentes. `bureau/package.json` pose la même
 * version que la racine.
 */
export function ecartsDeVersion(bureau, racine, paquets = PAQUETS_APPAIRAGE) {
  const ecarts = []
  for (const paquet of paquets) {
    const vBureau = versionInstallee(paquet, bureau)
    const vRacine = versionInstallee(paquet, racine)
    if (vBureau === null || vBureau !== vRacine) {
      ecarts.push(`${paquet} : version ${vBureau ?? 'absente'} prise depuis bureau/, ${vRacine ?? 'absente'} à la racine ; relancer « npm install » dans le dossier bureau/`)
    }
  }
  return ecarts
}

/**
 * Regroupe le calcul de l'appairage, `bureau/spake2.ts`, et les paquets dont il se sert (`@noble/curves` et
 * `@noble/hashes`, publiés en modules ES seulement) en un seul fichier CommonJS, `bureau/dist/spake2.js`, qui
 * remplace celui de tsc : la coquille le charge par `require('./spake2')`, sans `node_modules` dans l'archive ni
 * chargement d'un module ES à l'exécution, et l'emballage le prend comme ses autres fichiers. Regroupeur : rolldown,
 * celui de Vite, pris là où Vite le trouve. Un `require` resté dans le fichier, ou un écart de version des paquets
 * entre `bureau/` et la racine, arrête la construction.
 */
function regrouperSpake2(modules) {
  const ecarts = ecartsDeVersion(BUREAU, RACINE)
  if (ecarts.length > 0) throw new Error(ecarts.join(' ; '))
  const rolldown = dirname(createRequire(join(modules, 'vite', 'package.json')).resolve('rolldown/package.json'))
  const fichier = join(COMPILE, 'spake2.js')
  rmSync(fichier, { force: true })
  etape("regroupement du calcul de l'appairage (rolldown)", join(rolldown, 'bin', 'cli.mjs'), [
    join(BUREAU, 'spake2.ts'),
    '--format',
    'cjs',
    '--platform',
    'node',
    '--file',
    fichier,
    '--logLevel',
    'warn',
  ])
  if (!existsSync(fichier)) throw new Error(`calcul de l'appairage absent après le regroupement : ${fichier}`)
  const restes = readFileSync(fichier, 'utf8').match(/\brequire\s*\(\s*["'][^"']+["']\s*\)/g)
  if (restes) throw new Error(`calcul de l'appairage regroupé : ${[...new Set(restes)].join(', ')} resté dans ${fichier}`)
}

function compiler({ vite }) {
  if (!existsSync(join(BUREAU, 'node_modules', 'electron'))) {
    throw new Error('Electron absent : lancer « npm install » dans le dossier bureau/')
  }
  if (!existsSync(ELECTRON)) {
    throw new Error('programme Electron non téléchargé : lancer « node node_modules/electron/install.js » dans le dossier bureau/')
  }
  const modules = modulesDe(RACINE)
  if (vite) etape("construction de l'application (vite build)", join(modules, 'vite', 'bin', 'vite.js'), ['build', '--logLevel', 'warn'])
  if (!existsSync(join(DIST, 'index.html'))) throw new Error("dist/index.html absent : construire l'application d'abord")
  rmSync(COMPILE, { recursive: true, force: true })
  etape('compilation de la coquille (tsc -p bureau)', join(modules, 'typescript', 'bin', 'tsc'), ['-p', BUREAU])
  regrouperSpake2(modules)
  const version = JSON.parse(readFileSync(join(RACINE, 'package.json'), 'utf8')).version
  writeFileSync(join(COMPILE, 'package.json'), JSON.stringify(paquetDeLaCoquille(version), null, 2) + '\n', 'utf8')
  return version
}

/** Importe un paquet installé dans `bureau/node_modules`. */
async function importerDuBureau(nom) {
  const require = createRequire(join(BUREAU, 'index.js'))
  return import(pathToFileURL(require.resolve(nom)).href)
}

async function emballer(version) {
  const { packager } = await importerDuBureau('@electron/packager')
  const { flipFuses, FuseVersion, FuseV1Options } = await importerDuBureau('@electron/fuses')
  const electronVersion = JSON.parse(readFileSync(join(BUREAU, 'node_modules', 'electron', 'package.json'), 'utf8')).version
  const semver = versionBureau(version)
  console.log(`· emballage : Tracker ${version} (${semver}), Electron ${electronVersion}`)
  const [dossier] = await packager({
    dir: COMPILE,
    out: SORTIE,
    name: 'Tracker',
    executableName: 'Tracker',
    platform: 'win32',
    arch: 'x64',
    electronVersion,
    appVersion: semver,
    buildVersion: semver,
    appCopyright: 'Tracker',
    icon: ICONE,
    asar: true,
    prune: false,
    overwrite: true,
    quiet: true,
    extraResource: [DIST],
    win32metadata: { CompanyName: 'Tracker', FileDescription: 'Tracker', ProductName: 'Tracker', InternalName: 'Tracker', OriginalFilename: 'Tracker.exe' },
  })
  const exe = join(dossier, 'Tracker.exe')
  // Fusibles : ni démarrage en simple Node (`ELECTRON_RUN_AS_NODE`), ni options de Node par l'environnement, ni
  // débogueur de Node en ligne de commande ; la coquille ne se charge que depuis son archive, et `file://` n'a aucun
  // droit de plus (l'application est servie par la coquille, jamais par `file://`).
  await flipFuses(exe, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  })
  console.log(`· programme : ${exe}`)
  return exe
}

function essayer(argv) {
  const env = environnementPropre(process.env)
  if (!env.TRACKER_PROFIL) env.TRACKER_PROFIL = join(SORTIE, 'profil-essai')
  console.log(`· essai : profil ${env.TRACKER_PROFIL}`)
  const enfant = spawn(ELECTRON, [COMPILE, ...argv], { cwd: RACINE, stdio: 'inherit', env })
  enfant.on('error', (e) => {
    console.error(`Tracker (programme Windows) : la coquille ne démarre pas (${e.message})`)
    process.exitCode = 1
  })
  enfant.on('close', (code) => {
    if (!process.exitCode) process.exitCode = code ?? 0
  })
}

export async function principal(args) {
  const separation = args.indexOf('--')
  const options = separation < 0 ? args : args.slice(0, separation)
  const passes = separation < 0 ? [] : args.slice(separation + 1)
  const version = compiler({ vite: !options.includes('--sans-vite') })
  if (options.includes('--exe')) await emballer(version)
  else if (!options.includes('--compiler')) essayer(passes)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  delete process.env.ELECTRON_RUN_AS_NODE
  principal(process.argv.slice(2)).catch((e) => {
    console.error(`Tracker (programme Windows) : ${e.message}`)
    process.exitCode = 1
  })
}
