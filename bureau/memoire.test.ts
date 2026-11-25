import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Memoire, OptionsMemoire } from './memoire'
import { CANAUX_MEMOIRE, FICHIER_COQUILLE, creerMemoire, gestionnairesMemoire, optionsDepuisEnvironnement } from './memoire'
import type { Reponse } from './pont'

let tmp: string
let profil: string
let documents: string
let maison: string

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'trk-memoire-'))
  profil = path.join(tmp, 'profil')
  maison = path.join(tmp, 'maison')
  documents = path.join(maison, 'Documents')
  await mkdir(profil)
  await mkdir(documents, { recursive: true })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

/** Mémoire d'essai : `choix` est la réponse de la fenêtre de choix, `demandes` reçoit ce qu'on lui a demandé. */
function memoire(options: Partial<OptionsMemoire> & { choix?: string | null } = {}, demandes: { titre: string; depart: string }[] = []): Memoire {
  return creerMemoire({
    profil,
    documents,
    maison,
    env: {},
    choisirDossier: async (demande) => {
      demandes.push(demande)
      return options.choix ?? null
    },
    ...options,
  })
}

/** Valeur d'une réponse réussie ; échoue le test sinon. */
function valeur<T>(r: Reponse<T>): T {
  if (!r.ok) throw new Error(`réponse en échec : ${r.code} ${r.message}`)
  return r.valeur
}

async function contenu(dossier: string): Promise<string[]> {
  return (await readdir(dossier)).sort()
}

describe('premier lancement', () => {
  it('ne retient rien et ne crée rien avant « adopter »', async () => {
    const m = memoire()
    expect(valeur(await m.ouvrir())).toEqual({ etat: 'aucun' })
    const propose = valeur(await m.proposer())
    expect(propose).toEqual({ chemin: path.join(documents, 'Tracker'), oneDrive: false, documentsOneDrive: false })
    expect(valeur(await m.lister({ racine: 'candidat', chemin: '' }))).toEqual([])
    expect(await contenu(documents)).toEqual([])
    expect(await contenu(profil)).toEqual([])
    const fichier = await m.lireTexte({ racine: 'memoire', chemin: 'tracker.json' })
    expect(fichier).toMatchObject({ ok: false, code: 'NOT_FOUND' })
  })

  it('« adopter » crée le dossier proposé, le retient dans le profil, et le rouvre au lancement suivant', async () => {
    const m = memoire()
    valeur(await m.proposer())
    const chemin = path.join(documents, 'Tracker')
    expect(valeur(await m.adopter({ descendre: false }))).toEqual({ chemin, oneDrive: false })
    expect(JSON.parse(await readFile(path.join(profil, FICHIER_COQUILLE), 'utf8'))).toEqual({ dossier: chemin })
    valeur(await m.ecrireTexte({ racine: 'memoire', chemin: 'reglages/PC.json', texte: '{}' }))
    expect(await readFile(path.join(chemin, 'reglages', 'PC.json'), 'utf8')).toBe('{}')

    const suivant = memoire()
    expect(valeur(await suivant.ouvrir())).toEqual({ etat: 'pret', chemin, oneDrive: false })
    expect(valeur(await suivant.lireTexte({ racine: 'memoire', chemin: 'reglages/PC.json' }))).toBe('{}')
    expect(await contenu(profil)).toEqual([FICHIER_COQUILLE])
  })

  it('propose le dossier de l’utilisateur quand Documents est dans OneDrive', async () => {
    const env = { OneDrive: maison.replace(/maison$/, 'maison\\Documents') }
    const propose = valeur(await memoire({ env }).proposer())
    expect(propose).toEqual({ chemin: path.join(maison, 'Tracker'), oneDrive: false, documentsOneDrive: true })
  })

  it('n’adopte rien sans dossier proposé ni choisi', async () => {
    expect(await memoire().adopter({})).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(await contenu(profil)).toEqual([])
  })
})

