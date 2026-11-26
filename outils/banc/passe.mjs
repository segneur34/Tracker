// Lanceur d'un passage du banc : serveurs Vite, Chrome sur profil neuf par script, scripts en parallèle, relevés
// normalisés et comparés entre la version d'avant (un commit, servi depuis un worktree) et l'arbre de travail.
// Usage : node outils/banc/passe.mjs [noms…] [--pages a,b] [--tous] [--avant <commit>] [--scripts-par-cote] [-j N]
//         [--sans-reseau] [--gpx <dossier>] [--brouillon <dossier>] [--temps k] [--captures] [--garder]
//         [--sans-cache] [--nettoyer-avant] [--chrome <premier port>] [--port <port Vite>] (l'avant sur le port suivant)
//         [--exe <Tracker.exe>] (le programme Windows contre Chrome sur le même `dist/` : « avant » est Chrome sur
//         `vite preview`, « après » une instance du programme par script, sur un profil à part ; sans --avant)
// Mode d'emploi : LISEZMOI.md, section « Lanceur ». Registre des scripts : scripts.mjs. Node 22 ou plus, sans dépendance.
// Le passage courant (sans nom) ne comprend plus `tailles` : le jouer par son nom ou `--pages` quand le lot touche la mise en page, le thème ou Réglages.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES, PASSAGE_COURANT, SCRIPTS } from './scripts.mjs';
import { COPIES_AVANT_GARDEES, copiesARetirer, worktreesDe } from './copies.mjs';

const BANC = path.dirname(fileURLToPath(import.meta.url));
const DEPOT = path.resolve(BANC, '..', '..');
const WINDOWS = process.platform === 'win32';
// Premier node_modules qui contient Vite en remontant depuis `depart` (comme outils/verif.mjs), sinon le sien : un
// worktree sous .claude/worktrees/ sert avec celui du dépôt principal, sans jonction.
const modulesDe = (depart) => {
  for (let dossier = depart; ; dossier = path.dirname(dossier)) {
    if (fs.existsSync(path.join(dossier, 'node_modules', 'vite', 'bin', 'vite.js'))) return path.join(dossier, 'node_modules');
    if (path.dirname(dossier) === dossier) return path.join(depart, 'node_modules');
  }
};
const MODULES = modulesDe(DEPOT);
const PORT_APRES = 4191;
const PORT_AVANT = 4192;
// Préchauffage : chaque page chargée une fois (Vite compile à la demande, un premier chargement dépasse les attentes
// des scripts) ; les analyses sans session chargent tout de même leur module.
const PRECHAUFFE = ['/', '/voile', '/voile/analyse', '/course', '/course/analyse', '/surf/analyse', '/fractionne', '/fractionne/analyse',
  '/fractionne/tests', '/enregistrer', '/itineraires', '/statistiques', '/accueil', '/parametres'];
const debut = Date.now();

// --- Options ---
const opts = { noms: [], pages: null, tous: false, avant: null, parCote: false, j: 4, sansReseau: false, gpx: null,
  brouillon: path.join(os.tmpdir(), 'tracker-banc'), temps: null, captures: false, garder: false, sansCache: false, nettoyerAvant: false, chrome: 9400, port: PORT_APRES,
  exe: null };
{
  const a = process.argv.slice(2);
  const valeur = (i, nom) => { if (a[i + 1] === undefined) sortie(2, `${nom} attend une valeur`); return a[i + 1]; };
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === '--pages') opts.pages = valeur(i++, x).split(',').map((p) => p.trim()).filter(Boolean);
    else if (x === '--tous') opts.tous = true;
    else if (x === '--avant') opts.avant = valeur(i++, x);
    else if (x === '--scripts-par-cote') opts.parCote = true;
    else if (x === '-j') opts.j = Math.max(1, Number(valeur(i++, x)) || 1);
    else if (x === '--sans-reseau') opts.sansReseau = true;
    else if (x === '--gpx') opts.gpx = path.resolve(valeur(i++, x));
    else if (x === '--brouillon') opts.brouillon = path.resolve(valeur(i++, x));
    else if (x === '--temps') opts.temps = valeur(i++, x);
    else if (x === '--captures') opts.captures = true;
    else if (x === '--garder') opts.garder = true;
    else if (x === '--sans-cache') opts.sansCache = true;
    else if (x === '--nettoyer-avant') opts.nettoyerAvant = true;
    else if (x === '--chrome') opts.chrome = Number(valeur(i++, x));
    else if (x === '--port') opts.port = Number(valeur(i++, x));
    else if (x === '--exe') opts.exe = path.resolve(valeur(i++, x));
    else if (x === '--aide' || x === '-h') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 8).join('\n')); process.exit(0); }
    else if (x.startsWith('-')) sortie(2, `option inconnue : ${x}`);
    else opts.noms.push(x.replace(/\.mjs$/, ''));
  }
  if (opts.parCote && !opts.avant) sortie(2, '--scripts-par-cote demande --avant <commit>');
  if (opts.pages) for (const p of opts.pages) if (!PAGES.includes(p)) sortie(2, `page inconnue : ${p} (${PAGES.join(', ')})`);
  if (opts.exe && (opts.avant || opts.parCote)) sortie(2, '--exe compare le programme à Chrome : pas de --avant ni de --scripts-par-cote');
  if (opts.exe && !fs.existsSync(opts.exe)) sortie(2, `programme introuvable : ${opts.exe} (le fabriquer : npm run exe)`);
}

