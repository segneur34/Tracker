// Banc de test : coût de la trace colorée sur la carte d'une longue sortie (lot 73, « trace colorée en une seule couche »).
// Usage : node carte-perf.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Sur un profil neuf, sans réseau (tuiles comprises : seule la trace compte, et les durées ne dépendent pas des
// tuiles reçues). Le script :
//  1. écrit une course synthétique de 3 h à 5 Hz (54 000 points, boucles qui se recoupent, vitesse de 2 à 4,5 m/s) ;
//  2. l'importe, ouvre son analyse et relève, sur la carte de l'analyse : le nombre de couches de Leaflet
//     (`map._layers`), les canevas du volet de la trace et l'histogramme des pixels de ce canevas (couleurs,
//     parts) ;
//  3. mesure 10 zooms puis 10 déplacements de la carte (sans animation) : durées du moteur (`Performance.getMetrics`,
//     ScriptDuration et TaskDuration) et durée de chaque geste jusqu'à l'image suivante ;
//  4. passe la carte sur le fond satellite (liseré blanc sous la trace) et refait 2 et 3 ;
//  5. retourne à la bibliothèque et relève la vignette de la course (couches, histogramme).
// Les durées sont en secondes (le masque commun `N ms` les effacerait) : le relevé change d'un passage à l'autre,
// il se lit à l'œil (couches et histogramme avant et après, durées comparées).
// Les cartes sont trouvées par un crochet posé sur `window.L` (Leaflet 1.9 s'y publie toujours) : chaque carte créée
// est gardée dans `window.__cartes`.
import { writeFileSync } from 'node:fs';
import { connect } from './lib/cdp.mjs';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node carte-perf.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}

const { send, evaluate, go, settle, waitFor, wait, blockNetwork, importFiles, records, shoot, close, logs } = await connect({ port, width: 1400, height: 1000, shotDir });

// Rangée « avancé » ouverte d'office, comme `survol.mjs` ; crochet des cartes de Leaflet.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {}
  (() => {
    let stored;
    window.__cartes = [];
    Object.defineProperty(window, 'L', {
      configurable: true,
      get: () => stored,
      set: (value) => {
        stored = value;
        if (value && value.Map && !value.__crochetBanc) {
          value.__crochetBanc = true;
          value.Map.addInitHook(function () { window.__cartes.push(this); });
        }
      },
    });
  })();
