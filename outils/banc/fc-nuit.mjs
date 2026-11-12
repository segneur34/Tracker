// Banc de test : test « FC de nuit » de l'Entraînement (lot 213).
// Usage : node fc-nuit.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau ; importe `/src/...` dans la page (`dev`). Environ 40 s. Le script :
//  1. importe une séance de muscu témoin (30 min, FC) ; son onglet « cardio » propose « La retenir » ; relève Statistiques ;
//  2. fabrique dans la page une nuit de 8 h à 1 Hz sans position (`exampleNightHr`, écrite par `buildHeartRateGpx`
//     avec le calcul `night-hr`, comme l'enregistreur), l'importe : fiche rangée sous `night-hr`, nom « Nuit du … » ;
//     Statistiques inchangées (une nuit est hors des cumuls) ;
//  3. ouvre son analyse (temps d'ouverture relevé, sur stderr) : onglet « test » comparé au calcul pur rejoué dans la
//     page (FC la plus basse et son heure, « au milieu de la nuit », 3 sursauts, part mesurée) ; points donnés aux
//     courbes ; « cardio » sans charge ni « La retenir » ; « réglages » : l'activité « FC de nuit » choisie et proposée ;
//     ligne de bibliothèque « creux … bpm » ;
//  4. joue une nuit courte en direct : page du test, « Lancer », Enregistrer prêt sur « FC de nuit », « Démarrer » avec
//     la ceinture d'exemple (FC de nuit), page sombre lisible, activité figée, aucun « [bips] » ; « Arrêter » tenu :
//     session rangée, analyse ouverte avec « Nuit incomplète » ; Statistiques toujours inchangées ;
//  5. la FC max de la muscu retenue (zones connues) : la muscu montre la charge, la nuit non.
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BLOCKED_URLS, connect } from './lib/cdp.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node fc-nuit.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

const { evaluate, go: goRaw, settle, waitFor, wait, blockNetwork, importGpx, records, shoot, check, finish, logs, onMessage } =
  await connect({ port, width: 1400, height: 1000, shotDir });
