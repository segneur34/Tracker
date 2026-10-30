// Banc de test : vignettes de la bibliothèque et tuiles gardées (lot 74, « tuiles et vignettes de la bibliothèque »).
// Usage : node vignettes.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Sur un profil neuf ; tuiles fausses (`lib/tuiles.mjs` : damier beige et bleu pâle servi en 50 ms, sans réseau), le
// reste bloqué. Le script :
//  1. écrit 150 courses synthétiques de 20 min à 1 Hz (boucles de tailles et de lieux différents) et les importe ;
//  2. ouvre la bibliothèque à pied, la fait défiler jusqu'en bas puis attend que chaque vignette soit dessinée ;
//     relève les cartes Leaflet vivantes (`.leaflet-container`), les compteurs du DOM (`Memory.getDOMCounters`), le
//     tas JavaScript après un ramasse-miettes, les requêtes de tuiles (doubles, annulées) et leur répartition par
//     zoom (mêmes tuiles demandées = même cadrage), et si Leaflet a été chargé par la page ;
//  3. relève le style calculé de la mention d'OpenStreetMap de la première vignette ;
//  4. capture les six premières vignettes : plan, économe et thème sombre, à 1400 px puis à 390 px (densité 2) ;
//  5. écrit 10 000 tuiles dans le cache du navigateur, sans index, et mesure la liste des tuiles gardées
//     (`tileStore.list()`) au premier chargement (index à refaire depuis le lot 74), puis au suivant (index rangé).
// Les durées sont en secondes (le masque commun `N ms` les effacerait) et changent d'un passage à l'autre.
import { writeFileSync } from 'node:fs';
import { connect } from './lib/cdp.mjs';
import { BLOCKED_EXCEPT_TILES, fakeTiles, formatTileStats } from './lib/tuiles.mjs';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node vignettes.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}

const b = await connect({ port, width: 1400, height: 1000, shotDir });
const { send, evaluate, go, settle, waitFor, wait, blockNetwork, importFiles, records, close, logs } = b;
const tiles = await fakeTiles(b, { delayMs: 50 });
await blockNetwork(BLOCKED_EXCEPT_TILES);
const seconds = (ms) => `${(ms / 1000).toFixed(2).replace('.', ',')} s`;

// Modules chargés par la page (pour savoir si Leaflet l'a été) et octets des scripts reçus.
const scripts = [];
b.onMessage((msg) => {
  if (msg.method === 'Network.responseReceived' && msg.params.type === 'Script') scripts.push(msg.params.response.url);
});

// 1. 150 courses : boucles de 300 à 1 200 m de rayon, sur une grille de lieux autour de Montpellier, une par jour.
const COUNT = 150;
const R = 6_371_000;
const files = [];
for (let i = 0; i < COUNT; i++) {
  const t0 = Date.UTC(2026, 5, 1, 7, 0, 0) - i * 86_400_000;
  const lat0 = 43.55 + (i % 10) * 0.015;
  const lon0 = 3.8 + Math.floor(i / 10) * 0.012;
  const radius = 300 + (i % 7) * 150;
  const squash = 0.5 + ((i % 3) * 0.25);
  const pts = [];
  for (let s = 0; s < 1200; s++) {
    const a = (2 * Math.PI * s) / 1200;
    const r = radius * (1 + 0.15 * Math.sin(5 * a + i));
    const north = r * Math.sin(a) * squash;
    const east = r * Math.cos(a) * (i % 2 ? Math.cos(a) : 1);
    const lat = lat0 + (north / R) * (180 / Math.PI);
    const lon = lon0 + (east / (R * Math.cos((lat0 * Math.PI) / 180))) * (180 / Math.PI);
    pts.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><ele>50</ele><time>${new Date(t0 + s * 1000).toISOString()}</time></trkpt>`);
  }
  const path = `${workDir}\\vignette-${String(i).padStart(3, '0')}.gpx`;
  writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Course ${i}</name><type>running</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`);
  files.push(path);
}

await go('/course');
console.log('import             :', await importFiles(files, 'input[type=file][accept=".gpx"][multiple]:not([disabled])'));
const imported = await waitFor(async () => (await records()).length >= COUNT, { timeout: 240000, every: 1000, label: 'fiches' });
console.log('fiches             :', imported ? COUNT : (await records()).length);

