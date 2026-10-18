// Vectorise la planche des 16 dessins d'activité en src/components/activityArt.tsx.
//
// La planche (image de 2400 × 1792, 4 × 4 dessins légendés, fournie par l'utilisateur
// le 17/10/2026) n'est pas versionnée : le fichier produit fait foi. Pour la refaire :
//   dans un dossier de brouillon : npm i potrace@2.1.8   (apporte jimp)
//   NODE_PATH=<brouillon>/node_modules node outils/icones/vectoriser.cjs <planche.jpg>
// Les bandes ci-dessous (dessin sans sa légende) ont été relevées sur cette planche :
// une autre image demande de les relever à nouveau (lignes sombres par colonne).
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const potrace = require('potrace');

const [src] = process.argv.slice(2);
/** Dessins réduits de moitié avant le tracé : coordonnées entières, assez fines jusqu'à 200 px. */
const SCALE = 0.5;
const COLS = [[0, 624], [624, 1212], [1212, 1788], [1788, 2400]];
const BANDS = [
  [[67, 431], [545, 860], [967, 1272], [1379, 1690]],
  [[69, 423], [540, 866], [987, 1266], [1377, 1688]],
  [[68, 434], [554, 855], [962, 1277], [1399, 1681]],
  [[71, 430], [539, 873], [994, 1255], [1390, 1655]],
];
const IDS = [
  ['bateau', 'planche', 'wingfoil', 'kite'],
  ['course', 'marche', 'route', 'vtt'],
  ['gravel', 'surf', 'surf-foil', 'kayak'],
  ['paddle', 'paddle-foil', 'fractionne-velo', 'fractionne-pied'],
];

const luminance = (d, i) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
const trace = (img) => new Promise((res, rej) =>
  potrace.trace(img, { threshold: 128, turdSize: 6, optTolerance: 0.4, alphaMax: 1 }, (err, svg) => (err ? rej(err) : res(svg))));

/** Chemin de potrace (absolu, décimal) en relatif à coordonnées entières. */
const compact = (d) => {
  const ARGS = { M: 2, L: 2, C: 6 };
  const toks = d.match(/[MLCZ]|-?\d*\.?\d+/gi);
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, prev = '', out = '';
  while (i < toks.length) {
    let cmd = toks[i];
    if (/[MLCZ]/i.test(cmd)) i++; else cmd = prev === 'M' ? 'L' : prev;
    if (cmd === 'Z') { out += 'z'; cx = sx; cy = sy; prev = 'Z'; continue; }
    const n = ARGS[cmd];
    const abs = toks.slice(i, i + n).map((v) => Math.round(Number(v)));
    i += n;
    const rel = abs.map((v, j) => v - (j % 2 === 0 ? cx : cy));
    const body = rel.reduce((acc, v, j) => acc + (j > 0 && v >= 0 ? ' ' : '') + v, '');
    const letter = cmd.toLowerCase();
    out += letter === prev.toLowerCase() && letter !== 'm' ? (rel[0] >= 0 ? ' ' : '') + body : letter + body;
    cx = abs[n - 2]; cy = abs[n - 1];
    if (cmd === 'M') { sx = cx; sy = cy; }
    prev = cmd;
  }
  return out;
};

(async () => {
  const sheet = await Jimp.read(src);
  const { width, data } = sheet.bitmap;
  const entries = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const [x0, x1] = COLS[c];
    const [y0, y1] = BANDS[c][r];
    let minX = x1, maxX = x0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (luminance(data, (y * width + x) * 4) < 110) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    }
    const pad = 4;
    const bw = maxX - minX + 1 + 2 * pad, bh = y1 - y0 + 2 * pad;
    const cell = sheet.clone().crop(Math.max(0, minX - pad), y0 - pad, bw, bh);
    // Fond clair, lignes de relief beiges comprises, passé au blanc avant le tracé.
    cell.scan(0, 0, bw, bh, function (_x, _y, i) {
      const d = this.bitmap.data;
      d[i] = d[i + 1] = d[i + 2] = luminance(d, i) < 140 ? 0 : 255;
    });
    cell.resize(Math.round(bw * SCALE), Math.round(bh * SCALE), Jimp.RESIZE_BICUBIC);
    const svg = await trace(cell);
    entries.push({ id: IDS[r][c], w: cell.bitmap.width, h: cell.bitmap.height, d: compact(svg.match(/ d="([^"]+)"/)[1]) });
  }

  const lines = entries.map((e) => `  '${e.id}': { w: ${e.w}, h: ${e.h}, d: '${e.d}' },`);
  const tsx = `// Fichier produit par outils/icones/vectoriser.cjs : ne pas retoucher à la main.
import type { SVGProps } from 'react';
import type { ActivityIconId } from '../core/activityIcons';

/**
 * Dessins détaillés des activités, vectorisés depuis la planche de l'utilisateur
 * (17/10/2026) : silhouettes pleines à la couleur du texte, pour les grands formats
 * (en-tête des bibliothèques). Les petites icônes stylisées sont dans \`icons.tsx\`.
 */
const ART: Record<ActivityIconId, { w: number; h: number; d: string }> = {
${lines.join('\n')}
};

/** Dessin d'une activité dans un carré de \`size\` pixels, centré. */
function ActivityArt({ icon, size = 48, ...props }: { icon: ActivityIconId; size?: number } & SVGProps<SVGSVGElement>) {
  const { w, h, d } = ART[icon];
  const side = Math.max(w, h);
  return (
    <svg width={size} height={size} viewBox={\`\${(w - side) / 2} \${(h - side) / 2} \${side} \${side}\`} aria-hidden focusable={false} {...props}>
      <path fill="currentColor" fillRule="evenodd" d={d} />
    </svg>
  );
}

export default ActivityArt;
`;
  const out = path.join(__dirname, '..', '..', 'src', 'components', 'activityArt.tsx');
  fs.writeFileSync(out, tsx);
  console.log(out, tsx.length, 'octets');
})();
