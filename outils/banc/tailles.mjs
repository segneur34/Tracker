// Banc de test : relevé de toutes les pages à toutes les tailles de téléphone (lot 5 des demandes du 23/10).
// Usage : node tailles.mjs <port> <dossier de travail> [<dossier des captures>]
// Sur un profil neuf, sans réseau (IGN, Overpass, tuiles bloqués), environ 8 à 12 min. Le script ne corrige rien : il relève.
//  1. importe une session de chaque famille (voile, course, vélo, surf) par la page ;
//  2. pour chaque page (accueil, bibliothèques, analyses onglets tous ouverts, Entraînement et ses tests, Enregistrer,
//     Planifier, Itinéraires, Statistiques, Profil, Réglages tout ouvert), la charge une fois puis la fait passer par
//     chaque taille d'écran (changement de la taille émulée, sans recharger) et chaque taille de texte ;
//  3. à chaque combinaison, relève les défauts : page plus large que l'écran, élément qui en sort, texte coupé,
//     rangée qui défile et cache une partie de son contenu, cibles tactiles qui se recouvrent ; « … » voulus à part
//     (ellipse, non comptés) ; pour information, cibles de moins de 40 px et part de l'écran prise par les barres ;
//  4. écrit `rapport.md` et `rapport.json` dans le dossier de travail, une capture par page pour sa pire combinaison.
// Variables : BASE (serveur) ; SIZES (ex. « 320x640,390x844 ») pour n'en passer que quelques-unes ; FONTS (ex. « 1,1.3 ») ;
// PAGES (début de chemin ou partie du nom, ex. « profil,réglages ») pour ne relever que certaines pages ; sous Git Bash,
// un chemin qui commence par « / » demande MSYS_NO_PATHCONV=1.
// La largeur de l'écran est celle qu'on voit (`clientWidth`) : en émulation mobile, Chrome élargit `innerWidth` à ce
// qui déborde, et le débordement disparaîtrait de la mesure.
// Taille du texte d'Android (textZoom) : le navigateur n'a pas d'équivalent, la taille de chaque élément est multipliée
// (style en ligne), sur ce qui est affiché à ce moment-là.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node tailles.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}
mkdirSync(workDir, { recursive: true });
if (shotDir) mkdirSync(shotDir, { recursive: true });
const BASE = process.env.BASE ?? 'http://localhost:5173';

// --- Protocole ---
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]}`);
  if (msg.method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', { accept: true });
};
await new Promise((r) => { ws.onopen = r; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const go = async (path, ms) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
const importGpx = (gpx, name) => evaluate(`(() => {
  const input = document.querySelector('input[type=file][accept=".gpx"]');
  if (!input) return 'absent';
  const dt = new DataTransfer();
  dt.items.add(new File([${JSON.stringify(gpx)}], ${JSON.stringify(name)}, { type: 'application/gpx+xml' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);
const records = () => evaluate(`(async () => {
  const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions');
  const list = [];
  for await (const [name, h] of dir.entries()) if (name.endsWith('.json')) list.push(JSON.parse(await (await h.getFile()).text()));
  return list;
})()`);
const holdStop = async () => {
  const down = await evaluate(`(() => { const b = [...document.querySelectorAll('button.ui-btn--danger')].find((x) => x.textContent.includes('Arrêter') && !x.disabled && !x.closest('.ivl')); if (!b) return 'absent'; window.__stopButton = b; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); return 'ok'; })()`);
  if (down !== 'ok') return down;
  await wait(2300);
  return evaluate(`(() => { const b = window.__stopButton; b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })); b.click(); return 'ok'; })()`);
};
const setFile = async (selector, path) => {
  const { result: { root } } = await send('DOM.getDocument', { depth: -1 });
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId, files: [path] });
};

// --- Tailles ---
const SIZES_ALL = [
  { w: 1400, h: 1000, mobile: false, name: 'PC' },
  // 375×834 : le téléphone de l'utilisateur (POCO X7 Pro, 1220×2712 à 520 dpi, texte à 100 %), 834×375 tourné.
  { w: 320, h: 640, mobile: true }, { w: 360, h: 780, mobile: true }, { w: 375, h: 834, mobile: true }, { w: 390, h: 844, mobile: true },
  { w: 412, h: 915, mobile: true }, { w: 430, h: 932, mobile: true },
  { w: 640, h: 360, mobile: true }, { w: 780, h: 360, mobile: true }, { w: 834, h: 375, mobile: true }, { w: 844, h: 390, mobile: true }, { w: 915, h: 412, mobile: true },
];
const sizeLabel = (s) => s.name ?? `${s.w}x${s.h}`;
const SIZES = process.env.SIZES
  ? process.env.SIZES.split(',').map((t) => SIZES_ALL.find((s) => sizeLabel(s) === t.trim()) ?? { w: Number(t.split('x')[0]), h: Number(t.split('x')[1]), mobile: true })
  : SIZES_ALL;
const FONTS = (process.env.FONTS ?? '1,1.15,1.3').split(',').map(Number);
const setSize = async (s) => {
  await send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: s.mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: s.mobile, maxTouchPoints: 5 });
};

