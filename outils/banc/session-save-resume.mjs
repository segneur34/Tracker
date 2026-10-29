// Suite de session-save.mjs (24/09/2026, reprise sur la bibliothèque et la page d'aujourd'hui le 29/10, n° 84),
// sur le même profil Chrome : la session déjà importée est classée en Voile (l'activité de la session change par
// le choix d'activité de l'onglet réglages), puis son seuil est enregistré à 4 et 12 nœuds ; le résumé de la fiche
// doit suivre.
// Usage : node session-save-resume.mjs <port>
// Se branche sur le Chrome du profil de `session-save.mjs` (`BANC_WS` : l'onglet de ce profil), sinon ouvre un
// onglet du Chrome du port : alors la bibliothèque doit déjà contenir la session.
import { connect } from './lib/cdp.mjs';

const [port] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node session-save-resume.mjs <port>');
  process.exit(1);
}

// --- Protocole (lib/cdp.mjs) ---
const { evaluate, go, settle, waitFor, clickText, records, check, finish, logs } = await connect({ port, width: 1400, height: 1000 });

const step = (title) => console.log(`\n== ${title}`);
const typeInto = (selector, value) => evaluate(`(() => {
  const el = ${selector};
  if (!el) return 'absent';
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
const THRESHOLD_INPUT = `document.querySelector('input[aria-label="Seuil d\\'activité"]')`;
const openTab = (label) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.an-carte-col .ui-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
  if (!t) return 'absent';
  if (t.getAttribute('aria-pressed') !== 'true') t.click();
  return 'ok';
})()`);
/** Choisit une activité dans le choix d'activité de l'analyse : 'ok' ou 'absent'. */
const chooseActivity = (text) => evaluate(`(async () => {
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
const fiche = async (file) => {
  const r = (await records())?.find((x) => x.gpx === file);
  return r ? JSON.stringify({ sport: r.sport, analysis: r.analysis, movingTimeS: Math.round(r.summary?.movingTimeS ?? 0) }) : 'fiche absente';
};
const activeTime = () => evaluate(`document.body.innerText.match(/Temps (actif|en vol)[^\\n]*\\n[^\\n]*/)?.[0].replace(/\\n/g, ' ') ?? '(absent)'`);

await go('/voile', 3000);
const file = (await records())?.[0]?.gpx ?? '';
check('la session de session-save.mjs est là', file !== '', file);
const url = `/voile/analyse?session=${encodeURIComponent(file)}`;
await go(url, 6000);
await waitFor(`document.querySelectorAll('.an-carte-col .ui-tab').length > 0`, { timeout: 30000, every: 200, label: 'onglets' });
await settle({ max: 1000, label: 'analyse' });

step('Activité Voile : le seuil de la session est effacé, résumé recalculé');
console.log('onglet réglages :', await openTab('réglages'));
await settle({ max: 800, label: 'onglet réglages' });
console.log('Voile :', await chooseActivity('Voile'));
await settle({ max: 4000, label: 'changement d\'activité' });
console.log('fiche :', await fiche(file), '| seuil affiché :', await evaluate(`${THRESHOLD_INPUT}?.value`));

for (const seuil of ['4', '12']) {
  step(`Seuil ${seuil} nds enregistré`);
  await openTab('réglages');
  await settle({ max: 800, label: 'onglet réglages' });
  console.log('saisie :', await typeInto(THRESHOLD_INPUT, seuil));
  await settle({ max: 3000, label: 'seuil saisi' });
  const before = (await fiche(file));
  console.log('clic :', await clickText('Enregistrer la session'));
  await waitFor(async () => (await fiche(file)) !== before, { timeout: 4000, label: 'fiche écrite' });
  await settle({ max: 4000, label: 'enregistrement' });
  await openTab('général');
  await settle({ max: 800, label: 'onglet général' });
  console.log('page :', await activeTime(), '| fiche :', await fiche(file));
}

step('Console');
console.log(logs.length ? logs.join('\n') : 'aucune erreur');
await finish('Tout passe.');
