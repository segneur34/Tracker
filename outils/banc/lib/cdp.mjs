// Banc de test : bibliothèque commune du protocole DevTools (lot 76, n° 90).
// Une seule mise en route pour tous les scripts : onglet, console, dialogues, attente d'une page prête au lieu d'un
// sommeil fixe, import de GPX, lecture des fiches, captures, contrôles. Mode d'emploi : LISEZMOI, « Bibliothèque ».
// Les diagnostics (durées des attentes, durée totale) vont sur stderr, jamais sur stdout : la sortie standard d'un
// script sert à prouver la neutralité d'un changement. `BANC_DIAG=0` les coupe.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMPS, horlogeScript } from './horloge.mjs';

/** Adresse de l'application ; `BASE` la remplace (par exemple `http://127.0.0.1:4191`). */
export const BASE = process.env.BASE ?? 'http://localhost:5173';
export { TEMPS };

/** Domaines bloqués d'ordinaire : relief de l'IGN, Overpass, tuiles, BRouter, imagerie satellite. */
export const BLOCKED_URLS = ['*://data.geopf.fr/*', '*://overpass-api.de/*', '*://*.openstreetmap.org/*', '*://brouter.de/*', '*://server.arcgisonline.com/*'];

const DIAG = process.env.BANC_DIAG !== '0';
/** Ligne de diagnostic, sur stderr. */
export const diag = (text) => { if (DIAG) process.stderr.write(`[banc] ${text}\n`); };

/** Vrai temps, en millisecondes. */
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Temps de la page : `ms / TEMPS` de vrai temps (horloge accélérée, lib/horloge.mjs). */
export const vwait = (ms) => wait(ms / TEMPS);

/** Attente d'une réponse du navigateur au-delà de laquelle la sortie d'erreur le dit (la moitié du délai du lanceur). */
const SILENT_REPLY_MS = 5 * 60000;
/** Délai au-delà duquel un minuteur de la page ne retient plus `settle` (une minuterie de fond, un délai réseau). */
const SHORT_TIMER_MS = 1000;
/** Requêtes attendues par `settle` : pas les images (tuiles de la carte, qui peuvent traîner) ni les flux. */
const WAITED_TYPES = new Set(['Document', 'Stylesheet', 'Script', 'Font', 'XHR', 'Fetch']);

// Script de page, posé avant tout autre dans chaque document : ce que `settle` attend.
const PAGE_SCRIPT = `(() => {
  if (window.__banc) return;
  const realNow = performance.now.bind(performance);
  const realSetTimeout = window.setTimeout;
  const realClearTimeout = window.clearTimeout;
  const banc = {
    doc: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Math.random()).slice(2) + String(realNow()),
    fetches: 0,
    timers: new Set(),
    lastMutation: realNow(),
    now: realNow,
    setTimeout: realSetTimeout,
  };
  Object.defineProperty(window, '__banc', { value: banc, enumerable: false });
  // Fetch en vol.
  const realFetch = window.fetch;
  window.fetch = function (...args) {
    banc.fetches++;
    let p;
    try { p = realFetch.apply(window, args); } catch (err) { banc.fetches--; throw err; }
    const done = () => { banc.fetches--; };
    p.then(done, done);
    return p;
  };
  // Minuteurs courts en attente (setInterval exclu : une minuterie de fond n'empêche pas une page d'être prête).
  window.setTimeout = function (fn, ms, ...rest) {
    if (typeof fn !== 'function' || (Number(ms) || 0) > ${SHORT_TIMER_MS}) return realSetTimeout(fn, ms, ...rest);
    const id = realSetTimeout(function (...a) { banc.timers.delete(id); return fn.apply(this, a); }, ms, ...rest);
    banc.timers.add(id);
    return id;
  };
  window.clearTimeout = function (id) { banc.timers.delete(id); return realClearTimeout(id); };
  // Heure réelle de la dernière mutation du DOM.
  new MutationObserver(() => { banc.lastMutation = realNow(); })
    .observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
})();`;

