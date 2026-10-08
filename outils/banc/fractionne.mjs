// Banc de test : groupe Fractionné et compteur d'intervalles (§10, point 89).
// Usage : node fractionne.mjs <port> <dossier de travail, chemin Windows> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Dure environ 2 min. Le script vérifie :
//  1. Enregistrer : l'onglet Fractionné, ses deux activités, la carte « Compteur » ;
//  2. une séance de 2 × 0:05 / 0:05 gardée sous un nom, retrouvée après rechargement ;
//  3. le compteur seul : phases à l'écran, et les sons (« [bips] ») à l'heure, chaque signal fini à l'instant du
//     changement (court, court, long ; à la fin de la séance, court, long, long double) ;
//  4. pause, reprise, « Passer », puis un rechargement en pleine séance : séance reprise, bandeau sur une autre page, arrêt ;
//  5. le compteur lancé pendant un enregistrement (rejeu ×1 d'une trace datée de maintenant) : répétitions rangées dans
//     la fiche, onglet « fractionné » de l'analyse (synthèse, tableau, évolution, profil), « 2 rép. » dans la
//     bibliothèque Fractionné ;
//  6. une séance sans compteur importée (8 efforts d'une minute) : répétitions retrouvées dans la vitesse, seuil
//     d'effort imposé dans l'onglet réglages (trop haut : aucun effort ; plus bas : enregistré dans la fiche), puis
//     retour au seuil tiré de la session ;
//  7. le groupe dans Réglages et sur l'accueil, et son absence en planification.
import { writeFileSync } from 'node:fs';

