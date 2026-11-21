import { symlinkSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ErreurDisque,
  avecEssais,
  codeDe,
  dossierDisque,
  dossierPropose,
  ecrireAtomique,
  estDansOneDrive,
  resoudre,
  segmentAdmis,
} from './disque'

let tmp: string
let racine: string

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'trk-disque-'))
  racine = path.join(tmp, 'Tracker')
  await mkdir(racine)
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

/** Code de l'erreur levée par la promesse, `null` si elle aboutit. */
async function codeLeve(promesse: Promise<unknown>): Promise<string | null> {
  try {
    await promesse
    return null
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurDisque)
    return (e as ErreurDisque).code
  }
}

const erreurNode = (code: string) => Object.assign(new Error(code), { code })

describe('chemins', () => {
  it('refuse tout chemin qui sortirait de la racine ou que Windows lirait autrement', () => {
    const refuses = [
      '',
      '/',
      '/sessions/a.json',
      'sessions/',
      'sessions//a.json',
      '.',
      '..',
      '../a.json',
      'sessions/../../a.json',
      './a.json',
      'C:/Windows/win.ini',
      'C:a.json',
      'a.json:flux',
      'sessions\\a.json',
      '\\\\serveur\\partage',
      'a<b',
      'a>b',
      'a"b',
      'a|b',
      'a?b',
      'a*b',
      'a\u0000b',
      'a\u001fb',
      'a.',
      'a ',
      'CON',
      'nul.txt',
      'sessions/COM1.json',
      'lpt9',
      'a.json.tracker-tmp',
      'a.json.TRACKER-NEW',
      'x'.repeat(2000),
    ]
    for (const chemin of refuses) expect(() => resoudre(racine, chemin), chemin).toThrow(ErreurDisque)
    expect(() => resoudre(racine, 12)).toThrow(ErreurDisque)
    expect(() => resoudre(racine, null)).toThrow(ErreurDisque)
  })

  it('admet un chemin relatif ordinaire et la racine seulement là où elle est permise', () => {
    expect(resoudre(racine, 'sessions/2026-11-18 voile.gpx')).toBe(path.join(racine, 'sessions', '2026-11-18 voile.gpx'))
    expect(resoudre(racine, 'reglages/PC.json')).toBe(path.join(racine, 'reglages', 'PC.json'))
    expect(resoudre(racine, '', true)).toBe(path.resolve(racine))
    expect(segmentAdmis('console.json')).toBe(true)
    expect(segmentAdmis('.cache')).toBe(true)
  })
})

