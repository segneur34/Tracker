// Banc de test : les tuiles de la carte sont gardées dans le Cache API de la page, puis relues sans réseau.
// Usage : node exe-tuiles.mjs <port>
// Prévu pour le programme Windows (`passe.mjs --exe`, où la page est servie en `https` par la coquille et où le Cache API
// refuse les adresses qui ne sont ni `http` ni `https`), joué aussi sous Chrome pour comparaison. Profil neuf, aucun
// réseau réel : l'adresse des tuiles de Réglages (clé `tracker.tileUrls`) pointe sur `favicon.png`, un fichier de l'application
// elle-même (la coquille ne voit pas les fausses réponses de `lib/tuiles.mjs`, qui passent par `Fetch`). Le script :
//  1. importe une session de voile et ouvre son analyse : la carte demande ses tuiles ;
//  2. compte les entrées du cache des tuiles (`tracker-tuiles`) : elles y sont rangées ;
//  3. coupe ces adresses (`Network.setBlockedURLs`), relance l'analyse : la carte se dessine encore, depuis le cache.
import { BLOCKED_URLS, connect, diag } from './lib/cdp.mjs';
import { traceDroite } from './lib/traces.mjs';

const [port] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node exe-tuiles.mjs <port>');
  process.exit(1);
}

const MOTIF_TUILES = '*favicon.png?tuile=*';
// Noms de l'application : cache des tuiles (`platform/tileCache.ts`, `CACHE_NAME`) et adresses choisies (`URL_STORAGE_KEY`).
const CACHE_TUILES = 'tracker-tuiles';
const CLE_ADRESSES = 'tracker.tileUrls';
const b = await connect({ port, width: 1200, height: 900 });
const { evaluate, go, settle, waitFor, wait, blockNetwork, importGpx, records, check, finish, logs, onMessage } = b;
let demandees = 0;
let refusees = 0;
const adresses = new Map();
onMessage((msg) => {
  const p = msg.params;
  if (msg.method === 'Network.requestWillBeSent' && p.request.url.includes('favicon.png?tuile=')) { demandees++; adresses.set(p.requestId, p.request.url); }
  else if (msg.method === 'Network.loadingFailed' && adresses.has(p.requestId)) refusees++;
});
await blockNetwork(BLOCKED_URLS);

const entrees = () => evaluate(`(async () => { const c = await caches.open(${JSON.stringify(CACHE_TUILES)}); return (await c.keys()).length; })()`);
const imagesDessinees = () => evaluate(`document.querySelectorAll('.an-map-frame img.leaflet-tile-loaded').length`);

await go('/voile', 3000);
// Les tuiles viennent d'un fichier de l'application, à l'adresse de la page.
await evaluate(`localStorage.setItem(${JSON.stringify(CLE_ADRESSES)}, JSON.stringify({ plan: location.origin + '/favicon.png?tuile={z}-{x}-{y}' }))`);
console.log('import :', await importGpx(traceDroite({ debutMs: Date.UTC(2026, 9, 1, 7, 0, 0), secondes: 600, vitesse: 3.2, type: 'wingfoil', nom: 'Dix minutes', lat0: 43.62, lon0: 3.86 }), 'tuiles.gpx'));
const fiche = await waitFor(async () => (await records())?.[0], { timeout: 6000, label: 'fiche' });
await settle({ max: 2000, label: 'import' });
check('session rangée', Boolean(fiche));

await go(`/voile/analyse?session=${encodeURIComponent(fiche?.gpx ?? '')}`, 7000);
await waitFor(() => demandees > 0, { timeout: 8000, every: 100, label: 'tuiles demandées' });
await waitFor(async () => (await entrees()) > 0, { timeout: 8000, every: 200, label: 'tuiles rangées' });
await settle({ max: 2000, label: 'carte' });
// Le nombre exact d'entrées dépend de l'instant du relevé (les écritures suivent les réponses) : il va sur la sortie d'erreur.
const gardees = await entrees();
diag(`tuiles demandées : ${demandees} ; entrées du cache : ${gardees}`);
console.log(`images dessinées : ${await imagesDessinees()}`);
check('la carte a demandé des tuiles à l\'adresse réglée', demandees > 0);
check('des tuiles sont rangées dans le Cache API', gardees > 0, gardees > 0 ? 'oui' : 'aucune');
const cle = await evaluate(`(async () => { const c = await caches.open(${JSON.stringify(CACHE_TUILES)}); return (await c.keys())[0]?.url ?? '(aucune)'; })()`);
console.log('clés du cache :', cle.replace(/^https?:\/\/[^/]+/, 'HOTE').replace(/[^/]+$/, '…'));

await blockNetwork([...BLOCKED_URLS, MOTIF_TUILES]);
demandees = 0;
await go(`/voile/analyse?session=${encodeURIComponent(fiche?.gpx ?? '')}`, 7000);
await wait(3000);
const horsReseau = await imagesDessinees();
console.log(`hors réseau : ${horsReseau} images dessinées`);
diag(`hors réseau : ${demandees} requêtes de tuiles, dont ${refusees} refusées au total`);
check('hors réseau, la carte se dessine encore depuis le cache', horsReseau > 0, String(horsReseau));

console.log('\n--- console (erreurs, avertissements) ---');
logs.forEach((l) => console.log(l));
await finish('Tout passe.');
