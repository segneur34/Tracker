// Vérification en une commande : lint, tests et build (ou typecheck) lancés ensemble, sortie courte.
//
//   node outils/verif.mjs                      complet : lint + vitest run mélangé + (tsc -b && vite build)
//   node outils/verif.mjs --rapide             tsc -b + lint + vitest run --changed (sans build, ordre fixe)
//   node outils/verif.mjs --noms <fichier>     écrit aussi la liste triée « fichier > describe > test »
//   node outils/verif.mjs --tests <motifs…>    passe les motifs (fichiers ou noms) à vitest
//
// Mode complet : les tests passent dans un ordre mélangé, d'une graine tirée à chaque passage (`VERIF_GRAINE=<n>`
// pour l'imposer) ; un test qui dépend de l'ordre échoue un jour, et la sortie dit alors la graine et la commande
// qui rejoue le même ordre. `--rapide` et `npm test` gardent l'ordre fixe.
//
// Les deux modes vérifient aussi les documents vivants : chaque fichier ou nom cité existe (`outils/docs-cites.mjs`) et la
// carte `docs/INVENTAIRE.md` colle au disque (`outils/docs-inventaire.mjs`).
//
// Tout passe : 5 ou 6 lignes. Sinon : seulement les échecs. Code de sortie 1 si un outil échoue ; un avertissement de
// lint fait échouer (`--deny-warnings`). Sans dépendance.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Racine du dépôt, lettre de lecteur en capitale : un dossier courant « c:\… » fait échouer vitest.
let RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
RACINE = RACINE.replace(/^[a-z]:/, (l) => l.toUpperCase())

/**
 * Dossier `node_modules` qui porte les outils : celui de la racine, sinon le premier au-dessus. Une copie de travail
 * d'un lot (`.claude/worktrees/<nom>/`) n'a pas le sien : elle prend celui du dépôt principal, comme le fait Node.
 */
const modulesDe = (depart) => {
  for (let dossier = depart; ; dossier = dirname(dossier)) {
    if (existsSync(join(dossier, 'node_modules', 'vitest', 'vitest.mjs'))) return join(dossier, 'node_modules')
    if (dirname(dossier) === dossier) return join(depart, 'node_modules')
  }
}
const MODULES = modulesDe(RACINE)

const BIN = {
  vitest: join(MODULES, 'vitest', 'vitest.mjs'),
  oxlint: join(MODULES, 'oxlint', 'bin', 'oxlint'),
  tsc: join(MODULES, 'typescript', 'bin', 'tsc'),
  vite: join(MODULES, 'vite', 'bin', 'vite.js'),
}

const MAX_TESTS_DETAILLES = 5
const LIGNES_PAR_TEST = 10

// ---------- arguments ----------
const args = process.argv.slice(2)
const rapide = args.includes('--rapide')
let fichierNoms = null
const motifs = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--noms') fichierNoms = args[++i]
  else if (args[i] === '--tests') {
    while (i + 1 < args.length && !args[i + 1].startsWith('--')) motifs.push(args[++i])
  }
}

/** Graine de l'ordre mélangé (mode complet seulement) : `VERIF_GRAINE` si elle est donnée, sinon tirée au hasard. */
const graineImposee = Number.parseInt(String(process.env.VERIF_GRAINE ?? '').trim(), 10)
const GRAINE = rapide ? null : Number.isInteger(graineImposee) && graineImposee > 0 ? graineImposee : 1 + Math.floor(Math.random() * 99_999)

// ---------- outils ----------
/** Lance `node <script> …` dans la racine ; renvoie sortie, code et durée (ms). Rien n'est affiché. */
function lancer(script, argv) {
  const debut = performance.now()
  return new Promise((ok) => {
    const enfant = spawn(process.execPath, [script, ...argv], { cwd: RACINE, env: { ...process.env, FORCE_COLOR: '0' } })
    let out = ''
    let err = ''
    enfant.stdout.on('data', (d) => (out += d))
    enfant.stderr.on('data', (d) => (err += d))
    enfant.on('error', (e) => ok({ out, err: err + String(e), code: 1, ms: performance.now() - debut }))
    enfant.on('close', (code) => ok({ out, err, code: code ?? 1, ms: performance.now() - debut }))
  })
}