// --- Programme Windows (--exe) : l'adresse sous laquelle il sert l'application, lue dans sa source ---
// L'application du programme est celle de `resources/dist` à côté de lui : c'est aussi ce que sert la référence (Chrome),
// pour que seule la coquille change entre les deux côtés.
const ORIGINE_EXE = opts.exe
  ? `https://${/HOTE\s*=\s*'([^']+)'/.exec(fs.readFileSync(path.join(BANC, '..', '..', 'bureau', 'origine.ts'), 'utf8'))?.[1] ?? 'tracker.localhost'}`
  : null;
const DIST_EXE = opts.exe ? path.join(path.dirname(opts.exe), 'resources', 'dist') : null;
// Scripts que le programme ne sait pas jouer : captures d'écran des pages (`shots`), onglet en contexte isolé, et ceux
// qui importent `/src/` dans la page (`dev` : l'application du programme est le build de production, sans sources).
const sansExe = (s, banc) => {
  if (s.nom === 'shots') return 'captures d\'écran';
  if (s.dev) return 'importe /src/ : build de production';
  const f = path.join(banc, `${s.nom}.mjs`);
  const source = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  if (/from\s+'\.\/lib\/(tuiles|lieux)\.mjs'/.test(source)) return 'fausses réponses par Fetch : le protocole de débogage ne voit pas les requêtes de la page';
  return /isolated\s*:\s*true|BANC_CONTEXTE/.test(source) ? 'contexte isolé' : null;
};

function sortie(code, message) { console.error(message); process.exit(code); }

