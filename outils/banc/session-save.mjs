// Banc du bouton « Enregistrer la session » (24/09/2026, refait le 29/10 sur la page d'aujourd'hui, n° 84) :
// brouillon du vent, du seuil et des notes, avertissement en quittant, écriture dans la fiche, relecture après
// rechargement, Annuler. Profil Chrome neuf : OPFS vide au départ.
// Usage : node session-save.mjs <port> <GPX de voile, chemin Windows>
// Ce que la page d'aujourd'hui change par rapport à la première version : l'analyse s'ouvre par son adresse (la
// ligne de la bibliothèque n'y mène plus), le vent se saisit par « Régler » (boussole sur la carte), le seuil
// d'activité est dans l'onglet « réglages », les notes dans « matos et conditions », et la barre est
// `.ui-savebar` (« Non enregistré : … », « Annuler », « Enregistrer la session »).
// Chaque étape dit « ok » ou « ÉCHEC » ; le script rend 1 au premier échec compté.
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from './lib/cdp.mjs';

const [port, rawGpxPath] = process.argv.slice(2);
if (!port || !rawGpxPath) {
  console.error('Usage : node session-save.mjs <port> <GPX de voile, chemin Windows>');
  process.exit(1);
}
// La trace de `make-gpx.mjs` n'a pas de type : sans lui la session est « à classer » et son brouillon ne s'enregistre
// pas. On en pose un (wingfoil), dans une copie.
const gpxPath = join(tmpdir(), 'banc-session-save.gpx');
writeFileSync(gpxPath, readFileSync(rawGpxPath, 'utf8').replace('<name>Synthétique</name>', '<name>Synthétique</name><type>wingfoil</type>'));

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, settle, waitFor, blockNetwork, importFiles, records, clickText, check, finish, logs, onMessage } = await connect({ port, width: 1400, height: 1000 });
await blockNetwork();
// Rangée « avancé » des analyses ouverte d'office, avec « général » : tous les onglets restent dans la barre.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });

// Les confirmations de la page sont acceptées d'office par la bibliothèque ; pour en refuser une, `confirm` répond
// non (et note son message), le temps d'y renoncer.
const dialogs = [];
onMessage((msg) => { if (msg.method === 'Page.javascriptDialogOpening') dialogs.push(msg.params.message); });
const refuseDialogs = (refuse) => evaluate(refuse
  ? `(() => { window.__confirmReel ??= window.confirm; window.confirm = (m) => { (window.__refus ??= []).push(String(m)); return false; }; return 'ok'; })()`
  : `(() => { if (window.__confirmReel) window.confirm = window.__confirmReel; return 'ok'; })()`);
const refusals = () => evaluate(`window.__refus ?? []`);

