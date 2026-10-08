// Banc de test : un fichier de réglages par appareil (§10, point 90).
// Usage : node reglages.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau, dans la mémoire du navigateur (« PC »). Le script vérifie :
//  1. au premier lancement, l'appareil écrit reglages/pc.json ;
//  2. passage depuis l'ancien reglages.json : plus récent que l'appareil, il est repris une dernière fois,
//     puis retiré ; pc.json est récrit ;
//  3. le fichier d'un autre appareil (« Léa », liste d'activités de la version 3, anciennes couleurs) déposé
//     dans reglages/ : absent de la liste avant « Mettre à jour », présent après, et pas repris de lui-même ;
//     le bandeau « Nouveau fichier de réglages : Léa » paraît ;
//  4. « Reprendre » du bandeau : confirmation acceptée, rechargement, activités de Léa recolorées dans les
//     nuances de leur famille, seuil repris, choix retenus de l'appareil gardés, pc.json récrit ; plus de bandeau ;
//  5. renommage de l'appareil : le fichier suit son nom ; un nom déjà porté par un autre fichier est refusé ;
//  6. un fichier d'un autre appareil posé sous le nom de celui-ci : l'appareil prend un nom libre et le dit ;
//     le bandeau le propose au lancement, « Fermer » le retire, et il ne revient pas au rechargement ;
//  7. activités de la version 3 rangées sur l'appareil et dans son fichier : au lancement, le fichier passe aux
//     nuances de la version 4 sans changer de date ;
//  8. « Importer un fichier de réglages » : un JSON quelconque et le fichier de l'appareil refusés ; celui d'une
//     tablette rangé sous son nom, reprise refusée puis faite depuis la liste ; pas de bandeau ensuite.
import { writeFileSync } from 'node:fs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node reglages.mjs <port> [<dossier des captures>]');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://127.0.0.1:4190';

