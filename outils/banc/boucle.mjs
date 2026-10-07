// Banc de test : mode « Boucle » de la planification (point 87), avec réseau (brouter.de).
// Usage : node boucle.mjs <port> [<dossier des captures>]
// Sur un profil neuf. En Course, puis à vélo (activité Route) : boucle allumée, A, B et C posés au nord-est de
// Montpellier ; B déplacé ; « Autre retour » ; un point posé sur le retour ; « Précédent » ; A retiré puis rendu ;
// rangement, rechargement, réouverture sans calcul ; bouton éteint. Les calculs se suivent, un à la fois, comme
// dans l'application : le script attend la fin de chacun avant l'étape suivante.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node boucle.mjs <port> [<dossier des captures>]');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://localhost:5173';

const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
const dialogs = [];
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]}`);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ').split('\n')[0].slice(0, 300)}`);
  }
  // Les confirmations (itinéraire non rangé) sont acceptées, et notées.
  if (msg.method === 'Page.javascriptDialogOpening') {
    dialogs.push(msg.params.message);
    void send('Page.handleJavaScriptDialog', { accept: true });
  }
};
await new Promise((r) => { ws.onopen = r; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const clickIn = (scope, text, exact = false) => evaluate(`(() => {
  const b = [...document.querySelectorAll(${JSON.stringify(scope)})].find((x) => (${exact} ? x.textContent.trim() === ${JSON.stringify(text)} : x.textContent.includes(${JSON.stringify(text)})) && !x.disabled);
  if (!b) return 'absent'; b.click(); return 'ok';
})()`);
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
const clickAt = async (x, y) => { await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await wait(400); };

/** Position d'un lieu sur la carte, par la projection de Leaflet, d'après la vue retenue dans les préférences de la page. */
const screenOf = (lat, lon) => evaluate(`(() => {
  const view = JSON.parse(localStorage.getItem('tracker.planning')).view;
  const b = document.querySelector('.plan-map .leaflet-container').getBoundingClientRect();
  const scale = 256 * 2 ** view.zoom;
  const px = (lo) => scale * (0.5 + lo / 360);
  const py = (la) => scale * (0.5 - Math.log(Math.tan(Math.PI / 4 + (la * Math.PI) / 360)) / (2 * Math.PI));
  return [b.left + b.width / 2 + px(${lon}) - px(view.lon), b.top + b.height / 2 + py(${lat}) - py(view.lat)];
})()`);
const tapGeo = async (lat, lon) => { const [x, y] = await screenOf(lat, lon); await clickAt(x, y); };

/** Attend que plus rien ne se calcule (deux relevés de suite), au plus `maxS` secondes. */
const settle = async (maxS = 120) => {
  let quiet = 0;
  for (let s = 0; s < maxS && quiet < 2; s++) {
    await wait(1000);
    const busy = await evaluate(`document.body.innerText.includes('Calcul du tracé') || document.body.innerText.includes('Calcul du retour')`);
    quiet = busy ? 0 : quiet + 1;
  }
};

const brouterCalls = () => evaluate(`performance.getEntriesByType('resource').filter((e) => e.name.includes('brouter.de/brouter?')).length`);

const state = () => evaluate(`(() => {
  const labels = [...document.querySelectorAll('.plan-point__text strong')].map((x) => x.textContent);
  const stats = [...document.querySelectorAll('.plan-stat strong')].map((x) => x.textContent).slice(0, 3);
  const loop = document.querySelector('.plan-modes__loop')?.getAttribute('aria-pressed') ?? 'absent';
  const status = [...document.querySelectorAll('.plan-status')].map((x) => x.innerText.replace(/\\s+/g, ' ')).join(' | ');
  const alert = [...document.querySelectorAll('.ui-alert')].map((x) => x.textContent).join(' | ');
  const boucler = [...document.querySelectorAll('button')].some((b) => b.textContent.trim().startsWith('Boucler'));
  return JSON.stringify({ loop, labels, stats, status, alert, boucler });
})()`);
const log = async (label) => console.log(label.padEnd(30), await state());

/** Fait glisser le repère `index` (dans l'ordre de la carte) de (dx, dy) pixels. */
const dragMarker = async (index, dx, dy) => {
  const p = await evaluate(`(() => { const m = document.querySelectorAll('.plan-marker')[${index}]?.getBoundingClientRect(); return m ? [m.left + m.width / 2, m.top + m.height / 2] : null; })()`);
  if (!p) return 'absent';
  await mouse('mousePressed', p[0], p[1]);
  for (let k = 1; k <= 8; k++) await mouse('mouseMoved', p[0] + (dx * k) / 8, p[1] + (dy * k) / 8);
  await mouse('mouseReleased', p[0] + dx, p[1] + dy);
  await wait(500);
  return 'ok';
};

/** Touche le dernier tronçon (le retour) en son milieu, par son trait invisible : un point s'y pose. */
const tapReturn = async () => {
  const p = await evaluate(`(() => {
    const paths = [...document.querySelectorAll('.plan-map path.leaflet-interactive')].filter((x) => x.getAttribute('stroke-width') === '24');
    const path = paths[paths.length - 1];
    if (!path) return null;
    const q = path.getPointAtLength(path.getTotalLength() * 0.5).matrixTransform(path.getScreenCTM());
    return [q.x, q.y];
  })()`);
  if (!p) return 'absent';
  await clickAt(p[0], p[1]);
  return 'ok';
};

const shoot = async (name) => {
  if (!shotDir) return;
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};

await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: `${BASE}/itineraires` });
await wait(3000);

