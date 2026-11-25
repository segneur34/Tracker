// Coquille Windows de Tracker : l'application de `dist/` dans une fenêtre, servie sous `https://tracker.localhost`
// (voir `origine.ts`), avec la mémoire du navigateur intégré dans le profil de la coquille.
//
// Mode d'essai, pour le banc seulement (`TRACKER_BANC=1`) : fenêtre cachée dont la page fait 1382 × 904 (celle de
// Chrome sans fenêtre), rendu jamais ralenti, port de débogage accepté, aucun accès au réseau réel (les autres hôtes
// sont refusés et journalisés), autorisations et fermetures journalisées sur la sortie, question de fermeture
// répondue seule (`TRACKER_BANC_QUITTER=non` pour rester sur la page). Hors de ce mode, un port de débogage fait quitter.
//
// Fenêtre cachée et demande de fermeture de Windows : après un rechargement de la page, Chromium ajoute au processus
// une seconde fenêtre cachée sans titre, et la demande de fermeture (`taskkill` sans `/F`) part vers elle et non vers
// celle de l'application, qui reste ouverte. Une fenêtre montrée la reçoit toujours : le banc qui essaie la fermeture
// après un rechargement montre la sienne (`TRACKER_BANC_MONTRER`), transparente pour ne rien afficher sur l'écran.
//
// Variables lues :
//   TRACKER_PROFIL         dossier du profil (mémoire, réglages de la fenêtre) au lieu de `%APPDATA%\Tracker`
//   TRACKER_DIST           dossier de l'application à servir au lieu de celui du programme
//   TRACKER_BANC           mode d'essai (« 1 »)
//   TRACKER_BANC_QUITTER   réponse du mode d'essai à la question de fermeture : « oui » (défaut) ou « non »
//   TRACKER_BANC_MONTRER   fenêtre du mode d'essai montrée sans prendre la main : « 1 », ou « transparente »
//   TRACKER_MEMOIRE, TRACKER_DOCUMENTS, TRACKER_BANC_DOSSIER : en mode d'essai seulement, voir `memoire.ts`
//
// Le dossier mémoire (un vrai dossier du disque) est lu et écrit ici, la page y passant par les canaux `memoire:*`
// du pont (`preload.ts`, `memoire.ts`) ; seule la page de la fenêtre principale y a accès (`expediteurAdmis`).

import { BrowserWindow, Menu, app, dialog, ipcMain, net, protocol, screen, session, shell } from 'electron'
import type { OpenDialogOptions, Rectangle, WebContents } from 'electron'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { creerMemoire, gestionnairesMemoire, optionsDepuisEnvironnement } from './memoire'
import { ADRESSE_ACCUEIL, HOTE, estDeLApplication } from './origine'
import { brancherCanaux, expediteurAdmis, uneALaFois } from './pont'
import { CSP, reponseA } from './protocole'
import { STATUT_REFUS, entetesSortants, estUnRefus } from './sortant'

const BANC = process.env.TRACKER_BANC === '1'
const QUITTER_EN_ESSAI = (process.env.TRACKER_BANC_QUITTER ?? 'oui') !== 'non'
const MONTRER_EN_ESSAI = ['1', 'transparente'].includes(process.env.TRACKER_BANC_MONTRER ?? '')
const TRANSPARENTE_EN_ESSAI = process.env.TRACKER_BANC_MONTRER === 'transparente'

/** Fond de la fenêtre avant le premier dessin de la page : celui du thème clair (`--bg`), pour éviter un éclair d'une autre couleur. */
const FOND = '#eaeff3'

/** Taille de la fenêtre au premier lancement. */
const TAILLE_DEFAUT = { width: 1400, height: 1000 }

/**
 * Taille de la page, toujours, en mode d'essai : celle que voit Chrome sans fenêtre lancé avec `--window-size=1400,1000`
 * (cadre et barre d'outils retirés), pour que la mise en page des relevés du banc soit la même des deux côtés.
 */
const TAILLE_ESSAI = { width: 1382, height: 904 }

/** Autorisations accordées à la page ; toute autre demande est refusée. */
const AUTORISATIONS = new Set(['fullscreen', 'clipboard-sanitized-write', 'fileSystem', 'persistent-storage'])

