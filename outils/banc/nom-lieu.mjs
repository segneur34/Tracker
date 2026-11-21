// Banc de test : nom de base d'une session, « Activité · Lieu » (lot 215).
// Usage : node nom-lieu.mjs <port> <dossier de travail, chemin Windows>
// Sur un profil neuf, sans réseau : les requêtes à Overpass sont interceptées (`Fetch`) et servies par une réponse
// synthétique de la forme du serveur (communes, compte, plans d'eau), comme les fausses tuiles de `lib/tuiles.mjs` ;
// le mode « panne » les fait échouer comme un réseau coupé. Le reste du réseau est bloqué. Le script :
//  1. importe une course partie de Montpellier : une requête, commune seule (pas de plan d'eau) ; le lieu est rangé
//     dans la fiche ; la ligne de la bibliothèque et l'en-tête de l'analyse disent « Course · Montpellier » ;
//  2. importe une seconde course partie à 100 m : son lieu est recopié sans requête ;
//  3. panne : importe un wingfoil parti de Carnon ; la requête échoue, rien n'est rangé ni dit, le nom est
//     l'activité seule ; le réseau rendu, la page rechargée relance la file : la plage la plus proche est retenue ;
//  4. « Renommer » la première course en « Course · Le Grand Travers » : lieu corrigé (`user`), nom toujours calculé ;
//     la seconde course, à 100 m, le reprend (`appris`) ; le wingfoil, loin, garde le sien ;
//  5. nom libre, puis champ vidé : le nom calculé revient.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCKED_URLS, connect } from './lib/cdp.mjs';

const [port, workDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node nom-lieu.mjs <port> <dossier de travail>');
  process.exit(1);
}

// `lieux` : les requêtes de lieu partent vers la réponse simulée, au lieu d'échouer comme dans les autres scripts.
const b = await connect({ port, width: 1400, height: 1000, lieux: true });
const { send, evaluate, go, settle, waitFor, wait, blockNetwork, importFiles, records, clickText, onMessage, check, finish, logs } = b;

// --- Faux Overpass ---
let mode = 'normal';
const queries = [];
/** Réponse de la forme d'Overpass : commune du départ, compte, puis les plans d'eau si la requête en demande. */
const overpassAnswer = (query) => {
  const water = query.includes('nwr(around');
  const commune = water ? 'Mauguio' : 'Montpellier';
  const elements = [
    { type: 'area', id: 1, tags: { name: commune, admin_level: '8', boundary: 'administrative' } },
    { type: 'count', id: 0, tags: { total: '1' } },
  ];
  if (/->\.b;/.test(query)) elements.push({ type: 'area', id: 2, tags: { name: 'Sète' } }, { type: 'count', id: 0, tags: { total: '1' } });
  if (water) {
    elements.push(
      { type: 'way', id: 10, center: { lat: 43.5809, lon: 4.0306 }, tags: { name: 'Étang de l\'Or', natural: 'water' } },
      { type: 'way', id: 11, center: { lat: 43.553, lon: 3.97 }, tags: { name: 'Port de Plaisance', natural: 'water', leisure: 'marina' } },
      { type: 'way', id: 12, center: { lat: 43.5336, lon: 3.9516 }, tags: { name: 'Palavas Est', natural: 'beach' } },
      { type: 'way', id: 13, center: { lat: 43.547, lon: 3.9919 }, tags: { name: 'Carnon-Plage', natural: 'beach' } },
    );
  }
  return { version: 0.6, elements };
};
onMessage((msg) => {
  if (msg.method !== 'Fetch.requestPaused') return;
  const p = msg.params;
  const body = p.request.postData ?? '';
  const query = new URLSearchParams(body).get('data') ?? body;
  queries.push(query);
  const answer = mode === 'panne'
    ? send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'InternetDisconnected' })
    : send('Fetch.fulfillRequest', {
      requestId: p.requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
      body: Buffer.from(JSON.stringify(overpassAnswer(query))).toString('base64'),
    });
  void answer.catch(() => undefined);
});
// Motif préfixé `https://` : sinon le module Vite `src/planning/overpass.ts` serait intercepté (`recherche-sans-reponse.mjs`).
await send('Fetch.enable', { patterns: [{ urlPattern: 'https://overpass-api.de/*', requestStage: 'Request' }] });
await blockNetwork(BLOCKED_URLS.filter((u) => !u.includes('overpass')));

