import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PAQUETS_APPAIRAGE, ecartsDeVersion, environnementPropre, paquetDeLaCoquille, versionBureau, versionInstallee } from './bureau.mjs'

describe('versions des paquets de l’appairage', () => {
  let tmp = ''
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true })
    tmp = ''
  })

  /** Une racine et son dossier `bureau/`, chacun avec les paquets donnés (nom → version). */
  function arbre(racine, bureau) {
    tmp = mkdtempSync(join(tmpdir(), 'trk-noble-'))
    const poser = (dossier, paquets) => {
      for (const [nom, version] of Object.entries(paquets)) {
        mkdirSync(join(dossier, 'node_modules', nom), { recursive: true })
        writeFileSync(join(dossier, 'node_modules', nom, 'package.json'), JSON.stringify({ name: nom, version }))
      }
    }
    mkdirSync(join(tmp, 'bureau'), { recursive: true })
    poser(tmp, racine)
    poser(join(tmp, 'bureau'), bureau)
    return { racine: tmp, bureau: join(tmp, 'bureau') }
  }

  it('vise les deux paquets du calcul de l’appairage', () => {
    expect(PAQUETS_APPAIRAGE).toEqual(['@noble/curves', '@noble/hashes'])
  })

  it('accepte une même version, prise dans bureau/ ou remontée de la racine', () => {
    const { racine, bureau } = arbre({ '@noble/curves': '2.4.0', '@noble/hashes': '2.4.0' }, { '@noble/hashes': '2.4.0' })
    expect(versionInstallee('@noble/curves', bureau)).toBe('2.4.0')
    expect(ecartsDeVersion(bureau, racine)).toEqual([])
  })

  it('arrête la construction sur une autre version dans bureau/, ou sur un paquet absent', () => {
    const { racine, bureau } = arbre({ '@noble/curves': '2.4.0', '@noble/hashes': '2.4.0' }, { '@noble/hashes': '1.8.0' })
    expect(ecartsDeVersion(bureau, racine)).toEqual([expect.stringMatching(/^@noble\/hashes : version 1\.8\.0 prise depuis bureau\/, 2\.4\.0 à la racine/)])
    expect(ecartsDeVersion(bureau, racine, ['@noble/absent'])).toEqual([expect.stringMatching(/version absente prise depuis bureau\/, absente à la racine/)])
  })
})

describe('versionBureau', () => {
  it('retire les zéros en tête de chaque nombre', () => {
    expect(versionBureau('1.0.09')).toBe('1.0.9')
    expect(versionBureau('0.01.40')).toBe('0.1.40')
    expect(versionBureau('0.10.05')).toBe('0.10.5')
    expect(versionBureau('0.01.00')).toBe('0.1.0')
    expect(versionBureau('1.02.03')).toBe('1.2.3')
  })

  it('laisse une version déjà propre telle quelle', () => {
    expect(versionBureau('0.10.40')).toBe('0.10.40')
    expect(versionBureau(' 2.0.0 ')).toBe('2.0.0')
  })

  it('refuse une version qui n’a pas trois nombres', () => {
    expect(() => versionBureau('0.01')).toThrow(/illisible/)
    expect(() => versionBureau('0.01.40-essai')).toThrow(/illisible/)
    expect(() => versionBureau('')).toThrow(/illisible/)
  })
})

describe('paquetDeLaCoquille', () => {
  it('porte la version convertie et la version affichée', () => {
    const p = paquetDeLaCoquille('1.0.09')
    expect(p.version).toBe('1.0.9')
    expect(p.trackerVersion).toBe('1.0.09')
    expect(p.productName).toBe('Tracker')
    expect(p.main).toBe('main.js')
  })
})

describe('environnementPropre', () => {
  it('retire ELECTRON_RUN_AS_NODE, quelle que soit sa casse, sans toucher au reste', () => {
    const env = { ELECTRON_RUN_AS_NODE: '1', Electron_Run_As_Node: '1', TRACKER_BANC: '1' }
    expect(environnementPropre(env)).toEqual({ TRACKER_BANC: '1' })
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1')
  })
})