// --- Mesures, exécutées dans la page ---
const MEASURE = `(() => {
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const out = [];
  const short = (el) => {
    const cls = [...el.classList].filter((c) => !/^(ui-btn|ui-tab)$/.test(c)).slice(0, 2).map((c) => '.' + c).join('');
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').slice(0, 30);
    return el.tagName.toLowerCase() + cls + (own ? ' « ' + own + ' »' : '');
  };
  const skip = (el) => el.closest('.leaflet-container:not(.leaflet-control)') && !el.closest('.leaflet-control') || el.closest('svg') && el.tagName.toLowerCase() !== 'svg';
  const visible = (el, r) => {
    if (r.width <= 1 || r.height <= 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const clipsX = (el) => { const o = getComputedStyle(el).overflowX; return o !== 'visible'; };
  const clippedByAncestor = (el) => { for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) if (clipsX(p)) return true; return false; };
  const all = [...document.body.querySelectorAll('*')];
  // 1. page plus large que l'écran
  const over = document.documentElement.scrollWidth - vw;
  if (over > 1) out.push({ type: 'page', sel: 'document', detail: 'déborde de ' + over + ' px' });
  // 2. élément qui sort de l'écran sans être coupé ni défilant
  const exceeding = new Set();
  for (const el of all) {
    if (skip(el)) continue;
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    if (r.right > vw + 1 || r.left < -1) {
      if (clippedByAncestor(el)) continue;
      if (getComputedStyle(el).position === 'fixed' && r.width > vw) continue;
      exceeding.add(el);
    }
  }
  for (const el of exceeding) {
    if (el.parentElement && exceeding.has(el.parentElement)) continue;
    const r = el.getBoundingClientRect();
    out.push({ type: 'sort', sel: short(el), detail: Math.round(r.left) + '→' + Math.round(r.right) + ' sur ' + vw });
  }
  // 3. texte coupé
  for (const el of all) {
    if (skip(el)) continue;
    const cs = getComputedStyle(el);
    const hidden = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
    if (!hidden) continue;
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && (el.textContent ?? '').trim().length > 0 && !el.querySelector('canvas,svg,img'))
      out.push({ type: cs.textOverflow === 'ellipsis' ? 'ellipse' : 'coupe', sel: short(el), detail: el.scrollWidth + ' dans ' + el.clientWidth });
  }
  // 3 bis. rangée qui défile de côté et cache une partie de son contenu (pastilles, bouton glissant)
  for (const el of all) {
    if (skip(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') continue;
    const r = el.getBoundingClientRect();
    if (!visible(el, r) || el.closest('.leaflet-container')) continue;
    const panel = el.closest('.an-carte-panels > *')?.innerText.split(String.fromCharCode(10))[0].slice(0, 30);
    if (el.scrollWidth > el.clientWidth + 2) out.push({ type: 'defile', sel: short(el) + (panel ? ' (panneau ' + panel + ')' : ''), detail: el.scrollWidth + ' dans ' + el.clientWidth });
  }
  // 4. cibles qui se recouvrent, et cibles petites
  const inter = [...document.body.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch]')]
    .filter((el) => !skip(el) && !el.closest('.shell-tabbar, .shell-topbar, .shell-banners'))
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ el, r }) => visible(el, r) && r.top < vh && r.bottom > 0 && r.left < vw && r.right > 0);
  for (let i = 0; i < inter.length; i++) for (let j = i + 1; j < inter.length; j++) {
    const a = inter[i], b = inter[j];
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
    const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (w > 4 && h > 4) out.push({ type: 'recouvre', sel: short(a.el) + '  ×  ' + short(b.el), detail: Math.round(w) + '×' + Math.round(h) + ' px' });
  }
  // barre du bas : libellé plus large que sa case (caché exprès sous 340 px : rien ; coupé par « … » : ellipse)
  const tabs = [...document.querySelectorAll('.shell-tabbar > *')].map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.width > 1);
  for (const { el, r } of tabs) {
    const label = el.querySelector('span');
    if (!label || label.getBoundingClientRect().width <= 1) continue;
    const ellipsis = getComputedStyle(label).textOverflow === 'ellipsis' && label.scrollWidth > label.clientWidth;
    if (ellipsis) out.push({ type: 'ellipse', sel: 'barre du bas ' + short(el), detail: label.scrollWidth + ' dans ' + label.clientWidth });
    else if (label.scrollWidth > r.width) out.push({ type: 'coupe', sel: 'barre du bas ' + short(el), detail: label.scrollWidth + ' dans ' + Math.round(r.width) });
  }
  const small = inter.filter(({ el, r }) => Math.min(r.width, r.height) < 40 && !(el.matches('input[type=checkbox], input[type=radio]') && el.closest('label'))).length;
  // Surface prise par les barres (barre du bas ou rail du téléphone tourné, barre du haut, bandeaux), en part de l'écran.
  const bars = ['.shell-tabbar', '.shell-topbar', '.shell-banners'].reduce((n, q) => {
    const r = document.querySelector(q)?.getBoundingClientRect();
    return n + (r ? Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0)) : 0);
  }, 0);
  return { defects: out, small, chrome: Math.round((bars / (vw * vh)) * 100) };
})()`;

