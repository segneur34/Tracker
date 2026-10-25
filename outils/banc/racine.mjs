// Banc de test : la racine du Profil, règle à la semaine du 25/10 (une étape par semaine tenue, 26 pour le tour ;
// semaines manquées d'affilée : −3, −6, puis la graine ; objectif par semaine, 45 min par défaut).
// Usage : node racine.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Le script écrit un historique de courses de 45 min, le lundi, sur les semaines 0 à 29,
// 33 et 34 (la semaine 0 commence 50 semaines avant celle d'aujourd'hui), et trois de 15 min les mardi, mercredi et jeudi
// de la semaine 35 ; il les importe par la page Course. Puis il ouvre le Profil à des dates choisies, l'heure de la page
// décalée par un script posé avant son chargement (`Date` remplacé), et vérifie :
//  1. le niveau : semaines 1, 6, 13, 26, 30 ; 1, 2, 3 semaines manquées (27, 21, 0), la reprise (1, puis 2) ;
//  2. la bulle : recul de 3, « de 6 de plus », « revient à sa graine », feuilles tombées, temps de la semaine et radicelles ;
//  3. Réglages, « Pratiquant » : une seule ligne « Objectif par semaine » ; à 60 min, plus rien de tenu ; vidée, 45 ;
//  4. un état vu d'avant la règle (sans version) est ignoré ; le rejeu d'un recul de 9 (30 → 21) à l'ouverture ;
//  5. à 390 et 320 px : rien ne déborde, le carré et la bulle restent dans l'écran.
// Avec un dossier, il y écrit les captures et une planche (`planche.html`) qui les rassemble.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node racine.mjs <port> [<dossier des captures>]');
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
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};
let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK ' : 'ÉCHEC'} ${label}${detail ? ` : ${detail}` : ''}`);
};

// --- Historique synthétique ---
const today = new Date();
const dow = (today.getDay() + 6) % 7;
const mon0 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow - 50 * 7);
/** Instant local : jour `d` (0 : lundi) de la semaine `w`, à `h` heures. */
const dayAt = (w, d = 0, h = 12) => new Date(mon0.getFullYear(), mon0.getMonth(), mon0.getDate() + w * 7 + d, h).getTime();
const gpxOf = (t0, minutes, name) => {
  const points = [];
  for (let k = 0; k <= minutes * 6; k++) {
    points.push(`<trkpt lat="43.7000000" lon="${(3.8 + (k * 30) / 80500).toFixed(7)}"><ele>50</ele><time>${new Date(t0 + k * 10_000).toISOString()}</time></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><type>running</type><trkseg>\n${points.join('\n')}\n</trkseg></trk></gpx>\n`;
};
const files = [];
for (const w of [...Array.from({ length: 30 }, (_, k) => k), 33, 34]) files.push([`course-s${w}.gpx`, gpxOf(dayAt(w, 0, 10), 45, `course s${w}`)]);
for (const d of [1, 2, 3]) files.push([`course-s35-${d}.gpx`, gpxOf(dayAt(35, d, 10), 15, `course s35 j${d}`)]);

const slotText = () => evaluate(`document.querySelector('.profile-root-slot')?.textContent ?? null`);
/** Texte de la bulle, espaces insécables (entre un nombre et son mot) ramenées à des espaces. */
const bubbleText = () => evaluate(`document.querySelector('.profile-root__bubble')?.textContent.replace(/\\u00a0/g, ' ') ?? null`);
const overflow = () => evaluate('document.documentElement.scrollWidth > window.innerWidth');
/** Pixels dessinés du canevas de la racine. */
const inked = () => evaluate(`(() => {
  const c = document.querySelector('canvas.profile-root');
  if (!c || !c.width) return -1;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
})()`);
const setField = (label, value) => evaluate(`(() => {
  const l = [...document.querySelectorAll('label')].find((x) => x.textContent.startsWith(${JSON.stringify(label)}));
  const input = l?.querySelector('input');
  if (!input) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
  return true;
})()`);
const seen = () => evaluate(`JSON.parse(localStorage.getItem('tracker.profil') ?? '{}').racine ?? null`);
const openBubble = async () => { await evaluate(`document.querySelector('.profile-root-slot')?.click()`); await wait(300); return bubbleText(); };

// --- Heure de la page ---
let clockScript = null;
/** Les pages suivantes croient être à `fakeMs` ; `forget` : l'état vu de la racine est effacé avant chargement (pas de rejeu). */
const setClock = async (fakeMs, forget = true) => {
  if (clockScript) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clockScript });
  const source = `(() => {
    const off = ${fakeMs - Date.now()};
    const R = Date;
    class D extends R { constructor(...a) { if (a.length === 0) super(R.now() + off); else super(...a); } static now() { return R.now() + off; } }
    window.Date = D;
    ${forget ? `try { const all = JSON.parse(localStorage.getItem('tracker.profil') ?? '{}'); delete all.racine; localStorage.setItem('tracker.profil', JSON.stringify(all)); } catch {}` : ''}
  })();`;
  clockScript = (await send('Page.addScriptToEvaluateOnNewDocument', { source })).result.identifier;
};
const profileAt = async (fakeMs, forget = true, ms = 4500) => { await setClock(fakeMs, forget); await go('/profil', ms); };

