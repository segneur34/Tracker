// Banc de test : « Récupérer les sessions du téléphone » (Réglages › Mémoire du programme Windows), face à un faux
// téléphone (un dossier local). Repris de Gtracker (lot 447, 6c63628), élément 217, lot 2.
// Usage : node exe-recuperer.mjs <Tracker.exe> [<port de débogage>]
// Hors registre (`scripts.mjs`) : le script lance lui-même le programme, en mode d'essai de la coquille (`TRACKER_BANC=1`),
// sur des dossiers temporaires du dossier temporaire du système : jamais le vrai Documents, jamais le profil du vrai
// programme, jamais un vrai téléphone (en mode d'essai, sans racine d'essai, le vrai adb n'est jamais lancé ; le script
// retire `TRACKER_BANC_RACINE_TELEPHONE` de l'environnement). Le téléphone factice est un dossier qui joue le `/sdcard`
// (`TRACKER_BANC_TELEPHONE`) ; l'état imposé (`TRACKER_BANC_TELEPHONE_ETAT`) et la coupure après n lectures
// (`TRACKER_BANC_TELEPHONE_COUPURE`) se règlent par l'environnement. Les GPX sont synthétiques (`lib/traces.mjs`), la
// fiche d'une session est celle que le programme écrit lui-même ; le disque se lit par Node : c'est lui qui prouve.
// `BANC_CAPTURES=<dossier>` (facultatif) y dépose deux captures JPEG de la fenêtre : le compte rendu et l'état « absent ».
// Cas :
//  a. chaque état imposé (absent, autorisation, horsLigne, adbIntrouvable, occupe, plusieurs) : texte du message en
//     entier, « Réessayer » offert et rejoué, dossier donné pour adbIntrouvable, rien de rangé dans la mémoire ;
//  b. téléphone sans dossier Documents/Tracker : le message du dossier absent ;
//  c. trois sessions (dont une avec sa fiche et un nom à espace et accent) et des fichiers hors sessions/ : « 3 sessions
//     ajoutées. », GPX et fiches rangés sans temporaire, rien de reglages/, itineraires/ ni du tracker.json du
//     téléphone, trois lignes dans la bibliothèque de la voile ;
//  d. second clic : « 0 sessions ajoutées, 3 déjà présentes. », le disque inchangé (noms, tailles, dates) ;
//  e. une quatrième session sur le téléphone : seule celle-là est ajoutée ;
//  f. coupure en route, deux fois (après 1 lecture, entre un GPX et sa fiche ; puis après 3) : message de débranchement,
//     sessions rangées entières, aucune moitié ni temporaire ; relancé sans coupure, ce qui manquait est rangé ;
//  g. dans tous les cas, le téléphone factice est intact (mêmes fichiers, tailles et dates qu'au départ) et la console
//     de la page sans erreur.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from './lib/cdp.mjs';
import { traceDroite } from './lib/traces.mjs';

const [exe, portArg] = process.argv.slice(2);
if (!exe) {
  console.error('Usage : node exe-recuperer.mjs <Tracker.exe> [<port>]');
  process.exit(1);
}
const PORT = Number(portArg ?? 9497);
const ORIGINE = 'https://tracker.localhost'; // `bureau/origine.ts`
const CAPTURES = process.env.BANC_CAPTURES || null;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const vivant = (pid) => spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8', windowsHide: true }).stdout.includes(` ${pid} `);
const disparu = async (pid, ms) => { for (let t = 0; t < ms; t += 200) { if (!vivant(pid)) return true; await pause(200); } return !vivant(pid); };

