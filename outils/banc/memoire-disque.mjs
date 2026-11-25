// Banc de test : la mémoire du programme Windows rangée dans un vrai dossier du disque.
// Usage : node memoire-disque.mjs <Tracker.exe> [<port de débogage>]
// Hors registre (`scripts.mjs`) : le script lance lui-même le programme plusieurs fois, en mode d'essai de la coquille
// (`TRACKER_BANC=1`), sur des dossiers temporaires du dossier temporaire du système : jamais le vrai Documents, jamais
// le profil du vrai programme, jamais un vrai OneDrive. Les GPX sont synthétiques (`lib/traces.mjs`). Le disque se lit
// par Node : c'est lui qui prouve où la mémoire est rangée. Sept cas :
//  a. profil vide : la carte propose un dossier (rien n'existe sur le disque), « Utiliser ce dossier », import d'un GPX ;
//     le disque porte le marqueur, le LISEZMOI, le fichier de réglages, le GPX et sa fiche, aucun temporaire, et le
//     profil retient le dossier ; un second lancement sur le même profil montre la même liste ;
//  b. programme fermé, dossier renommé : la carte dit « introuvable » et rien n'est recréé ; nom remis, « Réessayer » ;
//  c. une mémoire façon téléphone (un GPX sans fiche) désignée par « Choisir un autre dossier » : sa fiche est créée ;
//  d. un temporaire de remplacement et un temporaire d'écriture neuve laissés par un arrêt brutal : réparés ;
//  e. Documents sous OneDrive : le dossier proposé est hors de OneDrive, avec la phrase qui le dit ;
//  f. « Choisir un autre dossier » sur le sous-dossier `sessions` d'une mémoire : refusé, rien d'écrit ;
//  g. corbeille de 30 jours (élément 217, sous-lot 3a, d'après le lot 448 de Gtracker) : deux sessions importées, une
//     supprimée depuis sa ligne (bouton « Mettre à la corbeille (30 jours) », `corbeille/` sur le disque, index à une
//     entrée, GPX et fiche partis de `sessions/`), la ligne de Réglages › Mémoire et sa liste, « Restaurer » (session
//     revenue octet pour octet, corbeille vide) ; les deux de nouveau à la corbeille, l'une vieillie à 31 jours
//     programme fermé : relancé, elle et son sous-dossier disparaissent, l'autre et un dossier posé à la main restent ;
//     un itinéraire supprimé (« Mettre à la corbeille (30 jours) ») ; « Supprimer définitivement » et « Vider la
//     corbeille » confirmés dans la page, sans aucune fenêtre du navigateur.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from './lib/cdp.mjs';
import { traceDroite } from './lib/traces.mjs';

const [exe, portArg] = process.argv.slice(2);
if (!exe) {
  console.error('Usage : node memoire-disque.mjs <Tracker.exe> [<port>]');
  process.exit(1);
}
const PORT = Number(portArg ?? 9498);
const ORIGINE = 'https://tracker.localhost'; // `bureau/origine.ts`
/** Marqueur d'une mémoire Tracker (`library/folderLayout.ts`, `MARKER_FILE`). */
const FICHIER_MARQUEUR = 'tracker.json';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const vivant = (pid) => spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8', windowsHide: true }).stdout.includes(` ${pid} `);
const disparu = async (pid, ms) => { for (let t = 0; t < ms; t += 200) { if (!vivant(pid)) return true; await pause(200); } return !vivant(pid); };

