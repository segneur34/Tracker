// Carte des fichiers : `docs/INVENTAIRE.md` contre le disque.
//
//   node outils/docs-inventaire.mjs
//
// Trois contrôles : un fichier de `src/`, du code Java ou d'`outils/` (hors tests) que la carte ne cite pas ; un
// fichier cité qui n'existe pas ; un fichier cité sous la section d'un dossier où il n'est pas. Tout en règle : une
// ligne ; sinon les écarts, code 1. Sans dépendance.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const inventaire = fs.readFileSync(path.join(racine, 'docs/INVENTAIRE.md'), 'utf8')
const norm = (p) => p.split(path.sep).join('/')

// Ce que l'application crée à l'exécution ou qui n'est qu'un modèle de nom : jamais cherché sur le disque.
const HORS_DEPOT = new Set(['reglages.json', 'vignettes.json', '_index.json', 'N-titre.md', 'licences.json', 'fc-repos.json'])
// Fichiers générés par la construction et ignorés par git : jamais parcourus, pour voir ici ce que voit un clone neuf
// (vérification sur GitHub ; `licences.json` n'était trouvé que dans la copie Android, sur ce seul poste).
const GENERES = ['android/app/src/main/assets', 'android/capacitor-cordova-android-plugins']

const fichiers = []
const parcourir = (dossier, liste = fichiers) => {
  if (!fs.existsSync(dossier)) return
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    if (['node_modules', '.git', 'build', 'sondes-audit'].includes(e.name)) continue
    const p = path.join(dossier, e.name)
    if (GENERES.includes(norm(path.relative(racine, p)))) continue
    if (e.isDirectory()) parcourir(p, liste)
    else liste.push(norm(path.relative(racine, p)))
  }
}
parcourir(path.join(racine, 'src'))
parcourir(path.join(racine, 'android/app/src/main/java'))
parcourir(path.join(racine, 'outils'))
// Pour savoir si un fichier cité existe : tout ce que la carte peut nommer, ressources Android et documents compris.
const tous = [...fichiers]
parcourir(path.join(racine, 'android/app/src'), tous)
parcourir(path.join(racine, 'docs'), tous)

// Jetons cités, avec la section (« ## core ») où ils apparaissent.
let section = ''
const cites = []
inventaire.split('\n').forEach((ligne, i) => {
  if (ligne.startsWith('## ')) section = (ligne.match(/^## `?([\w/]+)`?/) ?? [null, ligne])[1]
  for (const m of ligne.matchAll(/`([^`\s]+\.(?:ts|tsx|css|java|mjs|js|bat|json|md|xml|ps1|cjs))`/g)) cites.push({ jeton: m[1], ligne: i + 1, section })
})
const bases = new Set(cites.map((c) => c.jeton.split('/').pop()))
const entiers = new Set(cites.map((c) => c.jeton))

const estTest = (f) => /\.test\.tsx?$/.test(f)
// Seul le code est tenu d'y figurer : ni feuilles de style (citées avec leur composant), ni images, ni scripts du banc
// (décrits par `outils/banc/LISEZMOI.md`), ni jeux d'essai de `src/test/`, ni `components/ui/` (cité en bloc).
const attendu = (f) => /\.(ts|tsx|java)$/.test(f) && !f.startsWith('src/test/') && !f.startsWith('src/components/ui/')
const nonCites = fichiers.filter((f) => attendu(f) && !estTest(f) && !bases.has(f.split('/').pop()) && ![...entiers].some((c) => f.endsWith('/' + c)))
const existe = (jeton) => {
  if (HORS_DEPOT.has(jeton) || jeton.includes('*')) return true
  const b = jeton.replace(/^src\//, '')
  return tous.some((f) => f === b || f.endsWith('/' + b)) || fs.existsSync(path.join(racine, jeton))
}
const absents = cites.filter((c) => !existe(c.jeton))
const DOSSIERS = ['core', 'sailing', 'running', 'surfing', 'cycling', 'recording', 'library', 'planning', 'platform', 'settings', 'hooks', 'pages', 'components']
const malRanges = cites.filter(
  (c) =>
    DOSSIERS.includes(c.section) &&
    !c.jeton.includes('/') &&
    !fichiers.some((f) => f === `src/${c.section}/${c.jeton}` || (c.section === 'components' && (f === `src/components/ui/${c.jeton}` || f === `src/theme/${c.jeton}`))),
)

const lignes = []
if (nonCites.length) lignes.push(`  ${nonCites.length} fichier(s) du disque absents de la carte : ${nonCites.join(', ')}`)
for (const c of absents) lignes.push(`  l.${c.ligne} [${c.section}] cité mais absent du disque : ${c.jeton}`)
for (const c of malRanges) {
  const ailleurs = fichiers.filter((f) => f.endsWith('/' + c.jeton)).join(', ')
  lignes.push(`  l.${c.ligne} [${c.section}] ${c.jeton} n'est pas dans ce dossier${ailleurs ? ` (il est dans ${ailleurs})` : ''}`)
}
if (lignes.length === 0) console.log(`carte des fichiers : à jour (${fichiers.filter((f) => attendu(f) && !estTest(f)).length} fichiers de code)`)
else {
  console.log(`carte des fichiers : ${lignes.length} écart(s)`)
  console.log(lignes.slice(0, 40).join('\n'))
  process.exitCode = 1
}