describe('coquille.json', () => {
  it('abîmé, il vaut « aucun dossier », et « adopter » le récrit', async () => {
    await writeFile(path.join(profil, FICHIER_COQUILLE), '{"dossier": "C:\\\\inco')
    const m = memoire()
    expect(valeur(await m.ouvrir())).toEqual({ etat: 'aucun' })
    await writeFile(path.join(profil, FICHIER_COQUILLE), '{"dossier": "relatif/Tracker"}')
    expect(valeur(await m.ouvrir())).toEqual({ etat: 'aucun' })
    await writeFile(path.join(profil, FICHIER_COQUILLE), '[1, 2]')
    expect(valeur(await m.ouvrir())).toEqual({ etat: 'aucun' })
    valeur(await m.proposer())
    valeur(await m.adopter(undefined))
    expect(valeur(await m.ouvrir())).toMatchObject({ etat: 'pret' })
    // La copie abîmée est mise de côté, jamais écrasée.
    const fichiers = await contenu(profil)
    expect(fichiers).toHaveLength(2)
    expect(fichiers[0]).toMatch(/^coquille-abimee-\d+\.json$/)
    expect(await readFile(path.join(profil, fichiers[0]), 'utf8')).toBe('[1, 2]')
  })

  it('se lit malgré une marque d’ordre des octets en tête', async () => {
    const retenu = path.join(maison, 'Memoire')
    await mkdir(retenu)
    await writeFile(path.join(profil, FICHIER_COQUILLE), `﻿${JSON.stringify({ dossier: retenu })}`)
    expect(valeur(await memoire().ouvrir())).toEqual({ etat: 'pret', chemin: retenu, oneDrive: false })
  })

  it('tenu un instant par un autre programme, il est relu après quelques essais', async () => {
    const retenu = path.join(maison, 'Memoire')
    await mkdir(retenu)
    await writeFile(path.join(profil, FICHIER_COQUILLE), JSON.stringify({ dossier: retenu }))
    let refus = 2
    const lireFichier = async (fichier: string) => {
      if (refus-- > 0) throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' })
      return readFile(fichier)
    }
    expect(valeur(await memoire({ lireFichier }).ouvrir())).toEqual({ etat: 'pret', chemin: retenu, oneDrive: false })
  })

  it('qui ne se lit pas, il donne « illisible » sans chemin, et n’est jamais récrit', async () => {
    const retenu = path.join(maison, 'Memoire')
    const avant = JSON.stringify({ dossier: retenu })
    await writeFile(path.join(profil, FICHIER_COQUILLE), avant)
    const lireFichier = async () => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    }
    const m = memoire({ lireFichier })
    expect(valeur(await m.ouvrir())).toMatchObject({ etat: 'illisible', chemin: null, oneDrive: false, code: 'PERMISSION' })
    expect(await m.lister({ racine: 'memoire', chemin: '' })).toMatchObject({ ok: false, code: 'PERMISSION' })
    valeur(await m.proposer())
    expect(await m.adopter({})).toMatchObject({ ok: false, code: 'PERMISSION' })
    expect(await m.oublier()).toMatchObject({ ok: false })
    expect(await readFile(path.join(profil, FICHIER_COQUILLE), 'utf8')).toBe(avant)
    expect(await contenu(profil)).toEqual([FICHIER_COQUILLE])
  })

  it('remplacé par un dossier, il donne « illisible » et rien n’est adopté', async () => {
    await mkdir(path.join(profil, FICHIER_COQUILLE))
    const m = memoire()
    expect(valeur(await m.ouvrir())).toMatchObject({ etat: 'illisible', chemin: null })
    valeur(await m.proposer())
    expect(await m.adopter({})).toMatchObject({ ok: false })
    expect(await contenu(documents)).toEqual(['Tracker'])
  })

  it('« oublier » le vide et ne touche pas au dossier', async () => {
    const m = memoire()
    valeur(await m.proposer())
    const { chemin } = valeur(await m.adopter({}))
    valeur(await m.oublier())
    expect(valeur(await m.ouvrir())).toEqual({ etat: 'aucun' })
    expect(JSON.parse(await readFile(path.join(profil, FICHIER_COQUILLE), 'utf8'))).toEqual({})
    expect(await contenu(path.dirname(chemin))).toEqual(['Tracker'])
  })
})

describe('dossier retenu introuvable', () => {
  it('répond « introuvable », n’est jamais recréé, et revient quand son nom est remis', async () => {
    const m = memoire()
    valeur(await m.proposer())
    const { chemin } = valeur(await m.adopter({}))
    const ailleurs = path.join(documents, 'Tracker-renomme')
    await rename(chemin, ailleurs)

    const suivant = memoire()
    expect(valeur(await suivant.ouvrir())).toEqual({ etat: 'introuvable', chemin, oneDrive: false })
    expect(await suivant.ecrireTexte({ racine: 'memoire', chemin: 'reglages/PC.json', texte: '{}' })).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(await suivant.lister({ racine: 'memoire', chemin: '' })).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(await contenu(documents)).toEqual(['Tracker-renomme'])

    await rename(ailleurs, chemin)
    expect(valeur(await suivant.ouvrir())).toMatchObject({ etat: 'pret', chemin })
  })
})