// --- Traces ---
const t0 = Date.UTC(2026, 9, 6, 7, 0, 0);
/** GPX de `n` points à 1 Hz, partis de `lat`, `lon`, vers l'est de `stepDeg` par point. */
const writeGpx = (name, type, startMs, lat, lon, n, stepDeg) => {
  const pts = Array.from({ length: n }, (_, k) =>
    `<trkpt lat="${lat.toFixed(6)}" lon="${(lon + k * stepDeg).toFixed(6)}"><time>${new Date(startMs + k * 1000).toISOString()}</time></trkpt>`);
  const path = join(workDir, name);
  writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><type>${type}</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`);
  return path;
};
// Deux courses de 10 min à 3 m/s environ, la seconde partie à 100 m au nord de la première ; un wingfoil à Carnon.
const run1 = writeGpx('course-1.gpx', 'running', t0, 43.6108, 3.8767, 600, 0.00004);
const run2 = writeGpx('course-2.gpx', 'running', t0 + 86_400_000, 43.6117, 3.8767, 600, 0.00004);
const wing = writeGpx('wing.gpx', 'wingfoil', t0 + 2 * 86_400_000, 43.548, 3.98, 600, 0.0001);

const rows = () => evaluate(`[...document.querySelectorAll('.lib-row__main')].map((r) => r.querySelector('.lib-row__head')?.innerText.replace(/\\n/g, ' / ') ?? '').join(' | ')`);
const header = () => evaluate(`document.querySelector('.an-name-line span')?.textContent ?? '(aucun)'`);
const placeOf = async (gpxStart) => {
  const r = (await records()).find((x) => x.gpx.startsWith(gpxStart));
  return r?.place ? `${r.place.name ?? 'rien'}${r.place.to ? ` → ${r.place.to}` : ''} (${r.place.source}, ${r.place.kind}, recherche ${r.place.search})` : 'aucun';
};
const nameOf = async (gpxStart) => (await records()).find((x) => x.gpx.startsWith(gpxStart))?.name ?? null;
const fileOf = async (gpxStart) => (await records()).find((x) => x.gpx.startsWith(gpxStart))?.gpx;
const typeIn = async (selector, value) => {
  await evaluate(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
  await wait(150);
  return evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })), 'ok'`);
};
const step = (title) => console.log(`\n== ${title}`);

step('1. Course partie de Montpellier');
await go('/course');
console.log('import :', await importFiles(run1, 'input[type=file][accept*=".gpx"][multiple]'));
await waitFor(async () => (await placeOf('2026-10-06')) !== 'aucun', { timeout: 8000, label: 'lieu de la course' });
await settle({ max: 1500, label: 'lieu rangé' });
console.log('lieu :', await placeOf('2026-10-06'));
check('une requête, commune seule, sans arrivée', queries.length === 1 && !queries[0].includes('nwr(around') && !queries[0].includes('->.b;'), queries.length);
console.log('lignes :', await rows());
check('ligne de la bibliothèque', (await rows()).includes('Course · Montpellier'), await rows());
const run1File = await fileOf('2026-10-06');
await go(`/course/analyse?session=${encodeURIComponent(run1File)}`, 4000);
await waitFor(async () => (await header()) !== '(aucun)', { timeout: 4000, label: 'en-tête' });
console.log('en-tête :', await header());
check('en-tête de l\'analyse', (await header()) === 'Course · Montpellier', await header());