const go = async (path, max = 4000) => {
  await goRaw(path, max);
  await waitFor(`Boolean(document.querySelector('.shell-main'))`, { timeout: 5000, every: 50, label: 'premier rendu' });
};
/** Lignes « [bips] … » de la console (`platform/beeper.ts`), dans l'ordre. */
const sounds = [];
onMessage((msg) => {
  if (msg.method !== 'Runtime.consoleAPICalled' || msg.params.type !== 'debug') return;
  const text = msg.params.args.map((a) => a.value ?? a.description).join(' ');
  if (text.startsWith('[bips]')) sounds.push(text);
});
const clickText = (text, selector = 'button') => evaluate(`(() => {
  const all = [...document.querySelectorAll(${JSON.stringify(selector)})];
  const b = all.find((x) => x.textContent.trim() === ${JSON.stringify(text)}) ?? all.find((x) => x.textContent.includes(${JSON.stringify(text)}));
  if (!b) return 'absent'; if (b.disabled) return 'désactivé'; b.click(); return 'ok';
})()`);
const setTab = (label, wanted) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!t) return 'absent';
  if ((t.getAttribute('aria-pressed') === 'true') !== ${wanted}) t.click();
  return 'ok';
})()`);
const panelExpr = (title) => `[...document.querySelectorAll('.an-carte-panels > *')].find((p) => (p.querySelector('[role=button]')?.textContent.trim() ?? '').startsWith(${JSON.stringify(title)}))`;
const panel = async (title) => (await evaluate(`${panelExpr(title)}?.innerText.replace(/\\s+/g, ' ') ?? '(absent)'`));
/** Chiffre d'une tuile du panneau `title`, par le début de son libellé : « valeur · détail ». */
const tile = (title, label) => evaluate(`(() => {
  const p = ${panelExpr(title)};
  const s = p && [...p.querySelectorAll('.an-sheet__stat')].find((el) => el.querySelector('.an-sheet__stat-label')?.textContent.trim().startsWith(${JSON.stringify(label)}));
  if (!s) return null;
  return [...s.children].slice(1).map((c) => c.textContent.trim()).filter(Boolean).join(' · ');
})()`);
/** Tuiles de Statistiques, « libellé : valeur », dans l'ordre. */
const statsText = async () => {
  await go('/statistiques', 5000);
  await waitFor(`document.querySelectorAll('.an-sheet__stat').length > 0`, { timeout: 5000, label: 'statistiques' });
  return evaluate(`[...document.querySelectorAll('.an-sheet__stat')].map((s) => s.querySelector('.an-sheet__stat-label')?.textContent.trim() + ' : ' + s.querySelector('.an-sheet__stat-value')?.textContent.trim()).join(' ; ')`);
};
/** Points des courbes du panneau `title` (commandes des tracés Recharts). */
const curvePoints = (title) => evaluate(`(() => {
  const p = ${panelExpr(title)};
  return p ? [...p.querySelectorAll('path.recharts-curve')].map((c) => ((c.getAttribute('d') ?? '').match(/[MLC]/g) ?? []).length) : [];
})()`);
const timed = async (label, action) => {
  const started = Date.now();
  await action();
  const ms = Date.now() - started;
  process.stderr.write(`[fc-nuit] ${label} : ${ms} ms\n`);
  // Les durées sont masquées dans le relevé (« N ms ») : en clair dans le dossier de travail du script.
  appendFileSync(join(process.env.TEMP ?? tmpdir(), 'fc-nuit-temps.txt'), `${label} : ${ms} ms\n`);
  return ms;
};
await blockNetwork(BLOCKED_URLS);

// --- 1. Séance de muscu témoin, Statistiques ---
const T_MUSCU = Date.UTC(2026, 10, 8, 17, 0, 0);
const muscuPts = [];
for (let k = 0; k <= 1800; k += 2) {
  const bpm = Math.round(100 + 50 * Math.abs(Math.sin(k / 120)));
  muscuPts.push(`<trkpt><time>${new Date(T_MUSCU + k * 1000).toISOString()}</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${bpm}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`);
}
const muscuGpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1" `
  + `xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><name>Séance</name><type>muscu</type><trkseg>\n${muscuPts.join('\n')}\n</trkseg></trk></gpx>\n`;
await go('/fractionne');
console.log('import muscu :', await importGpx(muscuGpx, 'muscu.gpx'));
await waitFor(async () => (await records())?.some((r) => r.sport === 'muscu'), { timeout: 8000, label: 'fiche muscu' });
await settle({ max: 2000, label: 'import muscu' });
const muscuRec = (await records()).find((r) => r.sport === 'muscu');
await go(`/fractionne/analyse?session=${encodeURIComponent(muscuRec?.gpx ?? '')}`, 5000);
await waitFor(`Boolean(document.querySelector('.an-carte-col'))`, { timeout: 5000, label: 'analyse muscu' });
await clickText('avancé', '.an-carte-col .ui-tab');
await wait(300);
await setTab('cardio', true);
await settle({ max: 1500 });
// Sans FC max dans Pratiquant, la muscu propose de retenir la sienne ; la charge attend des zones (5e partie).
check('témoin : la muscu propose « La retenir » dans « cardio »', /La retenir/i.test(await panel('Cardio')), (await panel('Cardio')).slice(0, 200));
const statsBefore = await statsText();
console.log('statistiques (muscu seule) :', statsBefore);

