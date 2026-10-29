// Banc du brouillon de voile entre deux sessions (lot 54, étape 9 ; remplace `session-save.mjs`, périmé) :
// le vent saisi dans A n'apparaît pas dans B, y compris juste après le changement de session, et revient en A
// une fois « Enregistrer la session » cliqué. La fiche de A porte le vent, celle de B non.
// Usage : node brouillon-voile.mjs <port> <dossier de travail, chemin Windows>
// Sur un profil neuf, sans réseau utile. Écrit deux GPX par `make-gpx.mjs` (décalages 48 et 72 h, hors des sessions de démonstration que sème le serveur de développement), avec type wingfoil.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './lib/cdp.mjs';

const [port, workDir] = process.argv.slice(2);
if (!port || !workDir) { console.error('Usage : node brouillon-voile.mjs <port> <dossier de travail>'); process.exit(1); }
const here = dirname(fileURLToPath(import.meta.url));

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, settle, waitFor, wait, blockNetwork, importFiles, close, logs } = await connect({ port, width: 1400, height: 1000 });

const clickButton = (text) => evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && !x.disabled);
  if (!b) return 'absent'; b.click(); return 'ok';
})()`);
const readOpfs = (path) => evaluate(`(async () => {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker');
  const parts = ${JSON.stringify(path)}.split('/');
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
  return await (await (await dir.getFileHandle(parts[parts.length - 1])).getFile()).text();
})()`);
const listOpfs = async (path) => (await evaluate(`(async () => { try {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker');
  for (const p of ${JSON.stringify(path)}.split('/')) dir = await dir.getDirectoryHandle(p);
  const names = []; for await (const [name] of dir.entries()) names.push(name); return names.sort();
} catch { return []; } })()`)) ?? [];
let failures = 0;
const check = (label, ok, detail = '') => { if (!ok) failures += 1; console.log(`${ok ? 'ok    ' : 'ÉCHEC '} ${label}${detail !== '' ? ` | ${detail}` : ''}`); };
const windText = () => evaluate(`document.querySelector('.an-sheet__wind strong')?.textContent ?? '(absent)'`);
const windSource = () => evaluate(`document.querySelector('.an-sheet__wind strong')?.nextElementSibling?.textContent ?? '(absent)'`);
const waitWind = async () => { for (let k = 0; k < 60 && (await windText()) === '(absent)'; k++) await wait(500); };
const bar = () => evaluate(`document.querySelector('.ui-savebar')?.innerText.replace(/\\n/g, ' ') ?? 'pas de barre'`);
const fiche = async (gpx) => {
  try { const r = JSON.parse(await readOpfs(`sessions/${gpx.replace(/\.gpx$/, '.json')}`)); return JSON.stringify(r.analysis ?? null); } catch (e) { return `illisible : ${e}`; }
};
const currentSession = () => evaluate(`new URLSearchParams(location.search).get('session')`);
/** Navigation interne (sans rechargement) : le routeur écoute popstate. */
const navigateInApp = (url) => evaluate(`(() => { history.pushState({}, '', ${JSON.stringify(url)}); dispatchEvent(new PopStateEvent('popstate')); return 'ok'; })()`);

await blockNetwork();


// 1. Deux sessions de voile (même trace, départs sur deux jours différents).
const paths = [];
for (const [k, offset] of [[0, 48], [1, 72]]) {
  const raw = join(workDir, `voile-${k}-brut.gpx`);
  execFileSync('node', [join(here, 'make-gpx.mjs'), raw, String(offset)]);
  const out = join(workDir, `voile-${k}.gpx`);
  writeFileSync(out, readFileSync(raw, 'utf8').replace('<name>Synthétique</name>', '<name>Synthétique</name><type>wingfoil</type>'));
  paths.push(out);
}
await go('/voile', 3000);
for (let k = 0; k < 60 && !(await evaluate("!!document.querySelector('input[type=file]')")); k++) await wait(1000);
// Le serveur de développement sème des sessions de démonstration : on ne retient que les rangées nouvelles.
const before = (await listOpfs('sessions')).filter((n) => n.endsWith('.gpx'));
const names = [];
for (const p of paths) {
  await importFiles(p, 'input[type=file][accept=".gpx"]');
  let fresh;
  for (let k = 0; k < 40 && !fresh; k++) { await wait(1000); fresh = (await listOpfs('sessions')).filter((n) => n.endsWith('.gpx')).find((n) => !before.includes(n) && !names.includes(n)); }
  names.push(fresh);
  await waitFor(async () => ((await listOpfs('sessions')) ?? []).includes(fresh.slice(0, -4) + '.json'), { timeout: 3000, label: 'fiche' });
  await settle({ max: 1500, label: 'import' });
}
const [A, B] = [...names].sort(); // l'ordre du nom suit celui des départs
console.log('rangées :', A, B);
check('deux sessions importées', Boolean(A) && Boolean(B) && A !== B);
const urlOf = (n) => `/voile/analyse?session=${encodeURIComponent(n)}`;

// 2. Ouvrir A, vent saisi, Enregistrer.
await go(urlOf(A), 4000);
await waitWind();
const autoA = await windText();
console.log('A au départ :', autoA, '|', await windSource());
const est = Number(autoA.match(/\d+/)?.[0] ?? 0);
const WIND = (est + 100) % 360;
console.log('Régler :', await clickButton('Régler'));
await settle({ max: 800 });
console.log('saisie', WIND, ':', await evaluate(`(() => { const el = document.querySelector('input[aria-label="Vent en degrés"]'); if (!el) return 'absent'; el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(String(WIND))}); el.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`));
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: String.fromCharCode(13) });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await settle({ max: 800 });
console.log('Terminé :', await clickButton('Terminé'));
await wait(500);
console.log('A brouillon :', await windText(), '|', await windSource(), '| barre', await bar());
check('A affiche le vent saisi', (await windText()) === `Vent ${WIND}°`);
console.log('Enregistrer la session :', await clickButton('Enregistrer la session'));
await settle({ max: 2500 });
console.log('barre :', await bar());

// 3. Passer à B dans l'application (sans rechargement), relever le champ du vent à plusieurs instants.
await evaluate(`(() => { window.__w = []; const t0 = performance.now(); const read = () => document.querySelector('.an-sheet__wind strong')?.textContent ?? '(absent)'; let last = null;
  const tick = () => { const v = read() + ' / ' + new URLSearchParams(location.search).get('session'); if (v !== last) { last = v; window.__w.push([Math.round(performance.now() - t0), v]); } };
  new MutationObserver(tick).observe(document, { subtree: true, childList: true, characterData: true }); window.__poll = setInterval(tick, 20); tick(); return 'ok'; })()`);
const tSwitch = Date.now();
await navigateInApp(urlOf(B));
const instants = [];
for (const ms of [0, 50, 150, 400, 1000, 3000]) {
  const left = ms - (Date.now() - tSwitch);
  if (left > 0) await wait(left);
  instants.push([ms, await windText(), await currentSession()]);
}
await waitWind();
await wait(2000);
const tag = (s) => (s === B ? 'B' : s === A ? 'A' : s);
// À 0 ms, l'adresse a déjà changé (pushState) mais React n'a pas encore rendu : seul le journal du MutationObserver tranche.
console.log('B, instants :', instants.map(([ms, t, s]) => `${ms} ms: ${t} (${tag(s)})`).join(' ; '));
const trace = await evaluate(`(clearInterval(window.__poll), window.__w)`);
console.log('B, changements observés (ms, texte / session) :', JSON.stringify(trace));
const seenA = (trace ?? []).some(([, v]) => v.includes(`Vent ${WIND}°`) && v.endsWith(B));
check('B n\'affiche jamais le vent de A', !seenA && !instants.some(([ms, t, s]) => ms > 0 && s === B && t === `Vent ${WIND}°`));
console.log('B stable :', await windText(), '|', await windSource(), '| barre', await bar());
check('B au vent calculé', (await windText()) !== `Vent ${WIND}°`);

// 4. Retour à A.
await navigateInApp(urlOf(A));
await wait(3500);
console.log('A de retour :', await windText(), '|', await windSource());
check('A garde son vent', (await windText()) === `Vent ${WIND}°`);

// 5. Fiches.
const ficheA = await fiche(A);
const ficheB = await fiche(B);
console.log('fiche A :', ficheA, '| fiche B :', ficheB);
check('fiche A porte le vent', ficheA.includes(`${WIND}`), ficheA);
check('fiche B sans vent', !/"windDeg":\s*\d/.test(ficheB), ficheB);

console.log(logs.length ? `console :\n${logs.join('\n')}` : 'console : aucune erreur');
console.log(failures === 0 ? 'RÉSULTAT : ok' : `RÉSULTAT : ${failures} échec(s)`);
await close();
process.exit(0);