const secondes = (ms) => (ms / 1000).toFixed(1).replace('.', ',') + ' s'
const milliers = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f')
const ECHAP = String.fromCharCode(27)
const sansCouleur = (s) => s.split(ECHAP).map((p, i) => (i === 0 ? p : p.replace(/^\[[0-9;]*m/, ''))).join('')
const relatif = (chemin) => resolve(chemin).slice(RACINE.length + 1).replace(/\\/g, '/')

/** Ports du banc (4191 à 4199) qui écoutent : un serveur Vite voisin fait échouer vitest. */
function portsDuBanc() {
  const sonde = (port) =>
    new Promise((ok) => {
      const s = connect({ port, host: '127.0.0.1' })
      const fin = (v) => {
        s.destroy()
        ok(v)
      }
      s.setTimeout(500, () => fin(false))
      s.on('connect', () => fin(true))
      s.on('error', () => fin(false))
    })
  return Promise.all([4191, 4192, 4193, 4194, 4195, 4196, 4197, 4198, 4199].map(async (p) => ((await sonde(p)) ? p : 0))).then((l) =>
    l.filter(Boolean),
  )
}

// ---------- briques ----------
async function briqueLint() {
  const r = await lancer(BIN.oxlint, ['-f', 'json', '--deny-warnings'])
  const lignes = []
  let n = 0
  try {
    const j = JSON.parse(r.out)
    for (const d of j.diagnostics ?? []) {
      n++
      const l = d.labels?.[0]?.span
      lignes.push(`  ${d.filename}:${l?.line ?? '?'}  ${d.code}  ${d.message}`)
    }
  } catch {
    return { ok: false, ms: r.ms, resume: 'lint : sortie illisible', details: [sansCouleur(r.out + r.err).split('\n').slice(0, 10).join('\n')] }
  }
  if (n === 0 && r.code === 0) return { ok: true, ms: r.ms, resume: `lint : propre (${secondes(r.ms)})`, details: [] }
  return {
    ok: r.code === 0, // `--deny-warnings` : un avertissement fait quitter oxlint en 1
    ms: r.ms,
    resume: `lint : ${n} avertissement${n > 1 ? 's' : ''} (${secondes(r.ms)})`,
    details: lignes.length > 15 ? [...lignes.slice(0, 15), `  et ${lignes.length - 15} autres`] : lignes,
  }
}

async function briqueDocuments() {
  const [cites, carte] = await Promise.all([lancer(join(RACINE, 'outils', 'docs-cites.mjs'), []), lancer(join(RACINE, 'outils', 'docs-inventaire.mjs'), [])])
  const ms = Math.max(cites.ms, carte.ms)
  if (cites.code === 0 && carte.code === 0) return { ok: true, ms, resume: `documents : renvois et carte des fichiers à jour (${secondes(ms)})`, details: [] }
  const details = [cites, carte]
    .filter((x) => x.code !== 0)
    .flatMap((x) => sansCouleur(x.out + x.err).trim().split('\n').slice(0, 20))
  return { ok: false, ms, resume: `documents : renvois faux (${secondes(ms)})`, details }
}

async function briqueTsc() {
  const r = await lancer(BIN.tsc, ['-b'])
  if (r.code === 0) return { ok: true, ms: r.ms, details: [] }
  const erreurs = sansCouleur(r.out + r.err)
    .split('\n')
    .filter((l) => /error TS\d+/.test(l))
    .map((l) => '  ' + l.trim())
  return { ok: false, ms: r.ms, details: erreurs.length ? erreurs : [sansCouleur(r.out + r.err).trim()] }
}

async function briqueBuild() {
  const t = await briqueTsc()
  if (!t.ok) return { ok: false, ms: t.ms, resume: `build : typecheck en échec (${secondes(t.ms)})`, details: t.details }
  const r = await lancer(BIN.vite, ['build', '--logLevel', 'error'])
  const ms = t.ms + r.ms
  if (r.code === 0) return { ok: true, ms, resume: `build : ok (${secondes(ms)})`, details: [] }
  return {
    ok: false,
    ms,
    resume: `build : vite en échec (${secondes(ms)})`,
    details: sansCouleur(r.out + r.err).trim().split('\n').slice(0, 15).map((l) => '  ' + l),
  }
}

async function briqueTypecheck() {
  const t = await briqueTsc()
  return {
    ok: t.ok,
    ms: t.ms,
    resume: t.ok ? `typecheck : ok (${secondes(t.ms)})` : `typecheck : ${t.details.length} erreur${t.details.length > 1 ? 's' : ''} (${secondes(t.ms)})`,
    details: t.ok ? [] : t.details,
  }
}

async function briqueTests(ports) {
  const json = join(tmpdir(), `verif-vitest-${process.pid}.json`)
  const ordre = GRAINE === null ? [] : ['--sequence.shuffle', `--sequence.seed=${GRAINE}`]
  const argv = ['run', ...(rapide ? ['--changed'] : []), ...ordre, '--reporter=dot', '--reporter=json', `--outputFile.json=${json}`, ...motifs]
  const r = await lancer(BIN.vitest, argv)
  let j = null
  try {
    j = JSON.parse(readFileSync(json, 'utf8'))
  } catch {
    /* pas de JSON : vitest n'a pas démarré */
  }
  rmSync(json, { force: true })
  const bavardage = sansCouleur(r.out + r.err)
  if (!j) {
    // Aucun rapport (vitest planté, rien à tester avec --changed…).
    if (rapide && /No test files found|no tests? found/i.test(bavardage)) {
      return { ok: true, ms: r.ms, resume: `tests : aucun fichier concerné (${secondes(r.ms)})`, details: [], noms: [] }
    }
    const details = bavardage.trim().split('\n').slice(-12).map((l) => '  ' + l)
    if (ports.length) details.unshift(`  un serveur du banc tourne sur ${ports.join(', ')} : vitest peut échouer`)
    if (GRAINE !== null) details.push(`  ordre mélangé, graine ${GRAINE} (VERIF_GRAINE=${GRAINE} pour la reprendre)`)
    return { ok: false, ms: r.ms, resume: `tests : vitest n'a pas rendu de rapport (${secondes(r.ms)})`, details, noms: [] }
  }

  const noms = []
  const echecs = []
  const fichiersEnEchec = []
  for (const f of j.testResults ?? []) {
    const fichier = relatif(f.name)
    const tests = f.assertionResults ?? []
    for (const t of tests) {
      const nom = [...(t.ancestorTitles ?? []), t.title].join(' > ')
      noms.push(`${fichier} > ${nom}`)
      if (t.status === 'failed') echecs.push({ fichier, nom, msg: (t.failureMessages ?? []).join('\n') })
    }
    // Fichier sans test en échec mais en échec lui-même : erreur de collecte (import cassé…).
    if (f.status === 'failed' && !tests.some((t) => t.status === 'failed')) fichiersEnEchec.push({ fichier, msg: f.message ?? '' })
  }
  noms.sort()

  const nbFichiers = (j.testResults ?? []).length
  const passes = j.numPassedTests ?? 0
  const details = []
  const tousEnEchec = nbFichiers > 1 && fichiersEnEchec.length === nbFichiers
  if (ports.length) details.push(`  un serveur du banc tourne sur ${ports.join(', ')} : vitest peut échouer`)
  if (tousEnEchec) {
    details.push(`  vitest échoue sur les ${nbFichiers} fichiers d'un coup (souvent « reading 'config' ») : relancer dans un instant`)
  } else {
    const bloc = (titre, msg) => {
      const l = sansCouleur(msg).split('\n').filter((x) => x.trim() !== '' && !x.includes('node_modules') && !/^\s*at (new Promise|runWith)/.test(x))
      return [`  ${titre}`, ...l.slice(0, LIGNES_PAR_TEST).map((x) => '    ' + x.trim().slice(0, 160))]
    }
    const detail = [
      ...fichiersEnEchec.map((f) => bloc(`${f.fichier} (erreur de collecte)`, f.msg)),
      ...echecs.map((e) => bloc(`${e.fichier} > ${e.nom}`, e.msg)),
    ]
    for (const b of detail.slice(0, MAX_TESTS_DETAILLES)) details.push(...b)
    if (detail.length > MAX_TESTS_DETAILLES) details.push(`  et ${detail.length - MAX_TESTS_DETAILLES} autres`)
  }
  const nbEchecs = echecs.length + fichiersEnEchec.length
  // Le code de sortie compte aussi : une erreur hors test (rejet de promesse après un test, `afterAll` qui lance,
  // « Vitest caught N unhandled errors ») fait quitter vitest en 1 alors que le JSON dit `success: true`.
  const horsTest = nbEchecs === 0 && j.success !== false && r.code !== 0
  if (horsTest) {
    details.push(`  vitest a quitté en code ${r.code} sans test en échec (erreur hors test) :`)
    const lignes = sansCouleur(r.err + '\n' + r.out).split('\n').filter((x) => x.trim() !== '' && !x.includes('node_modules'))
    details.push(...lignes.slice(-LIGNES_PAR_TEST).map((x) => '    ' + x.trim().slice(0, 160)))
  }
  const ok = nbEchecs === 0 && j.success !== false && r.code === 0
  if (!ok && GRAINE !== null) {
    details.push(`  ordre mélangé, graine ${GRAINE} : le même ordre se rejoue par « set VERIF_GRAINE=${GRAINE}&& npm run verif »,`)
    details.push(`  ou par « npx vitest run --sequence.shuffle --sequence.seed=${GRAINE} --maxWorkers=1 » (un seul processus)`)
  }
  const resume = ok
    ? `tests : ${milliers(passes)} passés (${nbFichiers} fichiers) en ${secondes(r.ms)}`
    : horsTest
      ? `tests : erreur hors test (code ${r.code}), ${milliers(passes)} passés (${nbFichiers} fichiers) en ${secondes(r.ms)}`
      : `tests : ${nbEchecs} échec${nbEchecs > 1 ? 's' : ''}, ${milliers(passes)} passés (${nbFichiers} fichiers) en ${secondes(r.ms)}`
  return { ok, ms: r.ms, resume, details, noms }
}

// ---------- programme ----------
const debut = performance.now()
const ports = await portsDuBanc()
const [lint, construction, tests, documents] = await Promise.all([briqueLint(), rapide ? briqueTypecheck() : briqueBuild(), briqueTests(ports), briqueDocuments()])

if (fichierNoms) writeFileSync(fichierNoms, tests.noms.join('\n') + '\n', 'utf8')

const sortie = []
for (const b of [lint, tests, construction, documents]) {
  sortie.push(b.resume)
  sortie.push(...b.details)
}
sortie.push(`total : ${secondes(performance.now() - debut)}`)
console.log(sortie.join('\n'))
process.exit(lint.ok && tests.ok && construction.ok && documents.ok ? 0 : 1)
