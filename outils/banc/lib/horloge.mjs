// Banc de test : horloge accélérée de la page (n° 90).
// `connect` (lib/cdp.mjs) l'injecte dans chaque document quand `TEMPS` > 1 : le temps de la page passe `TEMPS` fois
// plus vite. Accélérés : `Date` (`new Date()` sans argument et `Date.now()` ; `new Date(x)` inchangé),
// `performance.now()`, les délais de `setTimeout` et `setInterval` (divisés par `TEMPS`), l'horodatage passé à
// `requestAnimationFrame`. Pas accélérés : les transitions et animations CSS, l'horodatage des événements, les
// minuteurs des workers, le réseau. Un rejeu (`createReplaySource`, Date.now + setTimeout) tourne donc `TEMPS` fois
// plus vite sans changer ses positions, qui gardent les heures de leur fichier.

/** Facteur d'accélération lu dans `TEMPS` (1 si absent ou invalide). */
export const TEMPS = (() => {
  const k = Number(process.env.TEMPS ?? 1);
  return Number.isFinite(k) && k > 0 ? k : 1;
})();

/**
 * Script de page qui accélère l'horloge `k` fois, à poser par `Page.addScriptToEvaluateOnNewDocument`. `Date` part
 * de l'heure réelle à `anchorMs` (le branchement du script) et s'en écarte `k` fois plus vite, le même dans chaque
 * document : une heure écrite par une page reste dans le passé de la suivante. `performance.now()` part de
 * l'ouverture du document, comme l'originale.
 */
export const horlogeScript = (k = TEMPS, anchorMs = Date.now()) => `(() => {
  const k = ${Number(k)};
  const anchor = ${Number(anchorMs)};
  if (!(k > 0) || k === 1 || window.__bancHorloge) return;
  Object.defineProperty(window, '__bancHorloge', { value: k, enumerable: false });
  const RealDate = Date;
  const realDateNow = RealDate.now.bind(RealDate);
  const realPerfNow = performance.now.bind(performance);
  const perf0 = realPerfNow();
  const fastDateNow = () => anchor + (realDateNow() - anchor) * k;
  const fastPerf = (t) => perf0 + (t - perf0) * k;

  // Date : appelée sans \`new\`, elle rend la chaîne de l'heure accélérée, comme l'originale.
  function FastDate(...args) {
    if (!new.target) return new RealDate(fastDateNow()).toString();
    return Reflect.construct(RealDate, args.length === 0 ? [fastDateNow()] : args, new.target);
  }
  Object.setPrototypeOf(FastDate, RealDate);
  FastDate.prototype = RealDate.prototype;
  FastDate.now = () => Math.floor(fastDateNow());
  FastDate.parse = RealDate.parse;
  FastDate.UTC = RealDate.UTC;
  window.Date = FastDate;

  Object.defineProperty(performance, 'now', { value: () => fastPerf(realPerfNow()), configurable: true, writable: true });

  const realSetTimeout = window.setTimeout;
  const realSetInterval = window.setInterval;
  const scaled = (ms) => (Number(ms) || 0) / k;
  window.setTimeout = function (fn, ms, ...rest) { return realSetTimeout(fn, scaled(ms), ...rest); };
  window.setInterval = function (fn, ms, ...rest) { return realSetInterval(fn, scaled(ms), ...rest); };

  const realRaf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (cb) { return realRaf((t) => cb(fastPerf(t))); };
})();`;
