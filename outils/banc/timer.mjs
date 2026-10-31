// Banc de test : le Timer de l'Entraînement (lot D des demandes du 25/10).
// Usage : node timer.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau, environ 30 s. Le script vérifie :
//  1. les deux tuiles de l'Entraînement (« Fractionné et tests », « Muscu et timer »), sans séance gardée au départ pour la seconde ;
//  2. la page « Muscu et timer » : liste vide ; une séance créée (8 × 0:40 / 0:20 proposé), modifiée, dupliquée, la copie retirée ;
//     la liste du Fractionné n'en est pas touchée, et rien du Timer n'y paraît ;
//  3. « Timer » d'une séance (ex-« Lancer », 26/10) : Enregistrer en mode Timer (titre « Timer », ni famille, ni « Démarrer », ni carte), le
//     compteur déjà lancé sur la séance : « Départ », puis « Travail 1/… » ; le bandeau « Timer » sur une autre page,
//     qui ramène au mode Timer ; « Modifier » à droite d'« Arrêter » : la séance arrêtée et oubliée, l'éditeur sur
//     elle (séance gardée proposée, lien vers les séances du Timer) ; « Lancer le compteur » la relance ; arrêtée,
//     la page quittée puis retrouvée par le retour : la séance close oubliée, l'éditeur et jamais « Séance arrêtée » ;
//     la position jamais demandée, aucune séance confiée à un enregistrement ;
//  4. « Enregistrer une session » rend la page ordinaire ;
//  4 bis. (lot 24, 28/10) « Enregistrer » d'une séance, en muscu : Enregistrer sur Muscu, la séance dans la carte du compteur sans être
//     lancée, ceinture cochée et grisée (FC d'exemple du navigateur), compteur lancé puis session démarrée, « Arrêter » de la session tenu
//     2 s : le compteur est arrêté avec elle ; le lien « Enregistrer sans séance » absent (lot 102) ;
//  4 ter. (lot 103) la même séance passée jusqu'au bout pendant l'enregistrement : « Séance terminée » propose « Arrêter
//     l'enregistrement » à côté de « Fermer », la session continue ; appui court : le geste rappelé ; tenu 2 s : « Session terminée » ;
//  5. à 390 × 844 : la page Timer, Enregistrer en mode Timer et le compteur en marche sans débordement.
import { connect } from './lib/cdp.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node timer.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

// --- Protocole ---
// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, wait, blockNetwork, shoot, close, logs, onMessage } = await connect({ port, width: 1400, height: 1000, shotDir });
const sounds = [];
onMessage((msg) => {
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description).join(' ');
    if (msg.params.type === 'debug' && /^\[(bips|compteur)\]/.test(text)) sounds.push(text);
  }
  // Les confirmations (« Retirer la séance ? ») sont acceptées par la bibliothèque.
  if (msg.method === 'Page.javascriptDialogOpening') console.log(`  (dialogue accepté : ${msg.params.message.slice(0, 90)})`);
});
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

await blockNetwork(['https://*']);
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
check('tuiles : Fractionné et tests, Muscu et timer', tiles === 'Fractionné et tests, Muscu et timer', tiles);
const timerTile = await evaluate(`[...document.querySelectorAll('.train-tile')].find((t) => t.querySelector('.train-tile__title')?.textContent === 'Muscu et timer')?.textContent ?? '(absente)'`);
check('tuile Muscu et timer : aucune séance gardée', /0 séance gardée/.test(timerTile), timerTile);

// --- 2. Page Timer ---
console.log('tuile :', await clickText('Muscu et timer', '.train-tile'));
await wait(800);
check('tuile : page Muscu et timer', (await where()) === '/fractionne/timer', await where());
check('titre « Muscu et timer »', (await raw('.ui-page h1')) === 'Muscu et timer', await raw('.ui-page h1'));
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
console.log('+ Série :', await clickText('+ Série'));
await wait(200);
check('bloc ajouté', (await blocksTitles()) === 'Série 1, Série 2', await blocksTitles());
console.log('enregistrer :', await clickText('Enregistrer', '.train-editor button'));
await wait(400);
await unfold('Gainage');
await wait(200);
const detail = await evaluate(`${itemOf('Gainage')}?.querySelector('.train-item__detail')?.textContent ?? '(absent)'`);
check('séance modifiée', detail === '8 × 0:40 / 0:20 + 5 × 1:00 / 1:00', detail);
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
check('tuile Muscu et timer : 1 séance gardée', /Muscu et timer.*1 séance gardée/.test(await raw('.train-hub')), await raw('.train-hub'));

