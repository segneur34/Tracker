// Banc de test : fluidité au téléphone, mesurée d'abord (lot 114). Une mesure, pas une preuve de neutralité : les
// durées changent à chaque passage (`sansCache` du registre), elles sont en secondes (le masque commun `N ms` les
// effacerait) et se lisent à l'œil, à vitesse normale puis processeur ralenti six fois (`Emulation.setCPUThrottlingRate`,
// comme un Android moyen) ; chaque mesure est prise trois fois, médiane retenue.
// Usage : node fluidite.mjs <port> <dossier de travail, chemin Windows>
// Sur un profil neuf, sans réseau. Variables : `FLUIDITE_MESURES=ouverture,quitter,seuil,zoom,resumes,demarrage` (sous-ensemble),
// `FLUIDITE_REPS=3`. Le script :
//  1. écrit une session de voile de 3 h à 5 Hz (54 000 points, bords, virements et empannages comme `make-gpx.mjs`),
//     la trace d'une heure de `make-gpx.mjs`, une course de 2 h à 1 Hz avec FC et altitude, et 30 sessions de voile
//     d'une heure à 1 Hz, et les importe par la page ;
//  2. ouverture de la longue session depuis la bibliothèque (navigation dans la page, comme au téléphone : les modules
//     sont déjà chargés) : temps jusqu'au titre, jusqu'à la trace sur la carte, jusqu'aux chiffres de « général » ;
//     plus longue tâche bloquante et total bloqué (tâches de plus de 50 ms, `PerformanceObserver` longtask) ; durée
//     de `DOMParser.parseFromString` (lecture du GPX) ; une prise de plus sous le profileur (`Profiler.start`) pour dire
//     où le temps part, par fonction ;
//  2 bis. quitter (lot 157) : la longue session ouverte depuis la bibliothèque, retour à la bibliothèque 100 ms plus tard,
//     avant que sa lecture ne finisse ; tâches longues de la page suivante, nombre et durée des `DOMParser` (attendu
//     depuis le lot 157 : aucun, la lecture abandonnée), et si « Lecture de la session… » a paru entre-temps ;
//  3. seuil d'activité changé dans l'onglet réglages de cette analyse : temps jusqu'aux chiffres refaits, jusqu'au calme
//     du DOM, tâches longues ;
//  4. zoom d'un graphe de la course (double-clic de `lib/graphes.mjs`, celui de `zoom-carte.mjs`), onglets graphiques et
//     cardio ouverts : script par geste (`Performance.getMetrics`), images par seconde pendant 1,5 s, tâches longues ;
//  5. mise à jour des résumés : les 30 fiches sont marquées d'une version de calcul antérieure (cache des fiches
//     effacé), la page est relancée sur l'accueil ; temps jusqu'aux 30 résumés refaits, tâches longues, et la latence
//     d'un mouvement de souris envoyé toutes les 300 ms pendant ce temps (la page répond-elle ?) ; une prise de plus
//     sous le profileur ;
//  6. démarrage : du chargement de `/` à l'accueil rendu, puis au premier répit d'une seconde sans tâche longue
//     (« interactif »), tâches longues et modules chargés sur 12 s ; avec le préchargement des pages
//     (`preloadPages` d'`App.tsx`), puis sans (`requestIdleCallback` neutralisé depuis le script, rien dans `src/`).
// Fin : un tableau des médianes (PC ×1 et ×6), à recopier dans le relevé du lot.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, connect } from './lib/cdp.mjs';
import { CHART, graphGestures } from './lib/graphes.mjs';

const [port, workDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node fluidite.mjs <port> <dossier de travail>');
  process.exit(1);
}
const MESURES = (process.env.FLUIDITE_MESURES ?? 'ouverture,quitter,seuil,zoom,resumes,demarrage').split(',').map((m) => m.trim());
const REPS = Math.max(1, Number(process.env.FLUIDITE_REPS ?? 3) || 3);
const RATES = [1, 6];

const b = await connect({ port, width: 1400, height: 1000 });
const { send, evaluate, go, settle, waitFor, wait, blockNetwork, importFiles, records, close, logs } = b;
const { doubleClick } = graphGestures(b);
await blockNetwork();
await send('Performance.enable');
await send('Profiler.enable');
await send('Profiler.setSamplingInterval', { interval: 500 });

