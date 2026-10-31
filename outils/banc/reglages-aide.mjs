// Banc de test : aides de Réglages sous des « ? » (lot 3 des demandes du 19/10).
// Usage : node reglages-aide.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau. Dure environ 40 s. Le script :
//  1. ouvre tous les blocs, toutes les familles, activités et parties : plus aucun `title` sur une ligne de
//     réglage, plus de grande note sous les activités, aucune aide dépliée au départ ;
//  2. ouvre chaque « ? » de la page, un par un : son texte, court, apparaît seul, et le suivant referme le
//     précédent ; un second appui referme ;
//  3. le « ? » d'un bloc (Activités) ne replie pas le bloc, son texte se déplie sous le titre ;
//  4. à 390×844 : aucun débordement, une aide ouverte comprise ;
//  5. hors de Réglages, les aides valent aussi : le mode d'emploi des bips d'un parcours (Itinéraires) est sous le « ? » du bloc.
import { connect } from './lib/cdp.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node reglages-aide.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, settle, wait, waitFor, blockNetwork, shoot, close, logs } = await connect({ port, width: 1400, height: 1000, shotDir });
const overflow = () => evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
let failures = 0;
const check = (what, ok, detail) => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${what}${detail !== undefined ? ` (${detail})` : ''}`); if (!ok) failures++; };
const finish = async () => {
  console.log('\n--- console (erreurs, avertissements) ---');
  logs.forEach((l) => console.log(l));
  await close();
};

// Rangée « avancé » des analyses ouverte d'office (22/10), rouverte à chaque session neuve avec « général » (23/10) : tous les onglets restent dans la barre ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}'); if (!s['analyses-avance']) { s['analyses-avance'] = { ouvert: true }; localStorage.setItem('tracker.sections', JSON.stringify(s)); } } catch {} new MutationObserver(() => { const t = document.querySelector('.an-tabs-advanced-toggle[aria-expanded="false"]'); if (!t) return; t.click(); setTimeout(() => { const g = [...document.querySelectorAll('.an-tabs .ui-tab')].find((b) => b.textContent.trim() === 'général'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); }, 0); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });` });
await blockNetwork(['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*']);

/** Tout ouvert : blocs, familles, parties des activités (mémoire des blocs), puis chaque carte d'activité. */
const openAll = async () => {
  await evaluate(`(() => {
    const s = JSON.parse(localStorage.getItem('tracker.sections') ?? '{}');
    s.settings = { memoire: true, autorisations: true, activites: true, enregistrement: true, capteurs: true, cartes: true, coureur: true };
    s['settings-families'] = { voile: true, course: true, velo: true, fractionne: true, surf: true };
    s['settings-activity-parts'] = { affichage: true, analyse: true, enregistrement: true, itineraires: true, balises: true };
    localStorage.setItem('tracker.sections', JSON.stringify(s));
    return 'ok';
  })()`);
  await go('/parametres', 3000);
  await evaluate(`(() => { document.querySelectorAll('.settings-activity__toggle[aria-expanded="false"]').forEach((b) => b.click()); return 'ok'; })()`);
  await settle({ max: 800, label: 'activités ouvertes' });
};
const helps = `[...document.querySelectorAll('button.ui-help')]`;
const openTexts = () => evaluate(`[...document.querySelectorAll('.settings-help')].map((p) => p.textContent.trim())`);

// --- 1. Tout ouvert, aucune aide dépliée ---
await go('/parametres', 3000);
await openAll();
const count = await evaluate(`${helps}.length`);
console.log('« ? » sur la page :', count);
check('des « ? » partout (plus de 100, neuf activités ouvertes)', count > 100, count);
check('plus aucun title sur une ligne de réglage', (await evaluate(`document.querySelectorAll('.settings-row[title]').length`)) === 0);
check('plus de grande note sous les activités', (await evaluate(`document.querySelectorAll('.settings-block__note').length`)) === 0);
check('aucune aide dépliée au départ', (await openTexts()).length === 0);
check('chaque « ? » nommé « Aide : … »', await evaluate(`${helps}.every((b) => b.getAttribute('aria-label')?.startsWith('Aide : '))`));

