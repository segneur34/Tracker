// Banc de test : revêtement des itinéraires et des sessions (onglet « surface », §10, point 78).
// Usage : node surface.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Sur un profil neuf, avec réseau (brouter.de et overpass-api.de). Le script :
//  1. pose un itinéraire de deux points en Course, au nord de Montpellier : bloc « Surface » rempli par le
//     calcul ; l'enregistre (voies dans la fiche) ; retire ces voies de la fiche, comme une fiche d'avant,
//     et la rouvre : « Inconnu », « Calculer », puis le revêtement revient ;
//  2. charge un GPX sans horodatage : trace importée, tout « Inconnu » ;
//  3. écrit une course synthétique le long du tracé calculé (3 m/s, 1 Hz), l'importe dans la bibliothèque,
//     l'ouvre et déplie l'onglet « surface » : une requête à Overpass, voies rangées dans la fiche ;
//     recharge la page : mêmes chiffres, aucune nouvelle requête.
import { writeFileSync } from 'node:fs';
import { connect } from './lib/cdp.mjs';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node surface.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, settle, waitFor, wait, importFiles, shoot, mouse, onMessage, close, logs } = await connect({ port, width: 1400, height: 1000, shotDir });
const requests = { brouter: 0, overpass: 0 };
/** La page se monte après le chargement (modules à la demande, bibliothèque relue) : on attend son premier élément, 3 s au plus comme l'ancien sommeil. */
const ready = (selector) => waitFor(`document.querySelector(${JSON.stringify(selector)}) !== null`, { timeout: 3000, label: selector });
onMessage((msg) => {
  if (msg.method === 'Network.requestWillBeSent' && msg.params.request.method !== 'OPTIONS') {
    const url = msg.params.request.url;
    if (url.startsWith('https://brouter.de/brouter?')) requests.brouter += 1;
    if (url.startsWith('https://overpass-api.de/')) requests.overpass += 1;
  }
});

