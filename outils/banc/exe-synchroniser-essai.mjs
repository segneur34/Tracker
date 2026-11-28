// « Synchroniser avec le téléphone » face au VRAI téléphone branché par le câble, sur le dossier d'essai
// `Documents/Tracker-essai` seulement (élément 217). Hors registre : il lance lui-même le programme, en mode d'essai
// (`TRACKER_BANC=1`, `TRACKER_BANC_RACINE_TELEPHONE=Tracker-essai`, sans `TRACKER_BANC_TELEPHONE`).
//
//   node outils/banc/exe-synchroniser-essai.mjs bureau/sortie/Tracker-win32-x64/Tracker.exe [<port>]
//
// Garanties du script lui-même (en plus de celles de la coquille) :
// - le vrai dossier `Documents/Tracker` n'est que LU (`find`, `stat`, `adb pull` de deux itinéraires, pour éprouver
//   des noms avec accent et espace) ; son empreinte (noms, tailles, dates) est relevée avant et après, et le script
//   échoue si elle a bougé ;
// - ce script n'écrit, par `adb push` et `rm`, que sous `/sdcard/Documents/Tracker-essai` (`sousEssai`) ;
// - il refuse de partir si `Tracker-essai` (ou l'ancien `Tracker-essai-corbeille`, que plus rien ne remplit depuis le
//   lot 242-1) existe déjà : rien n'est écrasé. Il ne retire pas `Tracker-essai` à la fin : à effacer à la main une fois
//   le relevé lu ;
// - il s'arrête si la coquille n'annonce pas « vrai téléphone, racine d'essai : Documents/Tracker-essai ».
// Joué (fenêtre en un geste, lot 242-2) : l'écran de départ, qui n'écrit rien, fermé sans rien faire ; puis
// « Commencer » : première synchronisation avec copie de sécurité (sessions et itinéraires dans les deux sens) ; puis
// une suppression de chaque côté, en un clic, sans question (corbeille de l'ordinateur ; sur le téléphone, un dépôt dans
// la corbeille de sa mémoire, `Documents/Tracker-essai/corbeille/<dépôt>/`, ouvert par `depose.json` : corbeilles
// jumelles, lot 242-1), et le marqueur du téléphone qui porte l'instant de la synchronisation.

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from './lib/cdp.mjs';
import { traceDroite } from './lib/traces.mjs';

const [exe, portArg] = process.argv.slice(2);
if (!exe) { console.error('Usage : node exe-synchroniser-essai.mjs <Tracker.exe> [<port>]'); process.exit(1); }
const PORT = Number(portArg ?? 9640); // port réservé (exe-tous.mjs, PORTS_RESERVES) : ce script n'entre jamais dans le lanceur
const ORIGINE = 'https://tracker.localhost';
const ADB = process.env.ADB ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', 'adb.exe');
const VRAI = '/sdcard/Documents/Tracker';
const ESSAI = '/sdcard/Documents/Tracker-essai';
/** La corbeille de la mémoire d'essai du téléphone, où l'ordinateur dépose ce qu'il retire (lot 242-1). */
const CORBEILLE = `${ESSAI}/corbeille`;
/** L'ancienne corbeille du câble, hors de la mémoire : plus jamais remplie. */
const ANCIENNE_CORBEILLE = '/sdcard/Documents/Tracker-essai-corbeille';
const ITINERAIRES = ['Itinéraire du 22 11 2026', 'Itinéraire du 26 09 2026']; // lus sur le vrai dossier : accent et espaces

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const vivant = (pid) => spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8', windowsHide: true }).stdout.includes(` ${pid} `);
// Compté en vrai temps : `tasklist` prend lui-même 150 à 250 ms, un compte de tours doublait l'attente.
const disparu = async (pid, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (!vivant(pid)) return true; await pause(200); } return !vivant(pid); };
let echecs = 0;
const check = (quoi, ok, detail) => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${quoi}${!ok && detail !== undefined ? ` (${detail})` : ''}`); if (!ok) echecs++; };
const adb = (args) => spawnSync(ADB, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
const sh = (commande) => adb(['shell', commande]).stdout ?? '';
/** Seuls chemins où ce script écrit sur le téléphone. */
const sousEssai = (chemin) => { if (!chemin.startsWith(`${ESSAI}/`) || /['"`$\\;&|<>*?]|\.\./.test(chemin)) throw new Error(`chemin refusé : ${chemin}`); return chemin; };
const empreinte = (racine) => sh(`find ${racine} -type f -exec stat -c '%s %Y %n' {} +`).split(/\r?\n/).filter(Boolean).sort().join('\n');
const liste = (racine) => sh(`find ${racine} -type f 2>/dev/null`).split(/\r?\n/).filter(Boolean).map((c) => c.slice(racine.length + 1)).sort();
const existe = (chemin) => sh(`ls -d ${chemin} 2>/dev/null`).trim() !== '';

