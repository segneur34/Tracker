// Banc de test : test de FC repos de l'Entraînement (24/10).
// Usage : node test-fcrepos.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Pas de ceinture dans le navigateur : la page joue une FC d'exemple
// (`exampleRestingHr`), à ×1 pour le décompte et la mesure, à ×30 (`?vitesse=30`) pour le test entier. Le script vérifie :
//  1. la tuile « FC repos » dans Tests, la page (déroulé, aucun GPS demandé) ;
//  2. à ×1 : le décompte de préparation, la mesure (courbe qui se remplit, FC lue), « Annuler » qui ne garde rien ;
//  3. à ×30 : les bips (un court, un long), le résultat (moyenne de 30 s la plus basse après la première minute, comparée à un calcul
//     refait ici sur la même FC d'exemple), la fenêtre surlignée, la courbe de 180 secondes, le test gardé ;
//  4. « La retenir » (FC repos de Pratiquant), « Refaire », le test dans « Vos tests », « Retirer » ;
//  5. à 390 et 320 px : les pages sans débordement.
import { connect } from './lib/cdp.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node test-fcrepos.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, wait, waitFor, blockNetwork, shoot, close, logs, onMessage } = await connect({ port, width: 1400, height: 1000, shotDir });
let sounds = [];
onMessage((msg) => {
  if (msg.method !== 'Runtime.consoleAPICalled') return;
  const text = msg.params.args.map((a) => a.value ?? a.description).join(' ');
  if (msg.params.type === 'debug' && /^\[bips\]/.test(text)) sounds.push(text);
});
const clickText = (text, selector = 'button') => evaluate(`(() => {
  const all = [...document.querySelectorAll(${JSON.stringify(selector)})];
  const b = all.find((x) => x.textContent.trim() === ${JSON.stringify(text)}) ?? all.find((x) => x.textContent.includes(${JSON.stringify(text)}));
  if (!b) return 'absent'; if (b.disabled) return 'désactivé'; b.click(); return 'ok';
})()`);
const overflow = () => evaluate('document.documentElement.scrollWidth - window.innerWidth');
const pageText = () => evaluate('document.querySelector(".ui-page").innerText');
const stored = () => evaluate(`JSON.parse(localStorage.getItem('tracker.restingHr') ?? '[]')`);
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ` : ${detail}` : ''}`);
};

// Même FC d'exemple que `exampleRestingHr` (src/recording/restingHrTest.ts), même fenêtre de 30 s, après la première minute.
const WINDOW_S = 30;
const SETTLE_S = 60;
const example = (t) => Math.round(56 + 14 * Math.exp(-t / 30) + 1.5 * Math.sin(t * 1.7) + 1 * Math.sin(t * 0.45 + 1));
const series = Array.from({ length: 180 }, (_, s) => example(s));
let best = Infinity;
let bestFrom = 0;
for (let s = SETTLE_S; s + WINDOW_S <= 180; s++) {
  const mean = series.slice(s, s + WINDOW_S).reduce((a, b) => a + b, 0) / WINDOW_S;
  if (mean < best - 1e-9) { best = mean; bestFrom = s; }
}
const expectedLowest = Math.round(best);

/** Ouvre l'aide « ? » nommée (lot 3 du 24/10 : les explications sont sous un « ? »). */
const openHelp = async (label) => {
  const done = await evaluate(`(() => { const b = document.querySelector('button.ui-help[aria-label="Aide : ${label}"]'); if (!b) return false; if (b.getAttribute('aria-expanded') !== 'true') b.click(); return true; })()`);
  await wait(200);
  return done;
};

await blockNetwork(['https://*']);

// --- 1. Tuile et page ---
await go('/fractionne/seances');
const tiles = await evaluate(`[...document.querySelectorAll('.train-hub[aria-label="Tests"] .ui-subtitle')].map((n) => n.textContent).join(', ')`);
check('liste des tests : FC max, FC repos', tiles === 'FC max, FC repos', tiles);
console.log('tuile :', await clickText('FC repos', '.train-tile'));
await wait(1000);
check('page du test', (await evaluate('location.pathname')) === '/fractionne/tests/fc-repos', await evaluate('location.pathname'));
check('« ? » du déroulé', await openHelp('Déroulé'), '');
const text = await pageText();
check('déroulé : 10 s, 3 min, bip court puis long, moyenne de 30 s après 60 s', /10 s pour vous poser, puis un bip court/.test(text) && /3 min/.test(text) && /bip long à la fin/.test(text) && /moyenne de 30 s la plus basse après les 60 premières secondes/.test(text), '');
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
check('résultat affiché', /Résultat/i.test(text3) && /Moyenne de 30 s la plus basse/i.test(text3), text3.slice(0, 120));
const shown = await evaluate(`Number(document.querySelector('.rest-result__bpm')?.textContent)`);
check(`moyenne de 30 s la plus basse = ${expectedLowest} (calcul refait ici)`, shown === expectedLowest, `affiché ${shown}`);
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
check(`fenêtre ${fmt(bestFrom)} à ${fmt(bestFrom + WINDOW_S)}`, text3.includes(`de ${fmt(bestFrom)} à ${fmt(bestFrom + WINDOW_S)}`), '');
const chart = await evaluate(`(() => ({ svgs: document.querySelectorAll('.rest-chart svg.recharts-surface').length, areas: document.querySelectorAll('.rest-chart .recharts-reference-area').length, lines: document.querySelectorAll('.rest-chart .recharts-reference-line').length, ticks: [...document.querySelectorAll('.rest-chart svg text')].map((n) => n.textContent).filter((t) => t.length <= 4 && t.includes(':')).join(' ') }))()`);
check('courbe : un graphe, fenêtre surlignée, repère de la valeur, axe 0:00 à 3:00', chart.svgs === 1 && chart.areas === 1 && chart.lines === 1 && /0:00.*0:30.*1:00.*1:30.*2:00.*2:30.*3:00/.test(chart.ticks), JSON.stringify(chart));
check('bips : un court au départ, un long à la fin', sounds.length === 2 && /court/.test(sounds[0]) && /long/.test(sounds[1]), sounds.join(' | '));
const list = await stored();
check('test gardé : 180 secondes, même résultat', list.length === 1 && list[0].series.length === 180 && list[0].lowestBpm === expectedLowest && list[0].fromS === bestFrom && list[0].toS === bestFrom + WINDOW_S, JSON.stringify({ n: list.length, low: list[0]?.lowestBpm, from: list[0]?.fromS }));
check('couverture complète', list[0]?.coverage === 1, String(list[0]?.coverage));
await shoot('fcrepos-resultat');

// --- 4. Retenir, refaire, historique ---
console.log('retenir :', await clickText('La retenir comme FC repos'));
await wait(400);
const runner = await evaluate(`JSON.parse(localStorage.getItem('tracker.runnerProfile') ?? '{}')?.me?.hrRest ?? null`);
check(`FC repos de Pratiquant = ${expectedLowest}`, runner === expectedLowest, String(runner));
const source = await evaluate(`JSON.parse(localStorage.getItem('tracker.runnerProfile') ?? '{}')?.me?.hrRestSource?.kind ?? null`);
check('origine rangée : test', source === 'test', String(source));
check('bouton devenu « Retenue comme FC repos »', /Retenue comme FC repos/i.test(await pageText()), '');
console.log('refaire :', await clickText('Refaire'));
await wait(500);
const text4 = await pageText();
check('« Vos tests » : le test, avec sa valeur', /Vos tests/i.test(text4) && new RegExp(`${expectedLowest} bpm`).test(await evaluate(`document.querySelector('.rest-history')?.innerText ?? ''`)), '');
console.log('courbe du test gardé :', await clickText('Courbe', '.rest-history button'));
await waitFor(`document.querySelectorAll('.rest-history .rest-chart svg.recharts-surface').length === 1`, { timeout: 4000 });
check('courbe du test gardé affichée', (await evaluate(`document.querySelectorAll('.rest-history .rest-chart svg.recharts-surface').length`)) === 1, String(await evaluate(`(() => { const d = document.querySelector('.rest-history__chart'); const r = d?.getBoundingClientRect(); const li = document.querySelector('.rest-history__item')?.getBoundingClientRect(); return 'graphe ' + Math.round(r?.width ?? -1) + ' × ' + Math.round(r?.height ?? -1) + ' dans une ligne de ' + Math.round(li?.width ?? -1); })()`)));
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
await close();