// Script de page : tâches longues (API Long Tasks), durée de chaque `DOMParser.parseFromString`, latence des entrées
// (heure du traitement moins heure de l'événement), instant du premier rendu de l'accueil.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const f = { longtasks: [], domparser: [], inputs: [], homeAt: null };
  Object.defineProperty(window, '__fluidite', { value: f, enumerable: false });
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) f.longtasks.push({ start: e.startTime, duration: e.duration }); })
      .observe({ type: 'longtask', buffered: true });
  } catch {}
  const parse = DOMParser.prototype.parseFromString;
  DOMParser.prototype.parseFromString = function (text, type) {
    const t = performance.now();
    const doc = parse.call(this, text, type);
    f.domparser.push({ start: t, duration: performance.now() - t, size: typeof text === 'string' ? text.length : 0 });
    return doc;
  };
  for (const type of ['mousemove', 'click']) document.addEventListener(type, (e) => { f.inputs.push({ type, at: performance.now(), delay: performance.now() - e.timeStamp }); }, true);
  const mo = new MutationObserver(() => {
    if (f.homeAt === null && document.querySelector('.home-families')) { f.homeAt = performance.now(); mo.disconnect(); }
  });
  mo.observe(document, { subtree: true, childList: true });
})();` });

// --- Outils ---
const sec = (ms) => (ms == null || Number.isNaN(ms) ? '—' : `${(ms / 1000).toFixed(ms < 10000 ? 3 : 1).replace('.', ',')} s`);
const median = (list) => {
  const v = list.filter((x) => typeof x === 'number' && !Number.isNaN(x)).sort((x, y) => x - y);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};
const metrics = async () => Object.fromEntries((await send('Performance.getMetrics')).result.metrics.map((m) => [m.name, m.value]));
const throttle = (rate) => send('Emulation.setCPUThrottlingRate', { rate });
/** Tâches longues de la page entre `t0` et `t1` (heure de la page), bornées à la fenêtre : max, total, nombre, fin de la dernière. */
const longTasks = async (t0, t1) => {
  const list = (await evaluate(`JSON.stringify(window.__fluidite.longtasks.filter((t) => t.start + t.duration > ${t0} && t.start < ${t1}))`)) ?? '[]';
  const tasks = JSON.parse(list).map((t) => ({ start: Math.max(t.start, t0), end: Math.min(t.start + t.duration, t1) }));
  const durations = tasks.map((t) => t.end - t.start);
  return {
    max: durations.length ? Math.max(...durations) : 0,
    total: durations.reduce((a, x) => a + x, 0),
    count: tasks.length,
    lastEnd: tasks.length ? Math.max(...tasks.map((t) => t.end)) : null,
    tasks,
  };
};
const ltText = (lt) => `tâche max ${sec(lt.max)}, bloqué ${sec(lt.total)} (${lt.count})`;
/** Durée totale des `parseFromString` entre deux instants. */
const domParser = async (t0, t1) => evaluate(`window.__fluidite.domparser.filter((d) => d.start >= ${t0} && d.start < ${t1}).reduce((a, d) => a + d.duration, 0)`);
/** Nombre de `parseFromString` entre deux instants. */
const domParserCount = async (t0, t1) => evaluate(`window.__fluidite.domparser.filter((d) => d.start >= ${t0} && d.start < ${t1}).length`);
/** Navigation dans la page (pushState + popstate, ce que fait un lien de React Router), sans recharger les modules. */
const SPA_GO = (path) => `history.pushState({}, '', ${JSON.stringify(path)}); dispatchEvent(new PopStateEvent('popstate', { state: {} }));`;
/** Rangée « avancé » ouverte et onglets donnés ouverts (un onglet repris d'une session neuve se ferme : on le rouvre). */
const openTabs = async (labels) => {
  await evaluate(`document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]')?.click(); 'ok'`);
  await settle({ max: 1500 });
  for (const label of labels) {
    await evaluate(`(() => { const t = [...document.querySelectorAll('.an-tabs .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (t && t.getAttribute('aria-pressed') !== 'true') t.click(); })()`);
    await settle({ max: 2000 });
  }
  return evaluate(`[...document.querySelectorAll('.an-tabs .ui-tab[aria-pressed="true"]')].map((t) => t.textContent.trim()).join(', ')`);
};
const listOpfs = (path) => evaluate(`(async () => {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker');
  for (const p of ${JSON.stringify(path)}.split('/')) dir = await dir.getDirectoryHandle(p);
  const names = []; for await (const [name] of dir.entries()) names.push(name); return names.sort();
})()`);

/** Résumé d'un profil du processeur : temps propre par fonction (les plus coûteuses), temps inclus de fonctions suivies. */
const WATCHED = ['parseGpx', 'loadGpxContent', 'computeKinematics', 'buildCumulativeTrack', 'computeActivityMask', 'analyzeGpx', 'summarizeSession', 'withSummary',
  'detectManeuvers', 'estimateWind', 'calculateWindStats', 'pickTopWindows', 'summarizeManeuvers', 'runCompleteScan', 'hydrateSession', 'parseFromString'];
const profileSummary = (profile, top = 12) => {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + profile.timeDeltas[i]));
  const inclusive = new Map();
  const incl = (id) => {
    if (inclusive.has(id)) return inclusive.get(id);
    const n = nodes.get(id);
    let total = self.get(id) ?? 0;
    for (const c of n.children ?? []) total += incl(c);
    inclusive.set(id, total);
    return total;
  };
  for (const n of profile.nodes) incl(n.id);
  const short = (url) => {
    if (!url) return '';
    const m = url.match(/\/src\/(.*)$/);
    if (m) return `src/${m[1]}`;
    const nm = url.match(/node_modules\/(?:\.vite\/deps\/)?([^/?]+)/);
    if (nm) return `node_modules/${nm[1]}`;
    return url.split('/').pop().split('?')[0];
  };
  const name = (n) => n.callFrame.functionName || '(anonyme)';
  const idle = profile.nodes.filter((n) => name(n) === '(idle)').reduce((a, n) => a + (self.get(n.id) ?? 0), 0);
  const total = profile.timeDeltas.reduce((a, x) => a + x, 0) - idle;
  const bySelf = new Map();
  for (const n of profile.nodes) {
    if (name(n) === '(idle)') continue;
    const key = `${name(n)} ${short(n.callFrame.url)}${n.callFrame.url ? `:${n.callFrame.lineNumber + 1}` : ''}`;
    bySelf.set(key, (bySelf.get(key) ?? 0) + (self.get(n.id) ?? 0));
  }
  const pct = (us) => `${(100 * us / Math.max(1, total)).toFixed(0).padStart(3)} %`;
  const lines = [`  temps mesuré ${sec(total / 1000)} hors repos ; temps propre des fonctions les plus coûteuses :`];
  for (const [key, us] of [...bySelf].sort((a, b) => b[1] - a[1]).slice(0, top)) lines.push(`    ${pct(us)}  ${sec(us / 1000).padStart(9)}  ${key}`);
  // Temps inclus : une fonction suivie peut apparaître en plusieurs nœuds (appelants différents) ; on somme, sans compter un
  // nœud sous un autre nœud de même nom (récursion ou re-rendu).
  const watched = new Map();
  const under = new Set();
  const walk = (id, ancestors) => {
    const n = nodes.get(id);
    const nm = name(n);
    const isWatched = WATCHED.includes(nm);
    if (isWatched && !ancestors.has(nm)) watched.set(nm, (watched.get(nm) ?? 0) + inclusive.get(id));
    else if (isWatched) under.add(nm);
    const next = isWatched ? new Set([...ancestors, nm]) : ancestors;
    for (const c of n.children ?? []) walk(c, next);
  };
  const childIds = new Set(profile.nodes.flatMap((n) => n.children ?? []));
  const roots = profile.nodes.filter((n) => !childIds.has(n.id));
  for (const r of roots) walk(r.id, new Set());
  if (watched.size) {
    lines.push('  temps inclus (la fonction et ce qu\'elle appelle) :');
    for (const [nm, us] of [...watched].sort((a, b) => b[1] - a[1])) lines.push(`    ${pct(us)}  ${sec(us / 1000).padStart(9)}  ${nm}`);
  }
  return lines.join('\n');
};
const profileStart = () => send('Profiler.start');
const profileStop = async () => (await send('Profiler.stop')).result?.profile;