describe('dossier choisi', () => {
  it('est un candidat en lecture seule, décrit par son nom et ce qu’il contient', async () => {
    const choisi = path.join(maison, 'Voile')
    await mkdir(path.join(choisi, 'Tracker', 'sessions'), { recursive: true })
    await writeFile(path.join(choisi, 'Tracker', 'tracker.json'), '{"version":1}')
    await writeFile(path.join(choisi, 'notes.txt.tracker-new'), 'x')
    const demandes: { titre: string; depart: string }[] = []
    const m = memoire({ choix: choisi }, demandes)

    const choix = valeur(await m.choisir({ titre: 'Choisir le dossier mémoire', documents: true }))
    expect(choix).toEqual({ chemin: choisi, nom: 'Voile', noms: ['Tracker'], oneDrive: false })
    expect(demandes).toEqual([{ titre: 'Choisir le dossier mémoire', depart: documents }])
    expect(valeur(await m.lireTexte({ racine: 'candidat', chemin: 'Tracker/tracker.json' }))).toBe('{"version":1}')

    expect(await m.ecrireTexte({ racine: 'candidat', chemin: 'Tracker/a.json', texte: '{}' })).toMatchObject({ ok: false, code: 'PERMISSION' })
    expect(await m.ecrireOctets({ racine: 'candidat', chemin: 'a.imu', octets: new Uint8Array(2) })).toMatchObject({ ok: false, code: 'PERMISSION' })
    expect(await m.effacer({ racine: 'candidat', chemin: 'notes.txt.tracker-new' })).toMatchObject({ ok: false })
    expect(await m.effacerDossier({ racine: 'candidat', chemin: 'Tracker/sessions' })).toMatchObject({ ok: false, code: 'PERMISSION' })
    expect(await contenu(choisi)).toEqual(['Tracker', 'notes.txt.tracker-new'])
    expect(await contenu(path.join(choisi, 'Tracker'))).toEqual(['sessions', 'tracker.json'])
    expect(await contenu(profil)).toEqual([])
  })

  it('« adopter » avec descente retient le dossier Tracker du dossier choisi', async () => {
    const choisi = path.join(maison, 'Voile')
    await mkdir(path.join(choisi, 'Tracker'), { recursive: true })
    const m = memoire({ choix: choisi })
    valeur(await m.choisir({}))
    expect(valeur(await m.adopter({ descendre: true }))).toEqual({ chemin: path.join(choisi, 'Tracker'), oneDrive: false })
    // Le candidat est consommé : un second « adopter » n'adopte rien.
    expect(await m.adopter({})).toMatchObject({ ok: false, code: 'NOT_FOUND' })
  })

  it('une seule fenêtre de choix à la fois : un second appel reçoit la même réponse', async () => {
    const choisi = path.join(maison, 'Voile')
    await mkdir(choisi)
    let ouvertures = 0
    let repondre: (chemin: string | null) => void = () => undefined
    const m = memoire({
      choisirDossier: () => {
        ouvertures++
        return new Promise((fin) => (repondre = fin))
      },
    })
    const premier = m.choisir({ titre: 'x' })
    const second = m.choisir({ titre: 'y', documents: true })
    await new Promise((fin) => setTimeout(fin, 20))
    repondre(choisi)
    expect(await second).toEqual(await premier)
    expect(ouvertures).toBe(1)
    const troisieme = m.choisir({})
    await new Promise((fin) => setTimeout(fin, 20))
    repondre(null)
    expect(valeur(await troisieme)).toBeNull()
    expect(ouvertures).toBe(2)
  })

  it('un renoncement rend null et laisse le candidat d’avant', async () => {
    const m = memoire({ choix: null })
    valeur(await m.proposer())
    expect(valeur(await m.choisir({ titre: 'x' }))).toBeNull()
    expect(valeur(await m.adopter({}))).toMatchObject({ chemin: path.join(documents, 'Tracker') })
  })

  it('s’ouvre sur le dossier retenu, sauf demande de Documents', async () => {
    const demandes: { titre: string; depart: string }[] = []
    const m = memoire({ choix: null }, demandes)
    valeur(await m.proposer())
    const { chemin } = valeur(await m.adopter({}))
    valeur(await m.choisir({ titre: 'x' }))
    valeur(await m.choisir({ titre: 'x', documents: true }))
    expect(demandes.map((d) => d.depart)).toEqual([chemin, documents])
  })

  it('n’adopte pas un dossier choisi dont le parent a disparu', async () => {
    const choisi = path.join(maison, 'Cle', 'Tracker')
    await mkdir(choisi, { recursive: true })
    const m = memoire({ choix: choisi })
    valeur(await m.choisir({}))
    await rm(path.join(maison, 'Cle'), { recursive: true })
    expect(await m.adopter({})).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(await contenu(maison)).toEqual(['Documents'])
  })
})

