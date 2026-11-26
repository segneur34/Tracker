import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CANAUX_MEMOIRE } from './memoire'
import { ORIGINE } from './origine'
import type { EvenementPont, Gestionnaire } from './pont'
import { brancherCanaux, enReponse, expediteurAdmis, reussite, uneALaFois } from './pont'
import { ErreurDisque } from './disque'
import { CANAUX_TELEPHONE, dossierLocal, gestionnairesTelephone } from './telephone'

const page = { nom: 'contenu de la fenêtre principale' }
const tete = { url: `${ORIGINE}/sessions`, parent: null }

describe('expediteurAdmis', () => {
  it('admet le cadre de tête de la page de l’application dans la fenêtre principale', () => {
    expect(expediteurAdmis({ sender: page, senderFrame: tete }, page)).toBe(true)
  })

  it('refuse un autre contenu, une autre adresse, un cadre intégré, un cadre disparu, une fenêtre fermée', () => {
    expect(expediteurAdmis({ sender: { nom: 'autre' }, senderFrame: tete }, page)).toBe(false)
    expect(expediteurAdmis({ sender: page, senderFrame: { url: 'https://exemple.org/', parent: null } }, page)).toBe(false)
    expect(expediteurAdmis({ sender: page, senderFrame: { url: 'https://tracker.localhost.exemple.org/', parent: null } }, page)).toBe(false)
    expect(expediteurAdmis({ sender: page, senderFrame: { url: `${ORIGINE}/`, parent: tete } }, page)).toBe(false)
    expect(expediteurAdmis({ sender: page, senderFrame: null }, page)).toBe(false)
    expect(expediteurAdmis({ sender: page, senderFrame: tete }, null)).toBe(false)
  })
})

describe('brancherCanaux', () => {
  function brancher(gestionnaires: Record<string, Gestionnaire>, admis: boolean) {
    const servis = new Map<string, (e: EvenementPont, ...args: unknown[]) => Promise<unknown>>()
    const journal: string[] = []
    brancherCanaux({ handle: (canal, rappel) => servis.set(canal, rappel) }, () => admis, gestionnaires, (m) => journal.push(m))
    return { servis, journal }
  }
  const evenement: EvenementPont = { sender: page, senderFrame: tete }

  it('passe le premier argument au gestionnaire et rend sa réponse', async () => {
    const recus: unknown[] = []
    const { servis } = brancher({ 'memoire:lister': async (a) => (recus.push(a), reussite([])) }, true)
    expect(await servis.get('memoire:lister')!(evenement, { racine: 'memoire', chemin: '' }, 'de trop')).toEqual({ ok: true, valeur: [] })
    expect(recus).toEqual([{ racine: 'memoire', chemin: '' }])
  })

  it('refuse un expéditeur inconnu sans appeler le gestionnaire', async () => {
    let appele = false
    const { servis, journal } = brancher({ 'memoire:ouvrir': async () => ((appele = true), reussite(null)) }, false)
    expect(await servis.get('memoire:ouvrir')!(evenement)).toMatchObject({ ok: false, code: 'PERMISSION' })
    expect(appele).toBe(false)
    expect(journal).toHaveLength(1)
  })

  it('ne laisse passer aucune exception', async () => {
    const { servis } = brancher({ 'memoire:stat': async () => Promise.reject(new Error('imprévu')) }, true)
    expect(await servis.get('memoire:stat')!(evenement, {})).toEqual({ ok: false, code: 'UNKNOWN', message: 'imprévu' })
  })
})

describe('enReponse', () => {
  it('met une erreur du disque en code et phrase', async () => {
    expect(await enReponse(async () => Promise.reject(new ErreurDisque('NO_SPACE', 'plus de place')))).toEqual({ ok: false, code: 'NO_SPACE', message: 'plus de place' })
    expect(await enReponse(async () => 3)).toEqual({ ok: true, valeur: 3 })
  })
})

describe('uneALaFois', () => {
  it('rend la même promesse tant que l’action tourne, puis relance', async () => {
    let lancements = 0
    let finir: (v: string) => void = () => undefined
    const action = uneALaFois((_a: number) => {
      lancements++
      return new Promise<string>((fin) => (finir = fin))
    })
    const a = action(1)
    const b = action(2)
    expect(b).toBe(a)
    finir('un')
    expect(await b).toBe('un')
    const c = action(3)
    expect(c).not.toBe(a)
    finir('deux')
    expect(await c).toBe('deux')
    expect(lancements).toBe(2)
  })

  it('relance aussi après un échec', async () => {
    let lancements = 0
    const action = uneALaFois(async () => {
      lancements++
      throw new Error('raté')
    })
    await expect(action(undefined)).rejects.toThrow('raté')
    await expect(action(undefined)).rejects.toThrow('raté')
    expect(lancements).toBe(2)
  })
})

describe('preload', () => {
  it('nomme les canaux du téléphone comme ses gestionnaires', () => {
    const servis = Object.keys(gestionnairesTelephone(dossierLocal(null), '.'))
    expect(servis).toEqual(CANAUX_TELEPHONE.map((nom) => `telephone:${nom}`))
  })

  it('expose exactement les canaux servis par la mémoire et le téléphone (aucun effacement), une fonction chacun, sans ipcRenderer tel quel', () => {
    const source = readFileSync(path.join(__dirname, 'preload.ts'), 'utf8')
    const canaux = [...source.matchAll(/'memoire:([A-Za-z]+)'/g)].map((m) => m[1])
    expect(canaux).toEqual([...CANAUX_MEMOIRE])
    for (const nom of CANAUX_MEMOIRE) expect(source).toMatch(new RegExp(`\\b${nom}: (sans|avec)\\('memoire:${nom}'\\)`))
    const telephone = [...source.matchAll(/'telephone:([A-Za-z]+)'/g)].map((m) => m[1])
    expect(telephone).toEqual([...CANAUX_TELEPHONE])
    expect(telephone).toEqual(['etat', 'lister', 'lireOctets', 'enregistrement', 'ecrireOctets', 'listerCorbeille', 'mettreDeCote', 'copieSecurite', 'copieExiste'])
    // Le téléphone n'a aucun canal d'effacement : un retrait est une mise de côté dans sa corbeille.
    expect(telephone.filter((nom) => /effac|suppr|retir|rm/i.test(nom))).toEqual([])
    for (const nom of CANAUX_TELEPHONE) expect(source).toMatch(new RegExp(`\\b${nom}: (sans|avec)\\('telephone:${nom}'\\)`))
    expect(source).toMatch(/^\s+telephone,$/m)
    // Les textes de la coquille restent en français, écrits dans `main.ts` : aucun canal de textes ; deux seuls appels à `invoke` (`sans`, `avec`).
    expect(source.match(/ipcRenderer\.invoke\(/g)).toHaveLength(2)
    // Seuls canaux de la coquille : la demande de vider les écritures avant la fermeture, et sa réponse (lot 232).
    expect([...new Set([...source.matchAll(/'(coquille:[A-Za-z]+)'/g)].map((m) => m[1]))].sort()).toEqual(['coquille:fermeture', 'coquille:fermeturePrete'])
    expect(source).toContain("ipcRenderer.on('coquille:fermeture',")
    expect(source).toContain("ipcRenderer.send('coquille:fermeturePrete')")
    expect(source).toMatch(/surFermeture: \(rappel/)
    expect(source).not.toMatch(/exposeInMainWorld\([^)]*ipcRenderer/)
    expect(source).not.toMatch(/from '\.\//)
  })
})
