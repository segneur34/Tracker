// Banc de test : test de FC repos de l'Entraînement (24/10).
// Usage : node test-fcrepos.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Pas de ceinture dans le navigateur : la page joue une FC d'exemple
// (`exampleRestingHr`), à ×1 pour le décompte et la mesure, à ×30 (`?vitesse=30`) pour le test entier. Le script vérifie :
//  1. la tuile « FC repos » dans Tests, la page (déroulé, aucun GPS demandé) ;
//  2. à ×1 : le décompte de préparation, la mesure (courbe qui se remplit, FC lue), « Annuler » qui ne garde rien ;
//  3. à ×30 : les bips (un court, un long), le résultat (moyenne de 10 s la plus basse, comparée à un calcul
//     refait ici sur la même FC d'exemple), la fenêtre surlignée, la courbe de 180 secondes, le test gardé ;
//  4. « La retenir » (FC repos de Pratiquant), « Refaire », le test dans « Vos tests », « Retirer » ;
//  5. à 390 et 320 px : les pages sans débordement.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node test-fcrepos.mjs <port> [<dossier des captures>]');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://localhost:5173';

const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
let sounds = [];
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
  if (msg.method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', { accept: true });
};
await new Promise((r) => { ws.onopen = r; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const go = async (path, ms = 2500) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
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
const pageText = () => evaluate('document.querySelector(".ui-page").innerText');
const stored = () => evaluate(`JSON.parse(localStorage.getItem('tracker.restingHr') ?? '[]')`);
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ` : ${detail}` : ''}`);
};

// Même FC d'exemple que `exampleRestingHr` (src/recording/restingHrTest.ts) et même fenêtre de 10 s.
const example = (t) => Math.round(56 + 14 * Math.exp(-t / 30) + 1.5 * Math.sin(t * 1.7) + 1 * Math.sin(t * 0.45 + 1));
const series = Array.from({ length: 180 }, (_, s) => example(s));
let best = Infinity;
let bestFrom = 0;
for (let s = 0; s + 10 <= 180; s++) {
  const mean = series.slice(s, s + 10).reduce((a, b) => a + b, 0) / 10;
  if (mean < best - 1e-9) { best = mean; bestFrom = s; }
}
const expectedLowest = Math.round(best);

/** Ouvre l'aide « ? » nommée (lot 3 du 24/10 : les explications sont sous un « ? »). */
const openHelp = async (label) => {
  const done = await evaluate(`(() => { const b = document.querySelector('button.ui-help[aria-label="Aide : ${label}"]'); if (!b) return false; if (b.getAttribute('aria-expanded') !== 'true') b.click(); return true; })()`);
  await wait(200);
  return done;
};

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable'); await send('Network.enable');
await send('Network.setBlockedURLs', { urls: ['https://*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// --- 1. Tuile et page ---
await go('/fractionne/tests');
const tiles = await evaluate(`[...document.querySelectorAll('.train-hub .train-tile__title')].map((n) => n.textContent).join(', ')`);
check('liste des tests : FC max, FC repos', tiles === 'FC max, FC repos', tiles);
console.log('tuile :', await clickText('FC repos', '.train-tile'));
await wait(1000);
check('page du test', (await evaluate('location.pathname')) === '/fractionne/tests/fc-repos', await evaluate('location.pathname'));
check('« ? » du déroulé', await openHelp('Déroulé'), '');
const text = await pageText();
check('déroulé : 10 s, 3 min, bip court puis long, moyenne de 10 s', /10 s pour vous poser, puis un bip court/.test(text) && /3 min/.test(text) && /bip long à la fin/.test(text) && /moyenne de 10 s la plus basse/.test(text), '');
check('sans GPS, rien ne peut le couper', /aucun GPS ni enregistrement/.test(text), '');
check('navigateur : FC d\'exemple proposée, pas de « Démarrer » de ceinture', /Essayer avec une FC d'exemple/i.test(text) && !(await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Démarrer')`)), '');
await shoot('fcrepos-protocole');