/** Fichier du profil qui retient taille et position de la fenêtre. */
const FICHIER_FENETRE = 'fenetre.json'

function journal(message: string): void {
  if (BANC) console.log(`[Tracker] ${message}`)
}

// ---------- garde du port de débogage ----------
// Un port de débogage donne la main sur la page et sa mémoire : seul le mode d'essai l'accepte.
const DEBOGAGE = ['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk']
const DEBOGAGE_REFUSE = !BANC && DEBOGAGE.some((s) => app.commandLine.hasSwitch(s))

// ---------- version et profil ----------
/** Version de l'application telle qu'elle s'affiche (`1.0.09`), écrite par l'emballage dans le package.json de la coquille. */
function versionAffichee(): string {
  try {
    const paquet = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8')) as { trackerVersion?: string }
    return paquet.trackerVersion ?? app.getVersion()
  } catch {
    return app.getVersion()
  }
}
const VERSION = versionAffichee()

app.setName('Tracker')
if (process.env.TRACKER_PROFIL) app.setPath('userData', path.resolve(process.env.TRACKER_PROFIL))

/** Dossier de l'application à servir : à côté du programme une fois emballé, `dist/` du dépôt sinon. */
const DIST = path.resolve(
  process.env.TRACKER_DIST ?? (app.isPackaged ? path.join(process.resourcesPath, 'dist') : path.join(__dirname, '..', '..', 'dist')),
)

// ---------- service des fichiers ----------
async function servir(requete: Request): Promise<Response> {
  const adresse = new URL(requete.url)
  const reponse = reponseA(DIST, adresse.pathname, (chemin) => {
    try {
      return statSync(chemin).isFile()
    } catch {
      return false
    }
  })
  if (reponse.statut !== 200) return new Response(null, { status: reponse.statut })
  const entetes: Record<string, string> = { 'content-type': reponse.type, 'x-content-type-options': 'nosniff' }
  if (reponse.csp) {
    entetes['content-security-policy'] = CSP
    entetes['cache-control'] = 'no-cache'
  }
  try {
    return new Response(await readFile(reponse.fichier), { status: 200, headers: entetes })
  } catch {
    return new Response(null, { status: 404 })
  }
}

function brancherProtocole(): void {
  protocol.handle('https', (requete) => {
    if (new URL(requete.url).host === HOTE) return servir(requete)
    // Mode d'essai : aucun accès au réseau réel. Les requêtes de cette page passent ici et non par le réseau du
    // navigateur : l'interception du protocole de débogage (`Fetch`) ne les voit pas, un script du banc qui compte sur
    // de fausses réponses les verrait partir pour de bon.
    if (BANC) {
      journal(`réseau refusé : ${new URL(requete.url).host}`)
      return Response.error()
    }
    return relayer(requete)
  })
}

/**
 * Tout autre hôte (tuiles, recherche de lieux) repart sur le réseau, sans repasser par le gestionnaire du protocole,
 * sous le nom du programme (`sortant.ts`). Un refus servi en statut 200 (OpenStreetMap) est rendu en échec, sans image :
 * la page ne le garde pas et ne l'affiche pas comme une tuile.
 */
async function relayer(requete: Request): Promise<Response> {
  const sansCorps = requete.method === 'GET' || requete.method === 'HEAD'
  const reponse = await net.fetch(requete.url, {
    method: requete.method,
    headers: entetesSortants(requete.headers, VERSION),
    ...(sansCorps ? {} : { body: requete.body, duplex: 'half' }),
    bypassCustomProtocolHandlers: true,
  })
  if (!estUnRefus(reponse.headers)) return reponse
  journal(`refus du serveur : ${new URL(requete.url).host}`)
  return new Response(null, { status: STATUT_REFUS })
}

// ---------- fenêtre retenue ----------
type Fenetre = { x?: number; y?: number; width: number; height: number; agrandie: boolean }

function cheminFenetre(): string {
  return path.join(app.getPath('userData'), FICHIER_FENETRE)
}

/** Vrai si une part utile de la fenêtre tombe sur un écran branché (un écran débranché ne doit pas la cacher). */
function visible(cadre: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: e }) => {
    const largeur = Math.min(cadre.x + cadre.width, e.x + e.width) - Math.max(cadre.x, e.x)
    const hauteur = Math.min(cadre.y + cadre.height, e.y + e.height) - Math.max(cadre.y, e.y)
    return largeur >= 100 && hauteur >= 50
  })
}

