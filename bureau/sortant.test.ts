import { describe, expect, it } from 'vitest'
import { ORIGINE } from './origine'
import { entetesSortants, estUnRefus, nomDuProgramme } from './sortant'

describe('entetesSortants', () => {
  it('se présente par le nom et la version du programme, avec l\'adresse de l\'application en Referer', () => {
    const e = entetesSortants({ accept: 'image/png' }, '1.0.09')
    expect(e.get('user-agent')).toBe('Tracker/1.0.09')
    expect(e.get('referer')).toBe(`${ORIGINE}/`)
    expect(e.get('accept')).toBe('image/png')
  })

  it('remplace le User-Agent d\'Electron et un Referer déjà présent, quelle que soit la casse', () => {
    const e = entetesSortants(
      [
        ['User-Agent', 'Mozilla/5.0 Electron/45.3.4 Safari/537.36'],
        ['REFERER', 'https://ailleurs.example/'],
      ],
      '1.0.09',
    )
    expect(e.get('user-agent')).toBe(nomDuProgramme('1.0.09'))
    expect(e.get('referer')).toBe(`${ORIGINE}/`)
    expect([...e.keys()].filter((k) => k === 'user-agent' || k === 'referer')).toHaveLength(2)
  })

  it('ne porte rien de personnel : ni courriel, ni adresse de dépôt, ni nom', () => {
    const texte = JSON.stringify([...entetesSortants({}, '1.0.09')])
    expect(texte).not.toMatch(/@|github|mailto/i)
  })
})

describe('estUnRefus', () => {
  it('reconnaît le refus d\'OpenStreetMap servi en statut 200 par son en-tête', () => {
    expect(estUnRefus(new Headers({ 'X-Blocked': 'Access denied. See https://operations.osmfoundation.org/policies/tiles/' }))).toBe(true)
  })

  it('laisse passer une vraie réponse', () => {
    expect(estUnRefus(new Headers({ 'content-type': 'image/png' }))).toBe(false)
  })
})
