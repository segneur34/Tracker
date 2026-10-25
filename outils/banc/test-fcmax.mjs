// Banc de test : test de FC max de l'Entraînement (chantier du 24/10, lot B).
// Usage : node test-fcmax.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Le script vérifie :
//  1. la tuile « Tests » de la page Entraînement, la liste des tests, la page du protocole (déroulé, bips, graphique,
//     réglages) ; l'échauffement réglé à 3 min, retenu ;
//  2. « Lancer » : Enregistrer ouvert prêt (Entraînement › Tests › FC max), sans le compteur ;
//  3. la case « FC repos » de la rangée « Test » : pas de « Démarrer », « Ouvrir le test » mène à sa page ;
//  4. rejeu ×10 d'une sortie synthétique avec FC (échauffement de 3 min, 6 paliers tenus, un lâché, récupération) :
//     la carte « Test » suit les phases, la suite des signaux « [test] » est celle de `stepFitnessTest` rejoué dans la
//     page sur les mêmes positions, les « [bips] » sont ceux de leurs motifs ; « Analyser » range le test dans la fiche ;
//  5. à 390 × 844 et à 320 px : les pages sans débordement.
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    if (msg.params.type === 'debug' && /^\[(bips|compteur|test)\]/.test(text)) sounds.push(text);
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
check('déroulé : 8 min en zones 2 à 3, 110 à 147 bpm (FC max 184 estimée à 35 ans)', /Échauffement, 8 min/.test(page) && /zones 2 à 3 du cardio : de 110 à\s*147 bpm/.test(page), page.slice(0, 300));
check('les bips : 1, 2, 3 courts, long', /1 court\s*bien/.test(page) && /2 courts\s*trop vite/.test(page) && /3 courts\s*accélère/.test(page), '');
check('ceinture et santé', /Ceinture cardio \(ou autre capteur de FC\) connectée/.test(page) && /Effort maximal/.test(page), '');
check("zones estimées par l'âge par défaut, dit", /184 bpm, estimée par l'âge \(35 ans par défaut/.test(page), '');
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

// --- 3. FC repos dans la rangée « Test » ---
await go('/enregistrer?activite=run-test&test=fc-max');
console.log('test FC repos :', await clickText('FC repos', '.ui-segmented[aria-label="Test"] [role=radio]'));
await wait(300);
check('FC repos : pas de « Démarrer », « Ouvrir le test », pas de carte du test',
  (await evaluate(`![...document.querySelectorAll('button')].some((b) => b.textContent.includes('Démarrer'))`))
  && (await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Ouvrir le test')`))
  && !(await evaluate(`/Test FC max/.test(document.querySelector('.ui-page').innerText)`)), '');
check('FC repos : le protocole suit le choix', (await evaluate(`[...document.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/fractionne/tests/fc-repos')`)) === true);
await shoot('fcmax-enregistrer-fcrepos');
console.log('ouvrir le test :', await clickText('Ouvrir le test'));
await wait(1000);
check('« Ouvrir le test » mène à la page de la FC repos', (await evaluate('location.pathname')) === '/fractionne/tests/fc-repos', await evaluate('location.pathname'));
await go('/enregistrer?activite=run-test&test=fc-repos');
check('&test=fc-repos accepté', (await segmented('Test')) === 'FC repos', await segmented('Test'));

// --- 4. Rejeu ---
// Échauffement de 3 min (réglé en 1) à 2 m/s, FC montée à 125 bpm (zones 2 à 3 : 110 à 147 à 35 ans) ; rampe de départ 7 km/h,
// tenue sur 6 paliers puis lâchée de 0,5 m/s ; récupération à 1,2 m/s.
const T0 = Date.now() - 3 * 3600_000;
const LAT = 43.7;
const M_PER_DEG_LON = (Math.PI / 180) * 6371e3 * Math.cos((LAT * Math.PI) / 180);
const V0 = 7 / 3.6;
const STEP = 0.6 / 3.6;
const speedAt = (t) => (t < 180 ? 2 : t < 540 ? V0 + Math.floor((t - 180) / 60) * STEP + 0.02 : t < 575 ? V0 + 6 * STEP - 0.5 : 1.2);
const hrAt = (t) => (t < 60 ? 70 + (55 * t) / 60 : t < 180 ? 125 : t < 570 ? 125 + ((185 - 125) * (t - 180)) / 390 : 185 - (t - 570) / 2);
let meters = 0;
const pts = [];
for (let t = 0; t <= 720; t++) {
  const v = Number(speedAt(t).toFixed(2));
  if (t > 0) meters += v;
  pts.push(`<trkpt lat="${LAT}" lon="${(3.85 + meters / M_PER_DEG_LON).toFixed(7)}"><time>${new Date(T0 + t * 1000).toISOString()}</time>`
    + `<extensions><speed>${v}</speed><gpxtpx:TrackPointExtension><gpxtpx:hr>${Math.round(hrAt(t))}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`);
}
const replayPath = join(tmpdir(), 'banc-test-fcmax.gpx');
writeFileSync(replayPath, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1" `
  + `xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><name>Rejeu</name><type>run-test</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`);
const setFile = async (selector, file) => {
  const { result: { root } } = await send('DOM.getDocument', { depth: -1 });
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId, files: [file] });
};
// « Arrêter » se tient : appui, attente, puis relâcher.
const holdStop = async () => {
  const down = await evaluate(`(() => { const b = [...document.querySelectorAll('button.ui-btn--danger')].find((x) => x.textContent.includes('Arrêter') && !x.disabled); if (!b) return 'absent'; window.__stopButton = b; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); return 'ok'; })()`);
  if (down !== 'ok') return down;
  await wait(2300);
  return evaluate(`(() => { const b = window.__stopButton; b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })); b.click(); return 'ok'; })()`);
};
const cardText = () => evaluate(`[...document.querySelectorAll('.ivl-live')].map((n) => n.innerText.replace(/\\s+/g, ' ')).join(' | ')`);
await go('/enregistrer?activite=run-test&test=fc-max');
check('carte du test au repos : résumé à 3 min, zones 2 à 3', /Test FC max/.test(await cardText()) && /Échauffement 3 min en zones 2 à 3 \(110 à 147 bpm\)/.test(await cardText()), await cardText());
await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click(); 'ok'`);
await wait(300);
await setFile('input[type=file][accept=".gpx"]', replayPath);
await wait(800);
await evaluate(`(() => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === '600')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '10'); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
sounds.length = 0;
console.log('démarrer :', await clickText('Démarrer'));
const phasesSeen = new Set();
const started = Date.now();
let rampSeen = false;
while (Date.now() - started < 85_000) {
  await wait(1000);
  const text = await cardText();
  const phase = /Échauffement|Rampe · palier \d+|Récupération|Test fini/.exec(text)?.[0];
  if (phase) phasesSeen.add(phase.replace(/palier \d+/, 'palier'));
  if (!rampSeen && /Rampe · palier 2/.test(text)) {
    rampSeen = true;
    check('carte pendant la rampe : cible, lue, FC, « Finir la rampe »', /Cible 7[.,]6 km\/h · lue/.test(text) && /FC \d+ bpm/.test(text)
      && (await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Finir la rampe')`)), text);
    await shoot('fcmax-direct');
  }
  if (/Test fini/.test(text)) break;
}
check('la carte passe par toutes les phases', ['Échauffement', 'Rampe · palier', 'Récupération', 'Test fini'].every((p) => phasesSeen.has(p)), [...phasesSeen].join(', '));
console.log('arrêter :', await holdStop());
await wait(2500);
const logged = sounds.filter((x) => x.startsWith('[test]')).map((x) => { const m = /^\[test\] (\w+) à (\d+)/.exec(x); return [m[1], Number(m[2])]; });
// Le calcul pur rejoué dans la page, sur les positions du fichier telles que l'enregistreur les reçoit (arrondies).
const pure = await evaluate(`(async () => {
  const { parseGpx } = await import('/src/core/gpxParser.ts');
  const { fixesFromRawPoints, roundFix } = await import('/src/recording/session.ts');
  const ft = await import('/src/recording/fitnessTest.ts');
  const { getSportProfile } = await import('/src/core/sportProfiles.ts');
  const fixes = fixesFromRawPoints(parseGpx(${JSON.stringify(readFileSync(replayPath, 'utf8'))}).rawPoints).map(roundFix);
  let state = ft.startFitnessTest(ft.resolveFitnessTestParams(ft.FITNESS_TESTS['fc-max'], { warmupS: 180 },
    { athlete: { hrMax: null, hrRest: null, hrZones: null }, age: null, zoneFractions: getSportProfile('run-test').heartRate.zoneFractions }));
  const out = [];
  for (const f of fixes) {
    const step = ft.stepFitnessTest(state, { timeMs: f.timeMs, speedMs: f.speedMs, hrBpm: f.heartRateBpm });
    state = step.state;
    if (step.signal) out.push([step.signal, f.timeMs]);
  }
  return { out, tones: out.reduce((n, [s]) => n + ft.TEST_SIGNAL_TONES[s].length, 0), steps: state.test.steps.length, endReason: state.test.endReason };
})()`);
check('signaux du direct = calcul pur rejoué', JSON.stringify(logged) === JSON.stringify(pure?.out),
  `${logged.length} contre ${pure?.out.length} : ${logged.map(([x]) => x).join(' ')}`);
check('rampe de 7 paliers, fin automatique', pure?.steps === 7 && pure?.endReason === 'auto', JSON.stringify({ steps: pure?.steps, endReason: pure?.endReason }));
// Le vibreur du bouton « Arrêter » tenu n'est pas un son du test.
const bips = sounds.filter((x) => /^\[bips\] (court|long|final) /.test(x)).length;
check('un bip par son des motifs', bips === pure?.tones, `${bips} bips pour ${pure?.tones} sons`);
const signalsSeen = new Set(logged.map(([x]) => x));
check('signaux : début, bien, palier, fin de rampe, fin du test', ['debut', 'bien', 'palier', 'finRampe', 'finTest'].every((x) => signalsSeen.has(x)), [...signalsSeen].join(' '));
console.log('analyser :', await clickText('Analyser'));
await wait(5000);
const recs = await evaluate(`(async () => {
  const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions');
  const list = [];
  for await (const [name, h] of dir.entries()) if (name.endsWith('.json')) list.push(JSON.parse(await (await h.getFile()).text()));
  return list;
})()`);
const tested = recs?.find((r) => r.sport === 'run-test');
check('fiche : record.test rangé, signaux identiques', tested?.test?.endReason === 'auto' && tested.test.steps.length === 7
  && JSON.stringify(tested.test.signals.map((x) => [x.s, x.t])) === JSON.stringify(logged),
  JSON.stringify(tested ? { endReason: tested.test?.endReason, steps: tested.test?.steps.length, signals: tested.test?.signals.length } : recs?.map((r) => r.sport)));
// Analyse : titre, onglet « test », ses chiffres (6 paliers tenus depuis 7 km/h : 10,0 km/h ; FC qui culmine à 185), ses deux courbes.
const analysePath = await evaluate('location.pathname + location.search');
check('analyse ouverte, titre « Analyse test »', analysePath.startsWith('/fractionne/analyse') && (await evaluate(`document.querySelector('h1')?.textContent`)) === 'Analyse test',
  `${analysePath} · ${await evaluate(`document.querySelector('h1')?.textContent`)}`);
const panel = `[...document.querySelectorAll('.an-carte-panels > *')].find((n) => /^test fc max/i.test(n.innerText))`;
const panelText = (await evaluate(`${panel}?.innerText.replace(/\\s+/g, ' ')`)) ?? '';
check('onglet « test » ouvert : FC max, dernier palier tenu, paliers', /FC max 18[45] bpm/i.test(panelText) && /Dernier palier tenu 10[.,]0 km\/h/i.test(panelText)
  && /Paliers tenus 6/i.test(panelText) && /Fin de la rampe : vitesse tenue sous la cible/.test(panelText), panelText.slice(0, 400));
check('deux courbes, phases et paliers tracés', (await evaluate(`${panel}?.querySelectorAll('svg.recharts-surface').length`)) === 2
  && (await evaluate(`${panel}?.querySelectorAll('.recharts-reference-area').length`)) >= 6, String(await evaluate(`${panel}?.querySelectorAll('svg.recharts-surface').length`)));
console.log('retenir :', await clickText('Retenir cette FC max'));
await wait(500);
check('« Retenir cette FC max » : retenue dans Pratiquant', /FC max du test retenue dans Pratiquant/.test((await evaluate(`${panel}?.innerText`)) ?? ''), '');
await shoot('fcmax-onglet');
await go('/fractionne', 3000);
const row = (await evaluate(`[...document.querySelectorAll('.lib-row__stats')].map((n) => n.innerText).find((t) => t.includes('FC max'))`)) ?? '';
check('ligne de la bibliothèque : FC max et dernier palier', /FC max 18[45] · 10[.,]0 km\/h/.test(row), row);

// --- 5. Téléphone ---
for (const [w, h] of [[390, 844], [320, 640]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  for (const path of ['/fractionne', '/fractionne/tests', '/fractionne/tests/fc-max', '/enregistrer?activite=run-test&test=fc-max', analysePath]) {
    await go(path, 2000);
    check(`${w} px : ${path} sans débordement`, (await overflow()) <= 0, `${await overflow()} px`);
  }
  await go('/fractionne/tests/fc-max', 2000);
  await shoot(`fcmax-protocole-${w}`);
}

console.log(logs.length ? `console :\n${[...new Set(logs)].join('\n')}` : 'console : aucune erreur');
console.log(failures === 0 ? 'tout passe' : `${failures} échec(s)`);
ws.close();
