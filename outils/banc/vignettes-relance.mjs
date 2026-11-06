// Banc de test : vignettes de la bibliothèque gardées d'un lancement à l'autre (lot 118 : traces ; lot 121 : images finies).
// Usage : node vignettes-relance.mjs <port> <dossier de travail, chemin Windows>
// Sur un profil neuf ; tuiles fausses (`lib/tuiles.mjs`, servies en 50 ms, sans réseau), le reste bloqué. Le script :
//  1. écrit 30 courses synthétiques de 20 min à 1 Hz (boucles de tailles et de lieux différents) et les importe ;
//  2. efface les vignettes gardées (caches `tracker-vignettes` et `tracker-vignettes-images`), puis ouvre la bibliothèque
//     à pied à 390 × 844, densité 2 (premier lancement : chaque vignette relit son GPX), attend les vignettes visibles,
//     laisse 3 s à l'écriture du magasin et relève l'empreinte SHA-1 de chaque image visible (la référence), puis le
//     nombre et le poids moyen des images finies gardées (cache `tracker-vignettes-images` ; 0 avant le lot 121) ;
//  3. relance la page trois fois, processeur ralenti six fois (`Emulation.setCPUThrottlingRate`), et mesure depuis la
//     navigation : « trace », jusqu'à ce que chaque vignette visible porte une image (la trace seule, d'attente, compte) ;
//     « fond », jusqu'à ce que chaque vignette visible ait montré son image finie (empreinte égale à la référence),
//     heure d'apparition de l'image et non de son empreinte ; médianes des trois ;
//  4. compare les images de chaque relance à celles du premier lancement.
// Les durées sont en secondes (le masque commun `N ms` les effacerait) et changent d'un passage à l'autre.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, connect } from './lib/cdp.mjs';
import { BLOCKED_EXCEPT_TILES, fakeTiles } from './lib/tuiles.mjs';

const [port, workDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node vignettes-relance.mjs <port> <dossier de travail>');
  process.exit(1);
}

const b = await connect({ port, width: 390, height: 844 });
const { send, evaluate, go, settle, waitFor, wait, blockNetwork, importFiles, records, close, logs } = b;
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await fakeTiles(b, { delayMs: 50 });
await blockNetwork(BLOCKED_EXCEPT_TILES);
const seconds = (ms) => `${(ms / 1000).toFixed(2).replace('.', ',')} s`;