const step = (title) => console.log(`\n== ${title}`);
const typeInto = (selector, value) => evaluate(`(() => {
  const el = ${selector};
  if (!el) return 'absent';
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
const WIND_INPUT = `document.querySelector('input[aria-label="Vent en degrés"]')`;
const THRESHOLD_INPUT = `document.querySelector('input[aria-label="Seuil d\\'activité"]')`;
const COMMENT_AREA = `document.querySelector('textarea[placeholder="Commentaire libre"]')`;
const bar = () => evaluate(`document.querySelector('.ui-savebar')?.innerText.replace(/\\n/g, ' ') ?? 'pas de barre'`);
const windText = () => evaluate(`document.querySelector('.an-sheet__wind strong')?.textContent ?? '(absent)'`);
const waitWind = () => waitFor(`Boolean(document.querySelector('.an-sheet__wind strong'))`, { timeout: 30000, every: 200, label: 'vent affiché' });
const openTab = (label) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!t) return 'absent';
  if (t.getAttribute('aria-pressed') !== 'true') t.click();
  return 'ok';
})()`);
const fiche = async (gpx) => {
  const rec = (await records())?.find((r) => r.gpx === gpx);
  if (!rec) return null;
  return { analysis: rec.analysis ?? null, rating: rec.notes?.rating ?? null, comment: rec.notes?.comment ?? null, movingTimeS: Math.round(rec.summary?.movingTimeS ?? 0) };
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

step('1. Import du GPX, ouverture de la session');
await go('/voile', 3000);
console.log('import :', await importFiles(gpxPath, 'input[type=file][accept=".gpx"]'));
await waitFor(async () => (await records())?.some((r) => r.summary?.movingTimeS !== undefined), { timeout: 8000, label: 'fiche' });
await settle({ max: 2000, label: 'import' });
const file = (await records())?.[0]?.gpx ?? '';
check('une fiche rangée', file !== '', file);
const url = `/voile/analyse?session=${encodeURIComponent(file)}`;
await go(url, 7000);
await waitWind();
console.log('url :', await evaluate('location.pathname + location.search'));
const start = await fiche(file);
console.log('barre :', await bar());
console.log('fiche :', JSON.stringify(start));
check('rien à enregistrer au départ', (await bar()) === 'pas de barre' && start?.analysis === null, await bar());

step('2. Vent saisi : brouillon, fiche intacte');
const estimated = Number((await windText()).match(/\d+/)?.[0] ?? 0);
const WIND = (estimated + 100) % 360;
console.log('Régler :', await clickText('Régler'));
await settle({ max: 800, label: 'boussole' });
console.log('saisie', WIND, ':', await typeInto(WIND_INPUT, String(WIND)));
// Le vent saisi est validé par Entrée (ou en quittant le champ).
await evaluate(`${WIND_INPUT}?.focus()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: String.fromCharCode(13) });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await settle({ max: 800, label: 'vent validé' });

console.log('Terminé :', await clickText('Terminé'));
await settle({ max: 800, label: 'vent saisi' });
console.log('barre :', await bar());
console.log('fiche :', JSON.stringify(await fiche(file)));
check('barre « Non enregistré » avec le vent', /Non enregistré/.test(await bar()) && /vent/i.test(await bar()), await bar());
check('fiche intacte', same(await fiche(file), start));

step('3. Retour à la liste refusé : on reste sur la page');
await refuseDialogs(true);
console.log('clic retour :', await evaluate(`(() => { const a = [...document.querySelectorAll('a')].find((x) => x.textContent.trim().startsWith('Sessions voile')); if (!a) return 'absent'; a.click(); return 'ok'; })()`));
await settle({ max: 1000, label: 'retour refusé' });
console.log('dialogue :', (await refusals()).at(-1) ?? '(aucun)');
console.log('url :', await evaluate('location.pathname + location.search'));
await refuseDialogs(false);
check('avertissement posé', (await refusals()).length === 1);
check('on reste sur l\'analyse', (await evaluate('location.pathname')) === '/voile/analyse');

step('4. Enregistrer la session');
console.log('clic :', await clickText('Enregistrer la session'));
await waitFor(async () => (await fiche(file))?.analysis !== null, { timeout: 2500, label: 'fiche écrite' });
await settle({ max: 2500, label: 'enregistrement' });
console.log('barre :', await bar());
console.log('fiche :', JSON.stringify(await fiche(file)));
check('le vent est dans la fiche', JSON.stringify((await fiche(file))?.analysis ?? null).includes(String(WIND)));
check('barre « Session enregistrée »', /Session enregistrée/.test(await bar()) || (await bar()) === 'pas de barre', await bar());

step('5. Seuil propre à la session, puis Enregistrer : résumé recalculé');
console.log('onglet réglages :', await openTab('réglages'));
await settle({ max: 800, label: 'onglet réglages' });
const movingBefore = (await fiche(file))?.movingTimeS;
console.log('saisie :', await typeInto(THRESHOLD_INPUT, '15'));
await settle({ max: 1500, label: 'seuil saisi' });
console.log('barre :', await bar());
check('barre « Non enregistré » avec le seuil', /Non enregistré/.test(await bar()), await bar());
console.log('clic :', await clickText('Enregistrer la session'));
await waitFor(async () => (await fiche(file))?.movingTimeS !== movingBefore, { timeout: 4000, label: 'résumé recalculé' });
await settle({ max: 4000, label: 'enregistrement' });
console.log('fiche :', JSON.stringify(await fiche(file)));
check('résumé recalculé avec le seuil', (await fiche(file))?.movingTimeS !== movingBefore, `${movingBefore} → ${(await fiche(file))?.movingTimeS}`);

