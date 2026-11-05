// Banc de test : tests de FC repos recopiés dans le dossier mémoire, `fc-repos.json` (lot 173).
// Usage : node fc-repos.mjs <port> [<dossier des captures>]
// Sur un profil neuf (mémoire du navigateur, OPFS), sans réseau. Pas de ceinture : la page joue la FC d'exemple à ×30
// (`?vitesse=30`, 9 s pour le test entier). Le script vérifie :
//  1. un test mené à son terme est écrit dans `fc-repos.json` à la racine du dossier, avec le LISEZMOI qui le cite ;
//  2. la clé de l'appareil (`tracker.restingHr`) vidée, le dossier rouvert : le test revient, dans la clé, dans le
//     fichier (inchangé) et sur la page « Vos tests » ;
//  3. un test posé seulement dans le fichier (autre appareil) vient s'ajouter à celui de l'appareil, et le fichier
//     garde les deux ;
//  4. « Retirer » réécrit le fichier ;
//  5. fichier abîmé : la liste de l'appareil reste, le fichier n'est pas écrasé, et l'enregistrer un test n'échoue pas.
import { connect } from './lib/cdp.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node fc-repos.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

const { evaluate, go, wait, waitFor, settle, blockNetwork, shoot, close, logs } = await connect({ port, width: 1400, height: 1000, shotDir });
const dirJs = `(async () => await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker'))()`;
const readRoot = (name) => evaluate(`(async () => {
  try { return await (await (await (await ${dirJs}).getFileHandle(${JSON.stringify(name)})).getFile()).text(); } catch { return null; }
})()`);
const writeRoot = (name, text) => evaluate(`(async () => {
  const w = await (await (await ${dirJs}).getFileHandle(${JSON.stringify(name)}, { create: true })).createWritable();
  await w.write(${JSON.stringify(text)}); await w.close(); return 'ok';
})()`);
const fileResults = async () => {
  const text = await readRoot('fc-repos.json');
  return text === null ? null : JSON.parse(text).results;
};
const stored = () => evaluate(`JSON.parse(localStorage.getItem('tracker.restingHr') ?? '[]')`);
const clickText = (text, selector = 'button') => evaluate(`(() => {
  const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
  if (!b) return 'absent'; b.click(); return 'ok';
})()`);
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ` : ${detail}` : ''}`);
};

await blockNetwork(['https://*']);

// --- 1. Un test mené à son terme est écrit dans le dossier ---
await go('/fractionne/tests/fc-repos?vitesse=30');
await settle({ max: 3000, label: 'ouverture' });
console.log('exemple ×30 :', await clickText("Essayer avec une FC d'exemple"));
await waitFor(`document.querySelector('.rest-result__bpm')`, { timeout: 20000, label: 'résultat' });
await waitFor(async () => (await fileResults())?.length === 1, { timeout: 5000, label: 'fichier écrit' });
const first = (await stored())[0];
const file1 = await fileResults();
check('fc-repos.json écrit, un test, celui de l\'appareil', file1.length === 1 && file1[0].startedAtMs === first.startedAtMs && file1[0].lowestBpm === first.lowestBpm, JSON.stringify({ n: file1.length }));
check('le LISEZMOI cite le fichier', /fc-repos\.json/.test((await readRoot('LISEZMOI.txt')) ?? ''), '');
const fileText1 = await readRoot('fc-repos.json');

// --- 2. Clé de l'appareil vidée, dossier rouvert ---
await evaluate(`localStorage.removeItem('tracker.restingHr')`);
check('clé vidée', (await stored()).length === 0, '');
await go('/fractionne/tests/fc-repos');
await waitFor(async () => (await stored()).length === 1, { timeout: 8000, label: 'résultats revenus' });
const back = (await stored())[0];
check('résultats revenus dans la clé de l\'appareil', back.startedAtMs === first.startedAtMs && back.series.length === first.series.length, '');
check('fichier inchangé (rien à réécrire)', (await readRoot('fc-repos.json')) === fileText1, '');
await waitFor(`/Vos tests/i.test(document.querySelector('.ui-page')?.innerText ?? '')`, { timeout: 4000, label: 'Vos tests' });
check('la page montre « Vos tests »', true, '');
await shoot('fc-repos-revenus');

// --- 3. Un test d'un autre appareil, posé dans le fichier seulement ---
const other = { ...first, startedAtMs: first.startedAtMs - 86_400_000, lowestBpm: first.lowestBpm + 3 };
await writeRoot('fc-repos.json', JSON.stringify({ format: 'tracker-fc-repos', version: 1, results: [first, other] }));
await go('/fractionne/tests/fc-repos');
await waitFor(async () => (await stored()).length === 2, { timeout: 8000, label: 'fusion' });
check('test de l\'autre appareil repris', (await stored()).some((r) => r.startedAtMs === other.startedAtMs), '');
check('fichier à deux tests', (await fileResults()).length === 2, '');

// --- 4. Retirer réécrit le fichier ---
await waitFor(`document.querySelectorAll('.rest-history__item').length === 2`, { timeout: 4000, label: 'deux lignes' });
console.log('retirer :', await evaluate(`(() => { const b = [...document.querySelectorAll('.rest-history button')].find((x) => x.textContent.trim() === 'Retirer'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await waitFor(async () => (await fileResults())?.length === 1, { timeout: 4000, label: 'fichier réécrit' });
check('un test retiré, le fichier n\'en garde qu\'un', (await stored()).length === 1 && (await fileResults()).length === 1, '');

// --- 5. Fichier abîmé ---
await writeRoot('fc-repos.json', '{ cassé');
await go('/fractionne/tests/fc-repos?vitesse=30');
await settle({ max: 3000, label: 'ouverture, fichier abîmé' });
check('fichier abîmé : liste de l\'appareil gardée', (await stored()).length === 1, '');
check('fichier abîmé : jamais écrasé', (await readRoot('fc-repos.json')) === '{ cassé', '');
console.log('exemple ×30 :', await clickText("Essayer avec une FC d'exemple"));
await waitFor(`document.querySelector('.rest-result__bpm')`, { timeout: 20000, label: 'résultat' });
check('un test enregistré sur l\'appareil malgré le fichier abîmé', (await stored()).length === 2, '');
check('fichier abîmé toujours intact', (await readRoot('fc-repos.json')) === '{ cassé', '');
await wait(300);

console.log(logs.length ? `console :\n${[...new Set(logs)].join('\n')}` : 'console : aucune erreur');
console.log(failures === 0 ? 'tout passe' : `${failures} échec(s)`);
await close();
