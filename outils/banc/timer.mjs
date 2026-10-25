// Banc de test : le Timer de l'Entraînement (lot D des demandes du 25/10).
// Usage : node timer.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau, environ 30 s. Le script vérifie :
//  1. la tuile « Timer » sous Tests, sans séance gardée au départ ;
//  2. la page Timer : liste vide ; une séance créée (8 × 0:40 / 0:20 proposé), modifiée, dupliquée, la copie retirée ;
//     la liste du Fractionné n'en est pas touchée, et rien du Timer n'y paraît ;
//  3. « Lancer » : Enregistrer en mode Timer (titre « Timer », ni famille, ni « Démarrer », ni carte), la séance dans la
//     carte du compteur, lien vers les séances du Timer ; le compteur lancé : « Départ », puis « Travail 1/… » ;
//     le bandeau « Timer » sur une autre page, qui ramène au mode Timer ; arrêté ; la position jamais demandée,
//     aucune séance confiée à un enregistrement ;
//  4. « Enregistrer une session » rend la page ordinaire ;
//  5. à 390 × 844 : la page Timer et Enregistrer en mode Timer sans débordement.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node timer.mjs <port> [<dossier des captures>]');
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
const typeInto = (label, value) => evaluate(`(() => {
  const i = document.querySelector('input[aria-label=${JSON.stringify(label)}]');
  if (!i) return 'absent';
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(value)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return i.value;
})()`);
const shoot = async (name) => {
  if (!shotDir) return;
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};
const overflow = () => evaluate('document.documentElement.scrollWidth - window.innerWidth');
const text = (selector) => evaluate(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); return n ? n.innerText.replace(/\\n+/g, ' / ') : '(absent)'; })()`);
const raw = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? '(absent)'`);
const presets = () => evaluate(`[...document.querySelectorAll('.train-item__name')].map((n) => n.textContent).join(' ; ')`);
const where = () => evaluate('location.pathname + location.search');
const itemOf = (name) => `[...document.querySelectorAll('.train-item')].find((i) => i.querySelector('.train-item__name')?.textContent === ${JSON.stringify(name)})`;
const unfold = (name) => evaluate(`(() => { const i = ${itemOf(name)}; const t = i?.querySelector('.train-item__toggle'); if (!t) return 'absent'; if (t.getAttribute('aria-expanded') !== 'true') t.click(); return 'ok'; })()`);
const itemButton = (name, label) => evaluate(`(() => { const i = ${itemOf(name)}; const b = i && [...i.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(label)})); if (!b) return 'absent'; if (b.disabled) return 'désactivé'; b.click(); return 'ok'; })()`);
const blocksTitles = () => evaluate(`[...document.querySelectorAll('.train-editor .ivl-block__title')].map((n) => n.textContent).join(', ')`);
const stored = (key) => evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}')[${JSON.stringify(key)}] ?? null)`);
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ` : ${detail}` : ''}`);
};

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable'); await send('Network.enable');
await send('Network.setBlockedURLs', { urls: ['https://*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
// Sonde : chaque demande de position est comptée, dans la page et d'une page à l'autre.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const g = navigator.geolocation; if (!g) return;
  const count = () => sessionStorage.setItem('banc.geo', String(Number(sessionStorage.getItem('banc.geo') ?? 0) + 1));
  const watch = g.watchPosition.bind(g); const current = g.getCurrentPosition.bind(g);
  g.watchPosition = (...a) => { count(); return watch(...a); };
  g.getCurrentPosition = (...a) => { count(); return current(...a); };
})()` });
const geoCalls = async () => Number(await evaluate(`sessionStorage.getItem('banc.geo') ?? 0`));

// --- 1. La tuile ---
await go('/fractionne');
// État du Fractionné au départ : le Timer ne doit pas y toucher.
const fractionneBefore = { presets: await stored('intervalPresets'), last: await stored('lastIntervalWorkout') };
const tiles = await evaluate(`[...document.querySelectorAll('.train-tile__title')].map((n) => n.textContent).join(', ')`);
check('tuiles : Fractionné, Tests, Timer', tiles === 'Fractionné, Tests, Timer', tiles);
const timerTile = await evaluate(`[...document.querySelectorAll('.train-tile')].find((t) => t.querySelector('.train-tile__title')?.textContent === 'Timer')?.textContent ?? '(absente)'`);
check('tuile Timer : aucune séance gardée', /0 séance gardée/.test(timerTile), timerTile);

