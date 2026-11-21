import { describe, expect, it } from 'vitest'
import { environnementPropre, paquetDeLaCoquille, versionBureau } from './bureau.mjs'

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
