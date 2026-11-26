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
//  f. à chaque lancement, la console de la page sans erreur ; aucun temporaire laissé d'aucun côté.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from './lib/cdp.mjs';
import { traceDroite } from './lib/traces.mjs';

const [exe, portArg, appArg] = process.argv.slice(2);
if (!exe) {
  console.error('Usage : node exe-synchroniser.mjs <Tracker.exe> [<port>] [<dossier de la coquille>]');
  process.exit(1);
}
const PORT = Number(portArg ?? 9498);
const ORIGINE = 'https://tracker.localhost'; // `bureau/origine.ts`
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const vivant = (pid) => spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8', windowsHide: true }).stdout.includes(` ${pid} `);
const disparu = async (pid, ms) => { for (let t = 0; t < ms; t += 200) { if (!vivant(pid)) return true; await pause(200); } return !vivant(pid); };

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
  for (let k = 0; k < 100 && !ws; k++) {
    await pause(300);
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
  await pause(500);
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
/** Attend que le panneau montre la confirmation (« Annuler ») ou le compte rendu (« Fermer »), puis le relève. */
async function attendre(b, quoi) {
  await b.waitFor(`[...document.querySelectorAll('${PANNEAU} .phone-sync__actions button')].some((x) => ['Annuler', 'Fermer'].includes(x.textContent.trim()))`, { timeout: 60000, label: quoi });
  await b.wait(300);
  const r = await releve(b);
  montrer(quoi, r);
  return r;
}
/** Clique « Synchroniser avec le téléphone » et attend la confirmation ou le compte rendu. */
async function synchroniser(b, quoi) {
  check(`${quoi} : clic sur « Synchroniser avec le téléphone »`, (await b.click(BOUTON)) === 'ok');
  return attendre(b, `${quoi}, aperçu`);
}
const repondre = async (b, texte, quoi) => {
  check(`${quoi} : clic sur « ${texte} »`, (await b.clickText(texte, '.phone-sync__actions button')) === 'ok');
  return attendre(b, quoi);
};
const fermerPanneau = async (b) => { await b.clickText('Fermer', '.phone-sync__actions button'); await b.wait(300); };

// ---------- les sessions ----------
const gpxSynthetique = (jour) => traceDroite({ debutMs: Date.UTC(2026, 9, jour, 8, 0, 0), secondes: 300, vitesse: 4, type: 'wingfoil', nom: `Session ${jour}` });
/** Importe des GPX dans une mémoire par le programme lui-même : GPX et fiches vrais. */
async function preparer(memoire, jours, quoi) {
  const profil = dossier(`prep-${quoi}`);
  await avecProgramme(profil, memoire, {}, `préparation ${quoi}`, async (b) => {
    await b.go('/voile', 5000);
    for (const j of jours) check(`préparation ${quoi} : import de la session du ${j}`, (await b.importGpx(gpxSynthetique(j), `s${j}.gpx`)) === 'ok');
    await b.waitFor(() => gpxDe(memoire).length >= jours.length && fichesDe(memoire).length >= jours.length, { timeout: 20000, label: 'fiches' });
    await b.wait(2000);
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
    await b.wait(400);
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
    await b.wait(1500);
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
    await b.wait(1500);
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
      await b.wait(1500);
      check('e. la session du téléphone est entière sur l’ordinateur', gpxDe(M2).length === 1 && entieres(M2), arbre(join(M2, 'sessions')).join(' | '));
    });
  }
} catch (e) {
  check(`script interrompu : ${e.stack ?? e.message}`, false);
} finally {
  for (const pid of lances) if (vivant(pid)) spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
  await pause(800);
  rmSync(RACINE, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
}

console.log(echecs === 0 ? '\nTout passe.' : `\n${echecs} échec(s).`);
process.exit(echecs === 0 ? 0 : 1);
