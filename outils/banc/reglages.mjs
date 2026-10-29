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
import { connect } from './lib/cdp.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node reglages.mjs <port> [<dossier des captures>]');
  process.exit(1);
}
// Version des pré-réglages (PRESETS_VERSION) : un fichier d'avant sans elle voit ses seuils effacés une fois (point 168).
const PRESETS_VERSION = 3;

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, settle, waitFor, wait, shoot, onMessage, logs, close } = await connect({ port, width: 1400, height: 1000, shotDir });
const dialogs = [];
onMessage((msg) => { if (msg.method === 'Page.javascriptDialogOpening') dialogs.push(msg.params.message.split(String.fromCharCode(10))[0]); });
/**
 * Réponse aux confirmations de la page : acceptées d'office par la bibliothèque ; pour en refuser une, `confirm` de
 * la page répond non (et note son message comme un dialogue), le temps d'y renoncer.
 */
const refuseDialogs = (refuse) => evaluate(refuse
  ? `(() => { window.__confirmReel ??= window.confirm; window.confirm = (m) => { window.__refus = String(m); return false; }; return 'ok'; })()`
  : `(() => { if (window.__confirmReel) window.confirm = window.__confirmReel; return 'ok'; })()`);
const noteRefus = async () => { const m = await evaluate(`window.__refus ?? null`); if (m) dialogs.push(m.split(String.fromCharCode(10))[0]); };
/** Lance `action` qui recharge la page, attend le nouveau document puis une page prête (`max` ms au plus). */
const reloaded = async (action, max) => {
  const before = await evaluate(`window.__banc?.doc ?? null`);
  const res = await action();
  await waitFor(`window.__banc?.doc !== ${JSON.stringify(before)}`, { timeout: max, label: 'rechargement' });
  await settle({ max });
  return res;
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
const rename = async (name, until) => {
  await evaluate(`(() => { const i = document.querySelector('input[maxlength="40"].ui-field'); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(name)}); i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); return 'ok'; })()`);
  if (until) await waitFor(until, { timeout: 1200, label: 'renommage' });
  await settle({ max: 1200, label: 'renommage' });
};
/** Texte du bandeau « Nouveau fichier de réglages », ou « (aucun) ». */
const banner = () => evaluate(`(() => { const a = [...document.querySelectorAll('.ui-alert')].find((x) => /Nouveau fichier de réglages/.test(x.innerText)); return a ? a.innerText.replace(/\\n/g, ' / ') : '(aucun)'; })()`);
const clickInBanner = (text) => evaluate(`(() => { const a = [...document.querySelectorAll('.ui-alert')].find((x) => /Nouveau fichier de réglages/.test(x.innerText)); if (!a) return 'bandeau absent'; const b = [...a.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return 'bouton absent'; b.click(); return 'ok'; })()`);
const pageLines = (re) =>evaluate(`document.body.innerText.split('\\n').filter((l) => ${re}.test(l)).join(' | ')`);
const step = (title) => console.log(`\n== ${title}`);

// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });

step('1. Premier lancement');
await go('/parametres', 4000);
console.log('reglages/ :', await listSettings());
const first = await readSettings('pc.json');
console.log('pc.json : version', first.version, '| appareil', JSON.stringify(first.device), '| activités', first.values['tracker.sportSettings']?.activities?.length ?? '(défaut)');

step('2. Passage depuis l\'ancien reglages.json');
const before = await stored();
const legacy = {
  format: 'tracker-reglages', version: 1, savedAt: Date.now() + 60_000,
  values: { 'tracker.sportSettings': { ...(before ?? {}), thresholds: { wingfoil: 7 }, presetsVersion: PRESETS_VERSION } },
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
    'tracker.sportSettings': { activities: leaActivities, activitiesVersion: 3, thresholds: { wingfoil: 13 }, presetsVersion: PRESETS_VERSION, recordActivity: 'a-trail' },
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
await waitFor(async () => /Léa/.test(await fileList()), { timeout: 2500, label: 'liste après la mise à jour' });
await settle({ max: 2500 });
console.log('liste après :', await fileList());
console.log('seuil de l\'appareil, inchangé :', (await stored())?.thresholds?.wingfoil);
console.log('bandeau :', await banner());
await shoot('reglages-liste');

step('4. Reprendre les réglages de Léa, depuis le bandeau');
console.log('Reprendre :', await reloaded(() => clickInBanner('Reprendre'), 4500));
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
await rename('PC du bureau', async () => /pc-du-bureau/.test(await listSettings()));
console.log('reglages/ :', await listSettings(), '| nom gardé :', await evaluate(`localStorage.getItem('tracker.deviceName')`));
await rename('Léa', async () => Boolean(await pageLines('/choisissez un autre nom/')));
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
  const noteBefore = await importNote();
  const res = await evaluate(`(() => { const input = document.querySelector('input[type=file][accept*="json"]'); if (!input) return 'champ absent'; const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(JSON.stringify(value))}], ${JSON.stringify(name)}, { type: 'application/json' })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()`);
  await waitFor(async () => (await importNote()) !== noteBefore, { timeout: 1500, label: 'message de l’import' });
  await settle({ max: 1500 });
  return res;
};
function importNote() { return pageLines('/n\'est pas un fichier|fichier de réglages de cet appareil|est dans la liste/'); }
console.log('carte Mémoire :', await openMemory());
await wait(500);
console.log('un JSON quelconque :', await importJson('notes.json', { bonjour: 1 }), '|', await importNote());
console.log('le fichier de cet appareil :', await importJson(ownName, await readSettings(ownName)), '|', await importNote());
const tablet = {
  format: 'tracker-reglages', version: 2, savedAt: Date.now() - 600_000, device: { id: 'tablette-de-lea', name: 'Tablette' },
  values: { 'tracker.sportSettings': { ...(await stored()), thresholds: { wingfoil: 15 } } },
};
await refuseDialogs(true);
console.log('la Tablette, reprise refusée :', await importJson('reglages-tablette.json', tablet), '|', await importNote());
await noteRefus();
await refuseDialogs(false);
console.log('confirmation posée :', dialogs.at(-1));
console.log('reglages/ :', await listSettings(), '| seuil de l\'appareil, inchangé :', (await stored())?.thresholds?.wingfoil);
console.log('liste :', await fileList(), '| bandeau (aucun attendu) :', await banner());
console.log('Reprendre dans la liste :', await reloaded(() => clickButton('Reprendre', 'Tablette'), 4500));
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
await close();
process.exit(0);
