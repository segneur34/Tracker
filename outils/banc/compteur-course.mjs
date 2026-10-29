// Banc de test : une sortie à pied enregistrée avec le compteur d'intervalles (demandes du 19/10, lot 2).
// Usage : node compteur-course.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Sur un profil neuf, sans réseau, environ 40 s, 12 s avec `TEMPS=10` (horloge de la page accélérée). Le compteur est
// lancé depuis l'onglet Fractionné d'Enregistrer, puis une Course est enregistrée en rejeu ×10. Le script vérifie :
//  1. « Analyser » demande si la session passe en « Fractionné à pied » ;
//  2. oui : fiche en run-intervals, séances gardées, analyse ouverte dans le Fractionné, onglet « fractionné » ;
//  3. non : fiche en running, séances gardées quand même, analyse à pied sans onglet « fractionné ».
import { writeFileSync } from 'node:fs';
import { connect } from './lib/cdp.mjs';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node compteur-course.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}

// --- Protocole ---
// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, settle, waitFor, wait, vwait, blockNetwork, importFiles, shoot, close, logs, onMessage } = await connect({ port, width: 1400, height: 1000, shotDir });
/** Heure de la page (accélérée par `TEMPS`, lib/horloge.mjs), en ms. */
const pageNow = () => evaluate('Date.now()');
const sounds = [];
const dialogs = [];
/**
 * Réponse aux confirmations de la page : la bibliothèque les accepte ; pour en refuser une (`setAnswer(false)`), un
 * script posé avant chaque page fait répondre non à `confirm` (le message est alors noté comme un dialogue).
 */
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const real = window.confirm.bind(window); window.confirm = (m) => { if (sessionStorage.getItem('banc.refuse') === '1') { console.debug('[banc-refus] ' + m); return false; } return real(m); }; })()` });
const setAnswer = async (value) => { await evaluate(`sessionStorage.setItem('banc.refuse', ${value ? "'0'" : "'1'"}); 'ok'`); };
onMessage((msg) => {
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description).join(' ');
    if (msg.params.type === 'debug' && /^\[(bips|compteur)\]/.test(text)) sounds.push(text);
    if (msg.params.type === 'debug' && text.startsWith('[banc-refus] ')) dialogs.push(text.slice('[banc-refus] '.length));
  }
  if (msg.method === 'Page.javascriptDialogOpening') {
    dialogs.push(msg.params.message);
  }
});
// « Arrêter » se tient (appui long réglable, 2 s par défaut) : appui, attente, puis relâcher.
const holdStop = async () => {
  const down = await evaluate(`(() => { const b = [...document.querySelectorAll('button.ui-btn--danger')].find((x) => x.textContent.includes('Arrêter') && !x.disabled && !x.closest('.ivl')); if (!b) return 'absent'; window.__stopButton = b; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); return 'ok'; })()`);
  if (down !== 'ok') return down;
  await vwait(2300);
  return evaluate(`(() => { const b = window.__stopButton; b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })); b.click(); return 'ok'; })()`);
};
const clickText = (text, selector = 'button') => evaluate(`(() => {
  const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)} || x.textContent.includes(${JSON.stringify(text)}));
  if (!b) return 'absent'; if (b.disabled) return 'désactivé'; b.click(); return 'ok';
})()`);
const setFile = (selector, file) => importFiles(file, selector);
const records = () => evaluate(`(async () => {
  const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions');
  const list = [];
  for await (const [name, h] of dir.entries()) if (name.endsWith('.json')) list.push({ name, record: JSON.parse(await (await h.getFile()).text()) });
  return list;
})()`);
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
await blockNetwork(['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*']);
await go('/');
let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'ÉCHEC'} ${label}${detail ? ' — ' + detail : ''}`); };

