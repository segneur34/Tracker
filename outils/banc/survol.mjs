// Banc de test : coût du survol des graphes et des clics « Voir » sur une longue trace (lot B de l'audit, §10, point 93).
// Usage : node survol.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Sur un profil neuf. L'IGN, Overpass et BRouter sont bloqués, pour un résultat sans réseau et toujours le même ;
// seules les tuiles OSM passent, pour les captures. Le script :
//  1. écrit une course synthétique de 3 h à 1 Hz (10 800 points) et une session de voile (celle de `make-gpx.mjs`) ;
//  2. importe la course, ouvre son analyse (onglets général et « graphiques ») ;
//     compte les traits SVG de la carte et les canevas de la trace, puis mesure 50 survols du graphe de vitesse ;
//  3. importe la voile, ouvre son analyse (tous les onglets) et mesure 10 clics « Voir (Carte) » d'un top ;
//  4. avec `DUMP=x`, relève le texte des deux pages dans `x-course.txt` et `x-voile.txt`, avant tout survol ;
//  5. avec un dossier de captures : les deux cartes à 1400×1000, puis la course à 390×844 et sa carte en plein écran.
// Comparer deux versions : le lancer sur chacune, chaque fois sur un profil neuf, et `diff` les relevés.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './lib/cdp.mjs';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node survol.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}
const DUMP = process.env.DUMP;

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, settle, waitFor, blockNetwork, importGpx, shoot, close, logs, wait } = await connect({ port, width: 1400, height: 1000, shotDir });

const listOpfs = (path) => evaluate(`(async () => {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker');
  for (const p of ${JSON.stringify(path)}.split('/')) dir = await dir.getDirectoryHandle(p);
  const names = []; for await (const [name] of dir.entries()) names.push(name); return names.sort();
})()`);
/** Carte de la page : traits SVG, canevas de la trace colorée, légende. */
const mapInfo = () => evaluate(`JSON.stringify({
  traitsSvg: document.querySelectorAll('.an-map-frame .leaflet-overlay-pane path').length,
  canevasTrace: document.querySelectorAll('.an-map-frame .leaflet-trace-pane canvas').length,
  legende: document.querySelector('.an-map-frame .an-map-legend')?.textContent.trim() ?? '(aucune)',
})`);
/** Médiane et maximum d'une liste de durées, en ms. */
const timing = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  return `médiane ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} ms, max ${sorted[sorted.length - 1].toFixed(1)} ms (${list.length} mesures)`;
};
/** Attend l'image suivante : le rendu de React et le travail de Leaflet sont faits. */
const NEXT_FRAME = 'new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)))';

// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
await blockNetwork(['https://data.geopf.fr/*', 'https://overpass-api.de/*', 'https://brouter.de/*', 'https://photon.komoot.io/*']);

// 1. Traces. Course : boucles de 1 km de rayon autour de Montpellier, vitesse de 2 à 4,5 m/s, altitude ondulée.
const t0 = Date.UTC(2026, 9, 1, 7, 0, 0);
const R = 6_371_000;
const run = [];
let angle = 0;
for (let k = 0; k < 10_800; k++) {
  const speed = 3.25 + 1.25 * Math.sin(k / 300) + 0.3 * Math.sin(k / 17);
  angle += speed / 1000;
  const radius = 1000 + 150 * Math.sin(k / 900);
  const lat = 43.62 + ((radius * Math.cos(angle)) / R) * (180 / Math.PI);
  const lon = 3.86 + ((radius * Math.sin(angle)) / (R * Math.cos((43.62 * Math.PI) / 180))) * (180 / Math.PI);
  run.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><ele>${(80 + 30 * Math.sin(k / 400)).toFixed(1)}</ele><time>${new Date(t0 + k * 1000).toISOString()}</time></trkpt>`);
}
const runPath = `${workDir}\\survol-course.gpx`;
writeFileSync(runPath, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Course longue</name><type>running</type><trkseg>\n${run.join('\n')}\n</trkseg></trk></gpx>\n`);
const sailPath = `${workDir}\\survol-voile.gpx`;
execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'make-gpx.mjs'), sailPath]);

// 2. Course.
await go('/course');
await evaluate(`localStorage.setItem('tracker.sections', JSON.stringify({
  running: { general: true, tops: false, zones: false, surface: false, energie: false, graphiques: true, reglages: false },
  'sailing-onglets': { general: true, tops: true, manoeuvres: true, graphiques: true, vmg: true, vent: true, matos: true, reglages: true },
})); 'ok'`);
console.log('import course      :', await importGpx(readFileSync(runPath, 'utf8'), 'survol-course.gpx', 'input[type=file][accept=".gpx"][multiple]:not([disabled])'));
const runName = await waitFor(async () => (await listOpfs('sessions'))?.find((n) => n.endsWith('.gpx')), { timeout: 6000, label: 'fiche course' });
await settle({ max: 1500, label: 'import course' });
await go(`/course/analyse?session=${encodeURIComponent(runName)}`, 8000);
await waitFor("document.querySelectorAll('.an-map-frame .leaflet-trace-pane canvas').length > 0 && Boolean(document.querySelector('h1'))", { timeout: 8000, label: 'analyse prête' });
await settle({ max: 1000, label: 'analyse' });
console.log('course ouverte     :', runName, '|', await evaluate(`document.querySelector('h1')?.textContent`));
console.log('carte              :', await mapInfo());
if (DUMP) writeFileSync(`${DUMP}-course.txt`, await evaluate('document.body.innerText'));
await shoot('survol-course');