const RACINE = mkdtempSync(join(tmpdir(), 'trk-sync-essai-'));
const dossier = (nom) => { const d = join(RACINE, nom); mkdirSync(d, { recursive: true }); return d; };
const gpxDe = (memoire) => (existsSync(join(memoire, 'sessions')) ? readdirSync(join(memoire, 'sessions')).filter((n) => n.endsWith('.gpx')).sort() : []);
const fichesDe = (memoire) => (existsSync(join(memoire, 'sessions')) ? readdirSync(join(memoire, 'sessions')).filter((n) => n.endsWith('.json')).sort() : []);
/** Fichiers d'un dossier de l'ordinateur avec leur taille et leur heure : change si quoi que ce soit est écrit. */
const empreinteLocale = (racine) => {
  if (!existsSync(racine)) return '';
  const sortie = [];
  const voir = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const c = join(d, e.name); if (e.isDirectory()) voir(c); else { const st = statSync(c); sortie.push(`${c}:${st.size}:${st.mtimeMs}`); } } };
  voir(racine);
  return sortie.sort().join('|');
};
const corbeilleDe = (memoire) => { try { return JSON.parse(readFileSync(join(memoire, 'corbeille', 'corbeille.json'), 'utf8')).entries ?? []; } catch { return []; } };

const lances = new Set();
async function lancer(profil, memoire, env = {}) {
  const complet = { ...process.env, TRACKER_BANC: '1', TRACKER_PROFIL: profil, TRACKER_MEMOIRE: memoire, TRACKER_DOCUMENTS: join(profil, 'Documents-essai'), TRACKER_BANC_MONTRER: 'transparente', ...env };
  for (const cle of Object.keys(complet)) {
    if (cle.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete complet[cle];
    if (cle.startsWith('TRACKER_BANC_TELEPHONE') || cle === 'TRACKER_BANC_RACINE_TELEPHONE') if (!(cle in env)) delete complet[cle];
  }
  const child = spawn(exe, [`--remote-debugging-port=${PORT}`, '--lang=fr-FR', '--force-device-scale-factor=1', '--hide-scrollbars'], { env: complet, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  lances.add(child.pid);
  const journal = [];
  const lire = (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) journal.push(l.trim()); };
  child.stdout.on('data', lire);
  child.stderr.on('data', lire);
  let ws = null;
  // Interrogé toutes les 100 ms (30 s au plus) : la page est là en moins d'une seconde d'ordinaire.
  for (let k = 0; k < 300 && !ws; k++) {
    await pause(100);
    try { ws = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((p) => p.type === 'page')?.webSocketDebuggerUrl ?? null; } catch { /* pas prêt */ }
  }
  if (!ws) { spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true }); throw new Error(`le programme ne répond pas : ${journal.slice(-5).join(' | ')}`); }
  process.env.BANC_WS = ws;
  const b = await connect({ port: PORT, base: ORIGINE, width: 1400, height: 1000 });
  await b.blockNetwork();
  return { child, journal, b };
}
/** Ferme le programme, de force s'il le faut ; attend sa disparition (au lieu de 3 s puis 1 s fixes). */
async function fermer(p) {
  try { await p.b.close(); } catch { /* déjà fermée */ }
  spawnSync('taskkill', ['/PID', String(p.child.pid)], { stdio: 'ignore', windowsHide: true });
  if (!(await disparu(p.child.pid, 6000))) {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(p.child.pid)], { stdio: 'ignore', windowsHide: true });
    await disparu(p.child.pid, 5000);
  }
  await pause(500); // attente fixe voulue : le même profil est rouvert juste après, ses fichiers à peine relâchés
}
async function avecProgramme(profil, memoire, env, quoi, essai) {
  let p = null;
  try {
    p = await lancer(profil, memoire, env);
    await essai(p.b, p);
    check(`${quoi} : console de la page sans erreur`, p.b.logs.length === 0, p.b.logs.join(' | '));
  } catch (e) {
    check(`${quoi} : essai interrompu : ${e.message}`, false);
    if (p) console.log(`  journal : ${p.journal.slice(-8).join(' | ')}`);
  } finally {
    if (p) await fermer(p);
  }
}