// --- 3. « Lancer » ---
await go('/fractionne/timer');
const geoBefore = await geoCalls();
const soundsAtLaunch = sounds.length;
console.log('Timer :', await itemButton('Gainage', 'Timer'));
await wait(1200);
check('Enregistrer en mode Timer', (await where()) === '/enregistrer?minuterie=1', await where());
check('titre « Timer »', (await raw('.ui-page h1')) === 'Timer', await raw('.ui-page h1'));
const absent = await evaluate(`({
  famille: !!document.querySelector('.ui-segmented[aria-label="Famille"]'),
  demarrer: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Démarrer')),
  carte: !!document.querySelector('.rec-map, .leaflet-container'),
})`);
check('ni famille, ni « Démarrer », ni carte', !absent.famille && !absent.demarrer && !absent.carte, JSON.stringify(absent));
const soundsBefore = soundsAtLaunch;
check("compteur lancé d'emblée, sans éditeur", !(await evaluate(`!!document.querySelector('.ivl .ivl-summary')`)) && /Départ|Travail 1\/8/.test(await text('.ivl-live__phase')), await text('.ivl-live__phase'));
const liveSummary = await text('.ivl-live__left');
check('la séance dans la carte du compteur', liveSummary.startsWith('8 × 0:40 / 0:20 + 5 × 1:00 / 1:00'), liveSummary);
check('dernière séance du Timer retenue à part', /"reps":8/.test(await stored('lastTimerWorkout')) && (await stored('lastIntervalWorkout')) === fractionneBefore.last,
  `${await stored('lastTimerWorkout')} | ${await stored('lastIntervalWorkout')}`);
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
const actions = await evaluate(`[...document.querySelectorAll('.ivl .ivl-actions button')].map((b) => b.textContent.trim()).join(', ')`);
check("« Modifier » à droite d'« Arrêter »", /(Arrêter|Maintenir 1 s pour arrêter), Modifier$/.test(actions), actions);
console.log('modifier :', await clickText('Modifier', '.ivl button'));
await wait(400);
check('modifier : séance arrêtée et oubliée', (await evaluate(`JSON.parse(localStorage.getItem('tracker.intervalRun') ?? 'null') === null`)) === true
  && !(await evaluate(`!!document.querySelector('.ivl-done')`)), await evaluate(`localStorage.getItem('tracker.intervalRun')`));
const editorSummary = await text('.ivl .ivl-summary');
check("modifier : l'éditeur sur la séance", editorSummary.startsWith('8 × 0:40 / 0:20 + 5 × 1:00 / 1:00'), editorSummary);
check('séance gardée proposée', (await evaluate(`[...document.querySelectorAll('.ivl-preset__pick')].map((b) => b.firstChild.textContent).join(', ')`)) === 'Gainage');
check('lien vers les séances du Timer', (await evaluate(`[...document.querySelectorAll('.ivl a')].map((a) => a.getAttribute('href')).join(',')`)) === '/fractionne/timer');
console.log('lancer le compteur :', await clickText('Lancer le compteur'));
await wait(1000);
check("relancée depuis l'éditeur", /Départ|Travail 1\/8/.test(await text('.ivl-live__phase')), await text('.ivl-live__phase'));
console.log('arrêter :', await evaluate(`(async () => { const b = document.querySelector('.ivl button.ui-btn--danger'); if (!b) return 'absent'; const ev = (t) => b.dispatchEvent(new PointerEvent(t, { bubbles: true, button: 0, pointerType: 'mouse' })); ev('pointerdown'); await new Promise((r) => setTimeout(r, 1200)); ev('pointerup'); b.click(); return 'ok'; })()`));
await wait(300);
check('tenu 1 s : séance arrêtée', /Séance arrêtée/.test(await text('.ivl-done')), await text('.ivl-done'));
// La page quittée (lien « Séances » de l'en-tête), puis retrouvée par le retour, sans recharger : la séance close est oubliée (26/10).
console.log('quitter :', await evaluate(`(() => { const a = [...document.querySelectorAll('a')].find((x) => x.getAttribute('href') === '/fractionne/timer'); if (!a) return 'absent'; a.click(); return 'ok'; })()`));
await wait(600);
check('page quittée : séance close oubliée', (await evaluate(`JSON.parse(localStorage.getItem('tracker.intervalRun') ?? 'null') === null`)) === true,
  await evaluate(`localStorage.getItem('tracker.intervalRun')`));
