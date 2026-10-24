// Banc de test : test de FC max de l'Entraînement (chantier du 24/10, lot B).
// Usage : node test-fcmax.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Le script vérifie :
//  1. la tuile « Tests » de la page Entraînement, la liste des tests, la page du protocole (déroulé, bips, graphique,
//     réglages) ; l'échauffement réglé à 3 min, retenu ;
//  2. « Lancer » : Enregistrer ouvert prêt (Entraînement › Tests › FC max), sans le compteur ;
//  3. à 390 × 844 et à 320 px : les pages sans débordement.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node test-fcmax.mjs <port> [<dossier des captures>]');
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
    if (msg.params.type === 'debug' && /^\[(bips|compteur)\]/.test(text)) sounds.push(text);
    if (['error', 'warning'].includes(msg.params.type)) logs.push(`${msg.params.type}: ${text.split('\n')[0].slice(0, 300)}`);
  }
  // Les confirmations (« Retirer la séance ? ») sont acceptées.
  if (msg.method === 'Page.javascriptDialogOpening') {
    console.log(`  (dialogue accepté : ${msg.params.message.slice(0, 90)})`);
    void send('Page.handleJavaScriptDialog', { accept: true });
  }
};
await new Promise((r) => { ws.onopen = r; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const go = async (path, ms = 3000) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
const clickText = (text, selector = 'button') => evaluate(`(() => {
  const all = [...document.querySelectorAll(${JSON.stringify(selector)})];
  const b = all.find((x) => x.textContent.trim() === ${JSON.stringify(text)}) ?? all.find((x) => x.textContent.includes(${JSON.stringify(text)}));
  if (!b) return 'absent'; if (b.disabled) return 'désactivé'; b.click(); return 'ok';
})()`);
const shoot = async (name) => {
  if (!shotDir) return;
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};
const overflow = () => evaluate('document.documentElement.scrollWidth - window.innerWidth');
const segmented = (label) => evaluate(`(() => { const r = document.querySelector('.ui-segmented[aria-label=${JSON.stringify(label)}] [role=radio][aria-checked=true]'); return r ? r.textContent : '(absent)'; })()`);
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ` : ${detail}` : ''}`);
};

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable'); await send('Network.enable');
await send('Network.setBlockedURLs', { urls: ['https://*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });


// --- 1. Tuile, liste, protocole ---
await go('/fractionne');
const raw = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? '(absent)'`);
const tiles = await evaluate(`[...document.querySelectorAll('.train-hub .train-tile__title')].map((n) => n.textContent).join(', ')`);
check('tuiles « Fractionné » et « Tests »', tiles === 'Fractionné, Tests', tiles);
console.log('tuile Tests :', await clickText('Tests', '.train-tile'));
await wait(800);
check('liste des tests', (await evaluate('location.pathname')) === '/fractionne/tests' && (await raw('.train-hub')).startsWith('FC max'), await raw('.train-hub'));
console.log('FC max :', await clickText('FC max', '.train-tile'));
await wait(1200);
check('page du protocole', (await evaluate('location.pathname')) === '/fractionne/tests/fc-max', await evaluate('location.pathname'));
const page = await evaluate('document.querySelector(".ui-page").innerText');
check('déroulé : 8 min autour de 83 bpm (35 ans par défaut)', /Échauffement, 8 min/.test(page) && /83 bpm \(± 5\)/.test(page) && /185 bpm, 220 − âge/.test(page), page.slice(0, 200));
check('les bips : 1, 2, 3 courts, long', /1 court\s*bien/.test(page) && /2 courts\s*trop vite/.test(page) && /3 courts\s*accélère/.test(page), '');
check('ceinture et santé', /Ceinture cardio \(ou autre capteur de FC\) connectée/.test(page) && /Effort maximal/.test(page), '');
check('âge par défaut dit', /Âge inconnu : 35 ans par défaut/.test(page), '');
const chart = await evaluate(`(() => { const f = document.querySelector('.fit-plan'); return f ? { svgs: f.querySelectorAll('svg.recharts-surface').length, dots: f.querySelectorAll('.recharts-reference-dot').length, areas: f.querySelectorAll('.recharts-reference-area').length } : null; })()`);
check('graphique annoté : deux graphes, 10 paliers, phases', chart?.svgs === 2 && chart?.dots === 10 && chart?.areas === 6, JSON.stringify(chart));
await shoot('fcmax-protocole');
const pick = (label, value) => evaluate(`(() => {
  const l = [...document.querySelectorAll('.fit-settings__row')].find((r) => r.textContent.includes(${JSON.stringify(label)}));
  const s = l?.querySelector('select'); if (!s) return 'absent';
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(String(value))});
  s.dispatchEvent(new Event('change', { bubbles: true })); return s.value;
})()`);
console.log('échauffement 3 min :', await pick('Échauffement', 180));
await wait(300);
const storedTests = () => evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}').fitnessTests ?? null)`);
check('échauffement retenu dans les réglages', (await storedTests()) === '{"fc-max":{"warmupS":180}}', await storedTests());
check('déroulé suit le réglage', /Échauffement, 3 min/.test(await evaluate('document.querySelector(".ui-page").innerText')), '');
await go('/fractionne/tests/fc-max');
check('après rechargement, 3 min', /Échauffement, 3 min/.test(await evaluate('document.querySelector(".ui-page").innerText')), '');

// --- 2. « Lancer » ---
console.log('lancer :', await clickText('Lancer'));
await wait(1200);
check('Enregistrer, activité et test demandés', (await evaluate('location.pathname + location.search')) === '/enregistrer?activite=run-test&test=fc-max',
  await evaluate('location.pathname + location.search'));
check('Entraînement › Tests › FC max', (await segmented('Famille')) === 'Entraînement' && (await segmented('Type')) === 'Tests' && (await segmented('Test')) === 'FC max',
  `${await segmented('Famille')} / ${await segmented('Type')} / ${await segmented('Test')}`);
check('pas de rangée Activité (une seule), pas de compteur', (await segmented('Activité')) === '(absent)' && !(await evaluate(`!!document.querySelector('.ivl')`)), '');
check('lien vers le protocole', (await evaluate(`[...document.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/fractionne/tests/fc-max')`)) === true);
console.log('type Fractionné :', await clickText('Fractionné', '.ui-segmented[aria-label="Type"] [role=radio]'));
await wait(300);
check('en Fractionné : le compteur revient, la rangée Test part', (await evaluate(`!!document.querySelector('.ivl')`)) && (await segmented('Test')) === '(absent)', '');
await shoot('fcmax-enregistrer');

// --- 3. Téléphone ---
for (const [w, h] of [[390, 844], [320, 640]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  for (const path of ['/fractionne', '/fractionne/tests', '/fractionne/tests/fc-max', '/enregistrer?activite=run-test&test=fc-max']) {
    await go(path, 2000);
    check(`${w} px : ${path} sans débordement`, (await overflow()) <= 0, `${await overflow()} px`);
  }
  await go('/fractionne/tests/fc-max', 2000);
  await shoot(`fcmax-protocole-${w}`);
}

console.log(logs.length ? `console :\n${[...new Set(logs)].join('\n')}` : 'console : aucune erreur');
console.log(failures === 0 ? 'tout passe' : `${failures} échec(s)`);
ws.close();