// --- 2. Page Timer ---
console.log('tuile :', await clickText('Timer', '.train-tile'));
await wait(800);
check('tuile : page Timer', (await where()) === '/fractionne/timer', await where());
check('titre « Timer »', (await raw('.ui-page h1')) === 'Timer', await raw('.ui-page h1'));
check('liste vide', (await presets()) === '' && /Aucune séance gardée/.test(await text('.ui-page')), await presets());
console.log('créer :', await clickText('Créer une séance'));
await wait(400);
check('page d\'édition', (await where()) === '/fractionne/timer/editer', await where());
check('titre « Nouvelle séance »', (await raw('.ui-page h1')) === 'Nouvelle séance', await raw('.ui-page h1'));
const newSummary = await text('.train-editor .ivl-summary');
check('séance neuve : 8 × 0:40 / 0:20', newSummary.startsWith('8 × 0:40 / 0:20'), newSummary);
console.log('nom :', await typeInto('Nom de la séance', 'Gainage'), '| enregistrer :', await clickText('Enregistrer', '.train-editor button'));
await wait(400);
check('retour à la liste, séance gardée', (await where()) === '/fractionne/timer' && (await presets()) === 'Gainage', `${await where()} | ${await presets()}`);
check('rangée dans timerPresets', /Gainage/.test(await stored('timerPresets')), await stored('timerPresets'));
check('séances du Fractionné inchangées', (await stored('intervalPresets')) === fractionneBefore.presets, await stored('intervalPresets'));
console.log('déplier :', await unfold('Gainage'), '| modifier :', await itemButton('Gainage', 'Modifier'));
await wait(400);
check('titre « Modifier la séance »', (await raw('.ui-page h1')) === 'Modifier la séance', await raw('.ui-page h1'));
console.log('+ 10 × 30/30 :', await clickText('+ 10 × 30/30'));
await wait(200);
check('bloc ajouté', (await blocksTitles()) === 'Série 1, Série 2', await blocksTitles());
console.log('enregistrer :', await clickText('Enregistrer', '.train-editor button'));
await wait(400);
await unfold('Gainage');
await wait(200);
const detail = await evaluate(`${itemOf('Gainage')}?.querySelector('.train-item__detail')?.textContent ?? '(absent)'`);
check('séance modifiée', detail === '8 × 0:40 / 0:20 + 10 × 0:30 / 0:30', detail);
console.log('dupliquer :', await itemButton('Gainage', 'Dupliquer'));
await wait(300);
check('copie gardée', (await presets()) === 'Gainage ; Gainage (copie)', await presets());
await unfold('Gainage (copie)');
await wait(200);
console.log('retirer la copie :', await itemButton('Gainage (copie)', 'Retirer'));
await wait(400);
check('copie retirée', (await presets()) === 'Gainage', await presets());
await shoot('timer-liste');
await go('/fractionne/seances');
const fractionne = await presets();
check('Fractionné : rien du Timer', fractionne !== '' && !fractionne.includes('Gainage'), fractionne);
await go('/fractionne');
check('tuile Timer : 1 séance gardée', /1 séance gardée/.test(await raw('.train-hub')), await raw('.train-hub'));

// --- 3. « Lancer » ---
await go('/fractionne/timer');
const geoBefore = await geoCalls();
console.log('lancer :', await itemButton('Gainage', 'Lancer'));
await wait(1200);
check('Enregistrer en mode Timer', (await where()) === '/enregistrer?minuterie=1', await where());
check('titre « Timer »', (await raw('.ui-page h1')) === 'Timer', await raw('.ui-page h1'));
const absent = await evaluate(`({
  famille: !!document.querySelector('.ui-segmented[aria-label="Famille"]'),
  demarrer: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Démarrer')),
  carte: !!document.querySelector('.rec-map, .leaflet-container'),
})`);
check('ni famille, ni « Démarrer », ni carte', !absent.famille && !absent.demarrer && !absent.carte, JSON.stringify(absent));
const counterSummary = await text('.ivl .ivl-summary');
check('la séance dans la carte du compteur', counterSummary.startsWith('8 × 0:40 / 0:20 + 10 × 0:30 / 0:30'), counterSummary);
check('séance gardée proposée', (await evaluate(`[...document.querySelectorAll('.ivl-preset__pick')].map((b) => b.firstChild.textContent).join(', ')`)) === 'Gainage');
check('lien vers les séances du Timer', (await evaluate(`[...document.querySelectorAll('.ivl a')].map((a) => a.getAttribute('href')).join(',')`)) === '/fractionne/timer');
check('dernière séance du Timer retenue à part', /"reps":8/.test(await stored('lastTimerWorkout')) && (await stored('lastIntervalWorkout')) === fractionneBefore.last,
  `${await stored('lastTimerWorkout')} | ${await stored('lastIntervalWorkout')}`);