// --- Protocole ---
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
const dialogs = [];
/** Réponse aux confirmations de la page : acceptées, sauf le temps d'y renoncer. */
let acceptDialogs = true;
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Page.javascriptDialogOpening') {
    dialogs.push(msg.params.message.split('\n')[0]);
    void send('Page.handleJavaScriptDialog', { accept: acceptDialogs });
  }
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]}`);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ').split('\n')[0].slice(0, 300)}`);
  }
};
await new Promise((r) => { ws.onopen = r; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const go = async (path, ms = 3000) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
const shoot = async (name) => {
  if (!shotDir) return;
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
};
const opfs = (body) => evaluate(`(async () => { const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker'); ${body} })()`);
const listSettings = () => opfs(`try { const d = await root.getDirectoryHandle('reglages'); const names = []; for await (const [n] of d.entries()) names.push(n); return names.sort().join(', '); } catch { return '(pas de dossier)'; }`);
const readSettings = (name) => opfs(`const d = await root.getDirectoryHandle('reglages'); return JSON.parse(await (await (await d.getFileHandle(${JSON.stringify(name)})).getFile()).text());`);
const writeFile = (path, value) => opfs(`let d = root; const parts = ${JSON.stringify(path)}.split('/'); const name = parts.pop(); for (const p of parts) d = await d.getDirectoryHandle(p, { create: true }); const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(${JSON.stringify(JSON.stringify(value, null, 2))}); await w.close(); return 'ok';`);
const removeFile = (path) => opfs(`let d = root; const parts = ${JSON.stringify(path)}.split('/'); const name = parts.pop(); for (const p of parts) d = await d.getDirectoryHandle(p); await d.removeEntry(name); return 'ok';`);
const hasRoot = (name) => opfs(`try { await root.getFileHandle(${JSON.stringify(name)}); return true; } catch { return false; }`);
const stored = () => evaluate(`JSON.parse(localStorage.getItem('tracker.sportSettings') ?? 'null')`);
/** Ouvre la carte Mémoire de Réglages, si elle est repliée. */
const openMemory = () => evaluate(`(() => { if (document.querySelector('input[maxlength="40"].ui-field')) return 'déjà ouverte'; const b = [...document.querySelectorAll('[role=button]')].find((x) => x.textContent.trim() === 'Mémoire'); if (!b) return 'absente'; b.click(); return 'ouverte'; })()`);
const fileList = () => evaluate(`(() => { const ul = [...document.querySelectorAll('ul')].find((u) => /cet appareil/.test(u.innerText)); return ul ? [...ul.children].map((li) => li.innerText.replace(/\\n/g, ' / ')).join(' || ') : '(pas de liste)'; })()`);
const clickButton = (text, near) => evaluate(`(() => { const li = ${near ? `[...document.querySelectorAll('li')].find((x) => x.innerText.startsWith(${JSON.stringify(near)}))` : 'document'}; if (!li) return 'ligne absente'; const b = [...li.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return 'bouton absent'; b.click(); return 'ok'; })()`);
const rename = async (name) => {
  await evaluate(`(() => { const i = document.querySelector('input[maxlength="40"].ui-field'); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(name)}); i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); return 'ok'; })()`);
  await wait(1200);
};
/** Texte du bandeau « Nouveau fichier de réglages », ou « (aucun) ». */
const banner = () => evaluate(`(() => { const a = [...document.querySelectorAll('.ui-alert')].find((x) => /Nouveau fichier de réglages/.test(x.innerText)); return a ? a.innerText.replace(/\\n/g, ' / ') : '(aucun)'; })()`);
const clickInBanner = (text) => evaluate(`(() => { const a = [...document.querySelectorAll('.ui-alert')].find((x) => /Nouveau fichier de réglages/.test(x.innerText)); if (!a) return 'bandeau absent'; const b = [...a.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return 'bouton absent'; b.click(); return 'ok'; })()`);
const pageLines = (re) =>evaluate(`document.body.innerText.split('\\n').filter((l) => ${re}.test(l)).join(' | ')`);
const step = (title) => console.log(`\n== ${title}`);

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

step('1. Premier lancement');
await go('/parametres', 4000);
console.log('reglages/ :', await listSettings());
const first = await readSettings('pc.json');
console.log('pc.json : version', first.version, '| appareil', JSON.stringify(first.device), '| activités', first.values['tracker.sportSettings']?.activities?.length ?? '(défaut)');

step('2. Passage depuis l\'ancien reglages.json');
const before = await stored();
const legacy = {
  format: 'tracker-reglages', version: 1, savedAt: Date.now() + 60_000,
  values: { 'tracker.sportSettings': { ...(before ?? {}), thresholds: { wingfoil: 7 } } },
};
console.log('pc.json retiré :', await removeFile('reglages/pc.json'), '| reglages.json écrit :', await writeFile('reglages.json', legacy));
await go('/parametres', 4000);
console.log('reglages.json encore là :', await hasRoot('reglages.json'), '| reglages/ :', await listSettings());
console.log('seuil wingfoil de l\'appareil :', (await stored())?.thresholds?.wingfoil, '(7 attendu)');
console.log('seuil dans pc.json :', (await readSettings('pc.json')).values['tracker.sportSettings']?.thresholds?.wingfoil);

step('3. Le fichier de Léa, déposé dans reglages/');
const leaActivities = [
  { id: 'wingfoil', name: 'Wing', base: 'wingfoil', color: '#1565c0' },
  { id: 'a-moth', name: 'Moth', base: 'wingfoil', color: '#2e7d32' },
  { id: 'running', name: 'Course', base: 'running', color: '#bf360c' },
  { id: 'a-trail', name: 'Trail', base: 'running', color: '#6a1b9a' },
  { id: 'cycling', name: 'Route', base: 'cycling', color: '#00695c' },
];
const lea = {
  format: 'tracker-reglages', version: 2, savedAt: Date.now() - 3_600_000, device: { id: 'appareil-de-lea', name: 'Léa' },
  values: {
    'tracker.sportSettings': { activities: leaActivities, activitiesVersion: 3, thresholds: { wingfoil: 13 }, recordActivity: 'a-trail' },
    'tracker.runnerProfile': { me: { weightKg: 58 } },
  },
};
// L'appareil retient une activité à l'enregistrement : elle doit survivre à la reprise.
await evaluate(`(() => { const s = JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}'); s.recordActivity = 'running'; localStorage.setItem('tracker.sportSettings', JSON.stringify(s)); return 'ok'; })()`);
console.log('écrit :', await writeFile('reglages/lea.json', lea));
console.log('carte Mémoire :', await openMemory());
await wait(500);
console.log('liste avant « Mettre à jour » :', await fileList());
console.log('Mettre à jour :', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Mettre à jour'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await wait(2500);
console.log('liste après :', await fileList());
console.log('seuil de l\'appareil, inchangé :', (await stored())?.thresholds?.wingfoil);
console.log('bandeau :', await banner());
await shoot('reglages-liste');

step('4. Reprendre les réglages de Léa, depuis le bandeau');
console.log('Reprendre :', await clickInBanner('Reprendre'));
await wait(4500);
console.log('confirmation :', dialogs.at(-1) ?? '(aucune)');
const after = await stored();
console.log('activités :', after?.activities?.map((a) => `${a.name} ${a.color}`).join(', '), '| version', after?.activitiesVersion);
console.log('seuil wingfoil :', after?.thresholds?.wingfoil, '(13 attendu) | activité retenue à l\'enregistrement :', after?.recordActivity, '(running attendu)');
console.log('poids du pratiquant :', await evaluate(`JSON.parse(localStorage.getItem('tracker.runnerProfile') ?? 'null')?.me?.weightKg`));
const pc = await readSettings('pc.json');
console.log('pc.json : seuil', pc.values['tracker.sportSettings']?.thresholds?.wingfoil, '| appareil', pc.device?.name);
console.log('carte Mémoire :', await openMemory());
await wait(500);
console.log('liste :', await fileList());
console.log('bandeau après la reprise (aucun attendu) :', await banner());

step('5. Renommer l\'appareil');
await rename('PC du bureau');
console.log('reglages/ :', await listSettings(), '| nom gardé :', await evaluate(`localStorage.getItem('tracker.deviceName')`));
await rename('Léa');
console.log('refus :', await pageLines('/choisissez un autre nom/'), '| reglages/ :', await listSettings());
await evaluate(`(() => { const i = document.querySelector('input[maxlength="40"].ui-field'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 'ok'; })()`);
await shoot('reglages-renomme');

step('6. Un autre appareil sous le nom de celui-ci');
const intrus = { ...lea, device: { id: 'intrus', name: 'PC du bureau' }, savedAt: Date.now() };
console.log('écrit par-dessus :', await writeFile('reglages/pc-du-bureau.json', intrus));
await go('/parametres', 4000);
console.log('message :', await pageLines('/s\'appelle désormais/'));
console.log('reglages/ :', await listSettings(), '| nom :', await evaluate(`localStorage.getItem('tracker.deviceName')`));
console.log('pc-du-bureau.json reste à l\'intrus :', (await readSettings('pc-du-bureau.json')).device?.id);
console.log('bandeau au lancement :', await banner());
console.log('Fermer :', await clickInBanner('Fermer'));
await wait(300);
console.log('bandeau après « Fermer » (aucun attendu) :', await banner());
await go('/parametres', 4000);
console.log('bandeau après rechargement (aucun attendu) :', await banner());

step('7. Activités de la version 3, au lancement');
const ownName = (await listSettings()).split(', ').find((n) => n.startsWith('pc-du-bureau-'));
const oldList = [
  { id: 'wingfoil', name: 'Voile', base: 'wingfoil', color: '#1565c0' },
  { id: 'running', name: 'Course', base: 'running', color: '#bf360c' },
  { id: 'a-trail', name: 'Trail', base: 'running', color: '#6a1b9a' },
];
const savedAtBefore = await evaluate(`Number(localStorage.getItem('tracker.settingsSavedAt'))`);
await evaluate(`(() => { const s = JSON.parse(localStorage.getItem('tracker.sportSettings') ?? '{}'); s.activities = ${JSON.stringify(oldList)}; s.activitiesVersion = 3; localStorage.setItem('tracker.sportSettings', JSON.stringify(s)); return 'ok'; })()`);
const ownBefore = await readSettings(ownName);
ownBefore.values['tracker.sportSettings'] = await stored();
console.log(`${ownName} en version 3 :`, await writeFile(`reglages/${ownName}`, ownBefore));
await go('/parametres', 5000);
const upgraded = await readSettings(ownName);
const upgradedSport = upgraded.values['tracker.sportSettings'];
console.log('appareil :', (await stored())?.activities?.map((a) => `${a.name} ${a.color}`).join(', '), '| version', (await stored())?.activitiesVersion);
console.log('fichier  :', upgradedSport?.activities?.map((a) => `${a.name} ${a.color}`).join(', '), '| version', upgradedSport?.activitiesVersion);
console.log('date du fichier inchangée :', upgraded.savedAt === savedAtBefore, '| date de l\'appareil inchangée :', (await evaluate(`Number(localStorage.getItem('tracker.settingsSavedAt'))`)) === savedAtBefore);

step('8. Importer un fichier de réglages');
/** Choisit un fichier JSON dans « Importer un fichier de réglages », fabriqué dans la page. */
const importJson = async (name, value) => {
  const res = await evaluate(`(() => { const input = document.querySelector('input[type=file][accept*="json"]'); if (!input) return 'champ absent'; const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(JSON.stringify(value))}], ${JSON.stringify(name)}, { type: 'application/json' })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()`);
  await wait(1500);
  return res;
};
const importNote = () => pageLines('/n\'est pas un fichier|fichier de réglages de cet appareil|est dans la liste/');
console.log('carte Mémoire :', await openMemory());
await wait(500);
console.log('un JSON quelconque :', await importJson('notes.json', { bonjour: 1 }), '|', await importNote());
console.log('le fichier de cet appareil :', await importJson(ownName, await readSettings(ownName)), '|', await importNote());
const tablet = {
  format: 'tracker-reglages', version: 2, savedAt: Date.now() - 600_000, device: { id: 'tablette-de-lea', name: 'Tablette' },
  values: { 'tracker.sportSettings': { ...(await stored()), thresholds: { wingfoil: 15 } } },
};
acceptDialogs = false;
console.log('la Tablette, reprise refusée :', await importJson('reglages-tablette.json', tablet), '|', await importNote());
acceptDialogs = true;
console.log('confirmation posée :', dialogs.at(-1));
console.log('reglages/ :', await listSettings(), '| seuil de l\'appareil, inchangé :', (await stored())?.thresholds?.wingfoil);
console.log('liste :', await fileList(), '| bandeau (aucun attendu) :', await banner());
console.log('Reprendre dans la liste :', await clickButton('Reprendre', 'Tablette'));
await wait(4500);
console.log('seuil wingfoil :', (await stored())?.thresholds?.wingfoil, '(15 attendu)');
console.log('carte Mémoire :', await openMemory());
await wait(500);
console.log('bandeau après rechargement (aucun attendu) :', await banner());
await shoot('reglages-import');

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go('/parametres', 3000);
await openMemory();
await wait(500);
await evaluate(`[...document.querySelectorAll('ul')].find((u) => /cet appareil/.test(u.innerText))?.scrollIntoView({ block: 'center' }); 'ok'`);
await wait(300);
console.log('débordement à 390 px :', await evaluate('document.documentElement.scrollWidth > window.innerWidth'));
await shoot('reglages-390');

console.log('\n--- console (erreurs, avertissements) ---');
[...new Set(logs)].slice(0, 15).forEach((l) => console.log(l));
await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
ws.close();