console.log('retour :', await evaluate(`(history.back(), 'ok')`));
await wait(1000);
const backPath = await where();
const doneShown = await evaluate(`!!document.querySelector('.ivl-done')`);
const editorBack = await text('.ivl .ivl-summary');
check("retour : l'éditeur, pas « Séance arrêtée »", backPath === '/enregistrer?minuterie=1' && !doneShown && editorBack.startsWith('8 × 0:40 / 0:20'), `${backPath} | ${editorBack}`);
check('position jamais demandée', (await geoCalls()) === geoBefore, `${(await geoCalls()) - geoBefore} demande(s)`);
const journal = await evaluate(`Object.keys(localStorage).filter((k) => /journal|pending/i.test(k)).join(', ')`);
check('aucun enregistrement en attente', journal === '', journal);

// --- 4. Retour à la page ordinaire ---
console.log('enregistrer une session :', await clickText('Enregistrer une session', 'a'));
await wait(600);
check('page ordinaire', (await where()) === '/enregistrer' && (await raw('.ui-page h1')) === 'Enregistrer'
  && !!(await evaluate(`!!document.querySelector('.ui-segmented[aria-label="Famille"]')`)), `${await where()} | ${await raw('.ui-page h1')}`);

// --- 4 bis. « Enregistrer » : la séance avec la ceinture, en muscu (lot I du 25/10, `handsOverToRecording`) ---
await go('/fractionne/timer');
const sansSeance = await evaluate(`[...document.querySelectorAll('a')].some((a) => a.textContent.trim() === 'Enregistrer sans séance')`);
check('lien « Enregistrer sans séance » retiré (lot 102)', sansSeance === false, String(sansSeance));
await go('/fractionne/timer');
console.log('Enregistrer :', await itemButton('Gainage', 'Enregistrer'));
await wait(1500);
check('Enregistrer sur Muscu', (await where()) === '/enregistrer?activite=muscu' && (await raw('.ui-page h1')) === 'Enregistrer', await where());
const muscuSummary = await text('.ivl .ivl-summary');
check('la séance dans la carte du compteur, sans être lancée', muscuSummary.startsWith('8 × 0:40 / 0:20 + 5 × 1:00 / 1:00')
  && (await evaluate(`JSON.parse(localStorage.getItem('tracker.intervalRun') ?? 'null') === null`)) === true, muscuSummary);
