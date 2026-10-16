// Banc de test : onglet « matériel et notes » dans toutes les activités (lot 2 des demandes du 14/10, seconde série).
// Usage : node materiel.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Dure environ 1 min. Le script :
//  1. ouvre dans Réglages les cartes Voile, Course, Route et Surf, partie Onglet analyse : la ligne « Matériel » n'est
//     pas en Voile ; intitulés « Chaussures » et « Sac » rangés pour Course ;
//  2. importe une course : onglet « matériel et notes » juste avant « réglages », champs sous les intitulés de
//     Course, saisie du matériel, des conditions et de l'appréciation, partie « notes » dans la barre,
//     « Enregistrer la session », fiche relue, rechargement ;
//  3. la même chose pour une sortie à vélo et une session de surf, sous les intitulés par défaut ;
//  4. à 390×844 : pas de débordement.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node materiel.mjs <port> [<dossier des captures>]');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://localhost:5173';

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
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]}`);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ').split('\n')[0].slice(0, 300)}`);
  }
};
await new Promise((r) => { ws.onopen = r; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const go = async (path, ms = 3000) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
const clickText = (text, selector = 'button') => evaluate(`(() => {
  const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
  if (!b) return 'absent'; if (b.disabled) return 'désactivé'; b.click(); return 'ok';
})()`);
/** Saisit un texte dans un champ ou une zone de texte, puis le quitte (`focusout`, l'`onBlur` de React). */
const setText = (input, value) => evaluate(`(() => {
  const i = ${input};
  if (!i) return 'absent';
  const proto = i instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(i, ${JSON.stringify(value)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  return i.value;
})()`);
const shoot = async (name) => {
  if (!shotDir) return;
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};
const overflow = () => evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
const records = () => evaluate(`(async () => {
  const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions');
  const list = [];
  for await (const [name, h] of dir.entries()) if (name.endsWith('.json')) list.push(JSON.parse(await (await h.getFile()).text()));
  return list;
})()`);
const openTab = (label) => evaluate(`(() => { const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!t) return 'absent'; if (t.getAttribute('aria-pressed') !== 'true' && t.getAttribute('aria-selected') !== 'true') t.click(); return 'ok'; })()`);
const tabLabels = () => evaluate(`[...document.querySelectorAll('.an-carte-col .ui-tab')].map((t) => t.textContent.trim()).join(' | ')`);
const saveBar = () => evaluate(`document.body.innerText.match(/Non enregistr[^\\n]*/)?.[0] ?? '(aucune)'`);
const importGpx = (gpx, name) => evaluate(`(() => {
  const input = document.querySelector('input[type=file][accept=".gpx"]');
  if (!input) return 'absent';
  const dt = new DataTransfer();
  dt.items.add(new File([${JSON.stringify(gpx)}], ${JSON.stringify(name)}, { type: 'application/gpx+xml' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);
/** Champ du matériel de l'onglet, par son intitulé. */
const gearInput = (label) => `[...document.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent.trim() === ${JSON.stringify(label)})?.querySelector('input[type=text]')`;
const gearLabels = () => evaluate(`[...document.querySelectorAll('label')].filter((l) => l.querySelector('input[type=text]') && l.querySelector('span')).map((l) => l.querySelector('span').textContent.trim()).join(', ')`);
const conditionsArea = `document.querySelector('textarea[aria-label="Conditions"]')`;
let failures = 0;
const check = (what, ok) => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${what}`); if (!ok) failures++; };

await send('Runtime.enable'); await send('Page.enable');
await send('Network.setBlockedURLs', { urls: ['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

/** Trace droite à `speedMs` constante, `type` lu par l'import. */
const lineGpx = (type, speedMs, t0) => {
  const lat = 43.7;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  const pts = [];
  for (let k = 0; k <= 900; k++) {
    const m = k * speedMs;
    pts.push(`<trkpt lat="${lat}" lon="${(3.85 + m / mPerDegLon).toFixed(7)}"><ele>${(50 + 0.02 * m).toFixed(1)}</ele><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>${speedMs}</speed></extensions></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Ligne</name><type>${type}</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
};

// --- 1. Réglages ---
await go('/parametres', 4000);
await evaluate(`(() => {
  localStorage.setItem('tracker.sections', JSON.stringify({
    settings: { activites: true },
    'settings-activities': { wingfoil: true, running: true, cycling: true, surf: true },
    'settings-families': { voile: true, course: true, velo: true, fractionne: true, surf: true },
    'settings-activity-parts': { analyse: true },
  }));
  return 'ok';
})()`);
await go('/parametres', 3000);
const nameSelector = `input[aria-label="Nom de l\\'activité"]`;
const rows = await evaluate(`[...document.querySelectorAll('.settings-activity')].filter((c) => [...c.querySelectorAll('.settings-row__label')].some((l) => l.textContent.trim() === 'Matériel')).map((c) => c.querySelector(${JSON.stringify(nameSelector)})?.value).join(', ')`);
console.log('cartes ouvertes :', await evaluate(`[...document.querySelectorAll(${JSON.stringify(nameSelector)})].map((i) => i.value).join(', ')`));
console.log('cartes avec « Matériel » :', rows);
check('pas de ligne « Matériel » en Voile, une en Course', !rows.split(', ').includes('Voile') && rows.split(', ').includes('Course'));
const courseCard = `[...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector(${JSON.stringify(nameSelector)})?.value === 'Course')`;
console.log('intitulé 1 :', await setText(`${courseCard}?.querySelector('input[aria-label="Intitulé du matériel 1"]')`, ' Chaussures '));
await wait(300);
console.log('intitulé 2 :', await setText(`${courseCard}?.querySelector('input[aria-label="Intitulé du matériel 2"]')`, 'Sac'));
await wait(500);
const stored = await evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}').gearLabels)`);
console.log('rangés :', stored);
check('intitulés de Course rangés, rognés', stored === JSON.stringify({ running: ['Chaussures', 'Sac'] }));
await shoot('materiel-reglages');

/** Importe, ouvre l'onglet, saisit, enregistre, relit ; rend l'adresse de l'analyse. */
const scenario = async ({ page, type, startIso, labels, values }) => {
  const start = Date.parse(startIso);
  await go(`/${page}`, 3000);
  console.log(`\nimport ${page} :`, await importGpx(lineGpx(type, 2.8, start), `${page}.gpx`));
  await wait(4000);
  const rec = (await records()).find((r) => r.summary?.startMs === start);
  const path = `/${page}/analyse?session=${encodeURIComponent(rec?.gpx ?? '')}`;
  await go(path, 6000);
  const tabs = await tabLabels();
  console.log('onglets :', tabs);
  check('« matériel et notes » juste avant « réglages »', / matériel et notes \| réglages$/.test(tabs));
  console.log('ouvrir :', await openTab('matériel et notes'));
  await wait(800);
  const shown = await gearLabels();
  console.log('champs :', shown);
  check(`intitulés ${labels.join(', ')}`, shown === labels.join(', '));
  check('ni vent ni plan d\'eau', !(await evaluate(`document.body.innerText.includes("Plan d'eau")`)));
  console.log('matériel :', await setText(gearInput(labels[0]), values[0]), '/', await setText(gearInput(labels[1]), values[1]));
  console.log('conditions :', await setText(conditionsArea, values[2]));
  console.log('appréciation :', await evaluate(`(() => { const b = document.querySelector('button[aria-label="Bien"]'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
  await wait(500);
  const bar = await saveBar();
  console.log('barre :', bar);
  check('partie « notes » à enregistrer', /notes/.test(bar));
  console.log('Enregistrer la session :', await clickText('Enregistrer la session'));
  await wait(1500);
  const notes = (await records()).find((r) => r.summary?.startMs === start)?.notes;
  console.log('fiche :', JSON.stringify({ gear1: notes?.gear1, gear2: notes?.gear2, conditions: notes?.conditions, rating: notes?.rating }));
  check('fiche écrite', notes?.gear1 === values[0] && notes?.gear2 === values[1] && notes?.conditions === values[2] && notes?.rating === 4);
  await go(path, 6000);
  await openTab('matériel et notes'); await wait(800);
  const again = await evaluate(`[${gearInput(labels[0])}?.value, ${gearInput(labels[1])}?.value, ${conditionsArea}?.value].join(' / ')`);
  console.log('après rechargement :', again);
  check('relu après rechargement', again === values.join(' / '));
  check('rien à enregistrer', (await saveBar()) === '(aucune)');
  await shoot(`materiel-${page}`);
  return path;
};

// --- 2. et 3. Course, vélo, surf ---
const runPath = await scenario({ page: 'course', type: 'running', startIso: '2026-10-01T08:00:00Z', labels: ['Chaussures', 'Sac'], values: ['Pegasus 41', 'Gilet 5 L', 'Chaud, boue'] });
await scenario({ page: 'velo', type: 'cycling', startIso: '2026-10-02T08:00:00Z', labels: ['Matériel 1', 'Matériel 2'], values: ['Gravel', 'Sacoches', 'Vent de face'] });
const surfPath = await scenario({ page: 'surf', type: 'surf', startIso: '2026-10-03T08:00:00Z', labels: ['Matériel 1', 'Matériel 2'], values: ['Planche 6 pieds 2', 'Combinaison 4/3', 'Houle 1 m'] });

// --- 4. Téléphone ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
for (const path of [runPath, surfPath]) {
  await go(path, 5000);
  await openTab('matériel et notes'); await wait(800);
  const o = await overflow();
  check(`à 390 px, ${path.split('/')[1]} : débordement ${o}`, o === 0);
}
await shoot('materiel-telephone');

console.log('\n--- console (erreurs, avertissements) ---');
logs.forEach((l) => console.log(l));
console.log(failures === 0 ? '\nTout passe.' : `\n${failures} échec(s).`);
await send('Page.close').catch(() => undefined);
ws.close();
process.exit(0);
