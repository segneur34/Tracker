// Banc de test : la racine du Profil (22/10), une série de périodes d'activité qui pousse autour des cadres.
// Usage : node racine.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Le script écrit lui-même cinq courses de 20 min, il y a 6, 5, 4, 2 et 1 jours
// (le 3e jour manqué), et une sixième aujourd'hui s'il est plus de 0 h 40 ; il les importe par la page Course. Réglages
// d'essai par défaut : une période par jour, 15 min, le tour en 15 jours tenus, tout perdu en 30 jours manqués. Il vérifie :
//  1. le carré à droite du pseudo : 4,5 étapes (3, −0,5 pour le jour manqué, puis 2) ; le canevas couvre la page, dessiné ;
//  2. la bulle du carré : niveau, étapes restantes, temps du jour et radicelles, objectif tenu ; Échap la ferme ;
//  3. Réglages, « Pratiquant » : tout perdre en 2 jours (7,5 étapes par jour manqué) : 2 étapes, partie sèche d'une étape ;
//     la durée d'une période à 7 jours : « Cette semaine » ; champs vidés : retour aux valeurs d'essai ;
//  4. le rejeu à l'ouverture : une visite d'hier retenue sur l'appareil (3,5 étapes) ; la racine part de là et avance
//     sous les yeux jusqu'à 4,5 (niveau dessiné lu sur le canevas, `data-niveau`), puis l'état vu est mis à jour ;
//     sans changement depuis la dernière visite, rien ne bouge ;
//  5. à 390 et 320 px : rien ne déborde, le carré et la bulle restent dans l'écran.
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

