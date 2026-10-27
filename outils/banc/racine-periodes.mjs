// Banc de test : la racine du Profil ne dépend pas de la période de la page (demande du 26/10, lot B).
// Usage : node racine-periodes.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau, environ 2 min. Le script écrit 13 courses de 45 min, le lundi des semaines 0 à 12, les
// importe par la page Course, fixe l'heure de la page à la semaine 13 (13 étapes), puis ouvre le Profil aux cinq périodes
// (semaine, 30 jours, 6 mois, année, depuis le début), à 390×844 et à 1400×1000. Pour chaque période il relève :
//  - le niveau et la longueur visible de la racine mère (`data-niveau`, `data-longueur` du canevas) ;
//  - la hauteur de la page et de chacun des cadres entourés ;
// et il vérifie que la longueur de la racine est la même aux cinq périodes, pour chaque taille d'écran.
// Avec un dossier, il y écrit une capture réduite (échelle 0,35) par période et par taille.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node racine-periodes.mjs <port> [<dossier des captures>]');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://127.0.0.1:4190';

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
let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK ' : 'ÉCHEC'} ${label}${detail ? ` : ${detail}` : ''}`);
};

// --- Historique synthétique ---
const today = new Date();
const dow = (today.getDay() + 6) % 7;
const mon0 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow - 50 * 7);
const dayAt = (w, d = 0, h = 12) => new Date(mon0.getFullYear(), mon0.getMonth(), mon0.getDate() + w * 7 + d, h).getTime();
const gpxOf = (t0, minutes, name) => {
  const points = [];
  for (let k = 0; k <= minutes * 6; k++) {
    points.push(`<trkpt lat="43.7000000" lon="${(3.8 + (k * 30) / 80500).toFixed(7)}"><ele>50</ele><time>${new Date(t0 + k * 10_000).toISOString()}</time></trkpt>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><type>running</type><trkseg>\n${points.join('\n')}\n</trkseg></trk></gpx>\n`;
};
const files = Array.from({ length: 13 }, (_, w) => [`course-s${w}.gpx`, gpxOf(dayAt(w, 0, 10), 45, `course s${w}`)]);

let clockScript = null;
const setClock = async (fakeMs) => {
  if (clockScript) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clockScript });
  const source = `(() => {
    const off = ${fakeMs - Date.now()};
    const R = Date;
    class D extends R { constructor(...a) { if (a.length === 0) super(R.now() + off); else super(...a); } static now() { return R.now() + off; } }
    window.Date = D;
    try { const all = JSON.parse(localStorage.getItem('tracker.profil') ?? '{}'); delete all.racine; localStorage.setItem('tracker.profil', JSON.stringify(all)); } catch {}
  })();`;
  clockScript = (await send('Page.addScriptToEvaluateOnNewDocument', { source })).result.identifier;
};

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
await wait(12000);
await setClock(dayAt(13, 0, 12));

const PERIODS = ['semaine', 'trente', 'sixmois', 'annee', 'tout'];
const SELECTORS = ['.profile-periods', '.profile-figures', '.profile-split', '.actchart'];
const sizes = [{ name: '390x844', w: 390, h: 844, mobile: true }, { name: '1400x1000', w: 1400, h: 1000, mobile: false }];
for (const size of sizes) {
  await send('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: size.mobile });
  const lengths = [];
  const overflows = [];
  for (const period of PERIODS) {
    await evaluate(`(() => { const all = JSON.parse(localStorage.getItem('tracker.profil') ?? '{}'); all.affichage = { periode: ${JSON.stringify(period)} }; localStorage.setItem('tracker.profil', JSON.stringify(all)); })()`);
    await go('/profil', 4500);
    const m = await evaluate(`(() => {
      const c = document.querySelector('canvas.profile-root');
      const page = c?.parentElement;
      const h = (s) => Math.round(document.querySelector(s)?.getBoundingClientRect().height ?? -1);
      const last = document.querySelector('.actchart');
      return {
        niveau: c?.dataset.niveau, longueur: Number(c?.dataset.longueur), page: page?.offsetHeight,
        cadres: ${JSON.stringify(SELECTORS)}.map(h),
        hauts: ${JSON.stringify(SELECTORS)}.map((q) => Math.round((document.querySelector(q)?.getBoundingClientRect().top ?? 0) - (page?.getBoundingClientRect().top ?? 0))),
        sous: last && page ? Math.round(page.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom) : null,
        debordement: document.documentElement.scrollWidth > window.innerWidth,
      };
    })()`);
    console.log(`${size.name} ${period.padEnd(8)} niveau ${m.niveau} longueur ${m.longueur} px | page ${m.page} | cadres ${m.cadres.join('/')} | hauts ${m.hauts.join('/')} | sous le dernier cadre ${m.sous} | débordement ${m.debordement}`);
    lengths.push(m.longueur);
    overflows.push(m.debordement);
    if (shotDir) {
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.w, height: m.page, scale: 0.35 } });
      writeFileSync(`${shotDir}/racine-periode-${size.name}-${period}.png`, Buffer.from(shot.result.data, 'base64'));
    }
  }
  check(`${size.name} : longueur de la racine identique aux cinq périodes`, lengths.every((l) => l > 0 && l === lengths[0]), lengths.join(', '));
  check(`${size.name} : rien ne déborde`, overflows.every((t) => t === false));
}
console.log('\n--- console (erreurs) ---');
logs.forEach((l) => console.log(l));
console.log(failures === 0 ? '\nTout passe.' : `\n${failures} échec(s).`);
await send('Page.close').catch(() => undefined);
ws.close();
process.exit(failures === 0 ? 0 : 1);
