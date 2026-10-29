// Banc de test : activité de la trace suivie, changement d'activité pendant l'enregistrement,
// carte réduite, changement d'activité depuis l'analyse (voile ↔ course).
// Usage : node activite.mjs <port> <gpx de voile, chemin Windows> [<dossier des captures>]
// Le GPX vient de `make-gpx.mjs`. Sur un profil où deux itinéraires sont rangés, l'un en Voile et
// l'autre en Course (`planning.mjs` deux fois, le second avec un GPX de type course), le script
// vérifie aussi que suivre un itinéraire propose son activité.
import { connect } from './lib/cdp.mjs';

const [port, gpxPath, shotDir] = process.argv.slice(2);
if (!port || !gpxPath) {
  console.error('Usage : node activite.mjs <port> <gpx de voile> [<dossier des captures>]');
  process.exit(1);
}

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, settle, waitFor, wait, importFiles, shoot, close, logs, onMessage } = await connect({ port, shotDir });
const dialogs = [];
onMessage((msg) => { if (msg.method === 'Page.javascriptDialogOpening') dialogs.push(msg.params.message); });

// « Arrêter » se tient (appui long réglable, 2 s par défaut) : appui, attente, puis relâcher.
const holdStop = async () => {
  const down = await evaluate(`(() => { const b = [...document.querySelectorAll('button.ui-btn--danger')].find((x) => x.textContent.includes('Arrêter') && !x.disabled && !x.closest('.ivl')); if (!b) return 'absent'; window.__stopButton = b; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); return 'ok'; })()`);
  if (down !== 'ok') return down;
  await wait(2300);
  return evaluate(`(() => { const b = window.__stopButton; b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })); b.click(); return 'ok'; })()`);
};
const clickText = (text, scope = 'button') => evaluate(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(scope)})].find((x) => x.textContent.trim().includes(${JSON.stringify(text)}) && !x.disabled); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
/** Choisit une option, par son texte : dans le menu natif qui la contient (le premier trouvé), sinon dans un choix d'activité. */
const chooseOption = (text) => evaluate(`(async () => {
  const select = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent === ${JSON.stringify(text)} && !o.disabled));
  if (select) {
    const option = [...select.options].find((o) => o.textContent === ${JSON.stringify(text)});
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, option.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  }
  // Bouton glissant d'Enregistrer (23/10) : le choix par son texte.
  const radio = [...document.querySelectorAll('[role=radiogroup] button[role=radio]')].find((b) => b.textContent.trim() === ${JSON.stringify(text)});
  if (radio) { radio.click(); return 'ok'; }
  // Choix d'activité (ActivitySelect) : le bouton ouvre la liste, puis l'activité s'y choisit.
  for (const button of document.querySelectorAll('button.activity-select:not(:disabled)')) {
    button.click();
    await new Promise((r) => setTimeout(r, 150));
    const item = [...document.querySelectorAll('.activity-select__option')].find((o) => o.textContent.trim() === ${JSON.stringify(text)});
    if (item) { item.click(); return 'ok'; }
    document.querySelector('.activity-select__backdrop')?.click();
    await new Promise((r) => setTimeout(r, 150));
  }
  return 'absent';
})()`);
const lines = (pattern) => evaluate(`document.body.innerText.split('\\n').filter((l) => ${pattern}.test(l)).join(' | ')`);
/** Famille et activité choisies sur la page Enregistrer, au repos. */
const recordChoice = () => evaluate(`JSON.stringify({
  famille: document.querySelector('[aria-label=Famille] [aria-checked=true]')?.textContent ?? null,
  activite: document.querySelector('[aria-label=Activité] [aria-checked=true]')?.textContent ?? null,
})`);

// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
await go('/', 2500);
// Onglets réglages ouverts dans les deux modules.
await evaluate(`localStorage.setItem('tracker.sections', JSON.stringify({ 'sailing-onglets': { reglages: true }, running: { reglages: true } })); 'ok'`);

