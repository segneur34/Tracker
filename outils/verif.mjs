// Vérification en une commande : lint, tests et build (ou typecheck) lancés ensemble, sortie courte.
//
//   node outils/verif.mjs                      complet : lint + vitest run + (tsc -b && vite build)
//   node outils/verif.mjs --rapide             tsc -b + lint + vitest run --changed (sans build)
//   node outils/verif.mjs --noms <fichier>     écrit aussi la liste triée « fichier > describe > test »
//   node outils/verif.mjs --tests <motifs…>    passe les motifs (fichiers ou noms) à vitest
//
// Tout passe : 4 ou 5 lignes. Sinon : seulement les échecs. Code de sortie 1 si un outil échoue (les avertissements
// de lint sont montrés mais ne font pas échouer, comme `npm run lint`). Sans dépendance.

import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Racine du dépôt, lettre de lecteur en capitale : un dossier courant « c:\… » fait échouer vitest.
let RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
RACINE = RACINE.replace(/^[a-z]:/, (l) => l.toUpperCase())

const BIN = {
  vitest: join(RACINE, 'node_modules', 'vitest', 'vitest.mjs'),
  oxlint: join(RACINE, 'node_modules', 'oxlint', 'bin', 'oxlint'),
  tsc: join(RACINE, 'node_modules', 'typescript', 'bin', 'tsc'),
  vite: join(RACINE, 'node_modules', 'vite', 'bin', 'vite.js'),
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
  const r = await lancer(BIN.oxlint, ['-f', 'json'])
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
    ok: r.code === 0, // avertissements seuls : montrés, sans échec
    ms: r.ms,
    resume: `lint : ${n} avertissement${n > 1 ? 's' : ''} (${secondes(r.ms)})`,
    details: lignes.length > 15 ? [...lignes.slice(0, 15), `  et ${lignes.length - 15} autres`] : lignes,
  }
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
  const argv = ['run', ...(rapide ? ['--changed'] : []), '--reporter=dot', '--reporter=json', `--outputFile.json=${json}`, ...motifs]
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
const [lint, construction, tests] = await Promise.all([briqueLint(), rapide ? briqueTypecheck() : briqueBuild(), briqueTests(ports)])

if (fichierNoms) writeFileSync(fichierNoms, tests.noms.join('\n') + '\n', 'utf8')

const sortie = []
for (const b of [lint, tests, construction]) {
  sortie.push(b.resume)
  sortie.push(...b.details)
}
sortie.push(`total : ${secondes(performance.now() - debut)}`)
console.log(sortie.join('\n'))
process.exit(lint.ok && tests.ok && construction.ok ? 0 : 1)
