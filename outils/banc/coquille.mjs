// Banc de test : mise en page commune des analyses (`AnalysisShell`, lot 65), relevée pour sa neutralité.
// Usage : node coquille.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau (IGN, Overpass, tuiles bloqués). Dure environ 1 min (lib/cdp.mjs). Le script ne vérifie
// presque rien : il relève, pour comparer la sortie avant et après.
//  1. importe une wing, une course, une sortie à vélo, une session de surf (traces de `general.mjs`), une séance de
//     muscu avec la FC (`muscu.mjs`) et une sans FC ;
//  2. pour chaque analyse (les cinq sessions, la muscu sans FC, `/voile/analyse`, `/course/analyse`, `/surf/analyse` et
//     `/fractionne/analyse` sans session, une session introuvable en voile et en course), à 1400×1000, 390×844 et
//     834×375 (carte en plein écran refermée) : le texte de `.an-page`, la classe de chacun de ses enfants, et les
//     rectangles arrondis de `.an-page`, `.an-sheet`, `.an-map-row`, `.an-map-panel`, `.ui-savebar`, `.ui-alert`,
//     `.an-carte-col` ;
//  3. brouillon : en voile et en course, un commentaire écrit dans l'onglet des notes, puis le même relevé (barre
//     « Enregistrer la session »), puis « Annuler ».
import { BLOCKED_URLS, connect } from './lib/cdp.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node coquille.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go: goRaw, settle, waitFor, wait, blockNetwork, importGpx, records, shoot, check, finish, logs } = await connect({ port, width: 1400, height: 1000, shotDir });
/** Navigation, puis attente du premier rendu de l'application. */
const go = async (path, max) => {
  const ms = await goRaw(path, max);
  await waitFor(`Boolean(document.querySelector('.shell-main'))`, { timeout: 5000, every: 50, label: 'premier rendu' });
  return ms;
};
await blockNetwork(BLOCKED_URLS);

// --- Tailles ---
const SIZES = [
  { w: 1400, h: 1000, mobile: false, name: 'PC' },
  { w: 390, h: 844, mobile: true, name: '390x844' },
  { w: 834, h: 375, mobile: true, name: '834x375' },
];
const setSize = async (s) => {
  await send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: s.mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: s.mobile, maxTouchPoints: 5 });
};

