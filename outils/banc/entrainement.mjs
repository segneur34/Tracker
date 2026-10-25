// Banc de test : famille Entraînement, page Fractionné et compteur à blocs (chantier du 24/10, lot A et ses retouches).
// Usage : node entrainement.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau, environ 40 s. Le script vérifie :
//  1. le nom « Entraînement » sur l'accueil, dans la barre et sur la page de la famille, et sa tuile « Fractionné » ;
//  2. la page Fractionné : les séances de départ ; une séance neuve à blocs (échauffement, 3 × 3 min, retour au calme,
//     plus « 10 × 30/30 » ajouté d'un geste), gardée sous un nom ; modifiée (un bloc retiré, un monté) ; dupliquée ;
//     la copie retirée ;
//  3. « Lancer » : Enregistrer ouvert prêt (Entraînement, type Fractionné, à pied ; vélo se choisit dessous), la séance
//     dans la carte du compteur ; le compteur lancé : « Départ », puis « Série 1 · Travail 1/3 » ; arrêté ;
//  4. Réglages › Enregistrement : « Son des bips » choisi grave, retenu dans les réglages, « Écouter » joue court, court, long ;
//  5. à 390 × 844 : la page de la famille et la page Fractionné sans débordement.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node entrainement.mjs <port> [<dossier des captures>]');
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
const clickLabel = (label) => evaluate(`(() => {
  const b = document.querySelector('[aria-label=${JSON.stringify(label)}]');
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
const presets = () => evaluate(`[...document.querySelectorAll('.train-item__name')].map((n) => n.textContent).join(' ; ')`);
const segmented = (label) => evaluate(`(() => { const r = document.querySelector('.ui-segmented[aria-label=${JSON.stringify(label)}] [role=radio][aria-checked=true]'); return r ? r.textContent : '(absent)'; })()`);
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ` : ${detail}` : ''}`);
};

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable'); await send('Network.enable');
await send('Network.setBlockedURLs', { urls: ['https://*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// --- 1. Le nom de la famille ---
await go('/');
const homeNames = await evaluate(`[...document.querySelectorAll('.home-family__name')].map((n) => n.textContent).join(', ')`);
check('accueil : carte « Entraînement »', homeNames?.includes('Entraînement') && !homeNames.includes('Fractionné'), homeNames);
const navNames = await evaluate(`[...document.querySelectorAll('nav a')].map((a) => a.textContent.trim()).filter(Boolean)`);
check('barre du haut : « Entraînement »', navNames?.includes('Entraînement') && !navNames.includes('Fractionné'), navNames?.slice(0, 9).join(', '));
await go('/fractionne');
const raw = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? '(absent)'`);
check('page de la famille : titre', (await raw('.lib-banner h1')) === 'Entraînement', await raw('.lib-banner h1'));
const tile = await raw('.train-hub');
check('tuile « Fractionné » et ses séances de départ', /^Fractionné/.test(tile) && /3 séances gardées/.test(tile), tile);
await shoot('entrainement-famille');

// --- 2. Page Fractionné ---
console.log('tuile :', await clickText('Fractionné', '.train-tile'));
await wait(800);
check('tuile : page Fractionné', (await evaluate('location.pathname')) === '/fractionne/seances', await evaluate('location.pathname'));
check('séances de départ', (await presets())?.split(' ; ').length === 3, await presets());
console.log('nouvelle séance :', await clickText('Nouvelle séance'));
await wait(300);
const blocksTitles = () => evaluate(`[...document.querySelectorAll('.train-editor .ivl-block__title')].map((n) => n.textContent).join(', ')`);
check('séance neuve : trois blocs', (await blocksTitles()) === 'Échauffement, Série, Retour au calme', await blocksTitles());
// Croix de l'éditeur : fermeture directe sans changement, sinon la question Enregistrer / Ne pas enregistrer / Continuer.
const clickClose = () => evaluate(`(() => { const b = document.querySelector('.train-editor__close'); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
const editorOpen = () => evaluate(`!!document.querySelector('.train-editor')`);
const dialogOpen = () => evaluate(`!!document.querySelector('.ui-dialog[role=dialog]')`);
console.log('croix sans changement :', await clickClose());
await wait(300);
check('croix sans changement : fermeture directe', !(await editorOpen()) && !(await dialogOpen()));
console.log('nouvelle séance :', await clickText('Nouvelle séance'));
await wait(300);
console.log('nom :', await typeInto('Nom de la séance', 'Croix test'), '| croix :', await clickClose());
await wait(300);
check('croix avec changement : la question', (await dialogOpen()) && (await editorOpen()));
console.log('continuer :', await clickText('Continuer', '.ui-dialog button'));
await wait(300);
check('continuer : éditeur gardé, question fermée', (await editorOpen()) && !(await dialogOpen()));
console.log('croix :', await clickClose());
await wait(300);
console.log('ne pas enregistrer :', await clickText('Ne pas enregistrer', '.ui-dialog button'));
await wait(300);
check('ne pas enregistrer : éditeur fermé, séance absente', !(await editorOpen()) && !(await presets())?.includes('Croix test'), await presets());
console.log('nouvelle séance :', await clickText('Nouvelle séance'));
await wait(300);
console.log('nom :', await typeInto('Nom de la séance', 'Croix gardée'), '| croix :', await clickClose());
await wait(300);
console.log('enregistrer :', await clickText('Enregistrer', '.ui-dialog button'));
await wait(400);
check('enregistrer : séance gardée, éditeur fermé', !(await editorOpen()) && (await presets())?.includes('Croix gardée'), await presets());
console.log('retirer :', await evaluate(`(() => { const i = [...document.querySelectorAll('.train-item')].find((x) => x.querySelector('.train-item__name')?.textContent === 'Croix gardée'); i?.querySelector('.train-item__toggle')?.click(); return i ? 'ok' : 'absent'; })()`));
await wait(200);
console.log('retirer :', await evaluate(`(() => { const i = [...document.querySelectorAll('.train-item')].find((x) => x.querySelector('.train-item__name')?.textContent === 'Croix gardée'); const b = i && [...i.querySelectorAll('button')].find((x) => x.textContent === 'Retirer'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await wait(400);
console.log('nouvelle séance :', await clickText('Nouvelle séance'));
await wait(300);
console.log('+ 10 × 30/30 :', await clickText('+ 10 × 30/30'));
await wait(200);
check('bloc ajouté à la fin, séries numérotées', (await blocksTitles()) === 'Échauffement, Série 1, Retour au calme, Série 2', await blocksTitles());
const summary = await text('.train-editor .ivl-summary');
check('résumé de la séance', summary.startsWith('Échauffement 10:00 + 3 × 3:00 / 1:00 + Retour au calme 10:00 + 10 × 0:30 / 0:30') && /40:30 en tout/.test(summary), summary);
console.log('nom :', await typeInto('Nom de la séance', 'Séance test'), '| garder :', await clickText('Garder la séance'));
await wait(400);
check('séance gardée', (await presets())?.split(' ; ').includes('Séance test'), await presets());
const itemOf = (name) => `[...document.querySelectorAll('.train-item')].find((i) => i.querySelector('.train-item__name')?.textContent === ${JSON.stringify(name)})`;
// Une séance est repliée (titre, Lancer, flèche) : la flèche déplie son détail et ses actions.
const unfold = (name) => evaluate(`(() => { const i = ${itemOf(name)}; const t = i?.querySelector('.train-item__toggle'); if (!t) return 'absent'; if (t.getAttribute('aria-expanded') !== 'true') t.click(); return 'ok'; })()`);
// Modifier : retirer l'échauffement, monter la série 2 au-dessus du retour au calme.
check('séance repliée au départ', (await evaluate(`${itemOf('Séance test')}?.querySelector('.train-item__body') === null`)) === true);
console.log('déplier :', await unfold('Séance test'));
await wait(200);
console.log('modifier :', await evaluate(`(() => { const i = ${itemOf('Séance test')}; const b = i && [...i.querySelectorAll('button')].find((x) => x.textContent === 'Modifier'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await wait(300);
console.log('retirer l\'échauffement :', await clickLabel('Retirer : Échauffement'), '| monter la série 2 :', await clickLabel('Monter : Série 2'));
await wait(200);
check('blocs modifiés', (await blocksTitles()) === 'Série 1, Série 2, Retour au calme', await blocksTitles());
console.log('enregistrer :', await clickText('Enregistrer les changements'));
await wait(400);
await unfold('Séance test');
await wait(200);
const detail = await evaluate(`(() => { const i = ${itemOf('Séance test')}; return i ? i.querySelector('.train-item__detail')?.textContent : '(absente)'; })()`);
check('séance modifiée, même nom', detail === '3 × 3:00 / 1:00 + 10 × 0:30 / 0:30 + Retour au calme 10:00', detail);
console.log('dupliquer :', await evaluate(`(() => { const i = ${itemOf('Séance test')}; const b = i && [...i.querySelectorAll('button')].find((x) => x.textContent === 'Dupliquer'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await wait(300);
check('copie gardée', (await presets())?.includes('Séance test (copie)'), await presets());
await unfold('Séance test (copie)');
await wait(200);
console.log('retirer la copie :', await evaluate(`(() => { const i = ${itemOf('Séance test (copie)')}; const b = i && [...i.querySelectorAll('button')].find((x) => x.textContent === 'Retirer'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await wait(400);
check('copie retirée', !(await presets())?.includes('(copie)') && (await presets())?.split(' ; ').length === 4, await presets());
await shoot('entrainement-seances');

// --- 3. « Lancer » ---
console.log('lancer :', await evaluate(`(() => { const i = ${itemOf('Séance test')}; const b = i && [...i.querySelectorAll('button')].find((x) => x.textContent.includes('Lancer')); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await wait(1200);
check('Enregistrer, activité demandée', (await evaluate('location.pathname + location.search')) === '/enregistrer?activite=run-intervals', await evaluate('location.pathname + location.search'));
check('famille, type et activité choisis', (await segmented('Famille')) === 'Entraînement' && (await segmented('Type')) === 'Fractionné' && (await segmented('Activité')) === 'à pied',
  `${await segmented('Famille')} / ${await segmented('Type')} / ${await segmented('Activité')}`);
const rowItems = (label) => evaluate(`[...document.querySelectorAll('.ui-segmented[aria-label=${JSON.stringify(label)}] [role=radio]')].map((r) => r.textContent).join(', ')`);
check('rangée des types, puis à pied et vélo', (await rowItems('Type')) === 'Fractionné, Tests' && (await rowItems('Activité')) === 'à pied, vélo', `${await rowItems('Type')} | ${await rowItems('Activité')}`);
console.log('vélo :', await clickText('vélo', '.ui-segmented[aria-label="Activité"] [role=radio]'));
await wait(300);
check('vélo choisi, la séance reste', (await segmented('Activité')) === 'vélo' && (await text('.ivl .ivl-summary')).startsWith('3 × 3:00'), await segmented('Activité'));
const counterSummary = await text('.ivl .ivl-summary');
check('la séance dans la carte du compteur', counterSummary.startsWith('3 × 3:00 / 1:00 + 10 × 0:30 / 0:30 + Retour au calme 10:00'), counterSummary);
check('lien vers les séances', (await evaluate(`[...document.querySelectorAll('.ivl a')].map((a) => a.getAttribute('href')).join(',')`)) === '/fractionne/seances');
const soundsBefore = sounds.length;
console.log('lancer le compteur :', await clickText('Lancer le compteur'));
await wait(1000);
check('départ', /Départ/.test(await text('.ivl-live__phase')), await text('.ivl-live__phase'));
await wait(3000);
check('premier travail nommé par sa série', (await text('.ivl-live__phase')) === 'Série 1 · Travail 1/3', await text('.ivl-live__phase'));
check('signal du départ : court, court, long', sounds.slice(soundsBefore).filter((s) => s.startsWith('[bips]')).map((s) => /\[bips\] (\w+)/.exec(s)[1]).join(' ') === 'court court long',
  sounds.slice(soundsBefore).join(' | ').slice(0, 300));
await shoot('entrainement-compteur');
console.log('arrêter :', await evaluate(`(() => { const b = [...document.querySelectorAll('.ivl button')].find((x) => x.textContent === 'Arrêter'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await wait(300);
console.log('fermer :', await clickText('Fermer', '.ivl button'));

// --- 4. Son des bips ---
await go('/parametres');
// Le bloc Enregistrement de Réglages, ouvert s'il ne l'est pas (son état est retenu).
if (!(await evaluate(`!!document.querySelector('.ui-segmented[aria-label="Son des bips"]')`))) console.log('bloc Enregistrement :', await clickText('Enregistrement', '[role=button]'));
await wait(300);
check('ligne « Son des bips »', (await segmented('Son des bips')) === 'aigu', await segmented('Son des bips'));
const soundsAt = sounds.length;
console.log('grave :', await clickText('grave', '.ui-segmented[aria-label="Son des bips"] [role=radio]'));
await wait(2800);
const stored = await evaluate(`JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}').beepSound ?? '(absent)'`);
check('son retenu dans les réglages', stored === 'grave', stored);
check('choisir un son le fait entendre : court, court, long', sounds.slice(soundsAt).map((s) => /\[bips\] (\w+)/.exec(s)?.[1]).join(' ') === 'court court long', sounds.slice(soundsAt).join(' | ').slice(0, 300));
const listenAt = sounds.length;
console.log('écouter :', await clickText('Écouter'));
await wait(2800);
check('« Écouter » : court, court, long', sounds.slice(listenAt).map((s) => /\[bips\] (\w+)/.exec(s)?.[1]).join(' ') === 'court court long', sounds.slice(listenAt).join(' | ').slice(0, 300));
await go('/parametres');
// Le bloc Enregistrement de Réglages, ouvert s'il ne l'est pas (son état est retenu).
if (!(await evaluate(`!!document.querySelector('.ui-segmented[aria-label="Son des bips"]')`))) console.log('bloc Enregistrement :', await clickText('Enregistrement', '[role=button]'));
await wait(300);
check('après rechargement, toujours grave', (await segmented('Son des bips')) === 'grave', await segmented('Son des bips'));
console.log('aigu, par défaut :', await clickText('aigu', '.ui-segmented[aria-label="Son des bips"] [role=radio]'));
await wait(300);
const back = await evaluate(`JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}').beepSound ?? '(absent)'`);
check('son par défaut : plus rien d\'écrit', back === '(absent)', back);

// --- 5. Téléphone ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go('/fractionne');
check('390 px : page de la famille sans débordement', (await overflow()) <= 0, `${await overflow()} px`);
await shoot('entrainement-famille-390');
await go('/fractionne/seances');
check('séance repliée au départ', (await evaluate(`${itemOf('Séance test')}?.querySelector('.train-item__body') === null`)) === true);
console.log('déplier :', await unfold('Séance test'));
await wait(200);
console.log('modifier :', await evaluate(`(() => { const i = ${itemOf('Séance test')}; const b = i && [...i.querySelectorAll('button')].find((x) => x.textContent === 'Modifier'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await wait(300);
check('390 px : page Fractionné, éditeur ouvert, sans débordement', (await overflow()) <= 0, `${await overflow()} px`);
await shoot('entrainement-seances-390');
await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 2, mobile: true });
await go('/fractionne/seances');
check('320 px : page Fractionné sans débordement', (await overflow()) <= 0, `${await overflow()} px`);
await go('/');
check('320 px : accueil sans débordement', (await overflow()) <= 0, `${await overflow()} px`);
await shoot('entrainement-accueil-320');

console.log(logs.length ? `console :\n${[...new Set(logs)].join('\n')}` : 'console : aucune erreur');
console.log(failures === 0 ? 'tout passe' : `${failures} échec(s)`);
ws.close();
