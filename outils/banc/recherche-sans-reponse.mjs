// Banc des recherches réseau sans réponse (lot 54, étape 6 ; ex-essai 69) : Overpass (revêtement, 120 s) et IGN
// (altitude, 30 s par paquet) qui ne répondent jamais. Les requêtes sont interceptées par le domaine `Fetch` du
// protocole et laissées pendantes (ni réponse, ni blocage). Le script :
//  1. écrit une course synthétique au nord de Montpellier (celle de `altitude.mjs`) et l'importe ;
//  2. l'ouvre (l'altitude de l'IGN est demandée) et déplie l'onglet « surface » (Overpass est interrogé) ;
//  3. relève, seconde par seconde, le texte d'erreur et le « Réessayer » qui apparaissent, et le temps écoulé
//     depuis la première requête interceptée du même service ;
//  4. laisse passer les requêtes (`Fetch.continueRequest`, vrai réseau), clique « Réessayer » et attend que
//     le revêtement et l'altitude aboutissent.
// Usage : node recherche-sans-reponse.mjs <port> <dossier de travail, chemin Windows>
// Le GPX écrit n'a pas d'altitude : l'IGN est donc interrogé d'office. Sur un profil neuf, avec réseau (overpass-api.de et data.geopf.fr) pour la fin. Dure environ 3 à 5 min.
import { writeFileSync } from 'node:fs';
import { connect } from './lib/cdp.mjs';

const [port, workDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node recherche-sans-reponse.mjs <port> <dossier de travail>');
  process.exit(1);
}

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, waitFor, wait, importFiles, onMessage, close, logs } = await connect({ port, width: 1400, height: 1000 });
/** Requêtes interceptées : tenues sans réponse tant que `holding` est vrai. */
let holding = true;
const held = [];
const firstHeld = { overpass: null, ign: null };
const serviceOf = (url) => (!url.startsWith('https://') ? null : /overpass/i.test(url) ? 'overpass' : /geopf|(^|[/.])ign\./i.test(url) ? 'ign' : null);
onMessage((msg) => {
  if (msg.method === 'Fetch.requestPaused') {
    const service = serviceOf(msg.params.request.url);
    if (service && holding) {
      held.push({ requestId: msg.params.requestId, service, url: msg.params.request.url });
      firstHeld[service] ??= Date.now();
    } else {
      void send('Fetch.continueRequest', { requestId: msg.params.requestId });
    }
  }
});

const clickButton = (text) => evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && !x.disabled);
  if (!b) return 'absent'; b.click(); return 'ok';
})()`);
const listOpfs = async (path) => (await evaluate(`(async () => { try {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker');
  for (const p of ${JSON.stringify(path)}.split('/')) dir = await dir.getDirectoryHandle(p);
  const names = []; for await (const [name] of dir.entries()) names.push(name); return names.sort();
} catch { return []; } })()`)) ?? [];
let failures = 0;
const check = (label, ok, detail = '') => { if (!ok) failures += 1; console.log(`${ok ? 'ok    ' : 'ÉCHEC '} ${label}${detail !== '' ? ` | ${detail}` : ''}`); };
const secondsSince = (t) => (t === null ? null : Math.round((Date.now() - t) / 100) / 10);
/** Textes placés devant un bouton « Réessayer » (message d'erreur de l'altitude ou du revêtement). */
const retryTexts = () => evaluate(`[...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Réessayer').map((b) => (b.previousElementSibling?.textContent ?? '').trim())`);
const surfaceRows = () => evaluate(`[...document.querySelectorAll('.surface-bar__row')].map((r) => r.innerText.replace(/\\n/g, ' ')).join(' · ') || '(aucune)'`);
const sourceLine = () => evaluate(`[...document.querySelectorAll('span')].map((x) => x.textContent).find((t) => /^Altitude (du terrain|du GPS|enregistrée)/.test(t)) ?? '(aucune)'`);

await send('Fetch.enable', { patterns: [{ urlPattern: 'https://*overpass*' }, { urlPattern: 'https://*geopf*' }, { urlPattern: 'https://*ign.fr*' }] });
// Rangée « avancé » des analyses ouverte d'office : tous les onglets restent dans la barre.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
// 1. Course synthétique vers le nord (celle d'altitude.mjs), importée.
const t0 = Date.UTC(2026, 9, 7, 8, 0, 0);
const fixes = [];
// Sans altitude dans le fichier : c'est ce qui fait demander celle de l'IGN.
for (let k = 0; k <= 1200; k++) fixes.push([43.655 + (3 * k) / 111_195, 3.8, 0]);
const runPath = `${workDir}\\course-sans-reponse.gpx`;
writeFileSync(runPath, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Course sans réponse</name><type>running</type><trkseg>\n${
  fixes.map(([lat, lon, _ele], k) => `<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><time>${new Date(t0 + k * 1000).toISOString()}</time></trkpt>`).join('\n')
}\n</trkseg></trk></gpx>\n`);
await go('/course');
const before = (await listOpfs('sessions')).filter((n) => n.endsWith('.gpx'));
await importFiles(runPath, 'input[type=file][accept=".gpx"][multiple]');
const gpxName = await waitFor(async () => (await listOpfs('sessions')).filter((n) => n.endsWith('.gpx')).find((n) => !before.includes(n)), { timeout: 6000, label: 'fiche' });
console.log('rangée :', gpxName);
check('course importée', Boolean(gpxName));

// 2. Ouverture : l'IGN est interrogé ; onglet « surface » : Overpass l'est.
const tOpen = Date.now();
await go(`/course/analyse?session=${encodeURIComponent(gpxName)}`, 2500);
for (let k = 0; k < 30 && (await clickButton('surface')) !== 'ok'; k++) await wait(1000);
console.log('onglet surface cliqué');
// L'erreur de l'altitude (avec son « Réessayer ») est sous le graphe d'altitude, celle du revêtement dans « surface » : les deux onglets restent ouverts.
for (let k = 0; k < 30 && (await clickButton('graphiques')) !== 'ok'; k++) await wait(1000);
console.log('onglet graphiques cliqué');
await wait(1500);
console.log('pendant :', await sourceLine(), '| requêtes tenues', held.map((h) => `${h.service} ${h.url.slice(0, 70)}`).join(' ; ') || '(aucune)');
check('requêtes tenues : IGN et Overpass', firstHeld.ign !== null && firstHeld.overpass !== null, JSON.stringify({ ign: held.filter((h) => h.service === 'ign').length, overpass: held.filter((h) => h.service === 'overpass').length }));

// 3. Attente des messages d'erreur (au plus 200 s depuis l'ouverture).
const seen = new Map();
// Échéance fixée une fois (la borne recalculée à chaque tour, avec le compteur qui monte, coupait l'attente à la moitié).
while (Date.now() - tOpen < 200_000) {
  const texts = (await retryTexts()) ?? [];
  for (const t of texts) {
    if (!seen.has(t)) {
      seen.set(t, Date.now());
      const kind = /voie|OpenStreetMap|Overpass|revêtement/i.test(t) ? 'overpass' : 'ign';
      console.log(`erreur + « Réessayer » à ${secondsSince(tOpen)} s de l'ouverture (${secondsSince(firstHeld[kind])} s après la première requête ${kind} tenue) : « ${t} »`);
    }
  }
  if (texts.length >= 2) break;
  await wait(1000);
}
console.log('page à l\'échéance :', await evaluate(`document.body.innerText.split('\\n').filter((l) => /Réessayer|échec|répond|délai|erreur|impossible|Altitude|voie/i.test(l)).slice(0, 12).join(' | ')`),
  '| boutons', await evaluate(`[...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 40).join(' / ')`));
