// Banc de test : notification de l'enregistrement (§10, point 101).
// Usage : node notification.mjs <port> <dossier de travail, chemin Windows>
// Sur un profil neuf, sans réseau. Dure environ 1 min 30. La version navigateur de `platform/notification.ts`
// consigne chaque envoi en `console.debug` (« [notification] titre | texte [chronomètre] (seule) »). Le script vérifie :
//  1. Réglages : la notification, dans la partie Enregistrement de la carte Voile, deux menus, « défaut » ; la seconde ligne passée à
//     « Max (2 s) », rangée dans les réglages ;
//  2. un rejeu ×10 de voile : titre « Voile », chiffres choisis, chronomètre de durée, et au moins 5 s entre deux
//     envois sans changement d'état ;
//  3. pause manuelle : envoi immédiat, « en pause », durée figée, posé seul ; reprise : envoi immédiat sans « en pause » ;
//  4. arrêt : notification effacée ;
//  5. compteur du fractionné pendant un enregistrement (rejeu ×1 daté de maintenant) : phase au titre et décompte ; « Étape » d'office (26/10).
import { writeFileSync } from 'node:fs';
import { connect } from './lib/cdp.mjs';

const [port, workDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node notification.mjs <port> <dossier de travail>');
  process.exit(1);
}