// --- Captures et planche ---
const plate = [];
/** Capture de la page, et gros plan de la pousse (carré du pseudo), avec sa légende sur la planche. */
const shootState = async (name, label) => {
  if (!shotDir) return;
  await shoot(name);
  const r = await evaluate(`(() => { const b = document.querySelector('.profile-root-slot').getBoundingClientRect(); return { x: b.left + scrollX - 10, y: b.top + scrollY - 40, w: b.width + 20, h: b.height + 50 }; })()`);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 3 } });
  writeFileSync(`${shotDir}/${name}-pousse.png`, Buffer.from(shot.result.data, 'base64'));
  plate.push({ name, label });
};

// --- Mise en place ---
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
await go('/course', 5000);
console.log('import :', await evaluate(`(() => {
  const input = document.querySelector('input[type=file][accept=".gpx"]');
  if (!input) return 'absent';
  const dt = new DataTransfer();
  for (const [name, text] of ${JSON.stringify(files)}) dt.items.add(new File([text], name, { type: 'application/gpx+xml' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`), `${files.length} fichiers`);
await wait(20000);

// 1 et 2. Niveaux et bulle, à des dates choisies (le lundi à 8 h, avant la course de 10 h ; à midi les autres jours).
const states = [
  { w: 1, level: '1étape', label: 'Semaine 1 : une étape', bubble: ['Encore 25 semaines tenues', "Sans 45 min de plus d'ici dimanche soir, elle revient à sa graine."] },
  { w: 6, level: '6étapes', label: 'Semaine 6' },
  { w: 13, level: '13étapes', label: 'Semaine 13 : la moitié du tour' },
  { w: 26, level: '26étapes', label: 'Semaine 26 : tour complet', bubble: ['Tous les cadres sont entourés'] },
  { w: 30, level: '30étapes', label: 'Semaine 30 : racine mûre', bubble: ['elle recule de 3 étapes.'] },
  { w: 31, level: '27étapes', label: '1 semaine manquée : −3, feuilles tombées', bubble: ['Partie sèche : 3 étapes', 'elle recule de 6 étapes de plus.', 'Semaine dernière manquée : ses feuilles sont tombées'] },
  { w: 32, level: '21étapes', label: '2 semaines manquées : −9', bubble: ['elle revient à sa graine.', "2 semaines manquées d'affilée"] },
  { w: 33, level: '0étape', label: '3 semaines manquées : la graine', bubble: ['elle reste à sa graine.', "3 semaines manquées d'affilée", 'Partie sèche : 30 étapes'] },
  { w: 34, level: '1étape', label: 'Reprise : une semaine tenue', bubble: ['elle revient à sa graine.'] },
  { w: 35, d: 0, level: '2étapes', label: 'Semaine 35, lundi : 0 min, pas de fleur', bubble: ['Cette semaine : 0 min sur 45 min'] },
  { w: 35, d: 1, level: '2étapes', label: 'Mardi : 15 min, bouton', bubble: ['Cette semaine : 15 min sur 45 min · 3 radicelles'] },
  { w: 35, d: 2, level: '2étapes', label: 'Mercredi : 30 min, fleur entrouverte', bubble: ['Cette semaine : 30 min sur 45 min · 6 radicelles'] },
  { w: 35, d: 3, level: '2étapes', label: 'Jeudi : 45 min, fleur ouverte', bubble: ['Cette semaine : 45 min sur 45 min · 9 radicelles', 'Objectif tenu : la racine gagne une étape dimanche soir.'] },
];
for (const st of states) {
  await profileAt(dayAt(st.w, st.d ?? 0, st.d ? 12 : 8));
  const tag = `s${st.w}${st.d ? `-j${st.d}` : ''}`;
  check(`${st.label} : ${st.level}`, (await slotText()) === st.level, await slotText());
  await shootState(`racine-${tag}`, st.label);
  if (st.bubble) {
    const b = await openBubble();
    check(`${st.label} : bulle`, st.bubble.every((t) => b?.includes(t)), b);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await wait(200);
  }
}
check('Échap ferme la bulle', (await bubbleText()) === null);

