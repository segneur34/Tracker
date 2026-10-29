// Banc de test : aides « ? » partout et barre du haut sans « Accueil » (lot 3 des demandes du 24/10).
// Usage : node aides.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau (IGN, Overpass, tuiles bloqués). Dure environ 1 min. Le script :
//  1. importe une wing (la trace de `make-gpx.mjs`) et une course en côte ;
//  2. course : aucune explication à l'ouverture des graphiques ; le « ? » du titre l'ouvre juste sous le titre,
//     sans replier le panneau ; celui des réglages referme le premier (une seule aide à la fois) ; un second appui
//     referme ;
//  3. voile : le « ? » des manœuvres, puis celui du vent, qui referme le premier ;
//  4. Statistiques : rien d'ouvert, la note du graphique sous son « ? » ; passer par Profil et revenir, par la barre,
//     referme l'aide (une aide ne survit pas à un changement de page) ;
//  5. barre du haut à 1400 et 1000 px (800 px relevé pour information) : plus de lien « Accueil » (le logo y mène), chaque lien sur une ligne,
//     « Itinéraires » entier ; au téléphone, « Accueil » reste dans la barre du bas, et pas de pop-up du profil.
import { connect } from './lib/cdp.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node aides.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, settle, waitFor, wait, blockNetwork, importGpx, records, shoot, close, logs } = await connect({ port, width: 1400, height: 1000, shotDir });

const clickTab = (label) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!t) return false;
  t.click();
  return true;
})()`);
const advancedOpen = () => evaluate(`document.querySelector('.an-tabs-advanced-toggle')?.getAttribute('aria-expanded') === 'true'`);
const setAdvanced = async (wanted) => {
  if ((await advancedOpen()) !== wanted) await clickTab('avancé');
  await wait(400);
};
const setTab = (label, wanted) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!t) return 'absent';
  if ((t.getAttribute('aria-pressed') === 'true') !== ${wanted}) t.click();
  return 'ok';
})()`);
const panelOf = (title) => `[...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim().startsWith(${JSON.stringify(title)}))?.closest('.an-carte-panels > *')`;
const panel = async (title) => (await evaluate(`${panelOf(title)}?.innerText.replace(/\\n+/g, ' / ') ?? '(absent)'`));
let failures = 0;
const check = (what, ok, detail) => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${what}${!ok && detail !== undefined ? ` (${detail})` : ''}`); if (!ok) failures++; };

await blockNetwork();


// --- Sessions synthétiques ---
const gpxOf = (type, pts) => `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Banc</name><type>${type}</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`;
/** Wing : la trace de `make-gpx.mjs` (bords de près et de portant, virements et empannages, vent du nord), 8 m/s et plus. */
const wingGpx = (t0) => {
  let lat = 43.5, lon = 3.95, t = 0;
  const R = 6371000;
  const pts = [];
  const step = (heading, speed) => {
    lat += (speed * Math.cos(heading * Math.PI / 180)) / R * 180 / Math.PI;
    lon += (speed * Math.sin(heading * Math.PI / 180)) / (R * Math.cos(lat * Math.PI / 180)) * 180 / Math.PI;
    pts.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><time>${new Date(t0 + t * 1000).toISOString()}</time><extensions><speed>${speed.toFixed(2)}</speed></extensions></trkpt>`);
    t++;
  };
  const leg = (h, s, n) => { for (let i = 0; i < n; i++) step(h + Math.sin(i / 7) * 3, s + Math.sin(i / 5) * 0.5); };
  const turn = (from, to, sMin, sMax, n) => {
    const diff = ((to - from + 540) % 360) - 180;
    for (let i = 1; i <= n; i++) step((from + diff * (i / n) + 360) % 360, sMax - (sMax - sMin) * Math.sin(Math.PI * (i / n)));
  };
  for (let k = 0; k < 6; k++) { leg(45, 7, 150); turn(45, 315, 5, 7, 6); leg(315, 7, 150); turn(315, 45, 5, 7, 6); }
  turn(45, 135, 6, 9, 5);
  for (let k = 0; k < 6; k++) { leg(135, 9, 150); turn(135, 225, 6, 9, 6); leg(225, 9, 150); turn(225, 135, 6, 9, 6); }
  return gpxOf('wingfoil', pts);
};
/** Aller et retour vers l'est, en côte de `grade` à l'aller, à vitesse constante, avec altitude. */
const hillGpx = (type, seconds, speed, grade, t0) => {
  const lat = 43.7;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  const pts = [];
  const half = seconds / 2;
  for (let k = 0; k <= seconds; k++) {
    const m = (k <= half ? k : seconds - k) * speed;
    pts.push(`<trkpt lat="${(lat + (k > half ? 0.0002 : 0)).toFixed(7)}" lon="${(3.85 + m / mPerDegLon).toFixed(7)}"><ele>${(50 + grade * m).toFixed(1)}</ele><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>${speed}</speed></extensions></trkpt>`);
  }
  return gpxOf(type, pts);
};
const T_VOILE = Date.UTC(2026, 9, 5, 13, 0, 0);
const T_RUN = Date.UTC(2026, 9, 6, 8, 0, 0);
const SESSIONS = [
  { key: 'voile', page: 'voile', start: T_VOILE, gpx: wingGpx(T_VOILE) },
  // Course : 40 min à 3 m/s, 3 % à l'aller.
  { key: 'course', page: 'course', start: T_RUN, gpx: hillGpx('running', 2400, 3, 0.03, T_RUN) },
];