` });
await blockNetwork();
await send('Performance.enable');

// 1. Course de 3 h à 5 Hz autour de Montpellier : boucles de 1 km de rayon environ, qui se recoupent.
const HZ = 5;
const POINTS = 3 * 3600 * HZ;
const t0 = Date.UTC(2026, 9, 1, 7, 0, 0);
const R = 6_371_000;
const run = [];
let angle = 0;
for (let k = 0; k < POINTS; k++) {
  const s = k / HZ;
  const speed = 3.25 + 1.25 * Math.sin(s / 300) + 0.3 * Math.sin(s / 17);
  angle += speed / HZ / 1000;
  const radius = 1000 + 150 * Math.sin(s / 900);
  const lat = 43.62 + ((radius * Math.cos(angle)) / R) * (180 / Math.PI);
  const lon = 3.86 + ((radius * Math.sin(angle)) / (R * Math.cos((43.62 * Math.PI) / 180))) * (180 / Math.PI);
  run.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><ele>${(80 + 30 * Math.sin(s / 400)).toFixed(1)}</ele><time>${new Date(t0 + k * (1000 / HZ)).toISOString()}</time></trkpt>`);
}
const runPath = `${workDir}\\carte-perf-course.gpx`;
writeFileSync(runPath, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Course 5 Hz</name><type>running</type><trkseg>\n${run.join('\n')}\n</trkseg></trk></gpx>\n`);
console.log('trace              :', `${POINTS} points à ${HZ} Hz`);

const listOpfs = (path) => evaluate(`(async () => {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker');
  for (const p of ${JSON.stringify(path)}.split('/')) dir = await dir.getDirectoryHandle(p);
  const names = []; for await (const [name] of dir.entries()) names.push(name); return names.sort();
})()`);

/** Carte Leaflet vivante dont le conteneur est sous `scope` (sélecteur CSS). */
const MAP = (scope) => `(window.__cartes ?? []).filter((m) => m._container?.isConnected && m._container.closest(${JSON.stringify(scope)})).at(-1)`;
const ANALYSE = '.an-map-frame';
const VIGNETTE = '.lib-row__preview';

/** Couches de la carte et canevas de son volet de trace. */
const layers = (scope) => evaluate(`(() => {
  const map = ${MAP(scope)};
  if (!map) return '(carte absente)';
  const traceCanvas = map.getContainer().querySelectorAll('.leaflet-trace-pane canvas').length;
  return \`\${Object.keys(map._layers).length} couches, \${traceCanvas} canevas de trace\`;
})()`);

/**
 * Pixels bruts du canevas de la trace (RGBA, largeur et hauteur en tête, deux entiers de 32 bits), écrits dans le
 * dossier de travail : avec `--garder`, ceux d'avant et d'après se comparent pixel à pixel.
 */
const dumpPixels = async (scope, name) => {
  const b64 = await evaluate(`(() => {
    const canvas = ${MAP(scope)}?.getContainer().querySelector('.leaflet-trace-pane canvas');
    if (!canvas || canvas.width === 0) return null;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const out = new Uint8Array(8 + data.length);
    new DataView(out.buffer).setUint32(0, canvas.width, true);
    new DataView(out.buffer).setUint32(4, canvas.height, true);
    out.set(data, 8);
    let s = '';
    for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
    return btoa(s);
  })()`);
  if (b64) writeFileSync(`${workDir}\\carte-perf-${name}.rgba`, Buffer.from(b64, 'base64'));
};

/**
 * Histogramme des pixels du canevas de la trace : pixels peints, couleurs (rgba) d'au moins 0,1 % des pixels peints,
 * et les dix plus fréquentes avec leur part.
 */
const histogram = (scope) => evaluate(`(() => {
  const map = ${MAP(scope)};
  const canvas = map?.getContainer().querySelector('.leaflet-trace-pane canvas');
  if (!canvas || canvas.width === 0) return '(canevas absent)';
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const counts = new Map();
  let painted = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    painted++;
    const key = (data[i] << 24 | data[i + 1] << 16 | data[i + 2] << 8 | data[i + 3]) >>> 0;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const hex = (k) => '#' + k.toString(16).padStart(8, '0');
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const share = (n) => (100 * n / painted).toFixed(1).replace('.', ',') + ' %';
  const frequent = sorted.filter(([, n]) => n / painted >= 0.001).length;
  return [
    \`  canevas \${canvas.width}×\${canvas.height}, \${painted} pixels peints, \${counts.size} couleurs dont \${frequent} à 0,1 % ou plus\`,
    ...sorted.slice(0, 10).map(([k, n]) => \`  \${hex(k)} \${share(n)}\`),
  ].join('\\n');
})()`);

const metrics = async () => Object.fromEntries((await send('Performance.getMetrics')).result.metrics.map((m) => [m.name, m.value]));
const seconds = (v) => `${v.toFixed(3).replace('.', ',')} s`;
const NEXT_FRAME = 'new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)))';

/** Dix gestes sur la carte (`zoom` : trois avant, trois arrière, deux avant, deux arrière ; `pan` : va-et-vient), puis leurs durées. */
const gestures = async (scope, kind) => {
  const before = await metrics();
  const times = await evaluate(`(async () => {
    const map = ${MAP(scope)};
    if (!map) return null;
    const zooms = [1, 1, 1, -1, -1, -1, 1, 1, -1, -1];
    const pans = [[200, 120], [-200, -120], [-150, 180], [150, -180], [250, 0], [-250, 0], [0, 200], [0, -200], [180, 180], [-180, -180]];
    const times = [];
    for (let k = 0; k < 10; k++) {
      const t = performance.now();
      // Geste lancé d'une tâche de la page : le JavaScript d'un \`Runtime.evaluate\` n'entre pas dans ScriptDuration.
      await new Promise((res) => setTimeout(() => {
        if (${JSON.stringify(kind)} === 'zoom') map.setZoom(map.getZoom() + zooms[k], { animate: false });
        else map.panBy(pans[k], { animate: false });
        res();
      }, 0));
      await ${NEXT_FRAME};
      times.push(performance.now() - t);
    }
    return times;
  })()`);
  const after = await metrics();
  if (!times) return '(carte absente)';
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] / 1000;
  const max = sorted[sorted.length - 1] / 1000;
  return `script ${seconds(after.ScriptDuration - before.ScriptDuration)}, tâches ${seconds(after.TaskDuration - before.TaskDuration)}, geste médian ${seconds(median)}, max ${seconds(max)}`;
};

const measure = async (label) => {
  console.log(`${label} : carte       :`, await layers(ANALYSE));
  console.log(`${label} : histogramme :\n${await histogram(ANALYSE)}`);
  await dumpPixels(ANALYSE, label.trim());
  console.log(`${label} : 10 zooms    :`, await gestures(ANALYSE, 'zoom'));
  console.log(`${label} : 10 déplac.  :`, await gestures(ANALYSE, 'pan'));
};

// 2. Import et analyse.
await go('/course');
console.log('import             :', await importFiles(runPath, 'input[type=file][accept=".gpx"][multiple]:not([disabled])'));
const runName = await waitFor(async () => (await listOpfs('sessions'))?.find((n) => n.endsWith('.gpx')), { timeout: 20000, label: 'fiche course' });
// La fiche écrite et la vignette dessinée : la session se relit en entier (sous charge, l'écriture suit l'import de loin).
await waitFor(async () => (await records()).length > 0, { timeout: 30000, label: 'fiche JSON' });
await waitFor(`document.querySelectorAll('${VIGNETTE} .leaflet-trace-pane canvas').length > 0`, { timeout: 30000, label: 'vignette après import' });
await settle({ max: 3000, label: 'import course' });
const tOpen = Date.now();
await go(`/course/analyse?session=${encodeURIComponent(runName)}`, 20000);
const analysisReady = `document.querySelectorAll('${ANALYSE} .leaflet-trace-pane canvas').length > 0 && Boolean(document.querySelector('h1'))`;
if (!(await waitFor(analysisReady, { timeout: 20000, label: 'analyse prête' }))) {
  // Une seconde chance : la page rechargée relit la session.
  await go(`/course/analyse?session=${encodeURIComponent(runName)}`, 20000);
  await waitFor(analysisReady, { timeout: 30000, label: 'analyse prête (2e)' });
}
await settle({ max: 3000, label: 'analyse' });
console.log('analyse ouverte    :', await evaluate(`document.querySelector('h1')?.textContent`), `(${seconds((Date.now() - tOpen) / 1000)} jusqu'à la carte)`);
await evaluate(`document.querySelector('${ANALYSE}').scrollIntoView({ block: 'start' }); 'ok'`);
await wait(300);
await shoot('carte-perf-plan');
await measure('plan     ');

// 4. Fond satellite : le liseré blanc s'ajoute sous la trace.
await evaluate(`document.querySelector('${ANALYSE} .map-base-switch__button')?.click(); 'ok'`);
await wait(300);
const chosen = await evaluate(`(() => { const b = [...document.querySelectorAll('${ANALYSE} .map-base-switch__choice')].find((x) => x.textContent.trim() === 'Satellite'); b?.click(); return Boolean(b); })()`);
await settle({ max: 3000, label: 'satellite' });
console.log('fond satellite     :', chosen ? 'choisi' : '(choix absent)');
await shoot('carte-perf-satellite');
await measure('satellite');

// 5. Vignette de la bibliothèque.
await go('/course', 8000);
await waitFor(`document.querySelectorAll('${VIGNETTE} .leaflet-trace-pane canvas').length > 0`, { timeout: 20000, label: 'vignette' });
await settle({ max: 3000, label: 'bibliothèque' });
console.log('vignette : carte       :', await layers(VIGNETTE));
console.log(`vignette : histogramme :\n${await histogram(VIGNETTE)}`);
await dumpPixels(VIGNETTE, 'vignette');
await shoot('carte-perf-vignette');

console.log('--- console (erreurs, avertissements) ---');
[...new Set(logs)].slice(0, 10).forEach((l) => console.log(l));
await close();
process.exit(0);