const BOUTON = 'button.phone-sync';
const FENETRE = '.phone-sync__dialog';
/** Réponses qui marquent une étape où la fenêtre s'arrête : compte rendu, écran de départ, attente, question. */
const ARRETS = ['Fermer', 'Commencer', 'Annuler', 'Tout garder', 'La garder', 'Les garder', 'Le garder'];
/** Ce que montre la fenêtre : titre, sous-titre, phrases, dossier, lignes (« geste : ce qu'il a touché »), encadrés, boutons. */
const releve = (b) => b.evaluate(`(() => {
  const d = document.querySelector(${JSON.stringify(FENETRE)});
  if (!d) return null;
  const texte = (x) => (x?.textContent ?? '').trim().replace(/\\s+/g, ' ');
  return {
    titre: texte(d.querySelector('.ui-dialog__head strong')),
    sousTitre: d.querySelector('.phone-sync__subtitle') ? texte(d.querySelector('.phone-sync__subtitle')) : null,
    phrases: [...d.querySelectorAll('.phone-sync__body > p')].map(texte),
    etapes: [...d.querySelectorAll('.phone-sync__steps li')].map(texte),
    dossier: d.querySelector('.phone-sync__folder') ? texte(d.querySelector('.phone-sync__folder')) : null,
    lignes: [...d.querySelectorAll('.phone-sync__row summary')].map((s) => texte(s.querySelector('.phone-sync__row-label')) + ' : ' + texte(s.querySelector('.phone-sync__row-text'))),
    notes: [...d.querySelectorAll('.phone-sync__note')].map((n) => ({ texte: texte(n.querySelector(':scope > p')), detail: n.querySelector('.phone-sync__detail p') ? texte(n.querySelector('.phone-sync__detail p')) : null })),
    detail: d.querySelector('.phone-sync__body > .phone-sync__detail p') ? texte(d.querySelector('.phone-sync__body > .phone-sync__detail p')) : null,
    boutons: [...d.querySelectorAll('.phone-sync__actions button')].map(texte),
  };
})()`);
const montrer = (quoi, r) => {
  console.log(`  ${quoi} : ${r?.titre ?? '(fenêtre fermée)'}${r?.sousTitre ? ` — ${r.sousTitre}` : ''}`);
  for (const l of r?.phrases ?? []) console.log(`    | ${l}`);
  if (r?.dossier) console.log(`    [${r.dossier}]`);
  for (const l of r?.lignes ?? []) console.log(`    · ${l}`);
  for (const n of r?.notes ?? []) console.log(`    ! ${n.texte}${n.detail ? ` (${n.detail})` : ''}`);
  console.log(`    boutons : ${(r?.boutons ?? []).join(' / ')}`);
};
/** Ouvre Réglages (la carte Mémoire porte le bouton). */
async function reglages(b) {
  await b.go('/parametres', 5000);
  await b.waitFor(`Boolean(document.querySelector(${JSON.stringify(BOUTON)}))`, { timeout: 10000, label: 'bouton Synchroniser' });
}
/**
 * Marque la rangée de boutons montrée avant un clic : `attendre` ne prend que celle d'après, jamais l'ancienne (un résultat
 * neuf, pas un texte « différent », qui peut rester le même). Entre deux, l'avancement n'a pas de rangée de boutons.
 */
