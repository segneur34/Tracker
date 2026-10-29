// Banc de test : bouton « Note » de l'enregistrement et repères dans l'analyse (lot 3 des demandes du 10-14/10).
// Usage : node notes.mjs <port> <dossier de travail> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Dure environ 2 min. Pour chaque famille (Course, Voile, Surf), le script :
//  1. à 390×844, lance un rejeu ×1 d'une trace datée de maintenant, pose deux notes (« Note N posée », vibreur
//     relevé dans la console), vérifie que la page ne déborde pas, arrête et analyse ;
//  2. dans l'analyse : deux fanions sur la carte, la liste de « Général », « Voir » (fanion violet), un trait
//     par repère sur les graphes, deux repères dans la fiche ;
//  3. en Course seulement : nomme la note 1, supprime la note 2, « Enregistrer la session », relit la fiche,
//     recharge la page (la liste garde « Saut »), puis à 1400×1000.
import { writeFileSync } from 'node:fs';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node notes.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://localhost:5173';

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
    if (msg.params.type === 'debug' && /^\[bips\]/.test(text)) sounds.push(text);
    if (['error', 'warning'].includes(msg.params.type)) logs.push(`${msg.params.type}: ${text.split('\n')[0].slice(0, 300)}`);
  }
};
await new Promise((r) => { ws.onopen = r; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const go = async (path, ms = 3000) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
const holdStop = async () => {
  const down = await evaluate(`(() => { const b = [...document.querySelectorAll('button.ui-btn--danger')].find((x) => x.textContent.includes('Arrêter') && !x.disabled); if (!b) return 'absent'; window.__stopButton = b; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); return 'ok'; })()`);
  if (down !== 'ok') return down;
  await wait(2300);
  return evaluate(`(() => { const b = window.__stopButton; b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })); b.click(); return 'ok'; })()`);
};
const clickText = (text, selector = 'button') => evaluate(`(() => {
  const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
  if (!b) return 'absent'; if (b.disabled) return 'désactivé'; b.click(); return 'ok';
})()`);
const clickLabel = (label) => evaluate(`(() => { const b = document.querySelector('[aria-label=${JSON.stringify(label)}]'); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
const typeInto = (label, value) => evaluate(`(() => {
  const i = document.querySelector('input[aria-label=${JSON.stringify(label)}]');
  if (!i) return 'absent';
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(value)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return i.value;
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
const overflow = () => evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
const noteButton = () => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /^Note|^Pas encore/.test(x.textContent.trim())); return b ? b.textContent.trim() : '(absent)'; })()`);
const flags = () => evaluate(`[...document.querySelectorAll('.an-map-panel .leaflet-marker-icon')].filter((m) => /^\\d+$/.test(m.textContent.trim())).map((m) => m.textContent.trim() + (m.innerHTML.includes('#7b1fa2') ? ' (violet)' : '')).join(', ') || '(aucun)'`);
const marksList = () => evaluate(`(() => { const l = document.querySelector('.an-marks'); return l ? [...l.querySelectorAll('input')].map((i) => i.closest('div').innerText.replace(/\\n+/g, ' ') + ' [' + (i.value || i.placeholder) + ']').join(' | ') : '(pas de liste)'; })()`);
const refLines = () => evaluate(`document.querySelectorAll('.recharts-reference-line').length`);
const records = () => evaluate(`(async () => {
  const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions');
  const list = [];
  for await (const [name, h] of dir.entries()) if (name.endsWith('.json')) list.push({ name, record: JSON.parse(await (await h.getFile()).text()) });
  return list;
})()`);
const openTab = (label) => evaluate(`(() => { const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!t) return 'absent'; if (t.getAttribute('aria-pressed') !== 'true' && t.getAttribute('aria-selected') !== 'true') t.click(); return 'ok'; })()`);

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
await send('Network.setBlockedURLs', { urls: ['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*'] });

/** Trace de 30 s datée de maintenant, à `speedMs`, pour un rejeu ×1. */
const replayGpx = (family, speedMs) => {
  const t0 = Date.now();
  const lat = 43.55;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  const pts = [];
  for (let k = 0; k <= 30; k++) {
    pts.push(`<trkpt lat="${lat}" lon="${(3.9 + (k * speedMs) / mPerDegLon).toFixed(7)}"><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>${speedMs}</speed></extensions></trkpt>`);
  }
  const path = `${workDir}\\notes-${family}.gpx`;
  writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Rejeu</name><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`);
  return path;
};

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await go('/enregistrer', 4000);

