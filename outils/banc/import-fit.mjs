// Banc de test : import de fichiers FIT de montre (lot 35, partie A). À verdict.
// Usage : node import-fit.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Dure environ 40 s. Le script fabrique ses FIT (`src/test/fit.fixture.ts`, aucun vrai
// fichier), les importe par les vrais champs de fichier de la bibliothèque (`DOM.setFileInputFiles`), et vérifie :
//  1. une course de deux fois 10 min à 3 m/s, avec une pause de 1 min : session Course, 1 200 points, distance de
//     la vitesse et non celle du fichier, deux continus, GPX rangé seul, sans le .fit ; chiffres et FC à l'écran ;
//  2. le même FIT réimporté : « déjà présente », rien de plus ;
//  3. un faux FIT, un FIT de salle sans position : refusés, nommés, avec la raison ;
//  4. un FIT qui n'est pas une activité, seul : phrase claire, rien de rangé ;
//  5. un dossier de deux activités : question dessinée, « Annuler » n'importe rien, « Tout importer » range les deux.
import './charge-ts.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCKED_URLS, connect } from './lib/cdp.mjs';
import { ONGLETS } from './lib/onglets.mjs';

const { buildFitActivity } = await import('../../src/test/fit.fixture.ts');

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node import-fit.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}

const T0 = Date.UTC(2026, 9, 2, 8, 0, 0);
const SPEED_MS = 3;
const LAT_PER_M = 1 / 111_195;

/** Point à la seconde `s`, sur une ligne droite parcourue à vitesse fixe ; la distance du fichier est volontairement fausse. */
const point = (t0, s) => ({
  timeMs: t0 + s * 1000, lat: 43.7 + s * SPEED_MS * LAT_PER_M, lon: 3.8, altitudeM: 50, speedMs: SPEED_MS, hr: 150, cadence: 85, distanceM: 500_000 + s,
});
const run = (t0, seconds) => seconds.map((s) => point(t0, s));
const range = (from, n) => Array.from({ length: n }, (_, k) => from + k);

const write = (name, bytes) => {
  const path = join(workDir, name);
  writeFileSync(path, bytes);
  return path;
};