console.log(`première requête tenue, après l'ouverture : IGN ${firstHeld.ign === null ? '—' : (firstHeld.ign - tOpen) / 1000} s, Overpass ${firstHeld.overpass === null ? '—' : (firstHeld.overpass - tOpen) / 1000} s ; échéance à ${secondsSince(tOpen)} s`);
console.log('textes d\'erreur relevés :', seen.size, '| requêtes tenues', held.length);
check('deux messages d\'erreur avec « Réessayer »', seen.size >= 2, [...seen.keys()].join(' || '));
const texts = [...seen.keys()];
const ignAt = texts.find((t) => !/voie|OpenStreetMap|Overpass|revêtement/i.test(t));
const overpassAt = texts.find((t) => /voie|OpenStreetMap|Overpass|revêtement/i.test(t));
if (ignAt !== undefined) check('IGN : erreur après ~30 s', secondsSince(firstHeld.ign) !== null && (seen.get(ignAt) - firstHeld.ign) / 1000 >= 25 && (seen.get(ignAt) - firstHeld.ign) / 1000 <= 60, `${Math.round((seen.get(ignAt) - firstHeld.ign) / 1000)} s`);
if (overpassAt !== undefined) check('Overpass : erreur après ~120 s', (seen.get(overpassAt) - firstHeld.overpass) / 1000 >= 110 && (seen.get(overpassAt) - firstHeld.overpass) / 1000 <= 150, `${Math.round((seen.get(overpassAt) - firstHeld.overpass) / 1000)} s`);

// 4. On laisse passer, puis « Réessayer ».
holding = false;
for (const h of held) void send('Fetch.continueRequest', { requestId: h.requestId });
await wait(1000);
const tRetry = Date.now();
for (let k = 0; k < 4; k++) {
  const clicked = await evaluate(`(() => { const bs = [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Réessayer'); bs.forEach((b) => b.click()); return bs.length; })()`);
  if (k === 0) console.log('Réessayer cliqués :', clicked);
  if (!clicked) break;
  await wait(1500);
}
for (let k = 0; k < 150; k++) {
  const stillError = ((await retryTexts()) ?? []).length;
  if ((await surfaceRows()) !== '(aucune)' && /IGN\.$/.test(await sourceLine()) && stillError === 0) break;
  await wait(1000);
}
const rows = await surfaceRows();
const line = await sourceLine();
const left = (await retryTexts()) ?? [];
console.log(`après « Réessayer » (${secondsSince(tRetry)} s) : surface = ${rows} | altitude = ${line} | « Réessayer » restants : ${left.length}`);
check('revêtement abouti', rows !== '(aucune)', rows);
check('altitude de l\'IGN aboutie', /IGN\.$/.test(line), line);
check('plus de message d\'erreur', left.length === 0, left.join(' || '));

console.log(logs.length ? `console :\n${logs.join('\n')}` : 'console : aucune erreur');
console.log(failures === 0 ? 'RÉSULTAT : ok' : `RÉSULTAT : ${failures} échec(s)`);
await close();
process.exit(0);