const belt = await evaluate(`(() => { const b = [...document.querySelectorAll('input[type=checkbox]')].find((i) => i.closest('label')?.textContent.includes('Ceinture cardio')); return b ? { checked: b.checked, disabled: b.disabled } : null; })()`);
check("ceinture cardio cochée et grisée, FC d'exemple du navigateur", belt?.checked === true && belt?.disabled === true && /FC d'exemple du navigateur/.test(await text('.ui-page')), JSON.stringify(belt));
console.log('lancer le compteur :', await clickText('Lancer le compteur'));
await wait(1200);
check('compteur lancé avant la session', /Départ|Travail 1[/]8/.test(await text('.ivl-live__phase')), await text('.ivl-live__phase'));
console.log('démarrer :', await clickText('Démarrer'));
await wait(3500);
check('session démarrée, le compteur continue', /Travail 1[/]8/.test(await text('.ivl-live__phase'))
  && (await evaluate(`[...document.querySelectorAll('button.ui-btn--danger')].some((b) => b.textContent.includes('Arrêter') && !b.closest('.ivl'))`)), await text('.ivl-live__phase'));
await shoot('timer-muscu');
// « Arrêter » de la session se tient 2 s : le compteur s'arrête avec elle (Q12 du 28/10).
console.log('arrêter la session :', await evaluate(`(() => { const b = [...document.querySelectorAll('button.ui-btn--danger')].find((x) => x.textContent.includes('Arrêter') && !x.disabled && !x.closest('.ivl')); if (!b) return 'absent'; window.__stopButton = b; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); return 'ok'; })()`));
await wait(2300);
await evaluate(`(() => { const b = window.__stopButton; b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })); b.click(); return 'ok'; })()`);
await wait(2500);
check('session arrêtée : le compteur arrêté avec elle', /Séance arrêtée/.test(await text('.ivl-done'))
  && /"kind":"stop"/.test(await evaluate(`localStorage.getItem('tracker.intervalRun') ?? ''`)), await text('.ivl-done'));
check('session terminée, rangée seulement à « Analyser »', /Session terminée/i.test(await text('.ui-page')) && /Analyser/i.test(await text('.ui-page')), (await text('.ui-page')).slice(0, 160));
check('muscu : position jamais demandée', (await geoCalls()) === geoBefore, `${(await geoCalls()) - geoBefore} demande(s)`);
console.log('jeter :', await clickText('Jeter'));
await wait(800);

// --- 4 ter. (lot 103, 31/10) Séance terminée pendant l'enregistrement : « Arrêter l'enregistrement » proposé, tenu, jamais seul ---
await go('/fractionne/timer');
console.log('Enregistrer :', await itemButton('Gainage', 'Enregistrer'));
await wait(1500);
console.log('lancer le compteur :', await clickText('Lancer le compteur'));
await wait(800);
console.log('démarrer :', await clickText('Démarrer'));
await wait(2500);
// « Passer » jusqu'au bout de la séance (départ et 26 phases).
const skips = await evaluate(`(async () => { let n = 0; while (n < 60 && !document.querySelector('.ivl-done')) { const b = [...document.querySelectorAll('.ivl button')].find((x) => x.textContent.trim() === 'Passer'); if (!b) break; b.click(); n++; await new Promise((r) => setTimeout(r, 60)); } return n; })()`);
await wait(800);
const endActions = await evaluate(`[...document.querySelectorAll('.ivl .ivl-actions button')].map((b) => b.textContent.trim()).join(', ')`);
check("séance terminée pendant l'enregistrement : « Arrêter l'enregistrement » à côté de « Fermer »", /Séance terminée/.test(await text('.ivl-done'))
  && endActions === "Fermer, Arrêter l'enregistrement", `${skips} passe(s) | ${await text('.ivl-done')} | ${endActions}`);
check("l'enregistrement continue après la fin de la séance", (await evaluate(`[...document.querySelectorAll('button.ui-btn--danger')].some((b) => b.textContent.trim() === 'Arrêter' && !b.closest('.ivl'))`)) === true
  && !/Session terminée/i.test(await text('.ui-page')));
// Un appui court ne fait que rappeler le geste.
await evaluate(`(() => { const b = [...document.querySelectorAll('.ivl button.ui-btn--danger')].find((x) => x.textContent.includes("Arrêter l'enregistrement")); b?.click(); return 'ok'; })()`);
await wait(500);
check('appui court : le geste rappelé, la session continue', /Maintenir 2 s pour arrêter/i.test(await text('.ivl .ivl-actions')) && !/Session terminée/i.test(await text('.ui-page')),
  await text('.ivl .ivl-actions'));
console.log("tenir « Arrêter l'enregistrement » :", await evaluate(`(() => { const b = [...document.querySelectorAll('.ivl button.ui-btn--danger')].find((x) => !x.disabled); if (!b) return 'absent'; window.__stopButton = b; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); return 'ok'; })()`));
await wait(2300);
await evaluate(`(() => { const b = window.__stopButton; b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })); b.click(); return 'ok'; })()`);
await wait(2500);
check("tenu 2 s : l'écran « Session terminée », comme « Arrêter »", /Session terminée/i.test(await text('.ui-page')) && /Analyser/i.test(await text('.ui-page')), (await text('.ui-page')).slice(0, 160));
check("session arrêtée : plus d'« Arrêter l'enregistrement » dans le compteur", !/Arrêter l'enregistrement/.test(await text('.ivl')), await text('.ivl'));
console.log('jeter :', await clickText('Jeter'));
await wait(800);

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
await go('/fractionne/timer');
console.log('Timer :', await itemButton('Gainage', 'Timer'));
await wait(1500);
check('390 px : compteur en marche sans débordement', (await overflow()) <= 0 && (await evaluate(`!!document.querySelector('.ivl-live')`)), `${await overflow()} px`);
await shoot('timer-compteur-390');
console.log('modifier :', await clickText('Modifier', '.ivl button'));
await wait(300);
await go('/fractionne');
check('390 px : tuiles sans débordement', (await overflow()) <= 0, `${await overflow()} px`);
await shoot('timer-tuiles-390');

console.log(logs.length ? `console :\n${[...new Set(logs)].join('\n')}` : 'console : aucune erreur');
console.log(failures === 0 ? 'tout passe' : `${failures} échec(s)`);
await close();
