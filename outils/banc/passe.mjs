// Lanceur d'un passage du banc : serveurs Vite, Chrome sur profil neuf par script, scripts en parallèle, relevés
// normalisés et comparés entre la version d'avant (un commit, servi depuis un worktree) et l'arbre de travail.
// Usage : node outils/banc/passe.mjs [noms…] [--pages a,b] [--tous] [--avant <commit>] [--scripts-par-cote] [-j N]
//         [--sans-reseau] [--gpx <dossier>] [--brouillon <dossier>] [--temps k] [--captures] [--garder]
//         [--sans-cache] [--nettoyer-avant] [--chrome <premier port>] [--port <port Vite>] (l'avant sur le port suivant)
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

const BANC = path.dirname(fileURLToPath(import.meta.url));
const DEPOT = path.resolve(BANC, '..', '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT_APRES = 4191;
const PORT_AVANT = 4192;
// Préchauffage : chaque page chargée une fois (Vite compile à la demande, un premier chargement dépasse les attentes
// des scripts) ; les analyses sans session chargent tout de même leur module.
const PRECHAUFFE = ['/', '/voile', '/voile/analyse', '/course', '/course/analyse', '/surf/analyse', '/fractionne', '/fractionne/analyse',
  '/fractionne/tests', '/enregistrer', '/itineraires', '/statistiques', '/profil', '/parametres'];
const debut = Date.now();

// --- Options ---
const opts = { noms: [], pages: null, tous: false, avant: null, parCote: false, j: 4, sansReseau: false, gpx: null,
  brouillon: path.join(os.tmpdir(), 'tracker-banc'), temps: null, captures: false, garder: false, sansCache: false, nettoyerAvant: false, chrome: 9400, port: PORT_APRES };
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
    else if (x === '--aide' || x === '-h') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 6).join('\n')); process.exit(0); }
    else if (x.startsWith('-')) sortie(2, `option inconnue : ${x}`);
    else opts.noms.push(x.replace(/\.mjs$/, ''));
  }
  if (opts.parCote && !opts.avant) sortie(2, '--scripts-par-cote demande --avant <commit>');
  if (opts.pages) for (const p of opts.pages) if (!PAGES.includes(p)) sortie(2, `page inconnue : ${p} (${PAGES.join(', ')})`);
}

function sortie(code, message) { console.error(message); process.exit(code); }

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
const aLancer = lignes.filter((l) => l.script);