let echecs = 0;
const check = (quoi, ok, detail) => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${quoi}${!ok && detail !== undefined ? ` (${detail})` : ''}`); if (!ok) echecs++; };

const RACINE = mkdtempSync(join(tmpdir(), 'trk-rec-'));
const dossier = (nom) => { const d = join(RACINE, nom); mkdirSync(d, { recursive: true }); return d; };

/** Tous les fichiers sous `racine`, chemins relatifs en `/` (triés). */
const arbre = (racine) => {
  if (!existsSync(racine)) return null;
  const sortie = [];
  const voir = (d, prefixe) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) { sortie.push(`${prefixe}${e.name}/`); voir(join(d, e.name), `${prefixe}${e.name}/`); } else sortie.push(`${prefixe}${e.name}`);
    }
  };
  voir(racine, '');
  return sortie.sort();
};
/** Arbre avec la taille et l'heure de chaque fichier : change si quoi que ce soit est écrit. */
const empreinte = (racine) => (arbre(racine) ?? []).map((c) => (c.endsWith('/') ? c : `${c}:${statSync(join(racine, c)).size}:${statSync(join(racine, c)).mtimeMs}`)).join('|');
const temporaires = (racine) => (arbre(racine) ?? []).filter((c) => /\.tracker-(tmp|new)$/.test(c));
const sessionsDe = (memoire) => (existsSync(join(memoire, 'sessions')) ? readdirSync(join(memoire, 'sessions')).sort() : []);
const gpxsDe = (memoire) => sessionsDe(memoire).filter((n) => n.endsWith('.gpx'));
const fichesDe = (memoire) => sessionsDe(memoire).filter((n) => n.endsWith('.json'));
/** Fichiers d'une mémoire qui portent `marque` dans leur contenu. */
const contient = (racine, marque) => (arbre(racine) ?? []).filter((c) => !c.endsWith('/')).filter((c) => readFileSync(join(racine, c)).includes(marque));

const lances = new Set();
/** Variables du téléphone d'essai : jamais héritées du poste. */
const VARIABLES_TELEPHONE = ['TRACKER_BANC_TELEPHONE', 'TRACKER_BANC_TELEPHONE_ETAT', 'TRACKER_BANC_TELEPHONE_COUPURE', 'TRACKER_BANC_RACINE_TELEPHONE'];
/** Une instance du programme ; `env` s'ajoute à l'environnement d'essai. */
async function lancer(profil, memoire, env = {}) {
  const complet = { ...process.env, TRACKER_BANC: '1', TRACKER_PROFIL: profil, TRACKER_MEMOIRE: memoire, TRACKER_DOCUMENTS: join(profil, 'Documents-essai'), TRACKER_BANC_MONTRER: 'transparente', ...env };
  for (const cle of Object.keys(complet)) if (cle.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete complet[cle];
  for (const cle of VARIABLES_TELEPHONE) if (!(cle in env)) delete complet[cle];
  const child = spawn(exe, [`--remote-debugging-port=${PORT}`, '--lang=fr-FR', '--force-device-scale-factor=1', '--hide-scrollbars'], { env: complet, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  lances.add(child.pid);
  const journal = [];
  const lire = (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) journal.push(l.trim()); };
  child.stdout.on('data', lire);
  child.stderr.on('data', lire);
  let ws = null;
  for (let k = 0; k < 100 && !ws; k++) {
    await pause(300);
    try { ws = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((p) => p.type === 'page')?.webSocketDebuggerUrl ?? null; } catch { /* pas prêt */ }
  }
  if (!ws) { spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true }); throw new Error('le programme ne répond pas'); }
  process.env.BANC_WS = ws;
  const b = await connect({ port: PORT, base: ORIGINE, width: 1400, height: 1000 });
  await b.blockNetwork();
  return { child, journal, b };
}
/** Ferme le programme comme la croix (sans brouillon), sinon de force ; attend sa disparition. */
async function fermer(p) {
  try { await p.b.close(); } catch { /* page déjà fermée */ }
  spawnSync('taskkill', ['/PID', String(p.child.pid)], { stdio: 'ignore', windowsHide: true });
  if (!(await disparu(p.child.pid, 6000))) {
    console.log('(fermeture demandée sans effet : processus tué)');
    spawnSync('taskkill', ['/T', '/F', '/PID', String(p.child.pid)], { stdio: 'ignore', windowsHide: true });
    await disparu(p.child.pid, 5000);
  }
  await pause(500);
}
/** Lance, joue `essai`, ferme toujours (même sur erreur). Vérifie la console de la page à la fin. */
async function avecProgramme(profil, memoire, env, quoi, essai) {
  let p = null;
  try {
    p = await lancer(profil, memoire, env);
    const r = await essai(p.b, p);
    check(`${quoi} : console de la page sans erreur`, p.b.logs.length === 0, p.b.logs.join(' | '));
    return r;
  } catch (e) {
    check(`${quoi} : essai interrompu : ${e.message}`, false);
    return null;
  } finally {
    if (p) await fermer(p);
  }
}

const BOUTON = 'button.phone-recover';
const PANNEAU = '.phone-recover__panel';
/** Ce que Réglages › Mémoire dit de la récupération : phrases, dossier, boutons (texte brut, la casse d'écran ne compte pas). */
const releve = (b) => b.evaluate(`(() => {
  const d = document.querySelector(${JSON.stringify(PANNEAU)});
  if (!d) return null;
  const texte = (x) => x.textContent.trim();
  return {
    paragraphes: [...d.querySelectorAll('p.phone-recover__text')].map(texte),
    dossier: [...d.querySelectorAll('code.phone-recover__folder')].map(texte)[0] ?? null,
    boutons: [...d.querySelectorAll('.phone-recover__actions button')].map(texte),
  };
})()`);
/** Ouvre Réglages (la carte Mémoire, même repliée, porte le bouton). */
async function reglages(b) {
  await b.go('/parametres', 5000);
  await b.waitFor(`Boolean(document.querySelector(${JSON.stringify(BOUTON)}))`, { timeout: 8000, label: 'bouton Récupérer' });
}
/** Clique « Récupérer les sessions du téléphone » et attend la fin (boutons de l'issue montrés). */
async function recuperer(b, quoi) {
  const libelle = await b.evaluate(`document.querySelector(${JSON.stringify(BOUTON)})?.textContent.trim() ?? null`);
  check(`${quoi} : le bouton « Récupérer les sessions du téléphone » est dans Réglages › Mémoire`, libelle === 'Récupérer les sessions du téléphone', libelle);
  check(`${quoi} : clic sur le bouton`, (await b.click(BOUTON)) === 'ok');
  await b.waitFor(`Boolean(document.querySelector('${PANNEAU} .phone-recover__actions'))`, { timeout: 30000, label: 'issue de la récupération' });
  await b.wait(300);
  const r = await releve(b);
  console.log('  Réglages › Mémoire :');
  for (const l of r?.paragraphes ?? []) console.log(`    | ${l}`);
  if (r?.dossier) console.log(`    dossier : ${r.dossier}`);
  console.log(`    boutons : ${(r?.boutons ?? []).join(' / ')}`);
  return r;
}
const fermerIssue = async (b) => { await b.clickText('Fermer', '.phone-recover__actions button'); await b.wait(300); };
/** Capture JPEG de la page, 900 px de large au plus. */
async function capturer(b, nom) {
  if (!CAPTURES) return;
  mkdirSync(CAPTURES, { recursive: true });
  const r = await b.send('Page.captureScreenshot', { format: 'jpeg', quality: 80, clip: { x: 0, y: 0, width: 1400, height: 1000, scale: 0.64 } });
  writeFileSync(join(CAPTURES, `${nom}.jpg`), Buffer.from(r.result.data, 'base64'));
}
/** Rangées de la bibliothèque de la voile (les sessions synthétiques sont du wingfoil). */
async function rangeesVoile(b) {
  await b.go('/voile', 5000);
  await b.settle({ max: 2000 });
  return b.evaluate(`document.querySelectorAll('.lib-row__main').length`);
}

// ---------- le faux téléphone ----------
const gpxSynthetique = (jour, heure, nom) => traceDroite({ debutMs: Date.UTC(2026, 9, jour, heure, 0, 0), secondes: 300, vitesse: 4, type: 'wingfoil', nom });
/** Début de nom d'un fichier de session : l'heure locale du départ, comme l'application la range (`AAAA-MM-JJ_HH-MM-SS`, `recording/session.ts`). */
const debutNom = (jour, heure) => {
  const d = new Date(Date.UTC(2026, 9, jour, heure, 0, 0));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};
/** Nom sur le téléphone : celui de l'application (`…_wingfoil`) sauf pour la session au nom à espace et accent. */
const nomSession = (s) => `${debutNom(s.jour, s.heure)}_${s.nom}`;
/** Nom que l'ordinateur range : toujours `<heure locale>_<calcul>`, quel que soit le nom du GPX du téléphone. */
const nomPc = (s) => `${debutNom(s.jour, s.heure)}_wingfoil`;
const MARQUE = 'TELEPHONE-MARQUE-A-NE-PAS-COPIER';
/** Date de modification connue d'un fichier du téléphone : le premier octobre 2026 plus `jour` jours, à la seconde. */
const dater = (fichier, jour) => { const d = new Date(Date.UTC(2026, 9, jour, 12, 0, 0)); utimesSync(fichier, d, d); };
const DEPART = [
  { jour: 1, heure: 7, nom: 'Séance du matin', fiche: true },
  { jour: 2, heure: 8, nom: 'wingfoil', fiche: false },
  { jour: 3, heure: 9, nom: 'wingfoil', fiche: false },
];
const QUATRIEME = { jour: 4, heure: 10, nom: 'wingfoil', fiche: false };

/** Le programme importe `gpx` dans une mémoire neuve : la fiche rangée à côté est celle d'une vraie session. */
async function fabriquerFiche(gpx) {
  const profil = dossier('prep-profil');
  const memoire = dossier('prep-memoire');
  await avecProgramme(profil, memoire, {}, 'préparation de la fiche', async (b) => {
    await b.go('/voile', 5000);
    check('préparation : import du GPX de la session à fiche', (await b.importGpx(gpx, 'fiche.gpx')) === 'ok');
    await b.waitFor(() => gpxsDe(memoire).length >= 1 && fichesDe(memoire).length >= 1, { timeout: 10000, label: 'GPX et fiche' });
    await b.wait(1500);
    await b.settle({ max: 2000 });
  });
  const g = gpxsDe(memoire)[0];
  const f = fichesDe(memoire)[0];
  check('préparation : une fiche vraie est sortie du programme', Boolean(g) && Boolean(f), `${g} ${f}`);
  return { gpx: join(memoire, 'sessions', g), fiche: join(memoire, 'sessions', f) };
}
/** Pose une session sur le téléphone factice ; `modeleFiche` : chemin d'une fiche à copier à côté du GPX. */
function poserSession(telephone, s, modeleFiche) {
  const sessions = join(telephone, 'Documents', 'Tracker', 'sessions');
  mkdirSync(sessions, { recursive: true });
  const base = nomSession(s);
  writeFileSync(join(sessions, `${base}.gpx`), gpxSynthetique(s.jour, s.heure, s.nom));
  dater(join(sessions, `${base}.gpx`), s.jour);
  if (s.fiche) { copyFileSync(modeleFiche, join(sessions, `${base}.json`)); dater(join(sessions, `${base}.json`), s.jour); }
}
/** Un téléphone avec les sessions données, et des fichiers hors de sessions/ que la récupération ne doit pas prendre. */
function fabriquerTelephone(nom, sessions, modeleFiche) {
  const tel = dossier(nom);
  const racine = join(tel, 'Documents', 'Tracker');
  mkdirSync(join(racine, 'reglages'), { recursive: true });
  mkdirSync(join(racine, 'itineraires'), { recursive: true });
  writeFileSync(join(racine, 'tracker.json'), `{"marque":"${MARQUE}"}`);
  writeFileSync(join(racine, 'reglages', 'telephone-xiaomi.json'), `{"marque":"${MARQUE}"}`);
  writeFileSync(join(racine, 'itineraires', 'parcours-telephone.gpx'), `<gpx><!-- ${MARQUE} --></gpx>`);
  for (const f of ['tracker.json', 'reglages/telephone-xiaomi.json', 'itineraires/parcours-telephone.gpx']) dater(join(racine, ...f.split('/')), 9);
  for (const s of sessions) poserSession(tel, s, modeleFiche);
  return tel;
}
const memoireNeuve = (nom) => ({ profil: dossier(`${nom}-profil`), memoire: dossier(`${nom}-memoire`) });
/** Vérifie que le téléphone factice n'a pas bougé depuis `avant` (empreinte). */
const telephoneIntact = (quoi, telephone, avant) => check(`${quoi} : téléphone factice intact (fichiers, tailles et dates)`, empreinte(telephone) === avant, `\n--- avant ---\n${avant}\n--- après ---\n${empreinte(telephone)}`);
/** Les sessions `attendues` sont rangées entières, rien d'autre, aucun temporaire, rien de hors sessions/. */
function verifierMemoire(quoi, memoire, attendues) {
  const gpx = gpxsDe(memoire);
  check(`${quoi} : ${attendues.length} GPX dans sessions/ de la mémoire de l'ordinateur`, gpx.length === attendues.length, gpx.join(' | '));
  for (const s of attendues) {
    const base = nomPc(s);
    check(`${quoi} : « ${base} » entière (GPX et fiche)`, gpx.includes(`${base}.gpx`) && fichesDe(memoire).includes(`${base}.json`), sessionsDe(memoire).join(' | '));
  }
  check(`${quoi} : aucun temporaire (.tracker-tmp, .tracker-new) dans la mémoire`, temporaires(memoire).length === 0, temporaires(memoire).join(','));
  check(`${quoi} : aucun fichier de la mémoire ne porte la marque du téléphone (ni tracker.json, ni reglages/, ni itineraires/)`, contient(memoire, MARQUE).length === 0, contient(memoire, MARQUE).join(','));
  const noms = arbre(memoire) ?? [];
  check(`${quoi} : ni telephone-xiaomi.json ni parcours-telephone.gpx dans la mémoire`, !noms.some((c) => /telephone-xiaomi|parcours-telephone/.test(c)), noms.join(','));
}