const paths = {};
for (const s of SESSIONS) {
  await go(`/${s.page}`, 3000);
  console.log(`import ${s.key} :`, await importGpx(s.gpx, `${s.key}.gpx`));
  const rec = await waitFor(async () => (await records())?.find((r) => Math.abs((r.summary?.startMs ?? 0) - s.start) < 2000), { timeout: 7000, label: `fiche ${s.key}` });
  await settle({ max: 2000, label: `import ${s.key}` });
  paths[s.key] = `/${s.page}/analyse?session=${encodeURIComponent(rec?.gpx ?? '')}`;
  check(`${s.key} rangée`, Boolean(rec));
}

const helpLabels = () => evaluate(`[...document.querySelectorAll('button.ui-help')].map((b) => b.getAttribute('aria-label'))`);
const openNotes = () => evaluate(`[...document.querySelectorAll('.help-note, .settings-help')].map((n) => n.textContent.replace(/\\s+/g, ' ').trim())`);
const clickHelp = async (label) => {
  const done = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button.ui-help')].find((x) => x.getAttribute('aria-label') === ${JSON.stringify(`Aide : ${label}`)});
    if (!b) return false;
    b.click();
    return true;
  })()`);
  await wait(300);
  return done;
};
const text = () => evaluate(`document.body.innerText`);

// --- 2. Course ---
await go(paths.course, 7000);
await setAdvanced(true);
console.log('graphiques :', await setTab('graphiques', true));
await settle({ max: 1500 });
check("course : pas d'explication à l'ouverture des graphiques", !(await text()).includes('Vitesse lissée sur 10 s') && (await openNotes()).length === 0, (await openNotes()).join(' | '));
check('course : « ? » du titre des graphiques', (await helpLabels()).includes('Aide : Graphiques'), (await helpLabels()).join(', '));
check("course : le « ? » ouvre l'explication", (await clickHelp('Graphiques')) && (await openNotes()).length === 1 && (await openNotes())[0].startsWith('Vitesse lissée sur 10 s'), (await openNotes()).join(' | '));
check('course : le panneau reste ouvert', (await panel('Graphiques')) !== '(absent)');
const placed = await evaluate(`(() => {
  const p = ${panelOf('Graphiques')};
  const note = p?.querySelector('.help-note');
  const chart = p?.querySelector('svg.recharts-surface');
  const title = p?.querySelector('[role=button]');
  if (!note || !chart || !title) return 'absent';
  const n = note.getBoundingClientRect(), c = chart.getBoundingClientRect(), t = title.getBoundingClientRect();
  return n.top >= t.bottom - 1 && n.bottom <= c.top + 1 ? 'ok' : JSON.stringify({ title: t.bottom, note: [n.top, n.bottom], chart: c.top });
})()`);
check("course : l'explication sous le titre, avant les graphes", placed === 'ok', placed);
await shoot('aides-course');
console.log('réglages :', await setTab('réglages', true));
await settle({ max: 800 });
check('course : « ? » des réglages, qui referme le premier', (await clickHelp('Réglages de la session')) && (await openNotes()).length === 1 && (await openNotes())[0].startsWith('Vitesse :'), (await openNotes()).join(' | '));
check('course : un second appui referme', (await clickHelp('Réglages de la session')) && (await openNotes()).length === 0, (await openNotes()).join(' | '));

// --- 3. Voile ---
await go(paths.voile, 7000);
await setAdvanced(true);
console.log('manœuvres :', await setTab('manœuvres', true));
console.log('vent :', await setTab('vent', true));
await settle({ max: 1500 });
check("voile : rien d'ouvert au départ", !(await text()).includes('Enregistrement :') && !(await text()).includes('Chaque virement et chaque empannage'), '');
check('voile : « ? » des manœuvres', (await clickHelp('Manœuvres')) && (await text()).includes('Enregistrement :'), (await helpLabels()).join(', '));
check('voile : « ? » du vent, qui referme celui des manœuvres', (await clickHelp('Variations du Vent')) && (await text()).includes('Chaque virement et chaque empannage') && !(await text()).includes('Enregistrement :'), '');
await shoot('aides-voile');

// --- 4. Statistiques, et changement de page ---
await go('/statistiques', 4000);
check("statistiques : rien d'ouvert", (await openNotes()).length === 0, (await openNotes()).join(' | '));
console.log('onglet graphique :', await evaluate(`(() => { const t = [...document.querySelectorAll('.ui-tab')].find((x) => x.textContent.trim() === 'graphique'); if (!t) return 'absent'; if (t.getAttribute('aria-pressed') !== 'true') t.click(); return 'ok'; })()`));
await settle({ max: 1200 });
check('statistiques : la note du graphique cachée', !(await text()).includes('Un point par session'), '');
check("statistiques : le « ? » du graphique l'ouvre", (await clickHelp('Graphique')) && (await text()).includes('Un point par session'), (await helpLabels()).join(', '));
const nav = (href) => evaluate(`(() => { const a = document.querySelector('.shell-toplinks a[href="${href}"]'); if (!a) return false; a.click(); return true; })()`);
console.log('vers Profil :', await nav('/profil'));
await settle({ max: 1200 });
console.log('retour aux Statistiques :', await nav('/statistiques'));
await settle({ max: 1500 });
check("changer de page referme l'aide", (await evaluate('location.pathname')) === '/statistiques' && !(await text()).includes('Un point par session') && (await openNotes()).length === 0, await evaluate('location.pathname'));

// --- 5. Barre du haut ---
const topLinks = () => evaluate(`[...document.querySelectorAll('.shell-toplinks a')].map((a) => a.textContent.trim())`);
check('ordinateur : plus de lien « Accueil » en haut', !(await topLinks()).includes('Accueil'), (await topLinks()).join(', '));
check("ordinateur : le logo mène à l'accueil", (await evaluate(`document.querySelector('.shell-brand')?.getAttribute('href')`)) === '/');
for (const width of [1400, 1000, 800]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
  await wait(600);
  const bar = await evaluate(`(() => {
    // Une ligne : chaque lien garde la hauteur d'une seule ligne de texte ; rien ne sort de l'écran.
    const links = [...document.querySelectorAll('.shell-toplinks a')];
    const heights = links.map((a) => a.getBoundingClientRect().height);
    const all = [...links, ...document.querySelectorAll('.shell-topplan, .shell-toprecord')];
    const cut = all.filter((a) => a.scrollWidth > a.clientWidth + 1 || a.getBoundingClientRect().right > document.documentElement.clientWidth).map((a) => a.textContent.trim());
    return { spread: Math.max(...heights) - Math.min(...heights), cut, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  })()`);
  // 800 px : relevé seulement ; la barre n'y tient pas encore (familles, Statistiques, Profil, Réglages et deux boutons).
  if (width < 1000) console.log(`${width} px, pour information :`, JSON.stringify(bar));
  else check(`${width} px : liens de la barre du haut sur une ligne, aucun coupé`, bar.spread <= 1 && bar.cut.length === 0 && bar.overflow === 0, JSON.stringify(bar));
  await shoot(`aides-barre-${width}`);
}
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go('/', 2500);
const tabs = await evaluate(`[...document.querySelectorAll('.shell-tabbar .shell-tab')].map((a) => a.textContent.trim())`);
check('téléphone : « Accueil » dans la barre du bas', tabs.includes('Accueil'), tabs.join(', '));
check('navigateur : pas de pop-up du profil (téléphone seulement)', await evaluate(`document.querySelector('.profile-prompt') === null`));

console.log('\n--- console (erreurs, avertissements) ---');
for (const l of logs) console.log(l);
console.log(failures === 0 ? '\nTout passe.' : `\n${failures} échec(s).`);
await close();
process.exit(failures === 0 ? 0 : 1);
