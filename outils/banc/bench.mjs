// Banc de test : pilote un Chrome sans fenêtre par le protocole DevTools.
// Usage : node bench.mjs <port> analyse <gpx>
// Scénario : rejeu du GPX à ×600 → Arrêter → Analyser, puis relevé de la page d'analyse voile.
// L'ancien scénario « fichier » (ouverture dans /voile) est retiré : depuis le lot 3a, /voile est la bibliothèque.
// Verdicts (lot 159) : les chiffres de l'analyse sont confrontés à ce que la trace de `make-gpx.mjs` donne par construction
// (points, durée, distance, top 2 s, manœuvres, vent du nord) ; fin par « Tout passe. » ou le nombre d'échecs, code 0 ou 1.
import { readFileSync, writeFileSync } from 'node:fs';
import { connect } from './lib/cdp.mjs';
import { ONGLETS } from './lib/onglets.mjs';

const [port, scenario = 'analyse', gpxPath] = process.argv.slice(2);
if (scenario !== 'analyse' || !gpxPath) {
  console.error('Usage : node bench.mjs <port> analyse <gpx, chemin Windows>');
  process.exit(1);
}
const SHOT = process.env.SHOT;

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go: goRaw, settle, waitFor, wait, importFiles, records, logs, check, finish } = await connect({ port });

// --- Ce que la trace donne par construction (relu dans le GPX, pas recopié de make-gpx.mjs) ---
const gpxText = readFileSync(gpxPath, 'utf8');
const speeds = [...gpxText.matchAll(/<speed>([\d.]+)<\/speed>/g)].map((m) => Number(m[1]));
const attendu = {
  points: (gpxText.match(/<trkpt/g) ?? []).length,
  // Intégrale de la vitesse retenue (règle 6), pas de 1 s.
  distanceKm: speeds.reduce((a, v) => a + v, 0) / 1000,
  topKn: (Math.max(...speeds) * 3600) / 1852,
};
const nombre = (t) => Number(String(t).replace(/\s/g, '').replace(',', '.'));
/** Navigation, puis attente du premier rendu de l'application : sous charge, `settle` seul peut rendre la main avant. */
const go = async (path, max) => {
  const ms = await goRaw(path, max);
  await waitFor(`Boolean(document.querySelector('.shell-main'))`, { timeout: 5000, every: 50, label: 'premier rendu' });
  return ms;
};
// « Arrêter » se tient (appui long réglable, 2 s par défaut) : appui, attente, puis relâcher.
const holdStop = async () => {
  const down = await evaluate(`(() => { const b = [...document.querySelectorAll('button.ui-btn--danger')].find((x) => x.textContent.includes('Arrêter') && !x.disabled && !x.closest('.ivl')); if (!b) return 'absent'; window.__stopButton = b; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); return 'ok'; })()`);
  if (down !== 'ok') return down;
  await wait(2300);
  return evaluate(`(() => { const b = window.__stopButton; b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })); b.click(); return 'ok'; })()`);
};
const clickText = (text) => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(text)})); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
const snapshot = () => evaluate(`JSON.stringify({ url: location.pathname, h1: document.querySelector('h1')?.textContent ?? null, text: document.body.innerText.length, segments: document.querySelectorAll('path.leaflet-interactive').length, traceCanvas: document.querySelectorAll('.leaflet-trace-pane canvas').length, charts: document.querySelectorAll('.recharts-surface').length })`);

// Rangée « avancé » des analyses ouverte d'office, onglets posés dans `tracker.sections` rejoués à chaque analyse (`lib/onglets.mjs`, 05/11) ; `general.mjs` éprouve la rangée fermée.
await send('Page.addScriptToEvaluateOnNewDocument', { source: ONGLETS });
await go('/', 2500);
// Onglets de la colonne de la carte tous ouverts, comme chez l'utilisateur.
await evaluate(`localStorage.setItem('tracker.sections', JSON.stringify({ 'sailing-onglets': { tops: true, manoeuvres: true, graphiques: true, vmg: true, vent: true, matos: true, reglages: true } })); 'ok'`);