// --- Protocole ---
// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, wait, blockNetwork, importFiles, close, logs, onMessage } = await connect({ port, width: 1400, height: 1000 });
/** Envois de la notification, avec l'instant de réception. */
const sent = [];
onMessage((msg) => {
  if (msg.method !== 'Runtime.consoleAPICalled') return;
  const text = msg.params.args.map((a) => a.value ?? a.description).join(' ');
  if (msg.params.type === 'debug' && text.startsWith('[notification]')) sent.push({ atMs: Date.now(), text: text.slice('[notification] '.length) });
});
let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'ÉCHEC'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const holdStop = async () => {
  const down = await evaluate(`(() => { const b = [...document.querySelectorAll('button.ui-btn--danger')].find((x) => x.textContent.includes('Arrêter') && !x.disabled && !x.closest('.ivl')); if (!b) return 'absent'; window.__stopButton = b; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); return 'ok'; })()`);
  if (down !== 'ok') return down;
  await wait(2300);
  return evaluate(`(() => { const b = window.__stopButton; b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })); b.click(); return 'ok'; })()`);
};
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
const setFile = (selector, file) => importFiles(file, selector);
/** Rejeu d'un GPX à la vitesse donnée, depuis la page Enregistrer, la famille choisie. */
const startReplay = async (family, file, speed) => {
  await go('/enregistrer');
  await clickText(family, '[aria-label=Famille] button');
  await wait(300);
  await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click(); 'ok'`);
  await wait(300);
  await setFile('input[type=file][accept=".gpx"]', file);
  await wait(500);
  await evaluate(`(() => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === '600')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(String(speed))}); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
  return clickText('Démarrer');
};
/** Trace à 1 Hz datée de maintenant : `n` points vers l'est, entre 1,5 et 4,5 m/s, pour que les chiffres changent. */
const nowTrace = (path, n, type) => {
  const t0 = Date.now();
  const lat = 43.7;
  const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  const pts = [];
  let meters = 0;
  for (let k = 0; k < n; k++) {
    const v = 3 + 1.5 * Math.sin(k / 7);
    if (k > 0) meters += v;
    pts.push(`<trkpt lat="${lat}" lon="${(3.85 + meters / mPerDegLon).toFixed(7)}"><time>${new Date(t0 + k * 1000).toISOString()}</time><extensions><speed>${v.toFixed(2)}</speed></extensions></trkpt>`);
  }
  writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Rejeu</name><type>${type}</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`);
};

// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
await blockNetwork(['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*']);

// 1. Réglages : notification, dans la partie Enregistrement de la carte Voile.
await go('/parametres', 4000);
await evaluate(`(() => { const b = [...document.querySelectorAll('[role=button]')].find((el) => el.textContent.trim() === 'Activités'); if (b && !document.querySelector('.settings-activities')) b.click(); return 'ok'; })()`);
await wait(300);
// Familles repliées depuis le lot 2 des demandes du 15/10 : toutes ouvertes.
await evaluate(`document.querySelectorAll('.settings-activities__family-toggle[aria-expanded="false"]').forEach((b) => b.click()); 'ok'`);
await wait(300);
await evaluate(`(() => { const b = [...document.querySelectorAll('.settings-activity__toggle')].find((x) => x.textContent.trim().startsWith('Voile')); if (b && b.getAttribute('aria-expanded') !== 'true') b.click(); return 'ok'; })()`);
// La carte ouverte monte ses parties : 300 ms ne suffisent pas toujours.
await wait(800);
// Depuis le 19/10, la notification est une sous-partie d'Enregistrement.
console.log('partie Enregistrement :', await clickText('Enregistrement', '.settings-part__toggle'));
await wait(300);
const notifRow = () => evaluate(`(() => {
  const part = [...document.querySelectorAll('.settings-part__sub')].find((p) => p.querySelector('.settings-part__subtitle')?.textContent.trim() === 'Notification');
  if (!part) return null;
  const selects = [...part.querySelectorAll('select')];
  return { menus: selects.length, values: selects.map((s) => s.options[s.selectedIndex]?.textContent ?? ''), text: part.innerText.replace(/\\n+/g, ' / ') };
})()`);
const before = await notifRow();
// Deux chiffres au plus depuis le 15/10 (Android coupe la ligne au-delà) : vitesse et distance par défaut.
check('deux menus, défaut vitesse, distance', before?.menus === 2 && before.values.join(',') === 'Vitesse,Distance' && before.text.includes('défaut'),
  JSON.stringify(before?.values));
// Depuis le 27/10, « Par défaut » est une entrée du menu « … » de la carte : grisée, non absente, quand rien n'est modifié.
const parDefaut = (card) => `(${card})?.querySelector('.settings-activity__head > .ui-more .ui-more__panel')?.querySelectorAll('button')`;
const parDefautState = (card) => evaluate(`(() => { const b = [...(${parDefaut(card)} ?? [])].find((x) => x.textContent.trim() === 'Par défaut'); return b ? (b.disabled ? 'grisé' : 'actif') : 'absent'; })()`);
const voileCardSel = `[...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('.settings-activity__toggle')?.textContent.trim().startsWith('Voile'))`;
check('rien de changé : « Par défaut » grisé dans la carte Voile', (await parDefautState(voileCardSel)) === 'grisé');
await evaluate(`(() => {
  const part = [...document.querySelectorAll('.settings-part__sub')].find((p) => p.querySelector('.settings-part__subtitle')?.textContent.trim() === 'Notification');
  const s = part.querySelectorAll('select')[1];
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'max');
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return s.value;
})()`);
await wait(300);
const after = await notifRow();
const stored = await evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('tracker.sportSettings'))?.notificationFields)`);
check('seconde ligne « Max », rangée, plus « défaut »', after?.values[1]?.startsWith('Max') && !after.text.includes('défaut') && /"max"/.test(stored ?? ''), stored);
// Seuls les chiffres de la notification changés : la carte a son « Défaut », et repliée, « · modifié » (demande du 19/10).
const voileCard = `[...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('.settings-activity__toggle')?.textContent.trim().startsWith('Voile'))`;
check('« Par défaut » de la carte Voile actif', (await parDefautState(voileCard)) === 'actif');
await evaluate(`${voileCard}.querySelector('.settings-activity__toggle').click(); 'ok'`);
await wait(300);
const voileSummary = await evaluate(`${voileCard}?.querySelector('.settings-activity__summary')?.textContent ?? ''`);
check('carte repliée : « · modifié »', voileSummary.includes('· modifié'), voileSummary);

// 2. Rejeu ×10 de voile.
const sailPath = `${workDir}\\notification-voile.gpx`;
nowTrace(sailPath, 600, 'wingfoil');
const s0 = sent.length;
console.log('Démarrer :', await startReplay('Voile', sailPath, 10));
await wait(16000);
// Le chargement de la page efface une notification restée d'un arrêt brutal : hors du compte.
const run = sent.slice(s0).filter((s) => s.text !== 'effacée');
console.log('envois :', run.map((s) => s.text).slice(0, 4).join('\n        '));
check('titre et chiffres choisis', run.length > 0 && run.every((s) => s.text.startsWith('Voile | Vit. ') && s.text.includes(' · Max ')),
  run[run.length - 1]?.text);