// --- 2. À ×1 : préparation, mesure, annulation ---
console.log('exemple :', await clickText("Essayer avec une FC d'exemple"));
await wait(1500);
const count1 = await evaluate(`document.querySelector('.rest-count')?.textContent ?? '(absent)'`);
check('préparation : décompte de 10 s', /^([6-9]|10) s$/.test(count1), count1);
check('préparation : « Installez-vous »', /Installez-vous/i.test(await pageText()), '');
await shoot('fcrepos-preparation');
await wait(10_000);
const live = await evaluate(`(() => ({ count: document.querySelector('.rest-count')?.textContent, bpm: document.querySelector('.rest-live__bpm')?.textContent, svg: document.querySelectorAll('.rest-chart svg.recharts-surface').length, line: !!document.querySelector('.rest-chart path.recharts-line-curve') }))()`);
check('mesure : décompte restant ~ 2:5x, FC lue, graphe', /^2:5\d$/.test(live.count ?? '') && /\d+ bpm/.test(live.bpm ?? '') && live.svg === 1, JSON.stringify(live));
check('mesure : « Ne pas bouger » et un bip court joué', /Ne bougez pas/i.test(await pageText()) && sounds.length === 1 && /court/.test(sounds[0]), sounds.join(' | '));
await shoot('fcrepos-mesure');
console.log('annuler :', await clickText('Annuler'));
await wait(500);
check('annulé : retour au début, rien de gardé', /Essayer avec une FC d'exemple/i.test(await pageText()) && (await stored()).length === 0, `${JSON.stringify(await stored())}`);

// --- 3. À ×30 : le test entier ---
sounds = [];
await go('/fractionne/tests/fc-repos?vitesse=30');
console.log('exemple ×30 :', await clickText("Essayer avec une FC d'exemple"));
await wait(9500);
check('« ? » du résultat', await openHelp('Résultat'), '');
const text3 = await pageText();
check('résultat affiché', /Résultat/i.test(text3) && /Moyenne de 10 s la plus basse/i.test(text3), text3.slice(0, 120));
const shown = await evaluate(`Number(document.querySelector('.rest-result__bpm')?.textContent)`);
check(`moyenne de 10 s la plus basse = ${expectedLowest} (calcul refait ici)`, shown === expectedLowest, `affiché ${shown}`);
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
check(`fenêtre ${fmt(bestFrom)} à ${fmt(bestFrom + 10)}`, text3.includes(`de ${fmt(bestFrom)} à ${fmt(bestFrom + 10)}`), '');
const chart = await evaluate(`(() => ({ svgs: document.querySelectorAll('.rest-chart svg.recharts-surface').length, areas: document.querySelectorAll('.rest-chart .recharts-reference-area').length, lines: document.querySelectorAll('.rest-chart .recharts-reference-line').length, ticks: [...document.querySelectorAll('.rest-chart svg text')].map((n) => n.textContent).filter((t) => t.length <= 4 && t.includes(':')).join(' ') }))()`);
check('courbe : un graphe, fenêtre surlignée, repère de la valeur, axe 0:00 à 3:00', chart.svgs === 1 && chart.areas === 1 && chart.lines === 1 && /0:00.*0:30.*1:00.*1:30.*2:00.*2:30.*3:00/.test(chart.ticks), JSON.stringify(chart));
check('bips : un court au départ, un long à la fin', sounds.length === 2 && /court/.test(sounds[0]) && /long/.test(sounds[1]), sounds.join(' | '));
const list = await stored();
check('test gardé : 180 secondes, même résultat', list.length === 1 && list[0].series.length === 180 && list[0].lowestBpm === expectedLowest && list[0].fromS === bestFrom && list[0].toS === bestFrom + 10, JSON.stringify({ n: list.length, low: list[0]?.lowestBpm, from: list[0]?.fromS }));
check('couverture complète', list[0]?.coverage === 1, String(list[0]?.coverage));
await shoot('fcrepos-resultat');

// --- 4. Retenir, refaire, historique ---
console.log('retenir :', await clickText('La retenir comme FC repos'));
await wait(400);
const runner = await evaluate(`JSON.parse(localStorage.getItem('tracker.runnerProfile') ?? '{}')?.me?.hrRest ?? null`);
check(`FC repos de Pratiquant = ${expectedLowest}`, runner === expectedLowest, String(runner));
check('bouton devenu « Retenue comme FC repos »', /Retenue comme FC repos/i.test(await pageText()), '');
console.log('refaire :', await clickText('Refaire'));
await wait(500);
const text4 = await pageText();
check('« Vos tests » : le test, avec sa valeur', /Vos tests/i.test(text4) && new RegExp(`${expectedLowest} bpm`).test(await evaluate(`document.querySelector('.rest-history')?.innerText ?? ''`)), '');
console.log('courbe du test gardé :', await clickText('Courbe', '.rest-history button'));
await wait(600);
check('courbe du test gardé affichée', (await evaluate(`document.querySelectorAll('.rest-history .rest-chart svg.recharts-surface').length`)) === 1, '');
await shoot('fcrepos-historique');
console.log('retirer :', await clickText('Retirer', '.rest-history button'));
await wait(400);
check('test retiré', (await stored()).length === 0 && !/Vos tests/i.test(await pageText()), '');

// --- 5. Téléphone ---
for (const [w, h] of [[390, 844], [320, 640]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await go('/fractionne/tests', 1500);
  check(`${w} px : /fractionne/tests sans débordement`, (await overflow()) <= 0, `${await overflow()} px`);
  await go('/fractionne/tests/fc-repos?vitesse=30', 1800);
  check(`${w} px : page du test sans débordement`, (await overflow()) <= 0, `${await overflow()} px`);
  await clickText("Essayer avec une FC d'exemple");
  await wait(9500);
  check(`${w} px : résultat sans débordement`, (await overflow()) <= 0, `${await overflow()} px`);
  await shoot(`fcrepos-resultat-${w}`);
}

console.log(logs.length ? `console :\n${[...new Set(logs)].join('\n')}` : 'console : aucune erreur');
console.log(failures === 0 ? 'tout passe' : `${failures} échec(s)`);
ws.close();
