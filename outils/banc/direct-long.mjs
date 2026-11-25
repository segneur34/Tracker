// Banc de test : une longue sortie vue du direct, dans le navigateur (lot 235, mesure M3).
// Usage : node direct-long.mjs <port Chrome> <dossier de travail, chemin Windows>
// Sur la version compilée, par `FLUIDITE_SCRIPT=direct-long node outils/banc/fluidite-compile.mjs <étiquette>` (build, `vite preview`,
// Chrome sans fenêtre ; ce lanceur ne minifie pas le code, pour que le profileur garde les noms des fonctions : `FLUIDITE_MINIFIE=1`
// le garde minifié, les noms du profil ne se classent alors plus). Sur le serveur de développement, les durées sont de 3 à 9 fois trop
// longues (lot 164) : sans valeur. Environ 16 min, plafond de 25 min (le script s'arrête alors en le disant), sur un profil neuf, sans réseau
// (fausses tuiles de `lib/tuiles.mjs`).
//
// Deux sorties de 3 h 10 à 1 Hz rejouées dans la page Enregistrer, l'une en voile (vitesse Doppler, FC), l'autre en course (altitude, FC).
// L'horloge de la page est accélérée ×100 (`horlogeVariable` de `connect`, facteur `window.__bancFacteur`) jusqu'à 2 h 55 de trace
// (10 500 positions), puis remise à ×1 :
//  - tranche 1 : 3 min à vitesse normale ; tranche 2 : 3 min de plus, processeur ralenti ×6 (`Emulation.setCPUThrottlingRate`, comme un
//    Android moyen) ;
//  - chaque tranche : 90 s sur la carte en plan, puis 90 s en satellite (bouton « Fond de carte » de la carte du direct) ; sur chaque
//    moitié, 60 s de mesure (tâches longues de l'API `longtask`, nombre, total et plus longue ; temps de tâche de la page par position
//    reçue, `Performance.getMetrics`), puis 30 s sous le profileur, dont le temps est rangé par fichier : Leaflet (le paquet `vendor-map`),
//    chiffres du direct (`liveStats` et ses voisins : `kinematics`, dénivelé, pente, énergie), React, autres.
// Le profil est rangé par fonction : chaque temps propre va au plus proche appelant classé (les fonctions du navigateur, `map`, `concat`,
// reviennent ainsi à leur appelant), classé par son nom d'après les fichiers de `src/` et de React lus ici. Le code de nos composants
// appelé par un effet de React, sans nom propre, est rangé à React. Le relevé de tâches ne tourne jamais sous le profileur.
// Sortie : un tableau court, puis « Tout est passé. » ou la raison de l'échec (code 1). Les relevés détaillés vont sur la sortie d'erreur.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, diag } from './lib/cdp.mjs';
import { BLOCKED_EXCEPT_TILES, fakeTiles } from './lib/tuiles.mjs';

const [port, workDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node direct-long.mjs <port Chrome> <dossier de travail>');
  process.exit(1);
}

/** Plafond de temps du script : au-delà, il s'arrête en le disant. */
const PLAFOND_MS = 25 * 60_000;
const startedAt = Date.now();
const plafond = setTimeout(() => {
  console.log(`ÉCHEC : plafond de ${PLAFOND_MS / 60_000} min atteint, arrêt du script.`);
  process.exit(1);
}, PLAFOND_MS);
plafond.unref();

const FILE_S = 3 * 3600 + 600;
/** Positions reçues à partir desquelles l'horloge repasse à ×1 : 2 h 55 de trace. */
const FAST_UNTIL_POINTS = 2 * 3600 + 55 * 60 + 1;
const FAST_FACTOR = 100;
/** Attente maximale du rejeu accéléré (temps réel) avant de dire qu'il n'avance plus. */
const FAST_MAX_MS = 6 * 60_000;
const MEASURE_S = 60;
const PROFILE_S = 30;
const RATES = [1, 6];
const FONDS = ['plan', 'satellite'];

const fr = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? '—' : x.toFixed(d).replace('.', ','));
const R = 6_371_000;
const noiseFrom = (seed) => {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return (x / 4294967296) * 2 - 1;
  };
};