/**
 * Marqueur des requêtes de lieu d'une session (`PLACE_QUERY_MARK` de `src/planning/placeQuery.ts`, même texte,
 * vérifié par `placeQuery.test.ts`).
 */
export const PLACE_QUERY_MARK = '/*tracker-lieu*/';

// Script de page, posé après PAGE_SCRIPT sauf avec `lieux: true` : une requête de lieu (lot 215) échoue tout de suite,
// comme hors ligne, sans partir sur le réseau ; les autres requêtes (Overpass pour le revêtement compris) passent.
const LIEUX_SCRIPT = `(() => {
  const mark = ${JSON.stringify(PLACE_QUERY_MARK)};
  const next = window.fetch;
  window.fetch = function (input, init) {
    const body = init && init.body;
    const text = body instanceof URLSearchParams ? (body.get('data') ?? '') : typeof body === 'string' ? body : '';
    if (text.includes(mark)) return Promise.reject(new TypeError('Failed to fetch'));
    return next.apply(this, arguments);
  };
})();`;

const STATE = `(() => { const b = window.__banc; if (!b) return null; return { doc: b.doc, ready: document.readyState, mounted: (document.getElementById('root')?.childElementCount ?? 1) > 0, fetches: b.fetches, timers: b.timers.size, last: b.lastMutation, quiet: b.now() - b.lastMutation }; })()`;
// Deux images, et au plus 500 ms de vrai temps si la page n'en dessine pas.
const TWO_FRAMES = `new Promise((r) => { let done = false; const f = () => { if (!done) { done = true; r(true); } }; requestAnimationFrame(() => requestAnimationFrame(f)); (window.__banc?.setTimeout ?? setTimeout)(f, 500); })`;

/**
 * Programme Windows dont la mémoire est un dossier du disque (`TRACKER_MEMOIRE`, posée par le lanceur) : les scripts qui
 * lisent ou écrivent la mémoire par `navigator.storage.getDirectory()` y trouveraient l'OPFS, vide. Leur expression est
 * réécrite (`evaluate`) pour appeler `window.__bancMemoire()`, une racine qui ressemble à celle de l'OPFS : le dossier
 * `Tracker` est celui du disque, lu et écrit par le pont de la coquille (comme le fait l'application) ; tout autre nom va
 * à l'OPFS réel. Réservé aux expressions des scripts : l'application, elle, ne voit pas cette racine.
 */
