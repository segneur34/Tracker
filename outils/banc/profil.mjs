// Banc de test : la page « Profil » (demandes du 18/10, du 19/10 et du 20/10), une période en un coup d'œil.
// Usage : node profil.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Le script écrit lui-même six sessions synthétiques de 20 min, datées en jours
// avant aujourd'hui (deux courses, une sortie à vélo en côte et une de wingfoil récentes, une course et une sortie à
// vélo de l'an passé), les importe par la page Course, et vérifie :
//  1. l'accueil : plus de graphe d'activités, une ligne « Profil » qui ouvre la page ; « Profil » dans la barre du haut ;
//  2. la période en tête (bouton glissant), « Année » au départ : distance (somme des vitesses × durées, à 5 % près),
//     sport préféré (la course, avec son dessin, qui ouvre sa bibliothèque), D+ de la côte seule, nombre de sessions du graphe ; l'anneau et sa légende (une part par activité, la course à 50 %) ;
//     le graphe d'activités en bas, sans barre de période à lui ;
//  3. les autres périodes règlent toute la page : « 30 jours » (trois sessions), « Depuis le début » (les six, une
//     barre par mois), choix retenu au rechargement ;
//  4. une ligne de la légende ouvre la bibliothèque filtrée sur son activité ;
//  5. à 390×844 : rien ne déborde, chiffres en une bande de deux sur deux, détail par activité retenu déplié ; la case « Profil » de la barre du bas ouvre la page, allumée ;
//     à 320 px, aucune case de la bande ne sort de l'écran (la bande « qui dépasse » de la maquette du 22/10) ;
//  6. cinq activités de plus (huit en tout) : « Autres (3) » dans l'anneau ; le toucher ouvre le détail replié et y
//     déplie ses trois activités, en retrait, dont une ouvre sa bibliothèque ; la ligne « Autres » les replie ;
//  7. la photo (22/10) : au départ le dessin du sport préféré ; toucher la photo ouvre le choix des seize dessins ;
//     un dessin choisi, puis une image importée (réduite à 256 px, en JPEG), tous deux retenus au rechargement ;
//     « Retirer » rend le dessin du sport préféré.
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
// Rangée « avancé » des analyses ouverte d'office (22/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {}` });
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
const pick = (label) => evaluate(`(() => {
  const b = [...document.querySelectorAll('.profile-periods [role=radio]')].find((el) => el.textContent.replace(/\\u00a0/g, ' ').trim() === ${JSON.stringify(label)});
  if (!b) return false;
  b.click();
  return true;
})()`);
const pressed = () => evaluate(`document.querySelector('.profile-periods [role=radio][aria-checked=true]')?.textContent.replace(/\\u00a0/g, ' ').trim() ?? null`);
const favorite = () => text('.profile-figure__name');
const chartCount = () => text('.actchart__head span');
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
check('accueil : plus de ligne « Profil » (demande du 19/10)', !(await evaluate(`[...document.querySelectorAll('.home-link')].some((el) => el.textContent.trim() === 'Profil')`)));
const opened = await evaluate(`(() => {
  const a = [...document.querySelectorAll('.shell-toplink')].find((el) => el.textContent.trim() === 'Profil');
  if (!a) return false;
  a.click();
  return true;
})()`);
check('barre du haut : lien « Profil »', opened);
await wait(1500);
check('le lien ouvre la page', (await search()) === '/profil', await search());
check('barre du haut : Profil, allumé', await evaluate(`[...document.querySelectorAll('.shell-toplink')].some((a) => a.textContent.trim() === 'Profil' && a.classList.contains('active'))`));

// 2. L'année en cours.
check('titre', (await text('.profile-head__title')) === 'Profil', await text('.profile-head__title'));
check('périodes en tête, « Année » au départ', (await evaluate(`[...document.querySelectorAll('.profile-periods [role=radio]')].map((b) => b.textContent.replace(/\\u00a0/g, ' ').trim()).join(' | ')`))
  === 'Semaine | 30 jours | 6 mois | Année | Depuis le début' && (await pressed()) === 'Année', await pressed());
