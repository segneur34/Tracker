// Lanceur des scripts du banc qui lancent eux-mêmes le programme Windows (hors du registre de `passe.mjs`) : il les joue
// côte à côte, chacun sur son port de débogage, ne joue que ceux qu'on nomme, et rend une ligne par script (contrôles
// réussis et ratés, durée) puis le total. La sortie entière d'un script en échec est gardée dans le dossier temporaire
// du système (`trk-tous-*`), chemin donné sous sa ligne. Repris du lot 535 de Gtracker (lot 250-0).
// Usage : node outils/banc/exe-tous.mjs [<Tracker.exe>] [noms…] [-j N] [--liste] [--garder] [--arreter-apres <s>]
//   <Tracker.exe> : par défaut bureau/sortie/Tracker-win32-x64/Tracker.exe (`npm run exe`) ;
//   noms : ceux de `--liste` (le nom du fichier sans `exe-` ni `.mjs` ; `exe-fermeture`, `memoire-disque.mjs` passent aussi),
//          tous par défaut ; `-j N` : N scripts à la fois (un script marqué « seul » passe à part, après les autres) ;
//   --liste : quel script rejouer quand tel fichier change, puis rien d'autre ;
//   --garder : garde aussi la sortie des scripts réussis ; --arreter-apres <s> : essai de l'arrêt, comme un Ctrl+C.
// `exe-synchroniser-essai.mjs` n'y entre jamais : il vise le vrai téléphone, câble branché, avec l'accord de l'utilisateur.
// `exe-import` et `exe-tuiles` restent à `passe.mjs --exe`, qui a son propre registre.
// Un arrêt (Ctrl+C, fenêtre fermée) ferme chaque script en cours avec sa descendance, par son numéro de processus
// (`taskkill /T /F /PID`), jamais par le nom de l'image : un Tracker ouvert par l'utilisateur, ou un Gtracker, peut
// tourner. Les scripts sont lancés détachés (groupe de processus à part) : le Ctrl+C n'arrive qu'ici, et l'arbre est
// encore entier quand on le ferme. Mode d'emploi : LISEZMOI.md, section « Programme Windows ». Node 22 ou plus, sans dépendance.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BANC = path.dirname(fileURLToPath(import.meta.url));
const DEPOT = path.resolve(BANC, '..', '..');
export const EXE_DEFAUT = path.join('bureau', 'sortie', 'Tracker-win32-x64', 'Tracker.exe');

// Trois scripts aujourd'hui : tous à la fois. Le défaut reste celui de Gtracker (cinq, éprouvé là-bas à 1, 2, 3 et 5),
// pour les scripts à venir (exe-sansfil, part sans fil de synchroniser, lot 250-6).
export const J_DEFAUT = 5;
// Au-delà, un script est fermé et compté sans verdict (le plus long, memoire, dure environ 55 s seul le 27/11).
const PLAFOND_MS = 30 * 60 * 1000;

// Ports de débogage : distincts de ceux du banc de Gtracker (9530 à 9580, son Chrome 9480) et des sondes (9400, 9450),
// pour que les bancs des deux programmes tournent sur le même poste sans se prendre leurs ports. Réservés, hors de la
// table : 9640 pour `exe-synchroniser-essai.mjs` (vrai téléphone, jamais ici), 9660 pour le futur `exe-sansfil.mjs` et
// 9635 pour la part sans fil d'`exe-synchroniser.mjs` (`--sansfil`, lot 250-6).
export const PORTS_RESERVES = { 9635: 'exe-synchroniser.mjs --sansfil (lot 250-6)', 9640: 'exe-synchroniser-essai.mjs (vrai téléphone)', 9660: 'exe-sansfil.mjs (lot 250-6)' };
export const PORTS_PRIS_AILLEURS = [9400, 9450, 9480, 9530, 9535, 9540, 9560, 9570, 9575, 9580];

// Fichiers dont un changement justifie de rejouer tous les scripts : pont et protocole de la coquille, emballage du
// programme, harnais du banc.
export const COMMUNS = [
  'bureau/preload.ts', 'bureau/pont.ts', 'bureau/protocole.ts', 'bureau/origine.ts',
  'bureau/main.ts (hors de la fermeture : mode d\'essai, fenêtre)', 'src/platform/desktopBridge.ts',
  'outils/bureau.mjs (npm run exe)', 'outils/banc/lib/cdp.mjs',
];

