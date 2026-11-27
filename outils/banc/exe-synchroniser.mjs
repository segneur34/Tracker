// Banc de test : « Synchroniser avec le téléphone » (Réglages › Mémoire du programme Windows), de bout en bout, face à
// un faux téléphone (un dossier local qui joue son `/sdcard`). Élément 217, sous-lot 3e.
// Usage : node exe-synchroniser.mjs <Tracker.exe> [<port de débogage>] [<dossier de la coquille>]
//   Le troisième argument sert à lancer une coquille compilée mais pas emballée : <Tracker.exe> est alors l'`electron.exe`
//   de `bureau/node_modules`, et l'application servie se donne par `TRACKER_DIST` (dossier `dist/`).
// Hors registre (`scripts.mjs`) : le script lance lui-même le programme, en mode d'essai de la coquille (`TRACKER_BANC=1`),
// sur des dossiers du dossier temporaire du système : jamais le vrai Documents, jamais le profil du vrai programme,
// jamais un vrai téléphone (en mode d'essai, sans racine d'essai, le vrai adb n'est jamais lancé ; le script retire de
// l'environnement toute variable du téléphone d'essai qu'il ne pose pas lui-même). Les GPX sont synthétiques, leurs
// fiches écrites par le programme lui-même (une préparation les importe) ; le disque se lit par Node : c'est lui qui prouve.
// Cas :
//  a. première synchronisation : le bouton, l'aperçu chiffré (« 2 à copier vers le téléphone, 3 vers l'ordinateur »)
//     qui n'écrit rien, « Annuler » qui ne fait rien, puis « Synchroniser sans rien supprimer » : copie de sécurité des
//     deux dossiers sous `Documents\Tracker-copies`, cinq sessions entières de chaque côté, « Synchronisation faite » ;
//  b. une session supprimée sur le téléphone : l'aperçu dit « 1 à retirer » ; « sans rien supprimer » ne retire rien
//     et le dit ;
//  c. une seconde suppression faite entre l'aperçu et le clic sur « retirer » : rien n'est retiré, « Synchronisation
//     incomplète », puis la confirmation des deux retraits : deux sessions dans la corbeille de l'ordinateur ;
//  d. listage du téléphone partiel en cours de route (`TRACKER_BANC_TELEPHONE_PANNE=listage`) : « Synchronisation
//     arrêtée », « Réessayer », qui termine la synchronisation coupée et le dit ;
//  e. copie de sécurité impossible (le dossier des copies est pris par un fichier) : « Synchronisation impossible »,
//     rien d'écrit d'aucun côté, puis « Réessayer » une fois la place libérée : la copie est faite, la session arrive ;
//  f. corbeilles jumelles (lot 242-1) : une session supprimée par l'application du téléphone (dans sa corbeille, son
//     index écrit par lui) arrive dans la corbeille de l'ordinateur ; l'index du téléphone n'est pas touché ;
//  g. une session supprimée sur l'ordinateur est déposée dans `Documents/Tracker/corbeille/<dépôt>/` du faux téléphone
//     (`depose.json`, GPX, fiche), plus rien dans `Documents/Tracker-corbeille` ;
//  h. « Restaurer » sur l'ordinateur, puis la synchronisation suivante : « Restauré », la session revient sur le
//     téléphone, sans question ;
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
const VARIABLES_TELEPHONE = ['TRACKER_BANC_TELEPHONE', 'TRACKER_BANC_TELEPHONE_ETAT', 'TRACKER_BANC_TELEPHONE_COUPURE', 'TRACKER_BANC_RACINE_TELEPHONE', 'TRACKER_BANC_TELEPHONE_ENREGISTREMENT', 'TRACKER_BANC_TELEPHONE_PANNE'];
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
const PANNEAU = '.phone-sync__panel';
/** Ce que Réglages › Mémoire montre de la synchronisation : titre, phrases, lignes du compte rendu, boutons. */
const releve = (b) => b.evaluate(`(() => {
  const d = document.querySelector(${JSON.stringify(PANNEAU)});
  if (!d) return null;
  const texte = (x) => x.textContent.trim().replace(/\\s+/g, ' ');
  return {
    titre: [...d.querySelectorAll(':scope > p.phone-sync__headline')].map(texte)[0] ?? null,
    phrases: [...d.querySelectorAll(':scope > p.phone-sync__text')].map(texte),
    lignes: [...d.querySelectorAll(':scope > ul.phone-sync__list > li')].map((li) => { const c = li.cloneNode(true); c.querySelectorAll('details').forEach((x) => x.remove()); return texte(c); }),
    boutons: [...d.querySelectorAll('.phone-sync__actions button')].map(texte),
  };
})()`);
const montrer = (quoi, r) => {
  console.log(`  ${quoi} :`);
  for (const l of r?.phrases ?? []) console.log(`    | ${l}`);
  for (const l of r?.lignes ?? []) console.log(`    · ${l}`);
  console.log(`    boutons : ${(r?.boutons ?? []).join(' / ')}`);
};
/** Ouvre Réglages (la carte Mémoire porte le bouton). */
async function reglages(b) {
  await b.go('/parametres', 5000);
  await b.waitFor(`Boolean(document.querySelector(${JSON.stringify(BOUTON)}))`, { timeout: 10000, label: 'bouton Synchroniser' });
}
/**
 * Marque la rangée de boutons montrée avant un clic : `attendre` ne prend que celle d'après, jamais l'ancienne (un résultat
 * neuf, pas un texte « différent », qui peut rester le même). Entre deux, l'étape en cours n'a pas de rangée de boutons.
 */