check("plus de flèches d'année", (await evaluate(`!!document.querySelector('.profile-year')`)) === false);
check("le graphe n'a plus sa propre barre de période", (await evaluate(`!!document.querySelector('.actchart__periods')`)) === false);
let [count, distance, gain] = await figures();
check('nombre d\'activités de l\'année, en tête de la bande', count === '4', count);
const km = parseFr(distance);
check('distance de l\'année, en km', distance?.endsWith('km') && Math.abs(km - kmOf(current)) / kmOf(current) < 0.05, `${distance} pour ${kmOf(current).toFixed(1)} attendus`);
check('plus de case « Temps »', !(await evaluate(`[...document.querySelectorAll('.profile-figure .ui-eyebrow')].some((e) => e.textContent === 'Temps')`)));
check('sport préféré : la course, avec son dessin', (await favorite()) === 'Course'
  && (await evaluate(`!!document.querySelector('.profile-figure--link svg.profile-figure__art path')`)), await favorite());
const gainM = parseFr(gain);
check('D+ de l\'année : la côte', gain?.endsWith('m') && gainM > 150 && gainM < 230, gain);
check('nombre de sessions (graphe)', (await chartCount()) === '4 sessions', await chartCount());
const ordre = await evaluate(`[...document.querySelectorAll('.profile > *')].map((el) => (el.getAttribute('class') ?? '').split(' ')[0] || el.tagName).join(' > ')`);
check('ordre : fond, en-tête, période, chiffres, répartition, graphe', /^page-backdrop > profile-head > ui-segmented.*profile-figures.*profile-split.*actchart/.test(ordre ?? ''), ordre);
check('détail par activité replié au départ', (await evaluate(`document.querySelector('.profile-fold')?.getAttribute('aria-expanded')`)) === 'false'
  && (await legend()).length === 0);
await evaluate(`document.querySelector('.profile-fold').click()`);
await wait(300);
let rows = await legend();
check('légende : une ligne par activité, la course en tête à 50 %', rows?.length === 3 && rows[0].endsWith('50 %') && rows[0].includes('40 min')
  && rows.slice(1).every((r) => r.endsWith('25 %')), JSON.stringify(rows));