const soundsBefore = sounds.length;
console.log('lancer le compteur :', await clickText('Lancer le compteur'));
await wait(1000);
check('départ', /Départ/.test(await text('.ivl-live__phase')), await text('.ivl-live__phase'));
await wait(3000);
check('premier travail', /Travail 1\/8/.test(await text('.ivl-live__phase')), await text('.ivl-live__phase'));
check('signal du départ : court, court, long', sounds.slice(soundsBefore).filter((s) => s.startsWith('[bips]')).map((s) => /\[bips\] (\w+)/.exec(s)[1]).join(' ') === 'court court long',
  sounds.slice(soundsBefore).join(' | ').slice(0, 300));
const run = await evaluate(`JSON.parse(localStorage.getItem('tracker.intervalRun') ?? 'null')?.kind ?? '(aucun)'`);
check('séance lancée marquée Timer', run === 'timer', run);
await shoot('timer-compteur');
// Le bandeau, sur une autre page, ramène au mode Timer.
console.log('accueil :', await evaluate(`(() => { const a = [...document.querySelectorAll('a')].find((x) => x.getAttribute('href') === '/fractionne/timer'); if (!a) return 'absent'; a.click(); return 'ok'; })()`));
await wait(600);
const banner = await text('.shell-banner--intervals');
check('bandeau « Timer · phase »', /^Timer · Série 1 · Travail 1\/8/.test(banner), banner);
console.log('bandeau :', await evaluate(`(() => { const b = document.querySelector('.shell-banner--intervals'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await wait(600);
check('le bandeau ramène au mode Timer', (await where()) === '/enregistrer?minuterie=1' && (await raw('.ui-page h1')) === 'Timer', await where());
// « Arrêter » du compteur se tient 1 s (25/10) : un appui court ne fait que rappeler le geste.
console.log('appui court :', await clickText('Arrêter', '.ivl button'));
await wait(300);
check('appui court : la séance continue, le geste rappelé', /Travail/.test(await text('.ivl-live__phase'))
  && (await evaluate(`[...document.querySelectorAll('.ivl button')].some((b) => b.textContent === 'Maintenir 1 s pour arrêter')`)), await text('.ivl-live__phase'));
console.log('arrêter :', await evaluate(`(async () => { const b = document.querySelector('.ivl button.ui-btn--danger'); if (!b) return 'absent'; const ev = (t) => b.dispatchEvent(new PointerEvent(t, { bubbles: true, button: 0, pointerType: 'mouse' })); ev('pointerdown'); await new Promise((r) => setTimeout(r, 1200)); ev('pointerup'); b.click(); return 'ok'; })()`));
await wait(300);
check('tenu 1 s : séance arrêtée', /Séance arrêtée/.test(await text('.ivl-done')), await text('.ivl-done'));
console.log('fermer :', await clickText('Fermer', '.ivl button'));
await wait(300);
check('position jamais demandée', (await geoCalls()) === geoBefore, `${(await geoCalls()) - geoBefore} demande(s)`);
const journal = await evaluate(`Object.keys(localStorage).filter((k) => /journal|pending/i.test(k)).join(', ')`);
check('aucun enregistrement en attente', journal === '', journal);

// --- 4. Retour à la page ordinaire ---
console.log('enregistrer une session :', await clickText('Enregistrer une session', 'a'));
await wait(600);
check('page ordinaire', (await where()) === '/enregistrer' && (await raw('.ui-page h1')) === 'Enregistrer'
  && !!(await evaluate(`!!document.querySelector('.ui-segmented[aria-label="Famille"]')`)), `${await where()} | ${await raw('.ui-page h1')}`);

// --- 5. Téléphone ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go('/fractionne/timer');
await unfold('Gainage');
await wait(200);
check('390 px : page Timer sans débordement', (await overflow()) <= 0, `${await overflow()} px`);
await shoot('timer-liste-390');
await go('/enregistrer?minuterie=1');
check('390 px : Enregistrer en mode Timer sans débordement', (await overflow()) <= 0, `${await overflow()} px`);
await shoot('timer-enregistrer-390');
await go('/fractionne');
check('390 px : tuiles sans débordement', (await overflow()) <= 0, `${await overflow()} px`);
await shoot('timer-tuiles-390');

console.log(logs.length ? `console :\n${[...new Set(logs)].join('\n')}` : 'console : aucune erreur');
console.log(failures === 0 ? 'tout passe' : `${failures} échec(s)`);
ws.close();