// --- Sessions synthétiques : 20 min de course à 1 Hz ---
const startOf = (daysAgo) => {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  d.setHours(10, 0, 0, 0);
  return d.getTime();
};
const gpxOf = (t0, name) => {
  const points = [];
  for (let k = 0; k <= 1200; k++) {
    points.push(`<trkpt lat="43.7000000" lon="${(3.8 + (k * 3) / 80500).toFixed(7)}"><ele>50</ele><time>${new Date(t0 + k * 1000).toISOString()}</time></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><type>running</type><trkseg>\n${points.join('\n')}\n</trkseg></trk></gpx>\n`;
};
const now = new Date();
const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
const withToday = Date.now() - 40 * 60_000 > midnight;
const files = [6, 5, 4, 2, 1].map((d) => [`course-${d}.gpx`, gpxOf(startOf(d), `course ${d}`)]);
if (withToday) files.push(['course-0.gpx', gpxOf(Date.now() - 30 * 60_000, 'course 0')]);

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
})()`), withToday ? '(avec une course aujourd\'hui)' : '(sans course aujourd\'hui : avant 0 h 40)');
await wait(10000);

// 1. Le carré et le canevas.
await go('/profil', 4000);
check('carré à droite du pseudo : 4,5 étapes', (await slotText()) === '4,5étapes', await slotText());
check('le carré est dans l\'en-tête, à droite du titre', await evaluate(`(() => {
  const s = document.querySelector('.profile-head .profile-root-slot')?.getBoundingClientRect();
  const t = document.querySelector('.profile-head__title')?.getBoundingClientRect();
  return !!s && !!t && s.left >= t.right;
})()`));
check('canevas de la taille de la page', await evaluate(`(() => {
  const c = document.querySelector('canvas.profile-root'), p = document.querySelector('.profile');
  return !!c && Math.abs(c.offsetWidth - p.offsetWidth) < 1 && Math.abs(c.offsetHeight - p.offsetHeight) < 1;
})()`));
const ink1 = await inked();
check('la racine est dessinée', ink1 > 2000, String(ink1));
check('le canevas ne capte pas le toucher', (await evaluate(`getComputedStyle(document.querySelector('canvas.profile-root')).pointerEvents`)) === 'none');
await shoot('racine-ordinateur');

// 2. La bulle.
await evaluate(`document.querySelector('.profile-root-slot').click()`);
await wait(300);
let bubble = await bubbleText();
check('bulle : niveau et étapes restantes', !!bubble?.includes('Racine : 4,5 étapes') && bubble.includes('Encore 10,5 étapes pour entourer tous les cadres.'), bubble);
if (withToday) {
  check('bulle : le temps du jour, ses radicelles, objectif tenu', !!bubble?.includes("Aujourd'hui : 20 min sur 15 min · 4 radicelles") && bubble.includes('Objectif tenu : la racine gagne une étape à minuit.'), bubble);
} else {
  check('bulle : rien aujourd\'hui, la menace du recul', !!bubble?.includes("Aujourd'hui : 0 min sur 15 min") && bubble.includes("Sans 15 min de plus d'ici minuit, elle recule de 0,5 étape."), bubble);
}
check('bulle : sous le carré', await evaluate(`(() => {
  const b = document.querySelector('.profile-root__bubble').getBoundingClientRect(), s = document.querySelector('.profile-root-slot').getBoundingClientRect();
  return b.top >= s.bottom && Math.abs(b.right - s.right) < 2;
})()`));
await shoot('racine-bulle');
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
await wait(200);
check('Échap ferme la bulle', (await bubbleText()) === null);

// 3. Réglages.
await evaluate(`(() => { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); s.settings = { ...s.settings, coureur: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); })()`);
await go('/parametres', 3000);
check('Réglages : les quatre champs de la racine', (await evaluate(`["Objectif d'une période", "Durée d'une période", 'Tour complet en', 'Tout perdre en'].every((t) => [...document.querySelectorAll('label')].some((l) => l.textContent.startsWith(t)))`)) === true);
check('Réglages : « Tout perdre en » à 2', await setField('Tout perdre en', '2'));
await wait(300);
await go('/profil', 4000);
check('perdu en 2 jours : 2 étapes', (await slotText()) === '2étapes', await slotText());
await evaluate(`document.querySelector('.profile-root-slot').click()`);
await wait(300);
bubble = await bubbleText();
check('partie sèche d\'une étape', !!bubble?.includes('Partie sèche : 1 étape à regagner.'), bubble);
await shoot('racine-seche');
await go('/parametres', 3000);
await setField('Tout perdre en', '');
await setField("Durée d'une période", '7');
await wait(300);
await go('/profil', 4000);
await evaluate(`document.querySelector('.profile-root-slot').click()`);
await wait(300);
bubble = await bubbleText();
check('à la semaine : « Cette semaine », fin le dimanche soir', !!bubble?.includes('Cette semaine :') && /dimanche soir/.test(bubble ?? ''), bubble);
await go('/parametres', 3000);
await setField("Durée d'une période", '');
await wait(300);
await go('/profil', 4000);
check('champs vidés : retour aux valeurs d\'essai', (await slotText()) === '4,5étapes', await slotText());

// 4. Rejeu à l'ouverture.
const state = await seen();
check('état vu retenu sur l\'appareil', state?.level === 4.5 && typeof state?.period === 'number', JSON.stringify(state));
const still0 = await inked();
await wait(1500);
check('sans changement depuis la dernière visite, rien ne bouge', (await inked()) === still0);
await evaluate(`(() => {
  const all = JSON.parse(localStorage.getItem('tracker.profil') ?? '{}');
  all.racine = { level: 3.5, period: all.racine.period - 1, minutes: 20 };
  localStorage.setItem('tracker.profil', JSON.stringify(all));
})()`);
await send('Page.navigate', { url: `${BASE}/profil` });
// Le canevas porte le niveau dessiné (`data-niveau`) : relevé toutes les 100 ms pendant 5 s.
const drawn = [];
for (let k = 0; k < 50; k++) {
  await wait(100);
  const v = await evaluate(`document.querySelector('canvas.profile-root')?.dataset.niveau ?? null`);
  if (v !== null && v !== undefined) drawn.push(Number(v));
}
const firstDrawn = drawn[0];
const between = drawn.some((v) => v > 3.55 && v < 4.45);
check('rejeu : la racine part de la visite d\'hier (3,5), passe par l\'entre-deux et finit à 4,5', firstDrawn === 3.5 && between && drawn.at(-1) === 4.5,
  [...new Set(drawn)].join(' → '));
check('rejeu : jamais au nouveau niveau avant d\'y pousser', drawn.indexOf(4.5) > drawn.findIndex((v) => v > 3.55 && v < 4.45));
const after = await seen();
check('rejeu : l\'état vu est mis à jour', after?.level === 4.5 && after?.period === state?.period, JSON.stringify(after));

// 5. Téléphone.
for (const width of [390, 320]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 2, mobile: true });
  await go('/profil', 4000);
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

console.log(logs.length ? `Console :\n${logs.join('\n')}` : 'Console : rien');
check('aucune erreur de console', logs.length === 0);
console.log(failures === 0 ? 'Tout est passé.' : `${failures} échec(s).`);
await send('Browser.close').catch(() => {});
process.exit(failures === 0 ? 0 : 1);