describe('écriture et lecture', () => {
  it('écrit un fichier neuf en créant ses sous-dossiers, puis le remplace par un contenu plus court', async () => {
    const d = dossierDisque(racine)
    await d.ecrireTexte('sessions/a.json', '{"long":"contenu assez long"}')
    expect(await d.lireTexte('sessions/a.json')).toBe('{"long":"contenu assez long"}')
    await d.ecrireTexte('sessions/a.json', '{}')
    expect(await readFile(path.join(racine, 'sessions', 'a.json'), 'utf8')).toBe('{}')
    expect(await readdir(path.join(racine, 'sessions'))).toEqual(['a.json'])
  })

  it('relit les octets à l’identique', async () => {
    const d = dossierDisque(racine)
    const octets = new Uint8Array(256 * 4).map((_v, i) => i % 256)
    await d.ecrireOctets('sessions/a.imu', octets)
    const relus = await d.lireOctets('sessions/a.imu')
    expect(relus).toBeInstanceOf(Uint8Array)
    expect(Array.from(relus!)).toEqual(Array.from(octets))
  })

  it('retire la marque d’ordre des octets en tête d’un texte et lit l’UTF-8', async () => {
    await writeFile(path.join(racine, 'tracker.json'), Buffer.from('\ufeff{"nom":"équipe"}', 'utf8'))
    expect(await dossierDisque(racine).lireTexte('tracker.json')).toBe('{"nom":"équipe"}')
  })

  it('rend null pour un fichier absent, un dossier à ce nom ou un stat de dossier', async () => {
    const d = dossierDisque(racine)
    await mkdir(path.join(racine, 'sessions'))
    expect(await d.lireTexte('absent.json')).toBeNull()
    expect(await d.lireOctets('sessions/absent.gpx')).toBeNull()
    expect(await d.stat('absent.json')).toBeNull()
    expect(await d.stat('sessions')).toBeNull()
    expect(await d.lireTexte('sessions')).toBeNull()
  })

  it('donne taille et date entière d’un fichier', async () => {
    const d = dossierDisque(racine)
    await d.ecrireTexte('a.txt', 'abc')
    const s = await d.stat('a.txt')
    expect(s?.size).toBe(3)
    expect(Number.isInteger(s?.mtimeMs)).toBe(true)
    expect(Math.abs(s!.mtimeMs - Date.now())).toBeLessThan(60_000)
  })

  it('efface un fichier, sans effet sur un absent, et refuse d’effacer un dossier', async () => {
    const d = dossierDisque(racine)
    await d.ecrireTexte('sessions/a.json', '{}')
    await d.effacer('sessions/a.json')
    expect(await d.stat('sessions/a.json')).toBeNull()
    await d.effacer('sessions/a.json')
    expect(await codeLeve(d.effacer('sessions'))).toBe('UNKNOWN')
    expect((await stat(path.join(racine, 'sessions'))).isDirectory()).toBe(true)
  })

  it('efface avec le fichier ses temporaires, pour qu’une session effacée ne revienne pas au listage suivant', async () => {
    const d = dossierDisque(racine)
    await mkdir(path.join(racine, 'sessions'))
    await writeFile(path.join(racine, 'sessions', 'a.gpx'), 'trace')
    await writeFile(path.join(racine, 'sessions', 'a.gpx.tracker-tmp'), 'trace')
    await writeFile(path.join(racine, 'sessions', 'a.gpx.tracker-new'), 'tr')
    await writeFile(path.join(racine, 'sessions', 'b.gpx.tracker-tmp'), 'seul')
    await d.effacer('sessions/a.gpx')
    await d.effacer('sessions/b.gpx')
    expect(await readdir(path.join(racine, 'sessions'))).toEqual([])
    expect(await d.lister('sessions')).toEqual([])
  })

  it('refuse d’écrire sur un dossier', async () => {
    const d = dossierDisque(racine)
    await mkdir(path.join(racine, 'sessions'))
    expect(await codeLeve(d.ecrireTexte('sessions', 'x'))).toBe('UNKNOWN')
  })

  it('range les écritures d’un même fichier à la file : la dernière gagne, aucun temporaire ne reste', async () => {
    const d = dossierDisque(racine)
    await Promise.all(Array.from({ length: 12 }, (_v, i) => d.ecrireTexte('sessions/a.json', `{"n":${i}}`)))
    expect(await d.lireTexte('sessions/a.json')).toBe('{"n":11}')
    expect(await readdir(path.join(racine, 'sessions'))).toEqual(['a.json'])
  })

  it('écrit un fichier à un chemin absolu sans temporaire restant', async () => {
    const fichier = path.join(tmp, 'coquille.json')
    await ecrireAtomique(fichier, Buffer.from('{"a":1}'))
    await ecrireAtomique(fichier, Buffer.from('{}'))
    expect(await readFile(fichier, 'utf8')).toBe('{}')
    expect((await readdir(tmp)).sort()).toEqual(['Tracker', 'coquille.json'])
  })
})