// Taille du texte : chaque élément reçoit sa taille calculée multipliée (restituée avant chaque nouvelle mesure).
const FONT_SCRIPT = (k) => `(() => {
  const els = [document.documentElement, ...document.body.querySelectorAll('*')];
  for (const el of els) if (el.__fs0 !== undefined) { el.style.fontSize = el.__fs0; delete el.__fs0; }
  if (${k} === 1) return 0;
  const sizes = els.map((el) => parseFloat(getComputedStyle(el).fontSize));
  els.forEach((el, i) => { el.__fs0 = el.style.fontSize; el.style.setProperty('font-size', (sizes[i] * ${k}).toFixed(2) + 'px', 'important'); });
  return els.length;
})()`;

// --- Sessions synthétiques (celles de general.mjs) ---
const gpxOf = (type, pts) => `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Banc</name><type>${type}</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
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
const M_PER_DEG_LAT = 111_195;
const surfGpx = (startMs, phases) => {
  let lat = 43.4, lon = 3.6, t = 0;
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
const T = { voile: Date.UTC(2026, 9, 5, 13), course: Date.UTC(2026, 9, 6, 8), velo: Date.UTC(2026, 9, 6, 14), surf: Date.UTC(2026, 9, 7, 7) };
const SESSIONS = [
  { key: 'voile', gpx: wingGpx(T.voile) },
  { key: 'course', gpx: hillGpx('running', 2400, 3, 0.03, T.course) },
  { key: 'velo', gpx: hillGpx('cycling', 3000, 7, 0.02, T.velo) },
  { key: 'surf', gpx: surfGpx(T.surf, MORNING) },
];

// --- Préparation ---
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('DOM.enable');
await send('Network.setBlockedURLs', { urls: ['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*', '*://server.arcgisonline.com/*'] });
// Rangée « avancé » des analyses rouverte d'office, comme dans les autres scripts : tous les onglets restent dans la barre.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
await setSize(SIZES_ALL[0]);

const paths = {};
for (const s of SESSIONS) {
  await go(`/${s.key === 'voile' ? 'voile' : s.key}`, 3000);
  const imported = await importGpx(s.gpx, `${s.key}.gpx`);
  await wait(6000);
  const rec = (await records()).find((r) => Math.abs((r.summary?.startMs ?? 0) - T[s.key]) < 2000);
  console.log(`import ${s.key} : ${imported}, rangée : ${Boolean(rec)}`);
  paths[s.key] = `/${s.key}/analyse?session=${encodeURIComponent(rec?.gpx ?? '')}`;
}

/** Ouvre tout ce qui se déplie (onglets de l'analyse, blocs, familles, activités, parties de Réglages). */
const OPEN_ALL = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let pass = 0; pass < 6; pass++) {
    const tabs = [...document.querySelectorAll('.an-carte-col .ui-tab')].filter((b) => b.getAttribute('aria-pressed') === 'false' && b.textContent.trim() !== 'avancé');
    const folds = [...document.querySelectorAll('[aria-expanded="false"]')].filter((b) => !b.classList.contains('an-tabs-advanced-toggle') && !b.hasAttribute('aria-haspopup') && !b.closest('.activity-select, .ui-more') && !b.closest('.shell-tabbar, .shell-topbar') && !/aide|help/i.test(b.getAttribute('aria-label') ?? ''));
    if (!tabs.length && !folds.length) break;
    for (const b of [...tabs, ...folds]) b.click();
    await wait(500);
  }
  return 'ok';
})()`;

