import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Reponse } from './pont'
import type { DossierDistant, FichierTelephone } from './telephone'
import {
  CANAUX_TELEPHONE,
  NOM_TELEPHONE_ESSAI,
  cheminAdmis,
  commeLeTelephone,
  dossierLocal,
  fichiersAdmis,
  gestionnairesTelephone,
  telephoneDepuisEnvironnement,
  viderLectures,
} from './telephone'

let tmp: string
/** Mémoire partagée du téléphone d'essai (son `/sdcard`). */
let stockage: string
/** Son dossier `Documents/Tracker`. */
let racine: string
/** Dossier temporaire des lectures, côté PC. */
let lectures: string

/** Date fixe des fichiers du téléphone d'essai, à la seconde. */
const DATE = new Date('2026-11-18T19:47:33Z')

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'trk-telephone-'))
  stockage = path.join(tmp, 'telephone')
  racine = path.join(stockage, 'Documents', 'Tracker')
  lectures = path.join(tmp, 'profil', 'telephone-lecture')
  await mkdir(path.join(racine, 'sessions'), { recursive: true })
  await mkdir(path.join(racine, 'itineraires'), { recursive: true })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function poser(relatif: string, contenu: string, base = racine): Promise<void> {
  const fichier = path.join(base, ...relatif.split('/'))
  await mkdir(path.dirname(fichier), { recursive: true })
  await writeFile(fichier, contenu, 'utf8')
  await utimes(fichier, DATE, DATE)
}

function valeur<T>(r: Reponse<T>): T {
  if (!r.ok) throw new Error(`réponse en échec : ${r.code} ${r.message}`)
  return r.valeur
}

/** Taille, date et contenu de chaque fichier du téléphone d'essai, pour vérifier qu'il n'a pas bougé. */
async function empreinte(dossier: string): Promise<string[]> {
  const lignes: string[] = []
  for (const entree of await readdir(dossier, { withFileTypes: true, recursive: true })) {
    const complet = path.join(entree.parentPath, entree.name)
    const s = await stat(complet)
    lignes.push(`${path.relative(dossier, complet)} ${entree.isFile() ? `${s.size} ${s.mtimeMs} ${await readFile(complet, 'utf8')}` : 'dossier'}`)
  }
  return lignes.sort()
}

describe('chemins admis', () => {
  it('garde les fichiers de la racine et de sessions/, écarte le reste', () => {
    expect(cheminAdmis('tracker.json')).toBe(true)
    expect(cheminAdmis('sessions/sortie du 18 novembre é.gpx')).toBe(true)
    expect(cheminAdmis('itineraires/a.gpx')).toBe(false)
    expect(cheminAdmis('reglages/telephone.json')).toBe(false)
    expect(cheminAdmis('sessions/sous/a.gpx')).toBe(false)
    expect(cheminAdmis('sessions/..')).toBe(false)
    expect(cheminAdmis('..')).toBe(false)
    expect(cheminAdmis('../a.gpx')).toBe(false)
    expect(cheminAdmis('/sdcard/a.gpx')).toBe(false)
    expect(cheminAdmis('/a.gpx')).toBe(false)
    expect(cheminAdmis('sessions\\a.gpx')).toBe(false)
    expect(cheminAdmis('..\\a.gpx')).toBe(false)
    expect(cheminAdmis('C:\\a.gpx')).toBe(false)
    expect(cheminAdmis('')).toBe(false)
    expect(cheminAdmis('sessions/')).toBe(false)
    expect(cheminAdmis('sessions/a:b.gpx')).toBe(false)
    expect(cheminAdmis('sessions/a.gpx.tracker-tmp')).toBe(false)
    expect(cheminAdmis('sessions/a.gpx.tracker-new')).toBe(false)
  })

  it('écarte un chemin vu deux fois et trie le reste', () => {
    const f = (chemin: string, taille = 1): FichierTelephone => ({ chemin, taille, dateMs: 0 })
    expect(fichiersAdmis([f('sessions/b.gpx'), f('a.json'), f('sessions/x.gpx', 1), f('sessions/x.gpx', 2)])).toEqual([f('a.json'), f('sessions/b.gpx')])
  })

  it('voit les provisoires comme le téléphone : -new caché, -tmp caché à côté de l’original, montré sous son nom seul', () => {
    const f = (chemin: string): FichierTelephone => ({ chemin, taille: 1, dateMs: 0 })
    expect(commeLeTelephone([f('sessions/a.gpx'), f('sessions/a.gpx.tracker-tmp'), f('sessions/b.gpx.tracker-tmp'), f('c.json.tracker-new')]).map((v) => [v.chemin, v.reel])).toEqual([
      ['sessions/a.gpx', 'sessions/a.gpx'],
      ['sessions/b.gpx', 'sessions/b.gpx.tracker-tmp'],
    ])
  })
})