// Aller au nord-est de Montpellier, sur des rues : A, B, C.
const A = [43.6108, 3.8767];
const B = [43.6255, 3.8905];
const C = [43.6400, 3.9000];

for (const activityId of ['running', 'cycling']) {
  console.log(`=== ${activityId} ===`);
  await evaluate(`localStorage.setItem('tracker.planning', JSON.stringify({ activityId: '${activityId}', view: { lat: 43.6255, lon: 3.8885, zoom: 14 }, loop: false }));
    localStorage.setItem('tracker.sections', JSON.stringify({ planning: { profil: true, surface: false, trace: true, points: true, ranger: true, liste: true } })); 'ok'`);
  await send('Page.navigate', { url: `${BASE}/itineraires` });
  await wait(3000);

  // 1. Bouton allumé, puis A, B, C : bouclé tout seul.
  console.log('Boucle :', await clickIn('.plan-modes__loop', 'Boucle'));
  await tapGeo(...A);
  await log('A posé');
  await tapGeo(...B);
  await tapGeo(...C);
  await settle();
  await log('A, B, C');
  console.log('A : boutons', await evaluate(`JSON.stringify([...document.querySelectorAll('.plan-points > li')].map((li) => [...li.querySelectorAll('.plan-point__actions button')].map((b) => b.disabled ? 0 : 1).join('')))`));
  if (activityId === 'running') await shoot('boucle-ordinateur');

  // 2. B déplacé : l'aller change, le retour se refait.
  console.log('B déplacé :', await dragMarker(1, 60, -40));
  await settle();
  await log('B déplacé');

  // 3. « Autre retour ».
  console.log('Autre retour :', await clickIn('.plan-loop-status button', 'Autre retour'));
  await settle();
  await log('autre retour');

  // 4. Un point posé sur le retour.
  console.log('toucher le retour :', await tapReturn());
  await settle();
  await log('point sur le retour');

  // 5. « Précédent » : le point sur le retour s'en va.
  console.log('Précédent :', await clickIn('.plan-map-tools button', 'Précédent'));
  await settle();
  await log('après Précédent');

  // 6. A retiré : B devient le départ ; puis rendu par « Précédent ».
  console.log('Retirer A :', await evaluate(`(() => { const b = [...document.querySelectorAll('.plan-points > li')][0]?.querySelector('.plan-point__actions button:last-child'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
  await settle();
  await log('A retiré');
  console.log('Précédent :', await clickIn('.plan-map-tools button', 'Précédent'));
  await settle();
  await log('A rendu');

  // 7. Rangement, rechargement, réouverture : bouton allumé, rien de recalculé, rien à enregistrer.
  const name = `Boucle ${activityId}`;
  await evaluate(`(() => { const input = document.querySelector('.plan-form input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, ${JSON.stringify(name)}); input.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
  console.log('Enregistrer :', await clickIn('.plan-actions button', 'Enregistrer', true));
  await wait(1500);
  await evaluate(`localStorage.setItem('tracker.planning', JSON.stringify({ ...JSON.parse(localStorage.getItem('tracker.planning')), loop: false })); 'ok'`);
  await send('Page.navigate', { url: `${BASE}/itineraires` });
  await wait(3000);
  const before = await brouterCalls();
  console.log('rouvrir :', await clickIn('.route-list__open', name));
  await wait(3000);
  await log('rouvert');
  console.log('requêtes au serveur depuis la réouverture :', (await brouterCalls()) - before);
  console.log('« Enregistrer les modifications » :', await evaluate(`[...document.querySelectorAll('.plan-actions button')].find((b) => b.textContent.includes('Enregistrer'))?.disabled ? 'grisé' : 'actif'`));
  if (activityId === 'cycling' && shotDir) {
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await wait(1500);
    await shoot('boucle-telephone');
    await send('Emulation.clearDeviceMetricsOverride');
    await wait(800);
  }

  // 8. Bouton éteint : le retour est retiré.
  console.log('Boucle :', await clickIn('.plan-modes__loop', 'Boucle'));
  await wait(800);
  await log('bouton éteint');
}

console.log('--- confirmations ---');
dialogs.forEach((d) => console.log(d));
console.log('--- console (erreurs, avertissements) ---');
[...new Set(logs)].slice(0, 10).forEach((l) => console.log(l));
await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
ws.close();