// La table du lanceur. `port` : port de débogage du programme ; `fixes` : ports TCP fixes de plus (aucun aujourd'hui) ;
// `duree` : ordre de grandeur en secondes, seul sur le poste, pour lancer les plus longs d'abord ; `seul` : ne supporte
// pas de voisin ; `quand` : ce dont un changement justifie de le rejouer (en plus de `COMMUNS`).
export const SCRIPTS_EXE = [
  {
    nom: 'synchroniser', fichier: 'exe-synchroniser.mjs', port: 9630, duree: 30,
    quand: ['bureau/telephone.ts', 'bureau/adb.ts', 'bureau/copieSecurite.ts', 'bureau/disque.ts',
      'src/library/sync*.ts', 'src/hooks/sessionLibrary/{phoneSync,sync,syncRouteFiles}.ts',
      'src/components/PhoneSyncButton.tsx (« Synchroniser avec le téléphone »)', 'src/platform/phoneCable.ts',
      'corbeille : src/library/trash*.ts, src/hooks/sessionLibrary/trash*.ts', 'src/planning/routeRecord.ts'],
  },
  {
    nom: 'memoire', fichier: 'memoire-disque.mjs', port: 9670, duree: 55,
    quand: ['bureau/memoire.ts', 'bureau/disque.ts', 'src/platform/memoryFolder.ts', 'src/platform/diskMemory.ts',
      'src/components/MemoryStatus.tsx', 'src/hooks/sessionLibrary/memory.ts',
      'corbeille : src/library/trash*.ts, src/hooks/sessionLibrary/trash*.ts, src/hooks/useTrash.ts, src/components/TrashZone.tsx'],
  },
  {
    nom: 'fermeture', fichier: 'exe-fermeture.mjs', port: 9680, duree: 45,
    quand: ['bureau/main.ts (question de fermeture)', 'src/main.tsx',
      'src/hooks/sessionLibrary/lifecycle.ts (écritures vidées)', 'src/hooks/useSessionDraft.ts', 'src/hooks/sessionDraftStore.ts',
      'src/library/sessionEdits.ts'],
  },
];

/** Ce que la ligne de commande demande ; lève une erreur au texte montrable sur une option fausse. */
export function lireArguments(argv) {
  const opts = { exe: null, noms: [], j: J_DEFAUT, liste: false, garder: false, arreterApres: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const valeur = () => {
      if (argv[i + 1] === undefined) throw new Error(`${x} attend une valeur`);
      return argv[++i];
    };
    if (x === '-j') {
      const n = Number(valeur());
      if (!Number.isInteger(n) || n < 1) throw new Error(`-j attend un entier positif, pas « ${argv[i]} »`);
      opts.j = n;
    } else if (x === '--liste') opts.liste = true;
    else if (x === '--garder') opts.garder = true;
    else if (x === '--arreter-apres') {
      const s = Number(valeur());
      if (!(s > 0)) throw new Error(`--arreter-apres attend des secondes, pas « ${argv[i]} »`);
      opts.arreterApres = s;
    } else if (x.startsWith('-')) throw new Error(`option inconnue : ${x}`);
    else if (/\.exe$/i.test(x)) {
      if (opts.exe) throw new Error(`deux programmes donnés : ${opts.exe} et ${x}`);
      opts.exe = x;
    } else opts.noms.push(x);
  }
  return opts;
}

const nomCourt = (x) => x.replace(/\.mjs$/i, '').replace(/^exe-/i, '').toLowerCase();

/** Les entrées de la table pour ces noms (toutes sans nom), dans l'ordre de la table, sans doublon. */
export function choisirScripts(noms, table = SCRIPTS_EXE) {
  if (noms.length === 0) return [...table];
  const voulus = new Set();
  for (const n of noms) {
    const court = nomCourt(n);
    const trouve = table.find((e) => e.nom === court) ?? table.find((e) => nomCourt(e.fichier) === court && !e.args);
    if (!trouve) {
      const raison = court === 'synchroniser-essai' ? ' : il vise le vrai téléphone et se joue seul, câble branché' : '';
      throw new Error(`script inconnu : ${n}${raison} (connus : ${table.map((e) => e.nom).join(', ')})`);
    }
    voulus.add(trouve);
  }
  return table.filter((e) => voulus.has(e));
}

