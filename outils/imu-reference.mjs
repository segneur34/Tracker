// Refait la référence du format des capteurs, src/core/imuFile.reference.imu, par l'écrivain du téléphone.
//
//   node outils/imu-reference.mjs      depuis n'importe où ; JDK par JAVA_HOME, sinon javac et java du PATH
//
// À lancer seulement pour un changement de format voulu, décrit d'abord en tête de src/core/imuFile.ts : aucun test ne
// l'écrit, c'est tout l'intérêt de la référence. Compile ImuWriter.java (Java pur) et ImuReference.java (ce qu'écrit la
// référence) sans Gradle ni SDK Android, dans un dossier temporaire. Ensuite, reporter les valeurs attendues dans
// src/core/imuFile.reference.test.ts si les mesures ont changé.

import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PAQUET = 'java/io/github/segneur/tracker'
const SOURCES = [
  join(RACINE, 'android/app/src/main', PAQUET, 'ImuWriter.java'),
  join(RACINE, 'android/app/src/test', PAQUET, 'ImuReference.java'),
]
const REFERENCE = join(RACINE, 'src/core/imuFile.reference.imu')

const outil = (nom) => (process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', nom) : nom)

const lancer = (nom, args) => {
  const { status, error } = spawnSync(outil(nom), args, { stdio: 'inherit' })
  if (error) throw new Error(`${nom} impossible à lancer (JDK par JAVA_HOME ou PATH) : ${error.message}`)
  if (status !== 0) throw new Error(`${nom} a échoué (code ${status})`)
}

const dossier = mkdtempSync(join(tmpdir(), 'imu-reference-'))
try {
  const fichier = join(dossier, 'reference.imu')
  lancer('javac', ['-encoding', 'UTF-8', '-d', dossier, ...SOURCES])
  lancer('java', ['-cp', dossier, 'io.github.segneur.tracker.ImuReference', fichier])
  // Remplacée seulement une fois entièrement écrite.
  copyFileSync(fichier, REFERENCE)
  console.log(`${relative(RACINE, REFERENCE)} : ${statSync(REFERENCE).size} octets.`)
  console.log('Vérifier : npx vitest run src/core/imuFile.reference.test.ts')
} catch (erreur) {
  console.error(erreur.message)
  process.exitCode = 1
} finally {
  rmSync(dossier, { recursive: true, force: true })
}