for (const [family, speedMs, graphTab] of [['À pied', 3, 'graphiques'], ['Voile', 8, 'graphiques'], ['Surf', 4, 'graphiques']]) {
  console.log(`\n=== ${family} ===`);
  await go('/enregistrer');
  console.log('famille :', await clickText(family, '[aria-label=Famille] button'));
  await wait(300);
  await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click(); 'ok'`);
  await wait(300);
  await setFile('input[type=file][accept=".gpx"]', replayGpx(family, speedMs));
  await wait(500);
  await evaluate(`(() => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === '600')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '1'); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
  console.log('bouton Note au repos :', await noteButton());
  console.log('Démarrer :', await clickText('Démarrer'));
  await wait(5000);
  const before = sounds.length;
  console.log('Note :', await clickText('Note'), '→', await noteButton());
  console.log('vibreur :', sounds.slice(before).join(' | ') || '(rien)');
  await shoot(`notes-${family}-enregistrer`);
  console.log('débordement à 390 px :', await overflow());
  await wait(3500);
  console.log('retour revenu à :', await noteButton());
  await wait(8000);
  console.log('Note :', await clickText('Note'), '→', await noteButton());
  await wait(4000);
  console.log('Arrêter :', await holdStop());
  await wait(2500);
  console.log('Analyser :', await clickText('Analyser'));
  await wait(6000);
  console.log('page :', await evaluate('location.pathname + location.search'));
  console.log('fanions :', await flags());
  console.log('liste :', await marksList());
  console.log('Voir :', await clickText('Voir', '.an-marks button'), '| fanions :', await flags());
  console.log(`onglet ${graphTab} :`, await openTab(graphTab));
  await wait(1500);
  console.log('traits des graphes :', await refLines());
  await shoot(`notes-${family}-analyse`);
  const recs = await records();
  const rec = recs.map((r) => r.record).sort((a, b) => b.summary.startMs - a.summary.startMs)[0];
  console.log('fiche :', rec ? `${rec.sport}, ${rec.marks?.length ?? 0} repères (${rec.marks?.map((m) => `${new Date(m.timeMs).toISOString().slice(11, 19)} ${m.label}`).join(', ')})` : '(aucune)');

  if (family !== 'À pied') continue;
  // Nommer, supprimer, enregistrer.
  const analysis = await evaluate('location.pathname + location.search');
  console.log('nom :', await typeInto('Nom de la note 1', 'Saut'));
  console.log('supprimer la note 2 :', await clickLabel('Supprimer la note 2'));
  await wait(300);
  console.log('barre :', await evaluate(`document.querySelector('.an-save-bar, .session-save-bar')?.innerText.replace(/\\n+/g, ' ') ?? [...document.querySelectorAll('button')].find((b) => b.textContent === 'Enregistrer la session')?.closest('div')?.innerText.replace(/\\n+/g, ' ') ?? '(absente)'`));
  console.log('Enregistrer la session :', await clickText('Enregistrer la session'));
  await wait(1500);
  const saved = (await records()).find((r) => r.record.marks?.some((m) => m.label === 'Saut'))?.record;
  console.log('fiche après :', saved ? saved.marks.map((m) => m.label).join(', ') : '(nom absent)');
  await go(analysis, 4000);
  console.log('après rechargement, liste :', await marksList(), '| fanions :', await flags());
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await go(analysis, 4000);
  console.log('à 1400 px, liste :', await marksList(), '| débordement :', await overflow());
  await shoot('notes-course-ordinateur');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
}

console.log('\n--- console (erreurs, avertissements) ---');
logs.forEach((l) => console.log(l));
await send('Page.close').catch(() => undefined);
ws.close();
process.exit(0);