check('chronomètre de durée', run.length > 0 && run.every((s) => s.text.includes('[durée ')));
// Les premiers envois partent tout de suite : départ, récriture à la première position (le service GPS vient de
// poser la sienne), premiers chiffres du direct. Ensuite, le rythme.
const steady = run.filter((s) => / Vit\. \d/.test(s.text));
const gaps = steady.slice(1).map((s, i) => s.atMs - steady[i].atMs);
check('5 s au moins entre deux envois', gaps.length >= 1 && gaps.every((g) => g >= 4900), `${run.length} envois, écarts ${gaps.join(', ')} ms`);

// 3. Pause manuelle, puis reprise.
let mark = sent.length;
console.log('Pause :', await clickText('Pause'));
await wait(800);
const paused = sent.slice(mark);
check('pause : envoi immédiat, « en pause », durée figée, posé seul', paused.length === 1 && /^Voile · en pause 0:\d\d:\d\d \| /.test(paused[0].text)
  && paused[0].text.endsWith('(seule)') && !paused[0].text.includes('[durée'), paused[0]?.text);
await wait(3000);
check('rien pendant la pause', sent.length === mark + 1);
mark = sent.length;
console.log('Reprendre :', await clickText('Reprendre'));
await wait(1500);
const resumed = sent.slice(mark);
check('reprise : envoi immédiat, sans « en pause »', resumed.length >= 1 && resumed[0].text.startsWith('Voile | Vit. ') && !resumed[0].text.includes('(seule)'),
  resumed.map((s) => s.text).join(' // '));

// 4. Arrêt.
mark = sent.length;
console.log('Arrêter :', await holdStop());
await wait(1500);
check('arrêt : notification effacée', sent.slice(mark).some((s) => s.text === 'effacée'), sent.slice(mark).map((s) => s.text).join(' // '));
console.log('Jeter :', await evaluate(`(() => { window.confirm = () => true; return 'ok'; })()`), await clickText('Jeter'));
await wait(800);

// 5. Compteur pendant un enregistrement de fractionné.
const runPath = `${workDir}\\notification-fractionne.gpx`;
nowTrace(runPath, 60, 'run-intervals');
console.log('Démarrer (fractionné, ×1) :', await startReplay('Entraînement', runPath, 1));
await wait(2500);
console.log('séance :', await setSelect('Répétitions', 2), await setSelect('Travail, minutes', 0), await setSelect('Travail, secondes', 10),
  await setSelect('Repos, minutes', 0), await setSelect('Repos, secondes', 5));
mark = sent.length;
console.log('Lancer :', await clickText('Lancer le compteur'));
await wait(6000);
const counter = sent.slice(mark).map((s) => s.text);
console.log('envois :', counter.join('\n        '));
check('phase au titre, au changement de phase', counter.some((t) => t.includes('· Départ |')) && counter.some((t) => t.includes('· Travail 1/2 |')));
check('décompte de la phase', counter.some((t) => t.includes('· Travail 1/2 |') && t.includes('[rebours ')));
// Entraînement (26/10) : l'étape d'office, avec la vitesse ; 0/2 au départ, 1/2 au premier travail.
check('étape d\'office : 0/2 au départ, 1/2 au premier travail', counter.some((t) => t.includes('· Départ |') && t.includes('Étape 0/2'))
  && counter.some((t) => t.includes('· Travail 1/2 |') && t.includes('Étape 1/2')), counter.filter((t) => /Travail|Départ/.test(t)).join(' // ').slice(0, 300));
console.log('Arrêter :', await holdStop());
await wait(1500);
await evaluate(`(() => { window.confirm = () => true; return 'ok'; })()`);
await clickText('Jeter');
await wait(500);
// « Arrêter » du compteur se tient 1 s (25/10).
await evaluate(`(async () => { const b = document.querySelector('.ivl button.ui-btn--danger'); if (!b) return 'absent'; const ev = (t) => b.dispatchEvent(new PointerEvent(t, { bubbles: true, button: 0, pointerType: 'mouse' })); ev('pointerdown'); await new Promise((r) => setTimeout(r, 1200)); ev('pointerup'); b.click(); return 'ok'; })()`);

console.log(logs.length ? `console :\n  ${logs.join('\n  ')}` : 'console : rien');
console.log(failures ? `${failures} échec(s)` : 'tout est bon');
await close();
process.exit(failures ? 1 : 0);