// Deux fois 600 points à 1 Hz, 1 min de pause entre les deux (599 s + 599 s à 3 m/s : 3 594 m).
const coursePath = write('course.fit', buildFitActivity({
  points: run(T0, [...range(0, 600), ...range(660, 600)]),
  sessionSports: [1],
  timer: [[T0, true], [T0 + 599_000, false], [T0 + 660_000, true]],
}));
const fauxPath = write('faux.fit', new TextEncoder().encode('<?xml version="1.0"?><gpx></gpx>'));
const sallePath = write('salle.fit', buildFitActivity({ points: range(0, 60).map((s) => ({ timeMs: T0 + 86_400_000 + s * 1000, hr: 120 })) }));
const reglagesPath = write('reglages.fit', buildFitActivity({ points: run(T0, range(0, 5)), fileType: 2 }));
const dossier = join(workDir, 'montre');
mkdirSync(dossier, { recursive: true });
for (const [name, day] of [['a.fit', 2], ['b.fit', 3]]) {
  writeFileSync(join(dossier, name), buildFitActivity({ points: run(T0 + day * 86_400_000, range(0, 300)), sessionSports: [1] }));
}

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, settle, waitFor, wait, blockNetwork, importFiles, records, shoot, clickText, check, finish, logs } = await connect({ port, width: 1400, height: 1000, shotDir });
const IMPORT_INPUT = 'input[type=file][accept*=".gpx"][multiple]:not([disabled])';
const FOLDER_INPUT = 'input[type=file][webkitdirectory]:not([disabled])';
const bodyText = () => evaluate('document.body.innerText');
const bodyHas = (text) => evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`);
const waitText = (text, label) => waitFor(() => bodyHas(text), { timeout: 8000, label });
/** Noms du dossier `sessions` de la mémoire du navigateur (OPFS). */
const sessionFiles = () => evaluate(`(async () => {
  const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions');
  const names = [];
  for await (const [name] of dir.entries()) names.push(name);
  return names.sort();
})()`);
const readSessionText = (name) => evaluate(`(async () => {
  const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions');
  return (await (await dir.getFileHandle(${JSON.stringify(name)})).getFile()).text();
})()`);

await send('Page.addScriptToEvaluateOnNewDocument', { source: ONGLETS });
await blockNetwork(BLOCKED_URLS);

// --- 1. Une course ---
await go('/course', 4000);
await waitFor(`Boolean(document.querySelector(${JSON.stringify(IMPORT_INPUT)}))`, { timeout: 5000, every: 50, label: 'champ de fichier' });
check('champ d\'import accepte les GPX et les FIT', (await evaluate(`document.querySelector(${JSON.stringify(IMPORT_INPUT)})?.accept ?? ''`)) === '.gpx,.fit');
check('libellé « Importer des GPX ou FIT »', await evaluate(`[...document.querySelectorAll('label')].some((l) => l.textContent.includes('Importer des GPX ou FIT'))`));
console.log('import de la course :', await importFiles(coursePath, IMPORT_INPUT));
await waitFor(async () => (await records()).length === 1, { timeout: 8000, label: 'fiche de la course' });
await waitText('1 session ajoutée', 'compte rendu');
const [course] = await records();
check('session Course', course?.sport === 'running', course?.sport);
check('1 200 points à 1 Hz', course?.summary?.pointCount === 1200, course?.summary?.pointCount);
check('distance de la vitesse (3 594 m à 1 %), pas celle du fichier', Math.abs((course?.summary?.distanceM ?? 0) - 3594) < 36, course?.summary?.distanceM);
const files = await sessionFiles();
check('le GPX et sa fiche, jamais le .fit', files.length === 2 && files.some((n) => n.endsWith('.gpx')) && files.some((n) => n.endsWith('.json')), files.join(', '));
const gpx = await readSessionText(course.gpx);
check('deux continus dans le GPX (la pause)', (gpx.match(/<trkseg>/g) ?? []).length === 2);
check('FC et cadence dans le GPX', gpx.includes('<gpxtpx:hr>150</gpxtpx:hr>') && gpx.includes('<gpxtpx:cad>85</gpxtpx:cad>'));
check('ni distance du fichier ni trace du .fit', !/distance/i.test(gpx));

await go(`/course/analyse?session=${encodeURIComponent(course.gpx)}`, 6000);
await waitFor(`document.querySelectorAll('.an-carte-col .ui-tab').length > 0`, { timeout: 10000, label: 'onglets' });
await settle({ max: 2000, label: 'analyse' });
check('analyse : la distance à l\'écran (3,59 km)', /3,(59|6)\d*\s*km/.test(await bodyText()));
console.log('  ouvre cardio :', await clickText('cardio', '.an-carte-col .ui-tab'));
await settle({ max: 1500 });
check('analyse : FC moyenne de 150 bpm à l\'écran', /FC moyenne\s*150 bpm/.test(await bodyText()));
await shoot('import-fit-analyse');

// --- 2. Le même FIT, de nouveau ---
await go('/course', 4000);
console.log('réimport :', await importFiles(coursePath, IMPORT_INPUT));
await waitText('1 déjà présente', 'déjà présente');
check('réimport : « déjà présente »', await bodyHas('0 sessions ajoutées, 1 déjà présente'));
check('réimport : rien de plus dans la mémoire', (await sessionFiles()).length === 2);

// --- 3. Refusés, avec leur raison ---
await go('/course', 4000);
console.log('faux FIT et FIT de salle :', await importFiles([fauxPath, sallePath], IMPORT_INPUT));
await waitText('faux.fit', 'faux FIT nommé');
const refused = await bodyText();
check('faux FIT : nommé, avec la raison', refused.includes("faux.fit : ce n'est pas un fichier FIT"));
check('FIT de salle : nommé, avec la raison', refused.includes('salle.fit : aucune position dans ce fichier'));
check('refusés : rien de rangé', (await sessionFiles()).length === 2);
await shoot('import-fit-refus');

// --- 4. Pas une activité, seul ---
await go('/course', 4000);
console.log('réglages de montre :', await importFiles(reglagesPath, IMPORT_INPUT));
await waitText("n'est pas une activité", 'phrase claire');
check('pas une activité : phrase claire', await bodyHas("Ce fichier de montre n'est pas une activité (réglages, parcours…) : rien n'a été importé."));
check('pas une activité : rien de rangé', (await sessionFiles()).length === 2);

// --- 5. Un dossier de deux activités ---
await go('/course', 4000);
const dialogText = () => evaluate(`document.querySelector('.ui-dialog')?.innerText ?? ''`);
console.log('dossier :', await importFiles(dossier, FOLDER_INPUT));
await waitFor(async () => (await dialogText()) !== '', { timeout: 8000, label: 'question' });
check('dossier : la question dit le nombre', (await dialogText()).includes('2 activités de montre dans ce dossier, tout importer ?'));
await shoot('import-fit-question');
console.log('  Annuler :', await clickText('Annuler', '.ui-dialog button'));
await waitText('Import annulé', 'annulé');
check('Annuler : rien de rangé, et c\'est dit', (await sessionFiles()).length === 2 && await bodyHas("Import annulé : rien n'a été importé."));

await go('/course', 4000);
console.log('dossier, de nouveau :', await importFiles(dossier, FOLDER_INPUT));
await waitFor(async () => (await dialogText()) !== '', { timeout: 8000, label: 'question' });
console.log('  Tout importer :', await clickText('Tout importer', '.ui-dialog button'));
await waitFor(async () => (await records()).length === 3, { timeout: 8000, label: 'fiches du dossier' });
await wait(200);
check('Tout importer : les deux sessions rangées', (await records()).length === 3);
check('Tout importer : la question est fermée', (await dialogText()) === '');

console.log(logs.length ? `console :\n${[...new Set(logs)].join('\n')}` : 'console : aucune erreur');
await finish();