// --- Traces (1 Hz) ---
const gpxOf = (name, type, points) => `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><name>${name}</name><type>${type}</type><trkseg>\n${points.join('\n')}\n</trkseg></trk></gpx>\n`;
const T_SAIL = Date.UTC(2026, 7, 1, 9, 0, 0);
const T_RUN = Date.UTC(2026, 8, 5, 8, 0, 0);
/** Voile : bords à 45° et 315° à ~7 m/s, un virement de 6 s toutes les 90 s, vitesse Doppler et FC. */
const sailGpx = () => {
  const rnd = noiseFrom(11);
  const points = [];
  let lat = 43.5, lon = 3.95;
  for (let t = 0; t < FILE_S; t++) {
    const tack = Math.floor(t / 90);
    const heading0 = tack % 2 === 0 ? 45 : 315;
    const previous = tack === 0 ? heading0 : tack % 2 === 0 ? 315 : 45;
    const inTurn = t % 90 < 6 ? (t % 90) / 6 : null;
    const turn = ((heading0 - previous + 540) % 360) - 180;
    const heading = inTurn === null ? heading0 : (previous + turn * inTurn + 360) % 360;
    const speed = (inTurn === null ? 7 : 7 - 4 * Math.sin(Math.PI * inTurn)) + 0.4 * rnd();
    lat += (speed * Math.cos((heading * Math.PI) / 180) / R) * (180 / Math.PI);
    lon += (speed * Math.sin((heading * Math.PI) / 180) / (R * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
    const hr = Math.round(130 + 20 * Math.sin(t / 600) + 3 * rnd());
    points.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><time>${new Date(T_SAIL + t * 1000).toISOString()}</time><extensions><speed>${speed.toFixed(2)}</speed><gpxtpx:TrackPointExtension><gpxtpx:hr>${hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`);
  }
  return gpxOf('Voile 3 h 10', 'wingfoil', points);
};
/** Course : tours d'un cercle de 1,5 km, allure qui ondule, altitude ondulée avec un peu de bruit, FC. */
const runGpx = () => {
  const rnd = noiseFrom(21);
  const points = [];
  let angle = 0;
  for (let t = 0; t < FILE_S; t++) {
    const speed = 3.3 * (1 + 0.25 * Math.sin(t / 300) + 0.06 * Math.sin(t / 17)) + 0.2 * rnd();
    angle += speed / 1500;
    const lat = 43.62 + ((1500 * Math.cos(angle)) / R) * (180 / Math.PI);
    const lon = 3.86 + ((1500 * Math.sin(angle)) / (R * Math.cos((43.62 * Math.PI) / 180))) * (180 / Math.PI);
    const hr = Math.round(135 + 20 * Math.sin(t / 600) + t / 900 + 3 * rnd());
    points.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><ele>${(80 + 30 * Math.sin(t / 400) + 1.5 * rnd()).toFixed(1)}</ele><time>${new Date(T_RUN + t * 1000).toISOString()}</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`);
  }
  return gpxOf('Course 3 h 10', 'running', points);
};

// --- Classement des fonctions du profil, d'après les fichiers du dépôt ---
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
/** Noms déclarés au premier niveau d'un fichier (`const f =`, `function f`), sans leur suffixe de doublon `$1` du paquet. */
const declared = (text) => new Set([...text.matchAll(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]));
const declaredIn = (files) => {
  const names = new Set();
  for (const f of files) {
    try { for (const n of declared(readFileSync(join(SRC, f), 'utf8'))) names.add(n); } catch { /* fichier absent : groupe plus pauvre */ }
  }
  return names;
};
const mapFiles = (() => {
  try { return readdirSync(join(SRC, 'components', 'map')).filter((n) => /\.tsx?$/.test(n) && !/\.test\./.test(n)).map((n) => `components/map/${n}`); } catch { return []; }
})();
const GROUPS = {
  kinematics: declaredIn(['core/kinematics.ts']),
  direct: declaredIn(['recording/liveStats.ts', 'recording/liveLegs.ts', 'recording/livePath.ts', 'core/sessionStats.ts', 'core/topSegments.ts', 'core/heartRate.ts', 'core/speedFilter.ts']),
  denivele: declaredIn(['core/elevation.ts', 'land/grade.ts', 'running/energy.ts', 'cycling/energy.ts']),
  carte: declaredIn(['components/LiveMap.tsx', ...mapFiles]),
};
const REACT_NAMES = (() => {
  const names = new Set();
  try {
    const require = createRequire(import.meta.url);
    for (const [pkg, file] of [['react-dom', 'cjs/react-dom-client.production.js'], ['react', 'cjs/react.production.js'], ['scheduler', 'cjs/scheduler.production.js']]) {
      const text = readFileSync(join(dirname(require.resolve(`${pkg}/package.json`)), file), 'utf8');
      for (const m of text.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) names.add(m[1]);
    }
  } catch { /* React introuvable : le groupe reste vide et le relevé le dit */ }
  const mine = new Set(Object.values(GROUPS).flatMap((s) => [...s]));
  for (const n of mine) names.delete(n);
  return names;
})();
/** Groupe d'un cadre d'appel, `null` s'il n'en a pas (il hérite alors de son plus proche appelant classé). */
const groupOf = (cf) => {
  if (/vendor-map|[\\/]leaflet[\\/]/.test(cf.url ?? '')) return 'leaflet';
  const name = (cf.functionName ?? '').replace(/\$\d+$/, '');
  if (!name || name.startsWith('(')) return null;
  if (GROUPS.kinematics.has(name)) return 'kinematics';
  if (GROUPS.direct.has(name)) return 'direct';
  if (GROUPS.denivele.has(name)) return 'denivele';
  if (GROUPS.carte.has(name)) return 'carte';
  if (REACT_NAMES.has(name)) return 'react';
  return null;
};
/** Temps propre de chaque fonction rangé au groupe de son plus proche appelant classé (ou d'elle-même), hors repos. */
const profileGroups = (profile) => {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const cache = new Map();
  const groupFor = (id) => {
    if (cache.has(id)) return cache.get(id);
    const g = groupOf(nodes.get(id).callFrame) ?? (parent.has(id) ? groupFor(parent.get(id)) : 'autres');
    cache.set(id, g);
    return g;
  };
  const totals = { leaflet: 0, kinematics: 0, direct: 0, denivele: 0, carte: 0, react: 0, autres: 0 };
  let all = 0;
  profile.samples.forEach((id, i) => {
    if (nodes.get(id).callFrame.functionName === '(idle)') return;
    totals[groupFor(id)] += profile.timeDeltas[i];
    all += profile.timeDeltas[i];
  });
  return { totals, all };
};

// --- Page ---
const b = await connect({ port, width: 1400, height: 1000, horlogeVariable: true });
const { send, evaluate, go, settle, waitFor, wait, blockNetwork, importFiles, close, logs } = b;
const tuiles = await fakeTiles(b, { delayMs: 50 });
await blockNetwork(BLOCKED_EXCEPT_TILES);
await send('Performance.enable');
await send('Profiler.enable');
await send('Profiler.setSamplingInterval', { interval: 500 });
// Tâches longues, à l'heure réelle du navigateur (`startTime` de l'API) : l'horloge de la page est accélérée, pas elle.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const f = { longtasks: [] };
  Object.defineProperty(window, '__direct', { value: f, enumerable: false });
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) f.longtasks.push({ start: e.startTime, duration: e.duration }); })
      .observe({ type: 'longtask', buffered: true });
  } catch {}
})();` });

const metrics = async () => Object.fromEntries((await send('Performance.getMetrics')).result.metrics.map((m) => [m.name, m.value]));
const throttle = (rate) => send('Emulation.setCPUThrottlingRate', { rate });
const realNow = () => evaluate('window.__banc.now()');
const points = () => evaluate(`(() => {
  const s = [...document.querySelectorAll('span.num')].find((v) => v.previousElementSibling?.textContent.trim() === 'Points');
  return s ? Number(s.textContent.trim()) : null;
})()`);
const choose = (text) => evaluate(`(() => { const b = [...document.querySelectorAll('[role=radiogroup] button[role=radio]')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
/** Fond de la carte du direct : « Plan » ou « Satellite », par le bouton « Fond de carte » de la carte. */
const chooseBase = async (label) => {
  const sel = '.leaflet-container .map-base-switch__button';
  const done = await evaluate(`(async () => {
    const btn = document.querySelector(${JSON.stringify(sel)});
    if (!btn) return 'bouton absent';
    if (!document.querySelector('.map-base-switch__menu')) btn.click();
    await new Promise((r) => setTimeout(r, 300));
    const c = [...document.querySelectorAll('.map-base-switch__choice')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
    if (!c) return 'choix absent';
    c.click();
    return 'ok';
  })()`);
  await wait(1500);
  return done;
};
const tilesLoaded = () => evaluate(`[...document.querySelectorAll('.leaflet-tile-pane img.leaflet-tile')].filter((i) => i.complete && i.naturalWidth > 0).length`);

/** Tâches longues de la page entre deux heures réelles : nombre, total et plus longue (bornées à la fenêtre). */
const longTasks = async (t0, t1) => {
  const list = JSON.parse((await evaluate(`JSON.stringify(window.__direct.longtasks.filter((t) => t.start + t.duration > ${t0} && t.start < ${t1}))`)) ?? '[]');
  const durations = list.map((t) => Math.min(t.start + t.duration, t1) - Math.max(t.start, t0));
  return { count: durations.length, total: durations.reduce((a, x) => a + x, 0), max: durations.length ? Math.max(...durations) : 0 };
};

const rows = [];
let failure = null;

const runCase = async ({ nom, famille, activite, gpx }) => {
  const path = join(workDir, `direct-long-${nom}.gpx`);
  writeFileSync(path, gpx());
  diag(`${nom} : trace écrite`);
  await throttle(1);
  await go('/enregistrer', 6000);
  await waitFor(`document.querySelectorAll('input[type=radio]').length >= 2`, { timeout: 10000, label: 'page Enregistrer' });
  await choose(famille);
  if (activite) await choose(activite);
  await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click(); 'ok'`);
  await wait(300);
  await importFiles(path, 'input[type=file]');
  await settle({ max: 5000, label: 'trace rejouée chargée' });
  await evaluate(`(() => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === '1')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '1'); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
  await wait(100);

  // Rejeu à ×100 : les positions d'abord, jusqu'à 2 h 55.
  await evaluate(`window.__bancFacteur = ${FAST_FACTOR}; window.__bancFacteur`);
  const started = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Démarrer')); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
  if (started !== 'ok') return `${nom} : bouton « Démarrer » ${started}`;
  const t0 = Date.now();
  let n = 0;
  while (Date.now() - t0 < FAST_MAX_MS) {
    n = (await points()) ?? n;
    if (n >= FAST_UNTIL_POINTS) break;
    await wait(1000);
  }
  await evaluate('window.__bancFacteur = 1');
  const ffS = (Date.now() - t0) / 1000;
  diag(`${nom} : ${n} positions après ${fr(ffS, 0)} s de vrai temps (×${FAST_FACTOR})`);
  if (n < FAST_UNTIL_POINTS) return `${nom} : le rejeu accéléré n'a atteint que ${n} positions sur ${FAST_UNTIL_POINTS} en ${fr(ffS, 0)} s`;
  await wait(3000); // le temps de revenir à ×1 : minuteurs en cours, dernier calcul

  for (const rate of RATES) {
    await throttle(rate);
    for (const fond of FONDS) {
      const choice = await chooseBase(fond === 'plan' ? 'Plan' : 'Satellite');
      if (choice !== 'ok') return `${nom} : fond ${fond} : ${choice}`;
      // Mesure : sans profileur.
      const tuilesBefore = tuiles.stats().requests;
      const [r0, m0, p0] = [await realNow(), await metrics(), await points()];
      await wait(MEASURE_S * 1000);
      const [r1, m1, p1] = [await realNow(), await metrics(), await points()];
      const lt = await longTasks(r0, r1);
      const positions = p1 !== null && p0 !== null ? p1 - p0 : null;
      // Profil : 30 s de plus.
      await send('Profiler.start');
      const q0 = await points();
      await wait(PROFILE_S * 1000);
      const q1 = await points();
      const profile = (await send('Profiler.stop')).result?.profile;
      const groups = profile ? profileGroups(profile) : null;
      const row = {
        nom, fond, rate, positions, count: lt.count, total: lt.total, max: lt.max,
        blockedPerPos: positions > 0 ? lt.total / positions : null,
        taskPerPos: positions > 0 ? ((m1.TaskDuration - m0.TaskDuration) * 1000) / positions : null,
        scriptPerPos: positions > 0 ? ((m1.ScriptDuration - m0.ScriptDuration) * 1000) / positions : null,
        groups, profilePositions: q1 !== null && q0 !== null ? q1 - q0 : null,
        tiles: tuiles.stats().requests - tuilesBefore, tilesLoaded: await tilesLoaded(),
      };
      rows.push(row);
      diag(`${nom} ${fond} ×${rate} : ${positions} positions, ${lt.count} tâches longues (${fr(lt.total, 0)} ms, max ${fr(lt.max, 0)} ms), tâche ${fr(row.taskPerPos)} ms par position, ${row.tiles} requêtes de tuiles`);
      if (positions === null || positions < MEASURE_S / 2) return `${nom} ${fond} ×${rate} : ${positions} positions reçues en ${MEASURE_S} s (le rejeu n'avance plus ?)`;
      if (Date.now() - startedAt > PLAFOND_MS - 30_000) return 'plafond de temps presque atteint';
    }
  }
  await throttle(1);
  return null;
};

for (const c of [
  { nom: 'voile', famille: 'Voile', activite: null, gpx: sailGpx },
  { nom: 'course', famille: 'À pied', activite: 'Course', gpx: runGpx },
]) {
  failure = await runCase(c);
  if (failure) break;
}

// --- Tableau ---
const pctOf = (g, k) => (g && g.all > 0 ? `${((100 * g.totals[k]) / g.all).toFixed(0)} %` : '—');
console.log(`Direct après 2 h 55 de trace, horloge ×100 puis ×1 ; ${MEASURE_S} s de mesure puis ${PROFILE_S} s de profil par fond et par ralenti ; fausses tuiles.`);
console.log('| Sortie | Fond | CPU | positions | tâches longues (n / total / plus longue, ms) | bloqué par position (ms) | tâche par position (ms) | Leaflet | liveStats + kinematics (dont kinematics) | dénivelé, pente, énergie | React | carte (nos composants) | autres |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const g = r.groups;
  const direct = g && g.all > 0 ? `${((100 * (g.totals.kinematics + g.totals.direct)) / g.all).toFixed(0)} % (${pctOf(g, 'kinematics')})` : '—';
  console.log(`| ${r.nom} | ${r.fond} | ×${r.rate} | ${r.positions} | ${r.count} / ${fr(r.total, 0)} / ${fr(r.max, 0)} | ${fr(r.blockedPerPos, 2)} | ${fr(r.taskPerPos, 2)} | ${pctOf(g, 'leaflet')} | ${direct} | ${pctOf(g, 'denivele')} | ${pctOf(g, 'react')} | ${pctOf(g, 'carte')} | ${pctOf(g, 'autres')} |`);
}
if (rows.some((r) => r.groups && r.groups.all > 0 && r.groups.totals.autres / r.groups.all > 0.7)) {
  console.log('Note : plus de 70 % du profil reste « autres » : code minifié (noms perdus) ? Relancer sans FLUIDITE_MINIFIE.');
}
const errors = [...new Set(logs)].slice(0, 10);
if (errors.length) { console.log('--- console (erreurs, avertissements) ---'); errors.forEach((l) => console.log(l)); }
diag(`durée totale ${fr((Date.now() - startedAt) / 60_000)} min`);
console.log(failure ? `ÉCHEC : ${failure}` : 'Tout est passé.');
await close();
process.exit(failure ? 1 : 0);