describe('dossier local', () => {
  it('liste la racine et sessions/ avec taille et date à la seconde, NOT_FOUND sans Documents/Tracker', async () => {
    await poser('tracker.json', '{}')
    await poser('sessions/sortie é.gpx', '<gpx/>')
    await poser('itineraires/tour.gpx', '<gpx/>')
    const t = dossierLocal(stockage)
    expect(await t.etat()).toEqual({ etat: 'pret', nom: NOM_TELEPHONE_ESSAI })
    expect(await t.lister()).toEqual([
      { chemin: 'sessions/sortie é.gpx', taille: 6, dateMs: DATE.getTime() },
      { chemin: 'tracker.json', taille: 2, dateMs: DATE.getTime() },
    ])
    await rm(path.join(stockage, 'Documents'), { recursive: true })
    await expect(t.lister()).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('lit une racine d’essai seulement quand on la lui donne', async () => {
    await poser('sessions/vrai.gpx', 'v')
    await poser('sessions/essai.gpx', 'e', path.join(stockage, 'Documents', 'Tracker-essai'))
    expect((await dossierLocal(stockage, { nomRacine: 'Tracker-essai' }).lister()).map((f) => f.chemin)).toEqual(['sessions/essai.gpx'])
    expect((await dossierLocal(stockage).lister()).map((f) => f.chemin)).toEqual(['sessions/vrai.gpx'])
  })

  it('est absent sans stockage, et suit un état imposé', async () => {
    expect(await dossierLocal(null).etat()).toEqual({ etat: 'absent' })
    expect(await dossierLocal(path.join(tmp, 'rien')).etat()).toEqual({ etat: 'absent' })
    const occupe = dossierLocal(stockage, { etatImpose: { etat: 'occupe' } })
    expect(await occupe.etat()).toEqual({ etat: 'occupe' })
    await expect(occupe.lister()).rejects.toMatchObject({ code: 'UNKNOWN' })
    const plusieurs = dossierLocal(stockage, { etatImpose: { etat: 'plusieurs', nombre: 2 } })
    await expect(plusieurs.lister()).rejects.toThrow('plusieurs')
  })
})

describe('canaux du téléphone', () => {
  function canaux(t: DossierDistant, memoire: string | null = null) {
    const g = gestionnairesTelephone(t, lectures, { memoire: async () => memoire })
    return {
      etat: () => g['telephone:etat'](undefined),
      lister: () => g['telephone:lister'](undefined) as Promise<Reponse<FichierTelephone[]>>,
      lire: (argument: unknown) => g['telephone:lireOctets'](argument) as Promise<Reponse<Uint8Array>>,
    }
  }

  it('servent exactement les trois canaux de lecture', () => {
    expect(Object.keys(gestionnairesTelephone(dossierLocal(null), lectures))).toEqual(CANAUX_TELEPHONE.map((n) => `telephone:${n}`))
    expect([...CANAUX_TELEPHONE]).toEqual(['etat', 'lister', 'lireOctets'])
  })

  it('lisent un fichier du dernier listage, effacent le temporaire et ne touchent pas au téléphone', async () => {
    await poser('sessions/sortie du matin é.gpx', '<gpx>é</gpx>')
    await poser('tracker.json', '{"v":1}')
    const avant = await empreinte(stockage)
    const c = canaux(dossierLocal(stockage))
    expect(valeur(await c.etat())).toEqual({ etat: 'pret', nom: NOM_TELEPHONE_ESSAI })
    const liste = valeur(await c.lister())
    expect(liste.map((f) => f.chemin)).toEqual(['sessions/sortie du matin é.gpx', 'tracker.json'])
    const octets = valeur(await c.lire({ chemin: 'sessions/sortie du matin é.gpx' }))
    expect(Buffer.from(octets).toString('utf8')).toBe('<gpx>é</gpx>')
    expect(await readdir(lectures)).toEqual([])
    expect(await empreinte(stockage)).toEqual(avant)
  })

  it('refusent un chemin absent du dernier listage (.., antislash, absolu, autre dossier), avant tout listage comme après', async () => {
    await poser('sessions/a.gpx', 'a')
    await poser('itineraires/b.gpx', 'b')
    await writeFile(path.join(stockage, 'secret.txt'), 'non')
    const c = canaux(dossierLocal(stockage))
    expect(await c.lire({ chemin: 'sessions/a.gpx' })).toMatchObject({ ok: false, code: 'UNKNOWN' })
    valeur(await c.lister())
    for (const chemin of ['../../secret.txt', 'sessions/../../../secret.txt', 'sessions\\a.gpx', '..\\..\\secret.txt', 'itineraires/b.gpx', 'sessions/b.gpx', '/sdcard/Documents/Tracker/sessions/a.gpx', 'C:\\Windows\\win.ini']) {
      expect(await c.lire({ chemin })).toMatchObject({ ok: false, code: 'UNKNOWN' })
    }
    expect(await c.lire('sessions/a.gpx')).toMatchObject({ ok: false, code: 'UNKNOWN' })
    expect(await c.lire({ chemin: 3 })).toMatchObject({ ok: false, code: 'UNKNOWN' })
    expect(valeur(await c.lire({ chemin: 'sessions/a.gpx' }))).toHaveLength(1)
  })

  it('oublient le listage quand un nouveau échoue, ou quand le téléphone n’est plus prêt', async () => {
    await poser('sessions/a.gpx', 'a')
    const c = canaux(dossierLocal(stockage))
    valeur(await c.lister())
    await rm(path.join(stockage, 'Documents'), { recursive: true })
    expect(await c.lister()).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(await c.lire({ chemin: 'sessions/a.gpx' })).toMatchObject({ ok: false, code: 'UNKNOWN' })
    let pret = true
    const variable: DossierDistant = {
      etat: async () => (pret ? { etat: 'pret', nom: 'x' } : { etat: 'plusieurs', nombre: 2 }),
      lister: async () => [{ chemin: 'sessions/a.gpx', taille: 1, dateMs: 0 }],
      lire: async (_f, local) => writeFile(local, 'a'),
    }
    const d = canaux(variable)
    valeur(await d.lister())
    pret = false
    expect(valeur(await d.etat())).toEqual({ etat: 'plusieurs', nombre: 2 })
    expect(await d.lire({ chemin: 'sessions/a.gpx' })).toMatchObject({ ok: false, code: 'UNKNOWN' })
  })

  it('font échouer une lecture dont la taille diffère du listage, et effacent son temporaire', async () => {
    const fichier: FichierTelephone = { chemin: 'sessions/a.gpx', taille: 10, dateMs: 0 }
    const recus: string[] = []
    const tronque: DossierDistant = {
      etat: async () => ({ etat: 'pret', nom: 'x' }),
      lister: async () => [fichier],
      lire: async (_f, local) => {
        recus.push(local)
        await writeFile(local, 'court')
      },
    }
    const c = canaux(tronque)
    valeur(await c.lister())
    const r = await c.lire({ chemin: 'sessions/a.gpx' })
    expect(r).toMatchObject({ ok: false, code: 'UNKNOWN' })
    expect(r.ok ? '' : r.message).toContain('5 octets reçus sur 10')
    expect(path.dirname(recus[0])).toBe(lectures)
    expect(path.basename(recus[0])).toMatch(/^\d+\.tracker-tmp$/)
    expect(await readdir(lectures)).toEqual([])
  })

  it('effacent le temporaire d’une lecture coupée en cours de route', async () => {
    const coupe: DossierDistant = {
      etat: async () => ({ etat: 'pret', nom: 'x' }),
      lister: async () => [{ chemin: 'sessions/a.gpx', taille: 10, dateMs: 0 }],
      lire: async (_f, local) => {
        await writeFile(local, 'moitié')
        throw new Error('débranché')
      },
    }
    const c = canaux(coupe)
    valeur(await c.lister())
    expect(await c.lire({ chemin: 'sessions/a.gpx' })).toMatchObject({ ok: false, message: 'débranché' })
    expect(await readdir(lectures)).toEqual([])
  })

  it('simulent le débranchement après n lectures, sans rien laisser', async () => {
    for (const n of ['a', 'b', 'c']) await poser(`sessions/${n}.gpx`, n)
    const avant = await empreinte(stockage)
    const c = canaux(dossierLocal(stockage, { coupureApres: 2 }))
    valeur(await c.lister())
    expect(valeur(await c.lire({ chemin: 'sessions/a.gpx' }))).toHaveLength(1)
    expect(valeur(await c.lire({ chemin: 'sessions/b.gpx' }))).toHaveLength(1)
    expect(await c.lire({ chemin: 'sessions/c.gpx' })).toMatchObject({ ok: false, code: 'UNKNOWN' })
    expect(valeur(await c.etat())).toEqual({ etat: 'absent' })
    expect(await readdir(lectures)).toEqual([])
    expect(await empreinte(stockage)).toEqual(avant)
  })

  it('vident les lectures restées au listage, sans toucher au reste du dossier', async () => {
    await mkdir(lectures, { recursive: true })
    await writeFile(path.join(lectures, '7.tracker-tmp'), 'reste')
    await writeFile(path.join(lectures, 'autre.txt'), 'garde')
    valeur(await canaux(dossierLocal(stockage)).lister())
    expect(await readdir(lectures)).toEqual(['autre.txt'])
    await viderLectures(path.join(tmp, 'inexistant'))
  })

  it('refusent de lire si le dossier temporaire est dans la mémoire, ou la contient', async () => {
    await poser('sessions/a.gpx', 'a')
    expect(await canaux(dossierLocal(stockage), path.join(tmp, 'PROFIL')).lister()).toMatchObject({ ok: false, code: 'UNKNOWN' })
    expect(await canaux(dossierLocal(stockage), lectures).lister()).toMatchObject({ ok: false, code: 'UNKNOWN' })
    expect(await canaux(dossierLocal(stockage), path.join(lectures, 'dedans')).lister()).toMatchObject({ ok: false, code: 'UNKNOWN' })
    expect(valeur(await canaux(dossierLocal(stockage), path.join(tmp, 'memoire')).lister())).toHaveLength(1)
  })

  it('passent une commande à la fois, dans l’ordre des appels', async () => {
    const journal: string[] = []
    let actives = 0
    const lent: DossierDistant = {
      etat: async () => {
        actives++
        journal.push(`début ${actives}`)
        await new Promise((fin) => setTimeout(fin, 20))
        actives--
        return { etat: 'absent' }
      },
      lister: async () => [],
      lire: async () => undefined,
    }
    const c = canaux(lent)
    await Promise.all([c.etat(), c.etat(), c.etat()])
    expect(journal).toEqual(['début 1', 'début 1', 'début 1'])
  })
})

describe('mode d’essai', () => {
  const ESSAI = {
    TRACKER_BANC_TELEPHONE: 'C:\\telephone',
    TRACKER_BANC_TELEPHONE_ETAT: 'occupe',
    TRACKER_BANC_TELEPHONE_COUPURE: '2',
    TRACKER_BANC_RACINE_TELEPHONE: 'Tracker-essai',
  }

  it('hors du mode d’essai, aucune variable n’est lue : le vrai téléphone, sur Documents/Tracker', () => {
    expect(telephoneDepuisEnvironnement(ESSAI, 'C:\\profil')).toEqual({ canal: 'adb', nomRacine: 'Tracker' })
    expect(telephoneDepuisEnvironnement({ ...ESSAI, TRACKER_BANC: '0' }, 'C:\\profil')).toEqual({ canal: 'adb', nomRacine: 'Tracker' })
    expect(telephoneDepuisEnvironnement({ TRACKER_BANC_RACINE_TELEPHONE: 'Tracker-essai' }, 'C:\\profil')).toEqual({ canal: 'adb', nomRacine: 'Tracker' })
  })

  it('en mode d’essai, le dossier local, son état, sa coupure et sa racine', () => {
    expect(telephoneDepuisEnvironnement({ ...ESSAI, TRACKER_BANC: '1' }, 'C:\\profil')).toEqual({
      canal: 'local',
      stockage: path.resolve('C:\\telephone'),
      etatImpose: { etat: 'occupe' },
      coupureApres: 2,
      nomRacine: 'Tracker-essai',
    })
    expect(telephoneDepuisEnvironnement({ TRACKER_BANC: '1', TRACKER_BANC_TELEPHONE_ETAT: 'plusieurs' }, 'x')).toMatchObject({ canal: 'local', stockage: null, etatImpose: { etat: 'plusieurs', nombre: 2 } })
  })

  it('en mode d’essai, le vrai téléphone n’est lu que sur une racine d’essai', () => {
    expect(telephoneDepuisEnvironnement({ TRACKER_BANC: '1' }, 'x')).toEqual({ canal: 'local', stockage: null, etatImpose: null, coupureApres: null, nomRacine: 'Tracker' })
    expect(telephoneDepuisEnvironnement({ TRACKER_BANC: '1', TRACKER_BANC_RACINE_TELEPHONE: 'Tracker-essai-2' }, 'x')).toEqual({ canal: 'adb', nomRacine: 'Tracker-essai-2' })
  })

  it('refuse une racine hors de Tracker-essai : téléphone absent, jamais le vrai dossier', () => {
    for (const valeurRacine of ['Tracker', 'tracker', 'Gtracker', 'Tracker-essai-A', 'Tracker-essai/../Tracker', '../Tracker', 'Tracker-essai x']) {
      const journal: string[] = []
      const choix = telephoneDepuisEnvironnement({ TRACKER_BANC: '1', TRACKER_BANC_RACINE_TELEPHONE: valeurRacine }, 'x', (m) => journal.push(m))
      expect(choix).toEqual({ canal: 'local', stockage: null, etatImpose: null, coupureApres: null, nomRacine: 'Tracker' })
      expect(journal.join(' ')).toContain('refusée')
    }
  })

  it('ignore une valeur inconnue en le disant, et donne le dossier de l’outil pour adbIntrouvable', () => {
    const journal: string[] = []
    expect(telephoneDepuisEnvironnement({ TRACKER_BANC: '1', TRACKER_BANC_TELEPHONE_ETAT: 'branche', TRACKER_BANC_TELEPHONE_COUPURE: 'deux' }, 'x', (m) => journal.push(m))).toEqual({
      canal: 'local',
      stockage: null,
      etatImpose: null,
      coupureApres: null,
      nomRacine: 'Tracker',
    })
    expect(journal).toHaveLength(3)
    expect(telephoneDepuisEnvironnement({ TRACKER_BANC: '1', TRACKER_BANC_TELEPHONE_ETAT: 'adbIntrouvable' }, 'C:\\p')).toMatchObject({ etatImpose: { etat: 'adbIntrouvable', dossier: 'C:\\p' } })
  })
})