// --- Sessions synthétiques (celles de `general.mjs` et de `muscu.mjs`) ---
const gpxOf = (type, pts) => `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Banc</name><type>${type}</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
/** Wing : bords de près et de portant, virements et empannages, vent du nord. */
const wingGpx = (t0) => {
  let lat = 43.5, lon = 3.95, t = 0;
  const R = 6371000;
  const pts = [];
  const step = (heading, speed) => {
    lat += (speed * Math.cos(heading * Math.PI / 180)) / R * 180 / Math.PI;
    lon += (speed * Math.sin(heading * Math.PI / 180)) / (R * Math.cos(lat * Math.PI / 180)) * 180 / Math.PI;
    pts.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><time>${new Date(t0 + t * 1000).toISOString()}</time><extensions><speed>${speed.toFixed(2)}</speed></extensions></trkpt>`);
    t++;
  };
  const leg = (h, s, n) => { for (let i = 0; i < n; i++) step(h + Math.sin(i / 7) * 3, s + Math.sin(i / 5) * 0.5); };
  const turn = (from, to, sMin, sMax, n) => {
    const diff = ((to - from + 540) % 360) - 180;
    for (let i = 1; i <= n; i++) step((from + diff * (i / n) + 360) % 360, sMax - (sMax - sMin) * Math.sin(Math.PI * (i / n)));
  };
  for (let k = 0; k < 6; k++) { leg(45, 7, 150); turn(45, 315, 5, 7, 6); leg(315, 7, 150); turn(315, 45, 5, 7, 6); }
  turn(45, 135, 6, 9, 5);
  for (let k = 0; k < 6; k++) { leg(135, 9, 150); turn(135, 225, 6, 9, 6); leg(225, 9, 150); turn(225, 135, 6, 9, 6); }
  return gpxOf('wingfoil', pts);
};
/** Aller et retour vers l'est, en côte de `grade` à l'aller, à vitesse constante, avec altitude. */
const hillGpx = (type, seconds, speed, grade, t0) => {
  const lat = 43.7;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  const pts = [];
  const half = seconds / 2;
  for (let k = 0; k <= seconds; k++) {
    const m = (k <= half ? k : seconds - k) * speed;
    pts.push(`<trkpt lat="${(lat + (k > half ? 0.0002 : 0)).toFixed(7)}" lon="${(3.85 + m / mPerDegLon).toFixed(7)}"><ele>${(50 + grade * m).toFixed(1)}</ele><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>${speed}</speed></extensions></trkpt>`);
  }
  return gpxOf(type, pts);
};
// Surf : phases [durée en s, vitesse en m/s, cap].
const M_PER_DEG_LAT = 111_195;
const surfGpx = (startMs, phases) => {
  let lat = 43.4;
  let lon = 3.6;
  let t = 0;
  const pts = [];
  const push = (speed, heading) => pts.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><time>${new Date(startMs + t * 1000).toISOString()}</time>`
    + `<extensions><speed>${speed}</speed>${speed > 0 ? `<course>${heading}</course>` : ''}</extensions></trkpt>`);
  push(0, 0);
  for (const [s, speed, heading = 0] of phases) {
    for (let k = 0; k < s; k++) {
      lat += (speed * Math.cos((heading * Math.PI) / 180)) / M_PER_DEG_LAT;
      lon += (speed * Math.sin((heading * Math.PI) / 180)) / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
      t += 1;
      push(speed, heading);
    }
  }
  return gpxOf('surf', pts);
};
const MORNING = [
  [60, 0], [60, 1.2], [50, 1], [4, 0.1], [40, 1], [4, 0.1], [26, 1], [90, 0.1],
  [6, 1.6, 180], [12, 5, 200], [100, 1], [60, 0.1],
  [5, 1.5, 180], [6, 6, 160], [2, 6, 250], [2, 6, 120], [10, 6, 160], [40, 1],
  [5, 1.6, 180], [8, 4.5, 190], [80, 1], [30, 0.1],
];
/** Muscu : points sans position, à l'heure ; la FC si `hrAt` est donné. */
const muscuGpx = (t0, seconds, hrAt) => {
  const pts = [];
  for (let k = 0; k <= seconds; k += 2) {
    const hr = hrAt ? `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${Math.round(hrAt(k))}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>` : '';
    pts.push(`<trkpt><time>${new Date(t0 + k * 1000).toISOString()}</time>${hr}</trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1" `
    + `xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><name>Séance</name><type>muscu</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
};
const seriesHr = (k) => (k < 300 ? 90 + k / 10 : (k - 300) % 120 < 40 ? 150 + ((k - 300) % 120) / 2 : 165 - Math.min(60, ((k - 300) % 120) - 40) * 1);

const T_VOILE = Date.UTC(2026, 9, 5, 13, 0, 0);
const T_RUN = Date.UTC(2026, 9, 6, 8, 0, 0);
const T_BIKE = Date.UTC(2026, 9, 6, 14, 0, 0);
const T_SURF = Date.UTC(2026, 9, 7, 7, 0, 0);
const T_MUSCU = Date.UTC(2026, 9, 6, 17, 0, 0);
const T_MUSCU_SANS = Date.UTC(2026, 9, 8, 17, 0, 0);
const SESSIONS = [
  { key: 'voile', page: 'voile', start: T_VOILE, gpx: wingGpx(T_VOILE) },
  { key: 'course', page: 'course', start: T_RUN, gpx: hillGpx('running', 2400, 3, 0.03, T_RUN) },
  { key: 'velo', page: 'velo', start: T_BIKE, gpx: hillGpx('cycling', 3000, 7, 0.02, T_BIKE) },
  { key: 'surf', page: 'surf', start: T_SURF, gpx: surfGpx(T_SURF, MORNING) },
  { key: 'muscu', page: 'fractionne', start: T_MUSCU, gpx: muscuGpx(T_MUSCU, 1800, seriesHr) },
  { key: 'muscu-sans-fc', page: 'fractionne', start: T_MUSCU_SANS, gpx: muscuGpx(T_MUSCU_SANS, 1200, null) },
];

// --- 1. Import ---
const paths = {};
for (const s of SESSIONS) {
  await go(`/${s.page}`, 3000);
  console.log(`import ${s.key} :`, await importGpx(s.gpx, `${s.key}.gpx`));
  // L'écriture en mémoire ne touche ni au DOM ni au réseau : la fiche est attendue, puis sa réécriture différée.
  const rec = await waitFor(async () => (await records())?.find((r) => Math.abs((r.summary?.startMs ?? 0) - s.start) < 2000), { timeout: 8000, label: `fiche ${s.key}` });
  await settle({ max: 2000, label: `import ${s.key}` });
  check(`${s.key} rangée`, Boolean(rec));
  if (rec) paths[s.key] = `/${s.page}/analyse?session=${encodeURIComponent(rec.gpx ?? '')}`;
}

// --- Relevé d'une page, à la taille en cours ---
const MEASURE = `(() => {
  const page = document.querySelector('.an-page');
  if (!page) return null;
  const y = window.scrollY, x = window.scrollX;
  const rect = (el) => { const r = el.getBoundingClientRect(); return [r.left + x, r.top + y, r.width, r.height].map(Math.round).join(','); };
  const rects = ['.an-page', '.an-sheet', '.an-map-row', '.an-map-panel', '.ui-savebar', '.ui-alert', '.an-carte-col']
    .map((q) => q + ' ' + ([...page.parentElement.querySelectorAll(q)].filter((el) => el === page || page.contains(el)).map(rect).join(' | ') || '—'));
  const children = [...page.children].map((c) => c.tagName.toLowerCase() + (c.classList.length ? '.' + [...c.classList].join('.') : '')).join(' > ');
  return { children, rects, text: page.innerText.replace(/\\n+/g, ' / ') };
})()`;
/** Ferme la carte en plein écran ouverte en tournant le téléphone : on relève la page dessous. */
const closeOverlay = async () => {
  if (await evaluate(`(() => { const b = document.querySelector('.an-map-overlay__close'); if (!b) return false; b.click(); return true; })()`)) await settle({ max: 1200 });
};
const sweep = async (label) => {
  for (const s of SIZES) {
    await setSize(s);
    await settle({ max: 1500 });
    await closeOverlay();
    await evaluate(`window.scrollTo(0, 0)`);
    await wait(200);
    const m = await evaluate(MEASURE);
    console.log(`\n== ${label} @ ${s.name}`);
    if (!m) {
      console.log('(pas de .an-page)');
      continue;
    }
    console.log(`enfants : ${m.children}`);
    for (const r of m.rects) console.log(`rect ${r}`);
    console.log(`texte : ${m.text}`);
    if (s.mobile) await shoot(`coquille-${label.replace(/[^a-z0-9-]+/gi, '_')}-${s.name}`);
  }
  // Retour à l'ordinateur pour la page suivante (la carte du téléphone tourné se referme en le remettant droit).
  await setSize(SIZES[0]);
  await settle({ max: 1000 });
};

// --- 2. Les analyses ---
const PAGES = [
  ...SESSIONS.filter((s) => paths[s.key]).map((s) => ({ label: s.key, path: paths[s.key], ms: 8000 })),
  { label: 'voile sans session', path: '/voile/analyse', ms: 4000 },
  { label: 'course sans session', path: '/course/analyse', ms: 4000 },
  { label: 'surf sans session', path: '/surf/analyse', ms: 4000 },
  { label: 'fractionne sans session', path: '/fractionne/analyse', ms: 4000 },
  { label: 'voile introuvable', path: '/voile/analyse?session=introuvable.gpx', ms: 4000, alert: true },
  { label: 'course introuvable', path: '/course/analyse?session=introuvable.gpx', ms: 4000, alert: true },
];
for (const p of PAGES) {
  await setSize(SIZES[0]);
  await go(p.path, p.ms);
  if (p.alert) await waitFor(`Boolean(document.querySelector('.an-page .ui-alert'))`, { timeout: 6000, label: `${p.label} : alerte` });
  else await waitFor(`Boolean(document.querySelector('.an-page'))`, { timeout: 5000, label: p.label });
  await settle({ max: 1500 });
  await sweep(p.label);
}

// --- 3. Brouillon : la barre « Enregistrer la session » ---
const clickTab = (label) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!t) return 'absent';
  t.click();
  return 'ok';
})()`);
/** Écrit dans la première zone de texte des panneaux (commentaire de la session), comme une saisie. */
const typeNote = (text) => evaluate(`(() => {
  const t = document.querySelector('.an-carte-panels textarea');
  if (!t) return 'absent';
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(text)});
  t.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
for (const [key, notes] of [['voile', 'matos et conditions'], ['course', 'matériel et notes']]) {
  if (!paths[key]) continue;
  await setSize(SIZES[0]);
  await go(paths[key], 8000);
  await waitFor(`Boolean(document.querySelector('.an-carte-col'))`, { timeout: 5000, label: `${key} : onglets` });
  console.log(`\n${key} : avancé ${await clickTab('avancé')}, ${notes} ${await clickTab(notes)}`);
  await settle({ max: 1200 });
  console.log(`${key} : commentaire ${await typeNote('Essai du banc')}`);
  await settle({ max: 1200 });
  check(`${key} : barre du brouillon`, await evaluate(`Boolean(document.querySelector('.ui-savebar'))`));
  await sweep(`${key} brouillon`);
  console.log(`${key} : annuler ${await evaluate(`(() => { const b = [...document.querySelectorAll('.ui-savebar button')].find((x) => x.textContent.trim() === 'Annuler'); if (!b) return 'absent'; b.click(); return 'ok'; })()`)}`);
  await settle({ max: 1000 });
  await clickTab(notes);
  await clickTab('avancé');
  await settle({ max: 800 });
}

console.log(logs.length ? `\nconsole :\n${[...new Set(logs)].join('\n')}` : '\nconsole : aucune erreur');
await finish();