describe('racine absente', () => {
  it('répond introuvable et ne recrée jamais la racine', async () => {
    const d = dossierDisque(racine)
    await rm(racine, { recursive: true })
    expect(await codeLeve(d.lister(''))).toBe('NOT_FOUND')
    expect(await codeLeve(d.lister('sessions'))).toBe('NOT_FOUND')
    expect(await codeLeve(d.lireTexte('tracker.json'))).toBe('NOT_FOUND')
    expect(await codeLeve(d.stat('tracker.json'))).toBe('NOT_FOUND')
    expect(await codeLeve(d.ecrireTexte('tracker.json', '{}'))).toBe('NOT_FOUND')
    expect(await codeLeve(d.ecrireTexte('sessions/a.json', '{}'))).toBe('NOT_FOUND')
    expect(await codeLeve(d.effacer('sessions/a.json'))).toBe('NOT_FOUND')
    expect(await readdir(tmp)).toEqual([])
  })

  it('liste vide un sous-dossier absent quand la racine est là', async () => {
    expect(await dossierDisque(racine).lister('sessions')).toEqual([])
  })
})

describe('temporaires orphelins', () => {
  it('sont réparés par le listage comme sur le téléphone, et jamais montrés', async () => {
    await writeFile(path.join(racine, 'neuf.json.tracker-new'), 'moitié')
    await writeFile(path.join(racine, 'garde.json'), 'ancien')
    await writeFile(path.join(racine, 'garde.json.tracker-tmp'), 'nouveau peut-être incomplet')
    await writeFile(path.join(racine, 'repris.json.tracker-tmp'), 'nouveau complet')
    const entrees = await dossierDisque(racine).lister('')
    expect(entrees.map((e) => e.name).sort()).toEqual(['garde.json', 'repris.json'])
    expect((await readdir(racine)).sort()).toEqual(['garde.json', 'repris.json'])
    expect(await readFile(path.join(racine, 'garde.json'), 'utf8')).toBe('ancien')
    expect(await readFile(path.join(racine, 'repris.json'), 'utf8')).toBe('nouveau complet')
  })

  it('attendent l’écriture en cours du même fichier et relisent le disque au moment d’agir', async () => {
    // Temporaire seul (l'original avait été retiré) et écriture du même fichier lancée pendant le listage : le
    // temporaire ne doit ni écraser le fichier écrit, ni rester.
    await writeFile(path.join(racine, 'a.json.tracker-tmp'), 'ancien')
    const d = dossierDisque(racine)
    const [entrees] = await Promise.all([d.lister(''), d.ecrireTexte('a.json', 'neuf')])
    expect(await readFile(path.join(racine, 'a.json'), 'utf8')).toBe('neuf')
    expect(await readdir(racine)).toEqual(['a.json'])
    expect(entrees.map((e) => e.name)).toEqual(['a.json'])
  })

  it('décrit fichiers et dossiers', async () => {
    await mkdir(path.join(racine, 'sessions'))
    await writeFile(path.join(racine, 'tracker.json'), '12345')
    const entrees = await dossierDisque(racine).lister('')
    expect(entrees.find((e) => e.name === 'sessions')).toMatchObject({ kind: 'directory', size: 0 })
    expect(entrees.find((e) => e.name === 'tracker.json')).toMatchObject({ kind: 'file', size: 5 })
  })
})

describe('lecture seule', () => {
  it('ne touche à rien : temporaires tus mais laissés, écriture et effacement refusés', async () => {
    await writeFile(path.join(racine, 'a.json'), 'a')
    await writeFile(path.join(racine, 'b.json.tracker-tmp'), 'b')
    const d = dossierDisque(racine, { lectureSeule: true })
    expect((await d.lister('')).map((e) => e.name)).toEqual(['a.json'])
    expect(await codeLeve(d.ecrireTexte('c.json', 'c'))).toBe('PERMISSION')
    expect(await codeLeve(d.ecrireOctets('c.imu', new Uint8Array(1)))).toBe('PERMISSION')
    expect(await codeLeve(d.effacer('a.json'))).toBe('PERMISSION')
    expect((await readdir(racine)).sort()).toEqual(['a.json', 'b.json.tracker-tmp'])
  })

  it('lit comme vide une racine qui n’existe pas encore, sans la créer', async () => {
    const propose = path.join(tmp, 'Documents', 'Tracker')
    const d = dossierDisque(propose, { lectureSeule: true })
    expect(await d.lister('')).toEqual([])
    expect(await d.lireTexte('tracker.json')).toBeNull()
    expect(await d.stat('tracker.json')).toBeNull()
    expect(await readdir(tmp)).toEqual(['Tracker'])
  })
})

