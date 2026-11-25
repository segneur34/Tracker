// Banc de test : GPS perdu pendant un enregistrement (lot 115, décisions du 01/11).
// Usage : node gps-perdu.mjs <port> <dossier de travail, chemin Windows>
// Sur un profil neuf, sans réseau. Dure environ 2 min 45, à temps réel (rejeu ×1, minuteur de 60 s).
// Le script écrit une trace de voile datée de maintenant : 20 s de positions, un trou de 90 s, puis 30 s. Il vérifie :
//  1. pendant le trou, rien avant 1 min sans position ;
//  2. vers 1 min 01 : l'alerte rouge de la page Enregistrer (`ui-alert--danger`) dit « GPS perdu », le son est joué une
//     seule fois (« [bips] gps perdu », version navigateur de `platform/beeper.ts`), la notification le dit au titre
//     (« [notification] Voile · GPS perdu | … », version navigateur de `platform/notification.ts`) ;
//  3. aucun rappel pendant le reste du trou ;
//  4. au retour des positions : alerte effacée, notification sans « GPS perdu », toujours un seul son ; un rejeu ne
//     propose jamais « Réessayer » du GPS (lot 232).
//  5. (lot 232) GPS du navigateur, sans position (position du navigateur simulée, muette) : « en attente de la
//     première position » et « Réessayer » sous la ligne d'état ; l'appui montre « nouvelle tentative… » 5 s, puis
//     « Réessayer » revient ; la première position efface l'attente et le bouton. Aucun « Activer la localisation »
//     (la localisation coupée n'existe que sur le téléphone).
//  6. (lot 232, calage du GPS au départ) : cette première position est annoncée à 30 m, puis 18 m : « le GPS se cale
//     (± 30 m) », puis « (± 18 m) », seul sur sa ligne, sans « Réessayer » ni attente, un cercle rond autour de la
//     position sur la carte, aucun point gardé ; une position à 5 m commence la trace : texte et cercle partent.
// La sortie standard ne porte aucune durée : elle sert à comparer deux passages.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from './lib/cdp.mjs';

const [port, workDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node gps-perdu.mjs <port> <dossier de travail>');
  process.exit(1);
}

// --- Protocole (lib/cdp.mjs) ---
const { evaluate, go, wait, blockNetwork, importFiles, close, logs, onMessage } = await connect({ port, width: 1400, height: 1000 });
/** Envois de la notification et sons « GPS perdu », avec l'instant de réception. */
const sent = [];
const lostTones = [];
onMessage((msg) => {
  if (msg.method !== 'Runtime.consoleAPICalled' || msg.params.type !== 'debug') return;
  const text = msg.params.args.map((a) => a.value ?? a.description).join(' ');
  if (text.startsWith('[notification]')) sent.push({ atMs: Date.now(), text: text.slice('[notification] '.length) });
  if (text.startsWith('[bips] gps perdu')) lostTones.push(Date.now());
});
let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'ÉCHEC'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const clickText = (text, selector = 'button') => evaluate(`(() => {
  const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)} || x.textContent.includes(${JSON.stringify(text)}));
  if (!b) return 'absent'; if (b.disabled) return 'désactivé'; b.click(); return 'ok';
})()`);
const holdStop = async () => {
  const down = await evaluate(`(() => { const b = [...document.querySelectorAll('button.ui-btn--danger')].find((x) => x.textContent.includes('Arrêter') && !x.disabled && !x.closest('.ivl')); if (!b) return 'absent'; window.__stopButton = b; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); return 'ok'; })()`);
  if (down !== 'ok') return down;
  await wait(2300);
  return evaluate(`(() => { const b = window.__stopButton; b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })); b.click(); return 'ok'; })()`);
};
/** Texte de l'alerte rouge de la page, ou `null` sans alerte. */
const alertText = () => evaluate(`document.querySelector('.ui-alert--danger')?.textContent ?? null`);
/** Attend que `test` soit vrai, au plus `maxMs` ; rend l'instant où il l'est devenu, ou `null`. */
const waitFor = async (test, maxMs) => {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    if (await test()) return Date.now();
    await wait(250);
  }
  return null;
};