const MEMOIRE_DISQUE_SCRIPT = `(() => {
  const pont = window.trackerBureau?.memoire;
  if (window.__bancMemoire || !pont) return;
  const appel = async (nom, argument) => {
    const r = await pont[nom]({ racine: 'memoire', ...argument });
    if (!r.ok) throw new DOMException(r.message, r.code === 'NOT_FOUND' ? 'NotFoundError' : 'InvalidStateError');
    return r.valeur;
  };
  const absent = (nom) => new DOMException('absent : ' + nom, 'NotFoundError');
  const enfant = (chemin, nom) => (chemin ? chemin + '/' + nom : nom);
  const octets = (o) => o.buffer.slice(o.byteOffset, o.byteOffset + o.byteLength);
  const fichier = (chemin, nom) => ({
    kind: 'file', name: nom,
    async getFile() {
      const c = enfant(chemin, nom);
      const s = await appel('stat', { chemin: c });
      if (!s) throw absent(nom);
      return {
        name: nom, size: s.size, lastModified: s.mtimeMs,
        text: async () => (await appel('lireTexte', { chemin: c })) ?? '',
        arrayBuffer: async () => octets(await appel('lireOctets', { chemin: c })),
        slice: (a, b) => ({ arrayBuffer: async () => octets(await appel('lireOctets', { chemin: c })).slice(a, b) }),
      };
    },
    async createWritable() {
      const c = enfant(chemin, nom);
      const parties = [];
      return {
        write: async (donnees) => { parties.push(donnees); },
        close: async () => {
          if (parties.every((p) => typeof p === 'string')) await appel('ecrireTexte', { chemin: c, texte: parties.join('') });
          else {
            const morceaux = await Promise.all(parties.map(async (p) => (typeof p === 'string' ? new TextEncoder().encode(p) : p instanceof Uint8Array ? p : new Uint8Array(await new Blob([p]).arrayBuffer()))));
            const tout = new Uint8Array(morceaux.reduce((n, m) => n + m.length, 0));
            let at = 0;
            for (const m of morceaux) { tout.set(m, at); at += m.length; }
            await appel('ecrireOctets', { chemin: c, octets: tout });
          }
        },
      };
    },
  });
  const dossier = (chemin, nom) => {
    const liste = () => appel('lister', { chemin });
    const poignee = (e) => (e.kind === 'directory' ? dossier(enfant(chemin, e.name), e.name) : fichier(chemin, e.name));
    return {
      kind: 'directory', name: nom,
      async getDirectoryHandle(n, option) {
        const e = (await liste()).find((x) => x.name === n);
        if (e && e.kind === 'directory') return dossier(enfant(chemin, n), n);
        if (e) throw new DOMException('pas un dossier : ' + n, 'TypeMismatchError');
        if (option && option.create) return dossier(enfant(chemin, n), n);
        throw absent(n);
      },
      async getFileHandle(n, option) {
        const e = (await liste()).find((x) => x.name === n);
        if (e && e.kind === 'file') return fichier(chemin, n);
        if (e) throw new DOMException('pas un fichier : ' + n, 'TypeMismatchError');
        if (option && option.create) return fichier(chemin, n);
        throw absent(n);
      },
      async *entries() { for (const e of await liste()) yield [e.name, poignee(e)]; },
      async *keys() { for (const e of await liste()) yield e.name; },
      async removeEntry(n) { await appel('effacer', { chemin: enfant(chemin, n) }); },
    };
  };
  const reel = () => navigator.storage.getDirectory();
  window.__bancMemoire = () => ({
    kind: 'directory', name: '',
    getDirectoryHandle: async (n, option) => (n === 'Tracker' ? dossier('', n) : (await reel()).getDirectoryHandle(n, option)),
    getFileHandle: async (n, option) => (await reel()).getFileHandle(n, option),
    removeEntry: async (n, option) => (n === 'Tracker' ? undefined : (await reel()).removeEntry(n, option)),
    entries: () => ({ [Symbol.asyncIterator]: async function* () { const r = await reel(); for await (const e of r.entries()) yield e; } }),
  });
})()`;
const MEMOIRE_DISQUE = Boolean(process.env.TRACKER_MEMOIRE);
/** L'expression d'un script, réécrite pour la mémoire du disque ; inchangée ailleurs. Pour les scripts qui ont leur propre `Runtime.evaluate`. */
export const pourMemoire = (expression) => (MEMOIRE_DISQUE ? expression.replaceAll('navigator.storage.getDirectory()', 'window.__bancMemoire()') : expression);

/** Connexion minimale au protocole (celle du navigateur, pour le contexte isolé). */
const openSocket = async (url) => {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
  return { send, close: () => ws.close() };
};

/**
 * Ouvre un onglet sur le Chrome du port `port` (ou se branche sur `process.env.BANC_WS`), active la console, les
 * dialogues acceptés d'office, le script de page et, si `TEMPS` > 1, l'horloge accélérée.
 * Options : `width` et `height` (fenêtre d'ordinateur, sinon celle de Chrome), `shotDir` (dossier des captures),
 * `logEntries` (ajoute aux erreurs de console celles du journal du navigateur, `Log.entryAdded`), `isolated` (essai :
 * l'onglet dans un contexte de navigation neuf, `Target.createBrowserContext`, stockages vides comme un profil
 * neuf, jeté à la fermeture ; `BANC_CONTEXTE=1` l'impose ; pas le défaut).
 */
