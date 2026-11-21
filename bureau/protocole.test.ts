import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CSP, cheminDansDist, reponseA, typeDuFichier } from './protocole'

const DIST = path.resolve('/essai/dist')
const FICHIERS = new Set([path.join(DIST, 'index.html'), path.join(DIST, 'assets', 'index-abc.js'), path.join(DIST, 'favicon.svg')])
const estUnFichier = (chemin: string) => FICHIERS.has(chemin)

describe('cheminDansDist', () => {
  it('rend le fichier de dist pour un chemin ordinaire', () => {
    expect(cheminDansDist(DIST, '/assets/index-abc.js')).toBe(path.join(DIST, 'assets', 'index-abc.js'))
    expect(cheminDansDist(DIST, '/dossier%20avec%20espace/a.js')).toBe(path.join(DIST, 'dossier avec espace', 'a.js'))
  })

  it('refuse un chemin qui remonte, même encodé', () => {
    expect(cheminDansDist(DIST, '/../secret.txt')).toBeNull()
    expect(cheminDansDist(DIST, '/assets/../../secret.txt')).toBeNull()
    expect(cheminDansDist(DIST, '/%2e%2e/secret.txt')).toBeNull()
    expect(cheminDansDist(DIST, '/assets/%2E%2E%2F%2E%2E%2Fsecret.txt')).toBeNull()
    expect(cheminDansDist(DIST, '/./index.html')).toBeNull()
  })

  it('refuse une lettre de lecteur, un chemin absolu de Windows, un flux de fichier', () => {
    expect(cheminDansDist(DIST, '/C:/Windows/win.ini')).toBeNull()
    expect(cheminDansDist(DIST, '/c%3A%5CWindows%5Cwin.ini')).toBeNull()
    expect(cheminDansDist(DIST, '/%5C%5Cserveur%5Cpartage')).toBeNull()
    expect(cheminDansDist(DIST, '/index.html:flux')).toBeNull()
  })

  it('refuse un caractère nul et un encodage illisible', () => {
    expect(cheminDansDist(DIST, '/index.html%00.png')).toBeNull()
    expect(cheminDansDist(DIST, '/%E0%A4%A')).toBeNull()
  })

  it('ramène plusieurs barres obliques à une seule', () => {
    expect(cheminDansDist(DIST, '//assets//index-abc.js')).toBe(path.join(DIST, 'assets', 'index-abc.js'))
  })
})

describe('reponseA', () => {
  it('sert un fichier existant avec son type, sans CSP', () => {
    expect(reponseA(DIST, '/assets/index-abc.js', estUnFichier)).toEqual({
      statut: 200,
      fichier: path.join(DIST, 'assets', 'index-abc.js'),
      type: 'text/javascript; charset=utf-8',
      csp: false,
    })
  })

  it('rend index.html, avec la CSP, pour la racine et toute adresse de l’application', () => {
    const accueil = { statut: 200, fichier: path.join(DIST, 'index.html'), type: 'text/html; charset=utf-8', csp: true }
    expect(reponseA(DIST, '/', estUnFichier)).toEqual(accueil)
    expect(reponseA(DIST, '/index.html', estUnFichier)).toEqual(accueil)
    expect(reponseA(DIST, '/voile/analyse', estUnFichier)).toEqual(accueil)
    expect(reponseA(DIST, '/sessions/', estUnFichier)).toEqual(accueil)
  })

  it('pose la CSP sur toute page HTML, quelle que soit la casse de son nom', () => {
    // Disque de Windows : la casse du nom ne compte pas.
    const sansCasse = (chemin: string) => [...FICHIERS].some((f) => f.toLowerCase() === chemin.toLowerCase())
    expect(reponseA(DIST, '/INDEX.HTML', sansCasse)).toEqual({
      statut: 200,
      fichier: path.join(DIST, 'INDEX.HTML'),
      type: 'text/html; charset=utf-8',
      csp: true,
    })
    expect(reponseA(DIST, '/Index.Html', sansCasse)).toMatchObject({ statut: 200, csp: true })
  })

  it('répond 404 à un fichier absent, sans repli sur la page d’accueil', () => {
    expect(reponseA(DIST, '/assets/absent-123.js', estUnFichier)).toEqual({ statut: 404 })
  })

  it('répond 403 à un chemin refusé', () => {
    expect(reponseA(DIST, '/../package.json', estUnFichier)).toEqual({ statut: 403 })
    expect(reponseA(DIST, '/C:/Windows', estUnFichier)).toEqual({ statut: 403 })
  })
})

describe('typeDuFichier et CSP', () => {
  it('donne le type des fichiers de dist, octets bruts sinon', () => {
    expect(typeDuFichier('a.CSS')).toBe('text/css; charset=utf-8')
    expect(typeDuFichier('a.woff2')).toBe('font/woff2')
    expect(typeDuFichier('_redirects')).toBe('application/octet-stream')
  })

  it('n’autorise aucun script hors de l’application', () => {
    expect(CSP).toContain("script-src 'self';")
    expect(CSP).not.toMatch(/unsafe-eval/)
    expect(CSP).toContain("worker-src 'self' blob:")
  })
})