function lireFenetre(): Fenetre {
  const defaut: Fenetre = { ...(BANC ? TAILLE_ESSAI : TAILLE_DEFAUT), agrandie: false }
  if (BANC || !existsSync(cheminFenetre())) return defaut
  try {
    const lu = JSON.parse(readFileSync(cheminFenetre(), 'utf8')) as Partial<Fenetre>
    const { x, y, width, height } = lu
    if (![width, height].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 400)) return defaut
    const fenetre: Fenetre = { width: width as number, height: height as number, agrandie: lu.agrandie === true }
    if (typeof x === 'number' && typeof y === 'number' && visible({ x, y, width: fenetre.width, height: fenetre.height })) {
      fenetre.x = x
      fenetre.y = y
    }
    return fenetre
  } catch {
    return defaut
  }
}

function retenirFenetre(fenetre: BrowserWindow): void {
  if (BANC) return
  const cadre = fenetre.getNormalBounds()
  const retenue: Fenetre = { ...cadre, agrandie: fenetre.isMaximized() }
  try {
    writeFileSync(cheminFenetre(), JSON.stringify(retenue), 'utf8')
  } catch {
    // Profil en lecture seule : la fenêtre reprendra sa taille par défaut, rien de plus.
  }
}

// ---------- sécurité de la page ----------
function verrouiller(contenu: WebContents): void {
  // Aucune navigation hors de l'application : un lien externe part vers le navigateur de Windows.
  contenu.on('will-navigate', (evenement, adresse) => {
    if (estDeLApplication(adresse)) return
    evenement.preventDefault()
    ouvrirAuDehors(adresse)
  })
  contenu.on('will-redirect', (evenement, adresse) => {
    if (!estDeLApplication(adresse)) evenement.preventDefault()
  })
  contenu.setWindowOpenHandler(({ url }) => {
    ouvrirAuDehors(url)
    return { action: 'deny' }
  })
  contenu.on('will-attach-webview', (evenement) => evenement.preventDefault())
}

/** Seule une adresse `https:` hors de l'application est confiée au navigateur de Windows. */
function ouvrirAuDehors(adresse: string): void {
  let url: URL
  try {
    url = new URL(adresse)
  } catch {
    return
  }
  if (url.protocol !== 'https:' || estDeLApplication(adresse)) return
  journal(`lien externe : ${url.href}`)
  if (!BANC) void shell.openExternal(url.href)
}

function gererAutorisations(): void {
  const s = session.defaultSession
  s.setPermissionRequestHandler((_contenu, autorisation, reponse, details) => {
    const accordee = AUTORISATIONS.has(autorisation) && estDeLApplication(details.requestingUrl)
    journal(`autorisation ${autorisation} : ${accordee ? 'accordée' : 'refusée'}`)
    reponse(accordee)
  })
  s.setPermissionCheckHandler((_contenu, autorisation, origine) => AUTORISATIONS.has(autorisation) && estDeLApplication(origine))
  s.setDevicePermissionHandler(() => false)
}

// ---------- raccourcis ----------
// Le menu de Windows est retiré ; on garde le plein écran (F11) et le zoom au clavier, que le menu portait.
function raccourcis(fenetre: BrowserWindow): void {
  fenetre.webContents.on('before-input-event', (evenement, entree) => {
    if (entree.type !== 'keyDown') return
    const contenu = fenetre.webContents
    if (entree.key === 'F11') fenetre.setFullScreen(!fenetre.isFullScreen())
    else if (entree.control && (entree.key === '+' || entree.key === '=')) contenu.setZoomLevel(Math.min(contenu.getZoomLevel() + 0.5, 4))
    else if (entree.control && entree.key === '-') contenu.setZoomLevel(Math.max(contenu.getZoomLevel() - 0.5, -3))
    else if (entree.control && entree.key === '0') contenu.setZoomLevel(0)
    else return
    evenement.preventDefault()
  })
}

