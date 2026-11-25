// Banc de test : la fermeture du programme Windows avec un brouillon en attente (« Quitter sans enregistrer ? »).
// Usage : node exe-fermeture.mjs <Tracker.exe> [<port de débogage>]
// Hors registre (`scripts.mjs`) : le script lance lui-même le programme, une instance par essai, en mode d'essai de la
// coquille (`TRACKER_BANC=1`, profil temporaire jamais celui du vrai programme), et ne passe pas par `passe.mjs`.
// La fermeture est la demande de Windows à la fenêtre (`taskkill /PID` sans `/F`, comme la croix). Trois essais :
//  A. sans brouillon : le programme se ferme ;
//  B. avec un brouillon (vent saisi, « Enregistrer la session » attendu), `TRACKER_BANC_QUITTER=non` : la fenêtre reste,
//     la page répond, le journal de la coquille dit que la question a été posée ;
//  C. le même, `TRACKER_BANC_QUITTER=oui` : la question est répondue « Quitter », le programme se ferme.
//  G. écritures vidées avant la fermeture (lot 232) : un nom de session saisi, la croix aussitôt ; la coquille attend
//     que la page ait vidé ses écritures (`flushBeforeExit`, plafond de 5 s : le journal dit « écritures vidées »,
//     jamais « non confirmées »), le nom est sur le disque, et il est montré à la réouverture sur le même profil.
// Puis les trois mêmes après un rechargement fait par la page (`location.reload()`, comme la remise à zéro ou le
// changement d'un réglage de l'appareil) : D sans brouillon, E « Rester », F « Quitter ». Pour eux la fenêtre est
// montrée, transparente (`TRACKER_BANC_MONTRER=transparente`) : après un rechargement, Chromium ajoute au processus une
// seconde fenêtre cachée, et la demande de `taskkill` partirait vers elle si celle de l'application était cachée aussi.
// La vraie boîte de dialogue (boutons « Quitter » et « Rester ») ne se voit qu'à la main : le mode d'essai répond seul.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from './lib/cdp.mjs';
import { traceDroite } from './lib/traces.mjs';

const [exe, portArg] = process.argv.slice(2);
if (!exe) {
  console.error('Usage : node exe-fermeture.mjs <Tracker.exe> [<port>]');
  process.exit(1);
}
const PORT = Number(portArg ?? 9497);
const ORIGINE = 'https://tracker.localhost'; // `bureau/origine.ts`
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const vivant = (pid) => spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8', windowsHide: true }).stdout.includes(` ${pid} `);
/** Attend jusqu'à `ms` que le processus ait disparu. */
const disparu = async (pid, ms) => { for (let t = 0; t < ms; t += 200) { if (!vivant(pid)) return true; await pause(200); } return !vivant(pid); };