// --- 2. Nuit synthétique, écrite comme l'enregistreur, importée ---
const T0 = Date.UTC(2026, 10, 9, 22, 10, 0);
const built = await evaluate(`(async () => {
  const { buildHeartRateGpx } = await import('/src/recording/gpxWriter.ts');
  const { exampleNightHr, EXAMPLE_NIGHT, NIGHT_HR_TEST } = await import('/src/recording/nightHrTest.ts');
  const { parseGpx } = await import('/src/core/gpxParser.ts');
  const { heartRatePointsFrom } = await import('/src/core/heartRateSession.ts');
  const { nightHrResults } = await import('/src/core/nightHeartRate.ts');
  const fixes = [];
  for (let t = 0; t <= EXAMPLE_NIGHT.durationS; t++) fixes.push({ timeMs: ${T0} + t * 1000, heartRateBpm: exampleNightHr(t) });
  const gpx = buildHeartRateGpx([fixes], { name: 'FC de nuit', sport: 'night-hr' });
  const r = nightHrResults(heartRatePointsFrom(parseGpx(gpx).timedPoints), NIGHT_HR_TEST, {});
  const hhmm = (ms) => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  return { gpx, points: fixes.length, low: Math.round(r.low.bpm), lowAt: hhmm(r.low.atMs), place: r.low.place, surges: r.surges.length,
    coverage: Math.round(r.coverage * 100), avg: Math.round(r.avgBpm) };
})()`);
console.log(`nuit : ${built.points} points ; calcul pur : creux ${built.low} bpm à ${built.lowAt} (${built.place}), ${built.surges} sursauts, `
  + `part mesurée ${built.coverage} %, moyenne ${built.avg} bpm`);
check('GPX écrit comme l\'enregistreur : sans position, type night-hr', !/lat=/.test(built.gpx) && built.gpx.includes('<type>night-hr</type>'));
await go('/fractionne');
console.log('import nuit :', await importGpx(built.gpx, 'nuit.gpx'));
await waitFor(async () => (await records())?.some((r) => r.sport === 'night-hr'), { timeout: 20000, label: 'fiche nuit' });
await settle({ max: 2000, label: 'import nuit' });
const nightRec = (await records()).find((r) => r.sport === 'night-hr');
check('fiche de la nuit : calcul night-hr, résumé de nuit', nightRec?.sport === 'night-hr' && nightRec?.summary?.night?.lowBpm != null,
  JSON.stringify({ sport: nightRec?.sport, night: nightRec?.summary?.night ?? null }));
console.log('nom de la nuit :', nightRec?.name);
check('nom « Nuit du 9 au 10/11 »', nightRec?.name === 'Nuit du 9 au 10/11', nightRec?.name);
const statsNight = await statsText();
check('Statistiques : la nuit importée ne compte pas', statsNight === statsBefore, statsNight);