describe('liens et jonctions', () => {
  /** Un dossier hors de la mémoire (`C:\\ailleurs`) avec un fichier, et une jonction `x` posée dans la mémoire qui y mène. */
  async function ailleursEtJonction(sous = racine): Promise<string> {
    const ailleurs = path.join(tmp, 'ailleurs')
    await mkdir(ailleurs)
    await writeFile(path.join(ailleurs, 'f.json'), 'secret')
    // Une jonction ne demande pas de droits d'administrateur sous Windows.
    symlinkSync(ailleurs, path.join(sous, 'x'), 'junction')
    return ailleurs
  }

  it('aucune lecture, écriture, création de dossier ni suppression ne traverse une jonction', async () => {
    const ailleurs = await ailleursEtJonction()
    const d = dossierDisque(racine)
    expect(await codeLeve(d.lireTexte('x/f.json'))).toBe('PERMISSION')
    expect(await codeLeve(d.lireOctets('x/f.json'))).toBe('PERMISSION')
    expect(await codeLeve(d.stat('x/f.json'))).toBe('PERMISSION')
    expect(await codeLeve(d.stat('x'))).toBe('PERMISSION')
    expect(await codeLeve(d.ecrireTexte('x/f.json', 'écrasé'))).toBe('PERMISSION')
    expect(await codeLeve(d.ecrireTexte('x/neuf.json', 'neuf'))).toBe('PERMISSION')
    expect(await codeLeve(d.ecrireOctets('x/sous/dossier/a.imu', new Uint8Array([1])))).toBe('PERMISSION')
    expect(await codeLeve(d.effacer('x/f.json'))).toBe('PERMISSION')
    expect(await codeLeve(d.effacer('x'))).toBe('PERMISSION')
    expect(await codeLeve(d.lister('x'))).toBe('PERMISSION')
    expect(await readdir(ailleurs)).toEqual(['f.json'])
    expect(await readFile(path.join(ailleurs, 'f.json'), 'utf8')).toBe('secret')
    // La jonction elle-même est toujours là : rien ne l'a remplacée.
    expect((await readdir(racine)).sort()).toEqual(['x'])
  })

  it('le listage tait une jonction, à la racine comme dans un sous-dossier', async () => {
    await mkdir(path.join(racine, 'sessions'))
    await writeFile(path.join(racine, 'sessions', 'a.json'), 'a')
    await ailleursEtJonction(path.join(racine, 'sessions'))
    symlinkSync(path.join(racine, 'sessions'), path.join(racine, 'raccourci'), 'junction')
    const d = dossierDisque(racine)
    expect((await d.lister('')).map((e) => [e.name, e.kind])).toEqual([['sessions', 'directory']])
    expect((await d.lister('sessions')).map((e) => e.name)).toEqual(['a.json'])
    // Même une jonction qui mène dans la mémoire n'est pas traversée.
    expect(await codeLeve(d.lireTexte('raccourci/a.json'))).toBe('PERMISSION')
  })

  it('la racine elle-même peut être une jonction (dossier choisi par l\'utilisateur)', async () => {
    const vrai = path.join(tmp, 'vrai')
    await mkdir(vrai)
    const lien = path.join(tmp, 'lien')
    symlinkSync(vrai, lien, 'junction')
    const d = dossierDisque(lien)
    await d.ecrireTexte('sessions/a.json', 'a')
    expect(await d.lireTexte('sessions/a.json')).toBe('a')
    expect((await d.lister('sessions')).map((e) => e.name)).toEqual(['a.json'])
    expect(await readFile(path.join(vrai, 'sessions', 'a.json'), 'utf8')).toBe('a')
    await d.effacer('sessions/a.json')
    expect(await readdir(path.join(vrai, 'sessions'))).toEqual([])
  })

  it('en lecture seule aussi, une jonction n\'est ni lue ni listée', async () => {
    await ailleursEtJonction()
    const d = dossierDisque(racine, { lectureSeule: true })
    expect(await codeLeve(d.lireTexte('x/f.json'))).toBe('PERMISSION')
    expect(await d.lister('')).toEqual([])
  })
})