// 1. Suivre un itinéraire propose son activité.
await go('/enregistrer', 2500);
await waitFor(`Boolean(document.querySelector('[aria-label=Famille] [aria-checked=true]'))`, { timeout: 5000, label: 'page Enregistrer' });
console.log('au départ :', await recordChoice());
const routeCount = await evaluate(`(async () => {
  [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Suivre une trace')).click();
  await new Promise((r) => setTimeout(r, 800));
  return document.querySelectorAll('ul li button').length;
})()`);
console.log('itinéraires :', routeCount);
for (let i = 0; i < Math.min(routeCount, 3); i++) {
  await evaluate(`(async () => {
    const open = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Suivre une trace'));
    if (!document.querySelector('ul li button')) { open.click(); await new Promise((r) => setTimeout(r, 800)); }
    document.querySelectorAll('ul li button')[${i}].click();
  })()`);
  await settle({ max: 800, label: 'itinéraire suivi' });
  console.log(`itinéraire ${i + 1} suivi :`, await recordChoice(), await lines('/Trace suivie/'));
}
console.log('Retirer :', await clickText('Retirer'));
await wait(300);

// 2. Enregistrement en rejeu à ×10 : Voile, puis Course en route ; carte réduite.
console.log('famille Voile :', await clickText('Voile', '[aria-label=Famille] button'));
await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click(); 'ok'`);
await wait(300);
await importFiles(gpxPath, 'input[type=file]');
await settle({ max: 800, label: 'trace chargée' });
await evaluate(`(() => { const s = [...document.querySelectorAll('select')].pop(); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, '10'); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
console.log('Démarrer :', await clickText('Démarrer'));
await wait(12000);
console.log('en voile :', await lines('/^(Top|Bord|Distance)/'));
console.log('vers Course :', await chooseOption('Course'));
await wait(4000);
// La saisie tourne en rejeu (x10) : ces attentes mesurent l'application, elles restent réelles.
console.log('en course :', await lines('/^(Allure|Dernier|D\\+|D−|Distance)/'));
await shoot('enregistrement-course');
console.log('Réduire la carte :', await clickText('Réduire la carte'));
await wait(2500);
console.log('carte montée :', await evaluate(`document.querySelectorAll('.leaflet-container').length`));
console.log('résumé :', await lines('/^(Allure|Allure moyenne|Meilleure allure)/'));
console.log('mémorisé :', await evaluate(`localStorage.getItem('tracker.sections')`));
await shoot('carte-reduite');
if (shotDir) {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await wait(2500);
  await shoot('carte-reduite-telephone');
  await send('Emulation.clearDeviceMetricsOverride');
}
console.log('retour en Voile :', await chooseOption('Voile'));
await wait(3000);
console.log('résumé en voile :', await lines('/^(Vitesse|Moyenne|Max)/'));
console.log('vers Course :', await chooseOption('Course'));
await wait(1000);
console.log('Afficher la carte :', await clickText('Afficher la carte'));
await wait(1000);
console.log('carte montée :', await evaluate(`document.querySelectorAll('.leaflet-container').length`));
console.log('Arrêter :', await holdStop());
await wait(2500);
console.log('attente :', await lines('/points\\./'));
console.log('Analyser :', await clickText('Analyser'));
await waitFor(`location.pathname.includes('/analyse')`, { timeout: 5000, label: 'analyse ouverte' });
await settle({ max: 5000 });
console.log('ouverte :', await evaluate(`location.pathname + location.search`), await evaluate(`document.querySelector('h1')?.textContent`));

// 3. Depuis l'analyse course, vers Voile : la session change de module.
console.log('vers Voile :', await chooseOption('Voile'));
await settle({ max: 4000 });
console.log('ouverte :', await evaluate(`location.pathname + location.search`), await evaluate(`document.querySelector('h1')?.textContent`));

// 4. Depuis l'analyse voile, avec un brouillon, vers Course : confirmation, puis bascule.
const draft = await evaluate(`(() => {
  const input = [...document.querySelectorAll('label')].find((l) => l.textContent.includes('Seuil d\\'activité'))?.querySelector('input');
  if (!input) return 'absent';
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(input, '4');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);
await settle({ max: 1500 });
console.log('brouillon :', draft, await lines('/Non enregistr/'));
console.log('vers Course :', await chooseOption('Course'));
await settle({ max: 4000 });
console.log('ouverte :', await evaluate(`location.pathname + location.search`), await evaluate(`document.querySelector('h1')?.textContent`));
console.log('brouillon en course :', await lines('/Non enregistr/') || 'aucun');

// 5. Bibliothèques : la session est rangée en course.
await go('/course', 2500);
console.log('bibliothèque course :', await lines('/sessions? *$|Course ·|^Course$/'));

console.log('--- confirmations ---');
dialogs.forEach((d) => console.log(d));
console.log('--- console (erreurs, avertissements) ---');
[...new Set(logs)].slice(0, 10).forEach((l) => console.log(l));
await close();