// ---------- fermeture avec un brouillon ----------
// La page retient la fermeture (`beforeunload`) quand un brouillon n'est pas enregistré ; sans cette question,
// la croix de la fenêtre semblerait ne rien faire. Textes en français, écrits ici (l'application n'a pas d'autre langue).
const TEXTES_FERMETURE = {
  question: 'Quitter sans enregistrer ?',
  detail: 'Les modifications de la session ouverte ne sont pas enregistrées.',
  quitter: 'Quitter',
  rester: 'Rester',
}

function questionDeFermeture(fenetre: BrowserWindow): void {
  fenetre.webContents.on('will-prevent-unload', (evenement) => {
    const quitter = BANC
      ? QUITTER_EN_ESSAI
      : dialog.showMessageBoxSync(fenetre, {
          type: 'question',
          buttons: [TEXTES_FERMETURE.quitter, TEXTES_FERMETURE.rester],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
          title: 'Tracker',
          message: TEXTES_FERMETURE.question,
          detail: TEXTES_FERMETURE.detail,
        }) === 0
    journal(`fermeture retenue par la page : ${quitter ? 'quitter' : 'rester'}`)
    if (quitter) evenement.preventDefault()
    // La page reste : une prochaine fermeture videra de nouveau ses écritures.
    else vidageFait = false
  })
}

// ---------- écritures vidées avant de fermer la fenêtre ----------
// La page diffère ses écritures (fiche d'une session, réglages, cache) de quelques centaines de millisecondes : avant
// de fermer la fenêtre, la coquille lui demande de les vider (`coquille:fermeture`) et attend sa réponse
// (`coquille:fermeturePrete`), jamais plus de `DELAI_VIDAGE_MS` : une page figée ne retient pas la fermeture (lot 232).
// La question du brouillon (`questionDeFermeture`) vient ensuite, comme avant.

/** Attente la plus longue de la réponse de la page, en millisecondes. */
const DELAI_VIDAGE_MS = 5000

/** Vrai une fois les écritures vidées pour une fermeture : la demande de fermeture suivante passe. */
let vidageFait = false

/** Vrai d'une fermeture retenue jusqu'à la fin du vidage : une seconde demande pendant ce temps est sans effet. */
let fermetureDemandee = false

/** Réponse attendue de la page, `null` quand rien n'est demandé. */
let vidageAttendu: (() => void) | null = null

/** Vrai quand la page peut répondre : fenêtre ouverte et processus de la page en vie. */
function pageVivante(fenetre: BrowserWindow): boolean {
  return !fenetre.isDestroyed() && !fenetre.webContents.isCrashed()
}

/** Demande à la page de vider ses écritures ; rend quand elle a répondu, au plus tard après `DELAI_VIDAGE_MS`. */
function viderLesEcritures(fenetre: BrowserWindow): Promise<void> {
  journal('vidage des écritures demandé à la page')
  return new Promise((fin) => {
    const finir = (ligne: string) => {
      clearTimeout(plafond)
      vidageAttendu = null
      journal(ligne)
      fin()
    }
    const plafond = setTimeout(() => finir(`écritures non confirmées après ${DELAI_VIDAGE_MS / 1000} s`), DELAI_VIDAGE_MS)
    vidageAttendu = () => finir('écritures vidées')
    fenetre.webContents.send('coquille:fermeture')
  })
}

/**
 * Retient la première demande de fermeture le temps de vider les écritures de la page, puis ferme ; la réponse n'est
 * prise que de la page de cette fenêtre (`expediteurAdmis`). Une page tombée ferme sans attendre.
 */
function viderAvantFermeture(fenetre: BrowserWindow): void {
  fenetre.webContents.ipc.on('coquille:fermeturePrete', (evenement) => {
    if (expediteurAdmis(evenement, fenetre.webContents)) vidageAttendu?.()
  })
  fenetre.on('close', (evenement) => {
    if (vidageFait) return
    if (fermetureDemandee) {
      evenement.preventDefault()
      return
    }
    if (!pageVivante(fenetre)) return
    evenement.preventDefault()
    fermetureDemandee = true
    void viderLesEcritures(fenetre).then(() => {
      fermetureDemandee = false
      vidageFait = true
      if (!fenetre.isDestroyed()) fenetre.close()
    })
  })
}

// ---------- le pont : dossier mémoire ----------
/** Dossier de Windows, ou son repli sous le dossier de l'utilisateur s'il n'est pas défini. */
function dossierWindows(nom: 'documents' | 'home'): string {
  try {
    return app.getPath(nom)
  } catch {
    return nom === 'documents' ? path.join(app.getPath('home'), 'Documents') : app.getPath('home')
  }
}

