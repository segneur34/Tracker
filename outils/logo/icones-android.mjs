// Icônes de l'application à partir des deux sources de `assets/` :
// - `icone.svg`, version simplifiée du logo, lisible en petit : icône Android (classique, ronde,
//   avant-plan de l'icône adaptative), favicon et icône du raccourci de bureau ;
// - `logo.png`, le logo complet (disque plein cadre, tour transparent) : écran de démarrage seulement.
//
// Les icônes : `node <chemin>/icones-android.mjs <racine du dépôt>`. Le fond de l'icône adaptative est la
// couleur de `values/ic_launcher_background.xml` ; `mipmap-anydpi-v26/` reste celui de Capacitor.
//
// L'écran de démarrage, s'il change : refaire `assets/splash.png` (logo de 900 px au centre d'un carré de
// 2732 px, fond #f6f5f2), puis `npx @capacitor/assets@3 generate --android --splashBackgroundColor #f6f5f2`,
// et défaire ce que l'outil fait de trop : `git checkout` d'`AndroidManifest.xml`, de `mipmap-*` et de
// `mipmap-anydpi-v26/`, suppression des dossiers `*night*` et `*ldpi*`.
//
// Il faut `sharp`, absent du projet : l'installer dans un dossier de brouillon (`npm i sharp`) et y lancer
// le script.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const root = process.argv[2];
const sharp = createRequire(join(process.cwd(), 'x.js'))('sharp');
const svg = join(root, 'assets/icone.svg');
const res = join(root, 'android/app/src/main/res');
/** Icône classique (48 dp) et couche adaptative (108 dp, dont un cercle de 72 dp visible), par densité. */
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const disc = (size) => sharp(svg, { density: 600 }).resize(size, size).png().toBuffer();
const centered = async (canvas, size) =>
  sharp({ create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await disc(size), gravity: 'centre' }])
    .png();

for (const [density, scale] of Object.entries(DENSITIES)) {
  const dir = join(res, `mipmap-${density}`);
  const legacy = Math.round(48 * scale);
  const layer = Math.round(108 * scale);
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
    await (await centered(legacy, Math.round(legacy * 0.96))).toFile(join(dir, name));
  }
  await (await centered(layer, Math.round(layer * 0.66))).toFile(join(dir, 'ic_launcher_foreground.png'));
}
await sharp(await disc(192)).toFile(join(root, 'public/favicon.png'));

// Icône du raccourci de bureau (`outils/icone-tracker.ico`) : une image par taille, en BMP 32 bits sous
// 256 px, en PNG à 256. L'explorateur de Windows lit mal le PNG aux petites tailles : un .ico tout en
// PNG y garde l'ancienne icône, même après redémarrage.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const bmp = async (size) => {
  const rgba = await sharp(await disc(size)).ensureAlpha().raw().toBuffer();
  const maskRow = Math.ceil(size / 32) * 4;
  const out = Buffer.alloc(40 + size * size * 4 + maskRow * size);
  out.writeUInt32LE(40, 0);
  out.writeInt32LE(size, 4);
  out.writeInt32LE(size * 2, 8); // hauteur doublée : image puis masque
  out.writeUInt16LE(1, 12);
  out.writeUInt16LE(32, 14);
  out.writeUInt32LE(size * size * 4 + maskRow * size, 20);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = ((size - 1 - y) * size + x) * 4; // lignes de bas en haut
      const to = 40 + (y * size + x) * 4;
      out[to] = rgba[from + 2];
      out[to + 1] = rgba[from + 1];
      out[to + 2] = rgba[from];
      out[to + 3] = rgba[from + 3];
    }
  }
  return out; // masque ET laissé à zéro : la transparence vient du canal alpha
};
const images = await Promise.all(ICO_SIZES.map((size) => (size < 256 ? bmp(size) : disc(size))));
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((png, i) => {
  const at = 6 + 16 * i;
  header.writeUInt8(ICO_SIZES[i] % 256, at);
  header.writeUInt8(ICO_SIZES[i] % 256, at + 1);
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(png.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += png.length;
});
writeFileSync(join(root, 'outils/icone-tracker.ico'), Buffer.concat([header, ...images]));
console.log('icônes Android, favicon et icône du bureau refaites');