const hover = await evaluate(`(async () => {
  const el = document.querySelector('.recharts-wrapper');
  if (!el) return 'graphe absent';
  el.scrollIntoView({ block: 'center' });
  await ${NEXT_FRAME};
  const r = el.getBoundingClientRect();
  const times = [];
  for (let k = 0; k < 50; k++) {
    const x = r.left + 60 + ((r.width - 120) * k) / 49;
    const t = performance.now();
    el.querySelector('.recharts-surface').dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: r.top + r.height / 2, bubbles: true }));
    await ${NEXT_FRAME};
    times.push(performance.now() - t);
  }
  const marker = document.querySelectorAll('.an-map-frame .leaflet-overlay-pane path').length;
  return JSON.stringify({ times, marker });
})()`);
if (hover.startsWith('{')) {
  const { times, marker } = JSON.parse(hover);
  console.log('survol (50)        :', timing(times.slice(1)), '| traits SVG après survol :', marker);
} else console.log('survol             :', hover);

// 3. Voile.
const before = new Set(await listOpfs('sessions'));
await go('/voile');
console.log('import voile       :', await importGpx(readFileSync(sailPath, 'utf8'), 'survol-voile.gpx', 'input[type=file][accept=".gpx"][multiple]:not([disabled])'));
const sailName = await waitFor(async () => (await listOpfs('sessions'))?.find((n) => n.endsWith('.gpx') && !before.has(n)), { timeout: 6000, label: 'fiche voile' });
await settle({ max: 1500, label: 'import voile' });
await go(`/voile/analyse?session=${encodeURIComponent(sailName)}`, 8000);
await waitFor("document.querySelectorAll('.an-map-frame .leaflet-trace-pane canvas').length > 0 && Boolean(document.querySelector('h1'))", { timeout: 8000, label: 'analyse prête' });
await settle({ max: 1000, label: 'analyse' });
console.log('voile ouverte      :', sailName, '|', await evaluate(`document.querySelector('h1')?.textContent`));
console.log('carte              :', await mapInfo());
if (DUMP) writeFileSync(`${DUMP}-voile.txt`, await evaluate('document.body.innerText'));

const tops = await evaluate(`(async () => {
  const times = [];
  for (let k = 0; k < 10; k++) {
    const b = [...document.querySelectorAll('button')].find((x) => /(Voir|Masquer) \\(Carte\\)/.test(x.textContent));
    if (!b) return 'bouton absent';
    const t = performance.now();
    b.click();
    await ${NEXT_FRAME};
    times.push(performance.now() - t);
  }
  return JSON.stringify(times);
})()`);
console.log('clic « Voir » (10) :', tops.startsWith('[') ? timing(JSON.parse(tops)) : tops);
await evaluate(`[...document.querySelectorAll('button')].find((x) => /Voir \\(Carte\\)/.test(x.textContent))?.click(); 'ok'`);
await wait(500);
console.log('carte, top montré  :', await mapInfo());
await evaluate(`document.querySelector('.an-map-frame').scrollIntoView({ block: 'start' }); 'ok'`);
await wait(500);
await shoot('survol-voile-top');

// 4. Téléphone : la course, puis sa carte en plein écran.
if (shotDir) {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await go(`/course/analyse?session=${encodeURIComponent(runName)}`, 8000);
  await waitFor("document.querySelectorAll('.an-map-frame .leaflet-trace-pane canvas').length > 0 && Boolean(document.querySelector('h1'))", { timeout: 8000, label: 'analyse prête' });
  await settle({ max: 1000, label: 'analyse' });
  await shoot('survol-course-390');
  await evaluate(`document.querySelector('.an-map-frame .leaflet-container').click(); 'ok'`);
  await settle({ max: 3000 });
  console.log('plein écran        :', await evaluate(`JSON.stringify({
    traitsSvg: document.querySelectorAll('.an-map-overlay .leaflet-overlay-pane path').length,
    canevasTrace: document.querySelectorAll('.an-map-overlay .leaflet-trace-pane canvas').length,
  })`));
  await shoot('survol-course-390-plein-ecran');
}

console.log('--- console (erreurs, avertissements) ---');
[...new Set(logs)].slice(0, 10).forEach((l) => console.log(l));
await close();
process.exit(0);