// 1. 30 courses : boucles de 300 à 1 200 m de rayon autour de Montpellier, une par jour.
const COUNT = 30;
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
  const path = join(workDir, `relance-${String(i).padStart(2, '0')}.gpx`);
  writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Course ${i}</name><type>running</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`);
  files.push(path);
}

await go('/course');
console.log('import                :', await importFiles(files, 'input[type=file][accept*=".gpx"][multiple]:not([disabled])'));
const imported = await waitFor(async () => (await records()).length >= COUNT, { timeout: 120000, every: 1000, label: 'fiches' });
console.log('fiches                :', imported ? COUNT : (await records()).length);

// Vignettes visibles (dans l'écran, même en partie) et vrai quand chacune porte son image.
const VISIBLE = `[...document.querySelectorAll('.lib-row__preview')].filter((f) => { const r = f.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight; })`;
const ALL_DRAWN = `(() => { const v = ${VISIBLE}; return document.querySelectorAll('.lib-row').length >= ${COUNT} && v.length > 0 && v.every((f) => f.querySelector('img.lib-row__preview-image')); })()`;
/** Empreinte SHA-1 (12 premiers chiffres) de l'image d'adresse `src`, dans la page. */
const HASH_OF = `async (src) => {
  const bytes = await (await fetch(src)).arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes));
  return [...digest].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 12);
}`;
const HASHES = `(async () => {
  const hashOf = ${HASH_OF};
  const out = [];
  for (const f of ${VISIBLE}) {
    const img = f.querySelector('img.lib-row__preview-image');
    out.push(img ? await hashOf(img.src) : '(sans image)');
  }
  return out;
})()`;
/** Images finies gardées sur l'appareil (lot 121) : nombre et poids total, sans créer le cache s'il manque. */
const KEPT_IMAGES = `(async () => {
  if (!(await caches.has('tracker-vignettes-images'))) return { count: 0, bytes: 0 };
  const cache = await caches.open('tracker-vignettes-images');
  let count = 0;
  let bytes = 0;
  for (const request of await cache.keys()) {
    if (!request.url.endsWith('.png')) continue;
    const response = await cache.match(request);
    if (!response) continue;
    count++;
    bytes += (await response.blob()).size;
  }
  return { count, bytes };
})()`;

/**
 * Lance `/course` et rend, en ms depuis le début de la navigation (horloge de la page), `trace` : le temps jusqu'à ce
 * que chaque vignette visible porte une image, et `fond` : jusqu'à ce que chacune ait montré l'image d'empreinte
 * `expected[i]` (la plus tardive des heures d'apparition de ces images ; `null` sans `expected`). `null` après 60 s.
 */
const launch = async (expected = null) => {
  const before = await evaluate(`window.__banc?.doc ?? null`);
  await send('Page.navigate', { url: `${BASE}/course` });
  await waitFor(async () => {
    const doc = await evaluate(`window.__banc?.doc ?? null`);
    return doc && doc !== before;
  }, { timeout: 30000, every: 20, label: 'nouveau document' });
  return (await evaluate(`new Promise((resolve) => {
    const expected = ${JSON.stringify(expected)};
    const hashOf = ${HASH_OF};
    const t0 = performance.now();
    let trace = null;
    // Par vignette : chaque adresse d'image vue, l'heure de son apparition et son empreinte (calculée à part).
    const seen = new Map();
    const fondAt = (frames) => {
      if (!expected || frames.length !== expected.length) return null;
      let last = 0;
      for (let i = 0; i < frames.length; i++) {
        const shown = [...(seen.get(frames[i])?.values() ?? [])].filter((r) => r.hash === expected[i]);
        if (shown.length === 0) return null;
        last = Math.max(last, Math.min(...shown.map((r) => r.at)));
      }
      return last;
    };
    const tick = () => {
      const now = performance.now();
      const frames = ${VISIBLE};
      for (const f of frames) {
        const img = f.querySelector('img.lib-row__preview-image');
        if (!img) continue;
        if (!seen.has(f)) seen.set(f, new Map());
        const images = seen.get(f);
        if (images.has(img.src)) continue;
        const record = { at: now, hash: null };
        images.set(img.src, record);
        hashOf(img.src).then((h) => { record.hash = h; }, () => { record.hash = '?'; });
      }
      if (trace === null && ${ALL_DRAWN}) trace = now;
      const fond = trace === null ? null : fondAt(frames);
      if (trace !== null && (!expected || fond !== null)) resolve({ trace, fond });
      else if (now - t0 > 60000) resolve({ trace, fond });
      else setTimeout(tick, 16);
    };
    tick();
  })`)) ?? { trace: null, fond: null };
};

/** Images finales (l'image d'attente de la trace seule remplacée) : page calme puis un temps pour le dernier dessin. */
const finalHashes = async (label) => {
  await settle({ max: 10000, label });
  await wait(1500);
  return (await evaluate(HASHES)) ?? [];
};

// 2. Premier lancement : rien de gardé.
await go('/', 5000);
await evaluate(`Promise.all(['tracker-vignettes', 'tracker-vignettes-images'].map((name) => caches.delete(name))).then(() => true, () => true)`);
const firstMs = (await launch()).trace;
console.log('1er lancement         :', firstMs == null ? '(vignettes absentes après 60 s)' : `${seconds(firstMs)}, sans ralenti`);
const reference = await finalHashes('1er lancement');
console.log('vignettes visibles    :', reference.length);
// Écriture du magasin (2 s après la dernière vignette gardée).
await wait(3000);
const kept = (await evaluate(KEPT_IMAGES)) ?? { count: 0, bytes: 0 };
console.log('images finies gardées :', kept.count === 0
  ? '0'
  : `${kept.count}, poids moyen ${(kept.bytes / kept.count / 1000).toFixed(1).replace('.', ',')} ko`);

// 3. Relances, processeur ralenti.
await send('Emulation.setCPUThrottlingRate', { rate: 6 });
const times = [];
let identical = reference.length > 0;
for (let k = 0; k < 3; k++) {
  times.push(await launch(reference.length > 0 ? reference : null));
  const hashes = await finalHashes(`relance ${k + 1}`);
  if (hashes.length !== reference.length || hashes.some((h, i) => h !== reference[i])) identical = false;
}
await send('Emulation.setCPUThrottlingRate', { rate: 1 });
const median = (values) => {
  const measured = values.filter((t) => t != null).sort((x, y) => x - y);
  return measured.length ? seconds(measured[Math.floor(measured.length / 2)]) : '(aucune)';
};
const traces = times.map((t) => t.trace);
const fonds = times.map((t) => t.fond);
console.log('2e lancement ralenti×6:', traces.map((t) => (t == null ? 'absentes' : seconds(t))).join(', '));
console.log('médiane               :', median(traces));
console.log('fond de carte ×6      :', fonds.map((t) => (t == null ? 'absent' : seconds(t))).join(', '));
console.log('médiane fond          :', median(fonds));
// 4. Mêmes images qu'au premier lancement.
console.log('vignettes identiques au 1er lancement :', identical ? 'oui' : 'non');

console.log('--- console (erreurs, avertissements) ---');
[...new Set(logs)].slice(0, 10).forEach((l) => console.log(l));
await close();
process.exit(0);
