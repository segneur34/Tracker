// Banc de test : activité « Marche » de départ (demande du 19/10, lot 3 du 20/10).
// Usage : node marche.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Dure environ 30 s. Vérifie :
//  1. installation neuve : Marche dans À pied, juste après Course, icône du marcheur, couleurs de 1,5 à 8 km/h
//     et temps estimé « Personnalisé » à 5 km/h, sans « · modifié » ; Course garde 4 à 15 km/h ;
//  2. liste de la version 5 sans Marche : elle est ajoutée une fois, après les activités à pied, version 6 rangée ;
//  3. liste de la version 5 avec une « marche » créée par l'utilisateur : pas de doublon, la sienne reste ;
//  4. liste de la version 6 sans Marche (supprimée) : elle ne revient pas ;
//  5. la liste de choix d'activité d'Enregistrer la propose, à 390×844, sans débordement.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node marche.mjs <port> [<dossier des captures>]');
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
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};
let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK ' : 'ÉCHEC'} ${label}${detail ? ` : ${detail}` : ''}`);
};

const stored = () => evaluate(`JSON.parse(localStorage.getItem('tracker.sportSettings') ?? 'null')`);
const names = async () => (await stored())?.activities?.map((a) => a.name);
/** Réglages d'avant, à la version donnée, puis rechargement : l'application les met à jour au démarrage. */
const seed = async (activities, version) => {
  await evaluate(`(() => {
    localStorage.clear();
    localStorage.setItem('tracker.sportSettings', JSON.stringify({ activities: ${JSON.stringify(activities)}, activitiesVersion: ${version} }));
    return 'ok';
  })()`);
  await go('/');
};
const SAIL = { id: 'wingfoil', name: 'Voile', base: 'wingfoil', color: '#1976d2' };
const RUN = { id: 'running', name: 'Course', base: 'running', color: '#d42a3c' };
const ROUTE = { id: 'cycling', name: 'Route', base: 'cycling', color: '#1e7a3c' };
const TRAIL = { id: 'a-trail', name: 'Trail', base: 'running', color: '#f0504a' };

// 1. Installation neuve : rien n'est rangé tant qu'on ne règle rien, la liste est celle de départ.
await go('/');
await go('/');
// Réglages : la famille À pied et les cartes Course et Marche ouvertes, toutes leurs parties dépliées.
await evaluate(`(() => {
  const sections = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}');
  sections.settings = { ...sections.settings, activites: true };
  sections['settings-families'] = { course: true };
  sections['settings-activities'] = { running: true, 'a-marche': true };
  sections['settings-activity-parts'] = { affichage: true, analyse: true, enregistrement: true, itineraires: true, balises: true };
  localStorage.setItem('tracker.sections', JSON.stringify(sections));
  return 'ok';
})()`);
await go('/parametres');
const shownNames = await evaluate(`[...document.querySelectorAll('.settings-activity__name')].map((n) => n.textContent)`);
// Seule la famille À pied est ouverte : ses activités seules sont nommées.
check('installation neuve : Marche juste après Course', JSON.stringify(shownNames) === '["Course","Marche"]', JSON.stringify(shownNames));
const card = (name) => `[...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('.settings-activity__name')?.textContent === '${name}')`;
const rowOf = (name, label) => `[...(${card(name)}?.querySelectorAll('.setting-row, .settings-row, [class*=row]') ?? [])].find((r) => r.textContent.startsWith('${label}'))`;
const colors = (name) => evaluate(`[...(${rowOf(name, 'Colorisation de la trace')}?.querySelectorAll('input') ?? [])].map((i) => i.value || i.placeholder)`);
check('Marche : icône du marcheur', (await evaluate(`${card('Marche')}?.querySelector('.settings-activity__icon') !== null`)) === true);
check('Marche : couleurs de 1,5 à 8 km/h', JSON.stringify(await colors('Marche')) === '["1.5","8"]', JSON.stringify(await colors('Marche')));
check('Course : couleurs de 4 à 15 km/h', JSON.stringify(await colors('Course')) === '["4","15"]', JSON.stringify(await colors('Course')));
const pace = await evaluate(`(() => {
  const c = ${card('Marche')};
  const select = [...(c?.querySelectorAll('select') ?? [])].find((s) => [...s.options].some((o) => o.value === 'perso'));
  const speed = ${rowOf('Marche', 'Vitesse sur le plat')}?.querySelector('input')?.value;
  return { level: select?.value, speed };
})()`);
check('Marche : temps estimé « Personnalisé » à 5 km/h', pace?.level === 'perso' && pace?.speed === '5', JSON.stringify(pace));
const modified = (name) => evaluate(`${card(name)}?.querySelector('.settings-activity__head')?.textContent.includes('modifié')`);
check('Marche et Course sans « · modifié »', (await modified('Marche')) === false && (await modified('Course')) === false);
await shoot('marche-reglages');

// 2. Liste de la version 5, sans Marche.
await seed([SAIL, RUN, TRAIL, ROUTE], 5);
const v5 = await names();
check('version 5 : Marche ajoutée après les activités à pied', JSON.stringify(v5) === JSON.stringify(['Voile', 'Course', 'Trail', 'Marche', 'Route']), JSON.stringify(v5));
check('version 6 rangée', (await stored())?.activitiesVersion === 6);
await go('/');
check('rechargée : une seule Marche', (await names())?.filter((n) => n === 'Marche').length === 1);

// 3. Liste de la version 5 avec une « marche » de l'utilisateur.
const mine = { id: 'a-ma-marche', name: 'marché', base: 'running', color: '#6e1020' };
await seed([SAIL, RUN, mine, ROUTE], 5);
const own = (await stored())?.activities?.map((a) => a.id);
check('« marché » déjà créée : pas de doublon', JSON.stringify(own) === JSON.stringify(['wingfoil', 'running', 'a-ma-marche', 'cycling']), JSON.stringify(own));

// 4. Liste de la version 6 sans Marche : supprimée, elle ne revient pas.
await seed([SAIL, RUN, ROUTE], 6);
check('version 6 sans Marche : elle ne revient pas', JSON.stringify(await names()) === JSON.stringify(['Voile', 'Course', 'Route']));

// 5. Enregistrer, à 390×844 : la Marche dans la liste de choix.
await evaluate(`(() => { localStorage.clear(); return 'ok'; })()`);
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go('/enregistrer');
await go('/enregistrer');
// Pastille de la famille, puis la liste de ses activités.
await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'À pied')?.click()`);
await wait(500);
const offered = await evaluate(`[...document.querySelectorAll('select option')].map((o) => o.textContent).join(',')`);

check('Enregistrer : la Marche proposée dans À pied', offered === 'Course,Marche', offered);

check('390 : pas de débordement', (await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`)) === true);
await shoot('marche-enregistrer-390');

console.log(logs.length ? `--- console ---\n${logs.join('\n')}` : 'console : rien');
console.log(failures ? `${failures} échec(s)` : 'tout est passé');
await send('Target.closeTarget', { targetId: target.id }).catch(() => {});
ws.close();
