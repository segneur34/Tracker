import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { COPIE_ORDINATEUR, COPIE_TELEPHONE, copieSecurite, copieValable, nomCopie } from './copieSecurite'
import type { Reponse } from './pont'
import { dossierLocal, gestionnairesTelephone, type DossierDistant } from './telephone'

let tmp: string
let memoire: string
let stockage: string
let copies: string

const poser = async (fichier: string, contenu: string): Promise<void> => {
  await mkdir(path.dirname(fichier), { recursive: true })
  await writeFile(fichier, contenu, 'utf8')
}

/** Chemins relatifs de tout ce que porte un dossier, triés. */
const contenu = async (dossier: string): Promise<string[]> =>
  (await readdir(dossier, { recursive: true, withFileTypes: true })).filter((e) => e.isFile())
    .map((e) => path.relative(dossier, path.join(e.parentPath, e.name)).split(path.sep).join('/')).sort()

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'trk-copie-'))
  memoire = path.join(tmp, 'Documents', 'Tracker')
  stockage = path.join(tmp, 'telephone')
  copies = path.join(tmp, 'Documents', 'Tracker-copies')
  await poser(path.join(memoire, 'tracker.json'), '{"pc":1}')
  await poser(path.join(memoire, 'sessions', 'a.gpx'), '<gpx>a</gpx>')
  await poser(path.join(memoire, 'sessions', 'a.json.tracker-tmp'), 'provisoire')
  await poser(path.join(stockage, 'Documents', 'Tracker', 'tracker.json'), '{"tel":1}')
  await poser(path.join(stockage, 'Documents', 'Tracker', 'sessions', 'b.gpx'), '<gpx>b</gpx>')
  await poser(path.join(stockage, 'Documents', 'Tracker', 'itineraires', 'tour.json'), '{}')
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const MAINTENANT = new Date(2026, 10, 26, 14, 3, 12)