const clickButton = (text) => evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && !x.disabled);
  if (!b) return 'absent'; b.click(); return 'ok';
})()`);
const tapMap = async (fx, fy) => {
  const r = await evaluate(`(() => { const b = document.querySelector('.plan-map .leaflet-container').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()`);
  await mouse('mousePressed', r[0] + r[2] * fx, r[1] + r[3] * fy);
  await mouse('mouseReleased', r[0] + r[2] * fx, r[1] + r[3] * fy);
  await wait(300);
};
/** Lignes de la barre de revêtement : « Asphalte 1.23 km · Gravillon 450 m ». */
const surfaceRows = () => evaluate(`[...document.querySelectorAll('.surface-bar__row')].map((r) => r.innerText.replace(/\\n/g, ' ')).join(' · ') || '(aucune)'`);
const planNotes = (pattern) => evaluate(`[...document.querySelectorAll('.plan-note')].map((x) => x.textContent).filter((t) => ${pattern}.test(t)).join(' | ') || '(aucune)'`);
const readOpfs = (path) => evaluate(`(async () => {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker');
  const parts = ${JSON.stringify(path)}.split('/');
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
  return await (await (await dir.getFileHandle(parts[parts.length - 1])).getFile()).text();
})()`);
const writeOpfs = (path, text) => evaluate(`(async () => {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker');
  const parts = ${JSON.stringify(path)}.split('/');
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
  const w = await (await dir.getFileHandle(parts[parts.length - 1])).createWritable();
  await w.write(${JSON.stringify(text)}); await w.close(); return 'ok';
})()`);
const listOpfs = (path) => evaluate(`(async () => {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker');
  for (const p of ${JSON.stringify(path)}.split('/')) dir = await dir.getDirectoryHandle(p);
  const names = []; for await (const [name] of dir.entries()) names.push(name); return names.sort();
})()`);
/** Attend que plus aucun tronçon ne soit en calcul. */
const waitComputed = async () => {
  for (let k = 0; k < 40; k++) {
    await wait(500);
    if ((await planNotes('/en calcul/')) === '(aucune)') return;
  }
};

await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
// 1. Itinéraire calculé, en Course, au nord de Montpellier (garrigue et routes).
await go('/itineraires', 2000);
await evaluate(`localStorage.setItem('tracker.planning', JSON.stringify({ activityId: 'running', mode: 'chemin', view: { lat: 43.7735, lon: 3.811, zoom: 15 } }));
  localStorage.setItem('tracker.sections', JSON.stringify({ planning: { profil: true, surface: true, trace: true, points: true, ranger: true, liste: true } })); 'ok'`);
await go('/itineraires');
await ready('.plan-map .leaflet-container');
console.log('blocs :', await evaluate(`[...document.querySelectorAll('.plan-block__head')].map((x) => x.textContent.trim()).join(' | ')`));
console.log('vide :', await planNotes('/revêtement s.affiche/'));
await tapMap(0.3, 0.4);
await tapMap(0.7, 0.6);
await waitComputed();
console.log('calculé :', await surfaceRows(), '| requêtes BRouter', requests.brouter);
await shoot('surface-planification');
await evaluate(`(() => { const i = document.querySelector('.plan-form input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Surface banc'); i.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
console.log('Enregistrer :', await clickButton('Enregistrer'));
await waitFor(async () => (typeof (await readOpfs('itineraires/Surface banc.json')) === 'string') && (await readOpfs('itineraires/Surface banc.json')).length > 2, { timeout: 1500, label: 'itinéraire rangé' });
const saved = JSON.parse(await readOpfs('itineraires/Surface banc.json'));
console.log('fiche :', saved.legs.map((l) => `${l.mode}, ${l.points.length} points, ${l.surfaces ? `${l.surfaces.runs.length} morceaux, ${l.surfaces.tags.length} étiquettes` : 'sans voies'}`).join(' ; '));

// Fiche d'avant : voies retirées, puis rouverte.
await writeOpfs('itineraires/Surface banc.json', JSON.stringify({ ...saved, legs: saved.legs.map(({ surfaces: _s, ...leg }) => leg) }));
await go('/itineraires?itineraire=Surface%20banc', 4000);
await ready('.plan-block__head');
console.log('fiche d\'avant :', await surfaceRows());
console.log('note :', await planNotes('/avant/'));
const before = requests.brouter;
console.log('Calculer :', await clickButton('Calculer'));
await waitComputed();
console.log('recalculée :', await surfaceRows(), '| requêtes BRouter', requests.brouter - before);

// Points du tracé calculé, pour la course synthétique.
const route = JSON.parse(await readOpfs('itineraires/Surface banc.json'));
const path = route.legs.flatMap((l, k) => (k === 0 ? l.points : l.points.slice(1)));

// 2. GPX sans horodatage : trace importée.
const importedPath = `${workDir}\\trace-importee.gpx`;
writeFileSync(importedPath, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Importée</name><trkseg>\n${
  path.map(([lat, lon]) => `<trkpt lat="${lat}" lon="${lon}"></trkpt>`).join('\n')
}\n</trkseg></trk></gpx>\n`);
await importFiles(importedPath, '.plan-panel input[type=file]');
await wait(300);
await settle({ max: 1500, label: 'trace importée' });
console.log('trace importée :', await surfaceRows(), '| Calculer :', await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Calculer')`));

// 3. Course synthétique le long du tracé, importée puis analysée.
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const dist = (a, b) => 2 * R * Math.asin(Math.sqrt(Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2));
const SPEED = 3;
const t0 = Date.UTC(2026, 9, 4, 9, 0, 0);
const fixes = [path[0]];
for (let k = 1; k < path.length; k++) {
  const d = dist(path[k - 1], path[k]);
  const steps = Math.max(1, Math.round(d / SPEED));
  for (let j = 1; j <= steps; j++) fixes.push([path[k - 1][0] + ((path[k][0] - path[k - 1][0]) * j) / steps, path[k - 1][1] + ((path[k][1] - path[k - 1][1]) * j) / steps]);
}
const runPath = `${workDir}\\course-surface.gpx`;
writeFileSync(runPath, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Course surface</name><type>running</type><trkseg>\n${
  fixes.map(([lat, lon], k) => `<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><time>${new Date(t0 + k * 1000).toISOString()}</time></trkpt>`).join('\n')
}\n</trkseg></trk></gpx>\n`);
console.log(`course synthétique : ${fixes.length} points à ${SPEED} m/s`);
await go('/course');
await importFiles(runPath, 'input[type=file][accept=".gpx"][multiple]');
const gpxName = await waitFor(async () => (await listOpfs('sessions'))?.find((n) => n.endsWith('.gpx')), { timeout: 6000, label: 'fiche course' });
await settle({ max: 1500, label: 'import course' });
console.log('rangée :', gpxName);
await go(`/course/analyse?session=${encodeURIComponent(gpxName)}`, 4000);
await ready('.ui-tab');
console.log('onglets :', await evaluate(`[...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /^(général|tops|zones de pente|surface|énergie|graphiques|réglages)$/.test(t)).join(' | ')`));
await clickButton('surface');
await wait(500);
console.log('pendant :', await evaluate(`[...document.querySelectorAll('div')].map((d) => d.textContent).find((t) => t === 'Recherche des voies sur OpenStreetMap…') ?? '(rien)'`));
// Overpass met de quelques secondes à plus d'une minute, selon sa charge.
const searchStart = Date.now();
const surfaceError = () => evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Réessayer')?.previousElementSibling?.textContent ?? null`);
for (let k = 0; k < 150 && (await surfaceRows()) === '(aucune)' && (await surfaceError()) === null; k++) await wait(1000);
console.log('onglet surface :', await surfaceRows(), '| erreur', await surfaceError(), '| requêtes Overpass', requests.overpass,
  `| ${Math.round((Date.now() - searchStart) / 1000)} s`);
await shoot('surface-course');
// La fiche s'écrit un instant après le changement (800 ms) : on lui laisse le temps.
await waitFor(async () => JSON.parse(await readOpfs('sessions/' + gpxName.slice(0, -4) + '.json')).surfaces, { timeout: 1500, label: 'voies rangées' });
const record = JSON.parse(await readOpfs(`sessions/${gpxName.replace(/\.gpx$/, '.json')}`));
console.log('fiche :', record.surfaces ? `${record.surfaces.source}, version ${record.surfaces.matchVersion}, ${record.surfaces.runs.length} morceaux, ${record.surfaces.tags.length} étiquettes` : 'sans voies');
await go(`/course/analyse?session=${encodeURIComponent(gpxName)}`, 4000);
await waitFor(async () => (await surfaceRows()) !== '(aucune)', { timeout: 4000, label: 'voies relues' });
console.log('rechargée :', await surfaceRows(), '| requêtes Overpass', requests.overpass);

console.log(logs.length ? `console :\n${logs.join('\n')}` : 'console : aucune erreur');
await close();
process.exit(0);