/**
 * Fenêtre de choix d'un dossier de Windows, ouverte par le processus principal : la page ne voit jamais que la
 * réponse. Une seule à la fois : un appel pendant qu'elle est ouverte reçoit la même réponse.
 */
const choisirParFenetre = uneALaFois(async ({ titre, depart }: { titre: string; depart: string }): Promise<string | null> => {
  const options: OpenDialogOptions = {
    title: titre,
    defaultPath: depart,
    properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
  }
  const fenetre = fenetrePrincipale
  const { canceled, filePaths } = fenetre ? await dialog.showOpenDialog(fenetre, options) : await dialog.showOpenDialog(options)
  return canceled || filePaths.length === 0 ? null : filePaths[0]
})

function brancherPont(): void {
  const memoire = creerMemoire(
    optionsDepuisEnvironnement(
      process.env,
      { profil: app.getPath('userData'), documents: dossierWindows('documents'), maison: dossierWindows('home') },
      choisirParFenetre,
      journal,
    ),
  )
  brancherCanaux(
    ipcMain,
    (evenement) => expediteurAdmis(evenement, fenetrePrincipale?.webContents ?? null),
    gestionnairesMemoire(memoire),
    journal,
  )
}

// ---------- fenêtre ----------
let fenetrePrincipale: BrowserWindow | null = null

function ouvrirFenetre(): void {
  const retenue = lireFenetre()
  const fenetre = new BrowserWindow({
    ...(retenue.x !== undefined ? { x: retenue.x, y: retenue.y } : {}),
    width: retenue.width,
    height: retenue.height,
    useContentSize: BANC,
    minWidth: 360,
    minHeight: 480,
    show: false,
    title: 'Tracker',
    backgroundColor: FOND,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
      backgroundThrottling: !BANC,
      additionalArguments: [`--tracker-version=${VERSION}`],
    },
  })
  fenetrePrincipale = fenetre
  raccourcis(fenetre)
  questionDeFermeture(fenetre)
  viderAvantFermeture(fenetre)
  if (!BANC) {
    fenetre.once('ready-to-show', () => {
      if (retenue.agrandie) fenetre.maximize()
      fenetre.show()
    })
    fenetre.on('close', () => retenirFenetre(fenetre))
  }
  if (BANC && MONTRER_EN_ESSAI) {
    fenetre.once('ready-to-show', () => {
      if (TRANSPARENTE_EN_ESSAI) fenetre.setOpacity(0)
      fenetre.showInactive()
    })
  }
  fenetre.webContents.on('render-process-gone', (_e, details) => journal(`page arrêtée : ${details.reason}`))
  fenetre.on('close', () => journal('fermeture demandée'))
  fenetre.on('closed', () => {
    journal('fenêtre fermée')
    fenetrePrincipale = null
  })
  void fenetre.loadURL(ADRESSE_ACCUEIL)
}

function demarrer(): void {
  app.on('second-instance', () => {
    const fenetre = fenetrePrincipale
    if (!fenetre) return
    if (fenetre.isMinimized()) fenetre.restore()
    fenetre.focus()
  })

  // Chaque contenu est verrouillé dès sa création, la fenêtre principale comme tout autre ouvert par une voie imprévue.
  app.on('web-contents-created', (_e, contenu) => verrouiller(contenu))

  app.on('window-all-closed', () => app.quit())

  void app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    gererAutorisations()
    brancherProtocole()
    brancherPont()
    journal(`prêt : ${ADRESSE_ACCUEIL}, application ${DIST}, profil ${app.getPath('userData')}`)
    ouvrirFenetre()
  })
}

if (DEBOGAGE_REFUSE) {
  // Port de débogage sans le mode d'essai : on quitte avant d'ouvrir quoi que ce soit.
  app.exit(1)
} else if (!app.requestSingleInstanceLock()) {
  // Le verrou est pris dans le dossier du profil : deux profils d'essai peuvent tourner ensemble. Un second
  // lancement sur le même profil réveille la première fenêtre (`second-instance`) et s'arrête.
  app.quit()
} else {
  demarrer()
}
