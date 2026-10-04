// Banc de test : parcours de voile et bips d'approche des balises (§10, point 77).
// Usage : node balises.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Sur un profil neuf. Le script :
//  1. pose un parcours en Voile sur la page Itinéraires (numéros, pas de type de voie, bloc « Parcours »),
//     le boucle, règle des bips propres au parcours (validation tirée plus loin), l'enregistre (fiche avec
//     ses bips, GPX à balises numérotées) et « Partir » (trace suivie avec ses balises et ses bips) ;
//  2. remplace la trace suivie par un parcours synthétique de trois balises (départ, 300 m au nord, puis
//     300 m à l'est), écrit son GPX à 1 Hz et 6 m/s dans le dossier de travail, et le rejoue à ×1 : relevé
//     des bips (journal « [bips] » de la version navigateur) et de la carte de guidage ;
//  3. le rejoue à ×10 avec des bips propres au parcours (validation à 280 m : la balise 2 tombe dès le
//     départ), puis « Passer » et « Bips » coupés ;
//  4. éprouve l'éditeur de la courbe dans Réglages : glisser le dernier point, ajouter un point,
//     « Vibrer aussi », « Écouter », « Par défaut ».
import { writeFileSync } from 'node:fs';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node balises.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://localhost:5173';

// --- Parcours synthétique ---
const R = 6371000;
const O = { lat: 43.5, lon: 3.95 };
const at = (east, north) => ({
  lat: O.lat + (north / R) * (180 / Math.PI),
  lon: O.lon + (east / (R * Math.cos((O.lat * Math.PI) / 180))) * (180 / Math.PI),
});
const marks = [at(0, 0), at(0, 300), at(300, 300)];
const SPEED = 6;
const t0 = Date.UTC(2026, 9, 4, 10, 0, 0);
const fixes = [];
const walk = (pts) => {
  fixes.push({ ...at(...pts[0]), t: 0 });
  for (let k = 1; k < pts.length; k++) {
    const [e0, n0] = pts[k - 1];
    const [e1, n1] = pts[k];
    const steps = Math.round(Math.hypot(e1 - e0, n1 - n0) / SPEED);
    for (let j = 1; j <= steps; j++) fixes.push({ ...at(e0 + ((e1 - e0) * j) / steps, n0 + ((n1 - n0) * j) / steps), t: fixes.length });
  }
};
walk([[0, 0], [0, 300], [300, 300]]);
const gpxPath = `${workDir}\\parcours-balises.gpx`;
writeFileSync(gpxPath, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Balises</name><trkseg>\n${
  fixes.map((f) => `<trkpt lat="${f.lat.toFixed(7)}" lon="${f.lon.toFixed(7)}"><time>${new Date(t0 + f.t * 1000).toISOString()}</time><extensions><speed>${SPEED}</speed></extensions></trkpt>`).join('\n')
}\n</trkseg></trk></gpx>\n`);
console.log(`GPX synthétique : ${fixes.length} points, ${fixes.length - 1} s à ${SPEED} m/s`);

// --- Protocole ---
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
const beeps = [];
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]}`);
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description).join(' ');
    if (text.startsWith('[bips]')) beeps.push({ at: Date.now(), text });
    else if (['error', 'warning'].includes(msg.params.type)) logs.push(`${msg.params.type}: ${text.split('\n')[0].slice(0, 300)}`);
  }
  if (msg.method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', { accept: true });
};
await new Promise((r) => { ws.onopen = r; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
/** Bouton dont le texte est exactement `text` (ou le contient, `loose`). */
const clickButton = (text, loose = false) => evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (${loose} ? x.textContent.trim().includes(${JSON.stringify(text)}) : x.textContent.trim() === ${JSON.stringify(text)}) && !x.disabled);
  if (!b) return 'absent'; b.click(); return 'ok';
})()`);
const setFile = async (selector, path) => {
  const { result: { root } } = await send('DOM.getDocument', { depth: -1 });
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId, files: [path] });
};
/** Choisit une option, par son texte : dans le menu natif qui la contient (le premier trouvé), sinon dans un choix d'activité. */
const chooseOption = (text) => evaluate(`(async () => {
  const select = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent === ${JSON.stringify(text)} && !o.disabled));
  if (select) {
    const option = [...select.options].find((o) => o.textContent === ${JSON.stringify(text)});
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, option.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  }
  // Choix d'activité (ActivitySelect) : le bouton ouvre la liste, puis l'activité s'y choisit.
  for (const button of document.querySelectorAll('button.activity-select:not(:disabled)')) {
    button.click();
    await new Promise((r) => setTimeout(r, 150));
    const item = [...document.querySelectorAll('.activity-select__option')].find((o) => o.textContent.trim() === ${JSON.stringify(text)});
    if (item) { item.click(); return 'ok'; }
    document.querySelector('.activity-select__backdrop')?.click();
    await new Promise((r) => setTimeout(r, 150));
  }
  return 'absent';
})()`);
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
const clickAt = async (x, y) => { await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await wait(300); };
const drag = async (x0, y0, x1, y1) => {
  await mouse('mousePressed', x0, y0);
  for (let k = 1; k <= 8; k++) await mouse('mouseMoved', x0 + ((x1 - x0) * k) / 8, y0 + ((y1 - y0) * k) / 8);
  await mouse('mouseReleased', x1, y1);
  await wait(300);
};
const shoot = async (name) => {
  if (!shotDir) return;
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};
const tapMap = async (fx, fy) => {
  const r = await evaluate(`(() => { const b = document.querySelector('.plan-map .leaflet-container').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()`);
  await clickAt(r[0] + r[2] * fx, r[1] + r[3] * fy);
};
const guideCard = () => evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Passer');
  // Passer et Bips sont groupés : la carte est deux niveaux au-dessus.
  return button ? button.parentElement.parentElement.innerText.replace(/\\n/g, ' · ') : null;
})()`);
const followedStats = () => evaluate(`document.body.innerText.split('\\n').filter((l, i, all) => /^(Restant|Balises validées)$/.test(all[i - 1] ?? '')).join(' | ')`);

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// 1. Itinéraires en Voile.
await send('Page.navigate', { url: `${BASE}/itineraires` });
await wait(3000);
// Tous les onglets ouverts (seul le premier l'est par défaut), lus au chargement de la page.
await evaluate(`localStorage.setItem('tracker.sections', JSON.stringify({ planning: { profil: true, parcours: true, trace: true, points: true, ranger: true, liste: true } })); 'ok'`);
await send('Page.navigate', { url: `${BASE}/itineraires` });
await wait(3000);
console.log('activité Voile :', await chooseOption('Voile'));
await wait(300);
await tapMap(0.3, 0.3);
await tapMap(0.7, 0.35);
await tapMap(0.55, 0.75);
const planState = () => evaluate(`JSON.stringify({
  repères: [...document.querySelectorAll('.plan-marker__dot')].map((x) => x.textContent),
  typesDeVoie: document.querySelectorAll('.plan-modes').length,
  blocs: [...document.querySelectorAll('.plan-block__head')].map((x) => x.textContent.trim()),
  chiffres: [...document.querySelectorAll('.plan-stat')].map((x) => x.innerText.replace(/\\n/g, ' ')),
  bords: [...document.querySelectorAll('.plan-course__leg')].map((x) => x.innerText.replace(/\\n/g, ' ')),
  liste: [...document.querySelectorAll('.plan-point__text strong')].map((x) => x.textContent),
  sélecteursDeVoie: document.querySelectorAll('.plan-points select').length,
})`);
console.log('trois balises :', await planState());
console.log('Boucler :', await clickButton('Boucler'));
await wait(300);
console.log('boucle :', await planState());
console.log('note :', await evaluate(`[...document.querySelectorAll('.plan-note')].map((x) => x.textContent).find((t) => t.includes('se valide')) ?? null`));
await shoot('balises-planification');
console.log('Régler pour ce parcours :', await clickButton('Régler pour ce parcours'));
await wait(300);
await evaluate(`document.querySelector('.plan-beeps .beep-editor__chart').scrollIntoView({ block: 'center' }); 'ok'`);
await wait(300);
{
  const [vx, vy] = await evaluate(`(() => { const c = document.querySelectorAll('.plan-beeps .beep-editor__point')[0].querySelectorAll('circle')[1].getBoundingClientRect(); return [c.left + c.width / 2, c.top + c.height / 2]; })()`);
  await drag(vx, vy, vx + 25, vy);
}
console.log('bips du parcours :', await evaluate(`[...document.querySelectorAll('.plan-beeps .beep-editor__row')].slice(1).map((r) => [...r.querySelectorAll('input')].map((i) => i.value).join('/')).join('  ')`));
console.log('note :', await evaluate(`[...document.querySelectorAll('.plan-note')].map((x) => x.textContent).find((t) => t.includes('se valide')) ?? null`));
await shoot('balises-parcours-bips');
await evaluate(`(() => { const i = document.querySelector('.plan-form input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Parcours banc'); i.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
console.log('Enregistrer :', await clickButton('Enregistrer'));
await wait(1500);
console.log('message :', await evaluate(`[...document.querySelectorAll('.plan-note')].map((x) => x.textContent).find((t) => t.startsWith('Enregistré')) ?? null`));
console.log('bips dans la fiche :', await evaluate(`(async () => {
  const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('itineraires');
  return JSON.stringify(JSON.parse(await (await (await d.getFileHandle('Parcours banc.json')).getFile()).text()).markGuide ?? null);
})()`));
console.log('GPX rangé :', await evaluate(`(async () => {
  const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('itineraires');
  const text = await (await (await d.getFileHandle('Parcours banc.gpx')).getFile()).text();
  return [...text.matchAll(/<wpt[^>]*><name>([^<]*)<\\/name>/g)].map((m) => m[1]).join(', ');
})()`));
console.log('Partir :', await clickButton('Partir'));
await wait(2000);
console.log('page :', await evaluate('location.pathname'), '; balises suivies :', await evaluate(`JSON.parse(localStorage.getItem('tracker.followedTrace')).marks?.length ?? 0`),
  '; validation suivie :', await evaluate(`JSON.parse(localStorage.getItem('tracker.followedTrace')).markGuide?.curve[0].distanceM ?? null`));
console.log('aperçu, balises sur la carte :', await evaluate(`document.querySelectorAll('.leaflet-marker-icon span').length`));

// 2. Parcours synthétique, rejeu ×1.
await evaluate(`localStorage.setItem('tracker.followedTrace', JSON.stringify(${JSON.stringify({ name: 'Synthétique', source: 'route', activityId: 'wingfoil', points: marks, marks })})); 'ok'`);
await send('Page.navigate', { url: `${BASE}/enregistrer` });
await wait(2500);
const prepareReplay = async (speed) => {
  await evaluate(`[...document.querySelectorAll('[aria-label=Famille] button')].find((b) => b.textContent === 'Voile').click(); 'ok'`);
  await evaluate(`[...document.querySelectorAll('label')].find((l) => l.textContent.includes('Rejeu')).querySelector('input').click(); 'ok'`);
  await wait(300);
  await setFile('input[type=file][accept=".gpx"]', gpxPath);
  await wait(500);
  await chooseOption(`×${speed}`);
};
await prepareReplay(1);
const runStart = Date.now();
beeps.length = 0;
console.log('Démarrer (×1) :', await clickButton('Démarrer', true));
const samples = [];
for (let s = 0; s < 104; s += 4) {
  await wait(4000);
  samples.push(`${String(Math.round((Date.now() - runStart) / 1000)).padStart(3)} s  ${await guideCard()}  [${await followedStats()}]`);
  if (s === 20) await shoot('balises-guidage');
}
console.log(samples.join('\n'));
const rel = (b) => ((b.at - runStart) / 1000).toFixed(1);
const shorts = beeps.filter((b) => b.text.includes('court'));
console.log(`bips : ${beeps.length} (${shorts.length} courts)`);
console.log(beeps.map((b, k) => {
  const gap = k > 0 ? ` +${((b.at - beeps[k - 1].at) / 1000).toFixed(2)} s` : '';
  return `  ${rel(b).padStart(6)} s ${b.text.replace(/ à \d+$/, '').replace('[bips] ', '')}${gap}`;
}).join('\n'));
console.log('Arrêter :', await clickButton('Arrêter', true));
await wait(1500);
console.log('Jeter :', await clickButton('Jeter'));
await wait(1000);

// 3. Rejeu ×10, bips propres au parcours (validation à 280 m) : « Passer » puis « Bips » coupés.
const wideGuide = { curve: [{ distanceM: 280, intervalMs: 250 }, { distanceM: 400, intervalMs: 1500 }], vibrate: true };
await evaluate(`localStorage.setItem('tracker.followedTrace', JSON.stringify(${JSON.stringify({ name: 'Synthétique', source: 'route', activityId: 'wingfoil', points: marks, marks, markGuide: wideGuide })})); 'ok'`);
await send('Page.navigate', { url: `${BASE}/enregistrer` });
await wait(2500);
await prepareReplay(10);
beeps.length = 0;
console.log('Démarrer (×10) :', await clickButton('Démarrer', true));
await wait(1200);
console.log('au départ :', await guideCard());
console.log('Passer :', await clickButton('Passer'));
await wait(300);
console.log('après Passer :', await guideCard());
console.log('Bips :', await clickButton('Bips'));
const mutedAt = Date.now();
await wait(300);
console.log('après Bips :', await guideCard());
await wait(10_000);
console.log('fin :', await guideCard(), '; bips après la coupure :', beeps.filter((b) => b.at > mutedAt).length,
  '; avant :', beeps.filter((b) => b.at <= mutedAt).map((b) => b.text.split(' ')[1]).join(', '));
await clickButton('Arrêter', true);
await wait(1500);
await clickButton('Jeter');
await wait(1000);

// 4. Réglages : éditeur de la courbe.
await evaluate(`localStorage.setItem('tracker.sections', JSON.stringify({ settings: { activites: true } })); 'ok'`);
await send('Page.navigate', { url: `${BASE}/parametres` });
await wait(2500);
await evaluate(`[...document.querySelectorAll('.settings-activity__toggle')].find((b) => b.textContent.includes('Voile')).click(); 'ok'`);
await wait(500);
const stored = () => evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}').markGuide ?? null)`);
const editorRows = () => evaluate(`[...document.querySelectorAll('.beep-editor__row')].map((r) => [...r.querySelectorAll('input')].map((i) => i.value).join('/')).join('  ')`);
await evaluate(`document.querySelector('.beep-editor').scrollIntoView({ block: 'center' }); 'ok'`);
await wait(300);
console.log('éditeur :', await editorRows(), '; rangé :', await stored());
const pointAt = (i) => evaluate(`(() => { const c = document.querySelectorAll('.beep-editor__point')[${i}].querySelectorAll('circle')[1].getBoundingClientRect(); return [c.left + c.width / 2, c.top + c.height / 2]; })()`);
const [lx, ly] = await pointAt(4);
await drag(lx, ly, lx + 40, ly - 15);
console.log('dernier point tiré :', await editorRows(), '; rangé :', await stored());
const chart = await evaluate(`(() => { const b = document.querySelector('.beep-editor__chart').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()`);
await clickAt(chart[0] + chart[2] * 0.35, chart[1] + chart[3] * 0.75);
console.log('point ajouté :', await editorRows());
await evaluate(`document.querySelector('.beep-editor__check input').click(); 'ok'`);
await wait(300);
console.log('sans vibration :', await stored());
await shoot('balises-reglage');
beeps.length = 0;
const listenStart = Date.now();
console.log('Écouter :', await clickButton('Écouter'));
await wait(27_000);
console.log(`écoute : ${beeps.length} sons`, beeps.map((b) => `${((b.at - listenStart) / 1000).toFixed(1)}${b.text.includes('long') ? 'L' : ''}`).join(' '));
console.log('Par défaut :', await clickButton('Par défaut'));
await wait(300);
console.log('après défaut :', await editorRows(), '; rangé :', await stored());

console.log(logs.length ? `console :\n${logs.join('\n')}` : 'console : aucune erreur');
ws.close();