// 3. Réglages.
await setClock(dayAt(30, 0, 12));
await evaluate(`(() => { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); s.settings = { ...s.settings, coureur: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); })()`);
await go('/parametres', 3000);
const labels = await evaluate(`[...document.querySelectorAll('label')].map((l) => l.textContent)`);
check('Réglages : la ligne « Objectif par semaine »', labels.some((t) => t.startsWith('Objectif par semaine')));
check('Réglages : plus de durée, de tour ni de recul', !labels.some((t) => /Durée d'une période|Tour complet en|Tout perdre en|Objectif d'une période/.test(t)));
check('Réglages : objectif à 60 min', await setField('Objectif par semaine', '60'));
await wait(300);
await go('/profil', 4500);
check('à 60 min, aucune semaine tenue : la graine', (await slotText()) === '0étape', await slotText());
await go('/parametres', 3000);
await setField('Objectif par semaine', '');
await wait(300);
await go('/profil', 4500);
check('vidé : 45 min par défaut', (await slotText()) === '30étapes', await slotText());

// 4. État vu d'avant la règle, puis rejeu d'un recul de 9.
const recordDrawn = async (shots) => {
  const drawn = [];
  for (let k = 0; k < 50; k++) {
    await wait(100);
    const v = await evaluate(`document.querySelector('canvas.profile-root')?.dataset.niveau ?? null`);
    if (v !== null && v !== undefined) drawn.push(Number(v));
    if (shots && shotDir && [8, 16, 24].includes(k)) await shoot(`racine-rejeu-${k}`);
  }
  return drawn;
};
await setClock(dayAt(32, 0, 12), false);
await evaluate(`(() => { const all = JSON.parse(localStorage.getItem('tracker.profil') ?? '{}'); all.racine = { level: 3, period: 1, minutes: 20 }; localStorage.setItem('tracker.profil', JSON.stringify(all)); })()`);
await send('Page.navigate', { url: `${BASE}/profil` });
let drawn = await recordDrawn(false);
check('état vu sans version (valeurs d\'essai) ignoré : rien de rejoué', drawn.length > 0 && drawn.every((v) => v === 21), [...new Set(drawn)].join(' → '));
check('état vu réécrit avec la version de la règle', (await seen())?.rules === 2, JSON.stringify(await seen()));

await profileAt(dayAt(30, 0, 12));
const at30 = await seen();
check('visite de la semaine 30 retenue', at30?.level === 30 && at30?.rules === 2, JSON.stringify(at30));
await setClock(dayAt(32, 0, 12), false);
await send('Page.navigate', { url: `${BASE}/profil` });
drawn = await recordDrawn(true);
check('rejeu : de 30 à 21, par l\'entre-deux', drawn[0] === 30 && drawn.some((v) => v > 21.5 && v < 29.5) && drawn.at(-1) === 21, [...new Set(drawn.map((v) => Math.round(v)))].join(' → '));
if (shotDir) plate.push({ name: 'racine-rejeu-8', label: 'Rejeu du recul de 9 : 0,9 s', full: true }, { name: 'racine-rejeu-16', label: '1,7 s', full: true }, { name: 'racine-rejeu-24', label: '2,5 s', full: true });

// 5. Téléphone.
await setClock(dayAt(35, 3, 12));
for (const width of [390, 320]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 2, mobile: true });
  await go('/profil', 4500);
  check(`${width} px : rien ne déborde`, (await overflow()) === false);
  await evaluate(`document.querySelector('.profile-root-slot').click()`);
  await wait(300);
  check(`${width} px : carré et bulle dans l'écran`, await evaluate(`(() => {
    const s = document.querySelector('.profile-root-slot').getBoundingClientRect(), b = document.querySelector('.profile-root__bubble')?.getBoundingClientRect();
    return s.right <= innerWidth && s.width >= 70 && !!b && b.left >= 0 && b.right <= innerWidth;
  })()`));
  check(`${width} px : la racine est dessinée`, (await inked()) > 1000);
  await shoot(`racine-${width}`);
}
if (shotDir) plate.push({ name: 'racine-390', label: '390 px, bulle ouverte', full: true });

if (shotDir) {
  const cells = plate.map(({ name, label, full }) => `<figure><img src="${full ? name : `${name}-pousse`}.png"><figcaption>${label}</figcaption>${full ? '' : `<a href="${name}.png">page entière</a>`}</figure>`).join('\n');
  writeFileSync(`${shotDir}/planche.html`, `<!doctype html><meta charset="utf-8"><title>Racine : planche</title>
<style>body{font:14px system-ui;margin:16px;background:#eef1f5}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
figure{margin:0;background:#fff;border-radius:12px;padding:8px}img{width:100%;display:block}figcaption{margin-top:6px;font-weight:600}a{font-size:12px}</style>
<h1>Racine du Profil, règle à la semaine</h1><main>${cells}</main>`);
}

console.log(logs.length ? `Console :\n${logs.join('\n')}` : 'Console : rien');
check('aucune erreur de console', logs.length === 0);
console.log(failures === 0 ? 'Tout est passé.' : `${failures} échec(s).`);
await send('Browser.close').catch(() => {});
process.exit(failures === 0 ? 0 : 1);