/** Trace de voile à 1 Hz datée de maintenant : 20 s, un trou de 90 s, 30 s. */
const gapTrace = (path) => {
  const t0 = Date.now();
  const lat = 43.7;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  const seconds = [...Array.from({ length: 21 }, (_, k) => k), ...Array.from({ length: 31 }, (_, k) => 110 + k)];
  const pts = seconds.map((s) => {
    const meters = s * 4;
    return `<trkpt lat="${lat}" lon="${(3.85 + meters / mPerDegLon).toFixed(7)}"><time>${new Date(t0 + s * 1000).toISOString()}</time><extensions><speed>4.00</speed></extensions></trkpt>`;
  });
  writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Rejeu</name><type>wingfoil</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`);
};

await blockNetwork(['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*']);

const path = join(workDir, 'gps-perdu.gpx');
gapTrace(path);
await go('/enregistrer');
await clickText('Voile', '[aria-label=Famille] button');
await wait(300);
await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click(); 'ok'`);
await wait(300);
await importFiles(path, 'input[type=file][accept*=".gpx"]');
await wait(500);
// Rejeu ×1 : le trou dure vraiment 90 s.
await evaluate(`(() => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === '600')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '1'); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
const startedAt = Date.now();
console.log('Démarrer :', await clickText('Démarrer'));

// 1. Pendant le trou, rien avant 1 min sans position (dernière position du premier morceau vers 20 s).
await wait(Math.max(0, startedAt + 77_000 - Date.now()));
check('rien avant 1 min sans position', lostTones.length === 0 && !((await alertText()) ?? '').includes('GPS perdu'));

// 2. Vers 1 min 01 sans position : alerte, son unique, notification.
const lostAt = await waitFor(async () => ((await alertText()) ?? '').includes('GPS perdu'), 12_000);
check('alerte rouge « GPS perdu »', lostAt !== null, await alertText());
const sinceStartS = lostAt === null ? null : (lostAt - startedAt) / 1000;
process.stderr.write(`[banc] alerte à ${sinceStartS} s du départ (attendu vers 80 s)\n`);
check('alerte vers 1 min après la dernière position', sinceStartS !== null && sinceStartS >= 79 && sinceStartS <= 86);
check('son « GPS perdu » joué une fois', lostTones.length === 1, `${lostTones.length} son(s)`);
await wait(1000);
const lostNotice = sent.filter((s) => s.text.includes('GPS perdu'));
check('notification « GPS perdu » au titre', lostNotice.length >= 1 && lostNotice.every((s) => s.text.startsWith('Voile · GPS perdu | ')), lostNotice[0]?.text);

// 3. Aucun rappel pendant le reste du trou (retour des positions vers 110 s).
await wait(Math.max(0, startedAt + 108_000 - Date.now()));
check('aucun rappel pendant le trou', lostTones.length === 1, `${lostTones.length} son(s)`);

check('rejeu : ni attente de la première position, ni « Réessayer » du GPS (lot 232)',
  (await evaluate(`document.querySelectorAll('.rec-rescue').length`)) === 0);

// 4. Retour des positions : tout s'efface.
const mark = sent.length;
const clearedAt = await waitFor(async () => !((await alertText()) ?? '').includes('GPS perdu'), 10_000);
check('alerte effacée au retour du GPS', clearedAt !== null, await alertText());
await wait(1500);
const after = sent.slice(mark);
check('notification sans « GPS perdu » au retour', after.length >= 1 && !after[after.length - 1].text.includes('GPS perdu'), after.map((s) => s.text).join(' // ').slice(0, 300));
await wait(Math.max(0, startedAt + 135_000 - Date.now()));
check('toujours un seul son', lostTones.length === 1, `${lostTones.length} son(s)`);

console.log('Arrêter :', await holdStop());
// Rangée dès l'arrêt, analyse ouverte d'elle-même (lot 212) ; plus de « Jeter », le profil du banc est neuf à chaque script.
console.log('analyse ouverte :', (await waitFor(async () => (await evaluate('location.pathname'))?.endsWith('/analyse'), 8000)) !== null);
await wait(500);

// 5. « Réessayer » du GPS (lot 232) : GPS du navigateur, position simulée qui ne répond pas avant qu'on la donne.
await go('/enregistrer');
await clickText('Voile', '[aria-label=Famille] button');
await wait(300);
await evaluate(`[...document.querySelectorAll('input[type=radio]')][0].click(); 'ok'`);
await wait(300);
await evaluate(`(() => {
  const g = navigator.geolocation;
  g.watchPosition = (ok) => { window.__bancPosition = ok; return 1; };
  g.clearWatch = () => { window.__bancPosition = null; };
  return 'ok';
})()`);
console.log('Démarrer (GPS du navigateur) :', await clickText('Démarrer'));
/** Texte des rangées de secours de la page (« en attente… », boutons), dans l'ordre. */
const rescueText = () => evaluate(`[...document.querySelectorAll('.rec-rescue')].map((r) => r.textContent).join(' | ')`);
const waiting = await waitFor(async () => (await rescueText()).includes('en attente de la première position'), 5000);
check('sans position : « en attente de la première position » et « Réessayer »', waiting !== null && (await rescueText()).includes('Réessayer'), await rescueText());
check('« Activer la localisation » absent dans le navigateur', !(await rescueText()).includes('Activer la localisation'), await rescueText());
console.log('Réessayer :', await clickText('Réessayer', '.rec-rescue button'));
await wait(300);
check('appui : « nouvelle tentative… », bouton inactif',
  (await evaluate(`[...document.querySelectorAll('.rec-rescue button')].some((b) => b.textContent === 'nouvelle tentative…' && b.disabled)`)) === true,
  await rescueText());
const back = await waitFor(async () => (await rescueText()).includes('Réessayer'), 7000);
check('« Réessayer » revient après quelques secondes', back !== null, await rescueText());
/** Donne une position du navigateur, d'incertitude `accuracy` mètres. */
const givePosition = (accuracy) => evaluate(`window.__bancPosition?.({ timestamp: Date.now(), coords: { latitude: 43.7, longitude: 3.85, accuracy: ${accuracy}, altitude: null, speed: null, heading: null } }); 'ok'`);
/** Cercle du calage sur la carte du direct : nombre de tracés dans son calque, et largeur et hauteur du premier, en pixels. */
const settlingCircle = () => evaluate(`(() => {
  const paths = [...document.querySelectorAll('.leaflet-calageGps-pane path')].filter((p) => (p.getAttribute('d') ?? '') !== '');
  const box = paths[0]?.getBoundingClientRect();
  return { count: paths.length, w: box ? Math.round(box.width) : 0, h: box ? Math.round(box.height) : 0 };
})()`);
/** Points gardés, lus dans la carte « En cours ». */
const keptPoints = () => evaluate(`[...document.querySelectorAll('.rec-stat')].find((s) => s.textContent.startsWith('Points'))?.querySelector('.rec-stat__value')?.textContent ?? null`);

// 6. Calage du GPS au départ (lot 232) : première position large.
await givePosition(30);
const settling = await waitFor(async () => (await rescueText()).includes('le GPS se cale (± 30 m)'), 3000);
check('position à 30 m : « le GPS se cale (± 30 m) », seul, sans « Réessayer » ni attente',
  settling !== null && (await rescueText()) === 'le GPS se cale (± 30 m)', await rescueText());
await wait(300);
const circle = await settlingCircle();
check('position à 30 m : un cercle rond autour de la position', circle.count === 1 && circle.w > 10 && Math.abs(circle.w - circle.h) <= 2, JSON.stringify(circle));
check('position à 30 m : aucun point gardé', (await keptPoints()) === '0', await keptPoints());
await wait(300);
await givePosition(18);
const narrower = await waitFor(async () => (await rescueText()) === 'le GPS se cale (± 18 m)', 3000);
await wait(300);
const smaller = await settlingCircle();
check('position à 18 m : « (± 18 m) », cercle plus petit', narrower !== null && smaller.count === 1 && smaller.w < circle.w, `${await rescueText()} ${JSON.stringify(smaller)}`);
await wait(300);
await givePosition(5);
const gone = await waitFor(async () => (await rescueText()) === '', 3000);
check('position à 5 m : la trace commence, calage, attente et bouton effacés', gone !== null, await rescueText());
await wait(300);
check('position à 5 m : plus de cercle, un point gardé', (await settlingCircle()).count === 0 && (await keptPoints()) === '1',
  `${JSON.stringify(await settlingCircle())} ${await keptPoints()}`);
console.log('Arrêter :', await holdStop());
await wait(1500);

console.log(logs.length ? `console :\n  ${logs.join('\n  ')}` : 'console : rien');
console.log(failures ? `${failures} échec(s)` : 'tout est bon');
await close();
process.exit(failures ? 1 : 0);
