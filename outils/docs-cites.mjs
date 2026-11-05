// Renvois des documents vivants : chaque fichier ou nom de code cité entre accents graves existe-t-il ?
//
//   node outils/docs-cites.mjs [document.md …]     sans argument : les documents vivants (liste ci-dessous)
//
// Un chemin (« core/units.ts », « outils/banc/ ») doit désigner un fichier ou un dossier du dépôt ; un nom seul
// (« formatDecimal ») doit apparaître dans le code. `docs/HISTORIQUE.md` et `docs/backlog/` ne sont pas vérifiés :
// ils citent légitimement des fichiers disparus. Tout trouvé : une ligne ; sinon les renvois faux, code 1.
// Sans dépendance.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DOCUMENTS = [
  'CLAUDE.md',
  'README.md',
  'docs/ETAT_DU_PROJET.md',
  'docs/DECISIONS.md',
  'docs/MISE_EN_PAGE.md',
  'docs/MODELES.md',
  'docs/INSTALLATION.md',
  'docs/DEVELOPPER.md',
  'docs/INVENTAIRE.md',
  'docs/BACKLOG.md',
]
// Fichiers générés par la construction et ignorés par git : jamais parcourus, pour voir ici ce que voit un clone neuf
// (vérification sur GitHub ; `licences.json` n'était trouvé que dans la copie Android, sur ce seul poste).
const GENERES = ['android/app/src/main/assets', 'android/capacitor-cordova-android-plugins']
const IGNORES = new Set(['node_modules', '.git', 'build', 'dist', '.gradle', 'worktrees'])
// Ce que l'application crée à l'exécution ou qui vient d'ailleurs que du dépôt : jamais vérifié sur le disque.
const HORS_DEPOT = new Set([
  'Tracker/', 'sessions/', 'reglages/', 'en-attente/', 'tuiles/', 'z_x_y.png', 'sat_z_x_y.png', '_index.json',
  'vignettes.json', 'tracker.json', 'reglages.json', 'dist/', 'leaflet.css', 'local.properties', 'keystore.properties',
  'node_modules/', 'gradlew', 'JAVA_HOME', 'ANDROID_HOME', 'MEMORY.md', '/', 'itineraires/', 'N-titre.md', 'docs/backlog/N-titre.md', 'Explore',
  'licences.json', 'fc-repos.json',
])
// Documents dont les noms seuls viennent de Claude Code (modèles, options), pas du code : seuls leurs chemins comptent.
const SANS_NOMS = new Set(['docs/MODELES.md'])
const norm = (p) => p.split(path.sep).join('/')

const fichiers = []
const parcourir = (dossier) => {
  if (!fs.existsSync(dossier)) return
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    if (IGNORES.has(e.name)) continue
    const p = path.join(dossier, e.name)
    if (GENERES.includes(norm(path.relative(racine, p)))) continue
    if (e.isDirectory()) parcourir(p)
    else fichiers.push(norm(path.relative(racine, p)))
  }
}
for (const d of ['src', 'outils', 'docs', 'android', 'public', 'assets', '.github', '.claude']) parcourir(path.join(racine, d))
for (const f of fs.readdirSync(racine)) if (fs.statSync(path.join(racine, f)).isFile()) fichiers.push(f)

const EXT_CODE = /\.(ts|tsx|css|java|kt|mjs|js|xml|json|gradle|html|yml)$/
const code = fichiers.filter((f) => EXT_CODE.test(f) && !f.startsWith('docs/')).map((f) => fs.readFileSync(path.join(racine, f), 'utf8'))
const vuDansLeCode = (nom) => {
  const re = new RegExp(`\\b${nom}\\b`)
  return code.some((s) => re.test(s))
}

const documents = process.argv.length > 2 ? process.argv.slice(2) : DOCUMENTS
const problemes = []
for (const doc of documents) {
  const chemin = path.resolve(racine, doc)
  if (!fs.existsSync(chemin)) {
    problemes.push(`${doc} : document absent`)
    continue
  }
  const vus = new Map()
  fs.readFileSync(chemin, 'utf8').split('\n').forEach((ligne, i) => {
    for (const m of ligne.matchAll(/`([^`]+)`/g)) {
      const t = m[1].trim()
      if (!vus.has(t)) vus.set(t, i + 1)
    }
  })
  for (const [brut, ligne] of vus) {
    const t = brut.replace(/\(\)$/, '')
    if (HORS_DEPOT.has(t) || /[*<>~]/.test(t) || /^\.\w+$/.test(t)) continue
    if (/[/.]/.test(t) && /\.(ts|tsx|css|md|mjs|js|java|json|xml|bat|kt|gradle|png|svg)$|\/$/.test(t) && !/\s/.test(t)) {
      const sansFin = t.replace(/\/$/, '')
      const sansSrc = sansFin.replace(/^src\//, '')
      const trouve = fichiers.some((f) => f === sansFin || f === sansSrc || f.endsWith('/' + sansSrc) || f.startsWith(sansSrc + '/') || f.includes('/' + sansSrc + '/'))
      if (!trouve) problemes.push(`${doc}:${ligne}  fichier absent : ${brut}`)
    } else if (/^[A-Za-z_]\w*$/.test(t) && t.length > 3 && !SANS_NOMS.has(doc) && !vuDansLeCode(t)) {
      problemes.push(`${doc}:${ligne}  nom absent du code : ${brut}`)
    }
  }
}

if (problemes.length === 0) console.log(`renvois des documents : tous trouvés (${documents.length} documents)`)
else {
  console.log(`renvois des documents : ${problemes.length} faux`)
  for (const p of problemes.slice(0, 40)) console.log('  ' + p)
  if (problemes.length > 40) console.log(`  et ${problemes.length - 40} autres`)
  process.exitCode = 1
}
