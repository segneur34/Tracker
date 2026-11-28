import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FICHIER_JOURNAL,
  FICHIER_JOURNAL_ANCIEN,
  LONGUEUR_LIGNE_MAX,
  LONGUEUR_NOTE_MAX,
  TAILLE_JOURNAL_MAX,
  creerJournal,
  horodatage,
  journaliseur,
  ligneDuJournal,
  lireNote,
  resumeEtat,
  sansDonneesPersonnelles,
  suivreEtats,
  surUneLigne,
} from './journal'
import type { DossierDistant, EtatTelephone } from './telephone'

let tmp: string

const MAINTENANT = new Date(2026, 10, 22, 9, 4, 7, 42).getTime()

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'trk-journal-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('lignes', () => {
  it('date chaque ligne à l’heure locale, à la milliseconde', () => {
    expect(horodatage(MAINTENANT)).toBe('2026-11-22 09:04:07.042')
    expect(ligneDuJournal(MAINTENANT, 'téléphone arrivé')).toBe('2026-11-22 09:04:07.042 téléphone arrivé\n')
  })

  it('met un message sur une seule ligne et le borne', () => {
    expect(surUneLigne('  un\r\ndeux\tpuis\u2028trois ')).toBe('un deux puis trois')
    const long = 'é'.repeat(LONGUEUR_LIGNE_MAX + 50)
    const coupe = surUneLigne(long)
    expect([...coupe]).toHaveLength(LONGUEUR_LIGNE_MAX)
    expect(coupe.endsWith('…')).toBe(true)
  })

  it('lit une étape de la page, bornée à 300 caractères, et refuse ce qui est mal formé', () => {
    expect(lireNote({ texte: 'synchronisation : attente\ndu téléphone' })).toBe('synchronisation : attente du téléphone')
    expect([...(lireNote({ texte: 'x'.repeat(1_000) }) ?? '')]).toHaveLength(LONGUEUR_NOTE_MAX)
    expect(lireNote({ texte: ' \n ' })).toBeNull()
    expect(lireNote({ texte: 3 })).toBeNull()
    expect(lireNote('texte')).toBeNull()
    expect(lireNote(null)).toBeNull()
    expect(lireNote([{ texte: 'a' }])).toBeNull()
  })
})

