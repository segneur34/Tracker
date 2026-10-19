// Banc de test : la page « Profil » (demande du 18/10), l'année en un coup d'œil.
// Usage : node profil.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Le script écrit lui-même six sessions synthétiques de 20 min, datées en jours
// avant aujourd'hui (deux courses, une sortie à vélo en côte et une de wingfoil récentes, une course et une sortie à
// vélo de l'an passé), les importe par la page Course, et vérifie :
//  1. l'accueil : plus de graphe d'activités, une ligne « Profil » qui ouvre la page ; « Profil » dans la barre du haut ;
//  2. l'année en cours : distance (somme des vitesses × durées, à 5 % près), temps, D+ de la côte seule, nombre de
//     sessions ; l'anneau et sa légende (une part par activité, la course à 50 %) ; le graphe d'activités en bas ;
//  3. les flèches : « suivante » désactivée sur l'année en cours, l'année d'avant et ses chiffres, « précédente »
//     désactivée sur la plus vieille année ;
//  4. une ligne de la légende ouvre la bibliothèque filtrée sur son activité ;
//  5. à 390×844 : rien ne déborde, chiffres empilés ; la case « Profil » de la barre du bas ouvre la page, allumée.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node profil.mjs <port> [<dossier des captures>]');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://127.0.0.1:4190';

// --- Protocole ---
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', { accept: true });
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]}`);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    logs.push(`error: ${msg.params.args.map((a) => a.value ?? a.description).join(' ').split('\n')[0].slice(0, 300)}`);
  }
};
await new Promise((r) => { ws.onopen = r; });
await send('Page.enable');
await send('Runtime.enable');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const go = async (path, ms = 3000) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
const shoot = async (name) => {
  if (!shotDir) return;
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};
let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK ' : 'ÉCHEC'} ${label}${detail ? ` : ${detail}` : ''}`);
};