const ETATS = {
  absent: [
    "Aucun téléphone n'est vu. Branchez votre téléphone à l'ordinateur par un câble USB, déverrouillez-le, puis cliquez sur « Réessayer ».",
    'La première fois, il faut aussi activer le « Débogage USB » du téléphone : dans Paramètres, À propos du téléphone, touchez sept fois « Version », puis activez « Débogage USB » dans les options pour les développeurs.',
  ],
  autorisation: [
    "Regardez l'écran du téléphone : il demande « Autoriser le débogage USB ? ». Cochez « Toujours autoriser cet ordinateur », touchez « Autoriser », puis cliquez ici sur « Réessayer ».",
  ],
  horsLigne: ['Le téléphone est branché mais ne répond pas. Déverrouillez son écran, débranchez puis rebranchez le câble, et cliquez sur « Réessayer ».'],
  adbIntrouvable: [
    "Pour lire le téléphone, Tracker a besoin d'un outil gratuit de Google, « SDK Platform-Tools », absent de cet ordinateur.",
    "Téléchargez-le pour Windows sur developer.android.com/tools/releases/platform-tools, ouvrez le fichier .zip, copiez le dossier « platform-tools » qu'il contient dans le dossier ci-dessous, puis cliquez sur « Réessayer ».",
  ],
  occupe: ['Un autre programme utilise déjà la liaison avec le téléphone (Android Studio, par exemple). Fermez-le, puis cliquez sur « Réessayer ».'],
  plusieurs: ["Plusieurs appareils sont branchés à l'ordinateur (2). Ne laissez branché que le téléphone à lire, fermez un téléphone virtuel s'il y en a un d'ouvert, puis cliquez sur « Réessayer »."],
};
const boutons = (r) => (r?.boutons ?? []).join('/').toLowerCase();