// 2. Bibliothèque rechargée, défilée jusqu'en bas.
const READY = `[...document.querySelectorAll('.lib-row__preview')].filter((f) => f.querySelector('img.lib-row__preview-image, .leaflet-trace-pane canvas')).length`;
const SCROLLER = `(() => { let el = document.querySelector('.lib-row'); while (el && el !== document.body) { const s = getComputedStyle(el).overflowY; if ((s === 'auto' || s === 'scroll') && el.scrollHeight > el.clientHeight) return el; el = el.parentElement; } return document.scrollingElement; })()`;
scripts.length = 0;
tiles.reset();
await go('/course', 8000);
await waitFor(`document.querySelectorAll('.lib-row').length >= ${COUNT}`, { timeout: 20000, label: 'lignes' });
await waitFor(`${READY} > 0`, { timeout: 20000, label: 'première vignette' });
await settle({ max: 3000, label: 'bibliothèque' });
console.log('lignes             :', await evaluate(`document.querySelectorAll('.lib-row').length`));
console.log('Leaflet chargé     :', (await evaluate("'L' in window")) || scripts.some((u) => /leaflet/i.test(u)) ? 'oui' : 'non');
const t0 = Date.now();
for (let step = 0; step < 400; step++) {
  const atEnd = await evaluate(`(() => { const sc = ${SCROLLER}; sc.scrollBy(0, Math.round(sc.clientHeight * 0.8)); return sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2; })()`);
  await wait(120);
  if (atEnd) break;
}
await waitFor(`${READY} >= ${COUNT}`, { timeout: 120000, every: 250, label: 'toutes les vignettes' });
await settle({ max: 5000, label: 'défilement' });
console.log('défilement         :', seconds(Date.now() - t0), 'jusqu\'à la dernière vignette');
console.log('vignettes prêtes   :', await evaluate(READY));
console.log('cartes vivantes    :', await evaluate(`document.querySelectorAll('.leaflet-container').length`));
console.log('tuiles (défilement):', formatTileStats(tiles.stats()));
console.log('tuiles par zoom    :', tiles.stats().byZoom || '(aucune)');
await send('HeapProfiler.enable');
await send('HeapProfiler.collectGarbage');
await wait(300);
await send('HeapProfiler.collectGarbage');
const dom = (await send('Memory.getDOMCounters')).result;
console.log('DOM                :', `${dom.nodes} nœuds, ${dom.jsEventListeners} écouteurs, ${dom.documents} documents`);
await send('Performance.enable');
const heap = Object.fromEntries((await send('Performance.getMetrics')).result.metrics.map((m) => [m.name, m.value])).JSHeapUsedSize;
console.log('tas JavaScript     :', `${(heap / 1e6).toFixed(1).replace('.', ',')} Mo`);

// 3. Mention d'OSM de la première vignette.
await evaluate(`(() => { const sc = ${SCROLLER}; sc.scrollTo(0, 0); return true; })()`);
await settle({ max: 2000, label: 'retour en haut' });
const mention = await evaluate(`(() => {
  const frame = document.querySelector('.lib-row__preview');
  const credit = frame?.querySelector('.lib-row__preview-credit, .leaflet-control-attribution');
  if (!credit) return '(absente)';
  const name = credit.querySelector('.lib-row__preview-credit-name, a');
  const s = getComputedStyle(credit);
  const f = frame.getBoundingClientRect();
  const r = credit.getBoundingClientRect();
  const px = (v) => Math.round(v * 10) / 10;
  return [
    'texte « ' + credit.textContent.trim() + ' »',
    'police ' + s.fontFamily.split(',')[0] + ' ' + s.fontSize + ' ' + s.fontWeight + ', interligne ' + s.lineHeight,
    'encre ' + s.color + ', nom ' + (name ? getComputedStyle(name).color : '?') + ', fond ' + s.backgroundColor + ', marges ' + s.padding,
    'boîte ' + px(r.width) + ' × ' + px(r.height) + ' px, à ' + px(f.right - r.right) + ' px du bord droit et ' + px(f.bottom - r.bottom) + ' px du bas (cadre ' + px(f.width) + ' × ' + px(f.height) + ')',
    'cliquable ' + (name && name.tagName === 'A' ? 'oui (lien)' : 'non'),
  ].join('\\n  ');
})()`);
console.log(`mention OSM        :\n  ${mention}`);