describe('nouveaux essais', () => {
  it('reprend une écriture refusée un instant, puis abandonne', async () => {
    let appels = 0
    expect(
      await avecEssais(async () => {
        appels++
        if (appels < 3) throw erreurNode('EBUSY')
        return 'fait'
      }, [1, 1, 1, 1, 1]),
    ).toBe('fait')
    expect(appels).toBe(3)

    appels = 0
    await expect(
      avecEssais(async () => {
        appels++
        throw erreurNode('EPERM')
      }, [1, 1, 1, 1, 1]),
    ).rejects.toMatchObject({ code: 'EPERM' })
    expect(appels).toBe(6)
  })

  it('ne reprend pas une erreur qui ne passera pas', async () => {
    let appels = 0
    await expect(
      avecEssais(async () => {
        appels++
        throw erreurNode('ENOSPC')
      }, [1, 1]),
    ).rejects.toMatchObject({ code: 'ENOSPC' })
    expect(appels).toBe(1)
  })

  it('met les erreurs de Node en codes de la page', () => {
    expect(codeDe(erreurNode('ENOENT'))).toBe('NOT_FOUND')
    expect(codeDe(erreurNode('EACCES'))).toBe('PERMISSION')
    expect(codeDe(erreurNode('ENOSPC'))).toBe('NO_SPACE')
    expect(codeDe(erreurNode('EIO'))).toBe('UNKNOWN')
    expect(codeDe('texte')).toBe('UNKNOWN')
  })
})

describe('OneDrive et dossier proposé', () => {
  const env = { OneDrive: 'C:\\Users\\marin\\OneDrive', OneDriveCommercial: 'C:\\Users\\marin\\OneDrive - Club', OneDriveConsumer: '' }

  it('reconnaît un chemin de OneDrive, sans se tromper sur un nom voisin ni sur la casse', () => {
    expect(estDansOneDrive('C:\\Users\\marin\\OneDrive\\Documents\\Tracker', env)).toBe(true)
    expect(estDansOneDrive('c:\\users\\MARIN\\onedrive', env)).toBe(true)
    expect(estDansOneDrive('C:\\Users\\marin\\OneDrive - Club\\Tracker', env)).toBe(true)
    expect(estDansOneDrive('C:\\Users\\marin\\OneDriveAutre\\Tracker', env)).toBe(false)
    expect(estDansOneDrive('C:\\Users\\marin\\Documents\\Tracker', env)).toBe(false)
    expect(estDansOneDrive('C:\\Users\\marin\\Documents', {})).toBe(false)
  })

  it('propose Documents\\Tracker, ou le dossier de l’utilisateur si Documents est dans OneDrive', () => {
    expect(dossierPropose('C:\\Users\\marin\\Documents', 'C:\\Users\\marin', env)).toEqual({
      chemin: path.join('C:\\Users\\marin\\Documents', 'Tracker'),
      oneDrive: false,
      documentsOneDrive: false,
    })
    expect(dossierPropose('C:\\Users\\marin\\OneDrive\\Documents', 'C:\\Users\\marin', env)).toEqual({
      chemin: path.join('C:\\Users\\marin', 'Tracker'),
      oneDrive: false,
      documentsOneDrive: true,
    })
  })
})