// --- 3. Analyse de la nuit ---
const nightPath = `/fractionne/analyse?session=${encodeURIComponent(nightRec?.gpx ?? '')}`;
await go('/fractionne');
const openMs = await timed('ouverture de l\'analyse (28 801 points)', async () => {
  await goRaw(nightPath, 15000);
  await waitFor(async () => (await tile('Général', 'Durée')) !== null, { timeout: 15000, every: 50, label: 'général de la nuit' });
});
check('ouverture de l\'analyse sous 5 s', openMs < 5000, `${openMs} ms`);
const h1 = await evaluate(`document.querySelector('h1')?.textContent`);
check('titre « Analyse FC de nuit »', h1 === 'Analyse FC de nuit', h1);
check('nom de la session affiché', (await evaluate('document.body.innerText')).includes('Nuit du 9 au 10/11'));
console.log('général :', await panel('Général'));
console.log('points des courbes de « général » :', JSON.stringify(await curvePoints('Général')));
const testMs = await timed('onglet « test »', async () => {
  await setTab('test', true);
  await waitFor(async () => (await tile('Test FC de nuit', 'FC la plus basse')) !== null, { timeout: 10000, every: 50, label: 'onglet test' });
});
check('onglet « test » sous 3 s', testMs < 3000, `${testMs} ms`);
const lowTile = await tile('Test FC de nuit', 'FC la plus basse');
console.log('FC la plus basse :', lowTile);
check('FC la plus basse et son heure = calcul pur', lowTile?.replace(/\s+/g, ' ') === `${built.low} bpm à ${built.lowAt}`, lowTile);
const placeTile = await tile('Test FC de nuit', 'Place du creux');
check('creux « au milieu de la nuit »', placeTile?.startsWith('au milieu de la nuit') && built.place === 'milieu', placeTile);
const surgesTile = await tile('Test FC de nuit', 'Sursauts');
check('3 sursauts', surgesTile === '3' && built.surges === 3, surgesTile);
const coverTile = await tile('Test FC de nuit', 'Part mesurée');
check('part mesurée = calcul pur', coverTile?.startsWith(`${built.coverage} %`), coverTile);
check('pas de « Nuit incomplète » sur 8 h', !(await panel('Test FC de nuit')).includes('Nuit incomplète'));
console.log('test :', await panel('Test FC de nuit'));
await waitFor(async () => (await curvePoints('Test FC de nuit')).length > 0, { timeout: 5000, label: 'courbe de la nuit' });
const testPoints = await curvePoints('Test FC de nuit');
console.log('points des courbes de « test » :', JSON.stringify(testPoints));
check('courbe de la nuit tracée, décimée (≤ 1 000 points)', testPoints.length > 0 && testPoints.every((n) => n <= 1000), JSON.stringify(testPoints));
await shoot('fc-nuit-test');
await setTab('test', false);
await clickText('avancé', '.an-carte-col .ui-tab');
await wait(300);
const cardioMs = await timed('onglet « cardio »', async () => {
  await setTab('cardio', true);
  await waitFor(async () => (await panel('Cardio')) !== '(absent)', { timeout: 10000, every: 50, label: 'onglet cardio' });
  await settle({ max: 3000 });
});
check('onglet « cardio » sous 3 s', cardioMs < 3000, `${cardioMs} ms`);
const cardio = await panel('Cardio');
check('« cardio » de la nuit : ni charge ni « La retenir »', !/Charge/.test(cardio) && !/La retenir/.test(cardio), cardio.slice(0, 300));
const cardioPoints = await curvePoints('Cardio');
console.log('points des courbes de « cardio » :', JSON.stringify(cardioPoints));
check('courbes de « cardio » décimées (≤ 1 000 points)', cardioPoints.every((n) => n <= 1000), JSON.stringify(cardioPoints));
await setTab('cardio', false);
await setTab('réglages', true);
await settle({ max: 1500 });
const shownActivity = await evaluate(`${panelExpr('Réglages')}?.querySelector('.activity-select__name')?.textContent ?? null`);
check('réglages : l\'activité de la session, « FC de nuit »', shownActivity === 'FC de nuit', shownActivity);
await evaluate(`${panelExpr('Réglages')}?.querySelector('button.activity-select')?.click()`);
await wait(400);
const options = await evaluate(`[...document.querySelectorAll('[role=option]')].map((o) => o.textContent.trim() + (o.getAttribute('aria-selected') === 'true' ? ' (choisie)' : '')).join(', ')`);
console.log('activités proposées :', options);
check('liste : « FC de nuit » choisie, les muscus proposées', options.includes('FC de nuit (choisie)') && options.includes('Muscu'), options);
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await wait(300);
await go('/fractionne', 4000);
const libRow = (await evaluate(`[...document.querySelectorAll('.lib-row__stats')].map((n) => n.innerText).find((t) => t.includes('creux'))`)) ?? '';
console.log('ligne de bibliothèque :', libRow);
check('ligne de bibliothèque « 8 h · creux … bpm »', libRow.replace(/\s+/g, ' ').includes(`creux ${built.low} bpm`) && !libRow.includes('FC de nuit'), libRow);

