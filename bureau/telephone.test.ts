import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cableTempName, phoneVisibleNames } from '../src/library/remoteTemps'
import { PHONE_TRASH_ROOT, phoneTrashDir } from '../src/library/syncBase'
import { TRASH_DIR, isTrashDirName, trashDirName } from '../src/library/trash'
import type { Reponse } from './pont'
import type { DossierDistant, FichierTelephone } from './telephone'
import {
  CANAUX_TELEPHONE,
  CORBEILLE_PAGE,
  DEPOT_TELEPHONE,
  LONGUEUR_MAX_BRUT,
  MESSAGE_ENREGISTREMENT,
  NOM_TELEPHONE_ESSAI,
  cheminAdmis,
  cheminBrutAdmis,
  cheminEcrivable,
  cheminRetirable,
  commeLeTelephone,
  destinationCorbeilleAdmise,
  dossierCorbeilleAdmis,
  dossierDepotAdmis,
  dossierLocal,
  fichiersAdmis,
  gestionnairesTelephone,
  nomCorbeille,
  nomProvisoire,
  retraitAdmis,
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

/** Un faux dossier distant qui ne sait que lire : toute écriture, tout retrait lève. */
const SANS_ECRITURE: Pick<DossierDistant, 'enregistrement' | 'ecrire' | 'mettreDeCote' | 'listerCorbeille' | 'listerTout' | 'lireBrut'> = {
  listerTout: async () => [],
  lireBrut: async () => {
    throw new Error('lecture inattendue')
  },
  enregistrement: async () => false,
  ecrire: async () => {
    throw new Error('écriture inattendue')
  },
  mettreDeCote: async () => {
    throw new Error('retrait inattendu')
  },
  listerCorbeille: async () => [],
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
  it('garde les fichiers de la racine, de sessions/, itineraires/, reglages/ et journaux/, écarte le reste', () => {
    expect(cheminAdmis('tracker.json')).toBe(true)
    expect(cheminAdmis('sessions/sortie du 18 novembre é.gpx')).toBe(true)
    expect(cheminAdmis('itineraires/a.gpx')).toBe(true)
    expect(cheminAdmis('reglages/telephone.json')).toBe(true)
    expect(cheminAdmis('journaux/enregistrement.jsonl')).toBe(true)
    expect(cheminAdmis('synchro/a.json')).toBe(false)
    expect(cheminAdmis('en-attente/a.gpx')).toBe(false)
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
  it('liste la racine et les sous-dossiers listés avec taille et date à la seconde, NOT_FOUND sans Documents/Tracker', async () => {
    await poser('tracker.json', '{}')
    await poser('sessions/sortie é.gpx', '<gpx/>')
    await poser('itineraires/tour.gpx', '<gpx/>')
    await poser('autre/x.gpx', '<gpx/>')
    const t = dossierLocal(stockage)
    expect(await t.etat()).toEqual({ etat: 'pret', nom: NOM_TELEPHONE_ESSAI })
    expect(await t.lister()).toEqual([
      { chemin: 'itineraires/tour.gpx', taille: 6, dateMs: DATE.getTime() },
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

  it('servent exactement les canaux voulus, aucun d’effacement', () => {
    expect(Object.keys(gestionnairesTelephone(dossierLocal(null), lectures))).toEqual(CANAUX_TELEPHONE.map((n) => `telephone:${n}`))
    expect([...CANAUX_TELEPHONE]).toEqual(['etat', 'lister', 'lireOctets', 'enregistrement', 'ecrireOctets', 'listerCorbeille', 'mettreDeCote', 'copieSecurite', 'copieExiste'])
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
    await poser('autre/b.gpx', 'b')
    await writeFile(path.join(stockage, 'secret.txt'), 'non')
    const c = canaux(dossierLocal(stockage))
    expect(await c.lire({ chemin: 'sessions/a.gpx' })).toMatchObject({ ok: false, code: 'UNKNOWN' })
    valeur(await c.lister())
    for (const chemin of ['../../secret.txt', 'sessions/../../../secret.txt', 'sessions\\a.gpx', '..\\..\\secret.txt', 'autre/b.gpx', 'sessions/b.gpx', '/sdcard/Documents/Tracker/sessions/a.gpx', 'C:\\Windows\\win.ini']) {
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
      ...SANS_ECRITURE,
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
      ...SANS_ECRITURE,
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
      ...SANS_ECRITURE,
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
      ...SANS_ECRITURE,
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
      enregistrement: false,
    })
    expect(telephoneDepuisEnvironnement({ TRACKER_BANC: '1', TRACKER_BANC_TELEPHONE_ETAT: 'plusieurs' }, 'x')).toMatchObject({ canal: 'local', stockage: null, etatImpose: { etat: 'plusieurs', nombre: 2 } })
  })

  it('en mode d’essai, le vrai téléphone n’est lu que sur une racine d’essai', () => {
    expect(telephoneDepuisEnvironnement({ TRACKER_BANC: '1' }, 'x')).toEqual({ canal: 'local', stockage: null, etatImpose: null, coupureApres: null, nomRacine: 'Tracker', enregistrement: false })
    expect(telephoneDepuisEnvironnement({ TRACKER_BANC: '1', TRACKER_BANC_RACINE_TELEPHONE: 'Tracker-essai-2' }, 'x')).toEqual({ canal: 'adb', nomRacine: 'Tracker-essai-2' })
  })

  it('refuse une racine hors de Tracker-essai : téléphone absent, jamais le vrai dossier', () => {
    for (const valeurRacine of ['Tracker', 'tracker', 'Gtracker', 'Tracker-essai-A', 'Tracker-essai/../Tracker', '../Tracker', 'Tracker-essai x']) {
      const journal: string[] = []
      const choix = telephoneDepuisEnvironnement({ TRACKER_BANC: '1', TRACKER_BANC_RACINE_TELEPHONE: valeurRacine }, 'x', (m) => journal.push(m))
      expect(choix).toEqual({ canal: 'local', stockage: null, etatImpose: null, coupureApres: null, nomRacine: 'Tracker', enregistrement: false })
      expect(journal.join(' ')).toContain('refusée')
    }
  })

  it('panne de listage d’essai : après la première écriture, un seul listage partiel', async () => {
    expect(telephoneDepuisEnvironnement({ TRACKER_BANC: '1', TRACKER_BANC_TELEPHONE_PANNE: 'listage' }, 'x')).toMatchObject({ panneListage: true })
    expect(telephoneDepuisEnvironnement({ TRACKER_BANC_TELEPHONE_PANNE: 'listage' }, 'x')).toEqual({ canal: 'adb', nomRacine: 'Tracker' })
    await poser('sessions/a.gpx', 'a')
    const t = dossierLocal(stockage, { panneListage: true })
    await t.lister()
    await t.lister()
    const local = path.join(tmp, 'local.json')
    await writeFile(local, '{}')
    await t.ecrire('sessions/a.json', local, 2)
    await expect(t.lister()).rejects.toThrow('Listage du téléphone incomplet')
    expect((await t.lister()).map((f) => f.chemin)).toEqual(['sessions/a.gpx', 'sessions/a.json'])
  })

  it('ignore une valeur inconnue en le disant, et donne le dossier de l’outil pour adbIntrouvable', () => {
    const journal: string[] = []
    expect(telephoneDepuisEnvironnement({ TRACKER_BANC: '1', TRACKER_BANC_TELEPHONE_ETAT: 'branche', TRACKER_BANC_TELEPHONE_COUPURE: 'deux' }, 'x', (m) => journal.push(m))).toEqual({
      canal: 'local',
      stockage: null,
      etatImpose: null,
      coupureApres: null,
      nomRacine: 'Tracker',
      enregistrement: false,
    })
    expect(journal).toHaveLength(3)
    expect(telephoneDepuisEnvironnement({ TRACKER_BANC: '1', TRACKER_BANC_TELEPHONE_ETAT: 'adbIntrouvable' }, 'C:\\p')).toMatchObject({ etatImpose: { etat: 'adbIntrouvable', dossier: 'C:\\p' } })
  })
})

// ---------- écriture et mise de côté ----------

/** Chemins refusés à l'écriture comme au retrait. */
const REFUSES = [
  '',
  '/sdcard/Documents/Tracker/sessions/a.gpx',
  '/a.gpx',
  'C:\\a.gpx',
  '../a.gpx',
  'sessions/../tracker.json',
  'sessions/..',
  'sessions/.',
  'sessions/',
  'sessions',
  'sessions//a.gpx',
  'sessions/sous/a.gpx',
  'journaux/a.json',
  'en-attente/a.gpx',
  'synchro/a.json',
  'autre.json',
  'LISEZMOI.txt',
  'lieux.json',
  'TRACKER.JSON',
  'tracker.json/x',
  'sessions/a\nb.gpx',
  'sessions/a\rb.gpx',
  'sessions/a\u0000b.gpx',
  'sessions/a\u007fb.gpx',
  'sessions/a.gpx.tracker-tmp',
  'sessions/a.gpx.tracker-new',
  'sessions/a\\b.gpx',
  'sessions/a:b.gpx',
  'sessions/a.gpx ',
  'sessions/nul.gpx',
  `sessions/${'a'.repeat(600)}.gpx`,
]

/** Contenu de chaque fichier sous `Documents`, quel que soit son nom : rien ne doit jamais en disparaître. */
async function contenus(): Promise<string[]> {
  const documents = path.join(stockage, 'Documents')
  const tout: string[] = []
  for (const entree of await readdir(documents, { withFileTypes: true, recursive: true })) {
    if (entree.isFile()) tout.push(await readFile(path.join(entree.parentPath, entree.name), 'utf8'))
  }
  return tout.sort()
}

describe('listes fermées', () => {
  it('écrit dans sessions/, itineraires/, reglages/, et tracker.json et fc-repos.json à la racine ; rien d’autre', () => {
    for (const chemin of ['sessions/sortie d’été é.gpx', 'itineraires/tour.json', 'reglages/pc.json', 'tracker.json', 'fc-repos.json']) expect(cheminEcrivable(chemin), chemin).toBe(true)
    for (const chemin of [...REFUSES, 'reglages', 'itineraires/sous/a.json']) expect(cheminEcrivable(chemin), chemin).toBe(false)
    expect(cheminEcrivable(3)).toBe(false)
  })

  it('ne retire que de sessions/ et d’itineraires/', () => {
    expect(cheminRetirable('sessions/a.gpx')).toBe(true)
    expect(cheminRetirable('itineraires/a.json')).toBe(true)
    for (const chemin of [...REFUSES, 'reglages/pc.json', 'tracker.json', 'fc-repos.json']) expect(cheminRetirable(chemin), chemin).toBe(false)
  })

  it('ne vise dans la corbeille qu’un jour bien formé, le même sous-dossier et un nom admis', () => {
    expect(retraitAdmis('sessions/a.gpx', 'Tracker-corbeille/2026-11-26/sessions/a-2.gpx')).toEqual({ jour: '2026-11-26', sous: 'sessions', nom: 'a-2.gpx', relatif: '2026-11-26/sessions/a-2.gpx' })
    for (const vers of [
      'Tracker-corbeille/2026-11-26/itineraires/a.gpx',
      'Tracker-corbeille/2026-13-01/sessions/a.gpx',
      'Tracker-corbeille/26-11-2026/sessions/a.gpx',
      'Tracker-corbeille/2026-11-26/sessions/../a.gpx',
      'Tracker-corbeille/2026-11-26/sessions/x/a.gpx',
      'Tracker-corbeille/2026-11-26/sessions/a.gpx.tracker-new',
      'Tracker-corbeille/2026-11-26/sessions/',
      'Tracker/2026-11-26/sessions/a.gpx',
      'Tracker-essai-corbeille/2026-11-26/sessions/a.gpx',
      '../Tracker-corbeille/2026-11-26/sessions/a.gpx',
      '/sdcard/Documents/Tracker-corbeille/2026-11-26/sessions/a.gpx',
    ]) {
      expect(retraitAdmis('sessions/a.gpx', vers), vers).toBeNull()
    }
    expect(retraitAdmis('reglages/pc.json', 'Tracker-corbeille/2026-11-26/reglages/pc.json')).toBeNull()
    expect(dossierCorbeilleAdmis('Tracker-corbeille/2026-11-26')).toBe('2026-11-26')
    for (const d of ['Tracker-corbeille', 'Tracker-corbeille/2026-11-26/sessions', 'Tracker-corbeille/..', 'Tracker/2026-11-26', 3]) expect(dossierCorbeilleAdmis(d)).toBeNull()
  })

  it('parle comme le moteur de la page : même nom de corbeille, même dossier du jour, mêmes provisoires', () => {
    expect(CORBEILLE_PAGE).toBe(PHONE_TRASH_ROOT)
    expect(dossierCorbeilleAdmis(phoneTrashDir(new Date(2026, 10, 26, 12).getTime()))).toBe('2026-11-26')
    expect(nomCorbeille('Tracker')).toBe('Tracker-corbeille')
    expect(nomCorbeille('Tracker-essai')).toBe('Tracker-essai-corbeille')
    expect(nomProvisoire('sessions/a.gpx')).toBe(cableTempName('sessions/a.gpx'))
    expect(nomProvisoire('sessions/a.gpx')).toBe('sessions/a.gpx.tracker-new')
    const cas = [['a.gpx', 'a.gpx.tracker-new'], ['a.gpx', 'a.gpx.tracker-tmp'], ['a.gpx.tracker-tmp'], ['a.gpx.tracker-new'], ['b.json', 'a.gpx.tracker-tmp', 'c.imu']]
    for (const noms of cas) {
      const vus = commeLeTelephone(noms.map((n) => ({ chemin: `sessions/${n}`, taille: 1, dateMs: 0 }))).map((v) => ({ name: v.chemin.slice(9), actual: v.reel.slice(9) }))
      expect(vus, noms.join(',')).toEqual(phoneVisibleNames(noms))
    }
  })
})

describe('liaison sans fil : chemins réels et dépôt dans la corbeille du téléphone', () => {
  const DOSSIER = '1795647914477-1795000000000'

  it('lit un chemin réel du listage complet, à toute profondeur, provisoires compris ; jamais hors du dossier', () => {
    for (const chemin of ['tracker.json', 'sessions/a.gpx.tracker-new', 'corbeille/x/y/z.gpx', 'Autre/a b.txt', `${'a/'.repeat(2047)}aa`]) {
      expect(cheminBrutAdmis(chemin), chemin.slice(0, 40)).toBe(true)
    }
    for (const chemin of ['', '/a.gpx', '../a.gpx', 'a/../b', 'a/./b', 'a//b', 'a/', 'a\\b', 'C:/a', 'a/con.txt', 'a/b.', 'a/b\u0007', `${'a/'.repeat(2048)}a`, 7, null]) {
      expect(cheminBrutAdmis(chemin), String(chemin).slice(0, 40)).toBe(false)
    }
    expect(`${'a/'.repeat(2047)}aa`).toHaveLength(LONGUEUR_MAX_BRUT)
  })

  it('dépose dans corbeille/<instant>-<identité>/, sous le nom d’origine, depuis sessions/ ou itineraires/ seulement', () => {
    expect(destinationCorbeilleAdmise('sessions/a.gpx', `corbeille/${DOSSIER}/a.gpx`)).toBe(true)
    expect(destinationCorbeilleAdmise('itineraires/Tour du lac.json', 'corbeille/1795647914477-Tour du lac-3/Tour du lac.json')).toBe(true)
    for (const [chemin, vers] of [
      ['sessions/a.gpx', `corbeille/${DOSSIER}/b.gpx`],
      ['sessions/a.gpx', `corbeille/${DOSSIER}/sessions/a.gpx`],
      ['sessions/a.gpx', 'corbeille/a.gpx'],
      ['sessions/a.gpx', 'corbeille/2024-vacances/a.gpx'],
      ['sessions/a.gpx', `Corbeille/${DOSSIER}/a.gpx`],
      ['sessions/a.gpx', `mis-de-cote/${DOSSIER}/a.gpx`],
      ['sessions/a.gpx', 'Tracker-corbeille/2026-11-26/sessions/a.gpx'],
      ['sessions/a.gpx', `corbeille/${DOSSIER}/../a.gpx`],
      ['sessions/a.gpx', `/corbeille/${DOSSIER}/a.gpx`],
      ['reglages/a.json', `corbeille/${DOSSIER}/a.json`],
      ['journaux/a.txt', `corbeille/${DOSSIER}/a.txt`],
      ['sessions/x/a.gpx', `corbeille/${DOSSIER}/a.gpx`],
      ['sessions/a.gpx.tracker-new', `corbeille/${DOSSIER}/a.gpx.tracker-new`],
      ['sessions/a.gpx', `corbeille/${DOSSIER}/${'a'.repeat(600)}`],
      ['sessions/a.gpx', 7],
    ]) {
      expect(destinationCorbeilleAdmise(chemin, vers), `${String(chemin)} → ${String(vers)}`).toBe(false)
    }
  })

  it('nomme ses sous-dossiers comme la corbeille de la page, sous le même nom de dossier', () => {
    expect(DEPOT_TELEPHONE).toBe(TRASH_DIR)
    const instant = 1_795_647_914_477
    const identites = ['1795000000000', 'Tour: du lac?', ' Tour  du lac. ', 'Lac.', '', 'é'.repeat(100), 'a\u0001b', 'CON']
    for (const identite of identites) {
      const nom = trashDirName(instant, identite, [])
      expect(isTrashDirName(nom), nom).toBe(true)
      expect(dossierDepotAdmis(nom), nom).toBe(true)
      expect(dossierDepotAdmis(trashDirName(instant, identite, [nom])), nom).toBe(true)
    }
    for (const nom of ['2024-vacances', '179564791447-a', '1795647914477-', '1795647914477-a  b', '1795647914477-a.', '1795647914477- a', `1795647914477-${'a'.repeat(81)}`, '1795647914477-a:b', '1795647914477-a.tracker-tmp', 3]) {
      expect(dossierDepotAdmis(nom), String(nom)).toBe(false)
      if (typeof nom === 'string' && !nom.endsWith('.tracker-tmp')) expect(isTrashDirName(nom), nom).toBe(false)
    }
  })
})

describe('écriture sur le téléphone d’essai', () => {
  function canaux(t: DossierDistant) {
    const g = gestionnairesTelephone(t, lectures, { memoire: async () => null })
    return {
      lister: () => g['telephone:lister'](undefined) as Promise<Reponse<FichierTelephone[]>>,
      lire: (chemin: string) => g['telephone:lireOctets']({ chemin }) as Promise<Reponse<Uint8Array>>,
      enregistrement: () => g['telephone:enregistrement'](undefined) as Promise<Reponse<boolean>>,
      ecrire: (chemin: unknown, texte: string) => g['telephone:ecrireOctets']({ chemin, octets: new TextEncoder().encode(texte) }) as Promise<Reponse<FichierTelephone>>,
    }
  }

  it('demande un listage d’abord, puis écrit un fichier neuf et en remplace un, sans provisoire laissé', async () => {
    await poser('sessions/a.json', '{"v":1}')
    const avant = await empreinte(stockage)
    const c = canaux(dossierLocal(stockage))
    expect(await c.ecrire('sessions/neuf.gpx', '<gpx/>')).toMatchObject({ ok: false, code: 'UNKNOWN', message: expect.stringContaining('pas été listé') })
    expect(await empreinte(stockage)).toEqual(avant)
    valeur(await c.lister())
    const ecrit = valeur(await c.ecrire('sessions/neuf.gpx', '<gpx>é</gpx>'))
    expect(ecrit).toMatchObject({ chemin: 'sessions/neuf.gpx', taille: 13 })
    expect(await readFile(path.join(racine, 'sessions', 'neuf.gpx'), 'utf8')).toBe('<gpx>é</gpx>')
    valeur(await c.ecrire('sessions/a.json', '{"v":2}'))
    expect(await readFile(path.join(racine, 'sessions', 'a.json'), 'utf8')).toBe('{"v":2}')
    // Écrit depuis le listage : lisible aussitôt, comme un fichier listé.
    expect(Buffer.from(valeur(await c.lire('sessions/neuf.gpx'))).toString('utf8')).toBe('<gpx>é</gpx>')
    expect((await readdir(path.join(racine, 'sessions'))).sort()).toEqual(['a.json', 'neuf.gpx'])
    expect(await readdir(lectures)).toEqual([])
  })

  it('crée le sous-dossier qui manque, comme adb push', async () => {
    await rm(path.join(racine, 'itineraires'), { recursive: true })
    const c = canaux(dossierLocal(stockage))
    valeur(await c.lister())
    valeur(await c.ecrire('itineraires/tour.json', '{}'))
    expect(await readdir(path.join(racine, 'itineraires'))).toEqual(['tour.json'])
  })

  it('refuse un à un les chemins hors liste, sans rien toucher', async () => {
    await poser('sessions/a.gpx', 'a')
    const c = canaux(dossierLocal(stockage))
    valeur(await c.lister())
    const avant = await empreinte(stockage)
    for (const chemin of REFUSES) expect(await c.ecrire(chemin, 'x'), JSON.stringify(chemin)).toMatchObject({ ok: false, code: 'PERMISSION' })
    expect(await c.ecrire(3, 'x')).toMatchObject({ ok: false })
    expect(await empreinte(stockage)).toEqual(avant)
  })

  it('refuse d’écrire à la place d’un dossier', async () => {
    await mkdir(path.join(racine, 'sessions', 'x.gpx'))
    const c = canaux(dossierLocal(stockage))
    valeur(await c.lister())
    expect(await c.ecrire('sessions/x.gpx', 'x')).toMatchObject({ ok: false, code: 'PERMISSION' })
  })

  it('n’écrit rien pendant un enregistrement, et le dit', async () => {
    await poser('sessions/a.json', '{"v":1}')
    const avant = await empreinte(stockage)
    const c = canaux(dossierLocal(stockage, { enregistrement: true }))
    expect(await c.enregistrement()).toMatchObject({ ok: false })
    valeur(await c.lister())
    expect(valeur(await c.enregistrement())).toBe(true)
    expect(await c.ecrire('sessions/a.json', '{"v":2}')).toEqual({ ok: false, code: 'PERMISSION', message: MESSAGE_ENREGISTREMENT })
    expect(await empreinte(stockage)).toEqual(avant)
    const libre = canaux(dossierLocal(stockage))
    valeur(await libre.lister())
    expect(valeur(await libre.enregistrement())).toBe(false)
  })

  it('une écriture coupée laisse un .tracker-new à moitié, que le téléphone ne montre pas, et l’original intact', async () => {
    await poser('sessions/a.json', '{"v":1}')
    const c = canaux(dossierLocal(stockage, { coupureApres: 0 }))
    valeur(await c.lister())
    expect(await c.ecrire('sessions/a.json', '{"v":2222}')).toMatchObject({ ok: false })
    expect((await readdir(path.join(racine, 'sessions'))).sort()).toEqual(['a.json', 'a.json.tracker-new'])
    expect(await readFile(path.join(racine, 'sessions', 'a.json'), 'utf8')).toBe('{"v":1}')
    expect((await dossierLocal(stockage).lister()).map((f) => f.chemin)).toEqual(['sessions/a.json'])
  })
})

describe('mise de côté sur le téléphone d’essai', () => {
  const JOUR = 'Tracker-corbeille/2026-11-26'

  function canaux(t: DossierDistant) {
    const g = gestionnairesTelephone(t, lectures, { memoire: async () => null })
    return {
      lister: () => g['telephone:lister'](undefined) as Promise<Reponse<FichierTelephone[]>>,
      lire: (chemin: string) => g['telephone:lireOctets']({ chemin }) as Promise<Reponse<Uint8Array>>,
      corbeille: (dossier: unknown) => g['telephone:listerCorbeille']({ dossier }) as Promise<Reponse<string[]>>,
      deCote: (chemin: unknown, vers: unknown) => g['telephone:mettreDeCote']({ chemin, vers }) as Promise<Reponse<null>>,
    }
  }
  const corbeille = (relatif: string) => path.join(stockage, 'Documents', 'Tracker-corbeille', ...relatif.split('/'))

  it('déplace le fichier dans Documents/Tracker-corbeille/<jour>/, sous le même chemin, sans rien effacer', async () => {
    await poser('sessions/a.gpx', '<gpx>a</gpx>')
    await poser('sessions/a.json', '{"a":1}')
    const tout = await contenus()
    const c = canaux(dossierLocal(stockage))
    expect(await c.deCote('sessions/a.gpx', `${JOUR}/sessions/a.gpx`)).toMatchObject({ ok: false, message: expect.stringContaining('pas été listé') })
    valeur(await c.lister())
    expect(valeur(await c.corbeille(JOUR))).toEqual([])
    valeur(await c.deCote('sessions/a.gpx', `${JOUR}/sessions/a.gpx`))
    expect(await readFile(corbeille('2026-11-26/sessions/a.gpx'), 'utf8')).toBe('<gpx>a</gpx>')
    expect(await readdir(path.join(racine, 'sessions'))).toEqual(['a.json'])
    expect(valeur(await c.corbeille(JOUR))).toEqual([`${JOUR}/sessions/a.gpx`])
    // Plus au listage : ni relu, ni remis de côté.
    expect(await c.lire('sessions/a.gpx')).toMatchObject({ ok: false })
    expect(await c.deCote('sessions/a.gpx', `${JOUR}/sessions/a-2.gpx`)).toMatchObject({ ok: false })
    expect(await contenus()).toEqual(tout)
  })

  it('n’écrase jamais une place prise dans la corbeille', async () => {
    await poser('sessions/a.gpx', 'nouveau')
    await poser('2026-11-26/sessions/a.gpx', 'ancien', path.join(stockage, 'Documents', 'Tracker-corbeille'))
    const c = canaux(dossierLocal(stockage))
    valeur(await c.lister())
    expect(await c.deCote('sessions/a.gpx', `${JOUR}/sessions/a.gpx`)).toMatchObject({ ok: false, message: expect.stringContaining('déjà pris') })
    expect(await readFile(corbeille('2026-11-26/sessions/a.gpx'), 'utf8')).toBe('ancien')
    expect(await readFile(path.join(racine, 'sessions', 'a.gpx'), 'utf8')).toBe('nouveau')
    valeur(await c.deCote('sessions/a.gpx', `${JOUR}/sessions/a-2.gpx`))
    expect(valeur(await c.corbeille(JOUR))).toEqual([`${JOUR}/sessions/a-2.gpx`, `${JOUR}/sessions/a.gpx`])
  })

  it('refuse un fichier changé depuis le listage', async () => {
    await poser('sessions/a.gpx', 'court')
    const c = canaux(dossierLocal(stockage))
    valeur(await c.lister())
    await poser('sessions/a.gpx', 'plus long maintenant')
    expect(await c.deCote('sessions/a.gpx', `${JOUR}/sessions/a.gpx`)).toMatchObject({ ok: false, message: expect.stringContaining('changé') })
    expect(await readFile(path.join(racine, 'sessions', 'a.gpx'), 'utf8')).toBe('plus long maintenant')
  })

  it('emporte le remplacement interrompu caché, d’abord, et un .tracker-tmp montré sous son nom : rien ne revient', async () => {
    await poser('sessions/b.gpx', 'original')
    await poser('sessions/b.gpx.tracker-tmp', 'interrompu')
    await poser('sessions/c.gpx.tracker-tmp', 'repris')
    const tout = await contenus()
    const c = canaux(dossierLocal(stockage))
    expect(valeur(await c.lister()).map((f) => f.chemin)).toEqual(['sessions/b.gpx', 'sessions/c.gpx'])
    valeur(await c.deCote('sessions/b.gpx', `${JOUR}/sessions/b.gpx`))
    valeur(await c.deCote('sessions/c.gpx', `${JOUR}/sessions/c.gpx`))
    expect(await readdir(path.join(racine, 'sessions'))).toEqual([])
    expect(await readFile(corbeille('2026-11-26/sessions/b.gpx'), 'utf8')).toBe('original')
    expect(await readFile(corbeille('2026-11-26/sessions/b.gpx.tracker-tmp'), 'utf8')).toBe('interrompu')
    expect(await readFile(corbeille('2026-11-26/sessions/c.gpx'), 'utf8')).toBe('repris')
    expect(valeur(await c.lister())).toEqual([])
    expect(await contenus()).toEqual(tout)
  })

  it('refuse les chemins et destinations hors liste, sans rien toucher', async () => {
    await poser('sessions/a.gpx', 'a')
    await poser('reglages/pc.json', '{}')
    await poser('tracker.json', '{}')
    const c = canaux(dossierLocal(stockage))
    valeur(await c.lister())
    const avant = await empreinte(stockage)
    for (const chemin of [...REFUSES, 'reglages/pc.json', 'tracker.json']) {
      expect(await c.deCote(chemin, `${JOUR}/sessions/a.gpx`), JSON.stringify(chemin)).toMatchObject({ ok: false, code: 'PERMISSION' })
    }
    for (const vers of ['Tracker-corbeille/2026-11-26/itineraires/a.gpx', '../a.gpx', 'Tracker-corbeille/2026-11-26/sessions/../../Tracker/x.gpx', '/sdcard/Download/a.gpx', 3]) {
      expect(await c.deCote('sessions/a.gpx', vers), String(vers)).toMatchObject({ ok: false, code: 'PERMISSION' })
    }
    for (const d of ['Tracker-corbeille', '../Documents', 'Tracker-corbeille/2026-11-26/sessions']) expect(await c.corbeille(d)).toMatchObject({ ok: false, code: 'PERMISSION' })
    expect(await empreinte(stockage)).toEqual(avant)
  })

  it('ne met rien de côté pendant un enregistrement', async () => {
    await poser('sessions/a.gpx', 'a')
    const avant = await empreinte(stockage)
    const c = canaux(dossierLocal(stockage, { enregistrement: true }))
    valeur(await c.lister())
    expect(await c.deCote('sessions/a.gpx', `${JOUR}/sessions/a.gpx`)).toEqual({ ok: false, code: 'PERMISSION', message: MESSAGE_ENREGISTREMENT })
    expect(await empreinte(stockage)).toEqual(avant)
  })

  it('sur une racine d’essai, met de côté dans Documents/Tracker-essai-corbeille, sans toucher au vrai dossier', async () => {
    const essai = path.join(stockage, 'Documents', 'Tracker-essai')
    await poser('sessions/a.gpx', 'vrai')
    await poser('sessions/a.gpx', 'essai', essai)
    const c = canaux(dossierLocal(stockage, { nomRacine: 'Tracker-essai' }))
    valeur(await c.lister())
    valeur(await c.deCote('sessions/a.gpx', `${JOUR}/sessions/a.gpx`))
    expect(await readFile(path.join(stockage, 'Documents', 'Tracker-essai-corbeille', '2026-11-26', 'sessions', 'a.gpx'), 'utf8')).toBe('essai')
    expect(await readFile(path.join(racine, 'sessions', 'a.gpx'), 'utf8')).toBe('vrai')
    expect((await readdir(path.join(stockage, 'Documents'))).sort()).toEqual(['Tracker', 'Tracker-essai', 'Tracker-essai-corbeille'])
  })
})