// --- Chrome : la variable CHROME, sinon ses emplacements ordinaires (macOS et Linux relus, non essayés sur le poste) ---
const surLeChemin = (nom) => {
  const r = spawnSync(WINDOWS ? 'where' : 'which', [nom], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? (r.stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? null) : null;
};
function trouverChrome() {
  const impose = process.env.CHROME;
  if (impose) return fs.existsSync(impose) ? impose : sortie(2, `Chrome introuvable : CHROME=${impose} n'existe pas`);
  const fichiers = [];
  if (WINDOWS) {
    for (const v of ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA']) {
      if (process.env[v]) fichiers.push(path.join(process.env[v], 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    for (const racine of ['/Applications', path.join(os.homedir(), 'Applications')]) {
      fichiers.push(path.join(racine, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'), path.join(racine, 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
    }
  }
  const trouve = fichiers.find((f) => fs.existsSync(f));
  if (trouve) return trouve;
  for (const nom of WINDOWS ? ['chrome'] : ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
    const p = surLeChemin(nom);
    if (p) return p;
  }
  return sortie(2, 'Chrome introuvable : poser CHROME=<chemin du programme>');
}
const CHROME = trouverChrome();

// --- Brouillon ---
const B = Object.fromEntries(['releves', 'profils', 'travail', 'captures', 'vite'].map((d) => [d, path.join(opts.brouillon, d)]));
for (const d of Object.values(B)) fs.mkdirSync(d, { recursive: true });

// --- Sélection ---
const parNom = new Map(SCRIPTS.map((s) => [s.nom, s]));
const lancable = (s) => !s.manuel || (s.args.includes('{dossierGpx}') && opts.gpx);
const lignes = []; // { nom, script?, note? } dans l'ordre du tableau
if (opts.noms.length) {
  for (const n of opts.noms) {
    const s = parNom.get(n);
    if (!s) lignes.push({ nom: n, note: 'script inconnu', erreur: true });
    else if (!lancable(s)) lignes.push({ nom: n, note: `non lancé (manuel : ${s.manuel})` });
    else lignes.push({ nom: n, script: s });
  }
} else {
  const choisis = opts.tous ? SCRIPTS.filter(lancable)
    : opts.pages ? SCRIPTS.filter((s) => lancable(s) && s.pages.some((p) => opts.pages.includes(p)))
      : PASSAGE_COURANT.map((n) => parNom.get(n)).filter(lancable);
  for (const s of choisis) lignes.push({ nom: s.nom, script: s });
}
if (opts.sansReseau) for (const l of lignes) if (l.script?.reseau) { l.note = 'écarté (réseau)'; delete l.script; }
if (opts.exe) for (const l of lignes) { const raison = l.script && sansExe(l.script, BANC); if (raison) { l.note = `écarté (programme : ${raison})`; delete l.script; } }
const aLancer = lignes.filter((l) => l.script);

// --- Git ---
const git = (args, cwd = DEPOT) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commitApres = git(['rev-parse', 'HEAD']);
const modifie = git(['status', '--porcelain']).split('\n').filter((l) => l && !/^.. "?(outils\/banc\/|\.vitest\/)/.test(l)).length > 0;
const commitAvant = opts.avant ? git(['rev-parse', `${opts.avant}^{commit}`]) : null;
const cotes = opts.avant || opts.exe ? ['avant', 'apres'] : ['apres'];
// Avec --exe, « avant » est la référence (Chrome) et « après » le programme.
const NOM_COTE = opts.exe ? { avant: 'Chrome', apres: '.exe' } : { avant: 'avant', apres: 'après' };
const racineAvant = commitAvant ? path.join(opts.brouillon, `avant-${commitAvant.slice(0, 7)}`) : null;
const RACINE = { apres: DEPOT, avant: opts.exe ? DEPOT : racineAvant };
const bancDe = (cote) => (cote === 'avant' && opts.parCote ? path.join(racineAvant, 'outils', 'banc') : BANC);

// --- Processus suivis, nettoyage ---
const enfants = new Set();
let jonction = null;
// Tue le processus et ses descendants (Vite et esbuild, Chrome et les siens) : sous Windows, `child.kill` ne tue que le
// processus direct, d'où `taskkill /T` ; ailleurs, chaque enfant est lancé en tête de son groupe (`detached`), tué en entier.
function tuer(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (WINDOWS) { spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' }); return; }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { return; }
  setTimeout(() => {
    if (child.exitCode === null && !child.signalCode) try { process.kill(-child.pid, 'SIGKILL'); } catch { /* déjà fini */ }
  }, 2000).unref();
}
function retirerJonction() {
  if (!jonction) return;
  // Jamais de suppression récursive : elle viderait node_modules du dépôt à travers la jonction (ou le lien).
  try { fs.unlinkSync(jonction); } catch { try { fs.rmdirSync(jonction); } catch (e) { console.error(`jonction non retirée (${jonction}) : ${e.message}`); return; } }
  jonction = null;
}
function nettoyer() {
  for (const c of enfants) tuer(c);
  enfants.clear();
  retirerJonction();
}
process.on('SIGINT', () => { console.error('\nInterrompu : nettoyage…'); nettoyer(); process.exit(130); });
process.on('SIGTERM', () => { nettoyer(); process.exit(143); });

function lancer(cmd, args, options) {
  const child = spawn(cmd, args, { windowsHide: true, detached: !WINDOWS, ...options });
  enfants.add(child);
  child.on('exit', () => enfants.delete(child));
  return child;
}
const fin = (child) => new Promise((r) => { if (child.exitCode !== null || child.signalCode) r(child.exitCode); else child.on('exit', (code) => r(code)); });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Ports ---
const libre = (port) => new Promise((r) => {
  const srv = net.createServer();
  srv.once('error', () => r(false));
  srv.listen(port, '127.0.0.1', () => srv.close(() => r(true)));
});
const portsPris = new Set();
async function prendrePort() {
  for (let p = opts.chrome; p < opts.chrome + 400; p++) {
    if (portsPris.has(p)) continue;
    portsPris.add(p);
    if (await libre(p)) return p;
    portsPris.delete(p);
  }
  throw new Error('aucun port Chrome libre');
}

// --- Chrome ---
async function ouvrirChrome(profil) {
  fs.rmSync(profil, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  fs.mkdirSync(profil, { recursive: true });
  const port = await prendrePort();
  // Sans bac à sable seulement en root (conteneur Linux), où Chrome refuse de démarrer avec.
  const sansBac = process.getuid?.() === 0 ? ['--no-sandbox'] : [];
  const child = lancer(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profil}`,
    '--window-size=1400,1000', '--no-first-run', '--no-default-browser-check', ...sansBac, 'about:blank'], { stdio: 'ignore' });
  const limite = Date.now() + 30000;
  while (Date.now() < limite) {
    if (child.exitCode !== null) break;
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return { port, child }; } catch { /* pas encore */ }
    await pause(200);
  }
  tuer(child);
  portsPris.delete(port);
  throw new Error(`Chrome ne répond pas sur ${port}`);
}
async function fermerChrome({ port, child }) {
  try {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; setTimeout(j, 3000); });
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    await Promise.race([fin(child), pause(5000)]);
    try { ws.close(); } catch { /* déjà fermé */ }
  } catch { /* fermé à la main plus bas */ }
  tuer(child);
  await fin(child);
  portsPris.delete(port);
}

// --- Programme Windows : une instance par script, sur un profil à part, en mode d'essai de la coquille ---
// `TRACKER_BANC=1` (fenêtre cachée, port de débogage accepté, journal sur la sortie) et `TRACKER_PROFIL` (jamais la
// mémoire du vrai programme). `TRACKER_BANC_QUITTER` et `TRACKER_DIST` passent tels quels s'ils sont posés.
async function ouvrirExe(profil) {
  fs.rmSync(profil, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  fs.mkdirSync(profil, { recursive: true });
  // Une mémoire prête d'avance : un dossier neuf, retenu par la coquille sans passer par la carte Mémoire (comme l'OPFS du
  // navigateur, que la page ouvre seule). Les scripts qui relisent les fiches (`records()`) lisent ce dossier par Node.
  const memoire = `${profil}-memoire`;
  fs.rmSync(memoire, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  fs.mkdirSync(memoire, { recursive: true });
  const port = await prendrePort();
  const env = { ...process.env, TRACKER_BANC: '1', TRACKER_PROFIL: profil, TRACKER_MEMOIRE: memoire };
  for (const cle of Object.keys(env)) if (cle.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[cle];
  // Échelle 1 et barres de défilement cachées : les conditions de Chrome sans fenêtre. Sans elles, l'écran du poste (125 %)
  // donne des bordures de 0,8 px et une barre de 15 px qui décale les centres mesurés (relevés « différents » sans que
  // la coquille y soit pour rien).
  const child = lancer(opts.exe, [`--remote-debugging-port=${port}`, '--lang=fr-FR', '--force-device-scale-factor=1', '--hide-scrollbars'], { stdio: ['ignore', 'pipe', 'pipe'], env });
  const journal = [];
  const lire = (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) journal.push(l.trim()); };
  child.stdout.on('data', lire);
  child.stderr.on('data', lire);
  const limite = Date.now() + 30000;
  while (Date.now() < limite) {
    if (child.exitCode !== null) break;
    try {
      const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((c) => c.type === 'page' && c.webSocketDebuggerUrl);
      if (page) return { port, child, ws: page.webSocketDebuggerUrl, journal, memoire };
    } catch { /* pas encore */ }
    await pause(200);
  }
  tuer(child);
  portsPris.delete(port);
  throw new Error(`le programme ne répond pas sur ${port}${journal.length ? ` (${journal.slice(-3).join(' | ')})` : ''}`);
}
async function fermerExe({ port, child }) {
  tuer(child);
  await fin(child);
  portsPris.delete(port);
}
const ouvrir = (cote, profil) => (opts.exe && cote === 'apres' ? ouvrirExe(profil) : ouvrirChrome(profil));
const fermer = (cote, hote) => (opts.exe && cote === 'apres' ? fermerExe(hote) : fermerChrome(hote));

/**
 * Second observateur de la page du programme (le script a le sien) : violations de la politique de contenu, requêtes
 * qu'elle bloque et autres erreurs du journal du navigateur, que `connect` n'écoute pas. Les requêtes que le script bloque
 * lui-même (`Network.setBlockedURLs`) et les échecs réseau ordinaires ne comptent pas.
 */
async function surveiller(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const notes = [];
  const adresses = new Map();
  let id = 0;
  const envoyer = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const p = m.params;
    if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(p.entry.level) && p.entry.source !== 'network') {
      notes.push(`${/Content Security Policy|Refused to/i.test(p.entry.text) ? 'CSP' : 'journal'} : ${p.entry.source} ${p.entry.level} : ${p.entry.text.split('\n')[0].slice(0, 200)}`);
    } else if (m.method === 'Network.requestWillBeSent') adresses.set(p.requestId, p.request.url);
    else if (m.method === 'Network.loadingFailed' && p.blockedReason && p.blockedReason !== 'inspector') {
      notes.push(`CSP : requête bloquée (${p.blockedReason}) : ${(adresses.get(p.requestId) ?? '?').slice(0, 150)}`);
    }
  };
  envoyer('Log.enable');
  envoyer('Network.enable');
  return { notes, close: () => { try { ws.close(); } catch { /* déjà fermé */ } } };
}
async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const attente = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && attente.has(m.id)) { attente.get(m.id)(m); attente.delete(m.id); } };
  return {
    send: (method, params = {}) => new Promise((r) => { const i = ++id; attente.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }),
    close: () => ws.close(),
  };
}

// --- Serveurs Vite ---
const posix = (p) => p.replace(/\\/g, '/');
async function demarrerServeur(cote) {
  const racine = RACINE[cote];
  const port = cote === 'avant' ? opts.port + (PORT_AVANT - PORT_APRES) : opts.port;
  if (!(await libre(port))) throw new Error(`port ${port} déjà pris (un serveur du banc resté en route ? netstat -ano | grep ${port})`);
  const config = path.join(B.vite, `${cote}.config.mts`);
  fs.writeFileSync(config, [
    `// Généré par outils/banc/passe.mjs : la config de l'arbre servi, cache et liste d'accès propres au banc.`,
    `import base from ${JSON.stringify(posix(path.join(racine, 'vite.config.ts')))};`,
    `export default async (env: any) => {`,
    `  const b: any = typeof base === 'function' ? await (base as any)(env) : base;`,
    `  return { ...b, cacheDir: ${JSON.stringify(posix(path.join(B.vite, `cache-${cote}`)))},`,
    `    server: { ...(b.server ?? {}), fs: { ...(b.server?.fs ?? {}), allow: ['.', ${JSON.stringify(posix(MODULES))}] } } };`,
    `};`,
    '',
  ].join('\n'));
  const journal = fs.createWriteStream(path.join(B.vite, `${cote}.log`));
  const child = lancer(process.execPath, [path.join(modulesDe(racine), 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort',
    '--host', '127.0.0.1', '--config', config], { cwd: racine, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BROWSER: 'none' } });
  child.stdout.pipe(journal);
  child.stderr.pipe(journal);
  const limite = Date.now() + 90000;
  while (Date.now() < limite) {
    if (child.exitCode !== null) break;
    try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) return { port, child, base: `http://127.0.0.1:${port}` }; } catch { /* pas encore */ }
    await pause(300);
  }
  tuer(child);
  throw new Error(`serveur ${NOM_COTE[cote]} non prêt (journal : ${path.join(B.vite, `${cote}.log`)})`);
}
// Référence du mode --exe : l'application que le programme emporte (`resources/dist`), servie par `vite preview` (déjà
// construite : rien à compiler, le préchauffage ne sert qu'à relire les polices).
async function demarrerApercu() {
  const port = opts.port;
  if (!(await libre(port))) throw new Error(`port ${port} déjà pris (un serveur du banc resté en route ? netstat -ano | grep ${port})`);
  if (!fs.existsSync(path.join(DIST_EXE, 'index.html'))) throw new Error(`application absente du programme : ${DIST_EXE}`);
  const journal = fs.createWriteStream(path.join(B.vite, 'apercu.log'));
  const child = lancer(process.execPath, [path.join(MODULES, 'vite', 'bin', 'vite.js'), 'preview', '--outDir', DIST_EXE, '--port', String(port), '--strictPort',
    '--host', '127.0.0.1'], { cwd: DEPOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BROWSER: 'none' } });
  child.stdout.pipe(journal);
  child.stderr.pipe(journal);
  const limite = Date.now() + 30000;
  while (Date.now() < limite) {
    if (child.exitCode !== null) break;
    try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) return { port, child, base: `http://127.0.0.1:${port}` }; } catch { /* pas encore */ }
    await pause(300);
  }
  tuer(child);
  throw new Error(`vite preview non prêt (journal : ${path.join(B.vite, 'apercu.log')})`);
}
async function prechauffer(cote, serveur) {
  const chrome = await ouvrirChrome(path.join(B.profils, `prechauffe-${cote}`));
  try {
    const cible = await (await fetch(`http://127.0.0.1:${chrome.port}/json/new?about:blank`, { method: 'PUT' })).json();
    const page = await cdp(cible.webSocketDebuggerUrl);
    for (const chemin of PRECHAUFFE) {
      await page.send('Page.navigate', { url: serveur.base + chemin });
      const limite = Date.now() + 30000;
      while (Date.now() < limite) {
        const r = await page.send('Runtime.evaluate', { expression: `document.readyState === 'complete' && document.body.innerText.trim().length > 20`, returnByValue: true });
        if (r.result?.result?.value === true) break;
        await pause(300);
      }
      await pause(500);
    }
    page.close();
  } finally {
    await fermerChrome(chrome);
  }
}

// --- Empreintes et relevés ---
function empreinteScript(banc, nom) {
  const h = createHash('sha1');
  const fichiers = [path.join(banc, `${nom}.mjs`), path.join(banc, 'make-gpx.mjs')];
  const lib = path.join(banc, 'lib');
  const source = fs.existsSync(fichiers[0]) ? fs.readFileSync(fichiers[0], 'utf8') : '';
  // La bibliothèque commune ne compte que pour les scripts qui l'importent.
  if (source.includes("'./lib/") &&fs.existsSync(lib)) for (const f of fs.readdirSync(lib, { recursive: true }).map(String).sort()) {
    const p = path.join(lib, f);
    if (fs.statSync(p).isFile()) fichiers.push(p);
  }
  for (const f of fichiers) { h.update(posix(path.relative(banc, f))); h.update(fs.existsSync(f) ? fs.readFileSync(f) : ''); }
  return h.digest('hex');
}
const dossierReleves = (cote) => path.join(B.releves, opts.exe ? (cote === 'avant' ? 'exe-chrome' : 'exe-programme') : cote === 'avant' ? commitAvant.slice(0, 7) : `${commitApres.slice(0, 7)}${modifie ? '-modifie' : '-apres'}`);
// Lit-il `TEMPS` ? Côté avant avec `--scripts-par-cote`, c'est le registre de ce commit qui le dit (un script
// d'origine lancé sous horloge accélérée ne prouverait rien) ; sans registre à ce commit, aucun ne l'est.
const registresAvant = new Map();
const accelerable = (cote, s) => {
  if (!opts.temps) return false;
  if (cote === 'apres' || !opts.parCote) return Boolean(s.accelerable);
  const f = path.join(bancDe(cote), 'scripts.mjs');
  if (!registresAvant.has(f)) registresAvant.set(f, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  return new RegExp(`\\{\\s*nom:\\s*'${s.nom}'[^}]*accelerable:\\s*true`).test(registresAvant.get(f));
};
const cleReleve = (cote, s) => createHash('sha1').update([cote === 'avant' ? commitAvant : commitApres, empreinteScript(bancDe(cote), s.nom),
  s.args.join(' '), JSON.stringify(s.env ?? {}), accelerable(cote, s) ? `TEMPS=${opts.temps}` : ''].join('\n')).digest('hex');

// Masques communs à tous les scripts : ce qui change à chaque passage sans rien prouver (identifiant d'appareil,
// horodatage de fiche ou nom de session daté, instant en ms, durée mesurée). Les masques propres à un script s'ajoutent (`scripts.mjs`).
const MASQUES_COMMUNS = [
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, 'UUID'],
  [/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?\b/g, 'DATE'],
  [/\b\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\b/g, 'DATE'],
  [/\b1[6-9]\d{11}\b/g, 'EPOQUE'],
  [/\b\d+(?:[.,]\d+)? ?ms\b/g, 'N ms'],
];
const echapper = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function normaliser(texte, chemins, masques = []) {
  let t = texte.replace(/\r\n/g, '\n');
  for (const [chemin, nom] of chemins) {
    const variantes = new Set([chemin, posix(chemin), chemin.replace(/\\/g, '\\\\'), posix(chemin).replace(/^([A-Za-z]):/, (m, l) => `/${l.toLowerCase()}`)]);
    for (const v of [...variantes].sort((a, b) => b.length - a.length)) t = t.replace(new RegExp(echapper(v), 'gi'), nom);
  }
  t = t.replace(/(127\.0\.0\.1|localhost|\[::1\]):\d+/g, 'HOTE');
  // L'adresse du programme (https, sans port) se lit comme celle de Chrome (http, avec port) une fois masquée.
  if (ORIGINE_EXE) t = t.split(ORIGINE_EXE).join('http://HOTE').split(ORIGINE_EXE.slice('https://'.length)).join('HOTE');
  for (const [re, par] of [...MASQUES_COMMUNS, ...masques]) t = t.replace(re, par);
  return t;
}
const ECHEC = /ÉCHEC/;
const ERREUR = /^\s*(EXCEPTION:|error:)/;

// --- Un script, un côté ---
const serveurs = {};
const enRoute = {};
// Un serveur par côté, démarré et préchauffé à la première demande (l'avant seulement si un relevé lui manque).
const servir = (cote) => (enRoute[cote] ??= (async () => {
  // Mode --exe : le programme sert lui-même l'application (rien à démarrer) ; la référence est `vite preview`.
  if (opts.exe && cote === 'apres') return (serveurs[cote] = { port: null, base: ORIGINE_EXE });
  const s = opts.exe ? await demarrerApercu() : await demarrerServeur(cote);
  await prechauffer(cote, s);
  serveurs[cote] = s;
  return s;
})());
let gpx = null;
const duree = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`; };

async function executer(s, cote) {
  const dossier = dossierReleves(cote);
  fs.mkdirSync(dossier, { recursive: true });
  const fichier = path.join(dossier, `${s.nom}.txt`);
  const meta = path.join(dossier, `${s.nom}.json`);
  const cle = cleReleve(cote, s);
  const reutilisable = cote === 'avant' && !opts.exe && !s.sansCache && !opts.sansCache;
  if (reutilisable && fs.existsSync(meta) && fs.existsSync(fichier)) {
    const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
    if (m.cle === cle && m.statut !== 'délai dépassé' && m.statut !== 'erreur') {
      console.error(`[${NOM_COTE[cote]}] ${s.nom} : relevé réutilisé`);
      return { ...m, fichier, reutilise: true };
    }
  }
  const script = path.join(bancDe(cote), `${s.nom}.mjs`);
  if (!fs.existsSync(script)) return { statut: 'absent', fichier: null };
  const id = `${cote}-${s.nom}`;
  const travail = path.join(B.travail, id);
  const depot = path.join(B.travail, `${id}-dump`);
  const captures = path.join(B.captures, id);
  for (const d of [travail, depot]) { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); fs.mkdirSync(d, { recursive: true }); }
  if (opts.captures) fs.mkdirSync(captures, { recursive: true });
  const source = fs.readFileSync(script, 'utf8');
  const serveur = await servir(cote);
  const t0 = Date.now();
  let chrome;
  let veille = null;
  try {
    chrome = await ouvrir(cote, path.join(B.profils, id));
    if (chrome.ws) veille = await surveiller(chrome.ws);
  } catch (e) {
    if (chrome) await fermer(cote, chrome);
    const r = { statut: 'erreur', detail: e.message, duree: Date.now() - t0, echecs: 0, erreurs: [], fichier: null };
    console.error(`[${NOM_COTE[cote]}] ${s.nom} erreur : ${e.message}`);
    return r;
  }
  const valeurs = { '{port}': String(chrome.port), '{gpx}': gpx?.[0], '{gpx2}': gpx?.[1], '{dossierGpx}': opts.gpx, '{travail}': travail, '{captures}': captures };
  const args = s.args.filter((a) => a !== '{captures?}' || opts.captures).map((a) => (a === '{captures?}' ? captures : valeurs[a] ?? a));
  const env = { ...process.env, ...(s.env ?? {}), BASE: serveur.base, MSYS_NO_PATHCONV: '1', TEMP: travail, TMP: travail, TMPDIR: travail };
  if (/process\.env\.DUMP|const DUMP/.test(source)) env.DUMP = path.join(depot, 'releve');
  if (opts.captures && /process\.env\.SHOT/.test(source)) env.SHOT = path.join(captures, `${s.nom}.png`);
  if (accelerable(cote, s)) env.TEMPS = opts.temps;
  if (chrome.ws) env.BANC_WS = chrome.ws;
  if (chrome.memoire) env.TRACKER_MEMOIRE = chrome.memoire;
  else delete env.TRACKER_MEMOIRE; // côté Chrome : la mémoire est l'OPFS, `records()` la lit par la page
  const child = lancer(process.execPath, [script, ...args], { cwd: travail, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  let depasse = false;
  const minuterie = setTimeout(() => { depasse = true; tuer(child); }, (s.delaiMin ?? 10) * 60000);
  const code = await fin(child);
  clearTimeout(minuterie);
  veille?.close();
  await fermer(cote, chrome);
  const ms = Date.now() - t0;
  // Le dossier mémoire du programme (un chemin complet, montré dans la carte Mémoire) passe avant celui du profil, dont il porte le préfixe.
  const chemins = [[travail, 'TRAVAIL'], [depot, 'TRAVAIL-DUMP'], [captures, 'CAPTURES'], [`${path.join(B.profils, id)}-memoire`, 'MEMOIRE'], [path.join(B.profils, id), 'PROFIL'],
    [RACINE[cote], 'DEPOT'], [DEPOT, 'DEPOT'], [opts.brouillon, 'BROUILLON']];
  if (opts.gpx) chemins.push([opts.gpx, 'GPX']);
  const sortieNorm = normaliser(out, chemins, s.masques);
  const parties = [sortieNorm.trimEnd()];
  // Les diagnostics `[banc]` de la bibliothèque (durées d'attente) changent à chaque passage : hors du relevé comparé.
  const errSansDiag = err.split('\n').filter((l) => !l.startsWith('[banc]')).join('\n');
  if (errSansDiag.trim()) parties.push('--- sortie d\'erreur ---', normaliser(errSansDiag, chemins, s.masques).trimEnd());
  parties.push(`--- code de sortie : ${depasse ? 'délai dépassé' : code} ---`);
  for (const f of fs.readdirSync(depot).sort()) parties.push(`===== relevé ${f} =====`, normaliser(fs.readFileSync(path.join(depot, f), 'utf8'), chemins, s.masques).trimEnd());
  for (const f of s.releve ?? []) {
    const p = path.join(travail, f);
    if (fs.existsSync(p)) parties.push(`===== ${f} =====`, normaliser(fs.readFileSync(p, 'utf8'), chemins, s.masques).trimEnd());
  }
  fs.writeFileSync(fichier, `${parties.join('\n')}\n`);
  const lignesSortie = sortieNorm.split('\n');
  const r = {
    cle, statut: depasse ? 'délai dépassé' : 'fini', code, duree: ms, date: new Date().toISOString(),
    echecs: lignesSortie.filter((l) => ECHEC.test(l)).length, erreurs: lignesSortie.filter((l) => ERREUR.test(l)).map((l) => l.trim()),
  };
  // Côté programme : violations de la politique de contenu et journal de la coquille (autorisations, liens, fermeture).
  if (chrome.ws) {
    r.programme = [...new Set(veille?.notes ?? []), ...chrome.journal.filter((l) => !/^\[Tracker\] prêt/.test(l)).map((l) => `coquille : ${l.replace(/^\[Tracker\] /, '')}`)];
    fs.writeFileSync(path.join(dossier, `${s.nom}.programme.txt`), `${r.programme.join('\n')}\n`);
  }
  fs.writeFileSync(meta, JSON.stringify(r, null, 1));
  if (!opts.garder) for (const d of [travail, depot, path.join(B.profils, id), `${path.join(B.profils, id)}-memoire`]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  const etat = (r.statut !== 'fini' ? r.statut : r.echecs ? `${r.echecs} échec(s)` : code ? `code ${code}` : 'ok') + (r.programme?.length ? ` (${r.programme.length} note(s) du programme)` : '');
  console.error(`[${NOM_COTE[cote]}] ${s.nom} ${etat} ${duree(ms)}`);
  return { ...r, fichier };
}

// --- Passage ---
let miseEnRoute = 0;
let code = 0;
try {
  if (aLancer.length) {
    // Worktree de la version d'avant, son node_modules relié à celui du dépôt : jonction sous Windows (un lien symbolique
    // y demande les droits d'administrateur), lien de dossier ailleurs.
    if (commitAvant) {
      if (!fs.existsSync(path.join(racineAvant, '.git'))) {
        git(['worktree', 'prune']);
        git(['worktree', 'add', '--detach', racineAvant, commitAvant]);
      }
      try { const t = new Date(); fs.utimesSync(racineAvant, t, t); } catch { /* usage non noté : la copie paraîtra plus ancienne */ }
      const nm = path.join(racineAvant, 'node_modules');
      if (!fs.existsSync(nm)) fs.symlinkSync(MODULES, nm, WINDOWS ? 'junction' : 'dir');
      jonction = nm;
    }
    // L'avant ne se sert que si un de ses relevés manque.
    const avantUtile = opts.exe || (commitAvant && aLancer.some(({ script: s }) => {
      if (s.sansCache || opts.sansCache) return true;
      const d = dossierReleves('avant');
      try { return JSON.parse(fs.readFileSync(path.join(d, `${s.nom}.json`), 'utf8')).cle !== cleReleve('avant', s); } catch { return true; }
    }));
    const aServir = cotes.filter((c) => c === 'apres' || avantUtile);
    const fabrique = (async () => {
      const g1 = path.join(B.travail, 'voile.gpx');
      const g2 = path.join(B.travail, 'voile-2.gpx');
      execFileSync(process.execPath, [path.join(BANC, 'make-gpx.mjs'), g1], { stdio: 'ignore' });
      execFileSync(process.execPath, [path.join(BANC, 'make-gpx.mjs'), g2, '1'], { stdio: 'ignore' });
      gpx = [g1, g2];
    })();
    await Promise.all([fabrique, ...aServir.map(async (c) => {
      await servir(c);
    })]);
    miseEnRoute = Date.now() - debut;
    console.error(`mise en route : ${duree(miseEnRoute)} (${aServir.map((c) => `${NOM_COTE[c]} sur ${serveurs[c].port ?? serveurs[c].base}`).join(', ')})`);

    const ordinaires = aLancer.filter((l) => !l.script.solo);
    const solos = aLancer.filter((l) => l.script.solo);
    const sur = (s, c) => executer(s, c).catch((e) => {
      console.error(`[${NOM_COTE[c]}] ${s.nom} erreur : ${e.message}`);
      return { statut: 'erreur', detail: e.message, duree: 0, echecs: 0, erreurs: [], fichier: null };
    });
    const parCote = async (l) => { l.res = {}; await Promise.all(cotes.map(async (c) => { l.res[c] = await sur(l.script, c); })); };
    let suivant = 0;
    await Promise.all(Array.from({ length: Math.min(opts.j, ordinaires.length) }, async () => {
      while (suivant < ordinaires.length) await parCote(ordinaires[suivant++]);
    }));
    for (const l of solos) { l.res = {}; for (const c of cotes) l.res[c] = await sur(l.script, c); }
  }
} catch (e) {
  console.error(`Passage interrompu : ${e.stack ?? e.message}`);
  code = 1;
} finally {
  nettoyer();
  // Le lien node_modules est retiré (`nettoyer`) avant `git worktree remove`, qui le traverserait sinon.
  if (opts.nettoyerAvant && racineAvant && fs.existsSync(racineAvant) && !jonction) {
    try { git(['worktree', 'remove', '--force', racineAvant]); } catch (e) { console.error(`worktree non retiré : ${e.message}`); }
  }
}

// --- Ménage des anciennes copies « avant » ---
// Après un passage réussi : ne garde que les COPIES_AVANT_GARDEES plus récemment utilisées (celle du passage comprise).
// Rien si un autre passage du banc tourne (ports en écoute). Le dossier est partagé avec le banc d'un dépôt voisin :
// seuls les worktrees de CE dépôt (`git worktree list`) sont candidats. Le lien node_modules part seul, sans récursion.
async function menage() {
  if (code !== 0 || opts.exe) return;
  for (const p of [4191, 4192, 4195, 4196, opts.port, opts.port + 1]) {
    if (!(await libre(p))) { console.error(`ménage des copies « avant » reporté : le port ${p} est occupé (un autre passage ?)`); return; }
  }
  const worktrees = worktreesDe(git(['worktree', 'list', '--porcelain'])).map((w) => {
    let utilise = 0;
    try { utilise = fs.statSync(w.chemin).mtimeMs; } catch { /* dossier disparu : le plus ancien */ }
    return { ...w, utilise };
  });
  const aRetirer = copiesARetirer({ worktrees, brouillon: opts.brouillon, courante: racineAvant, garder: COPIES_AVANT_GARDEES });
  for (const copie of aRetirer) {
    try {
      const nm = path.join(copie, 'node_modules');
      let st = null;
      try { st = fs.lstatSync(nm); } catch { /* pas de node_modules */ }
      if (st?.isSymbolicLink()) {
        try { fs.unlinkSync(nm); } catch { fs.rmdirSync(nm); }
      }
      git(['worktree', 'remove', '--force', copie]);
      console.error(`ancienne copie « avant » retirée : ${path.basename(copie)}`);
    } catch (e) { console.error(`copie « avant » non retirée (${copie}) : ${e.message}`); }
  }
  if (aRetirer.length) git(['worktree', 'prune']);
}
try { await menage(); } catch (e) { console.error(`ménage des copies « avant » : ${e.message}`); }

// --- Tableau ---
const identiques = (a, b) => fs.readFileSync(a, 'utf8') === fs.readFileSync(b, 'utf8');
const resultat = (r) => {
  if (!r) return '—';
  if (r.statut === 'absent') return 'absent';
  if (r.statut !== 'fini') return r.statut;
  return r.echecs ? `${r.echecs} échec${r.echecs > 1 ? 's' : ''}` : r.code ? `code ${r.code}` : 'ok';
};
const tableau = [['script', `durée ${NOM_COTE.avant}`, `durée ${NOM_COTE.apres}`, 'résultat', 'console', 'relevé']];
const ecarts = [];
for (const l of lignes) {
  if (!l.res) { tableau.push([l.nom, '', '', l.note ?? '—', '', '']); if (l.erreur) code = 1; continue; }
  const av = l.res.avant;
  const ap = l.res.apres;
  let releve = '(avant absent)';
  if (av?.fichier && ap?.fichier) {
    releve = identiques(av.fichier, ap.fichier) ? 'identique' : 'différent';
    if (releve === 'différent') { ecarts.push(l); code = 1; }
  } else if (!ap?.fichier) releve = '(après absent)';
  const nouvelles = (ap?.erreurs ?? []).filter((e) => !(av?.erreurs ?? []).includes(e));
  if (ap?.statut !== 'fini' || ap.echecs || ap.code || nouvelles.length) code = 1;
  let res = resultat(ap);
  if (av && resultat(av) !== res) res += ` (${NOM_COTE.avant} : ${resultat(av)})`;
  if (ap?.programme?.some((n) => n.startsWith('CSP'))) code = 1;
  const consoleTxt = av ? `${ap?.erreurs?.length ?? 0}${nouvelles.length ? ` (${nouvelles.length} nouv.)` : ''}` : String(ap?.erreurs?.length ?? 0);
  tableau.push([l.nom, av ? (av.reutilise ? `réutilisé (${duree(av.duree)})` : duree(av.duree ?? 0)) : '', duree(ap?.duree ?? 0), res, consoleTxt, releve]);
}
const largeurs = tableau[0].map((_, i) => Math.max(...tableau.map((r) => r[i].length)));
console.log('');
tableau.forEach((r, n) => {
  console.log(r.map((c, i) => c.padEnd(largeurs[i])).join(' | ').trimEnd());
  if (n === 0) console.log(largeurs.map((w) => '-'.repeat(w)).join('-|-'));
});
for (const l of ecarts) {
  const d = spawnSync('git', ['diff', '--no-index', '-U1', '--no-color', l.res.avant.fichier, l.res.apres.fichier], { encoding: 'utf8' });
  const corps = d.stdout.split('\n').filter((x) => !/^(diff --git|index |--- |\+\+\+ )/.test(x));
  console.log(`\n${l.nom} : différent`);
  console.log(corps.slice(0, 20).join('\n') + (corps.length > 20 ? `\n… (${corps.length - 20} lignes de plus)` : ''));
  console.log(`  avant : ${l.res.avant.fichier}\n  après : ${l.res.apres.fichier}`);
}
for (const l of lignes) {
  const nouvelles = (l.res?.apres?.erreurs ?? []).filter((e) => !(l.res?.avant?.erreurs ?? []).includes(e));
  if (nouvelles.length) console.log(`\n${l.nom} : console${l.res.avant ? ' (nouvelles)' : ''}\n  ${[...new Set(nouvelles)].slice(0, 10).join('\n  ')}`);
}
for (const l of lignes) {
  const notes = l.res?.apres?.programme ?? [];
  if (notes.length) console.log(`\n${l.nom} : programme\n  ${[...new Set(notes)].slice(0, 10).join('\n  ')}`);
}
const avantReutilise = lignes.some((l) => l.res?.avant?.reutilise);
console.log(`\npassage : ${duree(Date.now() - debut)}, dont mise en route ${duree(miseEnRoute)}${avantReutilise ? ' ; avant : relevé réutilisé' : ''}`);
console.log(`relevés : ${path.join(B.releves)}`);
process.exitCode = code;
// Filet : une poignée restée ouverte ne retient pas le lanceur.
setTimeout(() => process.exit(process.exitCode ?? 0), 3000).unref();