/** Ceux qui passent côte à côte, les plus longs d'abord, et ceux qui passent seuls, après. */
export function repartir(entrees) {
  return {
    ensemble: entrees.filter((e) => !e.seul).sort((a, b) => b.duree - a.duree),
    seuls: entrees.filter((e) => e.seul),
  };
}

/**
 * Verdict d'un script : son code de sortie d'abord (0 réussi, 1 échec), puis ses lignes `ok` et `ÉCHEC`. Code 0 sans
 * aucun contrôle, ou avec une ligne `ÉCHEC`, ou code autre sans ligne `ÉCHEC` (exception, arrêt) : sans verdict.
 */
export function lireVerdict(sortie, code) {
  const lignes = sortie.split(/\r?\n/);
  const echecs = lignes.filter((l) => l.startsWith('ÉCHEC'));
  const reussis = lignes.filter((l) => l.startsWith('ok ')).length;
  let verdict = 'sans verdict';
  if (code === 0 && echecs.length === 0 && reussis > 0) verdict = 'ok';
  else if (code === 1 && echecs.length > 0) verdict = 'échec';
  return { verdict, reussis, rates: echecs.length, echecs };
}

export const duree = (ms) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`;
};

/** La table de `--liste`, en lignes de texte. */
export function texteListe(table = SCRIPTS_EXE) {
  const l = ['Quel script rejouer quand tel fichier change (node outils/banc/exe-tous.mjs <noms…>) :', ''];
  l.push(`tous : ${COMMUNS.join(', ')}`);
  for (const e of table) {
    const marque = [`port ${e.port}`, `environ ${duree(e.duree * 1000)}`, e.seul ? 'seul' : null].filter(Boolean).join(', ');
    l.push(`${e.nom} (${e.fichier}${e.args ? ` ${e.args.join(' ')}` : ''}, ${marque}) : ${e.quand.join(', ')}`);
  }
  l.push('', 'Hors du lanceur : exe-synchroniser-essai.mjs (vrai téléphone, câble branché, seul) ; exe-import et exe-tuiles (passe.mjs --exe).');
  return l.join('\n');
}

// --- Exécution ---

const portLibre = (port) => new Promise((ok) => {
  const s = net.createServer();
  s.once('error', () => ok(false));
  s.listen(port, '127.0.0.1', () => s.close(() => ok(true)));
});

const fermerArbre = (pid) => spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });

async function principal() {
  let opts;
  try { opts = lireArguments(process.argv.slice(2)); } catch (e) { console.error(`${e.message}\nUsage : node outils/banc/exe-tous.mjs [<Tracker.exe>] [noms…] [-j N] [--liste]`); process.exit(2); }
  if (opts.liste) { console.log(texteListe()); return; }
  let entrees;
  try { entrees = choisirScripts(opts.noms); } catch (e) { console.error(e.message); process.exit(2); }
  const exe = path.resolve(DEPOT, opts.exe ?? EXE_DEFAUT);
  if (!fs.existsSync(exe)) {
    console.error(`Programme introuvable : ${exe}\nLe fabriquer d'abord : npm run exe`);
    process.exit(2);
  }
  const sorties = fs.mkdtempSync(path.join(os.tmpdir(), 'trk-tous-'));
  const enCours = new Map();
  let arrete = false;
  const arreter = (raison) => {
    if (arrete) return;
    arrete = true;
    console.error(`\n${raison} : ${enCours.size} script(s) en cours fermé(s) avec leurs programmes.`);
    for (const [pid, nom] of enCours) { fermerArbre(pid); console.error(`  ${nom} (processus ${pid}) fermé`); }
    enCours.clear();
    console.error(`  Sorties : ${sorties} ; les dossiers trk-* et tracker-fermeture-* des scripts arrêtés restent dans ${os.tmpdir()}.`);
    process.exit(130);
  };
  for (const signal of ['SIGINT', 'SIGBREAK', 'SIGHUP', 'SIGTERM']) process.on(signal, () => arreter(`Interrompu (${signal})`));
  process.on('exit', () => { for (const pid of enCours.keys()) fermerArbre(pid); });
  if (opts.arreterApres) setTimeout(() => arreter(`Arrêt d'essai après ${opts.arreterApres} s`), opts.arreterApres * 1000).unref();

  const jouer = async (e) => {
    const debut = Date.now();
    const ports = [e.port, ...(e.fixes ?? [])];
    const pris = [];
    for (const p of ports) if (!(await portLibre(p))) pris.push(p);
    if (pris.length) return { e, verdict: 'non joué', reussis: 0, rates: 0, echecs: [], ms: 0, note: `port ${pris.join(', ')} occupé (un autre banc ?)` };
    const fichier = path.join(sorties, `${e.nom}.txt`);
    const flux = fs.createWriteStream(fichier);
    let stdout = '';
    const enfant = spawn(process.execPath, [path.join(BANC, e.fichier), exe, String(e.port), ...(e.args ?? [])],
      { cwd: DEPOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: true });
    enCours.set(enfant.pid, e.nom);
    // Décodage au fil de l'eau : une lettre accentuée coupée entre deux morceaux (« ÉCHEC ») ne doit pas abîmer sa ligne.
    enfant.stdout.setEncoding('utf8');
    enfant.stdout.on('data', (d) => { stdout += d; flux.write(d); });
    enfant.stderr.on('data', (d) => flux.write(d));
    let depasse = false;
    const plafond = setTimeout(() => { depasse = true; fermerArbre(enfant.pid); }, PLAFOND_MS);
    const code = await new Promise((ok) => enfant.on('close', (c) => ok(c)));
    clearTimeout(plafond);
    enCours.delete(enfant.pid);
    await new Promise((ok) => flux.end(ok));
    const v = lireVerdict(stdout, code);
    const note = depasse ? `fermé après ${duree(PLAFOND_MS)}` : v.verdict === 'sans verdict' ? `code ${code}` : null;
    return { e, ...v, ms: Date.now() - debut, fichier, note };
  };

  const resultats = [];
  const largeur = Math.max(...entrees.map((e) => e.nom.length));
  const montrer = (r) => {
    const tete = `${r.e.nom.padEnd(largeur)}  ${r.verdict.padEnd(12)}`;
    if (r.verdict === 'non joué') { console.log(`${tete}${r.note}`); return; }
    console.log(`${tete}${String(r.reussis).padStart(4)} réussis, ${r.rates} raté${r.rates > 1 ? 's' : ''}  ${duree(r.ms)}${r.note ? `  (${r.note})` : ''}`);
    if (r.verdict === 'ok') return;
    for (const l of r.echecs.slice(0, 10)) console.log(`    ${l}`);
    if (r.echecs.length > 10) console.log(`    … ${r.echecs.length - 10} de plus`);
    if (r.verdict === 'sans verdict') {
      const fin = fs.readFileSync(r.fichier, 'utf8').split(/\r?\n/).filter((l) => l.trim()).slice(-3);
      for (const l of fin) console.log(`    | ${l.slice(0, 200)}`);
    }
    console.log(`    sortie : ${r.fichier}`);
  };
  const { ensemble, seuls } = repartir(entrees);
  const debut = Date.now();
  console.log(`${entrees.length} script(s), -j ${opts.j}, programme ${path.relative(DEPOT, exe) || exe}`);
  const file = [...ensemble];
  const travailleur = async () => { while (file.length) { const r = await jouer(file.shift()); resultats.push(r); montrer(r); } };
  await Promise.all(Array.from({ length: Math.min(opts.j, file.length) }, travailleur));
  for (const e of seuls) { const r = await jouer(e); resultats.push(r); montrer(r); }

  const mauvais = resultats.filter((r) => r.verdict !== 'ok');
  const cumul = resultats.reduce((s, r) => s + r.ms, 0);
  const verdict = mauvais.length === 0 ? 'tout passe' : `${mauvais.length} sur ${resultats.length} sans succès (${mauvais.map((r) => r.e.nom).join(', ')})`;
  console.log(`Total : ${duree(Date.now() - debut)} au mur, ${duree(cumul)} cumulées : ${verdict}.`);
  if (!opts.garder) for (const r of resultats) if (r.verdict === 'ok' && r.fichier) fs.rmSync(r.fichier, { force: true });
  if (fs.readdirSync(sorties).length === 0) fs.rmdirSync(sorties);
  else if (opts.garder || mauvais.length === 0) console.log(`Sorties gardées : ${sorties}`);
  process.exit(mauvais.length === 0 ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await principal();