step('6. Rechargement : vent et seuil relus depuis la fiche');
await go(url, 7000);
await waitWind();
await openTab('réglages');
await settle({ max: 800, label: 'onglet réglages' });
console.log('vent :', await windText(), '| seuil :', await evaluate(`${THRESHOLD_INPUT}?.value`));
console.log('barre :', await bar());
check('vent relu', (await windText()) === `Vent ${WIND}°`, await windText());
check('seuil relu', (await evaluate(`${THRESHOLD_INPUT}?.value`)) === '15', await evaluate(`${THRESHOLD_INPUT}?.value`));

step('7. Notes puis Annuler : retour à l\'état enregistré');
console.log('onglet matos et conditions :', await openTab('matos et conditions'));
await settle({ max: 800, label: 'onglet matos' });
console.log('commentaire :', await typeInto(COMMENT_AREA, 'Essai du banc'));
await settle({ max: 800, label: 'commentaire' });
console.log('barre :', await bar());
check('barre « Non enregistré » avec les notes', /Non enregistré/.test(await bar()) && /notes/.test(await bar()), await bar());
console.log('clic Annuler :', await clickText('Annuler'));
await settle({ max: 800, label: 'annulation' });
console.log('commentaire après Annuler :', JSON.stringify(await evaluate(`${COMMENT_AREA}?.value`)));
console.log('barre :', await bar());
check('commentaire effacé par Annuler', (await evaluate(`${COMMENT_AREA}?.value`)) === '');
check('plus rien à enregistrer', !/Non enregistré/.test(await bar()), await bar());

step('8. Brouillon gardé après un retour arrière du navigateur');
await typeInto(COMMENT_AREA, 'Brouillon gardé');
await settle({ max: 800, label: 'commentaire' });
await evaluate('history.back()');
await settle({ max: 2000, label: 'retour arrière' });
console.log('url :', await evaluate('location.pathname'));
await evaluate('history.forward()');
await waitFor(`location.pathname === '/voile/analyse'`, { timeout: 6000, label: 'retour en avant' });
await settle({ max: 6000, label: 'retour en avant' });
await waitWind();
await openTab('matos et conditions');
await settle({ max: 800, label: 'onglet matos' });
console.log('commentaire :', JSON.stringify(await evaluate(`${COMMENT_AREA}?.value`)), '| barre :', await bar());
check('brouillon retrouvé', (await evaluate(`${COMMENT_AREA}?.value`)) === 'Brouillon gardé');

step('9. Retour à la liste accepté : brouillon abandonné');
console.log('clic retour :', await evaluate(`(() => { const a = [...document.querySelectorAll('a')].find((x) => x.textContent.trim().startsWith('Sessions voile')); if (!a) return 'absent'; a.click(); return 'ok'; })()`));
await waitFor(`location.pathname === '/voile'`, { timeout: 1500, label: 'retour à la liste' });
await settle({ max: 1500, label: 'liste' });
console.log('url :', await evaluate('location.pathname'));
console.log('fiche :', JSON.stringify(await fiche(file)));
check('avertissement accepté', dialogs.length >= 1, dialogs.at(-1));
check('de retour sur la liste', (await evaluate('location.pathname')) === '/voile');
check('fiche sans le brouillon', (await fiche(file))?.comment === null || (await fiche(file))?.comment === '');

step('Console');
console.log(logs.length ? logs.join('\n') : 'aucune erreur');
await finish('Tout passe.');