check('anneau : trois parts', (await evaluate(`document.querySelectorAll('.profile-donut circle').length`)) === 3);
check('centre de l\'anneau : le total', (await text('.profile-donut__center')) === 'Total1 h 20', await text('.profile-donut__center'));
await evaluate(`document.querySelector('.profile-legend li').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
await wait(200);
check('survol d\'une ligne : sa part au centre', (await text('.profile-donut__center'))?.endsWith('40 min50 %'), await text('.profile-donut__center'));
await evaluate(`document.querySelector('.profile-legend li').dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))`);
await shoot('profil-ordinateur');

// 3. Les autres périodes règlent toute la page.
const recent = SESSIONS.filter(([, d]) => d <= 29);
check('« 30 jours »', await pick('30 jours'));
await wait(500);
[, distance] = await figures();
check('30 jours : chiffres', Math.abs(parseFr(distance) - kmOf(recent)) / kmOf(recent) < 0.05 && (await favorite()) === 'Course' && (await chartCount()) === '3 sessions',
  `${distance} ; ${await favorite()} ; ${await chartCount()}`);
rows = await legend();
check('30 jours : légende sans le wingfoil', rows?.length === 2, JSON.stringify(rows));
check('30 jours : une barre par jour', (await evaluate(`document.querySelectorAll('.actchart__bar').length`)) === 30);
check('« Depuis le début »', await pick('Depuis le début'));
await wait(500);
[count, distance] = await figures();
check('depuis le début : six activités', count === '6', count);
check('depuis le début : les six sessions', Math.abs(parseFr(distance) - kmOf(SESSIONS)) / kmOf(SESSIONS) < 0.05 && (await text('.profile-donut__center')) === 'Total2 h 00'
  && (await chartCount()) === '6 sessions', `${distance} ; ${await text('.profile-donut__center')} ; ${await chartCount()}`);
check('depuis le début : un mois par barre', (await text('.actchart__head h2')) === 'Depuis le début, par mois'
  && (await evaluate(`document.querySelectorAll('.actchart__bar').length`)) >= 14, await text('.actchart__head h2'));
await go('/profil');
check('choix retenu au rechargement', (await pressed()) === 'Depuis le début', await pressed());
check('« Année » de nouveau', await pick('Année'));
await wait(500);
check("retour à l'année", (await chartCount()) === '4 sessions', await chartCount());

// 4. Le sport préféré, puis une ligne de la légende, ouvrent la bibliothèque de leur activité.
await evaluate(`document.querySelector('.profile-figure--link').click()`);
await wait(1500);
check('le sport préféré ouvre sa bibliothèque', (await search())?.startsWith('/course?activite=running'), await search());
await go('/profil');
await evaluate(`document.querySelector('.profile-legend__row').click()`);
await wait(1500);
check('la ligne ouvre la bibliothèque filtrée', (await search())?.startsWith('/course?activite='), await search());

// 5. Téléphone.
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go('/profil');
check('390 px : rien ne déborde', !(await overflow()));
/** Bande des chiffres : deux cases sur deux lignes, aucune hors de l'écran. */
const twoByTwo = () => evaluate(`(() => {
  const f = [...document.querySelectorAll('.profile-figure')].map((el) => el.getBoundingClientRect());
  return f.length === 4 && Math.abs(f[1].top - f[0].top) < 1 && Math.abs(f[3].top - f[2].top) < 1 && f[2].top > f[0].top
    && f.every((r) => r.left >= 0 && r.right <= window.innerWidth);
})()`);
check('390 px : chiffres en deux sur deux, dans l\'écran', await twoByTwo());
const periodsFit = () => evaluate(`(() => { const r = document.querySelector('.profile-periods'); return r.scrollWidth <= r.clientWidth; })()`);
check('390 px : les cinq périodes tiennent sans défiler', await periodsFit());
check('390 px : détail par activité toujours déplié (état retenu)', (await legend()).length === 3);
await shoot('profil-telephone');
await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 2, mobile: true });
await go('/profil');
check('320 px : rien ne déborde, la bande non plus', !(await overflow()) && (await twoByTwo()));
check('320 px : les cinq périodes tiennent sans défiler', await periodsFit());
check('320 px : aucun chiffre plus large que sa case', await evaluate(`[...document.querySelectorAll('.profile-figure__value')].every((v) => v.scrollWidth <= v.clientWidth + 1)`));
await shoot('profil-320');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go('/');
const tab = `[...document.querySelectorAll('.shell-tabbar .shell-tab')].find((t) => t.textContent.trim() === 'Profil')`;
check('barre du bas : Accueil, Profil, Statistiques, Réglages',
  (await evaluate(`[...document.querySelectorAll('.shell-tabbar .shell-tab')].map((t) => t.textContent.trim()).join(' | ')`)) === 'Accueil | Profil | Statistiques | Réglages');
await evaluate(`${tab}.click()`);
await wait(1000);
check('la case Profil ouvre la page, allumée', (await search()) === '/profil' && (await evaluate(`${tab}.classList.contains('active')`)), await search());
check('390 px : barre du bas sans débordement', !(await overflow()));

// 6. « Autres » : cinq activités de plus, 20 min chacune, cette semaine.
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
const EXTRA = [['windsurf', 3, 8], ['kite', 4, 9], ['bateau', 5, 4], ['run-intervals', 6, 3.5], ['surf', 7, 3]];
await go('/course', 4000);
console.log('import des cinq de plus :', await evaluate(`(() => {
  const input = document.querySelector('input[type=file][accept=".gpx"]');
  if (!input) return 'absent';
  const dt = new DataTransfer();
  for (const [name, text] of ${JSON.stringify(EXTRA.map(([type, d, v]) => [`${type}-${d}.gpx`, gpxOf(type, d, v)]))}) {
    dt.items.add(new File([text], name, { type: 'application/gpx+xml' }));
  }
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`));
await wait(10000);
await go('/profil');
// Détail replié d'abord, pour voir le toucher sur « Autres » l'ouvrir.
if ((await evaluate(`document.querySelector('.profile-fold')?.getAttribute('aria-expanded')`)) === 'true') await evaluate(`document.querySelector('.profile-fold').click()`);
await wait(300);
check('anneau : six parts, la dernière grise', (await evaluate(`document.querySelectorAll('.profile-donut circle').length`)) === 6
  && (await evaluate(`[...document.querySelectorAll('.profile-donut circle')].at(-1).getAttribute('stroke')`)) === '#9aa0a6');
await evaluate(`[...document.querySelectorAll('.profile-donut circle')].at(-1).dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await wait(400);
check('toucher « Autres » : centre sur son total', (await text('.profile-donut__center')) === 'Autres (3)1 h 0033 %', await text('.profile-donut__center'));
check('toucher « Autres » : le détail s\'ouvre', (await evaluate(`document.querySelector('.profile-fold')?.getAttribute('aria-expanded')`)) === 'true');
const subs = () => evaluate(`[...document.querySelectorAll('.profile-legend__sub')].map((li) => li.textContent)`);
check('… et ses trois activités dépliées, en retrait', (await subs())?.length === 3 && (await subs()).every((r) => r.includes('20 min')), JSON.stringify(await subs()));
await shoot('profil-autres');
await evaluate(`[...document.querySelectorAll('.profile-legend li')].find((li) => li.textContent.startsWith('Autres')).querySelector('button').click()`);
await wait(300);
check('la ligne « Autres » les replie', (await subs())?.length === 0);
await evaluate(`[...document.querySelectorAll('.profile-legend li')].find((li) => li.textContent.startsWith('Autres')).querySelector('button').click()`);
await wait(300);
await evaluate(`document.querySelector('.profile-legend__sub button').click()`);
await wait(1500);
check('une activité d\'« Autres » ouvre sa bibliothèque', /^\/(voile|course|fractionne|surf|velo)\?activite=/.test((await search()) ?? ''), await search());

// 7. La photo.
await go('/profil');
const avatarState = () => evaluate(`(() => {
  const b = document.querySelector('.profile-head__avatar');
  const img = b?.querySelector('img');
  if (img) return 'photo ' + img.naturalWidth + ' ' + img.getAttribute('src').slice(0, 15);
  const disc = b?.querySelector('.profile-avatar__disc');
  return disc ? 'dessin ' + disc.style.background + (disc.querySelector('svg path') ? ' tracé' : '') : 'rien';
})()`);
const before = await avatarState();
check('photo au départ : le dessin du sport préféré, à sa couleur', /^dessin .+ tracé$/.test(before ?? ''), before);
await evaluate(`document.querySelector('.profile-head__avatar').click()`);
await wait(300);
check('toucher la photo ouvre le choix des seize dessins', (await evaluate(`document.querySelectorAll('.avatar-picker__choice').length`)) === 16);
await evaluate(`document.querySelector('.avatar-picker__choice[aria-label="Kitesurf"]').click()`);
await wait(300);
check('un dessin choisi : le choix se ferme, la photo suit', !(await evaluate(`!!document.querySelector('.avatar-picker')`)) && (await avatarState()) === 'dessin var(--voile) tracé', await avatarState());
await go('/profil');
check('… retenu au rechargement', (await avatarState()) === 'dessin var(--voile) tracé', await avatarState());
await evaluate(`document.querySelector('.profile-head__avatar').click()`);
await wait(300);
check('le dessin choisi est cerclé', (await evaluate(`document.querySelector('.avatar-picker__choice[aria-pressed=true]')?.getAttribute('aria-label')`)) === 'Kitesurf');
console.log('image importée :', await evaluate(`(async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 800; canvas.height = 500;
  const g = canvas.getContext('2d');
  g.fillStyle = '#d11a1a'; g.fillRect(0, 0, 800, 500);
  g.fillStyle = '#ffffff'; g.fillRect(300, 150, 200, 200);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const input = document.querySelector('.avatar-picker input[type=file]');
  if (!input) return 'champ absent';
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'moi.png', { type: 'image/png' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`));
await wait(1500);
check('image importée : réduite à 256 px, en JPEG, le choix fermé', (await avatarState()) === 'photo 256 data:image/jpeg' && !(await evaluate(`!!document.querySelector('.avatar-picker')`)), await avatarState());
await go('/profil');
check('… retenue au rechargement', (await avatarState()) === 'photo 256 data:image/jpeg', await avatarState());
await shoot('profil-photo');
await evaluate(`document.querySelector('.profile-head__avatar').click()`);
await wait(300);
await evaluate(`[...document.querySelectorAll('.avatar-picker button')].find((b) => b.textContent.trim() === 'Retirer').click()`);
await wait(300);
check('« Retirer » rend le dessin du sport préféré', (await avatarState()) === before, await avatarState());

console.log(logs.length ? `Console :\n${logs.join('\n')}` : 'Console : aucune erreur');
console.log(failures === 0 ? 'Tout est bon.' : `${failures} échec(s).`);
process.exit(failures === 0 ? 0 : 1);
