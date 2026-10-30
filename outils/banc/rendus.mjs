// Banc de test : rendus de React pendant un enregistrement (lot 67, « ne redessiner que les chiffres »).
// Usage : node rendus.mjs <port> <dossier de travail, chemin Windows>
// Sur un profil neuf, sans réseau, environ 3 min 30 en temps réel (`TEMPS=10` : 25 s, mêmes ordres de grandeur).
// Hors registre : une mesure, pas une preuve de neutralité (les comptes varient de quelques unités d'un passage à
// l'autre). Un faux crochet des outils de React (`__REACT_DEVTOOLS_GLOBAL_HOOK__`), posé avant tout script de la page,
// reçoit chaque commit ; l'arbre des fibres y est parcouru, et une fibre de composant compte un rendu quand elle est
// neuve dans l'arbre (clonée pour ce rendu, ou montée) et porte le drapeau « travail fait » (`PerformedWork`, 1).
// Rejeu ×1 d'une course de 400 s à 1 Hz : 60 s carte ouverte, 60 s carte réduite, 60 s sur l'accueil ; une ligne
// par phase et par composant suivi, puis les autres composants les plus rendus.
import { writeFileSync } from 'node:fs';
import { connect } from './lib/cdp.mjs';

const [port, workDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node rendus.mjs <port> <dossier de travail>');
  process.exit(1);
}

/** Composants suivis, dans l'ordre du relevé ; ceux qui n'existent pas d'un côté comptent 0. */
const TRACKED = [
  'AppShell', 'RecordingClock', 'RecordButton', 'RecordingPage', 'RecordingScreen', 'RecordingMap', 'LiveMap',
  'RecordingFigures', 'RecordingGpsCard', 'MarkGuideSlot', 'IntervalBanner',
];
const PHASE_MS = 60000;

const HOOK = `(() => {
  const counts = new Map();
  let previous = new Set();
  let commits = 0;
  const nameOf = (type) => {
    if (typeof type === 'function') return type.displayName || type.name || null;
    if (type && typeof type === 'object' && typeof type.type === 'function') return type.type.displayName || type.type.name || null;
    return null;
  };
  const onCommit = (root) => {
    commits++;
    const seen = new Set();
    const stack = [root.current];
    while (stack.length > 0) {
      const fiber = stack.pop();
      const name = nameOf(fiber.type);
      if (name) {
        seen.add(fiber);
        if (!previous.has(fiber) && (fiber.flags & 1) === 1) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.child) stack.push(fiber.child);
    }
    previous = seen;
  };
  let nextId = 1;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject(renderer) { const id = nextId++; this.renderers.set(id, renderer); return id; },
    onScheduleFiberRoot() {},
    onCommitFiberRoot(_id, root) { try { onCommit(root); } catch (err) { console.debug('[rendus] ' + err); } },
    onPostCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    checkDCE() {},
  };
  window.__rendus = {
    reset() { counts.clear(); commits = 0; },
    read() { return { commits, counts: Object.fromEntries(counts) }; },
  };
})()`;

const { send, evaluate, go, settle, waitFor, wait, vwait, blockNetwork, importFiles, click, clickText, logs, close } =
  await connect({ port, width: 1400, height: 1000 });
await send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
await blockNetwork();

// Course de 400 s à 3 m/s, 1 Hz.
const t0 = Date.parse('2026-01-15T09:00:00Z');
const lat = 43.7;
const mPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
const pts = [];
for (let k = 0; k <= 400; k++) {
  pts.push(`<trkpt lat="${lat}" lon="${(3.85 + (3 * k) / mPerDegLon).toFixed(7)}"><ele>50</ele><time>${new Date(t0 + k * 1000).toISOString()}</time></trkpt>`);
}
const path = `${workDir}\\rendus-course.gpx`;
writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="banc" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Rejeu</name><type>running</type><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`);

await go('/enregistrer', 6000);
console.log('famille À pied :', await clickText('À pied'));
await wait(300);
console.log('activité :', await evaluate(`[...document.querySelectorAll('[aria-pressed="true"], [aria-checked="true"], [aria-selected="true"]')].map((b) => b.textContent.trim()).filter(Boolean).join(' | ')`));
await evaluate(`[...document.querySelectorAll('input[type=radio]')][1].click(); 'ok'`);
await wait(300);
console.log('GPX :', await importFiles(path));
await waitFor(`document.body.innerText.includes('401 points')`, { timeout: 5000, label: 'rejeu chargé' });
console.log('vitesse ×1 :', await evaluate(`(() => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === '600')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '1'); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`));
console.log('Démarrer :', await clickText('Démarrer'));
await vwait(3000);

const phase = async (label) => {
  await evaluate('window.__rendus.reset()');
  await vwait(PHASE_MS);
  const { commits, counts } = await evaluate('window.__rendus.read()');
  console.log(`--- ${label} (${PHASE_MS / 1000} s) : ${commits} commits ---`);
  for (const name of TRACKED) console.log(`${name.padEnd(22)} ${counts[name] ?? 0}`);
  const others = Object.entries(counts).filter(([n]) => !TRACKED.includes(n)).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`autres : ${others.map(([n, c]) => `${n} ${c}`).join(', ')}`);
};

await phase('carte ouverte');
console.log('Réduire la carte :', await clickText('Réduire la carte'));
await vwait(1000);
await phase('carte réduite');
console.log('Accueil :', await click('.shell-brand'));
await vwait(1000);
await phase('accueil');

// Retour à Enregistrer par le lien du haut (sans recharger), arrêt tenu, session jetée.
console.log('Enregistrer :', await click('.shell-toprecord'));
await vwait(1000);
const down = await evaluate(`(() => { const b = [...document.querySelectorAll('button.ui-btn--danger')].find((x) => x.textContent.includes('Arrêter') && !x.disabled); if (!b) return 'absent'; window.__stopButton = b; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); return 'ok'; })()`);
if (down === 'ok') {
  await vwait(2300);
  await evaluate(`(() => { const b = window.__stopButton; b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })); b.click(); return 'ok'; })()`);
}
console.log('Arrêter :', down);
await settle({ max: 3000 });
console.log('Jeter :', await clickText('Jeter'));
await settle({ max: 2000 });

console.log('--- console ---');
for (const l of logs) console.log(l);
await close();