// 4. Captures : les six premières vignettes, par thème et par largeur.
const capture = async (label) => {
  if (!shotDir) return;
  const rects = await evaluate(`[...document.querySelectorAll('.lib-row__preview')].slice(0, 6).map((f) => { const r = f.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })`);
  for (const [k, r] of (rects ?? []).entries()) {
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1 }, captureBeyondViewport: true });
    if (shot.result?.data) writeFileSync(`${shotDir}/vignettes-${label}-${k + 1}.png`, Buffer.from(shot.result.data, 'base64'));
  }
};
const THEMES = [['plan', { choice: 'clair', eco: false }], ['econome', { choice: 'auto', eco: true }], ['sombre', { choice: 'sombre', eco: false }]];
const SIZES = [['1400', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false }], ['390', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }]];
for (const [sizeLabel, metrics] of SIZES) {
  await send('Emulation.setDeviceMetricsOverride', metrics);
  for (const [themeLabel, theme] of THEMES) {
    await evaluate(`localStorage.setItem('tracker.theme', ${JSON.stringify(JSON.stringify(theme))}); true`);
    await go('/course', 8000);
    await waitFor(`[...document.querySelectorAll('.lib-row__preview')].slice(0, 6).every((f) => f.querySelector('img.lib-row__preview-image, .leaflet-tile-loaded, .leaflet-trace-pane canvas'))`, { timeout: 20000, label: `vignettes ${themeLabel} ${sizeLabel}` });
    // Tuiles et dernier dessin.
    await wait(800);
    await settle({ max: 3000, label: `${themeLabel} ${sizeLabel}` });
    const frame = await evaluate(`(() => { const r = document.querySelector('.lib-row__preview')?.getBoundingClientRect(); return r ? Math.round(r.width) + ' × ' + Math.round(r.height) : '?'; })()`);
    console.log(`vignette ${themeLabel.padEnd(7)} ${sizeLabel.padStart(4)} :`, `cadre ${frame} px`);
    await capture(`${themeLabel}-${sizeLabel}`);
  }
}
await evaluate(`localStorage.removeItem('tracker.theme'); true`);
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// 5. 10 000 tuiles gardées : liste au premier chargement, puis au suivant.
await go('/', 5000);
const filled = await evaluate(`(async () => {
  const cache = await caches.open('tracker-tuiles');
  const body = new Uint8Array(2000);
  const now = Date.now();
  for (let i = 0; i < 10000; i += 250) {
    await Promise.all(Array.from({ length: 250 }, (_, k) => {
      const key = '16_' + (33000 + i + k) + '_23900';
      return cache.put('/tuiles-gardees/' + key + '.png', new Response(new Blob([body], { type: 'image/png' }), { headers: { 'content-type': 'image/png', 'content-length': '2000', 'x-tracker-saved-at': String(now) } }));
    }));
  }
  // Tuiles gardées par une version sans index (ou index perdu) : la première liste le refait.
  await cache.delete('/tuiles-gardees/_index.json');
  return (await cache.keys()).length;
})()`);
console.log('tuiles écrites     :', filled);
const timeList = async (label) => {
  await go('/', 5000);
  const r = await evaluate(`(async () => {
    const { tileStore } = await import('/src/platform/tileCache.ts');
    const t = performance.now();
    const list = await tileStore.list();
    return { n: list.length, ms: performance.now() - t };
  })()`);
  console.log(`list() ${label.padEnd(11)} :`, r ? `${r.n} tuiles en ${seconds(r.ms)}` : '(échec)');
  // Calme pour l'écriture de l'index, s'il y en a un.
  await wait(1500);
};
await timeList('1er charg.');
await timeList('2e charg.');

console.log('--- console (erreurs, avertissements) ---');
[...new Set(logs)].slice(0, 10).forEach((l) => console.log(l));
await close();
process.exit(0);
