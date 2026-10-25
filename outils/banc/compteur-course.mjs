// Banc de test : une sortie à pied enregistrée avec le compteur d'intervalles (demandes du 19/10, lot 2).
// Usage : node compteur-course.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Sur un profil neuf, sans réseau, environ 40 s. Le compteur est lancé depuis l'onglet Fractionné d'Enregistrer, puis
// une Course est enregistrée en rejeu ×10. Le script vérifie :
//  1. « Analyser » demande si la session passe en « Fractionné à pied » ;
//  2. oui : fiche en run-intervals, séances gardées, analyse ouverte dans le Fractionné, onglet « fractionné » ;
//  3. non : fiche en running, séances gardées quand même, analyse à pied sans onglet « fractionné ».
import { writeFileSync } from 'node:fs';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node compteur-course.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://127.0.0.1:4190';

// --- Protocole ---
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
const sounds = [];
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]}`);
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description).join(' ');
    if (msg.params.type === 'debug' && /^\[(bips|compteur)\]/.test(text)) sounds.push(text);
    if (['error', 'warning'].includes(msg.params.type)) logs.push(`${msg.params.type}: ${text.split('\n')[0].slice(0, 300)}`);
  }
};
await new Promise((r) => { ws.onopen = r; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const go = async (path, ms = 3000) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
// « Arrêter » se tient (appui long réglable, 2 s par défaut) : appui, attente, puis relâcher.
const holdStop = async () => {
  const down = await evaluate(`(() => { const b = [...document.querySelectorAll('button.ui-btn--danger')].find((x) => x.textContent.includes('Arrêter') && !x.disabled && !x.closest('.ivl')); if (!b) return 'absent'; window.__stopButton = b; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); return 'ok'; })()`);
  if (down !== 'ok') return down;
  await wait(2300);
  return evaluate(`(() => { const b = window.__stopButton; b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })); b.click(); return 'ok'; })()`);
};
const clickText = (text, selector = 'button') => evaluate(`(() => {
  const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)} || x.textContent.includes(${JSON.stringify(text)}));
  if (!b) return 'absent'; if (b.disabled) return 'désactivé'; b.click(); return 'ok';
})()`);
const setFile = async (selector, file) => {
  const { result: { root } } = await send('DOM.getDocument', { depth: -1 });
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId, files: [file] });
};
const shoot = async (name) => {
  if (!shotDir) return;
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};
const records = () => evaluate(`(async () => {
  const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions');
  const list = [];
  for await (const [name, h] of dir.entries()) if (name.endsWith('.json')) list.push({ name, record: JSON.parse(await (await h.getFile()).text()) });
  return list;
})()`);
const dialogs = [];
let answer = true;
const prevOnMessage = ws.onmessage;
ws.onmessage = (e) => {
  prevOnMessage(e);
  const msg = JSON.parse(e.data);
  if (msg.method === 'Page.javascriptDialogOpening') {
    dialogs.push(msg.params.message);
    void send('Page.handleJavaScriptDialog', { accept: answer });
  }
};
await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable'); await send('Network.enable');
// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
await send('Network.setBlockedURLs', { urls: ['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
await go('/');
let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'ÉCHEC'} ${label}${detail ? ' — ' + detail : ''}`); };

const recordCourse = async (tag, offsetMin) => {
  const t0 = Date.now() + offsetMin * 60000;
  const lat = 43.7;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  let meters = 0;
  const pts = [];
  for (let k = 0; k <= 30; k++) {
    if (k > 0) meters += 3;
    pts.push(`<trkpt lat="${lat}" lon="${(3.85 + meters / mPerDegLon).toFixed(7)}"><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>3</speed></extensions></trkpt>`);
  }
  const path = `${workDir}\\lot2-${tag}.gpx`;
  writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Rejeu</name><type>running</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`);
  await go('/enregistrer');
  console.log(`[${tag}] famille Entraînement :`, await clickText('Entraînement'));
  await wait(300);
  console.log(`[${tag}] Lancer le compteur :`, await clickText('Lancer le compteur'));
  await wait(500);
  console.log(`[${tag}] onglet À pied :`, await clickText('À pied'));
  await wait(300);
  await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click(); 'ok'`);
  await wait(300);
  await setFile('input[type=file][accept=".gpx"]', path);
  await wait(500);
  await evaluate(`(() => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === '600')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '10'); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
  console.log(`[${tag}] Démarrer :`, await clickText('Démarrer'));
  await wait(6000);
  console.log(`[${tag}] Arrêter :`, await holdStop());
  await wait(2500);
  // Le compteur d'abord arrêté et fermé, pour la session suivante.
  await evaluate(`(async () => { const b = document.querySelector('.ivl button.ui-btn--danger'); if (!b) return 'absent'; const ev = (t) => b.dispatchEvent(new PointerEvent(t, { bubbles: true, button: 0, pointerType: 'mouse' })); ev('pointerdown'); await new Promise((r) => setTimeout(r, 1200)); ev('pointerup'); b.click(); return 'ok'; })()`);
  await wait(300);
  const before = dialogs.length;
  console.log(`[${tag}] Analyser :`, await clickText('Analyser'));
  await wait(6000);
  return dialogs.slice(before);
};

// Oui : rangée en Fractionné à pied, ouverte dans le Fractionné, onglet « fractionné ».
answer = true;
const asked = await recordCourse('oui', -30);
check('question posée à « Analyser »', asked.length === 1 && asked[0].includes('Fractionné à pied'), asked.join(' | '));
let tabs = await evaluate(`[...document.querySelectorAll('.an-carte-col .ui-tab')].map((t) => t.textContent).join(', ')`);
check('oui : ouverte dans le Fractionné, onglet fractionné', (await evaluate('location.pathname')).startsWith('/fractionne') && /fractionné/.test(tabs ?? ''), `${await evaluate('location.pathname')} | ${tabs}`);
let recs = await records();
const yes = recs.find((r) => r.name.includes('run-intervals') || r.record.sport === 'run-intervals');
check('oui : fiche en run-intervals, séances gardées', yes?.record.sport === 'run-intervals' && (yes.record.intervals?.length ?? 0) > 0,
  JSON.stringify(recs.map((r) => [r.name, r.record.sport, r.record.activityId, r.record.intervals?.length ?? 0])));

// Non : reste en Course, sans onglet « fractionné », séances gardées dans la fiche.
answer = false;
const asked2 = await recordCourse('non', -10);
check('question posée de nouveau', asked2.length === 1, asked2.join(' | '));
tabs = await evaluate(`[...document.querySelectorAll('.an-carte-col .ui-tab')].map((t) => t.textContent).join(', ')`);
check('non : ouverte à pied, sans onglet fractionné', (await evaluate('location.pathname')).startsWith('/course') && !/fractionné/.test(tabs ?? ''), `${await evaluate('location.pathname')} | ${tabs}`);
recs = await records();
const no = recs.filter((r) => r.record.sport === 'running');
check('non : fiche en running, séances gardées', no.length === 1 && (no[0].record.intervals?.length ?? 0) > 0,
  JSON.stringify(recs.map((r) => [r.name, r.record.sport, r.record.activityId, r.record.intervals?.length ?? 0])));
await shoot('lot2-non');

console.log('--- console ---');
for (const l of logs) console.log(l);
console.log(fails === 0 ? 'tout est passé' : `${fails} échec(s)`);
ws.close();