// --- 2. Chaque « ? », un par un ---
const sweep = await evaluate(`(async () => {
  const pause = () => new Promise((r) => setTimeout(r, 30));
  const buttons = [...document.querySelectorAll('button.ui-help')];
  const bad = [];
  let longest = 0;
  for (const [k, b] of buttons.entries()) {
    b.click();
    await pause();
    const texts = [...document.querySelectorAll('.settings-help')].map((p) => p.textContent.trim());
    if (texts.length !== 1 || texts[0] === '' || b.getAttribute('aria-expanded') !== 'true') bad.push(k + ' ' + b.getAttribute('aria-label') + ' : ' + texts.length);
    longest = Math.max(longest, texts[0]?.length ?? 0);
  }
  const last = buttons[buttons.length - 1];
  last.click();
  await pause();
  return { bad, longest, closed: document.querySelectorAll('.settings-help').length === 0 };
})()`);
check('chaque « ? » déplie un texte, seul (le suivant referme le précédent)', sweep.bad.length === 0, sweep.bad.slice(0, 5).join(' | '));
check('textes courts (moins de 300 signes ; 260 jusqu’au 26/10, l’aide « Étape » de la notification en compte 282)', sweep.longest < 300, sweep.longest);
check('un second appui referme', sweep.closed === true);

// Le « ? » du seuil de Voile : son texte, sous sa ligne.
const seuil = await evaluate(`(async () => {
  const card = [...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('[aria-label="Couleur de Voile"]'));
  const row = [...(card?.querySelectorAll('.settings-row') ?? [])].find((r) => r.querySelector('.settings-row__label')?.textContent === "Seuil d'activité");
  row?.querySelector('.ui-help')?.click();
  await new Promise((r) => setTimeout(r, 50));
  return { label: row?.querySelector('.settings-row__label')?.textContent, text: row?.querySelector('.settings-help')?.textContent ?? '(absente)' };
})()`);
check('seuil de Voile : le libellé garde son texte seul', seuil.label === "Seuil d'activité", seuil.label);
check('seuil de Voile : aide sous la ligne', seuil.text.includes('en action'), seuil.text);
await shoot('aide-seuil');

// --- 3. Le « ? » d'un bloc ne le replie pas ---
const block = await evaluate(`(async () => {
  const b = document.querySelector('button.ui-help[aria-label="Aide : Activités"]');
  if (!b) return null;
  b.click();
  await new Promise((r) => setTimeout(r, 50));
  return { open: document.querySelector('.settings-activities') !== null, texts: [...document.querySelectorAll('.settings-help')].map((p) => p.textContent) };
})()`);
check('bloc Activités : toujours ouvert après son « ? »', block?.open === true);
check('bloc Activités : son aide seule, le seuil refermé', block?.texts.length === 1 && block.texts[0].includes("L'œil"), block?.texts.join(' | '));

// --- 4. Téléphone ---
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await openAll();
check('390×844, tout ouvert : aucun débordement', (await overflow()) === 0, await overflow());
// La carte de Route peut ne pas être encore dépliée : on retente (ouvre ses cartes, puis l'aide) jusqu'à une seule aide dépliée.
await waitFor(`(() => {
  document.querySelectorAll('.settings-activity__toggle[aria-expanded="false"]').forEach((b) => b.click());
  const card = [...document.querySelectorAll('.settings-activity')].find((c) => c.querySelector('[aria-label="Couleur de Route"]'));
  const row = [...(card?.querySelectorAll('.settings-row') ?? [])].find((r) => r.querySelector('.settings-row__label')?.textContent === 'Type de vélo');
  const help = row?.querySelector('.ui-help');
  if (help && help.getAttribute('aria-expanded') !== 'true') help.click();
  row?.scrollIntoView({ block: 'center' });
  return document.querySelectorAll('.settings-help').length === 1;
})()`, { timeout: 4000, every: 200 });
check('390×844, aide du type de vélo ouverte : aucun débordement', (await overflow()) === 0 && (await openTexts()).length === 1, await overflow());
await shoot('aide-telephone');

// --- 5. Hors de Réglages ---
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
await go('/itineraires', 3000);
console.log('Régler pour ce parcours :', await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Régler pour ce parcours');
  if (!b) return 'absent';
  b.click();
  return 'ok';
})()`));
await wait(500);
const routes = await evaluate(`document.body.innerText`);
const routeHelp = await evaluate(`(() => {
  const b = ${helps}.find((x) => x.getAttribute('aria-label') === 'Aide : Parcours');
  if (!b) return null;
  b.click();
  return true;
})()`);
await wait(300);
const routesOpen = await evaluate(`document.body.innerText`);
// Depuis le lot 3 du 24/10, les aides valent partout : le mode d'emploi des bips d'un parcours passe sous le « ? » du bloc.
check("Itinéraires : le mode d'emploi des bips sous le « ? » du bloc Parcours",
  !/tirez un point/i.test(routes) && routeHelp === true && /tirez un point/i.test(routesOpen), routeHelp);

console.log(`\n${failures === 0 ? 'Tout est passé.' : `${failures} échec(s).`}`);
await finish();
process.exit(failures === 0 ? 0 : 1);
