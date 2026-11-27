import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXE_DEFAUT, J_DEFAUT, PORTS_PRIS_AILLEURS, PORTS_RESERVES, SCRIPTS_EXE, choisirScripts, duree, lireArguments, lireVerdict, repartir, texteListe } from './exe-tous.mjs'

const BANC = join(process.cwd(), 'outils', 'banc')
/** Port par défaut écrit dans un script (`Number(portArg ?? 9630)`). */
const portParDefaut = (fichier) => Number(/Number\(portArg \?\? (\d+)\)/.exec(readFileSync(join(BANC, fichier), 'utf8'))?.[1])

describe('lireArguments', () => {
  it('sans rien : tous les scripts, le programme par défaut, le -j par défaut', () => {
    expect(lireArguments([])).toEqual({ exe: null, noms: [], j: J_DEFAUT, liste: false, garder: false, arreterApres: null })
  })
  it('programme reconnu à son .exe, où qu’il soit, et noms', () => {
    const o = lireArguments(['memoire', 'C:\\x\\Tracker.EXE', 'fermeture', '-j', '2'])
    expect(o.exe).toBe('C:\\x\\Tracker.EXE')
    expect(o.noms).toEqual(['memoire', 'fermeture'])
    expect(o.j).toBe(2)
  })
  it('refuse un -j faux, une option inconnue, deux programmes', () => {
    expect(() => lireArguments(['-j', '0'])).toThrow(/-j/)
    expect(() => lireArguments(['-j'])).toThrow(/attend une valeur/)
    expect(() => lireArguments(['--vite'])).toThrow(/inconnue/)
    expect(() => lireArguments(['a.exe', 'b.exe'])).toThrow(/deux programmes/)
  })
  it('--liste, --garder et --arreter-apres', () => {
    const o = lireArguments(['--liste', '--garder', '--arreter-apres', '20'])
    expect([o.liste, o.garder, o.arreterApres]).toEqual([true, true, 20])
  })
})

describe('choisirScripts', () => {
  it('tous sans nom, dans l’ordre de la table', () => {
    expect(choisirScripts([]).map((e) => e.nom)).toEqual(SCRIPTS_EXE.map((e) => e.nom))
  })
  it('par nom court ou nom de fichier, sans doublon, dans l’ordre de la table', () => {
    const noms = choisirScripts(['exe-fermeture.mjs', 'memoire-disque', 'synchroniser', 'exe-synchroniser']).map((e) => e.nom)
    expect(noms).toEqual(['synchroniser', 'memoire', 'fermeture'])
  })
  it('refuse un nom inconnu en citant les connus', () => {
    expect(() => choisirScripts(['tuiles'])).toThrow(/inconnu.*fermeture/)
  })
  it('refuse le script du vrai téléphone, en disant pourquoi', () => {
    expect(() => choisirScripts(['exe-synchroniser-essai'])).toThrow(/vrai téléphone/)
  })
})

describe('table du lanceur', () => {
  it('un port de débogage par script, aucun port partagé', () => {
    const ports = SCRIPTS_EXE.flatMap((e) => [e.port, ...(e.fixes ?? [])])
    expect(new Set(ports).size).toBe(ports.length)
  })
  it('aucun port pris par le banc de Gtracker, les sondes ou une réserve', () => {
    for (const e of SCRIPTS_EXE) {
      for (const p of [e.port, ...(e.fixes ?? [])]) {
        expect(PORTS_PRIS_AILLEURS).not.toContain(p)
        expect(Object.keys(PORTS_RESERVES).map(Number)).not.toContain(p)
      }
    }
  })
  it('chaque script prend par défaut le port de sa ligne ; celui du vrai téléphone, sa réserve', () => {
    for (const e of SCRIPTS_EXE) expect(portParDefaut(e.fichier), e.fichier).toBe(e.port)
    expect(PORTS_RESERVES[portParDefaut('exe-synchroniser-essai.mjs')]).toMatch(/exe-synchroniser-essai/)
  })
  it('jamais le script du vrai téléphone, ni ceux de passe.mjs --exe', () => {
    const fichiers = SCRIPTS_EXE.map((e) => e.fichier)
    for (const f of ['exe-synchroniser-essai.mjs', 'exe-import.mjs', 'exe-tuiles.mjs']) expect(fichiers).not.toContain(f)
  })
  it('le programme par défaut est celui de npm run exe', () => {
    expect(EXE_DEFAUT.replaceAll('\\', '/')).toBe('bureau/sortie/Tracker-win32-x64/Tracker.exe')
  })
  it('--liste nomme chaque script et ses fichiers', () => {
    const t = texteListe()
    for (const e of SCRIPTS_EXE) expect(t).toContain(`${e.nom} (${e.fichier}`)
    expect(t).toContain('bureau/telephone.ts')
    expect(t).toMatch(/fermeture \(exe-fermeture\.mjs.*bureau\/main\.ts/)
    expect(t).toMatch(/exe-synchroniser-essai\.mjs \(vrai téléphone/)
  })
})

describe('repartir', () => {
  const t = [
    { nom: 'a', duree: 10 }, { nom: 'b', duree: 50, seul: true }, { nom: 'c', duree: 30 }, { nom: 'd', duree: 20, seul: true },
  ]
  it('les plus longs d’abord côte à côte, les « seul » à part dans l’ordre donné', () => {
    const r = repartir(t)
    expect(r.ensemble.map((e) => e.nom)).toEqual(['c', 'a'])
    expect(r.seuls.map((e) => e.nom)).toEqual(['b', 'd'])
  })
})

describe('lireVerdict', () => {
  const sortie = (...l) => l.join('\r\n')
  it('code 0, lignes ok seules : réussi', () => {
    const v = lireVerdict(sortie('ok    un', 'ok    deux', '', 'Tout passe.'), 0)
    expect(v).toMatchObject({ verdict: 'ok', reussis: 2, rates: 0 })
  })
  it('code 1 avec des ÉCHEC : échec, lignes gardées', () => {
    const v = lireVerdict(sortie('ok    un', 'ÉCHEC deux (3)', '', '1 échec(s).'), 1)
    expect(v).toMatchObject({ verdict: 'échec', reussis: 1, rates: 1, echecs: ['ÉCHEC deux (3)'] })
  })
  it('sans verdict : exception (code 1 sans ÉCHEC), arrêt (code nul), code 0 sans contrôle ou avec un ÉCHEC', () => {
    expect(lireVerdict(sortie('ok    un'), 1).verdict).toBe('sans verdict')
    expect(lireVerdict(sortie('ok    un'), null).verdict).toBe('sans verdict')
    expect(lireVerdict('Tout passe.', 0).verdict).toBe('sans verdict')
    expect(lireVerdict(sortie('ok    un', 'ÉCHEC deux'), 0).verdict).toBe('sans verdict')
  })
  it('une ligne qui ne commence pas par ok ou ÉCHEC ne compte pas', () => {
    expect(lireVerdict(sortie('  ok dedans', 'okay', 'ok    vrai'), 0).reussis).toBe(1)
  })
})

describe('duree', () => {
  it('secondes puis minutes', () => {
    expect([duree(4_400), duree(59_000), duree(78_000), duree(720_000)]).toEqual(['4 s', '59 s', '1 min 18', '12 min 00'])
  })
})