const recordCourse = async (tag, offsetMin) => {
  const t0 = (await pageNow()) + offsetMin * 60000;
  const lat = 43.7;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  let meters = 0;
  const pts = [];
  for (let k = 0; k <= 30; k++) {
    if (k > 0) meters += 3;
    pts.push(`<trkpt lat="${lat}" lon="${(3.85 + meters / mPerDegLon).toFixed(7)}"><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>3</speed></extensions></trkpt>`);
  }
  const path = `${workDir}\\lot2-${tag}.gpx`;
  writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Rejeu</name><type>running</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`);
  await go('/enregistrer');
  console.log(`[${tag}] famille Entraînement :`, await clickText('Entraînement'));
  await wait(300);
  console.log(`[${tag}] Lancer le compteur :`, await clickText('Lancer le compteur'));
  await wait(500);
  console.log(`[${tag}] onglet À pied :`, await clickText('À pied'));
  await wait(300);
  await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click(); 'ok'`);
  await wait(300);
  await setFile('input[type=file][accept=".gpx"]', path);
  await wait(500);
  await evaluate(`(() => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === '600')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '10'); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
  console.log(`[${tag}] Démarrer :`, await clickText('Démarrer'));
  await vwait(6000);
  console.log(`[${tag}] Arrêter :`, await holdStop());
  await vwait(2500);
  // Le compteur d'abord arrêté et fermé, pour la session suivante.
  await evaluate(`(async () => { const b = document.querySelector('.ivl button.ui-btn--danger'); if (!b) return 'absent'; const ev = (t) => b.dispatchEvent(new PointerEvent(t, { bubbles: true, button: 0, pointerType: 'mouse' })); ev('pointerdown'); await new Promise((r) => setTimeout(r, 1200)); ev('pointerup'); b.click(); return 'ok'; })()`);
  await wait(300);
  const before = dialogs.length;
  console.log(`[${tag}] Analyser :`, await clickText('Analyser'));
  // L'analyse se calcule en vrai temps : l'adresse de l'analyse, puis une page immobile.
  await waitFor(`location.pathname.endsWith('/analyse')`, { timeout: 6000, label: 'analyse' });
  await settle({ max: 6000, label: 'analyse' });
  return dialogs.slice(before);
};

// Oui : rangée en Fractionné à pied, ouverte dans le Fractionné, onglet « fractionné ».
await setAnswer(true);
const asked = await recordCourse('oui', -30);
check('question posée à « Analyser »', asked.length === 1 && asked[0].includes('Fractionné à pied'), asked.join(' | '));
let tabs = await evaluate(`[...document.querySelectorAll('.an-carte-col .ui-tab')].map((t) => t.textContent).join(', ')`);
check('oui : ouverte dans le Fractionné, onglet fractionné', (await evaluate('location.pathname')).startsWith('/fractionne') && /fractionné/.test(tabs ?? ''), `${await evaluate('location.pathname')} | ${tabs}`);
let recs = await records();
const yes = recs.find((r) => r.name.includes('run-intervals') || r.record.sport === 'run-intervals');
check('oui : fiche en run-intervals, séances gardées', yes?.record.sport === 'run-intervals' && (yes.record.intervals?.length ?? 0) > 0,
  JSON.stringify(recs.map((r) => [r.name, r.record.sport, r.record.activityId, r.record.intervals?.length ?? 0])));

// Non : reste en Course, sans onglet « fractionné », séances gardées dans la fiche.
await setAnswer(false);
const asked2 = await recordCourse('non', -10);
check('question posée de nouveau', asked2.length === 1, asked2.join(' | '));
tabs = await evaluate(`[...document.querySelectorAll('.an-carte-col .ui-tab')].map((t) => t.textContent).join(', ')`);
check('non : ouverte à pied, sans onglet fractionné', (await evaluate('location.pathname')).startsWith('/course') && !/fractionné/.test(tabs ?? ''), `${await evaluate('location.pathname')} | ${tabs}`);
recs = await records();
const no = recs.filter((r) => r.record.sport === 'running');
check('non : fiche en running, séances gardées', no.length === 1 && (no[0].record.intervals?.length ?? 0) > 0,
  JSON.stringify(recs.map((r) => [r.name, r.record.sport, r.record.activityId, r.record.intervals?.length ?? 0])));
await shoot('lot2-non');

console.log('--- console ---');
for (const l of logs) console.log(l);
console.log(fails === 0 ? 'tout est passé' : `${fails} échec(s)`);
await close();