const marquer = (b) => b.evaluate(`(() => { const r = document.querySelector('${FENETRE} .phone-sync__actions'); if (r) r.dataset.bancAncien = '1'; return true; })()`);
/** Attend que la fenêtre s'arrête sur une étape neuve (compte rendu, écran de départ, attente, question), puis la relève. */
async function attendre(b, quoi) {
  await b.waitFor(`[...document.querySelectorAll('${FENETRE} .phone-sync__actions:not([data-banc-ancien]) button')].some((x) => ${JSON.stringify(ARRETS)}.includes(x.textContent.trim()))`, { timeout: 180000, label: quoi });
  await b.settle({ max: 300, label: `${quoi}, relevé` }); // la fenêtre finit de dessiner (l'ancienne attente fixe pour plafond)
  const r = await releve(b);
  montrer(quoi, r);
  return r;
}
/** Clique « Synchroniser avec le téléphone » et attend la première étape où la fenêtre s'arrête. */
async function synchroniser(b, quoi) {
  await marquer(b);
  check(`${quoi} : clic sur « Synchroniser avec le téléphone »`, (await b.click(BOUTON)) === 'ok');
  return attendre(b, quoi);
}
const repondre = async (b, texte, quoi) => {
  await marquer(b);
  check(`${quoi} : clic sur « ${texte} »`, (await b.clickText(texte, `${FENETRE} .phone-sync__actions button`)) === 'ok');
  return attendre(b, quoi);
};
/** Ferme la fenêtre par son bouton « Fermer », ou par sa croix (`croix`). */
const fermerFenetre = async (b, croix = false) => {
  if (croix) await b.click(`${FENETRE} .ui-dialog__close`);
  else await b.clickText('Fermer', `${FENETRE} .phone-sync__actions button`);
  await b.waitFor(`!document.querySelector(${JSON.stringify(FENETRE)})`, { timeout: 2000, label: 'fenêtre refermée' });
};
/** Vrai si la fenêtre montre une question (le garde-fou ou la corbeille). */
const question = (r) => (r?.boutons ?? []).some((x) => ['Tout garder', 'La garder', 'Les garder', 'Le garder'].includes(x));
/**
 * Attend la page au repos (le minuteur de 800 ms des réécritures de fiches compris, `recordWrites.ts`) puis les dossiers
 * de l'ordinateur immobiles (aucun fichier écrit depuis 300 ms), `plafond` ms au plus : l'ancienne attente fixe des
 * écritures différées, au pire le temps d'avant. Le téléphone n'est pas sondé (un `find` par le câble à chaque tour) :
 * ses écritures sont finies quand le compte rendu s'affiche.
 */
async function ecrituresFinies(b, dossiers, plafond, quoi) {
  const t0 = Date.now();
  await b.settle({ max: plafond, label: quoi });
  let vu = null;
  let depuis = Date.now();
  await b.waitFor(() => {
    let e;
    try { e = dossiers.map(empreinteLocale).join('#'); } catch { depuis = Date.now(); return false; } // un fichier renommé pendant la lecture : il bouge encore
    if (e !== vu) { vu = e; depuis = Date.now(); return false; }
    return Date.now() - depuis >= 300;
  }, { timeout: Math.max(0, plafond - (Date.now() - t0)), every: 100, label: `${quoi}, disque immobile` });
}