const PAGES = [
  { name: 'accueil', path: '/' },
  { name: 'bibliothèque voile', path: '/voile' },
  { name: 'bibliothèque à pied', path: '/course' },
  { name: 'bibliothèque vélo', path: '/velo' },
  { name: 'bibliothèque surf', path: '/surf' },
  { name: 'analyse voile', path: paths.voile, open: true, ms: 7000 },
  { name: 'analyse course', path: paths.course, open: true, ms: 6000 },
  { name: 'analyse vélo', path: paths.velo, open: true, ms: 6000 },
  { name: 'analyse surf', path: paths.surf, open: true, ms: 6000 },
  { name: 'Entraînement', path: '/fractionne' },
  { name: 'séances', path: '/fractionne/seances' },
  { name: 'tests', path: '/fractionne/tests' },
  { name: 'test FC max', path: '/fractionne/tests/fc-max' },
  { name: 'test FC repos', path: '/fractionne/tests/fc-repos' },
  { name: 'enregistrer', path: '/enregistrer' },
  { name: 'planifier', path: '/itineraires', ms: 3500 },
  { name: 'itinéraires', path: '/itineraires/liste' },
  { name: 'statistiques', path: '/statistiques' },
  { name: 'profil', path: '/profil', ms: 3000 },
  { name: 'réglages (tout ouvert)', path: '/parametres', open: true },
].filter((p) => !process.env.PAGES || process.env.PAGES.split(',').some((q) => p.path.startsWith(q.trim()) || p.name.includes(q.trim())));

// --- Relevé ---
const report = []; // { page, size, font, defects, small, chrome }

async function sweep(page) {
  let best = -1;
  let bestShot = null;
  for (const s of SIZES) {
    await setSize(s);
    await wait(500);
    // Téléphone tourné : l'analyse s'ouvre sur sa carte en plein écran ; on mesure la page dessous, carte refermée.
    if (await evaluate(`(() => { const b = document.querySelector('.an-map-overlay__close'); if (!b) return false; b.click(); return true; })()`)) await wait(800);
    for (const k of FONTS) {
      if (s.name === 'PC' && k !== 1) continue;
      await evaluate(FONT_SCRIPT(k));
      await wait(250);
      const m = await evaluate(MEASURE);
      if (!m) { console.log("  mesure vide :", page.name, sizeLabel(s), k, JSON.stringify(await send("Runtime.evaluate", { expression: MEASURE, returnByValue: true }))?.slice(0, 400)); continue; }
      const row = { page: page.name, size: sizeLabel(s), font: k, defects: m.defects, small: m.small, chrome: m.chrome };
      report.push(row);
      const score = m.defects.filter((d) => d.type !== 'ellipse').length + (m.defects.some((d) => d.type === 'page') ? 100 : 0);
      if (shotDir && s.name !== 'PC' && score > best) {
        best = score;
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        bestShot = { data: shot.result.data, label: `${sizeLabel(s)}-x${k}` };
      }
    }
    await evaluate(FONT_SCRIPT(1));
  }
  if (bestShot && best > 0) writeFileSync(join(shotDir, `${page.name.replace(/[^\wéèêàç]+/g, '_')}_${bestShot.label}.png`), Buffer.from(bestShot.data, 'base64'));
  const bad = report.filter((r) => r.page === page.name && r.defects.some((d) => d.type !== 'ellipse') && r.size !== 'PC').length;
  console.log(`${page.name.padEnd(24)} ${bad} combinaison(s) avec défaut sur ${report.filter((r) => r.page === page.name && r.size !== 'PC').length}`);
}