// --- 1. Traces ---
const R = 6_371_000;
/** Session de voile synthétique : bords de près et de portant, virements et empannages, vent du nord (le motif de `make-gpx.mjs`), à `hz` Hz pendant `seconds` s. */
const sailGpx = ({ hz, seconds, startMs, name, lat0 = 43.5, lon0 = 3.95 }) => {
  let lat = lat0, lon = lon0, t = 0;
  const dt = 1 / hz;
  const pts = [];
  const step = (heading, speed) => {
    const d = speed * dt;
    lat += (d * Math.cos(heading * Math.PI / 180)) / R * 180 / Math.PI;
    lon += (d * Math.sin(heading * Math.PI / 180)) / (R * Math.cos(lat * Math.PI / 180)) * 180 / Math.PI;
    pts.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><time>${new Date(startMs + Math.round(t * 1000)).toISOString()}</time><extensions><speed>${speed.toFixed(2)}</speed></extensions></trkpt>`);
    t += dt;
  };
  const leg = (h, s, n) => { for (let i = 0; i < n; i++) step(h + Math.sin(i / (7 * hz)) * 3, s + Math.sin(i / (5 * hz)) * 0.5); };
  const turn = (from, to, sMin, sMax, n) => {
    const diff = ((to - from + 540) % 360) - 180;
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      step((from + diff * f + 360) % 360, sMax - (sMax - sMin) * Math.sin(Math.PI * f));
    }
  };
  while (t < seconds) {
    for (let k = 0; k < 6 && t < seconds; k++) { leg(45, 7, 150 * hz); turn(45, 315, 3, 7, 6 * hz); leg(315, 7, 150 * hz); turn(315, 45, 3, 7, 6 * hz); }
    turn(45, 135, 6, 9, 5 * hz);
    for (let k = 0; k < 6 && t < seconds; k++) { leg(135, 9, 150 * hz); turn(135, 225, 6, 9, 6 * hz); leg(225, 9, 150 * hz); turn(225, 135, 6, 9, 6 * hz); }
    turn(135, 45, 6, 9, 5 * hz);
  }
  return { text: `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><type>wingfoil</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`, points: pts.length };
};
/** Course de 2 h à 1 Hz : boucles de 1 km autour de Montpellier, altitude ondulée, FC qui monte. */
const runGpx = ({ seconds, startMs }) => {
  const pts = [];
  let angle = 0;
  for (let k = 0; k < seconds; k++) {
    const speed = 3.25 + 1.25 * Math.sin(k / 300) + 0.3 * Math.sin(k / 17);
    angle += speed / 1000;
    const radius = 1000 + 150 * Math.sin(k / 900);
    const lat = 43.62 + ((radius * Math.cos(angle)) / R) * (180 / Math.PI);
    const lon = 3.86 + ((radius * Math.sin(angle)) / (R * Math.cos((43.62 * Math.PI) / 180))) * (180 / Math.PI);
    pts.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><ele>${(80 + 30 * Math.sin(k / 400)).toFixed(1)}</ele><time>${new Date(startMs + k * 1000).toISOString()}</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${Math.round(135 + 20 * Math.sin(k / 600) + k / 900)}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><name>Course 2 h</name><type>running</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
};

const T_LONG = Date.UTC(2026, 7, 1, 9, 0, 0);
const T_RUN = Date.UTC(2026, 8, 5, 8, 0, 0);
const longSail = sailGpx({ hz: 5, seconds: 3 * 3600, startMs: T_LONG, name: 'Voile 3 h 5 Hz' });
const longPath = join(workDir, 'fluidite-voile-3h.gpx');
writeFileSync(longPath, longSail.text);
console.log('trace voile longue    :', `${longSail.points} points à 5 Hz, 3 h, ${(longSail.text.length / 1e6).toFixed(1).replace('.', ',')} Mo`);
const hourPath = join(workDir, 'fluidite-voile-1h.gpx');
execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'make-gpx.mjs'), hourPath], { stdio: 'ignore' });
const runPath = join(workDir, 'fluidite-course-2h.gpx');
writeFileSync(runPath, runGpx({ seconds: 7200, startMs: T_RUN }));
const COUNT = 30;
const manyPaths = [];
for (let i = 0; i < COUNT; i++) {
  const p = join(workDir, `fluidite-voile-${String(i).padStart(2, '0')}.gpx`);
  writeFileSync(p, sailGpx({ hz: 1, seconds: 3600, startMs: Date.UTC(2026, 6, 1, 10, 0, 0) - i * 86_400_000, name: `Voile ${i}`, lat0: 43.5 + (i % 5) * 0.02, lon0: 3.9 + Math.floor(i / 5) * 0.02 }).text);
  manyPaths.push(p);
}

// --- Import ---
const MULTI = 'input[type=file][accept=".gpx"][multiple]:not([disabled])';
await go('/voile', 5000);
console.log('import voile          :', await importFiles([longPath, hourPath], MULTI));
await waitFor(async () => (await records()).length >= 2, { timeout: 60000, every: 500, label: 'fiches voile' });
await settle({ max: 5000, label: 'import voile' });
const sessionsAfterSail = await listOpfs('sessions');
const longFile = sessionsAfterSail.find((n) => n.endsWith('.gpx') && n.includes('2026-08-01'));
const longUrl = `/voile/analyse?session=${encodeURIComponent(longFile ?? '')}`;
console.log('session longue        :', longFile ?? '(absente)');
const CURRENT = (await records()).find((r) => r.gpx === longFile)?.summary?.calcVersion ?? null;
console.log('version du calcul     :', CURRENT);

await go('/course', 5000);
console.log('import course         :', await importFiles(runPath, MULTI));
await waitFor(async () => (await records()).length >= 3, { timeout: 60000, every: 500, label: 'fiche course' });
await settle({ max: 5000, label: 'import course' });
const runFile = (await listOpfs('sessions')).find((n) => n.endsWith('.gpx') && n.includes('2026-09-05'));
const runUrl = `/course/analyse?session=${encodeURIComponent(runFile ?? '')}`;
console.log('session course        :', runFile ?? '(absente)');

const results = {}; // nom de la mesure → { 1: {...médianes}, 6: {...} }

// --- 2. Ouverture d'une session voile ---
const openLong = async ({ profile = false } = {}) => {
  if (profile) await profileStart();
  const before = await metrics();
  const out = await evaluate(`new Promise((resolve) => {
    const t0 = performance.now();
    ${SPA_GO(longUrl)}
    const out = { t0, titre: null, trace: null, chiffres: null };
    const tick = () => {
      const now = performance.now();
      if (out.titre === null && document.querySelector('.an-page h1')?.textContent.trim()) out.titre = now - t0;
      if (out.trace === null && document.querySelector('.an-map-frame .leaflet-trace-pane canvas')) out.trace = now - t0;
      if (out.chiffres === null) {
        const v = [...document.querySelectorAll('.an-sheet__stats .an-sheet__stat-value')];
        if (v.length >= 3 && v.every((x) => /\\d/.test(x.textContent))) out.chiffres = now - t0;
      }
      if ((out.titre !== null && out.trace !== null && out.chiffres !== null) || now - t0 > 120000) { out.t1 = now; resolve(out); }
      else setTimeout(tick, 16);
    };
    tick();
  })`);
  // La page finit son travail (manœuvres, vent, carte) : on attend le calme, puis une seconde, avant de relever les tâches.
  await settle({ max: 8000, quiet: 300, label: 'ouverture' });
  await wait(1000);
  const tEnd = await evaluate('performance.now()');
  const after = await metrics();
  const lt = await longTasks(out.t0, tEnd);
  const dom = await domParser(out.t0, tEnd);
  const prof = profile ? await profileStop() : null;
  const r = { titre: out.titre, trace: out.trace, chiffres: out.chiffres, max: lt.max, total: lt.total, count: lt.count,
    libre: lt.lastEnd === null ? 0 : lt.lastEnd - out.t0, dom, script: (after.ScriptDuration - before.ScriptDuration) * 1000, prof };
  // Retour à la bibliothèque (navigation dans la page) : l'analyse démontée, la liste rendue (sous ralenti, React peut
  // n'avoir rien rendu quand `settle` voit un DOM immobile).
  await evaluate(`${SPA_GO('/voile')} 'ok'`);
  await waitFor(`!document.querySelector('.an-page') && document.querySelectorAll('.lib-row').length >= 2`, { timeout: 30000, every: 50, label: 'bibliothèque rendue' });
  await settle({ max: 10000, label: 'retour bibliothèque' });
  return r;
};
const openText = (r) => `titre ${sec(r.titre)} | trace ${sec(r.trace)} | chiffres ${sec(r.chiffres)} | fil libre à ${sec(r.libre)} | ${ltText(r)} | DOMParser ${sec(r.dom)} | script ${sec(r.script)}`;

if (MESURES.includes('ouverture')) {
  console.log('\n== Ouverture de la session de voile (3 h à 5 Hz) depuis la bibliothèque, onglets par défaut ==');
  await go('/voile', 5000);
  await waitFor(`document.querySelectorAll('.lib-row').length >= 2`, { timeout: 10000, label: 'bibliothèque' });
  await throttle(1);
  await openLong(); // chauffe : modules de l'analyse chargés
  results.ouverture = {};
  for (const rate of RATES) {
    await throttle(rate);
    const runs = [];
    for (let k = 0; k < REPS; k++) {
      const r = await openLong();
      runs.push(r);
      console.log(`×${rate} essai ${k + 1} : ${openText(r)}`);
    }
    const med = Object.fromEntries(['titre', 'trace', 'chiffres', 'libre', 'max', 'total', 'dom', 'script'].map((k) => [k, median(runs.map((r) => r[k]))]));
    med.count = median(runs.map((r) => r.count));
    results.ouverture[rate] = med;
    console.log(`×${rate} médiane : ${openText(med)}`);
    const p = await openLong({ profile: true });
    console.log(`×${rate} sous le profileur : chiffres ${sec(p.chiffres)}, ${ltText(p)}`);
    if (p.prof) console.log(profileSummary(p.prof));
  }
  await throttle(1);
}

// --- 2 bis. Quitter l'analyse pendant la lecture ---
/** Ouvre la longue session, revient à la bibliothèque 100 ms plus tard (minuterie de la page), puis relève la suite. */
const quitLong = async () => {
  const out = await evaluate(`new Promise((resolve) => {
    const t0 = performance.now();
    ${SPA_GO(longUrl)}
    const out = { t0, lecture: null, quitte: null };
    const tick = () => {
      const now = performance.now();
      if (out.lecture === null && [...document.querySelectorAll('.an-page p')].some((p) => p.textContent.includes('Lecture de la session'))) out.lecture = now - t0;
      if (now - t0 >= 100) {
        ${SPA_GO('/voile')}
        out.quitte = now - t0;
        resolve(out);
      } else setTimeout(tick, 5);
    };
    tick();
  })`);
  await waitFor(`!document.querySelector('.an-page') && document.querySelectorAll('.lib-row').length >= 2`, { timeout: 30000, every: 50, label: 'bibliothèque rendue' });
  // Une lecture non abandonnée finit après le retour : on lui laisse le temps (fichier relu, puis texte lu).
  await settle({ max: 10000, quiet: 300, label: 'après le retour' });
  await wait(4000);
  const tEnd = await evaluate('performance.now()');
  const lt = await longTasks(out.t0, tEnd);
  return { lecture: out.lecture, quitte: out.quitte, max: lt.max, total: lt.total, count: lt.count,
    dom: await domParser(out.t0, tEnd), parses: await domParserCount(out.t0, tEnd) };
};
const quitText = (r) => `retour à ${sec(r.quitte)} | « Lecture de la session… » ${r.lecture === null ? 'non vue' : `à ${sec(r.lecture)}`} | DOMParser ${r.parses} (${sec(r.dom)}) | ${ltText(r)}`;

if (MESURES.includes('quitter')) {
  console.log('\n== Quitter la session de voile (3 h à 5 Hz) 100 ms après l\'avoir ouverte, retour à la bibliothèque ==');
  await go('/voile', 5000);
  await waitFor(`document.querySelectorAll('.lib-row').length >= 2`, { timeout: 10000, label: 'bibliothèque' });
  await throttle(1);
  await quitLong(); // chauffe : modules de l'analyse chargés
  results.quitter = {};
  for (const rate of RATES) {
    await throttle(rate);
    const runs = [];
    for (let k = 0; k < REPS; k++) {
      const r = await quitLong();
      runs.push(r);
      console.log(`×${rate} essai ${k + 1} : ${quitText(r)}`);
    }
    const med = Object.fromEntries(['quitte', 'max', 'total', 'count', 'dom', 'parses'].map((k) => [k, median(runs.map((r) => r[k]))]));
    med.lecture = median(runs.map((r) => r.lecture));
    results.quitter[rate] = med;
    console.log(`×${rate} médiane : ${quitText(med)}`);
  }
  await throttle(1);
}

// --- 3. Seuil d'activité changé en voile ---
if (MESURES.includes('seuil')) {
  console.log('\n== Seuil d\'activité changé dans l\'onglet réglages de la session de voile (3 h à 5 Hz) ==');
  await throttle(1);
  await go(longUrl, 30000);
  await waitFor(`document.querySelectorAll('.an-sheet__stats .an-sheet__stat-value').length >= 3`, { timeout: 60000, label: 'analyse' });
  // Tous les onglets qui dépendent du seuil (manœuvres, vent, VMG, tops, graphiques) : le pire cas, celui du point 197.
  console.log('onglets ouverts       :', await openTabs(['général', 'tops', 'manœuvres', 'graphiques', 'vent', 'vmg', 'réglages']));
  const INPUT = `document.querySelector('input[aria-label="Seuil d\\'activité"]')`;
  console.log('seuil de départ       :', await evaluate(`${INPUT}?.value ?? '(champ absent)'`));
  const changeThreshold = async (value) => {
    // La saisie part d'une tâche de la page (`setTimeout`), pas du `Runtime.evaluate` : React rend la saisie d'un coup,
    // dans la même tâche, et celle-ci n'est comptée parmi les tâches longues que si c'est une tâche ordinaire de la page.
    const out = await evaluate(`new Promise((resolve) => {
      const el = ${INPUT};
      if (!el) return resolve(null);
      let last = performance.now();
      const mo = new MutationObserver(() => { last = performance.now(); });
      mo.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
      const out = { t0: null, chiffres: null };
      const re = new RegExp('≥\\\\s*${value}(?:[,.]0)?\\\\s');
      const tick = () => {
        const now = performance.now();
        if (out.chiffres === null && [...document.querySelectorAll('.an-sheet__stat-label')].some((l) => re.test(l.textContent))) out.chiffres = now - out.t0;
        if ((out.chiffres !== null && now - last > 600) || now - out.t0 > 60000) { mo.disconnect(); out.calme = last - out.t0; out.t1 = now; resolve(out); }
        else setTimeout(tick, 16);
      };
      setTimeout(() => {
        out.t0 = performance.now();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(String(value))});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(tick, 0);
      }, 0);
    })`);
    if (!out) return null;
    const lt = await longTasks(out.t0, out.t1);
    return { chiffres: out.chiffres, calme: out.calme, max: lt.max, total: lt.total, count: lt.count };
  };
  const thText = (r) => (r ? `chiffres ${sec(r.chiffres)} | DOM calme à ${sec(r.calme)} | ${ltText(r)}` : '(champ absent)');
  await changeThreshold(12); // chauffe
  await wait(1500);
  results.seuil = {};
  let turn = 0; // 15 et 12 en alternance d'une prise à l'autre, quel que soit le ralenti
  for (const rate of RATES) {
    await throttle(rate);
    const runs = [];
    for (let k = 0; k < REPS; k++) {
      const r = await changeThreshold(turn++ % 2 === 0 ? 15 : 12);
      if (r) runs.push(r);
      console.log(`×${rate} essai ${k + 1} : ${thText(r)}`);
      await wait(1500);
    }
    const med = Object.fromEntries(['chiffres', 'calme', 'max', 'total', 'count'].map((k) => [k, median(runs.map((r) => r[k]))]));
    results.seuil[rate] = med;
    console.log(`×${rate} médiane : ${thText(med)}`);
  }
  await throttle(1);
  // Brouillon abandonné : la page suivante est chargée à neuf, le `confirm` est accepté d'office par la bibliothèque.
}

// --- 4. Zoom d'un graphe à pied ---
if (MESURES.includes('zoom')) {
  console.log('\n== Zoom d\'un graphe (double-clic) de la course de 2 h avec FC, onglets graphiques et cardio ouverts ==');
  await throttle(1);
  await evaluate(`(() => { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); s.running = { ...(s.running ?? {}), general: true, graphiques: true, cardio: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); return 'ok'; })()`);
  await go(runUrl, 30000);
  await waitFor(`document.querySelectorAll('.an-sheet__stats .an-sheet__stat-value').length >= 3`, { timeout: 60000, label: 'analyse course' });
  console.log('onglets ouverts       :', await openTabs(['général', 'graphiques', 'cardio']));
  const charts = await evaluate(`document.querySelectorAll('.an-carte-panels .zoom-chart').length`);
  console.log('graphes zoomables     :', charts);
  const FRAMES_MS = 1500;
  const zoomOnce = async () => {
    const before = await metrics();
    // Compteur d'images lancé dans la page, sans l'attendre : il court pendant le geste.
    await send('Runtime.evaluate', { expression: `(() => {
      const f = window.__fluidite;
      f.frames = { t0: performance.now(), n: 0, maxGap: 0, done: false };
      let prev = f.frames.t0;
      const loop = () => requestAnimationFrame((t) => { f.frames.n++; f.frames.maxGap = Math.max(f.frames.maxGap, t - prev); prev = t; if (t - f.frames.t0 < ${FRAMES_MS}) loop(); else { f.frames.t1 = t; f.frames.done = true; } });
      loop();
    })()`, returnByValue: true });
    const t0 = await evaluate('window.__fluidite.frames.t0');
    const r = await doubleClick('Graphiques', 0, 0.25, { settleMax: 8000 });
    await waitFor('window.__fluidite.frames.done', { timeout: 20000, every: 50 });
    const after = await metrics();
    const frames = await evaluate('JSON.stringify(window.__fluidite.frames)');
    const f = JSON.parse(frames);
    const lt = await longTasks(t0, t0 + FRAMES_MS);
    // Zoom rendu : « Tout voir » paraît ; puis on le clique pour la prise suivante.
    const buttons = await evaluate(`(() => { const c = ${CHART('Graphiques', 0)}; return c ? [...c.querySelectorAll('.zoom-chart__actions button')].map((b) => b.textContent.trim()).join(' | ') : '(absent)'; })()`);
    await evaluate(`(() => { const c = ${CHART('Graphiques', 0)}; const b = c ? [...c.querySelectorAll('.zoom-chart__actions button')].find((x) => x.textContent.trim() === 'Tout voir') : null; b?.click(); return Boolean(b); })()`);
    await settle({ max: 8000, label: 'tout voir' });
    return { geste: r, fps: (f.n * 1000) / (f.t1 - f.t0), gap: f.maxGap, script: (after.ScriptDuration - before.ScriptDuration) * 1000, max: lt.max, total: lt.total, count: lt.count, buttons };
  };
  const zoomText = (r) => `script ${sec(r.script)} | ${(r.fps ?? 0).toFixed(0)} images/s, image la plus longue ${sec(r.gap)} | ${ltText(r)}`;
  await zoomOnce(); // chauffe
  results.zoom = {};
  for (const rate of RATES) {
    await throttle(rate);
    const runs = [];
    for (let k = 0; k < REPS; k++) {
      const r = await zoomOnce();
      runs.push(r);
      console.log(`×${rate} essai ${k + 1} : ${zoomText(r)}${r.geste !== 'ok' ? ` (geste : ${r.geste})` : ''}${/Tout voir/.test(r.buttons) ? '' : ` (boutons : ${r.buttons})`}`);
    }
    const med = Object.fromEntries(['script', 'fps', 'gap', 'max', 'total', 'count'].map((k) => [k, median(runs.map((r) => r[k]))]));
    results.zoom[rate] = med;
    console.log(`×${rate} médiane : ${zoomText(med)}`);
  }
  await throttle(1);
}

// --- 5. Mise à jour des résumés ---
if (MESURES.includes('resumes') || MESURES.includes('demarrage')) {
  await throttle(1);
  await go('/voile', 5000);
  console.log('\nimport de 30 sessions :', await importFiles(manyPaths, MULTI));
  const got = await waitFor(async () => (await records()).length >= 3 + COUNT, { timeout: 240000, every: 1000, label: 'fiches des 30 sessions' });
  console.log('fiches                :', got ? 3 + COUNT : (await records()).length);
  await settle({ max: 10000, label: 'import des 30' });
  await wait(3000); // cache des fiches écrit (1 s après le dernier import)
}
/** Les fiches des 30 sessions marquées d'une version de calcul antérieure, cache des fiches effacé. */
const outdateRecords = () => evaluate(`(async () => {
  const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions');
  let n = 0;
  for await (const [name, h] of dir.entries()) {
    if (!name.endsWith('.json') || !/2026-0[67]-\\d\\d/.test(name)) continue;
    const text = await (await h.getFile()).text();
    const record = JSON.parse(text);
    if (!record.summary) continue;
    record.summary.calcVersion = 1;
    const w = await h.createWritable();
    await w.write(JSON.stringify(record));
    await w.close();
    n++;
  }
  localStorage.removeItem('tracker.libraryCache');
  return n;
})()`);
const upToDate = () => evaluate(`(async () => {
  const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions');
  let n = 0;
  for await (const [name, h] of dir.entries()) {
    if (!name.endsWith('.json') || !/2026-0[67]-\\d\\d/.test(name)) continue;
    try { if (JSON.parse(await (await h.getFile()).text()).summary?.calcVersion === ${CURRENT}) n++; } catch {}
  }
  return n;
})()`);
/** Relance la page sur `path` (document neuf) et rend la fonction qui dit si le document a changé. */
const reload = async (path) => {
  const before = await evaluate(`window.__banc?.doc ?? null`);
  await send('Page.navigate', { url: `${BASE}${path}` });
  await waitFor(async () => { const doc = await evaluate(`window.__banc?.doc ?? null`); return doc && doc !== before; }, { timeout: 30000, every: 20, label: 'nouveau document' });
};

if (MESURES.includes('resumes')) {
  console.log(`\n== Mise à jour des résumés de ${COUNT} sessions de voile (1 h à 1 Hz) au lancement, sur l'accueil ==`);
  const refreshOnce = async ({ profile = false } = {}) => {
    const n = await outdateRecords();
    await reload('/');
    if (profile) await profileStart();
    const tNav = await evaluate('performance.now()');
    // Sonde : un mouvement de souris toutes les 300 ms, sa latence relevée dans la page et l'aller-retour vu d'ici.
    let probing = true;
    const roundTrips = [];
    const probe = (async () => {
      let k = 0;
      while (probing) {
        const t = Date.now();
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1200 + (k++ % 7), y: 60, button: 'none' });
        roundTrips.push(Date.now() - t);
        await wait(300);
      }
    })();
    // Fin : les fiches toutes à la version courante (relues toutes les 500 ms, 30 petits fichiers).
    const t0 = Date.now();
    let done = false;
    while (Date.now() - t0 < 300000) {
      if ((await upToDate()) >= n) { done = true; break; }
      await wait(500);
    }
    const tEnd = await evaluate('performance.now()');
    probing = false;
    await probe;
    const prof = profile ? await profileStop() : null;
    const lt = await longTasks(0, tEnd);
    const inputs = JSON.parse((await evaluate(`JSON.stringify(window.__fluidite.inputs.filter((i) => i.type === 'mousemove').map((i) => i.delay))`)) ?? '[]');
    const dom = await domParser(0, tEnd);
    await settle({ max: 10000, label: 'après la mise à jour' });
    return { n, done, total: tEnd - tNav, max: lt.max, bloque: lt.total, count: lt.count, dom, latence: median(inputs), latenceMax: inputs.length ? Math.max(...inputs) : null,
      sondes: inputs.length, allerRetourMax: roundTrips.length ? Math.max(...roundTrips) : null, prof };
  };
  const refreshText = (r) => `${r.done ? '' : '(inachevée après 5 min) '}${r.n} résumés en ${sec(r.total)} | tâche max ${sec(r.max)}, bloqué ${sec(r.bloque)} (${r.count}) | DOMParser ${sec(r.dom)} | souris : latence médiane ${sec(r.latence)}, max ${sec(r.latenceMax)} (${r.sondes} sondes), aller-retour max ${sec(r.allerRetourMax)}`;
  await throttle(1);
  results.resumes = {};
  for (const rate of RATES) {
    await throttle(rate);
    const runs = [];
    for (let k = 0; k < REPS; k++) {
      const r = await refreshOnce();
      runs.push(r);
      console.log(`×${rate} essai ${k + 1} : ${refreshText(r)}`);
    }
    const med = Object.fromEntries(['total', 'max', 'bloque', 'count', 'dom', 'latence', 'latenceMax', 'sondes', 'allerRetourMax'].map((k) => [k, median(runs.map((r) => r[k]))]));
    med.n = runs[0].n;
    med.done = runs.every((r) => r.done);
    results.resumes[rate] = med;
    console.log(`×${rate} médiane : ${refreshText(med)}`);
    if (rate === 1) {
      const p = await refreshOnce({ profile: true });
      console.log(`×${rate} sous le profileur : ${p.n} résumés en ${sec(p.total)}, tâche max ${sec(p.max)}, bloqué ${sec(p.bloque)}`);
      if (p.prof) console.log(profileSummary(p.prof));
    }
  }
  await throttle(1);
}

