// Cliquet des styles en ligne : combien de `style={{` par fichier .tsx de src/ ?
//
//   node outils/styles-en-ligne.mjs            tableau fichier → nombre, et total
//   node outils/styles-en-ligne.mjs --figer    réécrit outils/styles-en-ligne.json avec les nombres d'aujourd'hui
//
// Le test `src/theme/inlineStyles.test.ts` refuse qu'un fichier dépasse son nombre figé et qu'un fichier absent du
// relevé en ait un seul. Un style qui dépend d'une valeur calculée reste en ligne ; le reste va dans une classe.
// Sans dépendance.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FICHIER_RELEVE = path.join(racine, 'outils', 'styles-en-ligne.json')

function fichiersTsx(dossier) {
  const rendu = []
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name)
    if (entree.isDirectory()) rendu.push(...fichiersTsx(chemin))
    else if (entree.name.endsWith('.tsx')) rendu.push(chemin)
  }
  return rendu
}

/** Nombre de `style={{` par fichier .tsx de src/ (chemin relatif avec des `/`), seuls les fichiers qui en ont. */
export function compterStylesEnLigne() {
  const compte = {}
  for (const chemin of fichiersTsx(path.join(racine, 'src'))) {
    const n = (fs.readFileSync(chemin, 'utf8').match(/style=\{\{/g) ?? []).length
    if (n > 0) compte[path.relative(racine, chemin).split(path.sep).join('/')] = n
  }
  return Object.fromEntries(Object.entries(compte).sort(([a], [b]) => a.localeCompare(b)))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const compte = compterStylesEnLigne()
  const total = Object.values(compte).reduce((a, b) => a + b, 0)
  if (process.argv.includes('--figer')) {
    fs.writeFileSync(FICHIER_RELEVE, JSON.stringify(compte, null, 2) + '\n')
    console.log(`Relevé figé : ${total} styles en ligne dans ${Object.keys(compte).length} fichiers (outils/styles-en-ligne.json).`)
  } else {
    for (const [fichier, n] of Object.entries(compte).sort(([, a], [, b]) => b - a)) console.log(`${String(n).padStart(4)}  ${fichier}`)
    console.log(`${String(total).padStart(4)}  total`)
  }
}