try {
  const gpxFiche = gpxSynthetique(DEPART[0].jour, DEPART[0].heure, DEPART[0].nom);
  console.log('\n== Préparation : une fiche vraie, écrite par le programme');
  const modele = await fabriquerFiche(gpxFiche);
  console.log(`fiche modèle : ${modele.fiche.split('\\').pop()}`);

  // ---------- a. états imposés ----------
  console.log('\n== a. Chaque état imposé : message, « Réessayer », rien de rangé');
  for (const [etat, attendu] of Object.entries(ETATS)) {
    const M = memoireNeuve(`a-${etat}`);
    const tel = fabriquerTelephone(`a-${etat}-tel`, DEPART, modele.fiche);
    const avant = empreinte(tel);
    await avecProgramme(M.profil, M.memoire, { TRACKER_BANC_TELEPHONE: tel, TRACKER_BANC_TELEPHONE_ETAT: etat }, `a. ${etat}`, async (b) => {
      await reglages(b);
      const r = await recuperer(b, `a. ${etat}`);
      check(`a. ${etat} : le texte du message, en entier`, JSON.stringify(r?.paragraphes) === JSON.stringify(attendu), JSON.stringify(r?.paragraphes));
      check(`a. ${etat} : « Réessayer » est offert (puis « Fermer »)`, boutons(r) === 'réessayer/fermer', boutons(r));
      if (etat === 'adbIntrouvable') {
        check('a. adbIntrouvable : le dossier où copier platform-tools est affiché (le profil)', Boolean(r?.dossier) && r.dossier.toLowerCase() === M.profil.toLowerCase(), r?.dossier);
      } else check(`a. ${etat} : pas de dossier à recopier`, r?.dossier === null, r?.dossier);
      if (etat === 'absent') await capturer(b, 'recuperer-absent');
      check(`a. ${etat} : « Réessayer »`, (await b.clickText('Réessayer', '.phone-recover__actions button')) === 'ok');
      await b.waitFor(`Boolean(document.querySelector('${PANNEAU} .phone-recover__actions'))`, { timeout: 10000 });
      await b.wait(500);
      const r2 = await releve(b);
      check(`a. ${etat} : « Réessayer » redit le même message`, JSON.stringify(r2?.paragraphes) === JSON.stringify(attendu), JSON.stringify(r2?.paragraphes));
      await fermerIssue(b);
      check(`a. ${etat} : « Fermer » efface le message`, (await releve(b)) === null);
    });
    check(`a. ${etat} : rien de rangé dans la mémoire (sessions/ vide)`, sessionsDe(M.memoire).length === 0, sessionsDe(M.memoire).join(' | '));
    telephoneIntact(`a. ${etat}`, tel, avant);
  }

  // ---------- b. dossier absent ----------
  console.log('\n== b. Téléphone sans dossier Documents/Tracker');
  {
    const M = memoireNeuve('b');
    const tel = dossier('b-tel');
    mkdirSync(join(tel, 'Download'), { recursive: true });
    writeFileSync(join(tel, 'Download', 'autre.txt'), 'sans rapport');
    const avant = empreinte(tel);
    await avecProgramme(M.profil, M.memoire, { TRACKER_BANC_TELEPHONE: tel }, 'b', async (b) => {
      await reglages(b);
      const r = await recuperer(b, 'b');
      const attendu = ["Le téléphone Téléphone d'essai n'a pas de dossier « Documents/Tracker ». Tracker ne récupère que les sessions rangées dans ce dossier : sur le téléphone, ouvrez Tracker, Réglages, Mémoire, pour voir où il les range."];
      check('b. le message du dossier absent, en entier', JSON.stringify(r?.paragraphes) === JSON.stringify(attendu), JSON.stringify(r?.paragraphes));
      check('b. « Réessayer » offert', boutons(r) === 'réessayer/fermer', boutons(r));
    });
    check('b. rien de rangé dans la mémoire', sessionsDe(M.memoire).length === 0);
    telephoneIntact('b', tel, avant);
  }

  // ---------- c, d, e. trois sessions, second clic, quatrième ----------
  console.log('\n== c, d, e. Trois sessions, second clic, quatrième session');
  {
    const M = memoireNeuve('c');
    const tel = fabriquerTelephone('c-tel', DEPART, modele.fiche);
    const avant = empreinte(tel);
    console.log(`téléphone factice :\n  ${(arbre(tel) ?? []).join('\n  ')}`);
    await avecProgramme(M.profil, M.memoire, { TRACKER_BANC_TELEPHONE: tel }, 'c, d, e', async (b) => {
      check('c. avant : la bibliothèque de la voile est vide', (await rangeesVoile(b)) === 0);

      // c
      await reglages(b);
      let r = await recuperer(b, 'c');
      check('c. le compte rendu dit « 3 sessions ajoutées. »', JSON.stringify(r?.paragraphes) === JSON.stringify(['3 sessions ajoutées.']), JSON.stringify(r?.paragraphes));
      check('c. seul « Fermer » est offert', boutons(r) === 'fermer', boutons(r));
      await capturer(b, 'recuperer-compte-rendu');
      await b.wait(2000); // réécritures différées des fiches
      verifierMemoire('c', M.memoire, DEPART);
      telephoneIntact('c', tel, avant);
      await fermerIssue(b);
      const n = await rangeesVoile(b);
      check('c. la bibliothèque de la voile montre trois lignes', n === 3, String(n));
      await b.wait(2000);
      const empreinteC = empreinte(join(M.memoire, 'sessions'));
      console.log(`mémoire de l'ordinateur, sessions/ :\n  ${sessionsDe(M.memoire).join('\n  ')}`);

      // d
      await reglages(b);
      r = await recuperer(b, 'd');
      check('d. le compte rendu dit « 0 sessions ajoutées, 3 déjà présentes. »', JSON.stringify(r?.paragraphes) === JSON.stringify(['0 sessions ajoutées, 3 déjà présentes.']), JSON.stringify(r?.paragraphes));
      await b.wait(1500);
      check('d. le disque n\'a pas changé (noms, tailles, dates de sessions/)', empreinte(join(M.memoire, 'sessions')) === empreinteC, `\n${empreinteC}\n--\n${empreinte(join(M.memoire, 'sessions'))}`);
      telephoneIntact('d', tel, avant);
      await fermerIssue(b);

      // e
      poserSession(tel, QUATRIEME, modele.fiche);
      const avantE = empreinte(tel);
      r = await recuperer(b, 'e');
      check('e. le compte rendu dit « 1 session ajoutée, 3 déjà présentes. »', JSON.stringify(r?.paragraphes) === JSON.stringify(['1 session ajoutée, 3 déjà présentes.']), JSON.stringify(r?.paragraphes));
      await b.wait(2000);
      verifierMemoire('e', M.memoire, [...DEPART, QUATRIEME]);
      const garde = empreinteC.split('|');
      const apres = empreinte(join(M.memoire, 'sessions')).split('|');
      check('e. les trois premières sessions n\'ont pas bougé (noms, tailles, dates)', garde.every((l) => apres.includes(l)), apres.join('\n'));
      telephoneIntact('e', tel, avantE);
      await fermerIssue(b);
      const n4 = await rangeesVoile(b);
      check('e. la bibliothèque de la voile montre quatre lignes', n4 === 4, String(n4));
    });
  }

  // ---------- f. coupure ----------
  console.log('\n== f. Téléphone débranché en route');
  for (const coupure of [1, 3]) {
    const quoi = `f (coupure après ${coupure} lecture${coupure > 1 ? 's' : ''})`;
    const M = memoireNeuve(`f${coupure}`);
    const tel = fabriquerTelephone(`f${coupure}-tel`, DEPART, modele.fiche);
    const avant = empreinte(tel);
    await avecProgramme(M.profil, M.memoire, { TRACKER_BANC_TELEPHONE: tel, TRACKER_BANC_TELEPHONE_COUPURE: String(coupure) }, quoi, async (b) => {
      await reglages(b);
      const r = await recuperer(b, quoi);
      check(`${quoi} : le message de débranchement est dit`, /^Le téléphone a été débranché pendant la récupération\. Les sessions déjà rangées restent sur l'ordinateur, entières : aucune n'est rangée à moitié\.$/.test(r?.paragraphes?.[0] ?? ''), JSON.stringify(r?.paragraphes));
      check(`${quoi} : « Rebranchez-le, puis cliquez sur « Réessayer » »`, /Rebranchez-le, puis cliquez sur « Réessayer »/.test(r?.paragraphes?.join(' ') ?? ''));
      check(`${quoi} : « Réessayer » offert`, boutons(r) === 'réessayer/fermer', boutons(r));
      await b.wait(2000);
    });
    const rangees = gpxsDe(M.memoire);
    console.log(`  rangées au débranchement : ${rangees.join(' ; ') || '(aucune)'}`);
    for (const g of rangees) {
      const base = g.replace(/\.gpx$/, '');
      check(`${quoi} : « ${base} » est entière (GPX et fiche présents)`, fichesDe(M.memoire).includes(`${base}.json`), sessionsDe(M.memoire).join(' | '));
    }
    check(`${quoi} : pas plus de fiches que de GPX (aucune moitié de session)`, fichesDe(M.memoire).length === rangees.length, `${fichesDe(M.memoire).length} fiches, ${rangees.length} GPX`);
    check(`${quoi} : moins de trois sessions rangées`, rangees.length < 3, String(rangees.length));
    check(`${quoi} : aucun temporaire dans la mémoire`, temporaires(M.memoire).length === 0, temporaires(M.memoire).join(','));
    check(`${quoi} : rien du téléphone hors sessions/ n'est copié`, contient(M.memoire, MARQUE).length === 0, contient(M.memoire, MARQUE).join(','));
    telephoneIntact(quoi, tel, avant);

    // Relance sans coupure : ce qui manquait est rangé.
    const manquantes = 3 - rangees.length;
    await avecProgramme(M.profil, M.memoire, { TRACKER_BANC_TELEPHONE: tel }, `${quoi}, reprise`, async (b) => {
      await reglages(b);
      const r = await recuperer(b, `${quoi}, reprise`);
      const attendu = [`${manquantes} ${manquantes > 1 ? 'sessions ajoutées' : 'session ajoutée'}${rangees.length > 0 ? `, ${rangees.length} ${rangees.length > 1 ? 'déjà présentes' : 'déjà présente'}` : ''}.`];
      check(`${quoi}, reprise : le compte rendu dit « ${attendu[0]} »`, JSON.stringify(r?.paragraphes) === JSON.stringify(attendu), JSON.stringify(r?.paragraphes));
      await b.wait(2000);
    });
    verifierMemoire(`${quoi}, reprise`, M.memoire, DEPART);
    telephoneIntact(`${quoi}, reprise`, tel, avant);
  }
} catch (e) {
  check(`script interrompu : ${e.stack ?? e.message}`, false);
} finally {
  // Un programme resté ouvert par une erreur : seuls ceux que ce script a lancés sont tués.
  for (const pid of lances) if (vivant(pid)) spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
  await pause(800);
  rmSync(RACINE, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
}

console.log(echecs === 0 ? '\nTout passe.' : `\n${echecs} échec(s).`);
process.exit(echecs === 0 ? 0 : 1);