const gpxSynthetique = (jour) => traceDroite({ debutMs: Date.UTC(2026, 9, jour, 8, 0, 0), secondes: 300, vitesse: 4, type: 'wingfoil', nom: `Session ${jour}` });
async function preparer(memoire, jours, quoi) {
  await avecProgramme(dossier(`prep-${quoi}`), memoire, {}, `préparation ${quoi}`, async (b) => {
    await b.go('/voile', 5000);
    for (const j of jours) check(`préparation ${quoi} : import de la session du ${j}`, (await b.importGpx(gpxSynthetique(j), `s${j}.gpx`)) === 'ok');
    await b.waitFor(() => gpxDe(memoire).length >= jours.length && fichesDe(memoire).length >= jours.length, { timeout: 20000, label: 'fiches' });
    await ecrituresFinies(b, [memoire], 2000, `préparation ${quoi}`);
  });
}

try {
  console.log('== Téléphone');
  const appareils = (adb(['devices']).stdout ?? '').split(/\r?\n/).filter((l) => /\tdevice$/.test(l));
  check('un seul téléphone branché et autorisé', appareils.length === 1, appareils.join(' ; '));
  if (appareils.length !== 1) throw new Error('pas de téléphone');
  check('le vrai dossier Documents/Tracker existe', existe(VRAI));
  if (existe(ESSAI) || existe(ANCIENNE_CORBEILLE)) throw new Error(`${ESSAI} ou ${ANCIENNE_CORBEILLE} existe déjà : à retirer à la main avant de rejouer`);
  const vraiAvant = empreinte(VRAI);
  console.log(`vrai dossier : ${vraiAvant.split('\n').length} fichiers relevés`);

  console.log('\n== Préparation : sessions écrites par le programme, deux itinéraires lus sur le vrai dossier');
  const MP = dossier('prep-telephone-memoire');
  await preparer(MP, [1, 2, 3], 'téléphone');
  const MC = dossier('ordinateur-memoire');
  await preparer(MC, [4, 5], 'ordinateur');
  const PC = dossier('ordinateur-profil');
  const lus = dossier('itineraires-lus');
  for (const nom of ITINERAIRES) for (const ext of ['gpx', 'json']) adb(['pull', `${VRAI}/itineraires/${nom}.${ext}`, join(lus, `${nom}.${ext}`)]);
  const itinerairesLus = ITINERAIRES.filter((nom) => existsSync(join(lus, `${nom}.gpx`)) && existsSync(join(lus, `${nom}.json`)));
  check('deux itinéraires au nom accentué lus par le câble', itinerairesLus.length === 2, readdirSync(lus).join(' ; '));
  // Le dossier d'essai du téléphone : trois sessions et le premier itinéraire ; le second va sur l'ordinateur.
  const local = join(dossier('pour-telephone'), 'Tracker-essai');
  mkdirSync(join(local, 'sessions'), { recursive: true });
  mkdirSync(join(local, 'itineraires'), { recursive: true });
  writeFileSync(join(local, 'tracker.json'), `${JSON.stringify({ format: 'tracker-memoire', version: 1 })}\n`);
  for (const n of readdirSync(join(MP, 'sessions'))) if (/\.(gpx|json)$/.test(n)) copyFileSync(join(MP, 'sessions', n), join(local, 'sessions', n));
  if (itinerairesLus.length === 2) {
    for (const ext of ['gpx', 'json']) copyFileSync(join(lus, `${ITINERAIRES[0]}.${ext}`), join(local, 'itineraires', `${ITINERAIRES[0]}.${ext}`));
    mkdirSync(join(MC, 'itineraires'), { recursive: true });
    for (const ext of ['gpx', 'json']) copyFileSync(join(lus, `${ITINERAIRES[1]}.${ext}`), join(MC, 'itineraires', `${ITINERAIRES[1]}.${ext}`));
  }
  const pousse = adb(['push', local, '/sdcard/Documents/']);
  check('dossier d’essai posé sur le téléphone', pousse.status === 0 && existe(`${ESSAI}/tracker.json`), `${pousse.stdout} ${pousse.stderr}`.trim().slice(-200));
  const surTel = liste(ESSAI).filter((c) => /^sessions\/.*\.gpx$/.test(c)).map((c) => c.slice('sessions/'.length));
  const surPc = gpxDe(MC);
  console.log(`téléphone, dossier d'essai : ${liste(ESSAI).join(' ; ')}`);
  console.log(`ordinateur : ${surPc.join(' ; ')}`);
  const ENV = { TRACKER_BANC_RACINE_TELEPHONE: 'Tracker-essai' };
  const annonce = (p) => p.journal.some((l) => l.includes("vrai téléphone, racine d'essai : Documents/Tracker-essai"));

  console.log('\n== a. Écran de départ fermé, puis « Commencer » : première synchronisation');
  await avecProgramme(PC, MC, ENV, 'a', async (b, p) => {
    if (!annonce(p)) throw new Error(`la coquille n'annonce pas la racine d'essai : ${p.journal.slice(-5).join(' | ')}`);
    check('a. la coquille annonce « vrai téléphone, racine d’essai : Documents/Tracker-essai »', true);
    await reglages(b);
    const essaiAvant = empreinte(ESSAI);
    let r = await synchroniser(b, 'a');
    check('a. l’écran de départ, « Commencer » seul', /^Première synchronisation avec/.test(r?.titre ?? '') && r?.boutons?.join('/') === 'Commencer', `${r?.titre} ${r?.boutons?.join('/')}`);
    check('a. l’écran de départ n’a rien écrit sur le téléphone (dossier d’essai)', empreinte(ESSAI) === essaiAvant);
    check('a. l’écran de départ annonce la copie de sécurité', (r?.phrases ?? []).some((x) => x.includes('par sécurité')), JSON.stringify(r?.phrases));
    await fermerFenetre(b, true);
    await b.wait(400); // attente fixe voulue : le contrôle qui suit prouve aussi une absence (rien d'écrit sur le téléphone)
    check('a. fermer l’écran de départ ne fait rien', (await releve(b)) === null && empreinte(ESSAI) === essaiAvant);
    r = await synchroniser(b, 'a, de nouveau');
    r = await repondre(b, 'Commencer', 'a. compte rendu');
    check('a. titre « Synchronisation terminée »', r?.titre === 'Synchronisation terminée', r?.titre);
    await ecrituresFinies(b, [MC], 1500, 'a. après la synchronisation');
    const tel = liste(ESSAI);
    console.log(`  téléphone après : ${tel.join(' ; ')}`);
    check('a. cinq sessions entières sur le téléphone', tel.filter((c) => /^sessions\/.*\.gpx$/.test(c)).length === 5 && tel.filter((c) => /^sessions\/.*\.json$/.test(c)).length === 5);
    check('a. cinq sessions entières sur l’ordinateur', gpxDe(MC).length === 5 && fichesDe(MC).length === 5, gpxDe(MC).join(' ; '));
    check('a. l’itinéraire de l’ordinateur est arrivé sur le téléphone, nom accentué intact', tel.includes(`itineraires/${ITINERAIRES[1]}.gpx`) && tel.includes(`itineraires/${ITINERAIRES[1]}.json`));
    const pcIti = existsSync(join(MC, 'itineraires')) ? readdirSync(join(MC, 'itineraires')).sort() : [];
    check('a. l’itinéraire du téléphone est arrivé sur l’ordinateur, nom accentué intact', pcIti.includes(`${ITINERAIRES[0]}.gpx`) && pcIti.includes(`${ITINERAIRES[0]}.json`), pcIti.join(' ; '));
    check('a. aucun fichier provisoire sur le téléphone', tel.filter((c) => /\.tracker-(tmp|new)$/.test(c)).length === 0);
    const copies = join(PC, 'Documents-essai', 'Tracker-copies');
    const copie = existsSync(copies) ? readdirSync(copies) : [];
    check('a. une copie de sécurité, avec les trois sessions et l’itinéraire du téléphone', copie.length === 1 && gpxDe(join(copies, copie[0], 'telephone')).length === 3 && existsSync(join(copies, copie[0], 'telephone', 'itineraires', `${ITINERAIRES[0]}.gpx`)), copie.join(','));
    if (copie.length === 1) {
      const a = readFileSync(join(copies, copie[0], 'telephone', 'sessions', surTel[0]));
      check('a. la session copiée du téléphone est identique à l’original, octet pour octet', a.equals(readFileSync(join(MP, 'sessions', surTel[0]))) && readFileSync(join(MC, 'sessions', surTel[0])).equals(a));
    }
    check('a. le marqueur du téléphone porte l’instant de la synchronisation', /"synchro":\s*\d+/.test(sh(`cat ${ESSAI}/tracker.json`)));
    await fermerFenetre(b);
    r = await synchroniser(b, 'a, sans rien à faire');
    check('a. deuxième passage : un clic, « Tout est à jour »', r?.titre === 'Tout est à jour', r?.titre);
    await fermerFenetre(b);
  });

  console.log('\n== b. Une suppression de chaque côté, en un clic');
  for (const n of [surTel[0], surTel[0].replace(/\.gpx$/, '.json')]) sh(`rm '${sousEssai(`${ESSAI}/sessions/${n}`)}'`);
  for (const n of [surPc[0], surPc[0].replace(/\.gpx$/, '.json')]) rmSync(join(MC, 'sessions', n), { force: true });
  console.log(`supprimée sur le téléphone : ${surTel[0]} ; supprimée sur l'ordinateur : ${surPc[0]}`);
  await avecProgramme(PC, MC, ENV, 'b', async (b, p) => {
    if (!annonce(p)) throw new Error('la coquille n’annonce pas la racine d’essai');
    await reglages(b);
    const r = await synchroniser(b, 'b');
    check('b. un clic, aucune question', !question(r), r?.boutons?.join(' / '));
    if (!question(r)) {
      check('b. titre « Synchronisation terminée »', r?.titre === 'Synchronisation terminée', r?.titre);
      await ecrituresFinies(b, [MC], 1500, 'b. après les retraits');
      const tel = liste(ESSAI);
      console.log(`  téléphone après : ${tel.join(' ; ')}`);
      console.log(`  corbeille du téléphone : ${liste(CORBEILLE).join(' ; ')}`);
      console.log(`  ordinateur après : ${gpxDe(MC).join(' ; ')} ; corbeille : ${JSON.stringify(corbeilleDe(MC).map((e) => e.main))}`);
      check('b. la session supprimée sur le téléphone a quitté l’ordinateur pour sa corbeille', !gpxDe(MC).includes(surTel[0]) && corbeilleDe(MC).some((e) => e.kind === 'session'));
      check('b. la session supprimée sur l’ordinateur a quitté le dossier d’essai…', !tel.includes(`sessions/${surPc[0]}`));
      check('b. … pour un dépôt de Documents/Tracker-essai/corbeille, ouvert par depose.json', liste(CORBEILLE).some((c) => c.endsWith(`/${surPc[0]}`)) && liste(CORBEILLE).some((c) => c.endsWith('/depose.json')));
      check('b. l’ordinateur n’a pas écrit l’index de la corbeille du téléphone', !tel.includes('corbeille/corbeille.json'));
      check('b. rien dans l’ancien Documents/Tracker-essai-corbeille', !existe(ANCIENNE_CORBEILLE));
      await fermerFenetre(b);
    }
  });

  console.log('\n== Vrai dossier');
  check('le vrai Documents/Tracker n’a pas bougé (noms, tailles, dates)', empreinte(VRAI) === vraiAvant);
  console.log(`dossier d'essai laissé sur le téléphone (sa corbeille comprise) : ${ESSAI}`);
} catch (e) {
  check(`script interrompu : ${e.message}`, false);
} finally {
  for (const pid of lances) spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
  await pause(500); // attente fixe voulue : les programmes tués relâchent leurs fichiers avant l'effacement
  try { rmSync(RACINE, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* gardé */ }
}
console.log(`\n${echecs === 0 ? 'tout est ok' : `${echecs} échec(s)`}`);
process.exit(echecs === 0 ? 0 : 1);