describe('rien de personnel', () => {
  it('retire le dossier personnel, les chemins de Windows et d’Android et les adresses web', () => {
    const maison = 'C:\\Users\\Jean Dupont'
    expect(sansDonneesPersonnelles("EPERM: open 'C:\\Users\\Jean Dupont\\AppData\\Roaming\\Tracker\\coquille.json'", [maison])).toBe("EPERM: open '<dossier personnel>\\AppData\\Roaming\\Tracker\\coquille.json'")
    expect(sansDonneesPersonnelles("EPERM: open 'D:\\Jean Dupont\\cle.bin'")).toBe('EPERM: open <chemin>')
    expect(sansDonneesPersonnelles('profil C:/Users/jean dupont/AppData/Roaming/Tracker, fin', [maison])).toBe('profil <dossier personnel>/AppData/Roaming/Tracker, fin')
    expect(sansDonneesPersonnelles('adb : D:\\Outils\\adb.exe, serveur 41')).toBe('adb : <chemin>, serveur 41')
    expect(sansDonneesPersonnelles('copie : "D:\\Mes sessions\\a.gpx" faite')).toBe('copie : <chemin> faite')
    expect(sansDonneesPersonnelles('partage \\\\NAS\\voile\\b.gpx')).toBe('partage <chemin>')
    expect(sansDonneesPersonnelles('lien externe : https://exemple.org/page?x=1 ouvert')).toBe('lien externe : <adresse> ouvert')
    expect(sansDonneesPersonnelles('find: /sdcard/Documents/Tracker/sessions/Jean.gpx: refusé')).toBe('find: <chemin> refusé')
    expect(sansDonneesPersonnelles('téléphone parti (silence) : le téléphone ne répond plus.')).toBe('téléphone parti (silence) : le téléphone ne répond plus.')
  })

  it('retire les adresses IPv4, garde le port, les heures et les numéros de version', () => {
    expect(sansDonneesPersonnelles("fenêtre d'appairage ouverte sur 192.168.1.20:48217 à 10:04")).toBe("fenêtre d'appairage ouverte sur <adresse IP>:48217 à 10:04")
    expect(sansDonneesPersonnelles('listen EADDRNOTAVAIL: address not available 10.0.0.7:47000.')).toBe('listen EADDRNOTAVAIL: address not available <adresse IP>:47000.')
    expect(sansDonneesPersonnelles('sans-fil à l\'écoute : 192.168.1.20, 172.16.0.3, port 47000')).toBe('sans-fil à l\'écoute : <adresse IP>, <adresse IP>, port 47000')
    expect(sansDonneesPersonnelles('client ::ffff:192.168.43.1 refusé')).toBe('client ::ffff:<adresse IP> refusé')
    expect(sansDonneesPersonnelles('adb trouvé, serveur 1.0.41, outils 35.0.2')).toBe('adb trouvé, serveur 1.0.41, outils 35.0.2')
    expect(sansDonneesPersonnelles('version 1.2.3.4.5, octet 300.1.1.1')).toBe('version 1.2.3.4.5, octet 300.1.1.1')
  })

  it('le journal daté ne prend que le message, la sortie d’essai prend la ligne détaillée', async () => {
    const fichier: string[] = []
    const sortie: string[] = []
    const journal = journaliseur({ noter: (m) => fichier.push(m) }, (l) => sortie.push(l))
    journal('application installée', 'application installée sur Pixel 8')
    journal('téléphone arrivé')
    expect(fichier).toEqual(['application installée', 'téléphone arrivé'])
    expect(sortie).toEqual(['application installée sur Pixel 8', 'téléphone arrivé'])
    // Hors du mode d'essai : pas de sortie, le fichier seul.
    journaliseur({ noter: (m) => fichier.push(m) }, null)('copie de sécurité faite', 'copie de sécurité faite : C:\\Users\\Jean\\Tracker-copies')
    expect(fichier.at(-1)).toBe('copie de sécurité faite')
    // Le filet s'applique aussi à ce que le fichier reçoit.
    creerJournal({ dossier: tmp, horloge: () => MAINTENANT, masques: ['C:\\Users\\Jean'] }).noter('profil C:\\Users\\Jean\\AppData')
    expect(await readFile(path.join(tmp, FICHIER_JOURNAL), 'utf8')).toBe('2026-11-22 09:04:07.042 profil <dossier personnel>\\AppData\n')
  })
})