// --- Git ---
const git = (args, cwd = DEPOT) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commitApres = git(['rev-parse', 'HEAD']);
const modifie = git(['status', '--porcelain']).split('\n').filter((l) => l && !/^.. "?(outils\/banc\/|\.vitest\/)/.test(l)).length > 0;
const commitAvant = opts.avant ? git(['rev-parse', `${opts.avant}^{commit}`]) : null;
const cotes = opts.avant ? ['avant', 'apres'] : ['apres'];
const NOM_COTE = { avant: 'avant', apres: 'après' };
const racineAvant = commitAvant ? path.join(opts.brouillon, `avant-${commitAvant.slice(0, 7)}`) : null;
const RACINE = { apres: DEPOT, avant: racineAvant };
const bancDe = (cote) => (cote === 'avant' && opts.parCote ? path.join(racineAvant, 'outils', 'banc') : BANC);

// --- Processus suivis, nettoyage ---
const enfants = new Set();
let jonction = null;
function tuer(child) {
  if (!child?.pid || child.exitCode !== null) return;
  spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
}
function retirerJonction() {
  if (!jonction) return;
  // Jamais de suppression récursive : elle viderait node_modules du dépôt à travers la jonction.
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
  const child = spawn(cmd, args, { windowsHide: true, ...options });
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
  const child = lancer(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profil}`,
    '--window-size=1400,1000', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
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
    `    server: { ...(b.server ?? {}), fs: { ...(b.server?.fs ?? {}), allow: ['.', ${JSON.stringify(posix(path.join(DEPOT, 'node_modules')))}] } } };`,
    `};`,
    '',
  ].join('\n'));
  const journal = fs.createWriteStream(path.join(B.vite, `${cote}.log`));
  const child = lancer(process.execPath, [path.join(racine, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort',
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
const dossierReleves = (cote) => path.join(B.releves, cote === 'avant' ? commitAvant.slice(0, 7) : `${commitApres.slice(0, 7)}${modifie ? '-modifie' : '-apres'}`);
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
  const s = await demarrerServeur(cote);
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
  const reutilisable = cote === 'avant' && !s.sansCache && !opts.sansCache;
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
  try { chrome = await ouvrirChrome(path.join(B.profils, id)); } catch (e) {
    const r = { statut: 'erreur', detail: e.message, duree: Date.now() - t0, echecs: 0, erreurs: [], fichier: null };
    console.error(`[${NOM_COTE[cote]}] ${s.nom} erreur : ${e.message}`);
    return r;
  }
  const valeurs = { '{port}': String(chrome.port), '{gpx}': gpx?.[0], '{gpx2}': gpx?.[1], '{dossierGpx}': opts.gpx, '{travail}': travail, '{captures}': captures };
  const args = s.args.filter((a) => a !== '{captures?}' || opts.captures).map((a) => (a === '{captures?}' ? captures : valeurs[a] ?? a));
  const env = { ...process.env, ...(s.env ?? {}), BASE: serveur.base, MSYS_NO_PATHCONV: '1', TEMP: travail, TMP: travail };
  if (/process\.env\.DUMP|const DUMP/.test(source)) env.DUMP = path.join(depot, 'releve');
  if (opts.captures && /process\.env\.SHOT/.test(source)) env.SHOT = path.join(captures, `${s.nom}.png`);
  if (accelerable(cote, s)) env.TEMPS = opts.temps;
  const child = lancer(process.execPath, [script, ...args], { cwd: travail, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  let depasse = false;
  const minuterie = setTimeout(() => { depasse = true; tuer(child); }, (s.delaiMin ?? 10) * 60000);
  const code = await fin(child);
  clearTimeout(minuterie);
  await fermerChrome(chrome);
  const ms = Date.now() - t0;
  const chemins = [[travail, 'TRAVAIL'], [depot, 'TRAVAIL-DUMP'], [captures, 'CAPTURES'], [path.join(B.profils, id), 'PROFIL'],
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
  fs.writeFileSync(meta, JSON.stringify(r, null, 1));
  if (!opts.garder) for (const d of [travail, depot, path.join(B.profils, id)]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  const etat = r.statut !== 'fini' ? r.statut : r.echecs ? `${r.echecs} échec(s)` : code ? `code ${code}` : 'ok';
  console.error(`[${NOM_COTE[cote]}] ${s.nom} ${etat} ${duree(ms)}`);
  return { ...r, fichier };
}

// --- Passage ---
let miseEnRoute = 0;
let code = 0;
try {
  if (aLancer.length) {
    // Worktree de la version d'avant, jonction node_modules vers celle du dépôt.
    if (commitAvant) {
      if (!fs.existsSync(path.join(racineAvant, '.git'))) {
        git(['worktree', 'prune']);
        git(['worktree', 'add', '--detach', racineAvant, commitAvant]);
      }
      const nm = path.join(racineAvant, 'node_modules');
      if (!fs.existsSync(nm)) fs.symlinkSync(path.join(DEPOT, 'node_modules'), nm, 'junction');
      jonction = nm;
    }
    // L'avant ne se sert que si un de ses relevés manque.
    const avantUtile = commitAvant && aLancer.some(({ script: s }) => {
      if (s.sansCache || opts.sansCache) return true;
      const d = dossierReleves('avant');
      try { return JSON.parse(fs.readFileSync(path.join(d, `${s.nom}.json`), 'utf8')).cle !== cleReleve('avant', s); } catch { return true; }
    });
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
    console.error(`mise en route : ${duree(miseEnRoute)} (${aServir.map((c) => `${NOM_COTE[c]} sur ${serveurs[c].port}`).join(', ')})`);

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
  if (opts.nettoyerAvant && racineAvant && fs.existsSync(racineAvant)) {
    try { git(['worktree', 'remove', '--force', racineAvant]); } catch (e) { console.error(`worktree non retiré : ${e.message}`); }
  }
}

// --- Tableau ---
const identiques = (a, b) => fs.readFileSync(a, 'utf8') === fs.readFileSync(b, 'utf8');
const resultat = (r) => {
  if (!r) return '—';
  if (r.statut === 'absent') return 'absent';
  if (r.statut !== 'fini') return r.statut;
  return r.echecs ? `${r.echecs} échec${r.echecs > 1 ? 's' : ''}` : r.code ? `code ${r.code}` : 'ok';
};
const tableau = [['script', 'durée avant', 'durée après', 'résultat', 'console', 'relevé']];
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
  if (av && resultat(av) !== res) res += ` (avant : ${resultat(av)})`;
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
const avantReutilise = lignes.some((l) => l.res?.avant?.reutilise);
console.log(`\npassage : ${duree(Date.now() - debut)}, dont mise en route ${duree(miseEnRoute)}${avantReutilise ? ' ; avant : relevé réutilisé' : ''}`);
console.log(`relevés : ${path.join(B.releves)}`);
process.exitCode = code;
// Filet : une poignée restée ouverte ne retient pas le lanceur.
setTimeout(() => process.exit(process.exitCode ?? 0), 3000).unref();
