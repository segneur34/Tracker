// Banc de test : fausses tuiles de carte (lot 74). Les requêtes de tuiles d'OpenStreetMap (avec ou sans
// sous-domaine) et d'Esri sont interceptées (`Fetch`) et servies par une image synthétique de 256 × 256, après
// un délai réglable, sans jamais toucher au réseau ; chaque requête et chaque annulation sont notées.
// Usage : `const tuiles = await fakeTiles(b, { delayMs })` après `connect`, puis `b.blockNetwork(BLOCKED_EXCEPT_TILES)`
// (les tuiles ne doivent pas être bloquées) ; `tuiles.stats()` et `tuiles.reset()` autour d'une séquence.
import { deflateSync } from 'node:zlib';
import { BLOCKED_URLS } from './cdp.mjs';

/** Domaines bloqués d'ordinaire, sauf ceux des tuiles. */
export const BLOCKED_EXCEPT_TILES = BLOCKED_URLS.filter((u) => !/openstreetmap|arcgisonline/.test(u));

const TILE_PATTERNS = ['*://*.openstreetmap.org/*', '*://tile.openstreetmap.org/*', '*://server.arcgisonline.com/*'];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};

/** PNG de 256 × 256 d'une couleur `fill` ([r, g, b]), bordé d'un pixel de `edge` : les jointures des tuiles se voient. */
const tilePng = (fill, edge) => {
  const size = 256;
  const raw = Buffer.alloc(size * (1 + 3 * size));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + 3 * size);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = x === 0 || y === 0 ? edge : fill;
      raw[row + 1 + 3 * x] = r;
      raw[row + 2 + 3 * x] = g;
      raw[row + 3 + 3 * x] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};

// Plan en damier clair (beige, bleu pâle), satellite en damier sombre.
const IMAGES = {
  plan: [tilePng([232, 228, 216], [176, 176, 176]), tilePng([214, 228, 236], [176, 176, 176])].map((b) => b.toString('base64')),
  satellite: [tilePng([42, 74, 90], [20, 30, 40]), tilePng([58, 90, 74], [20, 30, 40])].map((b) => b.toString('base64')),
};

/** Fond, zoom, colonne et ligne d'une adresse de tuile (Esri : y avant x) ; `null` si ce n'en est pas une. */
export const tileOfUrl = (url) => {
  let m = url.match(/openstreetmap\.org\/(\d+)\/(\d+)\/(\d+)\.png/);
  if (m) return { base: 'plan', z: +m[1], x: +m[2], y: +m[3] };
  m = url.match(/World_Imagery\/MapServer\/tile\/(\d+)\/(\d+)\/(\d+)/);
  if (m) return { base: 'satellite', z: +m[1], x: +m[3], y: +m[2] };
  return null;
};

/**
 * Intercepte les tuiles de l'onglet `b` (rendu de `connect`) : chacune servie après `delayMs`, avec les en-têtes qu'il
 * faut à un `fetch` d'une autre origine, sans cache HTTP. Rend `stats()` (requêtes, tuiles distinctes, doubles :
 * requêtes d'une tuile déjà demandée, annulées : coupées par la page avant la réponse ; par fond) et `reset()`.
 */
export const fakeTiles = async (b, { delayMs = 0 } = {}) => {
  let requests = [];
  let canceled = 0;
  const tileRequests = new Map();
  b.onMessage((msg) => {
    const p = msg.params;
    if (msg.method === 'Network.requestWillBeSent') {
      const tile = tileOfUrl(p.request.url);
      if (tile) {
        tileRequests.set(p.requestId, tile);
        requests.push(tile);
      }
    } else if (msg.method === 'Network.loadingFailed') {
      if (p.canceled && tileRequests.has(p.requestId)) canceled++;
      tileRequests.delete(p.requestId);
    } else if (msg.method === 'Network.loadingFinished') {
      tileRequests.delete(p.requestId);
    } else if (msg.method === 'Fetch.requestPaused') {
      const tile = tileOfUrl(p.request.url);
      const answer = () => {
        if (!tile) return b.send('Fetch.continueRequest', { requestId: p.requestId });
        const body = IMAGES[tile.base][(tile.x + tile.y) % 2];
        return b.send('Fetch.fulfillRequest', {
          requestId: p.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: 'Content-Type', value: 'image/png' },
            { name: 'Access-Control-Allow-Origin', value: '*' },
            { name: 'Cache-Control', value: 'no-store' },
          ],
          body,
        });
      };
      // Une requête annulée entre-temps : la réponse est refusée, sans conséquence.
      setTimeout(() => { void answer().catch(() => undefined); }, delayMs);
    }
  });
  await b.send('Fetch.enable', { patterns: TILE_PATTERNS.map((urlPattern) => ({ urlPattern, requestStage: 'Request' })) });
  return {
    stats: () => {
      const seen = new Map();
      for (const t of requests) {
        const key = `${t.base}/${t.z}/${t.x}/${t.y}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      const zooms = new Map();
      for (const key of seen.keys()) { const z = Number(key.split('/')[1]); zooms.set(z, (zooms.get(z) ?? 0) + 1); }
      const byZoom = [...zooms].sort((a, b) => a[0] - b[0]).map(([z, n]) => `z${z} : ${n}`).join(', ');
      return { requests: requests.length, distinct: seen.size, doubles: requests.length - seen.size, canceled, byZoom };
    },
    reset: () => { requests = []; canceled = 0; },
  };
};

/** Relevé d'une séquence en une ligne. */
export const formatTileStats = ({ requests, distinct, doubles, canceled }) =>
  `${requests} requêtes de tuiles, ${distinct} distinctes, ${doubles} en double, ${canceled} annulées`;