await go('/enregistrer', 2500);
await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click(); 'ok'`);
await wait(300);
await importFiles(gpxPath, 'input[type=file]');
await settle({ max: 800 });
await evaluate(`(() => { const s = [...document.querySelectorAll('select')].pop(); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, '600'); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
console.log('Démarrer :', await clickText('Démarrer'));
await wait(8000); // rejeu en temps réel (×600) : un vrai délai
console.log('Arrêter :', await holdStop());
// La session est rangée en mémoire (OPFS) : ni DOM ni réseau, d'où l'attente de la fiche avant `settle`.
await waitFor(async () => (await records())?.length >= 1, { timeout: 6000, label: 'fiche rangée' });
await settle({ max: 2000 });
const pageEnregistrement = await evaluate(`document.body.innerText.split('\\n').filter((l) => /points|Rangée|Session/.test(l)).join(' | ')`);
console.log('page enregistrement :', pageEnregistrement);
console.log('Analyser :', await clickText('Analyser'));
await settle({ max: 5000 });

console.log('résultat :', await snapshot());
const texte = (await evaluate('document.body.innerText')) ?? '';
// Vues des manœuvres tenues par le module (« Détails », genre du tableau par amure, liste de tous les virements) :
// rendues telles quelles quand l'onglet se ferme puis se rouvre. Relevées à part, après le texte des verdicts.
const choisir = (groupe, text) => evaluate(`(() => { const g = document.querySelector('[role=radiogroup][aria-label=${JSON.stringify(groupe)}]'); const b = g && [...g.querySelectorAll('button[role=radio]')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
const onglet = (cle) => evaluate(`(() => { const b = document.querySelector('.an-tabs [data-tab=${JSON.stringify(cle)}]'); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
console.log('manœuvres, Détails :', await choisir('Détails des manœuvres', 'Détails'));
await settle({ max: 1000 });
console.log('par amure, Empannages :', await choisir('Manœuvres par amure', 'Empannages'));
await settle({ max: 1000 });
console.log('Tous les virements :', await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.startsWith('Tous les virements')); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await settle({ max: 1000 });
console.log('onglet manœuvres fermé :', await onglet('manoeuvres'));
await settle({ max: 1000 });
console.log('onglet manœuvres rouvert :', await onglet('manoeuvres'));
await settle({ max: 2000 });
const texteDetails = (await evaluate('document.body.innerText')) ?? '';
const titreDetails = '===== manœuvres rouvertes : Détails, empannages par amure, tous les virements =====';
if (process.env.DUMP) writeFileSync(process.env.DUMP, [texte, titreDetails, texteDetails].join('\n'));
if (SHOT) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(SHOT, Buffer.from(shot.result.data, 'base64'));
}
// Bulle d'un rond de manœuvre (lot 189, cartes sans react-leaflet) : virements montrés sur la carte, clic sur le premier
// rond (tous ratés, bord rouge), relevé après le texte des verdicts pour ne pas le changer.
console.log('virements sur la carte :', await evaluate(`(() => { const b = document.querySelector('button[title="Afficher les virements sur la carte"]'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await settle({ max: 1000 });
console.log('clic sur un rond :', await evaluate(`(() => {
  const rond = document.querySelector('.an-map-frame path.leaflet-interactive[stroke="#c62828"], .an-map-frame path.leaflet-interactive[stroke="#2e7d32"]');
  if (!rond) return 'absent';
  const r = rond.getBoundingClientRect();
  rond.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  return 'ok';
})()`));
await settle({ max: 1000 });
const bulle = await evaluate(`document.querySelector('.an-map-frame .leaflet-popup-content')?.textContent ?? null`);
console.log('--- console (erreurs, avertissements) ---');
[...new Set(logs)].slice(0, 10).forEach((l) => console.log(l));

// --- Verdicts ---
/** Valeur qui suit le libellé `label` sur la ligne suivante du texte de la page. */
const apres = (label) => texte.match(new RegExp(`^${label}\\n([^\\n]+)`, 'm'))?.[1];
check(`enregistrement : ${attendu.points} points, autant que de <trkpt> dans le GPX`, pageEnregistrement?.includes(`${attendu.points} points`), pageEnregistrement);
// 6 × 2 bords de 150 s et 2 virements de 6 s, un empannage de 5 s, puis autant au portant : 3 749 s.
check('général : temps total 1 h 02', apres('Temps total') === '1 h 02', apres('Temps total'));
// Seules les quelques secondes sous 8 nds au cœur des virements (3 m/s au plus bas) sont hors du vol : moins de 1 %.
const distance = nombre(apres('Distance en vol')?.replace(/ ?km$/, ''));
check(`général : distance en vol à 1 % de la somme des vitesses (${attendu.distanceKm.toFixed(2)} km)`, Math.abs(distance - attendu.distanceKm) <= attendu.distanceKm * 0.01, apres('Distance en vol'));
// Plus haute vitesse du fichier : 9 + 0,5 m/s au portant ; le top sur 2 s la suit à 0,1 nd près.
const top = nombre(apres('Top 2 s')?.replace(/ ?nds$/, ''));
check(`général : top 2 s à la vitesse max du fichier (${attendu.topKn.toFixed(2)} nds)`, Math.abs(top - attendu.topKn) <= 0.1, apres('Top 2 s'));
// Virements à 3 m/s (5,8 nds) au plus bas : tous ratés sous 8 nds ; empannages à 6 m/s (11,7 nds) : tous réussis.
check('général : 12 virements, aucun réussi', apres('Virements réussis') === '0 / 12 (0 %)', apres('Virements réussis'));
check('général : 12 empannages, tous réussis', apres('Empannages réussis') === '12 / 12 (100 %)', apres('Empannages réussis'));
check('manœuvres : virements 0 réussi, 12 ratés, Vmin 5,8 nds', /^Virements\t0\t12\t5,8\t5,8\t/m.test(texte), texte.match(/^Virements\t[^\n]*/m)?.[0]);
check('manœuvres : empannages 12 réussis, 0 raté, Vmin 11,7 nds', /^Empannages\t12\t0\t11,7\t11,7\t/m.test(texte), texte.match(/^Empannages\t[^\n]*/m)?.[0]);
// Conservation de vitesse d'un virement : 3 m/s au plus bas sur 7 m/s d'entrée, 3/7 = 43 %.
check('par amure : conservation 43 % (3/7) des deux bords', /^Tribord\t0 \/ 6\t5,8\t43 %$/m.test(texte) && /^Bâbord\t0 \/ 6\t5,8\t43 %$/m.test(texte),
  texte.match(/^(Tribord|Bâbord)\t[^\n]*/gm)?.join(' | '));
// Vent du nord : bords de près à 45° et 315°, de portant à 135° et 225°.
const vent = Number(texte.match(/^Vent (\d+)°$/m)?.[1]);
check('vent du nord : entre 350° et 10°', Number.isFinite(vent) && (vent >= 350 || vent <= 10), texte.match(/^Vent [^\n]*/m)?.[0]);
// Onglet fermé puis rouvert : « Détails », le tableau par amure sur les empannages (Vmin 11,7 nds) et la liste des virements restent.
check('manœuvres rouvertes : détails, empannages par amure et liste des virements gardés',
  /replier les virements/i.test(texteDetails) && /^(Tribord|Bâbord)\t\d+ \/ \d+\t11,7\t/m.test(texteDetails),
  texteDetails.match(/^(Tribord|Bâbord)\t[^\n]*/gm)?.join(' | '));
check('carte : un clic sur un rond de manœuvre ouvre sa bulle (« Réussi » ou « Raté »)', /Réussi|Raté/.test(bulle ?? ''), bulle ?? '(aucune bulle)');
await finish();