let echecs = 0;
const check = (quoi, ok, detail) => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${quoi}${!ok && detail !== undefined ? ` (${detail})` : ''}`); if (!ok) echecs++; };

// Racine de tout ce que le script fabrique : un dossier court sous le dossier temporaire, effacé à la fin.
const RACINE = mkdtempSync(join(tmpdir(), 'trk-mem-'));
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
const lireCoquille = (profil) => { try { return JSON.parse(readFileSync(join(profil, 'coquille.json'), 'utf8').replace(/^﻿/, '')); } catch { return null; } };

const lances = new Set();
/** Une instance du programme ; `env` s'ajoute à l'environnement d'essai. Rend le processus, le journal et la page. */
async function lancer(profil, env = {}) {
  const complet = { ...process.env, TRACKER_BANC: '1', TRACKER_PROFIL: profil, TRACKER_BANC_MONTRER: 'transparente', ...env };
  for (const cle of Object.keys(complet)) if (cle.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete complet[cle];
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
/** Lance, joue `essai`, ferme toujours (même sur erreur). */
async function avecProgramme(profil, env, essai) {
  let p = null;
  try {
    p = await lancer(profil, env);
    return await essai(p.b, p);
  } catch (e) {
    check(`essai interrompu : ${e.message}`, false);
    return null;
  } finally {
    if (p) await fermer(p);
  }
}

const texte = (b) => b.evaluate('document.body.innerText');
/** Attend que la page contienne `motif` ; rend le texte de la page. */
const attendre = async (b, motif, quoi, timeout = 8000) => {
  await b.waitFor(`${motif}.test(document.body.innerText)`, { timeout, label: quoi });
  return texte(b);
};
/** Les boutons s'écrivent en capitales à l'écran (`text-transform`), que `innerText` rend : la casse ne compte pas. */
const contient = (t, s) => t.toLowerCase().includes(s.toLowerCase());
const ligne = (t, motif) => t.split('\n').find((l) => motif.test(l)) ?? '(absente)';
/** Texte de la bibliothèque de la voile : titres et listes, sans les mesures du moment. */
async function pageSessions(b) {
  await b.go('/voile', 5000);
  await b.waitFor(`/session/i.test(document.body.innerText)`, { timeout: 5000 });
  await b.settle({ max: 2000 });
  return texte(b);
}
/** Rangées de la bibliothèque ouverte. */
const rangees = (b) => b.evaluate(`document.querySelectorAll('.lib-row__main').length`);
const gpxSynthetique = (jour, nom) => traceDroite({ debutMs: Date.UTC(2026, 9, jour, 7, 0, 0), secondes: 300, vitesse: 4, type: 'wingfoil', nom });
const fiches = (memoire) => readdirSync(join(memoire, 'sessions')).filter((n) => n.endsWith('.json'));
const gpxs = (memoire) => readdirSync(join(memoire, 'sessions')).filter((n) => n.endsWith('.gpx'));

try {
  // ---------- a. profil vide ----------
  console.log('\n== a. Profil vide : proposition, « Utiliser ce dossier », import, second lancement');
  const A = { profil: dossier('a-profil'), documents: dossier('a-documents') };
  const propose = join(A.documents, 'Tracker');
  let sessionsLancement1 = '';
  await avecProgramme(A.profil, { TRACKER_DOCUMENTS: A.documents }, async (b) => {
    await b.go('/profil', 5000);
    const t = await attendre(b, /Dossier proposé/, 'carte');
    check('la carte dit « Aucun dossier mémoire choisi. »', t.includes('Aucun dossier mémoire choisi.'), ligne(t, /mémoire/i));
    check('la carte propose « Dossier proposé : <Documents>\\Tracker »', t.includes(`Dossier proposé : ${propose}`), ligne(t, /proposé/));
    check('« Utiliser ce dossier » et « Choisir un autre dossier » sont offerts', contient(t, 'Utiliser ce dossier') && contient(t, 'Choisir un autre dossier'));
    check('rien n\'existe sur le disque avant le clic (ni dossier proposé, ni coquille.json)', !existsSync(propose) && lireCoquille(A.profil) === null,
      `${existsSync(propose)} ${JSON.stringify(lireCoquille(A.profil))}`);
    check('Documents reste vide', (arbre(A.documents) ?? []).length === 0, JSON.stringify(arbre(A.documents)));

    check('clic « Utiliser ce dossier »', (await b.clickText('Utiliser ce dossier')) === 'ok');
    await b.waitFor(() => existsSync(join(propose, FICHIER_MARQUEUR)), { timeout: 8000, label: 'marqueur' });
    await b.settle({ max: 3000 });
    const apres = await texte(b);
    check('la carte ne propose plus de dossier', !apres.includes('Dossier proposé'), ligne(apres, /proposé/));

    await b.go('/voile', 5000);
    check('import du GPX synthétique', (await b.importGpx(gpxSynthetique(1, 'Disque un'), 'disque-un.gpx')) === 'ok');
    await b.waitFor(() => existsSync(join(propose, 'sessions')) && fiches(propose).length >= 1 && gpxs(propose).length >= 1, { timeout: 8000, label: 'fiche sur le disque' });
    await b.wait(1500); // réécriture différée de la fiche
    await b.settle({ max: 2000 });
    sessionsLancement1 = await pageSessions(b);
  });
  const arbreA = arbre(propose) ?? [];
  console.log(`disque (${propose}) :\n  ${arbreA.join('\n  ')}`);
  check('le dossier proposé existe maintenant', existsSync(propose));
  check(`${FICHIER_MARQUEUR} à la racine`, arbreA.includes(FICHIER_MARQUEUR));
  check('LISEZMOI.txt à la racine', arbreA.includes('LISEZMOI.txt'));
  check('un fichier de réglages dans reglages/ (reglages/*.json)', arbreA.some((c) => /^reglages\/[^/]+\.json$/.test(c)), arbreA.filter((c) => c.startsWith('reglages')).join(','));
  // Le nom d'appareil par défaut hors du téléphone est « PC » : fichier `reglages/pc.json` (`deviceFileName`).
  check('reglages/pc.json (nom d\'appareil du programme)', arbreA.includes('reglages/pc.json'), arbreA.filter((c) => c.startsWith('reglages')).join(','));
  check('sessions/ : un GPX et sa fiche .json', arbreA.filter((c) => /^sessions\/[^/]+\.gpx$/.test(c)).length === 1 && arbreA.filter((c) => /^sessions\/[^/]+\.json$/.test(c)).length === 1);
  check('aucun fichier .tracker-tmp ni .tracker-new', temporaires(propose).length === 0, temporaires(propose).join(','));
  const coquille = lireCoquille(A.profil);
  check('coquille.json du profil porte le chemin du dossier', Boolean(coquille) && JSON.stringify(coquille).toLowerCase().includes(propose.toLowerCase().replace(/\\/g, '\\\\')), JSON.stringify(coquille));
  check('coquille.json n\'est pas dans le dossier mémoire', !arbreA.includes('coquille.json'));
  check('le profil ne porte aucun temporaire de coquille', temporaires(A.profil).length === 0);

  console.log('-- second lancement sur le même profil (sans variable de mémoire)');
  await avecProgramme(A.profil, { TRACKER_DOCUMENTS: A.documents }, async (b) => {
    await b.go('/profil', 5000);
    const t = await attendre(b, /session/, 'mémoire prête');
    check('le Profil ne propose pas de dossier (déjà retenu)', !t.includes('Dossier proposé') && !t.includes('Aucun dossier mémoire choisi.'));
    const s2 = await pageSessions(b);
    check('même texte de la bibliothèque qu\'au premier lancement', s2 === sessionsLancement1, `\n--- 1 ---\n${sessionsLancement1}\n--- 2 ---\n${s2}`);
    check('la liste porte la session importée (une rangée, pas « Aucune session »)', !/Aucune session/.test(s2) && (await rangees(b)) === 1, s2);
  });

  // ---------- b. dossier renommé ----------
  console.log('\n== b. Dossier renommé, programme fermé');
  const renomme = join(A.documents, 'Tracker-renomme');
  renameSync(propose, renomme);
  await avecProgramme(A.profil, { TRACKER_DOCUMENTS: A.documents }, async (b) => {
    await b.go('/profil', 5000);
    const t = await attendre(b, /introuvable/, 'carte introuvable');
    check('la carte dit que le dossier est introuvable, avec son chemin', t.includes(`Le dossier ${propose} est introuvable`), ligne(t, /introuvable/));
    check('« Rien n\'est recréé à sa place. » est dit', t.includes("Rien n'est recréé à sa place."));
    check('« Réessayer » et « Choisir un autre dossier » sont offerts', contient(t, 'Réessayer') && contient(t, 'Choisir un autre dossier'));
    await b.wait(1500);
    check('rien n\'est recréé : le dossier d\'origine n\'existe toujours pas', !existsSync(propose), (arbre(A.documents) ?? []).join(','));
    const racineDocuments = (arbre(A.documents) ?? []).filter((c) => !/\/./.test(c));
    check('Documents ne porte que le dossier renommé', JSON.stringify(racineDocuments) === JSON.stringify(['Tracker-renomme/']), JSON.stringify(racineDocuments));
    // « Réessayer » sans que le nom soit remis : toujours introuvable, toujours rien de recréé.
    await b.clickText('Réessayer');
    await b.wait(1500);
    check('« Réessayer » nom absent : toujours introuvable et rien recréé', /introuvable/.test(await texte(b)) && !existsSync(propose));
    renameSync(renomme, propose);
    check('nom remis, clic « Réessayer »', (await b.clickText('Réessayer')) === 'ok');
    await b.waitFor(`!/introuvable/.test(document.body.innerText)`, { timeout: 10000, label: 'dossier retrouvé' });
    const t2 = await texte(b);
    check('la carte ne dit plus « introuvable »', !/introuvable/.test(t2), ligne(t2, /introuvable/));
    const s = await pageSessions(b);
    check('la session revient dans la liste', !/Aucune session/.test(s) && (await rangees(b)) === 1, s);
    check('la liste est identique à celle du premier lancement', s === sessionsLancement1);
  });

  // ---------- c. mémoire façon téléphone ----------
  console.log('\n== c. Mémoire façon téléphone désignée par « Choisir un autre dossier »');
  const C = { profil: dossier('c-profil'), documents: dossier('c-documents'), telephone: dossier('c-telephone') };
  mkdirSync(join(C.telephone, 'sessions'), { recursive: true });
  cpSync(join(propose, FICHIER_MARQUEUR), join(C.telephone, FICHIER_MARQUEUR));
  writeFileSync(join(C.telephone, 'sessions', '2026-10-02_07-00-00_Telephone.gpx'), gpxSynthetique(2, 'Telephone'));
  check('préparation : un GPX sans fiche dans sessions/', fiches(C.telephone).length === 0 && gpxs(C.telephone).length === 1);
  await avecProgramme(C.profil, { TRACKER_DOCUMENTS: C.documents, TRACKER_BANC_DOSSIER: C.telephone }, async (b, p) => {
    await b.go('/profil', 5000);
    await attendre(b, /Dossier proposé/, 'carte');
    check('clic « Choisir un autre dossier »', (await b.clickText('Choisir un autre dossier')) === 'ok');
    await b.waitFor(() => fiches(C.telephone).length >= 1, { timeout: 10000, label: 'fiche créée' });
    await b.settle({ max: 3000 });
    const s = await pageSessions(b);
    check('la session sans fiche apparaît dans la liste', !/Aucune session/.test(s) && (await rangees(b)) === 1, s);
    check('sa fiche .json est créée sur le disque', fiches(C.telephone).length === 1, fiches(C.telephone).join(','));
    check('le GPX n\'a pas bougé', gpxs(C.telephone).length === 1);
    check('le journal de la coquille dit le choix', p.journal.some((l) => /choix du dossier/.test(l)), p.journal.join(' | '));
  });
  const coquilleC = lireCoquille(C.profil);
  check('coquille.json retient le dossier choisi', Boolean(coquilleC) && JSON.stringify(coquilleC).toLowerCase().includes(C.telephone.toLowerCase().replace(/\\/g, '\\\\')), JSON.stringify(coquilleC));
  check('aucun temporaire laissé', temporaires(C.telephone).length === 0, temporaires(C.telephone).join(','));
  console.log(`disque (${C.telephone}) :\n  ${(arbre(C.telephone) ?? []).join('\n  ')}`);

  // ---------- d. temporaires orphelins ----------
  console.log('\n== d. Temporaires orphelins laissés par un arrêt brutal');
  // Mémoire de A (programme fermé) : un temporaire de remplacement seul et un temporaire d'écriture neuve seul.
  const dossierSessions = join(propose, 'sessions');
  writeFileSync(join(dossierSessions, 'notes.txt.tracker-tmp'), 'contenu a reprendre');
  writeFileSync(join(dossierSessions, 'brouillon.txt.tracker-new'), 'contenu a ecarter');
  check('préparation : les deux temporaires sont déposés', temporaires(propose).length === 2, temporaires(propose).join(','));
  await avecProgramme(A.profil, { TRACKER_DOCUMENTS: A.documents }, async (b) => {
    await b.go('/profil', 5000);
    await attendre(b, /session/, 'mémoire prête');
    await b.settle({ max: 2000 });
    console.log(`après l'ouverture : ${(arbre(propose) ?? []).filter((c) => /notes|brouillon/.test(c)).join(', ') || '(ni l\'un ni l\'autre)'}`);
    await b.go('/parametres', 5000);
    await b.waitFor(`[...document.querySelectorAll('[role=button]')].some((x) => x.textContent.trim() === 'Mémoire')`, { timeout: 8000, label: 'carte Mémoire' });
    await b.click(`[...document.querySelectorAll('[role=button]')].find((x) => x.textContent.trim() === 'Mémoire')`);
    await b.waitFor(`[...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Mettre à jour')`, { timeout: 8000, label: 'Mettre à jour' });
    const reglages = await texte(b);
    check('Réglages › Mémoire montre le chemin complet du dossier (« Emplacement : … sur ce PC. »)', reglages.includes(`Emplacement : ${propose}, sur ce PC.`), ligne(reglages, /Emplacement/));
    // Deux autres temporaires déposés programme ouvert : c'est « Mettre à jour » qui relit le dossier et les répare.
    writeFileSync(join(dossierSessions, 'notes-bis.txt.tracker-tmp'), 'seconde reprise');
    writeFileSync(join(dossierSessions, 'brouillon-bis.txt.tracker-new'), 'seconde ecriture');
    check('clic « Mettre à jour » (Réglages)', (await b.clickText('Mettre à jour')) === 'ok');
    await b.waitFor(() => !temporaires(propose).length, { timeout: 8000, label: 'temporaires réparés' });
    await b.wait(1000);
    await b.settle({ max: 3000 });
    const bis = arbre(propose) ?? [];
    check('« Mettre à jour » : le temporaire de remplacement déposé programme ouvert a repris son nom', bis.includes('sessions/notes-bis.txt') && readFileSync(join(dossierSessions, 'notes-bis.txt'), 'utf8') === 'seconde reprise', bis.filter((c) => /bis/.test(c)).join(','));
    check('« Mettre à jour » : le temporaire d\'écriture neuve déposé programme ouvert a disparu', !bis.some((c) => /brouillon-bis/.test(c)), bis.filter((c) => /brouillon-bis/.test(c)).join(','));
  });
  const apresD = arbre(propose) ?? [];
  check('le temporaire de remplacement seul a repris son nom (notes.txt)', apresD.includes('sessions/notes.txt') && !apresD.includes('sessions/notes.txt.tracker-tmp'), apresD.filter((c) => /notes/.test(c)).join(','));
  check('son contenu est intact', existsSync(join(dossierSessions, 'notes.txt')) && readFileSync(join(dossierSessions, 'notes.txt'), 'utf8') === 'contenu a reprendre');
  check('le temporaire d\'écriture neuve a disparu (sans brouillon.txt)', !apresD.some((c) => /brouillon/.test(c)), apresD.filter((c) => /brouillon/.test(c)).join(','));
  check('plus aucun .tracker-tmp ni .tracker-new', temporaires(propose).length === 0, temporaires(propose).join(','));
  check('la session et sa fiche sont intactes', gpxs(propose).length === 1 && fiches(propose).length === 1);

  // ---------- e. OneDrive ----------
  console.log('\n== e. Documents dans OneDrive : dossier proposé hors de lui, avec sa phrase');
  // `maison` du mode d'essai est le parent de Documents : OneDrive désigne donc Documents lui-même, et le dossier
  // proposé (`<parent>\Tracker`) est à côté, hors de OneDrive.
  const E = { profil: dossier('e-profil'), parent: dossier('e-maison') };
  const documentsE = join(E.parent, 'Documents');
  mkdirSync(documentsE, { recursive: true });
  await avecProgramme(E.profil, { TRACKER_DOCUMENTS: documentsE, OneDrive: documentsE }, async (b) => {
    await b.go('/profil', 5000);
    const t = await attendre(b, /Dossier proposé/, 'carte');
    const attendu = join(E.parent, 'Tracker');
    check('le dossier proposé est hors de OneDrive (à côté de Documents)', t.includes(`Dossier proposé : ${attendu}`), ligne(t, /proposé/));
    check('la phrase qui dit pourquoi s\'affiche', t.includes("Vos Documents sont dans OneDrive, qui peut gêner l'enregistrement des fichiers : le dossier proposé est hors de OneDrive."), ligne(t, /OneDrive/));
    check('pas d\'avertissement « Ce dossier est dans OneDrive » sous un dossier proposé hors de lui', !t.includes('Ce dossier est dans OneDrive'));
    check('rien n\'est créé avant le clic', !existsSync(attendu) && lireCoquille(E.profil) === null);
  });

  // ---------- f. sous-dossier d'une mémoire ----------
  console.log('\n== f. « Choisir un autre dossier » sur le dossier sessions d\'une mémoire');
  const F = { profil: dossier('f-profil'), documents: dossier('f-documents') };
  const avantF = empreinte(propose);
  await avecProgramme(F.profil, { TRACKER_DOCUMENTS: F.documents, TRACKER_BANC_DOSSIER: join(propose, 'sessions') }, async (b) => {
    await b.go('/profil', 5000);
    await attendre(b, /Dossier proposé/, 'carte');
    check('clic « Choisir un autre dossier »', (await b.clickText('Choisir un autre dossier')) === 'ok');
    const t = await attendre(b, /est un dossier de la mémoire Tracker/, 'refus');
    check('refus dit en clair (« est un dossier de la mémoire Tracker, pas la mémoire elle-même »)', /« sessions » est un dossier de la mémoire Tracker, pas la mémoire elle-même/.test(t), ligne(t, /dossier de la mémoire/));
    await b.wait(1000);
    check('la carte propose toujours un dossier (rien d\'adopté)', (await texte(b)).includes('Dossier proposé'));
  });
  check('rien n\'est écrit dans la mémoire désignée (arbre, tailles et heures inchangés)', empreinte(propose) === avantF);
  check('rien n\'est écrit dans le profil (pas de coquille.json)', lireCoquille(F.profil) === null);
  check('rien n\'est créé dans Documents', (arbre(F.documents) ?? []).length === 0, JSON.stringify(arbre(F.documents)));

  // ---------- g. corbeille de 30 jours ----------
  console.log('\n== g. Corbeille de 30 jours : mise à la corbeille, restauration, vieillissement, itinéraire, suppression définitive, vidage');
  const G = { profil: dossier('g-profil'), documents: dossier('g-documents') };
  const memG = join(G.documents, 'Tracker');
  const corbeille = join(memG, 'corbeille');
  const JOUR_MS = 86_400_000;
  const STARTS = [Date.UTC(2026, 9, 3, 7, 0, 0), Date.UTC(2026, 9, 4, 7, 0, 0)];
  const sansBom = (s) => s.replace(/^﻿/, '');
  const indexG = () => { try { return JSON.parse(sansBom(readFileSync(join(corbeille, 'corbeille.json'), 'utf8'))); } catch { return null; } };
  const sousDossiers = () => (existsSync(corbeille) ? readdirSync(corbeille, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);
  /** Ligne « Corbeille : … » de Réglages › Mémoire (`TrashZone`), `null` si elle n'est pas montrée. */
  const ligneCorbeille = (b) => b.evaluate(`document.querySelector('.trash-zone__toggle')?.textContent.trim() ?? null`);
  /**
   * Réglages › Mémoire dépliée. Repliée, la carte garde sa ligne d'état et « Mettre à jour » : c'est la ligne
   * « Emplacement : …, sur ce PC. », montrée carte ouverte seulement, qui dit qu'elle l'est (la carte garde son état
   * d'une page à l'autre : on ne la referme pas).
   */
  const ouvrirMemoire = async (b) => {
    await b.go('/parametres', 5000);
    await b.waitFor(`[...document.querySelectorAll('[role=button]')].some((x) => x.textContent.trim() === 'Mémoire')`, { timeout: 8000, label: 'carte Mémoire' });
    const ouverte = `/Emplacement : .*, sur ce PC\\./.test(document.body.innerText)`;
    if (!(await b.evaluate(ouverte))) {
      await b.click(`[...document.querySelectorAll('[role=button]')].find((x) => x.textContent.trim() === 'Mémoire')`);
    }
    await b.waitFor(ouverte, { timeout: 8000, label: 'carte Mémoire dépliée' });
    await b.settle({ max: 1500 });
  };
  /** Déplie la ligne « Corbeille : … » (si elle est repliée) et rend les lignes de la liste (texte de chacune). */
  const deplierCorbeille = async (b) => {
    await b.evaluate(`(() => { const t = document.querySelector('.trash-zone__toggle'); if (t && t.getAttribute('aria-expanded') !== 'true') t.click(); })()`);
    await b.wait(300);
    return b.evaluate(`[...document.querySelectorAll('li.trash-zone__row')].map((li) => li.innerText.replace(/\\n+/g, ' / '))`);
  };
  /** Clique, dans la ligne de la corbeille qui contient `contenu`, le bouton de texte `texte`. */
  const cliquerDansLigne = (b, contenu, texte) => b.evaluate(`(() => {
    const li = [...document.querySelectorAll('li.trash-zone__row')].find((x) => x.textContent.includes(${JSON.stringify(contenu)}));
    if (!li) return 'ligne absente';
    const x = [...li.querySelectorAll('button')].find((y) => y.textContent.trim() === ${JSON.stringify(texte)});
    if (!x) return 'bouton absent'; if (x.disabled) return 'désactivé'; x.click(); return 'ok';
  })()`);
  /** Supprime la première ligne de la bibliothèque de la voile ; rend les boutons de confirmation relevés sous la ligne. */
  const supprimerPremiereLigne = async (b, quoi) => {
    await pageSessions(b);
    const r = await b.evaluate(`(() => {
      const li = document.querySelector('.lib-row'); if (!li) return 'ligne absente';
      const x = [...li.querySelectorAll('button')].find((y) => y.textContent.trim() === 'Supprimer');
      if (!x) return 'bouton absent'; x.click(); return 'ok';
    })()`);
    check(`${quoi} : « Supprimer » de la ligne`, r === 'ok', r);
    await b.waitFor(`[...document.querySelectorAll('.lib-row button')].some((x) => x.textContent.trim() === 'Annuler')`, { timeout: 4000, label: 'confirmation' });
    const boutons = await b.evaluate(`[...document.querySelectorAll('.lib-row button')].map((x) => x.textContent.trim()).filter((s) => /corbeille|Confirmer|Annuler/.test(s))`);
    console.log(`  confirmation (${quoi}) : ${JSON.stringify(boutons)}`);
    check(`${quoi} : le bouton de confirmation dit « Mettre à la corbeille (30 jours) », plus « Confirmer »`,
      boutons.includes('Mettre à la corbeille (30 jours)') && !boutons.includes('Confirmer'), JSON.stringify(boutons));
    check(`${quoi} : clic « Mettre à la corbeille (30 jours) »`, (await b.clickText('Mettre à la corbeille (30 jours)')) === 'ok');
  };
  /** Fenêtres du navigateur (`confirm`, `alert`) ouvertes par la page : il n'en faut aucune. */
  const fenetresG = [];
  const gpxBytes = (nom) => readFileSync(join(memG, 'sessions', nom));

  // Premier lancement : mémoire adoptée, deux sessions importées, une mise à la corbeille, restaurée, puis les deux mises à la corbeille.
  let premierNom = '';
  let octetsPremier = null;
  await avecProgramme(G.profil, { TRACKER_DOCUMENTS: G.documents }, async (b) => {
    b.onMessage((m) => { if (m.method === 'Page.javascriptDialogOpening') fenetresG.push(m.params.message); });
    await b.go('/profil', 5000);
    await attendre(b, /Dossier proposé/, 'carte');
    check('clic « Utiliser ce dossier »', (await b.clickText('Utiliser ce dossier')) === 'ok');
    await b.waitFor(() => existsSync(join(memG, FICHIER_MARQUEUR)), { timeout: 8000, label: 'marqueur' });
    await b.settle({ max: 3000 });
    await b.go('/voile', 5000);
    check('import du premier GPX', (await b.importGpx(gpxSynthetique(3, 'Corbeille un'), 'corbeille-un.gpx')) === 'ok');
    await b.waitFor(() => existsSync(join(memG, 'sessions')) && fiches(memG).length >= 1 && gpxs(memG).length >= 1, { timeout: 8000, label: 'première fiche' });
    await b.wait(1500);
    check('import du second GPX', (await b.importGpx(gpxSynthetique(4, 'Corbeille deux'), 'corbeille-deux.gpx')) === 'ok');
    await b.waitFor(() => fiches(memG).length >= 2 && gpxs(memG).length >= 2, { timeout: 8000, label: 'seconde fiche' });
    await b.wait(1500);
    await b.settle({ max: 2000 });
    check('avant toute suppression : deux GPX, deux fiches, aucun dossier corbeille/ sur le disque', gpxs(memG).length === 2 && fiches(memG).length === 2 && !existsSync(corbeille), JSON.stringify(arbre(memG)));
    await ouvrirMemoire(b);
    check('Réglages › Mémoire : pas de ligne « Corbeille » tant qu\'elle est vide', (await ligneCorbeille(b)) === null, String(await ligneCorbeille(b)));

    // -- Première suppression, depuis la ligne.
    const avantGpx = gpxs(memG);
    const avantFiches = fiches(memG);
    await supprimerPremiereLigne(b, 'g1');
    await b.waitFor(() => gpxs(memG).length === 1 && Boolean(indexG()?.entries?.length), { timeout: 10000, label: 'session mise à la corbeille' });
    await b.wait(800);
    const retiree = avantGpx.find((n) => !gpxs(memG).includes(n));
    premierNom = retiree ?? '';
    const ficheRetiree = avantFiches.find((n) => !fiches(memG).includes(n));
    console.log(`disque (${corbeille}) :\n  ${(arbre(corbeille) ?? []).join('\n  ')}`);
    const idx1 = indexG();
    const e1 = idx1?.entries?.[0];
    const dossiers1 = sousDossiers();
    check('g1 : le GPX a quitté sessions/ (un seul reste)', Boolean(retiree) && !gpxs(memG).includes(retiree), `${retiree} ${gpxs(memG).join(',')}`);
    check('g1 : sa fiche a quitté sessions/ aussi', Boolean(ficheRetiree) && !fiches(memG).includes(ficheRetiree), `${ficheRetiree} ${fiches(memG).join(',')}`);
    check('g1 : corbeille/ porte un seul sous-dossier « <13 chiffres>-… »', dossiers1.length === 1 && /^\d{13}-/.test(dossiers1[0]), dossiers1.join(','));
    check('g1 : l\'index corbeille.json a une seule entrée (format tracker-corbeille, version 1)', Boolean(idx1) && idx1.entries.length === 1 && idx1.format === 'tracker-corbeille' && idx1.version === 1, JSON.stringify(idx1));
    check('g1 : l\'entrée est une session de l\'ordinateur, supprimée à l\'instant', e1?.kind === 'session' && e1?.origin === 'ordinateur' && e1?.reason === 'supprimee' && Math.abs(Date.now() - e1.deletedAtMs) < 120000, JSON.stringify(e1));
    check('g1 : l\'entrée dit le sous-dossier, le GPX principal et l\'instant de départ de la session', e1?.dir === dossiers1[0] && e1?.main === retiree && STARTS.includes(e1?.startMs) && dossiers1[0].endsWith(`-${e1?.startMs}`), JSON.stringify(e1));
    check('g1 : l\'entrée porte le nom de la session (son activité), pas celui de son fichier, même importée sans activité', typeof e1?.name === 'string' && e1.name.length > 0 && !/\.gpx$/i.test(e1.name) && !e1.name.includes(retiree.replace(/\.gpx$/i, '')), JSON.stringify(e1?.name));
    const dedans = existsSync(join(corbeille, dossiers1[0] ?? '-')) ? readdirSync(join(corbeille, dossiers1[0])).sort() : [];
    check('g1 : le sous-dossier porte le GPX et la fiche sous leurs noms d\'origine', JSON.stringify(dedans) === JSON.stringify([ficheRetiree, retiree].sort()), dedans.join(','));
    check('g1 : l\'index dit les tailles des fichiers recopiés', (e1?.files ?? []).length === dedans.length && (e1?.files ?? []).every((f) => existsSync(join(corbeille, dossiers1[0], f.name)) && statSync(join(corbeille, dossiers1[0], f.name)).size === f.size), JSON.stringify(e1?.files));
    check('g1 : la session restée dans sessions/ est intacte (un GPX, une fiche)', gpxs(memG).length === 1 && fiches(memG).length === 1);
    await pageSessions(b);
    check('g1 : la bibliothèque ne montre plus qu\'une ligne', (await rangees(b)) === 1, String(await rangees(b)));
    octetsPremier = existsSync(join(corbeille, dossiers1[0], retiree)) ? readFileSync(join(corbeille, dossiers1[0], retiree)) : null;

    // -- Réglages › Mémoire : la ligne, dépliée, puis « Restaurer ».
    await ouvrirMemoire(b);
    const titre = await ligneCorbeille(b);
    console.log(`  ligne de Réglages › Mémoire : « ${titre} »`);
    check('Réglages › Mémoire : « Corbeille : 1 session, gardée 30 jours »', titre === 'Corbeille : 1 session, gardée 30 jours', String(titre));
    const liste = await deplierCorbeille(b);
    console.log(`  liste dépliée : ${JSON.stringify(liste)}`);
    check('la liste dépliée montre la session (nom, date, « session supprimée le … »), « Restaurer » et « Supprimer définitivement »',
      liste?.length === 1 && /session supprimée le/.test(liste[0]) && /restaurer/i.test(liste[0]) && /supprimer définitivement/i.test(liste[0]), JSON.stringify(liste));
    check('la liste dépliée montre le nom de la session, pas celui de son fichier', liste?.length === 1 && !liste[0].includes(retiree.replace(/\.gpx$/i, '')), JSON.stringify(liste));
    check('« Vider la corbeille » est offert', (await b.evaluate(`[...document.querySelectorAll('.trash-zone button')].some((x) => x.textContent.trim() === 'Vider la corbeille')`)) === true);
    check('clic « Restaurer »', (await b.clickText('Restaurer')) === 'ok');
    await b.waitFor(() => gpxs(memG).length === 2 && sousDossiers().length === 0 && indexG()?.entries?.length === 0, { timeout: 10000, label: 'session restaurée' });
    await b.wait(1000);
    const tout = await texte(b);
    console.log(`  après « Restaurer » : ${ligne(tout, /revenue dans la mémoire|Restauration impossible/)}`);
    check('« Restaurer » : la session revient sous son nom (GPX identique octet pour octet, fiche présente)', gpxs(memG).includes(premierNom) && fiches(memG).includes(ficheRetiree) && octetsPremier !== null && gpxBytes(premierNom).equals(octetsPremier), `${gpxs(memG).join(',')} ${fiches(memG).join(',')}`);
    check('« Restaurer » : corbeille vide sur le disque (index sans entrée, aucun sous-dossier)', indexG()?.entries?.length === 0 && sousDossiers().length === 0, `${JSON.stringify(indexG())} ${sousDossiers().join(',')}`);
    check('« Restaurer » : la phrase du compte rendu dit que la session est revenue', /est revenue dans la mémoire/.test(tout), ligne(tout, /revenue|impossible/));
    check('« Restaurer » : la ligne « Corbeille : … » a disparu', (await ligneCorbeille(b)) === null, String(await ligneCorbeille(b)));
    await pageSessions(b);
    check('« Restaurer » : la bibliothèque montre de nouveau deux lignes', (await rangees(b)) === 2, String(await rangees(b)));
    check('« Restaurer » : aucun temporaire sur le disque', temporaires(memG).length === 0, temporaires(memG).join(','));

    // -- Supprimer de nouveau les deux sessions : deux entrées.
    await supprimerPremiereLigne(b, 'g2a');
    await b.waitFor(() => gpxs(memG).length === 1 && indexG()?.entries?.length === 1, { timeout: 10000, label: 'première remise à la corbeille' });
    await b.wait(1100); // deux entrées de la même seconde garderaient le même instant : on les veut distinctes
    await supprimerPremiereLigne(b, 'g2b');
    await b.waitFor(() => gpxs(memG).length === 0 && indexG()?.entries?.length === 2, { timeout: 10000, label: 'seconde mise à la corbeille' });
    await b.wait(800);
    const dossiers2 = sousDossiers();
    check('g2 : deux sous-dossiers « <13 chiffres>-… », deux entrées, sessions/ sans GPX', dossiers2.length === 2 && dossiers2.every((d) => /^\d{13}-/.test(d)) && indexG().entries.length === 2 && gpxs(memG).length === 0, dossiers2.join(','));
    await ouvrirMemoire(b);
    const titre2 = await ligneCorbeille(b);
    console.log(`  ligne de Réglages › Mémoire : « ${titre2} »`);
    check('Réglages › Mémoire : « Corbeille : 2 sessions, gardées 30 jours »', titre2 === 'Corbeille : 2 sessions, gardées 30 jours', String(titre2));
    check('console de la page sans erreur (premier lancement)', b.logs.length === 0, b.logs.join(' | '));
  });
  const idxAvantVieillir = indexG();

  // Programme fermé : l'entrée la plus ancienne vieillit à 31 jours, un dossier à la main est posé dans corbeille/.
  const entreesTriees = [...(idxAvantVieillir?.entries ?? [])].sort((a, b) => a.deletedAtMs - b.deletedAtMs);
  const vieille = entreesTriees[0];
  const jeune = entreesTriees[1];
  check('préparation : deux entrées à vieillir ou garder', Boolean(vieille) && Boolean(jeune));
  if (vieille && jeune) {
    idxAvantVieillir.entries = idxAvantVieillir.entries.map((e) => (e.dir === vieille.dir ? { ...e, deletedAtMs: Date.now() - 31 * JOUR_MS } : e));
    writeFileSync(join(corbeille, 'corbeille.json'), `${JSON.stringify(idxAvantVieillir, null, 2)}\n`);
    mkdirSync(join(corbeille, '2024-vacances'), { recursive: true });
    writeFileSync(join(corbeille, '2024-vacances', 'photo.txt'), 'pose a la main');
    check('préparation : une entrée vieillie à 31 jours, un dossier « 2024-vacances » posé à la main', indexG().entries.find((e) => e.dir === vieille.dir).deletedAtMs < Date.now() - 30 * JOUR_MS && existsSync(join(corbeille, '2024-vacances', 'photo.txt')));
  }

  // Second lancement : la purge de l'ouverture ; puis un itinéraire, la suppression définitive d'une entrée, le vidage.
  await avecProgramme(G.profil, { TRACKER_DOCUMENTS: G.documents }, async (b) => {
    b.onMessage((m) => { if (m.method === 'Page.javascriptDialogOpening') fenetresG.push(m.params.message); });
    await b.go('/profil', 5000);
    await attendre(b, /session/, 'mémoire prête');
    await b.waitFor(() => indexG()?.entries?.length === 1, { timeout: 12000, label: 'purge à l\'ouverture' });
    await b.wait(800);
    const idx = indexG();
    check('relance : l\'entrée de 31 jours a disparu de l\'index', Boolean(vieille) && !idx.entries.some((e) => e.dir === vieille.dir), JSON.stringify(idx.entries.map((e) => e.dir)));
    check('relance : son sous-dossier a disparu du disque', Boolean(vieille) && !existsSync(join(corbeille, vieille.dir)), sousDossiers().join(','));
    check('relance : l\'entrée récente est restée, avec son sous-dossier et ses fichiers', Boolean(jeune) && idx.entries.length === 1 && idx.entries[0].dir === jeune.dir && existsSync(join(corbeille, jeune.dir, jeune.main)), sousDossiers().join(','));
    check('relance : le dossier posé à la main (« 2024-vacances ») est intact, fichier compris', existsSync(join(corbeille, '2024-vacances', 'photo.txt')) && readFileSync(join(corbeille, '2024-vacances', 'photo.txt'), 'utf8') === 'pose a la main', sousDossiers().join(','));
    await ouvrirMemoire(b);
    const titre3 = await ligneCorbeille(b);
    console.log(`  ligne de Réglages › Mémoire : « ${titre3} »`);
    check('Réglages › Mémoire : « Corbeille : 1 session, gardée 30 jours » après la purge', titre3 === 'Corbeille : 1 session, gardée 30 jours', String(titre3));

    // -- Un itinéraire supprimé passe par la corbeille.
    await b.go('/itineraires/liste', 5000);
    check('import d\'un itinéraire (« Importer un itinéraire »)', (await b.importGpx(gpxSynthetique(5, 'Parcours corbeille'), 'parcours-corbeille.gpx')) === 'ok');
    await b.waitFor(() => existsSync(join(memG, 'itineraires')) && readdirSync(join(memG, 'itineraires')).some((n) => n.endsWith('.json')) && readdirSync(join(memG, 'itineraires')).some((n) => n.endsWith('.gpx')), { timeout: 10000, label: 'itinéraire sur le disque' });
    await b.wait(800);
    const fichiersRoute = readdirSync(join(memG, 'itineraires')).sort();
    console.log(`  itineraires/ : ${fichiersRoute.join(', ')}`);
    await b.settle({ max: 1500 });
    const menu = await b.evaluate(`(() => { const m = [...document.querySelectorAll('button[aria-label]')].find((x) => x.getAttribute('aria-label').startsWith("Plus d'actions sur ")); if (!m) return 'menu absent'; m.click(); return 'ok'; })()`);
    check('« … » de la ligne de l\'itinéraire', menu === 'ok', menu);
    await b.wait(150);
    const sup = await b.evaluate(`(() => { const x = [...document.querySelectorAll('.ui-more__panel button')].find((y) => y.textContent.trim() === 'Supprimer'); if (!x) return 'absent'; x.click(); return 'ok'; })()`);
    check('« Supprimer » du menu de l\'itinéraire', sup === 'ok', sup);
    await b.waitFor(`[...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Garder')`, { timeout: 4000, label: 'confirmation' });
    const boutonsRoute = await b.evaluate(`JSON.stringify([...document.querySelectorAll('button.ui-btn--danger, button.ui-btn--ghost')].map((x) => x.textContent.trim()).filter((s) => /corbeille|définitivement|Garder/i.test(s)))`);
    console.log(`  boutons de confirmation : ${boutonsRoute}`);
    check('le bouton de confirmation dit « Mettre à la corbeille (30 jours) »', JSON.parse(boutonsRoute).includes('Mettre à la corbeille (30 jours)') && !JSON.parse(boutonsRoute).includes('Supprimer définitivement'), boutonsRoute);
    check('clic « Mettre à la corbeille (30 jours) »', (await b.clickText('Mettre à la corbeille (30 jours)')) === 'ok');
    await b.waitFor(() => readdirSync(join(memG, 'itineraires')).length === 0 && indexG()?.entries?.length === 2, { timeout: 10000, label: 'itinéraire à la corbeille' });
    await b.wait(800);
    const idxR = indexG();
    const eR = idxR.entries.find((e) => e.kind === 'itineraire');
    console.log(`disque (${corbeille}) :\n  ${(arbre(corbeille) ?? []).join('\n  ')}`);
    check('itinéraire : fiche et GPX ont quitté itineraires/', readdirSync(join(memG, 'itineraires')).length === 0, readdirSync(join(memG, 'itineraires')).join(','));
    check('itinéraire : une entrée « itineraire » de l\'ordinateur dans l\'index, avec sa base et sa création', Boolean(eR) && eR.origin === 'ordinateur' && eR.startMs === null && typeof eR.routeBase === 'string' && typeof eR.createdAt === 'string' && eR.main.endsWith('.json'), JSON.stringify(eR));
    check('itinéraire : son sous-dossier « <13 chiffres>-<base> » porte sa fiche et son GPX', Boolean(eR) && /^\d{13}-/.test(eR.dir) && JSON.stringify(readdirSync(join(corbeille, eR.dir)).sort()) === JSON.stringify(fichiersRoute), eR ? readdirSync(join(corbeille, eR.dir)).join(',') : '');
    await ouvrirMemoire(b);
    const titre4 = await ligneCorbeille(b);
    console.log(`  ligne de Réglages › Mémoire : « ${titre4} »`);
    check('Réglages › Mémoire : « Corbeille : 1 session et 1 itinéraire, gardés 30 jours »', titre4 === 'Corbeille : 1 session et 1 itinéraire, gardés 30 jours', String(titre4));
    const liste4 = await deplierCorbeille(b);
    console.log(`  liste dépliée : ${JSON.stringify(liste4)}`);
    check('la liste porte la session et l\'itinéraire (« itinéraire supprimé le … »)', liste4?.length === 2 && liste4.some((l) => /itinéraire supprimé le/.test(l)) && liste4.some((l) => /session supprimée le/.test(l)), JSON.stringify(liste4));

    // -- « Supprimer définitivement » de l'itinéraire : confirmé dans la page.
    check('« Supprimer définitivement » de l\'itinéraire', (await cliquerDansLigne(b, 'itinéraire supprimé le', 'Supprimer définitivement')) === 'ok');
    await b.wait(300);
    const confirmation = await b.evaluate(`[...document.querySelectorAll('li.trash-zone__row')].find((x) => x.textContent.includes('itinéraire supprimé le'))?.innerText.replace(/\\n+/g, ' / ') ?? null`);
    console.log(`  ligne en attente de confirmation : ${JSON.stringify(confirmation)}`);
    check('la ligne demande confirmation (« Supprimer définitivement » et « Garder »), rien n\'est encore effacé', /Garder/i.test(confirmation ?? '') && indexG().entries.length === 2, JSON.stringify(confirmation));
    check('confirmation « Supprimer définitivement »', (await cliquerDansLigne(b, 'itinéraire supprimé le', 'Supprimer définitivement')) === 'ok');
    await b.waitFor(() => indexG()?.entries?.length === 1, { timeout: 10000, label: 'itinéraire supprimé définitivement' });
    await b.wait(800);
    check('l\'entrée de l\'itinéraire et son sous-dossier ont disparu, la session reste', !existsSync(join(corbeille, eR.dir)) && indexG().entries.length === 1 && indexG().entries[0].kind === 'session', JSON.stringify(indexG().entries.map((e) => e.kind)));

    // -- « Vider la corbeille » : confirmé dans la page.
    await deplierCorbeille(b);
    check('« Vider la corbeille »', (await b.clickText('Vider la corbeille')) === 'ok');
    await b.wait(300);
    const question = await b.evaluate(`document.querySelector('.trash-zone__confirm')?.innerText.replace(/\\n+/g, ' / ') ?? null`);
    console.log(`  question : ${JSON.stringify(question)}`);
    check('la question dans la page dit « Vider la corbeille ? … sans retour possible », rien n\'est encore effacé', /Vider la corbeille \?/.test(question ?? '') && /sans retour possible/.test(question ?? '') && indexG().entries.length === 1, JSON.stringify(question));
    check('confirmation « Vider la corbeille »', (await b.clickText('Vider la corbeille', '.trash-zone__confirm button')) === 'ok');
    await b.waitFor(() => indexG()?.entries?.length === 0, { timeout: 10000, label: 'corbeille vidée' });
    await b.wait(800);
    check('« Vider la corbeille » : l\'index est vide, plus aucun sous-dossier d\'entrée', indexG().entries.length === 0 && sousDossiers().every((d) => !/^\d{13}-/.test(d)), `${sousDossiers().join(',')}`);
    check('« Vider la corbeille » : le dossier posé à la main reste, fichier compris', existsSync(join(corbeille, '2024-vacances', 'photo.txt')), sousDossiers().join(','));
    const apres = await texte(b);
    check('« Vider la corbeille » : la ligne « Corbeille : … » a disparu et « Corbeille vidée. » est dit', (await ligneCorbeille(b)) === null && /Corbeille vidée\./.test(apres), ligne(apres, /orbeille/));
    console.log(`disque final (${corbeille}) :\n  ${(arbre(corbeille) ?? []).join('\n  ')}`);
    check('console de la page sans erreur (second lancement)', b.logs.length === 0, b.logs.join(' | '));
  });
  check('aucune fenêtre du navigateur (confirm, alert) n\'a été ouverte', fenetresG.length === 0, JSON.stringify(fenetresG));
  check('aucun temporaire dans la mémoire en fin de cas', temporaires(memG).length === 0, temporaires(memG).join(','));
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
