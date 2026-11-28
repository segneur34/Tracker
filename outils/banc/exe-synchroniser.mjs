// Banc de test : « Synchroniser avec le téléphone » (Réglages › Mémoire du programme Windows), de bout en bout, face à
// un faux téléphone (un dossier local qui joue son `/sdcard`). Élément 217, sous-lot 3e ; fenêtre en un geste au lot 242-2.
// Usage : node exe-synchroniser.mjs <Tracker.exe> [<port de débogage>] [<dossier de la coquille>]
//   Le troisième argument sert à lancer une coquille compilée mais pas emballée : <Tracker.exe> est alors l'`electron.exe`
//   de `bureau/node_modules`, et l'application servie se donne par `TRACKER_DIST` (dossier `dist/`).
// Hors registre (`scripts.mjs`) : le script lance lui-même le programme, en mode d'essai de la coquille (`TRACKER_BANC=1`),
// sur des dossiers du dossier temporaire du système : jamais le vrai Documents, jamais le profil du vrai programme,
// jamais un vrai téléphone (en mode d'essai, sans racine d'essai, le vrai adb n'est jamais lancé ; le script retire de
// l'environnement toute variable du téléphone d'essai qu'il ne pose pas lui-même). Les GPX sont synthétiques, leurs
// fiches écrites par le programme lui-même (une préparation les importe) ; le disque se lit par Node : c'est lui qui prouve.
// Cas (un clic, une fenêtre ; une question seulement si une perte est possible) :
//  a. première synchronisation : le bouton ouvre la fenêtre, l'écran de départ qui n'écrit rien, sa croix qui ne fait
//     rien, puis « Commencer » : copie de sécurité des deux dossiers sous `Documents\Tracker-copies`, sept sessions
//     entières de chaque côté, « Synchronisation terminée », le téléphone averti dans son marqueur (`synchro`) ;
//  b. une session supprimée sur le téléphone (une sur sept) : un clic, aucune question, dans la corbeille de l'ordinateur ;
//  c. deux autres supprimées sur le téléphone (le quart d'un appareil passé) : le garde-fou pose sa question, rien
//     n'est retiré avant la réponse ; « Tout garder » les remet sur le téléphone, et la question ne revient pas au
//     passage suivant ; deux de nouveau supprimées, « Supprimer des deux côtés » : dans la corbeille de l'ordinateur ;
//  d. listage du téléphone partiel en cours de route (`TRACKER_BANC_TELEPHONE_PANNE=listage`) : « Synchronisation
//     arrêtée », « Recommencer », qui termine la synchronisation coupée et le dit ;
//  e. copie de sécurité impossible (le dossier des copies est pris par un fichier) : « Synchronisation impossible »,
//     rien d'écrit d'aucun côté, puis « Recommencer » une fois la place libérée : la copie est faite, la session arrive ;
//  f. corbeilles jumelles (lot 242-1) : une session supprimée par l'application du téléphone (dans sa corbeille, son
//     index écrit par lui) arrive dans la corbeille de l'ordinateur ; l'index du téléphone n'est pas touché ;
//  g. une session supprimée sur l'ordinateur est déposée dans `Documents/Tracker/corbeille/<dépôt>/` du faux téléphone
//     (`depose.json`, GPX, fiche), plus rien dans `Documents/Tracker-corbeille` ;
//  h. « Restaurer » sur l'ordinateur, puis la synchronisation suivante : « Restauré », la session revient sur le
//     téléphone, sans question ;
//  i. téléphone pas prêt (fichier d'état d'essai, `TRACKER_BANC_TELEPHONE_ETAT_FICHIER`) : la fenêtre attend en
//     disant quoi faire, sans rien écrire, puis part seule quand le téléphone est là ;
//  j. le journal daté du programme (`journal.txt` du profil) note les étapes, sans nom de téléphone ni chemin ;
//  à chaque lancement, la console de la page sans erreur ; aucun temporaire laissé d'aucun côté.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from './lib/cdp.mjs';
import { traceDroite } from './lib/traces.mjs';

const [exe, portArg, appArg] = process.argv.slice(2);
if (!exe) {
  console.error('Usage : node exe-synchroniser.mjs <Tracker.exe> [<port>] [<dossier de la coquille>]');
  process.exit(1);
}
const PORT = Number(portArg ?? 9630); // port propre (exe-tous.mjs, SCRIPTS_EXE) : jamais celui d'un autre script ni de Gtracker
const ORIGINE = 'https://tracker.localhost'; // `bureau/origine.ts`
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const vivant = (pid) => spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8', windowsHide: true }).stdout.includes(` ${pid} `);
// Compté en vrai temps : `tasklist` prend lui-même 150 à 250 ms, un compte de tours doublait l'attente.
const disparu = async (pid, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (!vivant(pid)) return true; await pause(200); } return !vivant(pid); };