describe('creerJournal', () => {
  it('écrit les lignes à la suite dans le profil, créé au besoin', async () => {
    const dossier = path.join(tmp, 'profil')
    let ms = MAINTENANT
    const journal = creerJournal({ dossier, horloge: () => ms })
    journal.noter('lancement')
    ms += 1_000
    journal.noter('téléphone parti (silence)')
    expect(await readFile(path.join(dossier, FICHIER_JOURNAL), 'utf8')).toBe(
      '2026-11-22 09:04:07.042 lancement\n2026-11-22 09:04:08.042 téléphone parti (silence)\n',
    )
  })

  it('reprend un journal existant et compte sa taille pour la bascule', async () => {
    await writeFile(path.join(tmp, FICHIER_JOURNAL), 'a'.repeat(90))
    const journal = creerJournal({ dossier: tmp, horloge: () => MAINTENANT, tailleMax: 100 })
    journal.noter('suite')
    expect(await readFile(path.join(tmp, FICHIER_JOURNAL_ANCIEN), 'utf8')).toBe('a'.repeat(90))
    expect(await readFile(path.join(tmp, FICHIER_JOURNAL), 'utf8')).toBe('2026-11-22 09:04:07.042 suite\n')
  })

  it('bascule sur journal.1.txt au-delà de la borne, l’ancien remplacé, jamais plus du double sur le disque', async () => {
    expect(TAILLE_JOURNAL_MAX).toBe(256 * 1024)
    const tailleMax = 200
    const journal = creerJournal({ dossier: tmp, horloge: () => MAINTENANT, tailleMax })
    // Une ligne de 24 + 11 + 1 = 36 octets (« ° » en prend deux) : 5 lignes tiennent (180), la sixième bascule.
    for (let i = 0; i < 6; i++) journal.noter(`ligne n° ${i}`)
    const courant = await readFile(path.join(tmp, FICHIER_JOURNAL), 'utf8')
    const ancien = await readFile(path.join(tmp, FICHIER_JOURNAL_ANCIEN), 'utf8')
    expect(ancien.split('\n').filter(Boolean)).toHaveLength(5)
    expect(courant.split('\n').filter(Boolean)).toEqual(['2026-11-22 09:04:07.042 ligne n° 5'])
    for (let i = 6; i < 40; i++) journal.noter(`ligne n° ${i}`)
    const tailles = [FICHIER_JOURNAL, FICHIER_JOURNAL_ANCIEN].map(async (nom) => Buffer.byteLength(await readFile(path.join(tmp, nom), 'utf8')))
    for (const taille of await Promise.all(tailles)) expect(taille).toBeLessThanOrEqual(tailleMax)
    expect(await readFile(path.join(tmp, FICHIER_JOURNAL), 'utf8')).toContain('ligne n° 39')
  })

  it('compte les octets, pas les caractères', async () => {
    const journal = creerJournal({ dossier: tmp, horloge: () => MAINTENANT, tailleMax: 70 })
    journal.noter('ééééééééééééé') // 24 + 26 + 1 = 51 octets, 38 caractères
    journal.noter('é') // 51 + 27 octets > 70 : bascule (en caractères, 38 + 26 tiendrait)
    expect(existsSync(path.join(tmp, FICHIER_JOURNAL_ANCIEN))).toBe(true)
  })

  it('ne lève jamais, et reprend quand le dossier redevient écrivable', async () => {
    // Le « dossier » est un fichier : aucune écriture ne peut réussir.
    const bloque = path.join(tmp, 'fichier')
    await writeFile(bloque, 'x')
    const journal = creerJournal({ dossier: bloque, horloge: () => MAINTENANT })
    expect(() => journal.noter('perdu')).not.toThrow()
    await rm(bloque)
    journal.noter('repris')
    expect(await readFile(path.join(bloque, FICHIER_JOURNAL), 'utf8')).toBe('2026-11-22 09:04:07.042 repris\n')
  })
})

describe('états du téléphone', () => {
  it('résume un état sans le nom du téléphone', () => {
    expect(resumeEtat({ etat: 'pret', nom: 'Pixel', ecriture: true })).toBe('prêt (écriture)')
    expect(resumeEtat({ etat: 'pret', nom: 'Pixel', ecriture: false })).toBe('prêt (lecture seule)')
    expect(resumeEtat({ etat: 'pret', nom: 'Pixel' })).toBe('prêt')
    expect(resumeEtat({ etat: 'adbIntrouvable', dossier: 'C:\\outils' })).toBe('adbIntrouvable')
  })

  it('ne note que les changements, et une panne après un état lu', async () => {
    const suite: (EtatTelephone | Error)[] = [{ etat: 'absent' }, { etat: 'absent' }, { etat: 'pret', nom: 'Pixel', ecriture: true }, new Error('adb muet'), { etat: 'absent' }]
    const lignes: string[] = []
    const dossier: DossierDistant = {
      etat: async () => {
        const e = suite.shift()!
        if (e instanceof Error) throw e
        return e
      },
      lister: async () => [],
      lire: async () => undefined,
    }
    const suivi = suivreEtats(dossier, (m) => lignes.push(m))
    expect(suivi.lister).toBe(dossier.lister)
    for (let i = 0; i < 5; i++) await suivi.etat().catch(() => undefined)
    expect(lignes).toEqual([
      'état du téléphone : absent',
      'état du téléphone : prêt (écriture)',
      'état du téléphone : illisible (adb muet)',
      'état du téléphone : absent',
    ])
  })
})
