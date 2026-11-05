// Complément de la liste des licences (`public/licences-hors-js.json`) : ce que Vite ne voit pas, faute de JS.
//
//   gradlew :app:dependencies --configuration releaseRuntimeClasspath --console=plain > natif.txt
//   node outils/licences-hors-js.mjs natif.txt
//
// À relancer quand une dépendance native ou un greffon change : `src/core/licenses.test.ts` compare ce fichier au
// `package-lock.json` et à `android/variables.gradle`. Polices et `@capacitor/android` : texte lu dans `node_modules`.
// Natif : une ligne par famille, licence prise dans la table ci-dessous, car le cache de Gradle n'a presque pas de POM ;
// un groupe que la table ne connaît pas arrête le script. Sans dépendance.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const SDK_ANDROID = 'https://developer.android.com/studio/terms'
const GREFFON_GPS = 'https://github.com/Cap-go/capacitor-background-geolocation'

// `io.ionic.libs:ionfilesystem-android` : son AAR n'a pas de fichier de licence et son POM ne donne qu'un lien, lu le
// 05/11 : https://github.com/ionic-team/ion-android-filesystem/blob/1.1.1/LICENSE
const MIT_IONIC = `MIT License

Copyright (c) 2025 Ionic

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

/** Table groupe → famille. Sans `texte` : la licence Apache 2.0 (voir `principal`). */
const FAMILLES = [
  { nom: 'AndroidX', groupe: (g) => g.startsWith('androidx.'), identifiant: 'Apache-2.0' },
  { nom: 'Kotlin et JetBrains', groupe: (g) => g === 'org.jetbrains' || g.startsWith('org.jetbrains.'), identifiant: 'Apache-2.0' },
  { nom: 'JSpecify', groupe: (g) => g === 'org.jspecify', identifiant: 'Apache-2.0' },
  { nom: 'Apache Cordova', groupe: (g) => g === 'org.apache.cordova', identifiant: 'Apache-2.0' },
  { nom: 'ListenableFuture (Guava)', groupe: (g) => g === 'com.google.guava', identifiant: 'Apache-2.0' },
  {
    nom: 'Services Google Play',
    groupe: (g) => g === 'com.google.android.gms',
    identifiant: 'Licence du SDK Android',
    texte: 'Distribués par Google selon les conditions du SDK Android.',
    url: SDK_ANDROID,
  },
  { nom: 'Ionic Filesystem', groupe: (g) => g === 'io.ionic.libs', identifiant: 'MIT', texte: MIT_IONIC },
]

/** Famille d'un groupe Maven ; lève une erreur s'il n'est pas dans la table : sa licence reste à vérifier. */
export const familleDuGroupe = (groupe) => {
  const famille = FAMILLES.find((f) => f.groupe(groupe))
  if (!famille) throw new Error(`Groupe natif inconnu, licence à vérifier puis à ajouter à la table : ${groupe}`)
  return famille
}

/**
 * Composants résolus d'une sortie de `gradlew :app:dependencies`, `groupe:nom:version`, triés et sans double : la version
 * retenue est celle après la flèche (`1.8.0 -> 1.11.0`, `{strictly 1.0} -> 1.0`, ou `groupe:nom -> 1.0`), les modules du
 * projet (`project :capacitor-android`) n'y sont pas.
 */
export const composantsNatifs = (sortie) => {
  const trouves = new Set()
  for (const ligne of sortie.split(/\r?\n/)) {
    const arbre = ligne.match(/^[|\s]*[+\\]--- (.+)$/)
    if (!arbre || arbre[1].startsWith('project ')) continue
    const texte = arbre[1].replace(/ \([*cn]\)$/, '')
    const [declare, retenu] = texte.split(' -> ')
    const [groupe, nom, version] = declare.split(':')
    if (!nom) continue
    if (retenu?.includes(':')) trouves.add(retenu)
    else trouves.add(`${groupe}:${nom}:${retenu ?? version}`)
  }
  return [...trouves].sort()
}

/** Une ligne par famille native. `apache` : texte de la licence Apache 2.0. */
export const lignesNatives = (composants, apache) => {
  const parFamille = new Map()
  for (const composant of composants) {
    const famille = familleDuGroupe(composant.split(':')[0])
    parFamille.set(famille, [...(parFamille.get(famille) ?? []), composant])
  }
  return [...parFamille].map(([famille, liste]) => ({
    name: famille.nom,
    version: liste.length === 1 ? liste[0].split(':')[2] : `${liste.length} composants`,
    identifier: famille.identifiant,
    text: famille.texte ?? apache,
    ...(famille.url ? { url: famille.url } : {}),
    components: liste,
  }))
}

/** Premier `node_modules` qui porte le paquet, en remontant : une copie de travail d'un lot prend celui du dépôt. */
const dossierPaquet = (nom) => {
  for (let dossier = RACINE; ; dossier = dirname(dossier)) {
    const paquet = join(dossier, 'node_modules', nom)
    if (existsSync(join(paquet, 'package.json'))) return paquet
    if (dirname(dossier) === dossier) throw new Error(`Paquet introuvable : ${nom}`)
  }
}

/** Ligne d'un paquet npm, version, licence et texte lus dans `node_modules`. */
const lignePaquet = (nom, extra = {}) => {
  const dossier = dossierPaquet(nom)
  const { version, license } = JSON.parse(readFileSync(join(dossier, 'package.json'), 'utf8'))
  return { name: nom, version, identifier: license, text: readFileSync(join(dossier, 'LICENSE'), 'utf8').trim(), ...extra }
}

const principal = () => {
  const [fichier] = process.argv.slice(2)
  if (!fichier) {
    console.error('Usage : node outils/licences-hors-js.mjs <sortie de gradlew :app:dependencies>')
    process.exit(1)
  }
  // Le texte Apache 2.0 n'est livré par aucun composant natif : celui de TypeScript, identique, sert de référence.
  const apache = readFileSync(join(dossierPaquet('typescript'), 'LICENSE'), 'utf8').trim()
  const composants = composantsNatifs(readFileSync(fichier, 'utf8'))
  if (composants.length === 0) throw new Error(`Aucun composant dans ${fichier} : est-ce bien la sortie de gradlew ?`)
  const lignes = [
    lignePaquet('@fontsource/montserrat'),
    lignePaquet('@fontsource/shrikhand'),
    lignePaquet('@capacitor/android'),
    lignePaquet('@capgo/background-geolocation', { notice: 'Utilisé sans modification. Sources :', url: GREFFON_GPS }),
    ...lignesNatives(composants, apache),
  ]
  writeFileSync(join(RACINE, 'public', 'licences-hors-js.json'), `${JSON.stringify(lignes, null, 2)}\n`)
  console.log(`${lignes.length} lignes, ${composants.length} composants natifs : public/licences-hors-js.json`)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) principal()