let echecs = 0;
const check = (quoi, ok, detail) => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${quoi}${!ok && detail !== undefined ? ` (${detail})` : ''}`); if (!ok) echecs++; };

const RACINE = mkdtempSync(join(tmpdir(), 'trk-sync-'));
const dossier = (nom) => { const d = join(RACINE, nom); mkdirSync(d, { recursive: true }); return d; };

/** Tous les fichiers sous `racine`, chemins relatifs en `/` (triés). */
const arbre = (racine) => {
  if (!existsSync(racine)) return [];
  const sortie = [];
  const voir = (d, prefixe) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) voir(join(d, e.name), `${prefixe}${e.name}/`); else sortie.push(`${prefixe}${e.name}`);
    }
  };
  voir(racine, '');
  return sortie.sort();
};
/** Arbre avec la taille et l'heure de chaque fichier : change si quoi que ce soit est écrit. */
const empreinte = (racine) => arbre(racine).map((c) => `${c}:${statSync(join(racine, c)).size}:${statSync(join(racine, c)).mtimeMs}`).join('|');
const temporaires = (racine) => arbre(racine).filter((c) => /\.tracker-(tmp|new)$/.test(c));
const gpxDe = (memoire) => (existsSync(join(memoire, 'sessions')) ? readdirSync(join(memoire, 'sessions')).filter((n) => n.endsWith('.gpx')).sort() : []);
const fichesDe = (memoire) => (existsSync(join(memoire, 'sessions')) ? readdirSync(join(memoire, 'sessions')).filter((n) => n.endsWith('.json')).sort() : []);
/** Chaque GPX a sa fiche à côté. */
const entieres = (memoire) => gpxDe(memoire).every((g) => fichesDe(memoire).includes(g.replace(/\.gpx$/, '.json')));

const lances = new Set();
/** Variables du téléphone d'essai : jamais héritées du poste. */
const VARIABLES_TELEPHONE = ['TRACKER_BANC_TELEPHONE', 'TRACKER_BANC_TELEPHONE_ETAT', 'TRACKER_BANC_TELEPHONE_COUPURE', 'TRACKER_BANC_RACINE_TELEPHONE', 'TRACKER_BANC_TELEPHONE_ENREGISTREMENT', 'TRACKER_BANC_TELEPHONE_PANNE', 'TRACKER_BANC_TELEPHONE_ETAT_FICHIER'];
/** Une instance du programme ; `env` s'ajoute à l'environnement d'essai. */
async function lancer(profil, memoire, env = {}) {
  const complet = { ...process.env, TRACKER_BANC: '1', TRACKER_PROFIL: profil, TRACKER_MEMOIRE: memoire, TRACKER_DOCUMENTS: join(profil, 'Documents-essai'), TRACKER_BANC_MONTRER: 'transparente', ...env };
  for (const cle of Object.keys(complet)) if (cle.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete complet[cle];
  for (const cle of VARIABLES_TELEPHONE) if (!(cle in env)) delete complet[cle];
  const args = [...(appArg ? [appArg] : []), `--remote-debugging-port=${PORT}`, '--lang=fr-FR', '--force-device-scale-factor=1', '--hide-scrollbars'];
  const child = spawn(exe, args, { env: complet, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
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
/** Ferme le programme, de force s'il le faut ; attend sa disparition. */
async function fermer(p) {
  try { await p.b.close(); } catch { /* page déjà fermée */ }
  spawnSync('taskkill', ['/PID', String(p.child.pid)], { stdio: 'ignore', windowsHide: true });
  if (!(await disparu(p.child.pid, 6000))) {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(p.child.pid)], { stdio: 'ignore', windowsHide: true });
    await disparu(p.child.pid, 5000);
  }
  await pause(500); // attente fixe voulue : le même profil est souvent rouvert juste après, ses fichiers à peine relâchés
}
/** Lance, joue `essai`, ferme toujours (même sur erreur). Vérifie la console de la page à la fin. */
async function avecProgramme(profil, memoire, env, quoi, essai) {
  let p = null;
  try {
    p = await lancer(profil, memoire, env);
    await essai(p.b, p);
    check(`${quoi} : console de la page sans erreur`, p.b.logs.length === 0, p.b.logs.join(' | '));
  } catch (e) {
    check(`${quoi} : essai interrompu : ${e.message}`, false);
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
  await b.waitFor(`[...document.querySelectorAll('${FENETRE} .phone-sync__actions:not([data-banc-ancien]) button')].some((x) => ${JSON.stringify(ARRETS)}.includes(x.textContent.trim()))`, { timeout: 60000, label: quoi });
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
 * immobiles (aucun fichier écrit depuis 300 ms : l'écriture passe par le pont, que la page ne voit pas), `plafond` ms au
 * plus : l'ancienne attente fixe des écritures différées, au pire le temps d'avant.
 */
async function ecrituresFinies(b, dossiers, plafond, quoi) {
  const t0 = Date.now();
  await b.settle({ max: plafond, label: quoi });
  let vu = null;
  let depuis = Date.now();
  await b.waitFor(() => {
    let e;
    try { e = dossiers.map(empreinte).join('#'); } catch { depuis = Date.now(); return false; } // un fichier renommé pendant la lecture : il bouge encore
    if (e !== vu) { vu = e; depuis = Date.now(); return false; }
    return Date.now() - depuis >= 300;
  }, { timeout: Math.max(0, plafond - (Date.now() - t0)), every: 100, label: `${quoi}, disque immobile` });
}

// ---------- les sessions ----------
const gpxSynthetique = (jour) => traceDroite({ debutMs: Date.UTC(2026, 9, jour, 8, 0, 0), secondes: 300, vitesse: 4, type: 'wingfoil', nom: `Session ${jour}` });
/** Importe des GPX dans une mémoire par le programme lui-même : GPX et fiches vrais. */
async function preparer(memoire, jours, quoi) {
  const profil = dossier(`prep-${quoi}`);
  await avecProgramme(profil, memoire, {}, `préparation ${quoi}`, async (b) => {
    await b.go('/voile', 5000);
    for (const j of jours) check(`préparation ${quoi} : import de la session du ${j}`, (await b.importGpx(gpxSynthetique(j), `s${j}.gpx`)) === 'ok');
    await b.waitFor(() => gpxDe(memoire).length >= jours.length && fichesDe(memoire).length >= jours.length, { timeout: 20000, label: 'fiches' });
    await ecrituresFinies(b, [memoire], 2000, `préparation ${quoi}`);
  });
  check(`préparation ${quoi} : ${jours.length} sessions entières`, gpxDe(memoire).length === jours.length && entieres(memoire), arbre(memoire).join(' | '));
}
/** Un faux téléphone qui porte les sessions de `source` (sessions/ d'une mémoire préparée). */
function telephone(nom, source) {
  const tel = dossier(nom);
  const racine = join(tel, 'Documents', 'Tracker');
  mkdirSync(join(racine, 'sessions'), { recursive: true });
  writeFileSync(join(racine, 'tracker.json'), `${JSON.stringify({ format: 'tracker-memoire', version: 1 })}\n`);
  for (const n of readdirSync(join(source, 'sessions'))) if (/\.(gpx|json)$/.test(n)) copyFileSync(join(source, 'sessions', n), join(racine, 'sessions', n));
  return tel;
}
const racineDe = (tel) => join(tel, 'Documents', 'Tracker');
/** Supprime une session sur le téléphone, comme son application : GPX et fiche, pour de bon. */
const supprimerSurTelephone = (tel, gpx) => {
  for (const n of [gpx, gpx.replace(/\.gpx$/, '.json')]) rmSync(join(racineDe(tel), 'sessions', n), { force: true });
};
const corbeilleDe = (memoire) => {
  try { return JSON.parse(readFileSync(join(memoire, 'corbeille', 'corbeille.json'), 'utf8')).entries ?? []; } catch { return []; }
};
/**
 * Met une session d'une mémoire à sa corbeille comme l'application de cet appareil, programme fermé : GPX et fiche
 * déplacés dans `corbeille/<instant>-<startMs>/`, puis l'entrée ajoutée à l'index (format de `src/library/trash.ts`).
 */
const mettreALaCorbeille = (memoire, gpx, nom, instant) => {
  const startMs = JSON.parse(readFileSync(join(memoire, 'sessions', gpx.replace(/\.gpx$/, '.json')), 'utf8')).summary.startMs;
  const dir = `${instant}-${startMs}`;
  mkdirSync(join(memoire, 'corbeille', dir), { recursive: true });
  const files = [];
  for (const n of [gpx, gpx.replace(/\.gpx$/, '.json')]) {
    files.push({ name: n, size: statSync(join(memoire, 'sessions', n)).size });
    renameSync(join(memoire, 'sessions', n), join(memoire, 'corbeille', dir, n));
  }
  const entries = [...corbeilleDe(memoire), { dir, kind: 'session', startMs, routeBase: null, createdAt: null, name: nom, deletedAtMs: instant, origin: 'ordinateur', reason: 'supprimee', main: gpx, files }];
  writeFileSync(join(memoire, 'corbeille', 'corbeille.json'), `${JSON.stringify({ format: 'tracker-corbeille', version: 1, entries }, null, 2)}\n`);
  return { dir, startMs };
};
/** Clique « Restaurer » sur la ligne de la corbeille (Réglages › Mémoire) qui porte ce nom. */
const restaurer = (b, nom) => b.evaluate(`(() => {
  const ligne = [...document.querySelectorAll('.trash-zone__row')].find((li) => li.querySelector('.trash-zone__name')?.textContent.trim() === ${JSON.stringify(nom)});
  const bouton = ligne && [...ligne.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Restaurer');
  if (!bouton) return 'absent';
  bouton.click();
  return 'ok';
})()`);

try {
  console.log('\n== Préparation : sessions écrites par le programme');
  const MP = dossier('prep-telephone-memoire');
  await preparer(MP, [1, 2, 3], 'téléphone');
  const MC = dossier('ordinateur-memoire');
  await preparer(MC, [4, 5, 7, 8], 'ordinateur');
  const MX = dossier('prep-sixieme-memoire');
  await preparer(MX, [6], 'sixième');
  const MN = dossier('prep-neuvieme-memoire');
  await preparer(MN, [9], 'neuvième');
  const PC = dossier('ordinateur-profil');
  const tel = telephone('telephone', MP);
  const surTel = gpxDe(racineDe(tel));
  console.log(`téléphone factice : ${surTel.join(' ; ')}`);
  const SOUS_TITRE = "Téléphone d'essai · par le câble";
  const marqueurTel = () => { try { return JSON.parse(readFileSync(join(racineDe(tel), 'tracker.json'), 'utf8')); } catch { return null; } };

  // ---------- a, b, c ----------
  console.log('\n== a, b, c. Première synchronisation, une suppression sans question, puis le garde-fou');
  await avecProgramme(PC, MC, { TRACKER_BANC_TELEPHONE: tel }, 'a, b, c', async (b) => {
    await reglages(b);
    const libelle = await b.evaluate(`document.querySelector(${JSON.stringify(BOUTON)})?.textContent.trim() ?? null`);
    check('a. le bouton « Synchroniser avec le téléphone » est dans Réglages › Mémoire', libelle === 'Synchroniser avec le téléphone', libelle);
    check('a. « Récupérer les sessions du téléphone » n’existe plus', !(await b.evaluate(`document.body.textContent.includes('Récupérer les sessions du téléphone')`)));
    const telAvant = empreinte(tel);
    const pcAvant = empreinte(join(MC, 'sessions'));
    let r = await synchroniser(b, 'a');
    check('a. l’écran de départ : « Première synchronisation avec « Téléphone d’essai » »', r?.titre === "Première synchronisation avec « Téléphone d'essai »", r?.titre);
    check('a. le sous-titre dit le téléphone et le câble', r?.sousTitre === SOUS_TITRE, r?.sousTitre);
    check('a. la copie de sécurité est annoncée', (r?.phrases ?? []).includes('Avant de commencer, Tracker copie les deux mémoires par sécurité.'), JSON.stringify(r?.phrases));
    check('a. « Chaque appareil va recevoir ce qui lui manque. Rien ne sera supprimé. » est dit', (r?.phrases ?? []).includes('Chaque appareil va recevoir ce qui lui manque. Rien ne sera supprimé.'), JSON.stringify(r?.phrases));
    check('a. un seul bouton, « Commencer » : ni aperçu chiffré ni retrait à confirmer', r?.boutons?.join('/') === 'Commencer', r?.boutons?.join('/'));
    check('a. l’écran de départ n’a rien écrit sur le téléphone', empreinte(tel) === telAvant);
    check('a. l’écran de départ n’a rien écrit dans sessions/ de l’ordinateur, ni synchro/ ni copie', empreinte(join(MC, 'sessions')) === pcAvant && !existsSync(join(MC, 'synchro')) && !existsSync(join(PC, 'Documents-essai', 'Tracker-copies')));
    await fermerFenetre(b, true);
    await b.wait(400); // attente fixe voulue : le contrôle qui suit prouve aussi une absence (rien d'écrit sur le téléphone)
    check('a. fermer l’écran de départ arrête tout sans rien faire', (await releve(b)) === null && empreinte(tel) === telAvant && !existsSync(join(MC, 'synchro')));

    r = await synchroniser(b, 'a, de nouveau');
    r = await repondre(b, 'Commencer', 'a. compte rendu');
    check('a. titre « Synchronisation terminée »', r?.titre === 'Synchronisation terminée', r?.titre);
    check('a. lignes « Reçu du téléphone : 3 sessions » et « Envoyé au téléphone : 4 sessions »',
      (r?.lignes ?? []).includes('Reçu du téléphone : 3 sessions') && (r?.lignes ?? []).includes('Envoyé au téléphone : 4 sessions'), JSON.stringify(r?.lignes));
    check('a. « Première synchronisation : rien n’a été supprimé. », puis où est la copie', (r?.phrases ?? []).join('|') === "Première synchronisation : rien n'a été supprimé.|Copie de sécurité :" && /Tracker-copies/.test(r?.dossier ?? ''), `${JSON.stringify(r?.phrases)} ${r?.dossier}`);
    check('a. plus de « touchez Mettre à jour » : le téléphone se met à jour seul', !JSON.stringify(r).includes('Mettre à jour'), JSON.stringify(r?.phrases));
    check('a. un seul bouton, « Fermer »', r?.boutons?.join('/') === 'Fermer', r?.boutons?.join('/'));
    const copies = join(PC, 'Documents-essai', 'Tracker-copies');
    const copie = existsSync(copies) ? readdirSync(copies) : [];
    check('a. une copie de sécurité faite, avec ordinateur\\ et telephone\\', copie.length === 1 && existsSync(join(copies, copie[0], 'ordinateur', 'sessions')) && existsSync(join(copies, copie[0], 'telephone', 'sessions')), copie.join(','));
    if (copie.length === 1) {
      check('a. la copie du téléphone tient ses trois sessions d’avant', gpxDe(join(copies, copie[0], 'telephone')).length === 3, arbre(join(copies, copie[0])).join(' | '));
      check('a. la copie de l’ordinateur tient ses quatre sessions d’avant', gpxDe(join(copies, copie[0], 'ordinateur')).length === 4);
    }
    await ecrituresFinies(b, [MC, tel], 1500, 'a. après la synchronisation');
    check('a. sept sessions entières sur l’ordinateur', gpxDe(MC).length === 7 && entieres(MC), arbre(join(MC, 'sessions')).join(' | '));
    check('a. sept sessions entières sur le téléphone', gpxDe(racineDe(tel)).length === 7 && entieres(racineDe(tel)), arbre(racineDe(tel)).join(' | '));
    check('a. aucun temporaire d’aucun côté', temporaires(MC).length + temporaires(tel).length === 0, [...temporaires(MC), ...temporaires(tel)].join(','));
    check('a. le téléphone est averti : l’instant de la synchronisation dans son marqueur', typeof marqueurTel()?.synchro === 'number', JSON.stringify(marqueurTel()));
    await fermerFenetre(b);

    // b
    supprimerSurTelephone(tel, surTel[0]);
    r = await synchroniser(b, 'b');
    check('b. un clic, aucune question : le compte rendu tout de suite', !question(r) && r?.titre === 'Synchronisation terminée', `${r?.titre} ${r?.boutons?.join('/')}`);
    check('b. ligne « Supprimé : 1 session supprimée sur le téléphone : … corbeille des deux appareils… »',
      (r?.lignes ?? []).includes('Supprimé : 1 session supprimée sur le téléphone : elle est dans la corbeille des deux appareils pour 30 jours'), JSON.stringify(r?.lignes));
    await ecrituresFinies(b, [MC, tel], 1500, 'b. après la synchronisation');
    check('b. six sessions sur l’ordinateur, une dans sa corbeille', gpxDe(MC).length === 6 && corbeilleDe(MC).filter((e) => e.kind === 'session').length === 1, `${gpxDe(MC).length} ; ${JSON.stringify(corbeilleDe(MC).map((e) => e.main))}`);
    await fermerFenetre(b);

    // c
    const avantGardeFou = gpxDe(MC);
    supprimerSurTelephone(tel, surTel[1]);
    supprimerSurTelephone(tel, surTel[2]);
    r = await synchroniser(b, 'c');
    check('c. le garde-fou pose sa question : « Beaucoup de suppressions d’un coup »', r?.titre === "Beaucoup de suppressions d'un coup", r?.titre);
    check('c. rangée par appareil : « Sur le téléphone : 2 sessions supprimées »', (r?.lignes ?? []).join('|') === 'Sur le téléphone : 2 sessions supprimées', JSON.stringify(r?.lignes));
    check('c. deux réponses : « Tout garder » / « Supprimer des deux côtés »', r?.boutons?.join('/') === 'Tout garder/Supprimer des deux côtés', r?.boutons?.join('/'));
    check('c. rien n’est retiré de l’ordinateur avant la réponse', gpxDe(MC).join() === avantGardeFou.join() && corbeilleDe(MC).length === 1);
    r = await repondre(b, 'Tout garder', 'c. « Tout garder »');
    check('c. « Tout garder » : ligne « Gardé : 2 sessions gardées : remises là où elles manquaient »', (r?.lignes ?? []).includes('Gardé : 2 sessions gardées : remises là où elles manquaient'), JSON.stringify(r?.lignes));
    await ecrituresFinies(b, [MC, tel], 1500, 'c. après « Tout garder »');
    check('c. les deux sessions sont de nouveau entières sur le téléphone, rien n’est retiré de l’ordinateur', gpxDe(racineDe(tel)).includes(surTel[1]) && gpxDe(racineDe(tel)).includes(surTel[2]) && entieres(racineDe(tel)) && gpxDe(MC).length === 6, arbre(join(racineDe(tel), 'sessions')).join(' | '));
    await fermerFenetre(b);
    r = await synchroniser(b, 'c, passage suivant');
    check('c. au passage suivant, la question ne revient pas : « Tout est à jour »', !question(r) && r?.titre === 'Tout est à jour', `${r?.titre} ${r?.boutons?.join('/')}`);
    await fermerFenetre(b);
    supprimerSurTelephone(tel, surTel[1]);
    supprimerSurTelephone(tel, surTel[2]);
    r = await synchroniser(b, 'c, de nouveau supprimées');
    check('c. la question revient pour ces suppressions neuves', question(r) && r?.titre === "Beaucoup de suppressions d'un coup", r?.titre);
    r = await repondre(b, 'Supprimer des deux côtés', 'c. retraits confirmés');
    check('c. « Synchronisation terminée »', r?.titre === 'Synchronisation terminée', r?.titre);
    check('c. ligne « Supprimé : 2 sessions supprimées sur le téléphone… »', (r?.lignes ?? []).some((l) => l.startsWith('Supprimé : 2 sessions supprimées sur le téléphone')), JSON.stringify(r?.lignes));
    await ecrituresFinies(b, [MC, tel], 1500, 'c. après les retraits');
    check('c. quatre sessions sur l’ordinateur, trois dans sa corbeille', gpxDe(MC).length === 4 && corbeilleDe(MC).filter((e) => e.kind === 'session').length === 3, `${gpxDe(MC).length} ; ${JSON.stringify(corbeilleDe(MC).map((e) => e.main))}`);
    await fermerFenetre(b);
  });

  // ---------- d ----------
  console.log('\n== d. Listage partiel du téléphone en cours de route, puis « Recommencer »');
  for (const n of readdirSync(join(MX, 'sessions'))) if (/\.(gpx|json)$/.test(n)) copyFileSync(join(MX, 'sessions', n), join(MC, 'sessions', n));
  await avecProgramme(PC, MC, { TRACKER_BANC_TELEPHONE: tel, TRACKER_BANC_TELEPHONE_PANNE: 'listage' }, 'd', async (b) => {
    await reglages(b);
    let r = await synchroniser(b, 'd');
    check('d. « Synchronisation arrêtée »', r?.titre === 'Synchronisation arrêtée', r?.titre);
    const arret = (r?.notes ?? []).find((n) => /Ce qui est fait est gardé/.test(n.texte));
    check('d. l’arrêt est dit, ce qui est fait est gardé, le listage incomplet en détail', arret !== undefined && /Listage du téléphone incomplet/.test(arret.detail ?? ''), JSON.stringify(r?.notes));
    check('d. « Recommencer » offert', (r?.boutons ?? []).join('/') === 'Recommencer/Fermer', r?.boutons?.join('/'));
    check('d. le témoin de la synchronisation coupée est resté', existsSync(join(MC, 'synchro', 'en-cours.json')));
    r = await repondre(b, 'Recommencer', 'd. après « Recommencer »');
    check('d. « Synchronisation terminée » à la reprise', r?.titre === 'Synchronisation terminée', r?.titre);
    check('d. la reprise dit avoir terminé la synchronisation coupée', (r?.phrases ?? []).includes("La synchronisation précédente s'était arrêtée en route : elle vient d'être terminée."), JSON.stringify(r?.phrases));
    check('d. le témoin est retiré', !existsSync(join(MC, 'synchro', 'en-cours.json')));
    check('d. la sixième session est entière sur le téléphone', gpxDe(racineDe(tel)).length === 5 && entieres(racineDe(tel)), arbre(racineDe(tel)).join(' | '));
    check('d. aucun temporaire d’aucun côté', temporaires(MC).length + temporaires(tel).length === 0);
  });

  // ---------- f, g, h, i, j ----------
  console.log('\n== f, g, h. Corbeilles jumelles : une suppression de chaque côté, puis « Restaurer » sur l’ordinateur');
  {
    const Z = gpxDe(racineDe(tel))[0];
    const Y = gpxDe(MC)[1];
    const instant = Date.now();
    const SUR_TEL = 'Supprimée sur le téléphone';
    const SUR_PC = 'Supprimée sur l’ordinateur';
    const z = mettreALaCorbeille(racineDe(tel), Z, SUR_TEL, instant - 120_000);
    const y = mettreALaCorbeille(MC, Y, SUR_PC, instant - 60_000);
    const indexTel = join(racineDe(tel), 'corbeille', 'corbeille.json');
    const indexTelAvant = readFileSync(indexTel, 'utf8');
    // Le fichier d'état d'essai : vide, le téléphone répond comme d'ordinaire (cas i).
    const etat = join(RACINE, 'etat-telephone.txt');
    writeFileSync(etat, '');
    console.log(`supprimée sur le téléphone : ${Z} ; sur l'ordinateur : ${Y}`);
    await avecProgramme(PC, MC, { TRACKER_BANC_TELEPHONE: tel, TRACKER_BANC_TELEPHONE_ETAT_FICHIER: etat }, 'f, g, h, i', async (b) => {
      await reglages(b);
      let r = await synchroniser(b, 'f, g');
      check('f, g. un clic, aucune question : « Synchronisation terminée »', !question(r) && r?.titre === 'Synchronisation terminée', `${r?.titre} ${r?.boutons?.join('/')}`);
      check('f. ligne « Supprimé : 1 session supprimée sur le téléphone… »', (r?.lignes ?? []).some((l) => l.startsWith('Supprimé : 1 session supprimée sur le téléphone')), JSON.stringify(r?.lignes));
      check('g. ligne « … supprimée sur l’ordinateur, retirée du téléphone : elle est dans la corbeille des deux appareils pour 30 jours »',
        (r?.lignes ?? []).includes("Supprimé : 1 session supprimée sur l'ordinateur, retirée du téléphone : elle est dans la corbeille des deux appareils pour 30 jours"), JSON.stringify(r?.lignes));
      await ecrituresFinies(b, [MC, tel], 1500, 'f, g. après la synchronisation');
      check('f. la session supprimée sur le téléphone est dans la corbeille de l’ordinateur', !gpxDe(MC).includes(Z) && corbeilleDe(MC).some((e) => e.kind === 'session' && e.startMs === z.startMs), JSON.stringify(corbeilleDe(MC).map((e) => e.main)));
      check('f, g. l’index de la corbeille du téléphone n’est pas touché par l’ordinateur', readFileSync(indexTel, 'utf8') === indexTelAvant);
      const corbeilleTel = join(racineDe(tel), 'corbeille');
      const depots = readdirSync(corbeilleTel).filter((n) => n.endsWith(`-${y.startMs}`));
      const depot = depots.length === 1 ? join(corbeilleTel, depots[0]) : null;
      check('g. un dépôt dans Documents/Tracker/corbeille/ du faux téléphone : depose.json, GPX et fiche',
        depot !== null && ['depose.json', Y, Y.replace(/\.gpx$/, '.json')].every((n) => existsSync(join(depot, n))), arbre(corbeilleTel).join(' | '));
      if (depot !== null) {
        const depose = JSON.parse(readFileSync(join(depot, 'depose.json'), 'utf8'));
        check('g. depose.json dit la session, l’ordinateur et ses fichiers', depose.format === 'tracker-depot' && depose.origine === 'ordinateur' && depose.kind === 'session' && depose.startMs === y.startMs && depose.files.length === 2, JSON.stringify(depose));
      }
      check('g. la session n’est plus dans sessions/ du téléphone', !gpxDe(racineDe(tel)).includes(Y));
      check('g. plus rien dans Documents/Tracker-corbeille', !existsSync(join(tel, 'Documents', 'Tracker-corbeille')));
      check('f, g. aucun temporaire d’aucun côté', temporaires(MC).length + temporaires(tel).length === 0, [...temporaires(MC), ...temporaires(tel)].join(','));
      await fermerFenetre(b);

      // h
      // Comme memoire-disque.mjs : la carte Mémoire dépliée (repliée, elle ne montre que sa ligne d'état et la
      // synchronisation), puis la ligne « Corbeille : … » dépliée par la page elle-même.
      const ouverte = `/Emplacement : .*, sur ce PC\\./.test(document.body.innerText)`;
      if (!(await b.evaluate(ouverte))) await b.click(`[...document.querySelectorAll('[role=button]')].find((x) => x.textContent.trim() === 'Mémoire')`);
      await b.waitFor(ouverte, { timeout: 8000, label: 'carte Mémoire dépliée' });
      await b.evaluate(`(() => { const t = document.querySelector('.trash-zone__toggle'); if (t && t.getAttribute('aria-expanded') !== 'true') t.click(); })()`);
      check('h. la corbeille de l’ordinateur se déplie sur la session supprimée sur l’ordinateur', Boolean(await b.waitFor(`[...document.querySelectorAll('.trash-zone__name')].some((x) => x.textContent.trim() === ${JSON.stringify(SUR_PC)})`, { timeout: 5000, label: 'ligne de la corbeille' })),
        String(await b.evaluate(`document.querySelector('.trash-zone')?.innerText ?? 'pas de corbeille'`)));
      check('h. « Restaurer » sur la session supprimée sur l’ordinateur', (await restaurer(b, SUR_PC)) === 'ok');
      await b.waitFor(`[...document.querySelectorAll('.trash-zone__text')].some((p) => p.textContent.includes('est revenue dans la mémoire'))`, { timeout: 15000, label: 'restauration' });
      await ecrituresFinies(b, [MC], 1500, 'h. après « Restaurer »');
      check('h. la session est revenue sur l’ordinateur, et a quitté sa corbeille', gpxDe(MC).includes(Y) && !corbeilleDe(MC).some((e) => e.startMs === y.startMs), gpxDe(MC).join(' ; '));
      r = await synchroniser(b, 'h');
      check('h. un clic, aucune question : « Synchronisation terminée »', !question(r) && r?.titre === 'Synchronisation terminée', `${r?.titre} ${r?.boutons?.join('/')}`);
      check('h. ligne « Restauré : 1 session sortie de la corbeille : renvoyée au téléphone »', (r?.lignes ?? []).includes('Restauré : 1 session sortie de la corbeille : renvoyée au téléphone'), JSON.stringify(r?.lignes));
      await ecrituresFinies(b, [MC, tel], 1500, 'h. après la synchronisation');
      check('h. la session revient sur le téléphone, entière', gpxDe(racineDe(tel)).includes(Y) && entieres(racineDe(tel)), arbre(join(racineDe(tel), 'sessions')).join(' | '));
      check('h. aucun temporaire d’aucun côté', temporaires(MC).length + temporaires(tel).length === 0);
      await fermerFenetre(b);

      // i
      console.log('\n== i. Téléphone pas prêt : la fenêtre attend, puis part seule');
      writeFileSync(etat, 'absent');
      // Une session neuve sur l'ordinateur, que le téléphone attend.
      for (const n of readdirSync(join(MN, 'sessions'))) if (/\.(gpx|json)$/.test(n)) copyFileSync(join(MN, 'sessions', n), join(MC, 'sessions', n));
      const avantAttente = empreinte(tel);
      r = await synchroniser(b, 'i. attente');
      check('i. « En attente de votre téléphone », sans rien synchroniser', r?.titre === 'En attente de votre téléphone' && empreinte(tel) === avantAttente, r?.titre);
      check('i. quoi faire sur le téléphone : le câble, puis déverrouiller', (r?.etapes ?? []).join('|') === 'branchez-le à cet ordinateur par un câble USB ;|déverrouillez son écran.', JSON.stringify(r?.etapes));
      check('i. « La synchronisation démarre toute seule dès qu’il est là. », et « Annuler »', (r?.phrases ?? []).includes("La synchronisation démarre toute seule dès qu'il est là.") && r?.boutons?.join('/') === 'Annuler', `${JSON.stringify(r?.phrases)} ${r?.boutons?.join('/')}`);
      writeFileSync(etat, 'autorisation');
      check('i. un téléphone branché qui demande l’autorisation est dit, relu sans relancer', Boolean(await b.waitFor(`/demande une autorisation/.test(document.querySelector(${JSON.stringify(FENETRE)})?.textContent ?? '')`, { timeout: 8000, label: 'autorisation dite' })));
      await marquer(b);
      writeFileSync(etat, '');
      r = await attendre(b, 'i. départ seul');
      check('i. le téléphone là, la synchronisation part seule : « Synchronisation terminée »', r?.titre === 'Synchronisation terminée', r?.titre);
      check('i. ligne « Envoyé au téléphone : 1 session »', (r?.lignes ?? []).includes('Envoyé au téléphone : 1 session'), JSON.stringify(r?.lignes));
      await ecrituresFinies(b, [MC, tel], 1500, 'i. après la synchronisation');
      check('i. la session revient sur le téléphone, entière', gpxDe(racineDe(tel)).length === gpxDe(MC).length && entieres(racineDe(tel)), arbre(join(racineDe(tel), 'sessions')).join(' | '));
      await fermerFenetre(b);
    });

    // j
    console.log('\n== j. Journal daté du programme');
    const journal = existsSync(join(PC, 'journal.txt')) ? readFileSync(join(PC, 'journal.txt'), 'utf8') : '';
    check('j. journal.txt écrit dans le profil du programme', journal.length > 0);
    check('j. il note les étapes de la fenêtre', ['page : Synchroniser : recherche du téléphone', 'page : Synchroniser : compte rendu', 'page : Synchroniser : question posée', 'page : Synchroniser : attente (téléphone absent)', "page : Synchroniser : fin de l'attente, reprise"].every((l) => journal.includes(l)), journal.split('\n').filter((l) => l.includes('page :')).slice(0, 12).join(' | '));
    check('j. il note les états lus du téléphone qui changent', journal.includes('état du téléphone : prêt') && journal.includes('état du téléphone : absent'));
    check('j. ni nom de téléphone ni chemin du poste', !journal.includes("Téléphone d'essai") && !journal.toLowerCase().includes(RACINE.toLowerCase()) && !/[A-Za-z]:\\/.test(journal));
    check('j. chaque ligne est datée', journal.trim().split('\n').every((l) => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} /.test(l)));
  }

  // ---------- e ----------
  console.log('\n== e. Copie de sécurité impossible, puis « Recommencer »');
  {
    const P2 = dossier('e-profil');
    const M2 = dossier('e-memoire');
    const tel2 = telephone('e-telephone', MX);
    const documents = dossier('e-documents');
    writeFileSync(join(documents, 'Tracker-copies'), 'un fichier qui prend la place du dossier des copies');
    await avecProgramme(P2, M2, { TRACKER_BANC_TELEPHONE: tel2, TRACKER_DOCUMENTS: documents }, 'e', async (b) => {
      await reglages(b);
      const telAvant = empreinte(tel2);
      let r = await synchroniser(b, 'e');
      check('e. l’écran de départ d’abord', r?.titre === "Première synchronisation avec « Téléphone d'essai »", r?.titre);
      r = await repondre(b, 'Commencer', 'e. compte rendu');
      check('e. « Synchronisation impossible »', r?.titre === 'Synchronisation impossible', r?.titre);
      check('e. « La copie de sécurité n’a pas pu être faite : rien n’a été synchronisé. »', (r?.phrases ?? []).includes("La copie de sécurité n'a pas pu être faite : rien n'a été synchronisé."), JSON.stringify(r?.phrases));
      check('e. « Recommencer » offert', (r?.boutons ?? []).join('/') === 'Recommencer/Fermer', r?.boutons?.join('/'));
      check('e. rien d’écrit : téléphone intact, aucune session ni synchro/ sur l’ordinateur', empreinte(tel2) === telAvant && gpxDe(M2).length === 0 && !existsSync(join(M2, 'synchro')));
      rmSync(join(documents, 'Tracker-copies'));
      r = await repondre(b, 'Recommencer', 'e. après « Recommencer »');
      if ((r?.boutons ?? []).includes('Commencer')) r = await repondre(b, 'Commencer', 'e. reprise');
      check('e. « Synchronisation terminée »', r?.titre === 'Synchronisation terminée', r?.titre);
      const copies = existsSync(join(documents, 'Tracker-copies')) ? readdirSync(join(documents, 'Tracker-copies')) : [];
      check('e. la copie de sécurité est faite', copies.length === 1 && !/incomplète/.test(copies[0]), copies.join(','));
      await ecrituresFinies(b, [M2, tel2], 1500, 'e. après la synchronisation');
      check('e. la session du téléphone est entière sur l’ordinateur', gpxDe(M2).length === 1 && entieres(M2), arbre(join(M2, 'sessions')).join(' | '));
    });
  }
} catch (e) {
  check(`script interrompu : ${e.stack ?? e.message}`, false);
} finally {
  for (const pid of lances) if (vivant(pid)) spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
  await pause(800); // attente fixe voulue : les programmes tués relâchent leurs fichiers avant l'effacement
  rmSync(RACINE, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
}

console.log(echecs === 0 ? '\nTout passe.' : `\n${echecs} échec(s).`);
process.exit(echecs === 0 ? 0 : 1);