// --- 6. Démarrage ---
if (MESURES.includes('demarrage')) {
  console.log('\n== Démarrage : chargement de `/` jusqu\'à l\'accueil, 33 sessions en mémoire, cache des fiches à jour ==');
  const WINDOW_MS = 12000;
  await throttle(1);
  await reload('/');
  await settle({ max: 20000, label: 'accueil, cache refait' });
  await wait(3000);
  let scripts = 0;
  const unlisten = b.onMessage((msg) => { if (msg.method === 'Network.requestWillBeSent' && msg.params.type === 'Script') scripts++; });
  const startOnce = async () => {
    scripts = 0;
    await reload('/');
    const m0 = await metrics();
    await wait(WINDOW_MS);
    const m1 = await metrics();
    const homeAt = await evaluate('window.__fluidite.homeAt');
    const lt = await longTasks(0, WINDOW_MS);
    // Interactif : premier instant, après l'accueil rendu, suivi d'une seconde sans tâche longue.
    let interactive = null;
    if (homeAt !== null) {
      const tasks = [...lt.tasks].sort((a, c) => a.start - c.start);
      let t = homeAt;
      for (;;) {
        const blocking = tasks.find((x) => x.end > t && x.start < t + 1000);
        if (!blocking) { interactive = t; break; }
        t = blocking.end;
        if (t > WINDOW_MS) break;
      }
    }
    return { rendu: homeAt, interactif: interactive, max: lt.max, total: lt.total, count: lt.count, script: (m1.ScriptDuration - m0.ScriptDuration) * 1000, modules: scripts };
  };
  const startText = (r) => `accueil rendu ${sec(r.rendu)} | interactif ${r.interactif == null ? '> 12 s' : sec(r.interactif)} | ${ltText(r)} | script ${sec(r.script)} | ${r.modules} modules chargés`;
  results.demarrage = {};
  let noPreload = null;
  for (const mode of ['avec préchargement', 'sans préchargement']) {
    if (mode === 'sans préchargement') {
      noPreload = (await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.requestIdleCallback = () => 0; window.cancelIdleCallback = () => {};` })).result.identifier;
    }
    results.demarrage[mode] = {};
    for (const rate of RATES) {
      await throttle(rate);
      const runs = [];
      for (let k = 0; k < REPS; k++) {
        const r = await startOnce();
        runs.push(r);
        console.log(`${mode}, ×${rate} essai ${k + 1} : ${startText(r)}`);
      }
      const med = Object.fromEntries(['rendu', 'interactif', 'max', 'total', 'count', 'script', 'modules'].map((k) => [k, median(runs.map((r) => r[k]))]));
      if (runs.some((r) => r.interactif == null)) med.interactif = null;
      results.demarrage[mode][rate] = med;
      console.log(`${mode}, ×${rate} médiane : ${startText(med)}`);
    }
  }
  if (noPreload) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: noPreload });
  unlisten();
  await throttle(1);
}

// --- Tableau des médianes ---
console.log('\n== Tableau des médianes (PC) ==');
console.log('| Mesure | ×1 | ×6 |');
console.log('|---|---|---|');
const row = (label, f) => console.log(`| ${label} | ${f(1)} | ${f(6)} |`);
if (results.ouverture) {
  const o = results.ouverture;
  row('Ouverture voile 3 h 5 Hz : titre / trace / chiffres', (r) => `${sec(o[r].titre)} / ${sec(o[r].trace)} / ${sec(o[r].chiffres)}`);
  row('Ouverture : tâche max / bloqué / fil libre à', (r) => `${sec(o[r].max)} / ${sec(o[r].total)} / ${sec(o[r].libre)}`);
  row('Ouverture : DOMParser (lecture du GPX)', (r) => sec(o[r].dom));
}
if (results.quitter) {
  const q = results.quitter;
  row('Quitter à 100 ms : DOMParser (nombre, durée) / tâche max / bloqué', (r) => `${q[r].parses} (${sec(q[r].dom)}) / ${sec(q[r].max)} / ${sec(q[r].total)}`);
}
if (results.seuil) {
  const s = results.seuil;
  row('Seuil changé : chiffres / DOM calme', (r) => `${sec(s[r].chiffres)} / ${sec(s[r].calme)}`);
  row('Seuil changé : tâche max / bloqué', (r) => `${sec(s[r].max)} / ${sec(s[r].total)}`);
}
if (results.zoom) {
  const z = results.zoom;
  row('Zoom graphe course 2 h : script / images par s / image max', (r) => `${sec(z[r].script)} / ${(z[r].fps ?? 0).toFixed(0)} / ${sec(z[r].gap)}`);
  row('Zoom : tâche max / bloqué', (r) => `${sec(z[r].max)} / ${sec(z[r].total)}`);
}
if (results.resumes) {
  const s = results.resumes;
  row(`Résumés de ${COUNT} sessions : total / tâche max / bloqué`, (r) => `${sec(s[r].total)} / ${sec(s[r].max)} / ${sec(s[r].bloque)}`);
  row('Résumés : latence souris médiane / max', (r) => `${sec(s[r].latence)} / ${sec(s[r].latenceMax)}`);
}
if (results.demarrage) {
  for (const mode of Object.keys(results.demarrage)) {
    const d = results.demarrage[mode];
    row(`Démarrage ${mode} : accueil / interactif`, (r) => `${sec(d[r].rendu)} / ${d[r].interactif == null ? '> 12 s' : sec(d[r].interactif)}`);
    row(`Démarrage ${mode} : tâche max / bloqué (12 s) / modules`, (r) => `${sec(d[r].max)} / ${sec(d[r].total)} / ${d[r].modules}`);
  }
}

console.log('\n--- console (erreurs, avertissements) ---');
[...new Set(logs)].slice(0, 10).forEach((l) => console.log(l));
await close();
process.exit(0);