describe('copie de sécurité', () => {
  it('copie les deux dossiers entiers, à toute profondeur et provisoires compris, côte à côte, sous la date et l’heure', async () => {
    await poser(path.join(stockage, 'Documents', 'Tracker', 'corbeille', 'x', 'y', 'z.json'), 'profond')
    await poser(path.join(stockage, 'Documents', 'Tracker', 'synchro', 'base.json'), '{}')
    await poser(path.join(stockage, 'Documents', 'Tracker', 'sessions', 'c.gpx.tracker-new'), 'moitié')
    await poser(path.join(memoire, 'synchro', 'tel', 'fiches', '1-telephone.json'), '{}')
    const avant = await contenu(stockage)
    const dossier = await copieSecurite({ memoire, telephone: dossierLocal(stockage), copies, maintenant: MAINTENANT })
    expect(path.basename(dossier)).toBe('2026-11-26 14-03-12')
    expect(nomCopie(MAINTENANT)).toBe('2026-11-26 14-03-12')
    expect(await contenu(dossier)).toEqual([
      `${COPIE_ORDINATEUR}/sessions/a.gpx`, `${COPIE_ORDINATEUR}/sessions/a.json.tracker-tmp`, `${COPIE_ORDINATEUR}/synchro/tel/fiches/1-telephone.json`,
      `${COPIE_ORDINATEUR}/tracker.json`,
      `${COPIE_TELEPHONE}/corbeille/x/y/z.json`, `${COPIE_TELEPHONE}/itineraires/tour.json`, `${COPIE_TELEPHONE}/sessions/b.gpx`,
      `${COPIE_TELEPHONE}/sessions/c.gpx.tracker-new`, `${COPIE_TELEPHONE}/synchro/base.json`, `${COPIE_TELEPHONE}/tracker.json`,
    ])
    expect(await readFile(path.join(dossier, COPIE_TELEPHONE, 'sessions', 'b.gpx'), 'utf8')).toBe('<gpx>b</gpx>')
    // Le téléphone n'a rien reçu ; une seconde copie dans la même seconde ne touche pas à la première.
    expect(await contenu(stockage)).toEqual(avant)
    const seconde = await copieSecurite({ memoire, telephone: dossierLocal(stockage), copies, maintenant: MAINTENANT })
    expect(path.basename(seconde)).toBe('2026-11-26 14-03-12 (2)')
  })

  it('un fichier du téléphone que Windows ne peut pas recevoir : la copie échoue en le nommant, rien n’est créé', async () => {
    const telephone = dossierLocal(stockage)
    const tricheur: DossierDistant = {
      ...telephone,
      listerTout: async () => [...(await telephone.listerTout()), { chemin: 'sessions/a:b.gpx', taille: 1, dateMs: 0, ordinaire: true }],
    }
    await expect(copieSecurite({ memoire, telephone: tricheur, copies })).rejects.toThrow('« sessions/a:b.gpx » du téléphone ne peut pas être copié')
    const lien: DossierDistant = { ...telephone, listerTout: async () => [{ chemin: 'lien', taille: 0, dateMs: 0, ordinaire: false }] }
    await expect(copieSecurite({ memoire, telephone: lien, copies })).rejects.toThrow('« lien »')
    await expect(readdir(copies)).rejects.toThrow()
  })

  it('une lecture qui n’apporte pas tout : la relecture finale la refuse, sous « incomplète »', async () => {
    const telephone = dossierLocal(stockage)
    const tronque: DossierDistant = {
      ...telephone,
      lireBrut: async (fichier, local) => {
        await telephone.lireBrut(fichier, local)
        if (fichier.chemin === 'sessions/b.gpx') await writeFile(local, 'court')
      },
    }
    await expect(copieSecurite({ memoire, telephone: tronque, copies, maintenant: MAINTENANT })).rejects.toThrow('Copie de sécurité incomplète : « téléphone/sessions/b.gpx »')
    expect(await readdir(copies)).toEqual(['2026-11-26 14-03-12 incomplète'])
  })

  it('une copie n’est dite encore là que sous le dossier des copies, entière et non vide', async () => {
    const dossier = await copieSecurite({ memoire, telephone: dossierLocal(stockage), copies, maintenant: MAINTENANT })
    expect(await copieValable(dossier, copies)).toBe(true)
    expect(await copieValable(memoire, copies)).toBe(false)
    expect(await copieValable(path.join(copies, 'absente'), copies)).toBe(false)
    expect(await copieValable(`${dossier} incomplète`, copies)).toBe(false)
    const vide = path.join(copies, 'vide')
    await mkdir(path.join(vide, COPIE_ORDINATEUR), { recursive: true })
    await mkdir(path.join(vide, COPIE_TELEPHONE), { recursive: true })
    expect(await copieValable(vide, copies)).toBe(false)
    await rm(dossier, { recursive: true })
    expect(await copieValable(dossier, copies)).toBe(false)
  })

  it('refuse de ranger les copies dans la mémoire, ou au-dessus d’elle', async () => {
    for (const ici of [path.join(memoire, 'copies'), memoire, path.dirname(memoire)]) {
      await expect(copieSecurite({ memoire, telephone: dossierLocal(stockage), copies: ici })).rejects.toThrow('refusé')
    }
  })

  it('une copie coupée en route garde ce qu’elle a fait sous « incomplète », et le dit', async () => {
    await expect(copieSecurite({ memoire, telephone: dossierLocal(stockage, { coupureApres: 1 }), copies, maintenant: MAINTENANT })).rejects.toThrow()
    expect(await readdir(copies)).toEqual(['2026-11-26 14-03-12 incomplète'])
  })

  it('par le canal : refusée sans mémoire retenue ou sans dossier des copies, sinon rend son dossier', async () => {
    const canal = (options: Parameters<typeof gestionnairesTelephone>[2]) =>
      gestionnairesTelephone(dossierLocal(stockage), path.join(tmp, 'lectures'), options)['telephone:copieSecurite'](undefined) as Promise<Reponse<string>>
    expect(await canal({ memoire: async () => null, copies: async () => copies })).toMatchObject({ ok: false })
    expect(await canal({ memoire: async () => memoire })).toMatchObject({ ok: false })
    const fait = await canal({ memoire: async () => memoire, copies: async () => copies })
    expect(fait.ok && path.dirname(fait.valeur)).toBe(copies)
  })
})
