// Banc de test : notification de l'enregistrement (§10, point 101).
// Usage : node notification.mjs <port> <dossier de travail, chemin Windows>
// Sur un profil neuf, sans réseau. Dure environ 1 min 30. La version navigateur de `platform/notification.ts`
// consigne chaque envoi en `console.debug` (« [notification] titre | texte [chronomètre] (seule) »). Le script vérifie :
//  1. Réglages : la notification, dans la partie Enregistrement de la carte Voile, deux menus, « défaut » ; la seconde ligne passée à
//     « Max (2 s) », rangée dans les réglages ;
//  2. un rejeu ×10 de voile : titre « Voile », chiffres choisis, chronomètre de durée, et au moins 5 s entre deux
//     envois sans changement d'état ;
//  3. pause manuelle : envoi immédiat, « en pause », durée figée, posé seul ; reprise : envoi immédiat sans « en pause » ;
//  4. arrêt : notification effacée ;
//  5. compteur du fractionné pendant un enregistrement (rejeu ×1 daté de maintenant) : phase au titre et décompte.
import { writeFileSync } from 'node:fs';

const [port, workDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node notification.mjs <port> <dossier de travail>');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://localhost:5173';

// --- Protocole ---
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
/** Envois de la notification, avec l'instant de réception. */
const sent = [];
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]}`);
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description).join(' ');
    if (msg.params.type === 'debug' && text.startsWith('[notification]')) sent.push({ atMs: Date.now(), text: text.slice('[notification] '.length) });
    if (['error', 'warning'].includes(msg.params.type)) logs.push(`${msg.params.type}: ${text.split('\n')[0].slice(0, 300)}`);
  }
};
await new Promise((r) => { ws.onopen = r; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const go = async (path, ms = 3000) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'ÉCHEC'} ${label}${detail ? ` — ${detail}` : ''}`);
};
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
const setSelect = (label, value) => evaluate(`(() => {
  const s = document.querySelector('select[aria-label=${JSON.stringify(label)}]');
  if (!s) return 'absent';
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(String(value))});
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return s.value;
})()`);
const setFile = async (selector, file) => {
  const { result: { root } } = await send('DOM.getDocument', { depth: -1 });
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId, files: [file] });
};
/** Rejeu d'un GPX à la vitesse donnée, depuis la page Enregistrer, la famille choisie. */
const startReplay = async (family, file, speed) => {
  await go('/enregistrer');
  await clickText(family, '.ui-tab');
  await wait(300);
  await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click(); 'ok'`);
  await wait(300);
  await setFile('input[type=file][accept=".gpx"]', file);
  await wait(500);
  await evaluate(`(() => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === '600')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(String(speed))}); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
  return clickText('Démarrer');
};
/** Trace à 1 Hz datée de maintenant : `n` points vers l'est, entre 1,5 et 4,5 m/s, pour que les chiffres changent. */
const nowTrace = (path, n, type) => {
  const t0 = Date.now();
  const lat = 43.7;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  const pts = [];
  let meters = 0;
  for (let k = 0; k < n; k++) {
    const v = 3 + 1.5 * Math.sin(k / 7);
    if (k > 0) meters += v;
    pts.push(`<trkpt lat="${lat}" lon="${(3.85 + meters / mPerDegLon).toFixed(7)}"><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>${v.toFixed(2)}</speed></extensions></trkpt>`);
  }
  writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Rejeu</name><type>${type}</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`);
};

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable'); await send('Network.enable');
await send('Network.setBlockedURLs', { urls: ['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// 1. Réglages : notification, dans la partie Enregistrement de la carte Voile.
await go('/parametres', 4000);
await evaluate(`(() => { const b = [...document.querySelectorAll('[role=button]')].find((el) => el.textContent.trim() === 'Activités'); if (b && !document.querySelector('.settings-activities')) b.click(); return 'ok'; })()`);
await wait(300);
// Familles repliées depuis le lot 2 des demandes du 15/10 : toutes ouvertes.
await evaluate(`document.querySelectorAll('.settings-activities__family-toggle[aria-expanded="false"]').forEach((b) => b.click()); 'ok'`);
await wait(300);
await evaluate(`(() => { const b = [...document.querySelectorAll('.settings-activity__toggle')].find((x) => x.textContent.trim().startsWith('Voile')); if (b && b.getAttribute('aria-expanded') !== 'true') b.click(); return 'ok'; })()`);
await wait(300);
// Depuis le 19/10, la notification est une sous-partie d'Enregistrement.
console.log('partie Enregistrement :', await clickText('Enregistrement', '.settings-part__toggle'));
await wait(300);
const notifRow = () => evaluate(`(() => {
  const part = [...document.querySelectorAll('.settings-part__sub')].find((p) => p.querySelector('.settings-part__subtitle')?.textContent.trim() === 'Notification');
  if (!part) return null;
  const selects = [...part.querySelectorAll('select')];
  return { menus: selects.length, values: selects.map((s) => s.options[s.selectedIndex]?.textContent ?? ''), text: part.innerText.replace(/\\n+/g, ' / ') };
})()`);
const before = await notifRow();
// Deux chiffres au plus depuis le 15/10 (Android coupe la ligne au-delà) : vitesse et distance par défaut.
check('deux menus, défaut vitesse, distance', before?.menus === 2 && before.values.join(',') === 'Vitesse,Distance' && before.text.includes('défaut'),
  JSON.stringify(before?.values));
await evaluate(`(() => {
  const part = [...document.querySelectorAll('.settings-part__sub')].find((p) => p.querySelector('.settings-part__subtitle')?.textContent.trim() === 'Notification');
  const s = part.querySelectorAll('select')[1];
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'max');
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return s.value;
})()`);
await wait(300);
const after = await notifRow();
const stored = await evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('tracker.sportSettings'))?.notificationFields)`);
check('seconde ligne « Max », rangée, plus « défaut »', after?.values[1]?.startsWith('Max') && !after.text.includes('défaut') && /"max"/.test(stored ?? ''), stored);