// --- Sessions synthétiques : 20 min en ligne droite vers l'est, à 1 Hz, à 10 h du jour voulu ---
const day = (daysAgo) => {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  d.setHours(10, 0, 0, 0);
  return d.getTime();
};
/** `climbM` : montée régulière sur toute la session (altitude de 50 m à 50 + climbM). */
const gpxOf = (type, daysAgo, speedMs, climbM = 0) => {
  const t0 = day(daysAgo);
  const points = [];
  for (let k = 0; k <= 1200; k++) {
    const ele = (50 + (climbM * k) / 1200).toFixed(1);
    points.push(`<trkpt lat="43.7000000" lon="${(3.8 + (k * speedMs) / 80500).toFixed(7)}"><ele>${ele}</ele><time>${new Date(t0 + k * 1000).toISOString()}</time></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${type} ${daysAgo}</name><type>${type}</type><trkseg>\n${points.join('\n')}\n</trkseg></trk></gpx>\n`;
};
// Les quatre premières dans l'année en cours, les deux dernières l'an passé : le script n'a de sens qu'après le
// 30 mars (une sortie à 92 jours) et avant que 345 jours ne repassent dans l'année (toujours vrai).
const SESSIONS = [
  ['running', 2, 3.4], ['running', 16, 3.0], ['cycling', 9, 6, 200], ['wingfoil', 92, 9],
  ['running', 400, 3.0], ['cycling', 430, 6],
];
const yearOf = (daysAgo) => new Date(day(daysAgo)).getFullYear();
const thisYear = new Date().getFullYear();
const current = SESSIONS.filter(([, d]) => yearOf(d) === thisYear);
const previous = SESSIONS.filter(([, d]) => yearOf(d) === thisYear - 1);
if (current.length !== 4 || previous.length !== 2) {
  console.error(`Dates hors du cadre du script (${current.length} sessions cette année, ${previous.length} l'an passé).`);
  process.exit(1);
}
const kmOf = (list) => list.reduce((n, [, , v]) => n + v * 1200, 0) / 1000;

const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
const figures = () => evaluate(`[...document.querySelectorAll('.profile-figure')].map((f) => f.querySelector('.profile-figure__value')?.textContent ?? '')`);
const legend = () => evaluate(`[...document.querySelectorAll('.profile-legend li')].map((li) => li.textContent)`);
const search = () => evaluate('location.pathname + location.search');
const overflow = () => evaluate('document.documentElement.scrollWidth > window.innerWidth');
const arrow = (label) => `document.querySelector('.profile-year__arrow[aria-label=${JSON.stringify(label)}]')`;
/** Nombre lu à la française : espaces fines de milliers, virgule décimale. */
const parseFr = (s) => Number((s ?? '').replace(/[^\d,]/g, '').replace(',', '.'));

// --- Mise en place ---
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
await go('/course', 5000);
console.log('import :', await evaluate(`(() => {
  const input = document.querySelector('input[type=file][accept=".gpx"]');
  if (!input) return 'absent';
  const dt = new DataTransfer();
  for (const [name, text] of ${JSON.stringify(SESSIONS.map(([type, d, v, c]) => [`${type}-${d}.gpx`, gpxOf(type, d, v, c)]))}) {
    dt.items.add(new File([text], name, { type: 'application/gpx+xml' }));
  }
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`));
await wait(10000);

// 1. Accueil.
await go('/');
check('accueil : plus de graphe d\'activités', (await evaluate(`!!document.querySelector('.actchart')`)) === false);
const opened = await evaluate(`(() => {
  const a = [...document.querySelectorAll('.home-link')].find((el) => el.textContent.trim() === 'Profil');
  if (!a) return false;
  a.click();
  return true;
})()`);
check('accueil : ligne « Profil »', opened);
await wait(1500);
check('la ligne ouvre la page', (await search()) === '/profil', await search());
check('barre du haut : Profil, allumé', await evaluate(`[...document.querySelectorAll('.shell-toplink')].some((a) => a.textContent.trim() === 'Profil' && a.classList.contains('active'))`));

// 2. L'année en cours.
check('titre et année', (await text('.ui-page-header h1')) === 'Profil' && (await text('.profile-year__label')) === String(thisYear),
  `${await text('.ui-page-header h1')} ; ${await text('.profile-year__label')}`);
let [distance, time, gain] = await figures();
const km = parseFr(distance);
check('distance de l\'année, en km', distance?.endsWith('km') && Math.abs(km - kmOf(current)) / kmOf(current) < 0.05, `${distance} pour ${kmOf(current).toFixed(1)} attendus`);
check('temps de l\'année', time === '1 h 20', time);
const gainM = parseFr(gain);
check('D+ de l\'année : la côte', gain?.endsWith('m') && gainM > 150 && gainM < 230, gain);
check('nombre de sessions', (await text('.profile-count')) === `4 sessions en ${thisYear}`, await text('.profile-count'));
const ordre = await evaluate(`[...document.querySelectorAll('.profile > *')].map((el) => el.className.split(' ')[0] || el.tagName).join(' > ')`);
check('ordre : chiffres, répartition, graphe', /profile-figures.*profile-split.*actchart/.test(ordre ?? ''), ordre);
let rows = await legend();
check('légende : une ligne par activité, la course en tête à 50 %', rows?.length === 3 && rows[0].endsWith('50 %') && rows[0].includes('40 min')
  && rows.slice(1).every((r) => r.endsWith('25 %')), JSON.stringify(rows));
check('anneau : trois parts', (await evaluate(`document.querySelectorAll('.profile-donut circle').length`)) === 3);
check('centre de l\'anneau : le total', (await text('.profile-donut__center')) === 'Total1 h 20', await text('.profile-donut__center'));
await evaluate(`document.querySelector('.profile-legend li').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
await wait(200);
check('survol d\'une ligne : sa part au centre', (await text('.profile-donut__center'))?.endsWith('40 min50 %'), await text('.profile-donut__center'));
await evaluate(`document.querySelector('.profile-legend li').dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))`);
check('flèche « suivante » désactivée sur l\'année en cours', await evaluate(`${arrow('Année suivante')}.disabled`));
await shoot('profil-ordinateur');

// 3. L'an passé.
await evaluate(`${arrow('Année précédente')}.click()`);
await wait(500);
[distance, time, gain] = await figures();
check('année précédente', (await text('.profile-year__label')) === String(thisYear - 1), await text('.profile-year__label'));
check('ses chiffres', Math.abs(parseFr(distance) - kmOf(previous)) / kmOf(previous) < 0.05 && time === '40 min' && (await text('.profile-count')) === `2 sessions en ${thisYear - 1}`,
  `${distance} ; ${time} ; ${await text('.profile-count')}`);
check('D+ nul sur un terrain plat', gain === '0m', gain);
rows = await legend();
check('sa légende', rows?.length === 2 && rows.every((r) => r.endsWith('50 %')), JSON.stringify(rows));
check('flèche « précédente » désactivée sur la plus vieille année', await evaluate(`${arrow('Année précédente')}.disabled`));
check('graphe d\'activités toujours là', await evaluate(`!!document.querySelector('.actchart')`));
await evaluate(`${arrow('Année suivante')}.click()`);
await wait(500);
check('retour à l\'année en cours', (await text('.profile-year__label')) === String(thisYear));

// 4. Une ligne de la légende ouvre la bibliothèque de son activité.
await evaluate(`document.querySelector('.profile-legend__row').click()`);
await wait(1500);
check('la ligne ouvre la bibliothèque filtrée', (await search())?.startsWith('/course?activite='), await search());

// 5. Téléphone.
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go('/profil');
check('390 px : rien ne déborde', !(await overflow()));
check('390 px : chiffres empilés', await evaluate(`(() => {
  const [a, b] = document.querySelectorAll('.profile-figure');
  return !!a && !!b && b.getBoundingClientRect().top > a.getBoundingClientRect().bottom - 1;
})()`));
await shoot('profil-telephone');
await go('/');
const tab = `[...document.querySelectorAll('.shell-tabbar .shell-tab')].find((t) => t.textContent.trim() === 'Profil')`;
check('barre du bas : Accueil, Statistiques, Profil, Réglages',
  (await evaluate(`[...document.querySelectorAll('.shell-tabbar .shell-tab')].map((t) => t.textContent.trim()).join(' | ')`)) === 'Accueil | Statistiques | Profil | Réglages');
await evaluate(`${tab}.click()`);
await wait(1000);
check('la case Profil ouvre la page, allumée', (await search()) === '/profil' && (await evaluate(`${tab}.classList.contains('active')`)), await search());
check('390 px : barre du bas sans débordement', !(await overflow()));

console.log(logs.length ? `Console :\n${logs.join('\n')}` : 'Console : aucune erreur');
console.log(failures === 0 ? 'Tout est bon.' : `${failures} échec(s).`);
process.exit(failures === 0 ? 0 : 1);
