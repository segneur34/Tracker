// Banc de test : l'import de fichiers du disque (`DOM.setFileInputFiles`, chemins Windows), les deux voies qu'un essai au
// programme Windows doit couvrir.
// Usage : node exe-import.mjs <port> <dossier de travail, chemin Windows>
// Profil neuf, sans réseau. Les traces sont fabriquées dans le dossier de travail (`lib/traces.mjs`). Le script, sur la
// bibliothèque de la voile :
//  1. donne trois fichiers GPX au champ des GPX (« Importer des GPX ou FIT ») : trois sessions ajoutées ;
//  2. donne trois autres GPX, en une seule liste, au champ « dossier » (`webkitdirectory`, « Ajouter les sessions d'un
//     dossier »), comme le ferait un essai qui lui passe tout le contenu d'un dossier : relève le nombre de fichiers que le
//     champ garde et ce que l'application en fait.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from './lib/cdp.mjs';
import { traceDroite } from './lib/traces.mjs';

const [port, workDir] = process.argv.slice(2);
if (!port || !workDir) {
  console.error('Usage : node exe-import.mjs <port> <dossier de travail>');
  process.exit(1);
}

const { evaluate, go, settle, waitFor, blockNetwork, importFiles, records, check, finish, logs } = await connect({ port, width: 1400, height: 1000 });
await blockNetwork();

/** Écrit `n` GPX de voile (un jour de départ chacun, à partir de `jour0`) dans `dossier`, rend leurs chemins. */
const ecrire = (dossier, jour0, n) => {
  mkdirSync(dossier, { recursive: true });
  return Array.from({ length: n }, (_, k) => {
    const chemin = join(dossier, `trace-${jour0 + k}.gpx`);
    writeFileSync(chemin, traceDroite({ debutMs: Date.UTC(2026, 8, jour0 + k, 8, 0, 0), secondes: 300, vitesse: 4, type: 'wingfoil', nom: `Trace ${jour0 + k}`, lat0: 43.6 + k * 0.01 }));
    return chemin;
  });
};
const phrase = async () => {
  await waitFor(`/ajoutée|déjà présente|laissée de côté|illisible/.test(document.body.innerText)`, { timeout: 8000, label: 'compte rendu' });
  await settle({ max: 2000, label: 'import' });
  return (await evaluate(`document.body.innerText.split('\\n').find((l) => /ajoutée|déjà présente|laissée de côté|illisible/.test(l)) ?? '(aucune phrase)'`)).replace(/ FERMER$/, '');
};
const gardes = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.files.length ?? -1`);

await go('/voile', 4000);

console.log('\n== 1. Trois fichiers au champ des GPX');
const CHAMP_GPX = 'input[type=file][accept*=".gpx"]';
console.log('champ :', await importFiles(ecrire(join(workDir, 'fichiers'), 1, 3), CHAMP_GPX));
console.log('fichiers gardés par le champ :', await gardes(CHAMP_GPX));
const p1 = await phrase();
console.log(p1);
await waitFor(async () => (await records()).length >= 3, { timeout: 6000, label: '3 fiches' });
await settle({ max: 1500, label: 'fiches' });
check('trois sessions ajoutées', /^3 sessions ajoutées\./.test(p1) && (await records()).length === 3, p1);

console.log('\n== 2. Une liste de fichiers au champ « dossier »');
await go('/voile', 4000);
const CHAMP_DOSSIER = 'input[type=file][webkitdirectory]';
console.log('champ :', await importFiles(ecrire(join(workDir, 'dossier'), 11, 3), CHAMP_DOSSIER));
const nGardes = await gardes(CHAMP_DOSSIER);
console.log('fichiers gardés par le champ :', nGardes);
if (nGardes > 0) {
  const p2 = await phrase();
  console.log(p2);
  await waitFor(async () => (await records()).length >= 6, { timeout: 6000, label: '6 fiches' });
  check('trois sessions de plus par le champ « dossier »', /^3 sessions ajoutées\./.test(p2) && (await records()).length === 6, p2);
} else {
  console.log('le champ « dossier » ne garde aucun fichier : rien à importer par cette voie');
}

console.log('\n--- console (erreurs, avertissements) ---');
logs.forEach((l) => console.log(l));
await finish('Tout passe.');