// --- 4. Nuit courte en direct ---
await go('/fractionne/tests/fc-nuit');
console.log('lancer :', await clickText('Lancer'));
await waitFor(`location.pathname === '/enregistrer'`, { timeout: 5000, label: 'Enregistrer' });
await settle({ max: 2000 });
const recUrl = await evaluate('location.pathname + location.search');
check('Enregistrer prêt sur le test', recUrl === '/enregistrer?activite=night-hr&test=fc-nuit', recUrl);
const testPicked = await evaluate(`document.querySelector('.ui-segmented[aria-label="Test"] [role=radio][aria-checked=true]')?.textContent ?? '(absent)'`);
check('rangée « Test » sur « FC de nuit »', testPicked === 'FC de nuit', testPicked);
// « connectée » suivi de la FC (pas « non connectée ») : « Démarrer » partirait sinon sans la ceinture.
await waitFor(`/(^|\\s)connectée\\s+\\d+ bpm/.test(document.querySelector('.rec-page').innerText)`, { timeout: 8000, label: 'ceinture d\'exemple' });
sounds.length = 0;
console.log('démarrer :', await clickText('Démarrer'));
await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Arrêter'))`, { timeout: 8000, label: 'enregistrement' });
await wait(6000);
check('page de nuit en présentation sombre', await evaluate(`Boolean(document.querySelector('.rec-page--nuit.ui-dark-scope'))`));
const statusActivity = await evaluate(`document.querySelector('.rec-status__activity')?.innerText.replace(/\\s+/g, ' ') ?? '(absent)'`);
check('activité affichée, pas de liste pour la changer', /FC de nuit/.test(statusActivity) && !(await evaluate(`Boolean(document.querySelector('.rec-status button.activity-select'))`)), statusActivity);
// FC tenue par l'enregistreur : celle de la nuit d'exemple (50 à 70 bpm au coucher), pas celle de la muscu (95 à 135).
const liveHeart = await evaluate(`(async () => {
  const r = await import('/src/hooks/useRecorder.ts');
  return { bpm: r.getRecorderState().heartRate?.bpm ?? null, fixes: r.getLiveHeartSegments().flat().map((f) => f.heartRateBpm ?? null) };
})()`);
check('ceinture d\'exemple : une FC de nuit (sous 90 bpm), enregistrée', liveHeart.fixes.length >= 4 && liveHeart.fixes.every((b) => b !== null && b > 40 && b < 90),
  JSON.stringify(liveHeart));