// 2. Rejeu ×10 de voile.
const sailPath = `${workDir}\\notification-voile.gpx`;
nowTrace(sailPath, 600, 'wingfoil');
const s0 = sent.length;
console.log('Démarrer :', await startReplay('Voile', sailPath, 10));
await wait(16000);
// Le chargement de la page efface une notification restée d'un arrêt brutal : hors du compte.
const run = sent.slice(s0).filter((s) => s.text !== 'effacée');
console.log('envois :', run.map((s) => s.text).slice(0, 4).join('\n        '));
check('titre et chiffres choisis', run.length > 0 && run.every((s) => s.text.startsWith('Voile | Vit. ') && s.text.includes(' · Max ')),
  run[run.length - 1]?.text);
check('chronomètre de durée', run.length > 0 && run.every((s) => s.text.includes('[durée ')));
// Les premiers envois partent tout de suite : départ, récriture à la première position (le service GPS vient de
// poser la sienne), premiers chiffres du direct. Ensuite, le rythme.
const steady = run.filter((s) => / Vit\. \d/.test(s.text));
const gaps = steady.slice(1).map((s, i) => s.atMs - steady[i].atMs);
check('5 s au moins entre deux envois', gaps.length >= 1 && gaps.every((g) => g >= 4900), `${run.length} envois, écarts ${gaps.join(', ')} ms`);

// 3. Pause manuelle, puis reprise.
let mark = sent.length;
console.log('Pause :', await clickText('Pause'));
await wait(800);
const paused = sent.slice(mark);
check('pause : envoi immédiat, « en pause », durée figée, posé seul', paused.length === 1 && /^Voile · en pause 0:\d\d:\d\d \| /.test(paused[0].text)
  && paused[0].text.endsWith('(seule)') && !paused[0].text.includes('[durée'), paused[0]?.text);
await wait(3000);
check('rien pendant la pause', sent.length === mark + 1);
mark = sent.length;
console.log('Reprendre :', await clickText('Reprendre'));
await wait(1500);
const resumed = sent.slice(mark);
check('reprise : envoi immédiat, sans « en pause »', resumed.length >= 1 && resumed[0].text.startsWith('Voile | Vit. ') && !resumed[0].text.includes('(seule)'),
  resumed.map((s) => s.text).join(' // '));

// 4. Arrêt.
mark = sent.length;
console.log('Arrêter :', await holdStop());
await wait(1500);
check('arrêt : notification effacée', sent.slice(mark).some((s) => s.text === 'effacée'), sent.slice(mark).map((s) => s.text).join(' // '));
console.log('Jeter :', await evaluate(`(() => { window.confirm = () => true; return 'ok'; })()`), await clickText('Jeter'));
await wait(800);

// 5. Compteur pendant un enregistrement de fractionné.
const runPath = `${workDir}\\notification-fractionne.gpx`;
nowTrace(runPath, 60, 'run-intervals');
console.log('Démarrer (fractionné, ×1) :', await startReplay('Fractionné', runPath, 1));
await wait(2500);
console.log('séance :', await setSelect('Répétitions', 2), await setSelect('Travail, minutes', 0), await setSelect('Travail, secondes', 10),
  await setSelect('Repos, minutes', 0), await setSelect('Repos, secondes', 5));
mark = sent.length;
console.log('Lancer :', await clickText('Lancer le compteur'));
await wait(6000);
const counter = sent.slice(mark).map((s) => s.text);
console.log('envois :', counter.join('\n        '));
check('phase au titre, au changement de phase', counter.some((t) => t.includes('· Départ |')) && counter.some((t) => t.includes('· Travail 1/2 |')));
check('décompte de la phase', counter.some((t) => t.includes('· Travail 1/2 |') && t.includes('[rebours ')));
console.log('Arrêter :', await holdStop());
await wait(1500);
await evaluate(`(() => { window.confirm = () => true; return 'ok'; })()`);
await clickText('Jeter');
await wait(500);
await clickText('Arrêter', '.ivl button');

console.log(logs.length ? `console :\n  ${logs.join('\n  ')}` : 'console : rien');
console.log(failures ? `${failures} échec(s)` : 'tout est bon');
ws.close();
process.exit(failures ? 1 : 0);