let echecs = 0;
const check = (quoi, ok, detail) => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${quoi}${!ok && detail !== undefined ? ` (${detail})` : ''}`); if (!ok) echecs++; };

/** Une instance du programme sur un profil neuf ; rend le processus, le journal et l'adresse de la page. */
async function lancerProgramme(quitter, montrer, reprise = null) {
  // `reprise` : le profil d'une instance précédente (réouverture), mémoire comprise, sans l'effacer entre-temps.
  const profil = reprise ?? mkdtempSync(join(tmpdir(), 'tracker-fermeture-'));
  // Une mémoire prête d'avance, comme le lanceur la donne (`passe.mjs --exe`) : sans elle, le premier lancement n'a pas
  // de dossier mémoire et refuse l'import. `records()` (lib/cdp.mjs) la lit par Node.
  const memoire = join(profil, 'memoire');
  mkdirSync(memoire, { recursive: true });
  process.env.TRACKER_MEMOIRE = memoire;
  const env = { ...process.env, TRACKER_BANC: '1', TRACKER_PROFIL: profil, TRACKER_MEMOIRE: memoire, TRACKER_BANC_QUITTER: quitter };
  if (montrer) env.TRACKER_BANC_MONTRER = 'transparente';
  for (const cle of Object.keys(env)) if (cle.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[cle];
  const child = spawn(exe, [`--remote-debugging-port=${PORT}`, '--lang=fr-FR', '--force-device-scale-factor=1', '--hide-scrollbars'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const journal = [];
  const lire = (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) journal.push(l.trim()); };
  child.stdout.on('data', lire);
  child.stderr.on('data', lire);
  let ws = null;
  for (let k = 0; k < 100 && !ws; k++) {
    await pause(300);
    try { ws = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((p) => p.type === 'page')?.webSocketDebuggerUrl ?? null; } catch { /* pas prêt */ }
  }
  if (!ws) throw new Error('le programme ne répond pas');
  return { child, journal, ws, profil };
}
const nettoyer = async ({ child, profil }) => {
  spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
  await disparu(child.pid, 5000);
  rmSync(profil, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
};
/** Demande de fermeture faite à la fenêtre, comme la croix : sans `/F`. */
const fermerWindows = (pid) => spawnSync('taskkill', ['/PID', String(pid)], { encoding: 'utf8', windowsHide: true });

/** Importe une session de voile, ouvre son analyse, saisit un vent : un brouillon attend (barre « Enregistrer la session »). */
async function faireUnBrouillon(b) {
  const { evaluate, waitFor, wait, blockNetwork, importGpx, records, send, mouse } = b;
  await blockNetwork();
  // Navigation interne à l'application : un chargement de document ferait apparaître la seconde fenêtre cachée de
  // Chromium, et la demande de fermeture n'atteindrait plus la fenêtre cachée du mode d'essai (voir l'en-tête).
  const entrer = (adresse) => evaluate(`(() => { history.pushState({}, '', ${JSON.stringify(adresse)}); dispatchEvent(new PopStateEvent('popstate')); return 'ok'; })()`);
  await entrer('/voile');
  await waitFor(`Boolean(document.querySelector('input[type=file][accept*=".gpx"]'))`, { timeout: 8000, label: 'champ' });
  await importGpx(traceDroite({ debutMs: Date.UTC(2026, 9, 1, 7, 0, 0), secondes: 600, vitesse: 4, type: 'wingfoil', nom: 'Fermeture' }), 'fermeture.gpx');
  const fiche = await waitFor(async () => (await records())?.[0], { timeout: 6000, label: 'fiche' });
  await wait(1500);
  await entrer(`/voile/analyse?session=${encodeURIComponent(fiche?.gpx ?? '')}`);
  await waitFor(`Boolean([...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Régler'))`, { timeout: 15000, label: 'Régler' });
  await evaluate(`[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Régler')?.click()`);
  await wait(800);
  await evaluate(`(() => { const el = document.querySelector('input[aria-label="Vent en degrés"]'); if (!el) return 'absent'; el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '123'); el.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: String.fromCharCode(13) });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await wait(800);
  await evaluate(`[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Terminé')?.click()`);
  await wait(500);
  const barre = await waitFor(`Boolean(document.querySelector('.ui-savebar'))`, { timeout: 4000, label: 'barre' });
  // Chromium ne retient la fermeture (`beforeunload`) que si l'utilisateur a agi sur la page : un vrai clic, par le protocole.
  const coin = await evaluate(`(() => { const r = document.querySelector('.ui-savebar')?.getBoundingClientRect(); return r ? { x: r.left + 3, y: r.top + 3 } : null; })()`);
  if (coin) { await mouse('mousePressed', coin.x, coin.y); await mouse('mouseReleased', coin.x, coin.y); }
  return Boolean(barre);
}

/** Rechargement fait par la page elle-même, comme l'application le fait ; attend le nouveau document. */
async function recharger(b) {
  await b.evaluate(`(() => { window.__ancienDocument = true; setTimeout(() => location.reload(), 50); return 'ok'; })()`);
  return Boolean(await b.waitFor(`!window.__ancienDocument && document.readyState === 'complete' && document.body.innerText.length > 20`, { timeout: 10000, label: 'rechargement' }));
}

async function essai(titre, quitter, avecBrouillon, rechargement = false) {
  console.log(`\n== ${titre}`);
  const p = await lancerProgramme(quitter, rechargement);
  process.env.BANC_WS = p.ws;
  const b = await connect({ port: PORT, base: ORIGINE, width: 1400, height: 1000 });
  try {
    if (rechargement) { await b.wait(1500); check('la page s\'est rechargée', await recharger(b)); }
    if (avecBrouillon) check('un brouillon attend (barre « Enregistrer la session »)', await faireUnBrouillon(b));
    else { await b.wait(1500); check('page ouverte, sans brouillon', await b.evaluate(`document.body.innerText.length > 20 && !document.querySelector('.ui-savebar')`)); }
    check('le programme tourne avant la fermeture', vivant(p.child.pid));
    const k = fermerWindows(p.child.pid);
    console.log(`demande de fermeture : ${k.status === 0 ? 'envoyée' : `refusée (${String(k.stdout).trim()} ${String(k.stderr).trim()})`}`);
    return { p, b };
  } catch (e) {
    check(`essai interrompu : ${e.message}`, false);
    await b.close();
    await nettoyer(p);
    return null;
  }
}

const lignesFermeture = (p) => p.journal.filter((l) => /fermeture/.test(l)).join(' | ') || '(aucune ligne)';

/** Sans brouillon : la fenêtre se ferme. */
async function sansBrouillon(titre, rechargement) {
  const r = await essai(titre, 'non', false, rechargement);
  if (!r) return;
  check('sans brouillon, le programme se ferme', await disparu(r.p.child.pid, 8000));
  try { await r.b.close(); } catch { /* page déjà fermée */ }
  await nettoyer(r.p);
}
/** Brouillon, question répondue « Rester » : la fenêtre reste et garde son brouillon. */
async function rester(titre, rechargement) {
  const r = await essai(titre, 'non', true, rechargement);
  if (!r) return;
  await pause(3000);
  check('la fenêtre reste : le programme tourne encore', vivant(r.p.child.pid));
  check('la page répond encore et garde son brouillon', (await r.b.evaluate(`Boolean(document.querySelector('.ui-savebar'))`)) === true);
  check('le journal dit que la question a été posée (rester)', r.p.journal.some((l) => /fermeture retenue par la page : rester/.test(l)), lignesFermeture(r.p));
  await r.b.close();
  await nettoyer(r.p);
}
/** Brouillon, question répondue « Quitter » : le programme se ferme. */
async function quitter(titre, rechargement) {
  const r = await essai(titre, 'oui', true, rechargement);
  if (!r) return;
  check('« Quitter » : le programme se ferme', await disparu(r.p.child.pid, 8000));
  await pause(1000); // le journal de la sortie arrive après la fin du processus
  check('le journal dit que la question a été posée (quitter)', r.p.journal.some((l) => /fermeture retenue par la page : quitter/.test(l)), lignesFermeture(r.p));
  try { await r.b.close(); } catch { /* page déjà fermée */ }
  await nettoyer(r.p);
}

await sansBrouillon('A. Sans brouillon : fermeture demandée à la fenêtre', false);
await rester('B. Brouillon, réponse du mode d\'essai « Rester » (TRACKER_BANC_QUITTER=non)', false);
await quitter('C. Brouillon, réponse du mode d\'essai « Quitter » (TRACKER_BANC_QUITTER=oui)', false);
const NOM_SAISI = 'Nom saisi avant la croix';

/** Nom saisi dans l'en-tête de l'analyse, puis demande de fermeture sans attendre ; la réouverture relit le nom. */
async function ecrituresVidees() {
  console.log('\n== G. Nom de session saisi, fermeture aussitôt : écritures vidées, nom gardé à la réouverture');
  const p = await lancerProgramme('non', false);
  process.env.BANC_WS = p.ws;
  const b = await connect({ port: PORT, base: ORIGINE, width: 1400, height: 1000 });
  let ferme = false;
  try {
    const { evaluate, waitFor, wait, blockNetwork, importGpx, records } = b;
    await blockNetwork();
    const entrer = (adresse) => evaluate(`(() => { history.pushState({}, '', ${JSON.stringify(adresse)}); dispatchEvent(new PopStateEvent('popstate')); return 'ok'; })()`);
    await entrer('/voile');
    await waitFor(`Boolean(document.querySelector('input[type=file][accept*=".gpx"]'))`, { timeout: 8000, label: 'champ' });
    await importGpx(traceDroite({ debutMs: Date.UTC(2026, 9, 1, 7, 0, 0), secondes: 600, vitesse: 4, type: 'wingfoil', nom: 'Vidage' }), 'vidage.gpx');
    const fiche = await waitFor(async () => (await records())?.[0], { timeout: 6000, label: 'fiche' });
    await wait(1500);
    await entrer(`/voile/analyse?session=${encodeURIComponent(fiche?.gpx ?? '')}`);
    await waitFor(`Boolean([...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Renommer'))`, { timeout: 15000, label: 'Renommer' });
    await b.settle({ max: 4000 });
    for (let k = 0; k < 3 && !(await evaluate(`Boolean(document.querySelector('input[aria-label="Nom de la session"]'))`)); k++) {
      await evaluate(`[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Renommer')?.click()`);
      await wait(700);
    }
    await waitFor(`Boolean(document.querySelector('input[aria-label="Nom de la session"]'))`, { timeout: 4000, label: 'champ du nom' });
    check('la fiche n\'a pas encore de nom avant la saisie', !(await records())?.[0]?.name);
    await evaluate(`(() => { const i = document.querySelector('input[aria-label="Nom de la session"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(NOM_SAISI)}); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 'ok'; })()`);
    const surDisqueAvant = (await records())?.[0]?.name === NOM_SAISI;
    console.log(`nom déjà sur le disque à la demande de fermeture : ${surDisqueAvant ? 'oui (écriture déjà faite, l\'essai ne prouve rien de plus)' : 'non (écriture encore différée)'}`);
    const debut = Date.now();
    const k = fermerWindows(p.child.pid);
    console.log(`demande de fermeture : ${k.status === 0 ? 'envoyée' : `refusée (${String(k.stdout).trim()} ${String(k.stderr).trim()})`}`);
    ferme = await disparu(p.child.pid, 8000);
    const duree = Date.now() - debut;
    console.log(`fermeture en ${duree} ms`);
    check('la croix ferme le programme', ferme);
    check('la fermeture ne dépasse pas le plafond de 5 s du vidage', ferme && duree < 6500, `${duree} ms`);
    await pause(1000); // le journal de la sortie arrive après la fin du processus
    check('le journal dit « écritures vidées »', p.journal.some((l) => /écritures vidées/.test(l)), lignesFermeture(p) + ' | ' + p.journal.filter((l) => /vidage|écritures/.test(l)).join(' | '));
    check('le journal ne dit pas « écritures non confirmées »', !p.journal.some((l) => /écritures non confirmées/.test(l)));
    const apres = (await records())?.[0];
    check('le nom saisi est sur le disque après la fermeture', apres?.name === NOM_SAISI, apres?.name);
    try { await b.close(); } catch { /* page déjà fermée */ }
    if (!ferme) { await nettoyer(p); return; }
    // Réouverture sur le même profil, mémoire comprise.
    const p2 = await lancerProgramme('non', false, p.profil);
    process.env.BANC_WS = p2.ws;
    const b2 = await connect({ port: PORT, base: ORIGINE, width: 1400, height: 1000 });
    try {
      await b2.blockNetwork();
      await b2.evaluate(`(() => { history.pushState({}, '', '/voile'); dispatchEvent(new PopStateEvent('popstate')); return 'ok'; })()`);
      const vu = await b2.waitFor(`document.body.innerText.includes(${JSON.stringify(NOM_SAISI)})`, { timeout: 10000, label: 'nom relu' });
      check('à la réouverture, la liste montre le nom saisi', Boolean(vu));
      check('la fiche relue garde le nom', (await b2.records())?.[0]?.name === NOM_SAISI);
    } finally {
      try { await b2.close(); } catch { /* page déjà fermée */ }
      await nettoyer(p2);
    }
  } catch (e) {
    check(`essai interrompu : ${e.message}`, false);
    try { await b.close(); } catch { /* page déjà fermée */ }
    await nettoyer(p);
  }
}

await ecrituresVidees();
await sansBrouillon('D. Page rechargée, sans brouillon : fermeture demandée à la fenêtre', true);
await rester('E. Page rechargée, brouillon, réponse « Rester »', true);
await quitter('F. Page rechargée, brouillon, réponse « Quitter »', true);

console.log(echecs === 0 ? '\nTout passe.' : `\n${echecs} échec(s).`);
process.exit(echecs === 0 ? 0 : 1);