check('FC du moment affichée', new RegExp(`BPM\\s+${liveHeart.bpm}\\b`, 'i').test(await evaluate(`document.querySelector('.rec-page').innerText`)), String(liveHeart.bpm));
// Lisibilité : contraste de chaque texte visible contre le fond qui l'entoure (WCAG), et anneau de focus du thème sombre.
const legibility = await evaluate(`(() => {
  const rgb = (c) => { const m = c.match(/[\\d.]+/g); return m ? m.slice(0, 4).map(Number) : null; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c && (c[3] === undefined || c[3] > 0.5)) return c; } return [255, 255, 255]; };
  const page = document.querySelector('.rec-page--nuit');
  // Le bouton « Arrêter » garde le rouge du thème sombre (\`--recording\`, blanc dessus : 4,0), relevé à part.
  const probe = document.createElement('span');
  probe.style.color = 'var(--recording)';
  page.appendChild(probe);
  const stopRed = rgb(getComputedStyle(probe).color).slice(0, 3).join(',');
  probe.remove();
  let worst = { ratio: 99, need: 1, text: '' };
  let stop = null;
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || !el || el.closest('svg, [disabled], [aria-disabled=true]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
    const style = getComputedStyle(el);
    const bg = bgOf(el);
    const a = lum(rgb(style.color)), b = lum(bg);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (bg.slice(0, 3).join(',') === stopRed) { stop = Math.round(ratio * 10) / 10; continue; }
    // Grand texte (WCAG : 24 px, ou 18,66 px en gras) : 3 suffit ; sinon 4,5.
    const size = parseFloat(style.fontSize);
    const need = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700) ? 3 : 4.5;
    if (ratio / need < worst.ratio / worst.need) worst = { ratio: Math.round(ratio * 10) / 10, need, text: n.textContent.trim().slice(0, 40) };
  }
  const ring = getComputedStyle(page).getPropertyValue('--ring-ink').trim();
  return { worst, stop, ring, bg: getComputedStyle(page).backgroundColor };
})()`);
console.log('lisibilité :', JSON.stringify(legibility));
check('page de nuit lisible : contraste d\'au moins 4,5 (3 en grand texte)', legibility.worst.ratio >= legibility.worst.need, JSON.stringify(legibility.worst));
check('« Arrêter » : rouge du thème sombre, au moins 3', legibility.stop !== null && legibility.stop >= 3, String(legibility.stop));
check('anneau de focus du thème sombre', legibility.ring.toLowerCase().includes('#e8ecf0'), legibility.ring);
await shoot('fc-nuit-direct');
const bipsLive = [...sounds];
check('aucun « [bips] » pendant la nuit', bipsLive.length === 0, bipsLive.join(' | '));
// « Arrêter » se tient : appui, attente, puis relâcher.
const down = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Arrêter') && !x.disabled); if (!b) return 'absent'; window.__stopButton = b; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); return 'ok'; })()`);
console.log('arrêter :', down);
await wait(2300);
await evaluate(`(() => { const b = window.__stopButton; b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })); b.click(); return 'ok'; })()`);
await waitFor(`location.pathname.endsWith('/analyse')`, { timeout: 15000, label: 'analyse' });
await settle({ max: 5000, label: 'analyse' });
console.log('sons à l\'arrêt :', sounds.slice(bipsLive.length).map((s) => s.replace(/ à \d+$/, '')).join(' | ') || 'aucun');
const recs = await records();
const live = recs.filter((r) => r.sport === 'night-hr').find((r) => r.gpx !== nightRec?.gpx);
check('session du direct rangée sous « FC de nuit »', live?.sport === 'night-hr' && live?.activityId === 'night-hr', JSON.stringify(live ? { sport: live.sport, activityId: live.activityId } : recs.map((r) => r.sport)));
check('nom « Nuit du … »', /^Nuit du /.test(live?.name ?? ''), live?.name);
await setTab('test', true);
await waitFor(async () => (await panel('Test FC de nuit')) !== '(absent)', { timeout: 8000, label: 'onglet test du direct' });
check('analyse du direct : « Nuit incomplète »', (await panel('Test FC de nuit')).includes('Nuit incomplète'), (await panel('Test FC de nuit')).slice(0, 200));
await shoot('fc-nuit-fin');
const statsLive = await statsText();
check('Statistiques : la nuit enregistrée ne compte pas non plus', statsLive === statsBefore, statsLive);

// --- 5. Charge : avec une FC max dans Pratiquant (celle de la muscu, retenue), la muscu la montre, pas la nuit ---
/** Ouvre l'onglet « cardio » (sous « avancé ») de la session `path`, rend son texte. */
const cardioOf = async (path) => {
  await go(path, 15000);
  await waitFor(`Boolean(document.querySelector('.an-carte-col .ui-tab'))`, { timeout: 15000, label: 'onglets' });
  await clickText('avancé', '.an-carte-col .ui-tab');
  await wait(300);
  await setTab('cardio', true);
  await waitFor(async () => (await panel('Cardio')) !== '(absent)', { timeout: 10000, label: 'cardio' });
  await settle({ max: 2000 });
  return panel('Cardio');
};
await cardioOf(`/fractionne/analyse?session=${encodeURIComponent(muscuRec?.gpx ?? '')}`);
console.log('retenir la FC max de la muscu :', await clickText('La retenir'));
await settle({ max: 1500 });
const muscuCardio = await panel('Cardio');
check('témoin : la muscu montre la charge', /Charge/.test(muscuCardio), muscuCardio.slice(0, 300));
const nightCardio = await cardioOf(nightPath);
check('« cardio » de la nuit : pas de charge, zones connues', !/Charge/.test(nightCardio), nightCardio.slice(0, 300));

console.log(logs.length ? `console :\n${[...new Set(logs)].join('\n')}` : 'console : aucune erreur');
await finish();