for (const page of PAGES) {
  await setSize(SIZES_ALL[3]);
  await go(page.path, page.ms ?? 2500);
  if (page.open) { await evaluate(OPEN_ALL); await wait(800); }
  await sweep(page);
}

// Enregistrer en cours d'enregistrement (rejeu ×1 d'une course), les tailles passées sans recharger.
if (!process.env.PAGES || 'enregistrement'.includes(process.env.PAGES)) {
  const replay = join(workDir, 'rejeu.gpx');
  writeFileSync(replay, hillGpx('running', 600, 3, 0, Date.now() - 700_000));
  await setSize(SIZES_ALL[3]);
  await go('/enregistrer', 2500);
  await evaluate(`[...document.querySelectorAll('input[type=radio]')][1]?.click(); 'ok'`);
  await wait(300);
  await setFile('input[type=file]', replay);
  await wait(800);
  const started = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Démarrer')); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
  console.log('rejeu :', started);
  if (started === 'ok') {
    await wait(5000);
    await sweep({ name: 'enregistrement en cours' });
    await holdStop();
    await wait(1500);
    await sweep({ name: 'enregistrement terminé' });
  }
}

// --- Rapport ---
const sizeNames = [...new Set(report.map((r) => r.size))];
const pageNames = [...new Set(report.map((r) => r.page))];
let md = `# Relevé des tailles\n\nCombinaison = taille d'écran × taille du texte. Chaque case : nombre de défauts (page, sortie d'écran, texte coupé, recouvrement) ; \`!\` = la page entière déborde. Texte à 100 % puis 115 % puis 130 %.\n\n`;
md += `| page | ${sizeNames.join(' | ')} |\n|---|${sizeNames.map(() => '---').join('|')}|\n`;
for (const p of pageNames) {
  const cells = sizeNames.map((s) => {
    const rows = FONTS.map((k) => report.find((r) => r.page === p && r.size === s && r.font === k)).filter(Boolean);
    if (!rows.length) return '·';
    return rows.map((r) => (r.defects.some((d) => d.type === 'page') ? '!' : '') + r.defects.filter((d) => d.type !== 'ellipse').length).join('/');
  });
  md += `| ${p} | ${cells.join(' | ')} |\n`;
}
md += `\n## Défauts, par page\n`;
for (const p of pageNames) {
  const byKey = new Map();
  for (const r of report.filter((x) => x.page === p)) for (const d of r.defects) {
    const key = `${d.type} | ${d.sel}`;
    const e = byKey.get(key) ?? { d, where: [] };
    e.where.push(`${r.size}${r.font !== 1 ? `×${r.font}` : ''}${d.detail ? ` (${d.detail})` : ''}`);
    byKey.set(key, e);
  }
  if (!byKey.size) { md += `\n### ${p}\nRien.\n`; continue; }
  md += `\n### ${p}\n`;
  for (const [key, e] of [...byKey].sort((a, b) => b[1].where.length - a[1].where.length)) {
    const list = e.where.length > 6 ? `${e.where.slice(0, 6).join(', ')} … (${e.where.length} combinaisons)` : e.where.join(', ');
    md += `- **${key}** : ${list}\n`;
  }
}
md += `\n## Cibles tactiles de moins de 40 px (information) et part des barres\n\n| page | cibles < 40 px à 390x844 | barres / écran à 844x390 | barres / écran à 390x844 |\n|---|---|---|---|\n`;
for (const p of pageNames) {
  const at = (s) => report.find((r) => r.page === p && r.size === s && r.font === 1);
  md += `| ${p} | ${at('390x844')?.small ?? '·'} | ${at('844x390')?.chrome ?? '·'} % | ${at('390x844')?.chrome ?? '·'} % |\n`;
}
writeFileSync(join(workDir, 'rapport.md'), md);
writeFileSync(join(workDir, 'rapport.json'), JSON.stringify(report, null, 1));
console.log(`\nRapport : ${join(workDir, 'rapport.md')}`);
console.log('--- console (erreurs) ---');
[...new Set(logs)].slice(0, 10).forEach((l) => console.log(l));
await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
ws.close();