describe('messages mal formés', () => {
  it('sont refusés sans exception', async () => {
    const m = memoire()
    valeur(await m.proposer())
    valeur(await m.adopter({}))
    const refuses: Promise<Reponse<unknown>>[] = [
      m.lister(undefined),
      m.lister('sessions'),
      m.lister({ racine: 'autre', chemin: '' }),
      m.lister({ racine: 'memoire', chemin: 3 }),
      m.lireTexte({ racine: 'memoire', chemin: '../coquille.json' }),
      m.lireTexte({ racine: 'memoire', chemin: path.join(profil, FICHIER_COQUILLE) }),
      m.ecrireTexte({ racine: 'memoire', chemin: 'a.json', texte: 12 }),
      m.ecrireOctets({ racine: 'memoire', chemin: 'a.imu', octets: [1, 2, 3] }),
      m.ecrireOctets({ racine: 'memoire', chemin: 'a.imu', octets: 'AQID' }),
      m.adopter({ descendre: 'oui' }),
      m.choisir({ documents: 'oui' }),
    ]
    for (const r of await Promise.all(refuses)) expect(r).toMatchObject({ ok: false, code: expect.any(String), message: expect.any(String) })
    expect(await contenu(path.join(documents, 'Tracker'))).toEqual([])
  })

  it('accepte un Buffer comme tableau d’octets', async () => {
    const m = memoire()
    valeur(await m.proposer())
    valeur(await m.adopter({}))
    valeur(await m.ecrireOctets({ racine: 'memoire', chemin: 'a.imu', octets: Buffer.from([1, 2, 3]) }))
    expect(Array.from(valeur(await m.lireOctets({ racine: 'memoire', chemin: 'a.imu' }))!)).toEqual([1, 2, 3])
  })
})

describe('canaux et mode d’essai', () => {
  it('un gestionnaire par canal, préfixé « memoire: »', () => {
    expect(Object.keys(gestionnairesMemoire(memoire()))).toEqual(CANAUX_MEMOIRE.map((c) => `memoire:${c}`))
  })

  it('les variables d’essai sont ignorées hors du mode d’essai', () => {
    const choisir = async () => null
    const dossiers = { profil, documents, maison }
    const env = { TRACKER_MEMOIRE: 'D:\\essai\\memoire', TRACKER_DOCUMENTS: 'D:\\essai\\docs', TRACKER_BANC_DOSSIER: 'D:\\essai\\choix' }
    const hors = optionsDepuisEnvironnement(env, dossiers, choisir)
    expect(hors).toMatchObject({ documents, maison, memoireEssai: null })
    expect(hors.choisirDossier).toBe(choisir)

    const essai = optionsDepuisEnvironnement({ ...env, TRACKER_BANC: '1' }, dossiers, choisir)
    expect(essai).toMatchObject({ documents: path.resolve('D:\\essai\\docs'), maison: path.resolve('D:\\essai'), memoireEssai: path.resolve('D:\\essai\\memoire') })
  })

  it('en mode d’essai sans Documents donné, le vrai Documents n’est jamais proposé', () => {
    const essai = optionsDepuisEnvironnement({ TRACKER_BANC: '1' }, { profil, documents, maison }, async () => null)
    expect(essai.documents).toBe(path.join(profil, 'Documents-essai'))
    expect(essai.memoireEssai).toBeNull()
  })

  it('la fenêtre de choix répond par TRACKER_BANC_DOSSIER, vide valant renoncement', async () => {
    const choisi = path.join(maison, 'Choisi')
    await mkdir(choisi)
    const avec = optionsDepuisEnvironnement({ TRACKER_BANC: '1', TRACKER_BANC_DOSSIER: choisi }, { profil, documents, maison }, async () => null)
    expect(await avec.choisirDossier({ titre: 'x', depart: documents })).toBe(choisi)
    const vide = optionsDepuisEnvironnement({ TRACKER_BANC: '1', TRACKER_BANC_DOSSIER: ' ' }, { profil, documents, maison }, async () => null)
    expect(await vide.choisirDossier({ titre: 'x', depart: documents })).toBeNull()
  })

  it('TRACKER_MEMOIRE vaut dossier retenu d’avance, jusqu’à « oublier »', async () => {
    const retenu = path.join(maison, 'Memoire-essai')
    await mkdir(retenu)
    const m = creerMemoire(optionsDepuisEnvironnement({ TRACKER_BANC: '1', TRACKER_MEMOIRE: retenu, TRACKER_DOCUMENTS: documents }, { profil, documents, maison }, async () => null))
    expect(valeur(await m.ouvrir())).toEqual({ etat: 'pret', chemin: retenu, oneDrive: false })
    valeur(await m.ecrireTexte({ racine: 'memoire', chemin: 'tracker.json', texte: '{}' }))
    expect(await contenu(retenu)).toEqual(['tracker.json'])
    valeur(await m.oublier())
    expect(valeur(await m.ouvrir())).toEqual({ etat: 'aucun' })
  })
})