const marquer = (b) => b.evaluate(`(() => { const r = document.querySelector('${PANNEAU} .phone-sync__actions'); if (r) r.dataset.bancAncien = '1'; return true; })()`);
/** Attend que le panneau montre une confirmation (« Annuler ») ou un compte rendu (« Fermer ») neufs, puis le relève. */
async function attendre(b, quoi) {
  await b.waitFor(`[...document.querySelectorAll('${PANNEAU} .phone-sync__actions:not([data-banc-ancien]) button')].some((x) => ['Annuler', 'Fermer'].includes(x.textContent.trim()))`, { timeout: 60000, label: quoi });
  await b.settle({ max: 300, label: `${quoi}, relevé` }); // le panneau fini de dessiner (l'ancienne attente fixe pour plafond)
  const r = await releve(b);
  montrer(quoi, r);
  return r;
}
/** Clique « Synchroniser avec le téléphone » et attend la confirmation ou le compte rendu. */
async function synchroniser(b, quoi) {
  await marquer(b);
  check(`${quoi} : clic sur « Synchroniser avec le téléphone »`, (await b.click(BOUTON)) === 'ok');
  return attendre(b, `${quoi}, aperçu`);
}
const repondre = async (b, texte, quoi) => {
  await marquer(b);
  check(`${quoi} : clic sur « ${texte} »`, (await b.clickText(texte, '.phone-sync__actions button')) === 'ok');
  return attendre(b, quoi);
};
const fermerPanneau = async (b) => {
  await b.clickText('Fermer', '.phone-sync__actions button');
  await b.waitFor(`!document.querySelector(${JSON.stringify(PANNEAU)})`, { timeout: 300, label: 'panneau refermé' });
};
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
  await preparer(MC, [4, 5], 'ordinateur');
  const MX = dossier('prep-sixieme-memoire');
  await preparer(MX, [6], 'sixième');
  const PC = dossier('ordinateur-profil');
  const tel = telephone('telephone', MP);
  const surTel = gpxDe(racineDe(tel));
  console.log(`téléphone factice : ${surTel.join(' ; ')}`);

  // ---------- a, b, c ----------
  console.log('\n== a, b, c. Première synchronisation, « sans rien supprimer », suppression apparue avant le clic');
  await avecProgramme(PC, MC, { TRACKER_BANC_TELEPHONE: tel }, 'a, b, c', async (b) => {
    await reglages(b);
    const libelle = await b.evaluate(`document.querySelector(${JSON.stringify(BOUTON)})?.textContent.trim() ?? null`);
    check('a. le bouton « Synchroniser avec le téléphone » est dans Réglages › Mémoire', libelle === 'Synchroniser avec le téléphone', libelle);
    check('a. « Récupérer les sessions du téléphone » n’existe plus', !(await b.evaluate(`document.body.textContent.includes('Récupérer les sessions du téléphone')`)));
    const telAvant = empreinte(tel);
    const pcAvant = empreinte(join(MC, 'sessions'));
    let r = await synchroniser(b, 'a');
    check('a. l’aperçu chiffre : « 2 à copier vers le téléphone, 3 vers l’ordinateur »', r?.titre === "2 à copier vers le téléphone, 3 vers l'ordinateur", r?.titre);
    check('a. la copie de sécurité est annoncée', (r?.phrases ?? []).includes("Une copie de sécurité des deux dossiers sera faite d'abord, dans Documents\\Tracker-copies."), JSON.stringify(r?.phrases));
    check('a. « Première synchronisation… rien ne sera supprimé » est dit', (r?.phrases ?? []).some((p) => p.startsWith('Première synchronisation avec ce téléphone : rien ne sera supprimé')), JSON.stringify(r?.phrases));
    check('a. boutons « Synchroniser sans rien supprimer » / « Annuler », pas de retrait', r?.boutons?.join('/') === 'Synchroniser sans rien supprimer/Annuler', r?.boutons?.join('/'));
    check('a. l’aperçu n’a rien écrit sur le téléphone', empreinte(tel) === telAvant);
    check('a. l’aperçu n’a rien écrit dans sessions/ de l’ordinateur, ni synchro/ ni copie', empreinte(join(MC, 'sessions')) === pcAvant && !existsSync(join(MC, 'synchro')) && !existsSync(join(PC, 'Documents-essai', 'Tracker-copies')));
    check('a. « Annuler »', (await b.clickText('Annuler', '.phone-sync__actions button')) === 'ok');
    await b.wait(400); // attente fixe voulue : le contrôle qui suit prouve aussi une absence (rien d'écrit sur le téléphone)
    check('a. « Annuler » referme sans rien faire', (await releve(b)) === null && empreinte(tel) === telAvant);

    r = await synchroniser(b, 'a, de nouveau');
    r = await repondre(b, 'Synchroniser sans rien supprimer', 'a. compte rendu');
    check('a. titre « Synchronisation faite »', r?.titre === 'Synchronisation faite', r?.titre);
    check('a. lignes « Copié vers l’ordinateur : 3 sessions » et « Copié vers le téléphone : 2 sessions »',
      (r?.lignes ?? []).includes('Copié vers l’ordinateur : 3 sessions') && (r?.lignes ?? []).includes('Copié vers le téléphone : 2 sessions'), JSON.stringify(r?.lignes));
    check('a. « Mettre à jour » sur le téléphone est rappelé', (r?.phrases ?? []).some((p) => p.startsWith('Sur le téléphone, touchez « Mettre à jour »')), JSON.stringify(r?.phrases));
    const copies = join(PC, 'Documents-essai', 'Tracker-copies');
    const copie = existsSync(copies) ? readdirSync(copies) : [];
    check('a. une copie de sécurité faite, avec ordinateur\\ et telephone\\', copie.length === 1 && existsSync(join(copies, copie[0], 'ordinateur', 'sessions')) && existsSync(join(copies, copie[0], 'telephone', 'sessions')), copie.join(','));
    if (copie.length === 1) {
      check('a. la copie du téléphone tient ses trois sessions d’avant', gpxDe(join(copies, copie[0], 'telephone')).length === 3, arbre(join(copies, copie[0])).join(' | '));
      check('a. la copie de l’ordinateur tient ses deux sessions d’avant', gpxDe(join(copies, copie[0], 'ordinateur')).length === 2);
    }
    await ecrituresFinies(b, [MC, tel], 1500, 'a. après la synchronisation');
    check('a. cinq sessions entières sur l’ordinateur', gpxDe(MC).length === 5 && entieres(MC), arbre(join(MC, 'sessions')).join(' | '));
    check('a. cinq sessions entières sur le téléphone', gpxDe(racineDe(tel)).length === 5 && entieres(racineDe(tel)), arbre(racineDe(tel)).join(' | '));
    check('a. aucun temporaire d’aucun côté', temporaires(MC).length + temporaires(tel).length === 0, [...temporaires(MC), ...temporaires(tel)].join(','));
    await fermerPanneau(b);

    // b
    supprimerSurTelephone(tel, surTel[0]);
    r = await synchroniser(b, 'b');
    check('b. l’aperçu dit « 1 à retirer »', r?.titre === '1 à retirer', r?.titre);
    check('b. « Synchroniser et retirer l’élément » est offert', (r?.boutons ?? []).includes("Synchroniser et retirer l'élément"), r?.boutons?.join('/'));
    r = await repondre(b, 'Synchroniser sans rien supprimer', 'b. compte rendu');
    check('b. « Synchronisation faite »', r?.titre === 'Synchronisation faite', r?.titre);
    check('b. « Rien n’a été supprimé : 1 session supprimée sur un appareil est encore sur l’autre » est dit',
      (r?.phrases ?? []).some((p) => p.startsWith("Rien n'a été supprimé : 1 session supprimée sur un appareil est encore sur l'autre.")), JSON.stringify(r?.phrases));
    check('b. rien n’est retiré de l’ordinateur (cinq sessions), corbeille vide', gpxDe(MC).length === 5 && corbeilleDe(MC).length === 0);
    await fermerPanneau(b);

    // c
    r = await synchroniser(b, 'c');
    check('c. l’aperçu dit « 1 à retirer »', r?.titre === '1 à retirer', r?.titre);
    supprimerSurTelephone(tel, surTel[1]);
    r = await repondre(b, "Synchroniser et retirer l'élément", 'c. compte rendu');
    check('c. « Synchronisation incomplète »', r?.titre === 'Synchronisation incomplète', r?.titre);
    check('c. « Rien n’a été supprimé : 2 sessions à retirer attendent votre accord. »', (r?.phrases ?? []).includes("Rien n'a été supprimé : 2 sessions à retirer attendent votre accord."), JSON.stringify(r?.phrases));
    check('c. rien n’est retiré de l’ordinateur', gpxDe(MC).length === 5 && corbeilleDe(MC).length === 0);
    await fermerPanneau(b);
    r = await synchroniser(b, 'c, de nouveau');
    check('c. l’aperçu dit « 2 à retirer »', r?.titre === '2 à retirer', r?.titre);
    r = await repondre(b, 'Synchroniser et retirer les 2 éléments', 'c. retraits confirmés');
    check('c. « Synchronisation faite »', r?.titre === 'Synchronisation faite', r?.titre);
    check('c. ligne « Mis à la corbeille : 2 sessions supprimées sur le téléphone… »', (r?.lignes ?? []).some((l) => l.startsWith('Mis à la corbeille : 2 sessions supprimées sur le téléphone')), JSON.stringify(r?.lignes));
    await ecrituresFinies(b, [MC, tel], 1500, 'c. après les retraits');
    check('c. trois sessions sur l’ordinateur, deux dans sa corbeille', gpxDe(MC).length === 3 && corbeilleDe(MC).filter((e) => e.kind === 'session').length === 2, `${gpxDe(MC).length} ; ${JSON.stringify(corbeilleDe(MC).map((e) => e.main))}`);
    await fermerPanneau(b);
  });

  // ---------- d ----------
  console.log('\n== d. Listage partiel du téléphone en cours de route, puis « Réessayer »');
  for (const n of readdirSync(join(MX, 'sessions'))) if (/\.(gpx|json)$/.test(n)) copyFileSync(join(MX, 'sessions', n), join(MC, 'sessions', n));
  await avecProgramme(PC, MC, { TRACKER_BANC_TELEPHONE: tel, TRACKER_BANC_TELEPHONE_PANNE: 'listage' }, 'd', async (b) => {
    await reglages(b);
    let r = await synchroniser(b, 'd');
    check('d. l’aperçu dit « 1 à copier vers le téléphone »', r?.titre === '1 à copier vers le téléphone', r?.titre);
    r = await repondre(b, 'Synchroniser sans rien supprimer', 'd. compte rendu');
    check('d. « Synchronisation arrêtée »', r?.titre === 'Synchronisation arrêtée', r?.titre);
    check('d. le listage incomplet est dit, et ce qui est fait est gardé', (r?.phrases ?? []).some((p) => /Listage du téléphone incomplet/.test(p) && /Ce qui est fait est gardé/.test(p)), JSON.stringify(r?.phrases));
    check('d. « Réessayer » offert', (r?.boutons ?? []).join('/') === 'Réessayer/Fermer', r?.boutons?.join('/'));
    check('d. le témoin de la synchronisation coupée est resté', existsSync(join(MC, 'synchro', 'en-cours.json')));
    r = await repondre(b, 'Réessayer', 'd. après « Réessayer »');
    if ((r?.boutons ?? []).includes('Synchroniser sans rien supprimer')) r = await repondre(b, 'Synchroniser sans rien supprimer', 'd. reprise');
    check('d. « Synchronisation faite » à la reprise', r?.titre === 'Synchronisation faite', r?.titre);
    check('d. la reprise dit avoir terminé la synchronisation coupée', (r?.phrases ?? []).includes("La synchronisation précédente s'était arrêtée en route : elle vient d'être terminée."), JSON.stringify(r?.phrases));
    check('d. le témoin est retiré', !existsSync(join(MC, 'synchro', 'en-cours.json')));
    check('d. la sixième session est entière sur le téléphone', gpxDe(racineDe(tel)).length === 4 && entieres(racineDe(tel)), arbre(racineDe(tel)).join(' | '));
    check('d. aucun temporaire d’aucun côté', temporaires(MC).length + temporaires(tel).length === 0);
  });

  // ---------- f, g, h ----------
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
    console.log(`supprimée sur le téléphone : ${Z} ; sur l'ordinateur : ${Y}`);
    await avecProgramme(PC, MC, { TRACKER_BANC_TELEPHONE: tel }, 'f, g, h', async (b) => {
      await reglages(b);
      let r = await synchroniser(b, 'f, g');
      check('f, g. l’aperçu dit « 2 à retirer »', r?.titre === '2 à retirer', r?.titre);
      r = await repondre(b, 'Synchroniser et retirer les 2 éléments', 'f, g. compte rendu');
      check('f, g. « Synchronisation faite »', r?.titre === 'Synchronisation faite', r?.titre);
      check('f. ligne « Mis à la corbeille : 1 session supprimée sur le téléphone… »', (r?.lignes ?? []).some((l) => l.startsWith('Mis à la corbeille : 1 session supprimée sur le téléphone')), JSON.stringify(r?.lignes));
      check('g. ligne « … retirée de la mémoire du téléphone, dans sa corbeille pour 30 jours »',
        (r?.lignes ?? []).includes("Mis de côté sur le téléphone : 1 session supprimée sur l'ordinateur : retirée de la mémoire du téléphone, dans sa corbeille pour 30 jours"), JSON.stringify(r?.lignes));
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
      await fermerPanneau(b);

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
      check('h. l’aperçu dit « 1 à copier vers le téléphone », rien à retirer', r?.titre === '1 à copier vers le téléphone', r?.titre);
      const bouton = (r?.boutons ?? []).find((x) => x !== 'Annuler');
      if (bouton) r = await repondre(b, bouton, 'h. compte rendu');
      check('h. « Synchronisation faite »', r?.titre === 'Synchronisation faite', r?.titre);
      check('h. ligne « Restauré : 1 session sortie de la corbeille… »', (r?.lignes ?? []).some((l) => l.startsWith('Restauré : 1 session')), JSON.stringify(r?.lignes));
      await ecrituresFinies(b, [MC, tel], 1500, 'h. après la synchronisation');
      check('h. la session revient sur le téléphone, entière', gpxDe(racineDe(tel)).includes(Y) && entieres(racineDe(tel)), arbre(join(racineDe(tel), 'sessions')).join(' | '));
      check('h. aucun temporaire d’aucun côté', temporaires(MC).length + temporaires(tel).length === 0);
      await fermerPanneau(b);
    });
  }

  // ---------- e ----------
  console.log('\n== e. Copie de sécurité impossible, puis « Réessayer »');
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
      check('e. l’aperçu dit « 1 à copier vers l’ordinateur »', r?.titre === "1 à copier vers l'ordinateur", r?.titre);
      r = await repondre(b, 'Synchroniser sans rien supprimer', 'e. compte rendu');
      check('e. « Synchronisation impossible »', r?.titre === 'Synchronisation impossible', r?.titre);
      check('e. « La copie de sécurité des deux dossiers n’a pas pu être faite : rien n’a été synchronisé. »', (r?.phrases ?? []).some((p) => p.startsWith("La copie de sécurité des deux dossiers n'a pas pu être faite : rien n'a été synchronisé.")), JSON.stringify(r?.phrases));
      check('e. « Réessayer » offert', (r?.boutons ?? []).join('/') === 'Réessayer/Fermer', r?.boutons?.join('/'));
      check('e. rien d’écrit : téléphone intact, aucune session ni synchro/ sur l’ordinateur', empreinte(tel2) === telAvant && gpxDe(M2).length === 0 && !existsSync(join(M2, 'synchro')));
      rmSync(join(documents, 'Tracker-copies'));
      r = await repondre(b, 'Réessayer', 'e. après « Réessayer »');
      if ((r?.boutons ?? []).includes('Synchroniser sans rien supprimer')) r = await repondre(b, 'Synchroniser sans rien supprimer', 'e. reprise');
      check('e. « Synchronisation faite »', r?.titre === 'Synchronisation faite', r?.titre);
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