const [port, workDir, shotDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node fractionne.mjs <port> <dossier de travail> [<dossier des captures>]');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://localhost:5173';

// --- Protocole ---
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
const sounds = [];
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]}`);
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description).join(' ');
    if (msg.params.type === 'debug' && /^\[(bips|compteur)\]/.test(text)) sounds.push(text);
    if (['error', 'warning'].includes(msg.params.type)) logs.push(`${msg.params.type}: ${text.split('\n')[0].slice(0, 300)}`);
  }
};
await new Promise((r) => { ws.onopen = r; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const go = async (path, ms = 3000) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
const clickText = (text, selector = 'button') => evaluate(`(() => {
  const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)} || x.textContent.includes(${JSON.stringify(text)}));
  if (!b) return 'absent'; if (b.disabled) return 'désactivé'; b.click(); return 'ok';
})()`);
const setSelect = (label, value) => evaluate(`(() => {
  const s = document.querySelector('select[aria-label=${JSON.stringify(label)}]');
  if (!s) return 'absent';
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(String(value))});
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return s.value;
})()`);
const typeInto = (label, value) => evaluate(`(() => {
  const i = document.querySelector('input[aria-label=${JSON.stringify(label)}]');
  if (!i) return 'absent';
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(value)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return i.value;
})()`);
const setFile = async (selector, file) => {
  const { result: { root } } = await send('DOM.getDocument', { depth: -1 });
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId, files: [file] });
};
const shoot = async (name) => {
  if (!shotDir) return;
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};
/** Texte du panneau d'analyse qui porte ce titre. */
const panel = (title) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim() === ${JSON.stringify(title)});
  return t ? t.closest('.an-carte-panels > *').innerText.replace(/\\n+/g, ' / ').slice(0, 700) : '(absent)';
})()`);
/** Graphes dessinés dans les panneaux Évolution et Profil. */
const charts = () => evaluate(`["Évolution des répétitions", "Profil d'une répétition"].map((title) => {
  const t = [...document.querySelectorAll('.an-carte-panels [role=button]')].find((h) => h.textContent.trim() === title);
  return title + ' : ' + (t ? t.closest('.an-carte-panels > *').querySelectorAll('.recharts-surface').length : 'absent');
}).join(' | ')`);
const card = () => evaluate(`(() => { const c = [...document.querySelectorAll('.ivl')][0]; return c ? c.innerText.replace(/\\n+/g, ' / ') : '(pas de compteur)'; })()`);
const records = () => evaluate(`(async () => {
  const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions');
  const list = [];
  for await (const [name, h] of dir.entries()) if (name.endsWith('.json')) list.push({ name, record: JSON.parse(await (await h.getFile()).text()) });
  return list;
})()`);
/** Sons consignés depuis `fromIndex`, en millisecondes depuis le premier, arrondies au dixième de seconde. */
const timeline = (fromIndex) => {
  const list = sounds.slice(fromIndex).filter((s) => s.startsWith('[bips]'));
  const at = list.map((s) => Number(/à (\d+)/.exec(s)?.[1]));
  return list.map((s, i) => `${/\[bips\] (\w+)/.exec(s)[1]}@${Math.round((at[i] - at[0]) / 100) / 10}`).join(' ');
};

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable'); await send('Network.enable');
await send('Network.setBlockedURLs', { urls: ['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

// 1. Enregistrer, onglet Fractionné.
await go('/enregistrer');
console.log('onglet Fractionné :', await clickText('Fractionné'));
await wait(400);
console.log('activités :', await evaluate(`[...document.querySelector('select.ui-field').options].map((o) => o.textContent).join(', ')`));
console.log('compteur :', await evaluate(`(document.querySelector('.ivl .ui-card__title')?.textContent ?? '(absent)') + ' / ' + (document.querySelector('.ivl-summary')?.textContent ?? '')`));

// 2. Séance 2 × 0:05 / 0:05, gardée.
console.log('réglage :', await setSelect('Répétitions', 2), await setSelect('Travail, minutes', 0), await setSelect('Travail, secondes', 5),
  await setSelect('Repos, minutes', 0), await setSelect('Repos, secondes', 5));
await wait(200);
console.log('résumé :', await evaluate(`document.querySelector('.ivl-summary')?.textContent`));
console.log('Garder :', await clickText('Garder cette séance'));
await wait(200);
console.log('nom :', await typeInto('Nom de la séance', 'Essai court'), '| Garder :', await clickText('Garder'));
await wait(300);
await go('/enregistrer');
await clickText('Fractionné');
await wait(400);
console.log('après rechargement, séances gardées :', await evaluate(`[...document.querySelectorAll('.ivl-preset__pick')].map((b) => b.innerText.replace(/\\n/g, ' ') + (b.getAttribute('aria-pressed') === 'true' ? ' (choisie)' : '')).join(' ; ')`));
console.log('choisir « Essai court » :', await clickText('Essai court', '.ivl-preset__pick'));
await wait(200);
await shoot('fractionne-compteur');

// 3. Compteur seul : 3 s de départ, puis 15 s de séance.
const first = sounds.length;
console.log('Lancer :', await clickText('Lancer le compteur'));
await wait(1200);
console.log('à 1 s :', await card());
await shoot('fractionne-travail');
await wait(5000);
console.log('à 6 s :', await card());
await wait(14500);
console.log('à 21 s :', await card());
console.log('sons :', timeline(first));
console.log('attendu : court@0 court@1 long@2 court@5 court@6 long@7 court@10 court@11 long@12 court@14.2 long@15.2 final@16.2');
console.log('notification :', sounds.slice(first).filter((s) => s.startsWith('[compteur]')).map((s) => s.replace(/ à \d+/, '').replace('[compteur] ', '')).join(' → '));
console.log('Fermer :', await clickText('Fermer'));
await wait(300);

// 4. Pause, reprise, Passer, rechargement en pleine séance, bandeau, arrêt.
console.log('Lancer :', await clickText('Lancer le compteur'));
await wait(1500);
console.log('Pause :', await clickText('Pause'));
await wait(300);
const pausedCard = await card();
await wait(2000);
console.log('en pause :', pausedCard, '| 2 s plus tard, inchangé :', (await card()) === pausedCard);
console.log('Reprendre :', await clickText('Reprendre'), '| Passer :', await clickText('Passer'));
await wait(500);
console.log('après Passer :', await card());
await go('/course');
console.log('rechargé sur /course, bandeau :', await evaluate(`document.querySelector('.shell-banner--intervals')?.innerText.replace(/\\n/g, ' ') ?? '(aucun)'`));
await go('/enregistrer');
console.log('de retour :', await card());
console.log('Arrêter :', await clickText('Arrêter'));
await wait(300);
console.log('arrêté :', await card(), '| gardée :', await evaluate(`JSON.parse(localStorage.getItem('tracker.intervalRun'))?.commands.map((c) => c.kind).join(',')`));
console.log('Fermer :', await clickText('Fermer'), '| oubliée :', await evaluate(`localStorage.getItem('tracker.intervalRun')`));

// 5. Pendant un enregistrement : rejeu ×1 d'une trace datée de maintenant, 5 s à 5 m/s puis 5 s à 1 m/s.
const t0 = Date.now();
const lat = 43.7;
const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
let meters = 0;
const pts = [];
for (let k = 0; k <= 45; k++) {
  const v = Math.floor(k / 5) % 2 === 0 ? 5 : 1;
  if (k > 0) meters += v;
  pts.push(`<trkpt lat="${lat}" lon="${(3.85 + meters / mPerDegLon).toFixed(7)}"><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>${v}</speed></extensions></trkpt>`);
}
const replayPath = `${workDir}\\fractionne-rejeu.gpx`;
writeFileSync(replayPath, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Rejeu</name><type>run-intervals</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`);
console.log('onglet Fractionné :', await clickText('Fractionné'));
await wait(300);
await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click(); 'ok'`);
await wait(300);
await setFile('input[type=file][accept=".gpx"]', replayPath);
await wait(500);
await evaluate(`(() => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === '600')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '1'); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
console.log('Démarrer :', await clickText('Démarrer'));
await wait(2000);
console.log('Lancer :', await clickText('Lancer le compteur'));
await wait(21000);
console.log('pendant :', await card());
await shoot('fractionne-enregistrement');
console.log('Arrêter (enregistrement) :', await evaluate(`(() => { const b = [...document.querySelectorAll('button.ui-btn--danger')].find((x) => x.textContent.includes('Arrêter') && !x.closest('.ivl')); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await wait(2500);
console.log('Analyser :', await clickText('Analyser'));
await wait(6000);
console.log('page :', await evaluate('location.pathname'), '| onglets :', await evaluate(`[...document.querySelectorAll('.an-carte-col .ui-tab')].map((t) => t.textContent).join(', ')`));
console.log('panneau :', await panel('Répétitions'));
console.log('graphes :', await charts());
console.log('Voir :', await clickText('Voir'), '| tracé violet :', await evaluate(`[...document.querySelectorAll('path.leaflet-interactive')].filter((p) => p.getAttribute('stroke') === '#7b1fa2').length`));
await shoot('fractionne-analyse');
const recs = await records();
const rec = recs.find((r) => r.record.sport === 'run-intervals')?.record;
console.log('fiche :', rec ? `${rec.sport}, activité ${rec.activityId}, séances ${rec.intervals?.length ?? 0}, phases ${rec.intervals?.[0]?.laps.map((l) => `${l.kind}${l.rep} ${Math.round((l.endMs - l.startMs) / 1000)} s`).join(', ')}` : '(aucune)');
await go('/fractionne');
console.log('bibliothèque :', await evaluate(`document.querySelector('.lib-list')?.innerText.replace(/\\n+/g, ' / ').slice(0, 300) ?? '(vide)'`), '| vue planifiées :', await evaluate(`[...document.querySelectorAll('.ui-tab')].some((t) => /planifi/.test(t.textContent))`));

// 6. Séance sans compteur : 10 min d'échauffement, 8 × (1 min d'effort qui faiblit, 1 min à 1,5 m/s), 5 min de retour
// au calme. Le GPX passe par la page, dans un `File` : Chrome peut refuser de lire le dossier de travail.
const tf = Date.UTC(2026, 9, 3, 7, 0, 0);
const effortAt = (s) => {
  if (s < 600) return 2.8 + 0.1 * Math.sin(s / 13);
  const t = s - 600;
  if (t >= 8 * 120 - 60) return 2.5;
  const k = t % 120;
  return k < 60 ? Math.min(1.5 + (k + 1) * 1.2, 5.2 - 0.05 * Math.floor(t / 120) - 0.004 * k) : 1.5;
};
let fm = 0;
const fpts = [];
for (let k = 0; k <= 600 + 8 * 120 - 60 + 300; k++) {
  const v = effortAt(k);
  if (k > 0) fm += v;
  fpts.push(`<trkpt lat="${lat}" lon="${(3.85 + fm / mPerDegLon).toFixed(7)}"><ele>60</ele><time>${new Date(tf + k * 1000).toISOString()}</time><extensions><speed>${v.toFixed(3)}</speed></extensions></trkpt>`);
}
const freeGpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Sans compteur</name><type>run-intervals</type><trkseg>\n${fpts.join('\n')}\n</trkseg></trk></gpx>\n`;
await go('/fractionne');
console.log('import sans compteur :', await evaluate(`(() => {
  const input = document.querySelector('input[type=file][accept=".gpx"]');
  if (!input) return 'absent';
  const dt = new DataTransfer();
  dt.items.add(new File([${JSON.stringify(freeGpx)}], 'sans-compteur.gpx', { type: 'application/gpx+xml' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`));
await wait(4000);
const freeRecord = async () => (await records()).find((r) => r.record.summary?.startMs === tf)?.record;
const free = await freeRecord();
console.log('fiche sans compteur :', free ? `${free.gpx}, séances du compteur : ${free.intervals?.length ?? 0}` : '(absente)');
const freePath = `/fractionne/analyse?session=${encodeURIComponent(free?.gpx ?? '')}`;
await go(freePath, 6000);
console.log('panneau :', await panel('Répétitions'));
console.log('graphes :', await charts());
const effortField = () => evaluate(`document.querySelector('input[aria-label="Seuil d\\'effort"]')?.value ?? '(absent)'`);
// `typeInto` met le libellé entre apostrophes : celle de « Seuil d'effort » le casserait.
const setEffort = (value) => evaluate(`(() => {
  const i = document.querySelector('input[aria-label="Seuil d\\'effort"]');
  if (!i) return 'absent';
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(value)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return i.value;
})()`);
console.log('onglet réglages :', await clickText('réglages', '.an-carte-col .ui-tab'));
await wait(500);
console.log('seuil tiré de la session :', await effortField());
console.log('seuil 25 km/h :', await setEffort('25'));
await wait(800);
console.log('panneau :', await panel('Fractionné'), '| barre :', await evaluate(`document.querySelector('.ui-savebar, .an-savebar')?.innerText.replace(/\\n+/g, ' / ') ?? document.body.innerText.match(/Non enregistr[^\\n]*/)?.[0] ?? '(aucune)'`));
console.log('seuil 14 km/h :', await setEffort('14'));
await wait(800);
console.log('panneau :', (await panel('Répétitions')).slice(0, 160));
console.log('Enregistrer la session :', await clickText('Enregistrer la session'));
await wait(2500);
const saved = await freeRecord();
console.log("fiche : seuil d'effort", saved?.analysis?.effortThresholdMs?.toFixed(3) ?? '(absent)', 'm/s (attendu 3.889)');
await go(freePath, 6000);
console.log('après rechargement, seuil :', await effortField(), '| Revenir à la session :', await clickText('Revenir à la session'));
await wait(800);
console.log('seuil :', await effortField(), '| panneau :', (await panel('Répétitions')).slice(0, 120));
await shoot('fractionne-detection');
console.log('Annuler :', await clickText('Annuler'));

// 7. Réglages, accueil, planification.
await go('/parametres');
await clickText('Activités', '[role=button]');
await wait(400);
console.log('Réglages, familles :', await evaluate(`[...document.querySelectorAll('.settings-activities__family')].map((f) => f.textContent).join(', ')`));
console.log('Réglages, activités :', await evaluate(`[...document.querySelectorAll('.settings-activity__name')].map((f) => f.textContent).join(', ')`));
await setSelect('Famille', 'fractionne');
await wait(200);
console.log('ajout, calculs du fractionné :', await evaluate(`[...document.querySelectorAll('.settings-add select')].map((s) => [...s.options].map((o) => o.textContent).join('/')).join(' | ')`));
await go('/');
console.log('accueil :', await evaluate(`[...document.querySelectorAll('.shell-main a')].map((a) => a.innerText.split('\\n')[0]).filter((t) => /Voile|Course|Vélo|Fractionné/.test(t)).join(', ')`),
  '| barre :', await evaluate(`[...document.querySelectorAll('.shell-toplink')].map((a) => a.textContent).join(', ')`));
await go('/itineraires', 4000);
await evaluate(`document.querySelector('.plan-toolbar button.ui-field, .plan-toolbar .activity-select button')?.click(); 'ok'`);
await wait(400);
console.log('planification, familles proposées :', await evaluate(`[...document.querySelectorAll('.activity-select__family')].map((f) => f.textContent).join(', ') || '(liste non ouverte)'`),
  '| activité :', await evaluate(`document.querySelector('.plan-toolbar')?.innerText.split('\\n')[0]`));

// Téléphone : la carte du compteur et l'analyse à 390 × 844.
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go('/enregistrer');
await clickText('Fractionné');
await wait(400);
await shoot('fractionne-telephone-compteur');
console.log('largeur au téléphone :', await evaluate('document.documentElement.scrollWidth'));

console.log(logs.length ? `console :\n${[...new Set(logs)].join('\n')}` : 'console : aucune erreur');
ws.close();