step('2. Seconde course, partie à 100 m');
await go('/course');
console.log('import :', await importFiles(run2, 'input[type=file][accept*=".gpx"][multiple]'));
await waitFor(async () => (await placeOf('2026-10-07')) !== 'aucun', { timeout: 6000, label: 'lieu recopié' });
await settle({ max: 1500, label: 'lieu recopié' });
console.log('lieu :', await placeOf('2026-10-07'));
check('lieu recopié sans requête', queries.length === 1, queries.length);

step('3. Panne, puis rechargement');
mode = 'panne';
await go('/voile');
console.log('import :', await importFiles(wing, 'input[type=file][accept*=".gpx"][multiple]'));
await waitFor(async () => (await records()).some((r) => r.gpx.startsWith('2026-10-08')), { timeout: 6000, label: 'wingfoil rangé' });
await waitFor(() => queries.length === 2, { timeout: 6000, label: 'requête en panne' });
await settle({ max: 1500, label: 'panne' });
console.log('lieu :', await placeOf('2026-10-08'));
check('rien de rangé pendant la panne', (await placeOf('2026-10-08')) === 'aucun');
console.log('lignes :', await rows());
console.log('message :', await evaluate(`[...document.querySelectorAll('.ui-alert')].map((a) => a.textContent).join(' | ') || '(aucun)'`));
mode = 'normal';
await go('/voile');
await waitFor(async () => (await placeOf('2026-10-08')) !== 'aucun', { timeout: 8000, label: 'lieu après la panne' });
await settle({ max: 1500, label: 'lieu après la panne' });
console.log('lieu :', await placeOf('2026-10-08'));
check('plage la plus proche, requête du plan d\'eau', (await placeOf('2026-10-08')).startsWith('Carnon-Plage (osm, eau') && queries[2]?.includes('nwr(around'), queries.length);
console.log('lignes :', await rows());

step('4. Lieu corrigé par « Renommer »');
await go(`/course/analyse?session=${encodeURIComponent(run1File)}`, 4000);
await waitFor(async () => (await header()) !== '(aucun)', { timeout: 4000, label: 'en-tête' });
console.log('Renommer :', await clickText('Renommer'));
console.log('champ pré-rempli :', await evaluate(`document.querySelector('.an-name-input')?.value ?? '(aucun)'`));
await typeIn('.an-name-input', 'Course · Le Grand Travers');
await waitFor(async () => (await placeOf('2026-10-06')).includes('user'), { timeout: 2500, label: 'lieu corrigé' });
await settle({ max: 1500, label: 'lieu corrigé' });
console.log('en-tête :', await header());
console.log('lieux :', await placeOf('2026-10-06'), '|', await placeOf('2026-10-07'), '|', await placeOf('2026-10-08'));
check('nom toujours calculé', (await nameOf('2026-10-06')) === null);
check('lieu repris à 100 m', (await placeOf('2026-10-07')).startsWith('Le Grand Travers (appris'));
check('lieu loin gardé', (await placeOf('2026-10-08')).startsWith('Carnon-Plage'));

step('5. Nom libre, puis champ vidé');
await clickText('Renommer');
await typeIn('.an-name-input', 'Sortie du matin');
await waitFor(async () => (await nameOf('2026-10-06')) === 'Sortie du matin', { timeout: 2500, label: 'nom libre' });
console.log('en-tête :', await header());
await clickText('Renommer');
await typeIn('.an-name-input', '  ');
await waitFor(async () => (await nameOf('2026-10-06')) === null, { timeout: 2500, label: 'nom effacé' });
console.log('en-tête :', await header());
check('nom calculé rendu', (await header()) === 'Course · Le Grand Travers', await header());
await go('/course');
await waitFor(async () => (await rows()) !== '', { timeout: 4000, label: 'liste' });
console.log('lignes :', await rows());

console.log(`requêtes à Overpass : ${queries.length}`);
console.log(logs.length ? `console :\n${logs.join('\n')}` : 'console : aucune erreur');
await finish('Tout passe.');