// `lieux` : laisser partir les requêtes de lieu des sessions (lot 215), que le banc fait échouer d'ordinaire (`LIEUX_SCRIPT`).
// `horlogeVariable` (lot 235) : horloge dont le facteur se lit et se change en route par `window.__bancFacteur` (`lib/horloge.mjs`), même sans `TEMPS` ; hors cette option, rien ne change.
// `ignorerWorkers` (lot 250-0, repris du lot 535 de Gtracker) : vrai sur une page à laquelle on s'attache (`BANC_WS`, le
// programme Windows), faux sur un onglet ouvert ici (le banc du navigateur) : `settle` n'y attend plus le script principal
// d'un worker, dont la fin ne lui parvient jamais. Sur une page à laquelle on s'attache, le script de page est aussi posé
// dans le document déjà chargé.
export const connect = async ({ port, base = BASE, width, height, shotDir, logEntries = false, isolated = process.env.BANC_CONTEXTE === '1', lieux = false, horlogeVariable = false, ignorerWorkers = Boolean(process.env.BANC_WS) } = {}) => {
  const startedAt = Date.now();
  const ownTab = !process.env.BANC_WS;
  if (ownTab && !port) throw new Error('connect : port Chrome manquant');
  let browser = null;
  let contextId = null;
  let wsUrl = process.env.BANC_WS;
  if (ownTab && isolated) {
    browser = await openSocket((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);
    contextId = (await browser.send('Target.createBrowserContext', { disposeOnDetach: true })).result.browserContextId;
    const { targetId } = (await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: contextId })).result;
    wsUrl = `ws://127.0.0.1:${port}/devtools/page/${targetId}`;
    diag(`contexte isolé ${contextId}`);
  } else if (ownTab) {
    wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()).webSocketDebuggerUrl;
  }
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const logs = [];
  const listeners = new Set();
  // Requêtes du document en cours qui retiennent `settle` (modules chargés à la demande compris), par identifiant.
  const requests = new Map();
  let loaderId = null;

  // Une commande sans réponse (page figée) bloquait le script jusqu'au délai du lanceur sans rien dire (25/11) :
  // la sortie d'erreur le nomme, sans rien changer au déroulé.
  const send = (method, params = {}) => new Promise((resolve) => {
    const i = ++id;
    const muette = setTimeout(() => process.stderr.write(`cdp : ${method} sans réponse depuis ${SILENT_REPLY_MS / 60000} min (page figée ?)\n`), SILENT_REPLY_MS);
    muette.unref();
    pending.set(i, (msg) => { clearTimeout(muette); resolve(msg); });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    const p = msg.params;
    switch (msg.method) {
      case 'Runtime.exceptionThrown':
        logs.push(`EXCEPTION: ${(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).split('\n')[0]}`);
        break;
      case 'Runtime.consoleAPICalled':
        if (['error', 'warning'].includes(p.type)) logs.push(`${p.type}: ${p.args.map((a) => a.value ?? a.description).join(' ').split('\n')[0].slice(0, 300)}`);
        break;
      case 'Log.entryAdded':
        if (logEntries && ['error', 'warning'].includes(p.entry.level)) logs.push(`log ${p.entry.level}: ${p.entry.text.split('\n')[0].slice(0, 300)}`);
        break;
      case 'Page.javascriptDialogOpening':
        send('Page.handleJavaScriptDialog', { accept: true });
        break;
      case 'Page.frameNavigated':
        if (!p.frame.parentId) {
          loaderId = p.frame.loaderId;
          for (const [rid, r] of requests) if (r.loaderId !== loaderId) requests.delete(rid);
        }
        break;
      case 'Network.requestWillBeSent':
        // Script principal d'un worker (`new Worker`, le calcul de fond de `library/trackWorkerClient.ts`) : sans `loaderId`,
        // sa fin n'est annoncée qu'à la session du worker, où le banc ne s'attache pas. Compté, il retiendrait `settle`
        // jusqu'à son plafond tant que le document vit (2 à 3 s à chaque visite d'une bibliothèque, mesuré le 27/11).
        if (ignorerWorkers && !p.loaderId && p.type === 'Script') break;
        if (WAITED_TYPES.has(p.type)) requests.set(p.requestId, { loaderId: p.loaderId, url: p.request.url });
        break;
      case 'Network.loadingFinished':
      case 'Network.loadingFailed':
        requests.delete(p.requestId);
        break;
      default:
    }
    for (const l of listeners) l(msg);
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  // Connexion coupée par le navigateur : Node ne disait que « unsettled top-level await » (code 13).
  ws.addEventListener('close', () => { if (pending.size > 0) process.stderr.write(`cdp : connexion au navigateur fermée, ${pending.size} commande(s) sans réponse\n`); });

  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_SCRIPT });
  if (!lieux) await send('Page.addScriptToEvaluateOnNewDocument', { source: LIEUX_SCRIPT });
  if (MEMOIRE_DISQUE) {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: MEMOIRE_DISQUE_SCRIPT });
    await send('Runtime.evaluate', { expression: MEMOIRE_DISQUE_SCRIPT });
  }
  if (TEMPS > 1 || horlogeVariable) {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: horlogeScript(TEMPS, startedAt, { variable: horlogeVariable }) });
    diag(`horloge de la page ×${TEMPS}${horlogeVariable ? ' (facteur variable, window.__bancFacteur)' : ''}`);
  }
  if (width && height) await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  /** Valeur d'une expression de la page (promesse attendue) ; `undefined` si elle lève. */
  /** Valeur de l'expression dans la page ; `undefined` si elle lève (l'exception va sur stderr), jamais un objet vide. */
  const evaluate = async (expression) => {
    const r = (await send('Runtime.evaluate', { expression: pourMemoire(expression), returnByValue: true, awaitPromise: true })).result;
    if (r?.exceptionDetails) {
      diag(`evaluate : ${r.exceptionDetails.exception?.description?.split(String.fromCharCode(10))[0] ?? r.exceptionDetails.text}`);
      return undefined;
    }
    return r?.result?.value;
  };

  // Page déjà chargée, à laquelle on s'attache (le programme Windows) : son document n'a pas le script de page, posé pour
  // les documents à venir seulement, et tout `settle` irait à son plafond (« pas de script de page »). Il y est posé
  // maintenant (sans effet s'il y est déjà) ; il ne voit ni les fetch ni les minuteurs lancés avant lui. L'horloge
  // accélérée, elle, ne s'y pose pas : elle ne vaut que pour les documents à venir, comme avant.
  if (!ownTab) await evaluate(PAGE_SCRIPT);

  // Le premier contexte audio du navigateur s'ouvre en 0,6 s de vrai temps (les suivants en 15 ms, mesuré le 29/10) : sous l'horloge
  // accélérée, le premier son de l'application figerait la page plusieurs secondes (×TEMPS). Il est ouvert ici, une fois par onglet.
  if (TEMPS > 1 || horlogeVariable) await evaluate(`(() => { try { new AudioContext().close(); } catch {} return 'ok'; })()`);

  /**
   * Attend une page prête : document chargé, racine React non vide (sous charge, le premier rendu peut suivre le
   * chargement), aucun fetch ni requête en vol, aucun minuteur d'au plus 1 s en attente, DOM immobile depuis `quiet` ms,
   * puis deux images. Plafond `max` (l'ancien sommeil fixe du script). Rend la durée.
   */
  const settle = async ({ max = 3000, quiet = 150, label = '' } = {}) => {
    const t0 = Date.now();
    const at = label ? ` ${label}` : '';
    let state = null;
    while (Date.now() - t0 < max) {
      state = await evaluate(STATE);
      if (state && state.ready === 'complete' && state.mounted && state.fetches === 0 && state.timers === 0 && requests.size === 0 && state.quiet >= quiet) {
        await evaluate(TWO_FRAMES);
        const after = await evaluate(STATE);
        if (after && after.doc === state.doc && after.last === state.last && after.timers === 0 && after.fetches === 0 && requests.size === 0) {
          const ms = Date.now() - t0;
          diag(`settle${at} ${ms} ms (plafond ${max})`);
          return ms;
        }
      }
      await wait(50);
    }
    const why = state
      ? `document ${state.ready}${state.mounted ? '' : ', racine vide'}, ${state.fetches} fetch, ${requests.size} requête(s)${requests.size ? ` dont ${[...requests.values()][0].url.slice(0, 120)}` : ''}, ${state.timers} minuteur(s), DOM immobile depuis ${Math.round(state.quiet)} ms`
      : 'pas de script de page';
    diag(`settle${at} plafond ${max} ms atteint (${why})`);
    return Date.now() - t0;
  };

  /** Navigue vers `path` (relatif à `base`, ou adresse entière), attend le nouveau document puis `settle`, en `max` ms au plus. */
  const go = async (path, max = 3000) => {
    const t0 = Date.now();
    const before = await evaluate(`window.__banc?.doc ?? null`);
    await send('Page.navigate', { url: /^[a-z]+:/i.test(path) ? path : `${base}${path}` });
    while (Date.now() - t0 < max) {
      const doc = await evaluate(`window.__banc?.doc ?? null`);
      if (doc && doc !== before) break;
      await wait(50);
    }
    return settle({ max: Math.max(0, max - (Date.now() - t0)), label: path });
  };

  /**
   * Évalue `expr` (expression de la page, ou fonction de Node, asynchrone ou non) jusqu'à une valeur vraie, tous
   * les `every` ms ; à l'échéance, rend la dernière valeur sans lever : le `check` du script dit l'échec.
   */
  const waitFor = async (expr, { timeout = 5000, every = 100, label = '' } = {}) => {
    const t0 = Date.now();
    let value;
    for (;;) {
      value = typeof expr === 'function' ? await expr() : await evaluate(expr);
      if (value) { if (label) diag(`waitFor ${label} ${Date.now() - t0} ms (plafond ${timeout})`); return value; }
      if (Date.now() - t0 >= timeout) break;
      await wait(every);
    }
    diag(`waitFor ${label || '(sans nom)'} plafond ${timeout} ms atteint`);
    return value;
  };

  /** Bloque les adresses données (motifs de `Network.setBlockedURLs`) ; le réseau est déjà activé par `connect`. */
  const blockNetwork = (urls = BLOCKED_URLS) => send('Network.setBlockedURLs', { urls });

  /**
   * Importe un GPX par le champ de fichier de la page (`File` et `DataTransfer`) : 'ok' ou 'absent'. L'écriture en
   * mémoire (OPFS) ne touche ni au DOM ni au réseau : suivre d'un `waitFor` sur `records()`.
   */
  // Le champ de fichier n'est monté qu'une fois la bibliothèque relue depuis l'OPFS, ce que `settle` ne voit pas
  // (ni DOM ni réseau) : on l'attend jusqu'à 3 s avant d'importer, sinon « absent » comme avant.
  const champFichier = (selector) => waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, { timeout: 3000, every: 50 });

  const importGpx = async (text, name, selector = 'input[type=file][accept*=".gpx"]') => {
    if (!(await champFichier(selector))) return 'absent';
    return evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) return 'absent';
      const dt = new DataTransfer();
      dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: 'application/gpx+xml' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
  };

  /** Donne des fichiers du disque (chemins Windows) au champ `selector` (`DOM.setFileInputFiles`) : 'ok' ou 'absent'. Même suite que `importGpx`. */
  const importFiles = async (files, selector = 'input[type=file][accept*=".gpx"]') => {
    if (!(await champFichier(selector))) return 'absent';
    const { result: { root } } = await send('DOM.getDocument', { depth: -1 });
    const found = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!found.result?.nodeId) return 'absent';
    await send('DOM.setFileInputFiles', { nodeId: found.result.nodeId, files: Array.isArray(files) ? files : [files] });
    return 'ok';
  };

  /**
   * Fiches JSON du dossier `Tracker/sessions` de la mémoire du navigateur (OPFS) ; dans le programme Windows prêt d'avance
   * sur un dossier du disque (`TRACKER_MEMOIRE`, posé par le lanceur), celles de ce dossier, lues par Node.
   */
  const records = async () => {
    const dossier = process.env.TRACKER_MEMOIRE;
    if (!dossier) return recordsOpfs();
    const list = [];
    let noms = [];
    try { noms = readdirSync(join(dossier, 'sessions')); } catch { return list; }
    for (const nom of noms) {
      if (!nom.endsWith('.json')) continue;
      try { list.push(JSON.parse(readFileSync(join(dossier, 'sessions', nom), 'utf8'))); } catch { /* fiche en cours d'écriture : au prochain tour */ }
    }
    return list;
  };
  const recordsOpfs = async () => (await evaluate(`(async () => {
    let dir;
    try { dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Tracker')).getDirectoryHandle('sessions'); } catch { return []; }
    const list = [];
    for await (const [name, h] of dir.entries()) {
      if (!name.endsWith('.json')) continue;
      try { list.push(JSON.parse(await (await h.getFile()).text())); } catch { /* fiche en cours d'écriture : au prochain tour */ }
    }
    return list;
  })()`)) ?? [];

  /** Texte de la page. */
  const dumpText = () => evaluate(`document.body.innerText`);

  /** Capture `<shotDir>/<name>.png` ; sans nom, dans le fichier `SHOT`. Rien sans dossier ni `SHOT`. */
  const shoot = async (name) => {
    const file = name ? (shotDir ? `${shotDir}/${name}.png` : null) : process.env.SHOT;
    if (!file) return;
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
  };

  /** Événement de souris, bouton gauche (`mousePressed`, `mouseMoved`, `mouseReleased`). */
  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });

  /**
   * Clique un élément : un sélecteur CSS, ou une expression de la page qui rend l'élément (elle commence par
   * `(`, `[` ou contient `document`). 'ok', 'absent' ou 'désactivé'.
   */
  const click = (target) => {
    const el = /^[([]|document/.test(target.trim()) ? `(${target})` : `document.querySelector(${JSON.stringify(target)})`;
    return evaluate(`(() => { const b = ${el}; if (!b) return 'absent'; if (b.disabled) return 'désactivé'; b.click(); return 'ok'; })()`);
  };
  /** Clique le premier `selector` dont le texte, sans blancs autour, vaut `text` : 'ok', 'absent' ou 'désactivé'. */
  const clickText = (text, selector = 'button') => evaluate(`(() => {
    const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
    if (!b) return 'absent'; if (b.disabled) return 'désactivé'; b.click(); return 'ok';
  })()`);

  let failures = 0;
  /** Ligne « ok » ou « ÉCHEC » sur stdout ; un échec est compté. */
  const check = (what, ok, detail) => {
    console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${what}${!ok && detail !== undefined ? ` (${detail})` : ''}`);
    if (!ok) failures++;
  };

  /** Ferme l'onglet (s'il a été ouvert par `connect`) et la connexion. */
  const close = async () => {
    if (ownTab) await Promise.race([send('Page.close'), wait(1000)]).catch(() => undefined);
    ws.close();
    if (browser) {
      await Promise.race([browser.send('Target.disposeBrowserContext', { browserContextId: contextId }), wait(2000)]).catch(() => undefined);
      browser.close();
    }
  };

  /** Affiche `messageOk` sans échec, sinon `ko(n)`, ferme et sort en code 0 ou 1. */
  const finish = async (messageOk = 'Tout passe.', { ko = (n) => `${n} échec(s).` } = {}) => {
    console.log(failures === 0 ? messageOk : ko(failures));
    diag(`durée totale ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
    await close();
    process.exit(failures === 0 ? 0 : 1);
  };

  return {
    send, evaluate, go, settle, waitFor, wait, vwait, blockNetwork, importGpx, importFiles, records, dumpText, shoot,
    mouse, click, clickText, check, finish, logs, close,
    /** Nombre d'échecs comptés par `check`. */
    failures: () => failures,
    /** Écoute chaque message du protocole (événements propres à un script : sons, journal…). */
    onMessage: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
};
