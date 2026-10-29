// Banc de test : analyse d'une séance sans positions (muscu, lot I du 25/10), relevée pour la neutralité du lot 62.
// Usage : node muscu.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Dure environ 20 s (lib/cdp.mjs). Le script :
//  1. importe dans l'Entraînement deux séances de muscu sans positions (points à l'heure avec la FC seule) ;
//  2. ouvre la première : titre « Analyse muscu », première rangée « général · avancé », texte de « Général » ;
//  3. « avancé » : la rangée dépliée, « général » fermé ; « cardio », « matériel et notes » et « réglages »
//     ouverts tour à tour, leurs textes relevés ; « avancé » refermé rend « général » ;
//  4. la seconde séance s'ouvre sur « général », « avancé » fermé (23/10) ;
//  5. à 390 × 844 : sans débordement.
import { BLOCKED_URLS, connect } from './lib/cdp.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node muscu.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go: goRaw, settle, waitFor, wait, blockNetwork, importGpx, records, shoot, check, finish, logs } = await connect({ port, width: 1400, height: 1000, shotDir });
/** Navigation, puis attente du premier rendu de l'application. */
const go = async (path, max) => {
  const ms = await goRaw(path, max);
  await waitFor(`Boolean(document.querySelector('.shell-main'))`, { timeout: 5000, every: 50, label: 'premier rendu' });
  return ms;
};
const overflow = () => evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
/** Libellés d'une rangée d'onglets : 0 la première, 1 la rangée « avancé ». */
const row = (k) => evaluate(`[...(document.querySelectorAll('.an-carte-col .an-tabs > .ui-tabs')[${k}]?.querySelectorAll('.ui-tab') ?? [])].map((t) => t.textContent.trim()).join(' | ')`);
const clickTab = (label) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!t) return 'absent';
  t.click();
  return 'ok';
})()`);
const advancedOpen = () => evaluate(`document.querySelector('.an-tabs-advanced-toggle')?.getAttribute('aria-expanded') === 'true'`);
const setTab = (label, wanted) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!t) return 'absent';
  if ((t.getAttribute('aria-pressed') === 'true') !== ${wanted}) t.click();
  return 'ok';
})()`);
const panel = (title) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim().startsWith(${JSON.stringify(title)}));
  return t ? t.closest('.an-carte-panels > *').innerText.replace(/\\n+/g, ' / ') : '(absent)';
})()`);
const panelTitles = () => evaluate(`[...document.querySelectorAll('.an-carte-panels > *')].map((p) => p.querySelector('[role=button]')?.textContent.trim() ?? '?').join(' | ')`);
const title = () => evaluate(`document.querySelector('h1')?.textContent ?? '(absent)'`);
await blockNetwork(BLOCKED_URLS);

// --- Séances synthétiques : points sans position, à l'heure, avec la FC (comme l'enregistreur en muscu) ---
const muscuGpx = (t0, seconds, hrAt) => {
  const pts = [];
  for (let k = 0; k <= seconds; k += 2) {
    pts.push(`<trkpt><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${Math.round(hrAt(k))}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1" `
    + `xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><name>Séance</name><type>muscu</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
};
const T_A = Date.UTC(2026, 9, 6, 17, 0, 0);
const T_B = Date.UTC(2026, 9, 8, 17, 0, 0);
// Séries de 40 s à 150 bpm et plus, repos de 80 s qui redescend vers 105 bpm.
const seriesHr = (k) => (k < 300 ? 90 + k / 10 : (k - 300) % 120 < 40 ? 150 + ((k - 300) % 120) / 2 : 165 - Math.min(60, ((k - 300) % 120) - 40) * 1);
const SESSIONS = [
  { key: 'a', start: T_A, gpx: muscuGpx(T_A, 1800, seriesHr) },
  { key: 'b', start: T_B, gpx: muscuGpx(T_B, 1200, (k) => 100 + 30 * Math.sin(k / 90)) },
];

// --- 1. Import ---
const paths = {};
for (const s of SESSIONS) {
  await go('/fractionne', 3000);
  console.log(`import ${s.key} :`, await importGpx(s.gpx, `muscu-${s.key}.gpx`));
  await waitFor(async () => (await records())?.some((r) => Math.abs((r.summary?.startMs ?? 0) - s.start) < 2000), { timeout: 8000, label: `fiche ${s.key}` });
  await settle({ max: 2000, label: `import ${s.key}` });
  const rec = (await records()).find((r) => Math.abs((r.summary?.startMs ?? 0) - s.start) < 2000);
  paths[s.key] = `/fractionne/analyse?session=${encodeURIComponent(rec?.gpx ?? '')}`;
  check(`séance ${s.key} rangée en muscu`, rec?.sport === 'muscu', rec?.sport);
}

// --- 2. Première séance : titre, « général » ---
await go(paths.a, 5000);
await waitFor(`Boolean(document.querySelector('.an-carte-col'))`, { timeout: 5000, label: 'analyse muscu' });
check('titre « Analyse muscu »', (await title()) === 'Analyse muscu', await title());
check('première rangée « général · avancé »', (await row(0)) === 'général | avancé', await row(0));
check('« avancé » fermé au départ', !(await advancedOpen()) && (await row(1)) === '', await row(1));
console.log('panneaux :', await panelTitles());
console.log('général :', await panel('Général'));
await shoot('muscu-general');

// --- 3. « avancé », cardio, notes, réglages ---
console.log('avancé :', await clickTab('avancé'));
await wait(400);
console.log('rangée avancé :', await row(1));
check('« avancé » ouvert : sa rangée, « général » fermé', (await advancedOpen()) && (await row(1)) !== '' && (await panel('Général')) === '(absent)', await row(1));
for (const [tab, head] of [['cardio', 'Cardio'], ['matériel et notes', 'Matériel'], ['réglages', 'Réglages de la session']]) {
  console.log(`ouvre ${tab} :`, await setTab(tab, true));
  await settle({ max: 1500 });
  console.log(`${tab} :`, await panel(head));
  console.log('panneaux :', await panelTitles());
}
await shoot('muscu-avance');
for (const tab of ['cardio', 'matériel et notes', 'réglages']) console.log(`ferme ${tab} :`, await setTab(tab, false));
await wait(300);
console.log('avancé refermé :', await clickTab('avancé'));
await wait(400);
check('« avancé » refermé : « général » rouvert', !(await advancedOpen()) && (await panel('Général')) !== '(absent)', await panelTitles());

// --- 4. Seconde séance : « général », « avancé » fermé ---
await clickTab('avancé');
await wait(300);
await go(paths.b, 5000);
await waitFor(`Boolean(document.querySelector('.an-carte-col'))`, { timeout: 5000, label: 'analyse muscu b' });
check('séance neuve : « général » ouvert, « avancé » fermé', !(await advancedOpen()) && (await panel('Général')) !== '(absent)', await panelTitles());
console.log('général b :', await panel('Général'));

// --- 5. Téléphone ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go(paths.a, 4000);
check('390 px : sans débordement', (await overflow()) <= 0, `${await overflow()} px`);
await shoot('muscu-390');

console.log(logs.length ? `console :\n${[...new Set(logs)].join('\n')}` : 'console : aucune erreur');
await finish();
