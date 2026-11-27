import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ErreurDisque, codeDe } from './disque'
import { genererVecteurs, texteVecteurs } from './essais/vecteurs'
import { DEPOT_TELEPHONE, cheminAdmis, cheminEcrivable, cheminRetirable, destinationCorbeilleAdmise } from './telephone'
import type { EnTete, Message, RaisonTrame, Trame } from './trames'
import {
  CAPACITES,
  CAPACITE_ECRITURE,
  CAPACITE_SPAKE2,
  DecodeurTrames,
  ErreurTrame,
  LIMITES,
  LIMITES_ACCUEIL,
  PORT_SANS_FIL,
  PROTOCOLE_SANS_FIL,
  TAILLE_BLOC,
  blocsDEcriture,
  blocsDeLecture,
  capacitesDe,
  cheminLisible,
  encoderMessage,
  encoderTrame,
  lireMessage,
} from './trames'

type Emetteur = 'pc' | 'telephone'
type Regle = { admis: string[]; refuses: string[] }
type Vecteurs = {
  portSansFil: number
  trames: { nom: string; emetteur: Emetteur; enTete: EnTete; corpsHex: string; octetsHex: string }[]
  tramesInvalides: { nom: string; octetsHex: string; erreur: RaisonTrame }[]
  messagesInvalides: { nom: string; emetteur: Emetteur; octetsHex: string; erreur: RaisonTrame }[]
  cheminsListe: Regle
  cheminsLecture: Regle
  cheminsEcriture: Regle
  cheminsRetrait: Regle
  destinationsCorbeille: { depot: string; admises: { chemin: string; vers: string }[]; refusees: { chemin: string; vers: string }[] }
}
const FICHIER_VECTEURS = path.join(__dirname, 'sansFil.vecteurs.json')
const vecteurs = JSON.parse(readFileSync(FICHIER_VECTEURS, 'utf8')) as Vecteurs
const SESSION_DEPOT = `${DEPOT_TELEPHONE}/1795647914477-1795000000000/a.gpx`

const hex = (o: Uint8Array) => Buffer.from(o).toString('hex')
const deHex = (t: string) => Uint8Array.from(Buffer.from(t, 'hex'))
const nonce = 'ab'.repeat(32)

/** Raison de l'erreur levée par `action`, ou `null` si rien n'est levé. */
function raison(action: () => unknown): RaisonTrame | null {
  try {
    action()
    return null
  } catch (e) {
    if (e instanceof ErreurTrame) return e.raison
    throw e
  }
}

const exemples: Message[] = [
  { type: 'appairer', version: 1, nom: 'Pixel 8', nonceTelephone: nonce },
  { type: 'bonjour', version: 1, nom: 'Téléphone de Léa', jeton: 'cd'.repeat(32) },
  { type: 'defi', noncePc: nonce },
  { type: 'preuve', preuve: '01'.repeat(32) },
  { type: 'appaire', preuve: '02'.repeat(32), jeton: '03'.repeat(32), identifiantPc: '04'.repeat(16), nomPc: 'BUREAU' },
  { type: 'bienvenue', identifiantPc: '04'.repeat(16), nomPc: 'BUREAU' },
  { type: 'refus', raison: 'fenetre' },
  { type: 'lister', id: 0 },
  { type: 'lire', id: 2_147_483_647, chemin: 'sessions/2026-11-20 wing.gpx', debut: 3 * TAILLE_BLOC, longueur: TAILLE_BLOC },
  { type: 'ping', id: 5 },
  { type: 'liste', id: 1, fichiers: [{ chemin: 'index.json', taille: 10, dateMs: 1_700_000_000_000 }, { chemin: 'sessions/a.gpx', taille: 0, dateMs: 0 }] },
  { type: 'bloc', id: 3, debut: TAILLE_BLOC, octets: Uint8Array.from([1, 2, 3, 0, 255]) },
  { type: 'pong', id: 5 },
  { type: 'erreur', id: 4, code: 'NOT_FOUND', message: 'Fichier disparu.' },
  { type: 'appairer', version: 1, nom: 'Pixel 8', nonceTelephone: nonce, capacites: ['ecriture'] },
  { type: 'appairer', version: 1, nom: 'Pixel 8', nonceTelephone: nonce, partA: '04'.repeat(65), capacites: ['ecriture'] },
  { type: 'defi', noncePc: nonce, partB: '04'.repeat(65) },
  { type: 'bonjour', version: 1, nom: 'Pixel 8', jeton: 'cd'.repeat(32), capacites: [] },
  { type: 'ecrire', id: 6, chemin: 'itineraires/tour du lac.json', debut: TAILLE_BLOC, taille: TAILLE_BLOC + 3, octets: Uint8Array.from([0, 1, 255]) },
  { type: 'ecrire', id: 7, chemin: 'reglages/pixel.json', debut: 0, taille: 0, octets: new Uint8Array(0) },
  { type: 'valider', id: 8, chemin: 'tracker.json', taille: 12 },
  { type: 'lire', id: 11, chemin: 'corbeille/1795647914477-1795000000000/a.gpx', debut: 0, longueur: 1 },
  { type: 'listerTout', id: 12 },
  { type: 'listeTout', id: 12, fichiers: [{ chemin: 'sessions/a.gpx.tracker-new', taille: 3, dateMs: 0, ordinaire: true }, { chemin: 'x/lien', taille: 0, dateMs: 5, ordinaire: false }] },
  { type: 'deplacer', id: 13, chemin: 'sessions/a.gpx', taille: 3, dateMs: 1_795_000_000_000, vers: SESSION_DEPOT },
  { type: 'listerCorbeille', id: 14 },
  { type: 'listeCorbeille', id: 14, dossiers: ['1795647914477-1795000000000', '1795647914477-tour du lac'] },
  { type: 'listeCorbeille', id: 15, dossiers: [] },
  { type: 'ecrit', id: 8, chemin: 'tracker.json', taille: 12, dateMs: 1_795_000_000_000 },
  { type: 'fait', id: 9 },
  { type: 'pong', id: 10, enregistre: true },
]

/** Les octets d'un message en hexadécimal, pour comparer un bloc lu ou écrit. */
const comparable = (m: Message) => ('octets' in m ? { ...m, octets: hex(m.octets) } : m)

function decoderTout(octets: Uint8Array, taillesMorceaux: (i: number) => number): Trame[] {
  const d = new DecodeurTrames(LIMITES)
  const trames: Trame[] = []
  for (let debut = 0, i = 0; debut < octets.length; i++) {
    const fin = Math.min(octets.length, debut + Math.max(1, taillesMorceaux(i)))
    trames.push(...d.pousser(octets.subarray(debut, fin)))
    debut = fin
  }
  d.fin()
  return trames
}

describe('trames', () => {
  it('chaque message fait l’aller-retour', () => {
    for (const m of exemples) {
      const trames = new DecodeurTrames(LIMITES).pousser(encoderMessage(m))
      expect(trames).toHaveLength(1)
      expect(comparable(lireMessage(trames[0])), m.type).toStrictEqual(comparable(m))
    }
  })

  it('porte les octets d’un ecrire dans le corps, sans les recopier dans l’en-tête', () => {
    const octets = Uint8Array.from([60, 103, 112, 120, 62])
    const [trame] = new DecodeurTrames(LIMITES).pousser(encoderMessage({ type: 'ecrire', id: 1, chemin: 'sessions/a.gpx', debut: 0, taille: 5, octets }))
    expect(trame.enTete).toEqual({ type: 'ecrire', id: 1, chemin: 'sessions/a.gpx', debut: 0, taille: 5 })
    expect(hex(trame.corps)).toBe(hex(octets))
    expect(raison(() => encoderMessage({ type: 'ecrire', id: 1, chemin: 'sessions/a.gpx', debut: 0, taille: 1, octets: new Uint8Array(1) }, LIMITES_ACCUEIL))).toBe('CORPS_TROP_LONG')
  })

  it('rend les mêmes trames quel que soit le morcellement du flux', () => {
    const flux = Buffer.concat(exemples.map((m) => encoderMessage(m)))
    const attendu = decoderTout(flux, () => flux.length).map((t) => [t.enTete, hex(t.corps)])
    expect(attendu).toHaveLength(exemples.length)
    expect(decoderTout(flux, () => 1).map((t) => [t.enTete, hex(t.corps)])).toEqual(attendu)
    let graine = 7
    const pseudoAlea = () => (graine = (graine * 1103515245 + 12345) % 2 ** 31) % 23
    expect(decoderTout(flux, pseudoAlea).map((t) => [t.enTete, hex(t.corps)])).toEqual(attendu)
  })

  it('reçoit un bloc de 1 Mio en morceaux de 16 Kio, sans garder de vue sur les morceaux reçus', () => {
    const octets = Uint8Array.from({ length: TAILLE_BLOC }, (_, i) => (i * 31) & 0xff)
    const flux = Buffer.from(encoderMessage({ type: 'bloc', id: 9, debut: 0, octets }))
    const d = new DecodeurTrames(LIMITES)
    const trames: Trame[] = []
    for (let i = 0; i < flux.length; i += 16_384) {
      const morceau = Buffer.from(flux.subarray(i, i + 16_384))
      trames.push(...d.pousser(morceau))
      morceau.fill(0)
    }
    expect(trames).toHaveLength(1)
    const lu = lireMessage(trames[0])
    expect(lu.type === 'bloc' && Buffer.from(lu.octets).equals(Buffer.from(octets))).toBe(true)
    expect(d.enAttente).toBe(0)
  })

  it('refuse à l’encodage une trame trop longue', () => {
    expect(raison(() => encoderMessage({ type: 'bloc', id: 1, debut: 0, octets: new Uint8Array(TAILLE_BLOC + 1) }))).toBe('CORPS_TROP_LONG')
    expect(raison(() => encoderTrame({ type: 'x', remplissage: 'a'.repeat(LIMITES_ACCUEIL.enTete) }, undefined, LIMITES_ACCUEIL))).toBe('EN_TETE_TROP_LONG')
    expect(raison(() => encoderMessage({ type: 'bloc', id: 1, debut: 0, octets: new Uint8Array(1) }, LIMITES_ACCUEIL))).toBe('CORPS_TROP_LONG')
  })

  it('juge les longueurs dès les huit premiers octets, sans attendre la suite', () => {
    const d = new DecodeurTrames(LIMITES_ACCUEIL)
    const trop = encoderTrame({ type: 'x', remplissage: 'a'.repeat(20_000) })
    expect(raison(() => d.pousser(trop.subarray(0, 8)))).toBe('EN_TETE_TROP_LONG')
    expect(raison(() => d.pousser(new Uint8Array(0)))).toBe('EN_TETE_TROP_LONG')
    expect(raison(() => d.fin())).toBe('EN_TETE_TROP_LONG')
  })

  it('prend par défaut les limites de l’accueil : un inconnu ne fait rien réserver de gros', () => {
    expect(new DecodeurTrames().limites).toEqual(LIMITES_ACCUEIL)
    expect(raison(() => new DecodeurTrames().pousser(encoderMessage({ type: 'bloc', id: 1, debut: 0, octets: new Uint8Array(1) })))).toBe('CORPS_TROP_LONG')
    expect(raison(() => new DecodeurTrames().pousser(encoderTrame({ type: 'x', remplissage: 'a'.repeat(20_000) }).subarray(0, 8)))).toBe('EN_TETE_TROP_LONG')
  })

  it('refuse un en-tête précédé d’une marque d’ordre d’octets', () => {
    const json = Buffer.from(JSON.stringify({ type: 'ping', id: 1 }), 'utf8')
    const prefixe = Buffer.alloc(8)
    prefixe.writeUInt32BE(json.length + 3, 0)
    const trame = Buffer.concat([prefixe, Buffer.from([0xef, 0xbb, 0xbf]), json])
    expect(raison(() => new DecodeurTrames().pousser(trame))).toBe('EN_TETE_ILLISIBLE')
  })

  it('élargit ses limites une fois le téléphone présenté', () => {
    const d = new DecodeurTrames(LIMITES_ACCUEIL)
    expect(d.pousser(encoderMessage({ type: 'ping', id: 1 }))).toHaveLength(1)
    d.limites = LIMITES
    expect(d.pousser(encoderMessage({ type: 'bloc', id: 2, debut: 0, octets: new Uint8Array(1000) }))).toHaveLength(1)
  })

  it('signale une trame tronquée à la fin du flux, et rien quand le flux s’arrête entre deux trames', () => {
    const octets = encoderMessage({ type: 'ping', id: 1 })
    const d = new DecodeurTrames()
    expect(d.pousser(octets.subarray(0, 5))).toEqual([])
    expect(d.enAttente).toBe(5)
    expect(raison(() => d.fin())).toBe('TRONQUEE')
    const entier = new DecodeurTrames()
    entier.pousser(octets)
    expect(raison(() => entier.fin())).toBeNull()
  })

  it('lève une erreur du disque de code UNKNOWN, qui passe telle quelle par le pont', () => {
    const e = new ErreurTrame('TRONQUEE', 'coupé')
    expect(e).toBeInstanceOf(ErreurDisque)
    expect(codeDe(e)).toBe('UNKNOWN')
  })
})

describe('lireMessage', () => {
  const lire = (enTete: EnTete, corps = new Uint8Array(0)) => raison(() => lireMessage({ enTete, corps }))

  it('refuse un type inconnu et un message mal formé', () => {
    expect(lire({ type: 'renommer', id: 1 })).toBe('MESSAGE_INCONNU')
    expect(lire({ type: 'ping' })).toBe('MESSAGE_INVALIDE')
    expect(lire({ type: 'ping', id: -1 })).toBe('MESSAGE_INVALIDE')
    expect(lire({ type: 'ping', id: 1.5 })).toBe('MESSAGE_INVALIDE')
    expect(lire({ type: 'ping', id: 2_147_483_648 })).toBe('MESSAGE_INVALIDE')
    expect(lire({ type: 'ping', id: 1 }, new Uint8Array(1))).toBe('MESSAGE_INVALIDE')
    expect(lire({ type: 'defi', noncePc: nonce.toUpperCase() })).toBe('MESSAGE_INVALIDE')
    expect(lire({ type: 'defi', noncePc: nonce.slice(2) })).toBe('MESSAGE_INVALIDE')
    expect(lire({ type: 'appairer', version: 1, nom: 'Pixel\n8', nonceTelephone: nonce })).toBe('MESSAGE_INVALIDE')
    expect(lire({ type: 'appairer', version: 1, nom: '', nonceTelephone: nonce })).toBe('MESSAGE_INVALIDE')
    expect(lire({ type: 'appairer', version: 1, nom: 'x'.repeat(101), nonceTelephone: nonce })).toBe('MESSAGE_INVALIDE')
    // Une part SPAKE2 facultative, mais de 65 octets en hexadécimal minuscule quand elle est là.
    for (const part of ['04'.repeat(64), '04'.repeat(66), '0A'.repeat(65), 65, null]) {
      expect(lire({ type: 'appairer', version: 1, nom: 'Pixel', nonceTelephone: nonce, partA: part }), JSON.stringify(part)).toBe('MESSAGE_INVALIDE')
      expect(lire({ type: 'defi', noncePc: nonce, partB: part }), JSON.stringify(part)).toBe('MESSAGE_INVALIDE')
    }
    expect(lire({ type: 'refus', raison: 'autre' })).toBe('MESSAGE_INVALIDE')
  })

  it('ne lit qu’un fichier listé ou un chemin réel du listage complet, par bloc de 1 Mio au plus', () => {
    const base = { type: 'lire', id: 1, debut: 0, longueur: 10 }
    for (const chemin of ['sessions/a.gpx', 'index.json', 'itineraires/r.json', 'reglages/pixel.json', 'journaux/j.txt']) expect(lire({ ...base, chemin })).toBeNull()
    // Ce que rend `listerTout` : provisoires, sous-dossiers, corbeille ; la copie de sécurité les relit.
    for (const chemin of ['autre/a.gpx', 'sessions/a/b.gpx', 'a.tracker-tmp', SESSION_DEPOT]) expect(lire({ ...base, chemin }), chemin).toBeNull()
    for (const chemin of ['../a.gpx', 'sessions/../a.gpx', '/a.gpx', 'sessions\\a.gpx', 'sessions//a.gpx', 'C:/a.gpx', 'sessions/a\u0001.gpx', '', 7]) {
      expect(lire({ ...base, chemin }), String(chemin)).toBe('MESSAGE_INVALIDE')
    }
    expect(lire({ ...base, chemin: 'a.gpx', longueur: 0 })).toBe('MESSAGE_INVALIDE')
    expect(lire({ ...base, chemin: 'a.gpx', longueur: TAILLE_BLOC + 1 })).toBe('MESSAGE_INVALIDE')
    expect(lire({ ...base, chemin: 'a.gpx', debut: -1 })).toBe('MESSAGE_INVALIDE')
  })

  it('veut un bloc dont la longueur annoncée est celle du corps', () => {
    expect(lire({ type: 'bloc', id: 1, debut: 0, longueur: 3 }, new Uint8Array(3))).toBeNull()
    expect(lire({ type: 'bloc', id: 1, debut: 0, longueur: 4 }, new Uint8Array(3))).toBe('MESSAGE_INVALIDE')
    expect(lire({ type: 'bloc', id: 1, debut: 0, longueur: 0 })).toBeNull()
  })

  it('écarte d’une liste les fichiers refusés, comme le câble, et la trie', () => {
    const lu = lireMessage({
      enTete: {
        type: 'liste',
        id: 1,
        fichiers: [
          { chemin: 'sessions/b.gpx', taille: 2, dateMs: 0 },
          { chemin: '../vol.gpx', taille: 1, dateMs: 0 },
          { chemin: 'a.json', taille: -1, dateMs: 0 },
          { chemin: 'a.gpx', taille: 1, dateMs: 0, autre: true },
          { chemin: 'reglages/pixel.json', taille: 3, dateMs: 0 },
          { chemin: 'itineraires/r.json', taille: 4, dateMs: 0 },
          { chemin: 'autre/x.json', taille: 5, dateMs: 0 },
          { chemin: 'itineraires/r.json.tracker-new', taille: 6, dateMs: 0 },
        ],
      },
      corps: new Uint8Array(0),
    })
    expect(lu).toEqual({
      type: 'liste',
      id: 1,
      fichiers: [
        { chemin: 'a.gpx', taille: 1, dateMs: 0 },
        { chemin: 'itineraires/r.json', taille: 4, dateMs: 0 },
        { chemin: 'reglages/pixel.json', taille: 3, dateMs: 0 },
        { chemin: 'sessions/b.gpx', taille: 2, dateMs: 0 },
      ],
    })
    expect(lire({ type: 'liste', id: 1, fichiers: [{ chemin: 'a.gpx', taille: '1', dateMs: 0 }] })).toBe('MESSAGE_INVALIDE')
    expect(lire({ type: 'liste', id: 1, fichiers: {} })).toBe('MESSAGE_INVALIDE')
  })

  it('lit les capacités du téléphone : connues seulement, sans doublon, absentes chez un téléphone ancien', () => {
    const bonjour = { type: 'bonjour', version: PROTOCOLE_SANS_FIL, nom: 'Pixel 8', jeton: 'cd'.repeat(32) }
    const lu = (capacites: unknown) => lireMessage({ enTete: { ...bonjour, capacites }, corps: new Uint8Array(0) })
    const ancien = lireMessage({ enTete: bonjour, corps: new Uint8Array(0) })
    expect(ancien).not.toHaveProperty('capacites')
    expect(ancien.type === 'bonjour' && capacitesDe(ancien)).toEqual([])
    expect(lu(['futur', 'ecriture', 'ecriture'])).toMatchObject({ capacites: ['ecriture'] })
    expect(lu(['futur'])).toMatchObject({ capacites: [] })
    const neuf = lu([CAPACITE_ECRITURE])
    expect(neuf.type === 'bonjour' && capacitesDe(neuf)).toEqual([...CAPACITES])
    expect(lireMessage({ enTete: { type: 'appairer', version: 1, nom: 'Pixel', nonceTelephone: nonce, capacites: ['ecriture'] }, corps: new Uint8Array(0) })).toMatchObject({ capacites: ['ecriture'] })
    // « spake2 » s'annonce, mais le PC ne la lit pas : c'est la part du téléphone qui fait l'échange.
    const spake2 = lireMessage({ enTete: { type: 'appairer', version: 1, nom: 'Pixel', nonceTelephone: nonce, capacites: [CAPACITE_ECRITURE, CAPACITE_SPAKE2] }, corps: new Uint8Array(0) })
    expect(spake2).toEqual({ type: 'appairer', version: 1, nom: 'Pixel', nonceTelephone: nonce, capacites: ['ecriture'] })
    for (const faux of ['ecriture', [1], [null], {}, null]) {
      expect(raison(() => lu(faux)), JSON.stringify(faux)).toBe('MESSAGE_INVALIDE')
    }
  })

  it('n’accepte une écriture que dans la liste blanche, bloc dans la taille annoncée', () => {
    const ecrire = (champs: Record<string, unknown>, corps = new Uint8Array(1)) => lire({ type: 'ecrire', id: 1, chemin: 'sessions/a.gpx', debut: 0, taille: 1, ...champs }, corps)
    expect(ecrire({})).toBeNull()
    expect(ecrire({ debut: 4, taille: 5 })).toBeNull()
    expect(ecrire({ taille: 0 }, new Uint8Array(0))).toBeNull()
    expect(ecrire({ taille: TAILLE_BLOC }, new Uint8Array(TAILLE_BLOC))).toBeNull()
    for (const chemin of ['tracker.json', 'fc-repos.json', 'itineraires/r.json', 'reglages/pixel.json']) expect(ecrire({ chemin })).toBeNull()
    for (const chemin of ['index.json', 'lieux.json', 'journaux/j.txt', SESSION_DEPOT, 'autre/a.gpx', 'sessions', 'sessions/a/b.gpx', 'sessions/a.gpx.tracker-tmp', '../tracker.json', 7]) {
      expect(ecrire({ chemin }), String(chemin)).toBe('MESSAGE_INVALIDE')
    }
    expect(ecrire({ debut: -1 })).toBe('MESSAGE_INVALIDE')
    expect(ecrire({ taille: -1 })).toBe('MESSAGE_INVALIDE')
    expect(ecrire({ taille: 0.5 })).toBe('MESSAGE_INVALIDE')
    expect(ecrire({ taille: 2 }, new Uint8Array(3))).toBe('MESSAGE_INVALIDE')
    expect(ecrire({ debut: 1, taille: 1 })).toBe('MESSAGE_INVALIDE')
    expect(ecrire({ taille: 3 }, new Uint8Array(0))).toBe('MESSAGE_INVALIDE')
    expect(ecrire({ debut: 1, taille: 0 }, new Uint8Array(0))).toBe('MESSAGE_INVALIDE')

    expect(lire({ type: 'valider', id: 1, chemin: 'fc-repos.json', taille: 0 })).toBeNull()
    expect(lire({ type: 'valider', id: 1, chemin: 'fc-repos.json', taille: 0 }, new Uint8Array(1))).toBe('MESSAGE_INVALIDE')
    expect(lire({ type: 'valider', id: 1, chemin: 'index.json', taille: 0 })).toBe('MESSAGE_INVALIDE')
    expect(lire({ type: 'valider', id: 1, chemin: 'lieux.json', taille: 0 })).toBe('MESSAGE_INVALIDE')
    expect(lire({ type: 'valider', id: 1, chemin: 'fc-repos.json' })).toBe('MESSAGE_INVALIDE')
  })

  it('ne connaît aucune commande d’effacement : effacer est un message inconnu, quel que soit le chemin', () => {
    for (const chemin of ['sessions/a.gpx', 'itineraires/r.json', 'tracker.json', SESSION_DEPOT]) {
      expect(lire({ type: 'effacer', id: 1, chemin }), chemin).toBe('MESSAGE_INCONNU')
    }
    for (const type of ['supprimer', 'retirer', 'effacerTout']) expect(lire({ type, id: 1, chemin: 'sessions/a.gpx' }), type).toBe('MESSAGE_INCONNU')
  })

  it('ne déplace qu’un fichier de sessions/ ou d’itineraires/, vers la corbeille du téléphone sous son nom', () => {
    const deplacer = (champs: Record<string, unknown>) =>
      lire({ type: 'deplacer', id: 1, chemin: 'sessions/a.gpx', taille: 3, dateMs: 0, vers: SESSION_DEPOT, ...champs })
    expect(deplacer({})).toBeNull()
    expect(deplacer({ chemin: 'itineraires/a.gpx' })).toBeNull()
    expect(deplacer({ vers: `${DEPOT_TELEPHONE}/1795647914477-1795000000000-2/a.gpx` })).toBeNull()
    // Chemin hors de la liste des retraits.
    for (const chemin of ['reglages/a.gpx', 'journaux/a.gpx', 'a.gpx', 'sessions/x/a.gpx', 'sessions/a.gpx.tracker-new', '../a.gpx', 7]) {
      expect(deplacer({ chemin }), String(chemin)).toBe('MESSAGE_INVALIDE')
    }
    // Destination hors de la corbeille, sous un autre nom, ou dans un dossier qui n'est pas de la corbeille.
    for (const vers of [
      'Tracker-corbeille/2026-11-21/sessions/a.gpx',
      `${DEPOT_TELEPHONE}/a.gpx`,
      `${DEPOT_TELEPHONE}/1795647914477-1795000000000/b.gpx`,
      `${DEPOT_TELEPHONE}/2024-vacances/a.gpx`,
      `${DEPOT_TELEPHONE}/1795647914477-1795000000000/sessions/a.gpx`,
      `${DEPOT_TELEPHONE}/../sessions/a.gpx`,
      'sessions/a.gpx',
      '',
      null,
    ]) {
      expect(deplacer({ vers }), String(vers)).toBe('MESSAGE_INVALIDE')
    }
    for (const champs of [{ taille: -1 }, { dateMs: 1.5 }, { taille: undefined }, { dateMs: undefined }, { id: undefined }]) {
      expect(deplacer(champs), JSON.stringify(champs)).toBe('MESSAGE_INVALIDE')
    }
    expect(lire({ type: 'deplacer', id: 1, chemin: 'sessions/a.gpx', taille: 3, dateMs: 0, vers: SESSION_DEPOT }, new Uint8Array(1))).toBe('MESSAGE_INVALIDE')
  })

  it('rend le listage complet tel quel, trié, et refuse un élément mal formé', () => {
    const element = { chemin: 'tracker.json', taille: 1, dateMs: 0, ordinaire: true }
    const lu = lireMessage({
      enTete: { type: 'listeTout', id: 1, fichiers: [{ ...element, chemin: 'sessions/b.gpx.tracker-tmp' }, { ...element, chemin: 'con.txt', ordinaire: false }, element] },
      corps: new Uint8Array(0),
    })
    // Rien n'est écarté, même un nom que Windows refuse : la copie de sécurité le refuse elle-même, en le disant.
    expect(lu).toEqual({
      type: 'listeTout',
      id: 1,
      fichiers: [{ ...element, chemin: 'con.txt', ordinaire: false }, { ...element, chemin: 'sessions/b.gpx.tracker-tmp' }, element],
    })
    for (const faux of [{ ...element, ordinaire: 1 }, { ...element, chemin: '' }, { ...element, chemin: 'a'.repeat(4097) }, { ...element, taille: -1 }, { ...element, dateMs: 1.5 }, 'tracker.json']) {
      expect(lire({ type: 'listeTout', id: 1, fichiers: [faux] }), JSON.stringify(faux).slice(0, 60)).toBe('MESSAGE_INVALIDE')
    }
    expect(lire({ type: 'listeTout', id: 1 })).toBe('MESSAGE_INVALIDE')
  })

  it('rend les dossiers de la corbeille triés, sans doublon, et refuse ce qui n’est pas un nom', () => {
    expect(lireMessage({ enTete: { type: 'listeCorbeille', id: 1, dossiers: ['b', 'a', 'b'] }, corps: new Uint8Array(0) })).toEqual({ type: 'listeCorbeille', id: 1, dossiers: ['a', 'b'] })
    for (const dossiers of [undefined, 'a', [1], [''], [null]]) expect(lire({ type: 'listeCorbeille', id: 1, dossiers }), JSON.stringify(dossiers)).toBe('MESSAGE_INVALIDE')
    expect(lire({ type: 'listerCorbeille', id: 1 })).toBeNull()
    expect(lire({ type: 'listerCorbeille' })).toBe('MESSAGE_INVALIDE')
    expect(lire({ type: 'listerTout', id: 1 }, new Uint8Array(1))).toBe('MESSAGE_INVALIDE')
  })

  it('écoute sur un autre port que Gtracker', () => {
    expect(PORT_SANS_FIL).toBe(48247)
    expect(vecteurs.portSansFil).toBe(PORT_SANS_FIL)
  })

  it('lit les réponses d’écriture et l’état d’enregistrement du téléphone', () => {
    expect(lire({ type: 'ecrit', id: 1, chemin: 'sessions/a.gpx', taille: 3, dateMs: 0 })).toBeNull()
    expect(lire({ type: 'ecrit', id: 1, chemin: 'index.json', taille: 3, dateMs: 0 })).toBe('MESSAGE_INVALIDE')
    expect(lire({ type: 'ecrit', id: 1, chemin: 'sessions/a.gpx', taille: 3, dateMs: -1 })).toBe('MESSAGE_INVALIDE')
    expect(lire({ type: 'ecrit', id: 1, chemin: 'sessions/a.gpx', dateMs: 0 })).toBe('MESSAGE_INVALIDE')
    expect(lire({ type: 'fait', id: 1 })).toBeNull()
    expect(lire({ type: 'fait' })).toBe('MESSAGE_INVALIDE')
    expect(lireMessage({ enTete: { type: 'pong', id: 1, enregistre: false }, corps: new Uint8Array(0) })).toStrictEqual({ type: 'pong', id: 1, enregistre: false })
    expect(lireMessage({ enTete: { type: 'pong', id: 1 }, corps: new Uint8Array(0) })).toStrictEqual({ type: 'pong', id: 1 })
    expect(lire({ type: 'pong', id: 1, enregistre: 1 })).toBe('MESSAGE_INVALIDE')
  })

  it('ramène un code d’erreur inconnu à UNKNOWN et coupe un message trop long', () => {
    expect(lireMessage({ enTete: { type: 'erreur', id: 1, code: 'EIO', message: 'x'.repeat(600) }, corps: new Uint8Array(0) })).toEqual({
      type: 'erreur',
      id: 1,
      code: 'UNKNOWN',
      message: 'x'.repeat(500),
    })
  })
})

describe('blocsDeLecture', () => {
  it('découpe un fichier en blocs de 1 Mio, le dernier plus court', () => {
    expect([...blocsDeLecture(0)]).toEqual([])
    expect([...blocsDeLecture(TAILLE_BLOC)]).toEqual([{ debut: 0, longueur: TAILLE_BLOC }])
    // Produits un à un : une taille démesurée ne construit rien d'avance.
    expect(blocsDeLecture(9e15).next().value).toEqual({ debut: 0, longueur: TAILLE_BLOC })
    expect([...blocsDeLecture(2 * TAILLE_BLOC + 5)]).toEqual([
      { debut: 0, longueur: TAILLE_BLOC },
      { debut: TAILLE_BLOC, longueur: TAILLE_BLOC },
      { debut: 2 * TAILLE_BLOC, longueur: 5 },
    ])
  })
})

describe('blocsDEcriture', () => {
  it('écrit un fichier vide par un seul bloc vide, les autres comme on les lit', () => {
    expect([...blocsDEcriture(0)]).toEqual([{ debut: 0, longueur: 0 }])
    expect([...blocsDEcriture(5)]).toEqual([{ debut: 0, longueur: 5 }])
    expect([...blocsDEcriture(TAILLE_BLOC + 1)]).toEqual([...blocsDeLecture(TAILLE_BLOC + 1)])
    expect(blocsDEcriture(9e15).next().value).toEqual({ debut: 0, longueur: TAILLE_BLOC })
  })

  it('donne des commandes ecrire que le téléphone accepte, chacune où finit la précédente', () => {
    for (const taille of [0, 1, TAILLE_BLOC, 2 * TAILLE_BLOC + 7]) {
      let attendu = 0
      for (const { debut, longueur } of blocsDEcriture(taille)) {
        expect(debut).toBe(attendu)
        const trame = new DecodeurTrames(LIMITES).pousser(encoderMessage({ type: 'ecrire', id: 1, chemin: 'sessions/a.gpx', debut, taille, octets: new Uint8Array(longueur) }))
        expect(() => lireMessage(trame[0])).not.toThrow()
        attendu = debut + longueur
      }
      expect(attendu).toBe(taille)
    }
  })
})

describe('jeux d’essai partagés avec le téléphone', () => {
  it('décode et réencode chaque trame', () => {
    expect(vecteurs.trames.length).toBeGreaterThan(0)
    for (const v of vecteurs.trames) {
      const trames = new DecodeurTrames(LIMITES).pousser(deHex(v.octetsHex))
      expect(trames, v.nom).toHaveLength(1)
      expect(trames[0].enTete, v.nom).toEqual(v.enTete)
      expect(hex(trames[0].corps), v.nom).toBe(v.corpsHex)
      expect(() => lireMessage(trames[0]), v.nom).not.toThrow()
      expect(hex(encoderTrame(v.enTete, deHex(v.corpsHex))), v.nom).toBe(v.octetsHex)
    }
  })

  it('refuse chaque trame invalide avec l’erreur attendue', () => {
    expect(vecteurs.tramesInvalides.map((v) => v.nom)).toContain("en-tête précédé d'une marque d'ordre d'octets")
    for (const v of vecteurs.tramesInvalides) {
      const d = new DecodeurTrames(LIMITES)
      expect(raison(() => (d.pousser(deHex(v.octetsHex)), d.fin())), v.nom).toBe(v.erreur)
    }
  })

  it('couvre chaque message de la liaison, dans le sens où il circule', () => {
    const types = new Set(vecteurs.trames.map((v) => `${v.emetteur}:${v.enTete.type}`))
    expect([...types].some((t) => t.endsWith(':effacer'))).toBe(false)
    for (const attendu of ['pc:ecrire', 'pc:valider', 'pc:deplacer', 'pc:listerTout', 'pc:listerCorbeille', 'telephone:listeTout', 'telephone:listeCorbeille', 'pc:bienvenue', 'telephone:erreur', 'pc:lire', 'pc:ping', 'telephone:ecrit', 'telephone:fait', 'telephone:pong', 'telephone:liste', 'telephone:bonjour', 'telephone:appairer', 'pc:defi', 'telephone:preuve', 'pc:appaire', 'pc:refus']) {
      expect(types, attendu).toContain(attendu)
    }
    // L'appairage par l'échange SPAKE2 : les parts des deux côtés, de 65 octets.
    const appairer = vecteurs.trames.find((v) => v.enTete.type === 'appairer' && v.enTete.partA !== undefined)
    const defi = vecteurs.trames.find((v) => v.enTete.type === 'defi')
    expect(appairer && lireMessage({ enTete: appairer.enTete, corps: new Uint8Array(0) })).toMatchObject({ partA: expect.stringMatching(/^04[0-9a-f]{128}$/) })
    expect(defi && lireMessage({ enTete: defi.enTete, corps: new Uint8Array(0) })).toMatchObject({ partB: expect.stringMatching(/^04[0-9a-f]{128}$/) })
    expect(vecteurs.trames.some((v) => v.enTete.type === 'ecrire' && v.corpsHex !== '')).toBe(true)
    expect(vecteurs.trames.some((v) => Array.isArray(v.enTete.capacites) && v.enTete.capacites.includes(CAPACITE_ECRITURE))).toBe(true)
  })

  it('lit chaque trame d’un message invalide, puis refuse son message avec l’erreur attendue', () => {
    expect(vecteurs.messagesInvalides.length).toBeGreaterThan(0)
    for (const v of vecteurs.messagesInvalides) {
      const d = new DecodeurTrames(LIMITES)
      const trames = d.pousser(deHex(v.octetsHex))
      d.fin()
      expect(trames, v.nom).toHaveLength(1)
      expect(raison(() => lireMessage(trames[0])), v.nom).toBe(v.erreur)
    }
  })

  it('suit les règles de chemin de la coquille : liste, lecture, écriture, retrait et corbeille', () => {
    const suit = (regle: Regle, admet: (c: string) => boolean) => {
      expect(regle.admis.length * regle.refuses.length).toBeGreaterThan(0)
      for (const c of regle.admis) expect(admet(c), JSON.stringify(c.slice(0, 80))).toBe(true)
      for (const c of regle.refuses) expect(admet(c), JSON.stringify(c.slice(0, 80))).toBe(false)
    }
    suit(vecteurs.cheminsListe, cheminAdmis)
    suit(vecteurs.cheminsLecture, cheminLisible)
    suit(vecteurs.cheminsEcriture, cheminEcrivable)
    suit(vecteurs.cheminsRetrait, cheminRetirable)
    const longueurs = (l: string[]) => Math.max(...l.map((c) => c.length))
    expect(longueurs(vecteurs.cheminsEcriture.admis)).toBe(512)
    expect(longueurs(vecteurs.cheminsEcriture.refuses)).toBe(513)
    expect(longueurs(vecteurs.cheminsLecture.admis)).toBe(4096)
    expect(longueurs(vecteurs.cheminsLecture.refuses)).toBe(4097)
    const { depot, admises, refusees } = vecteurs.destinationsCorbeille
    expect(depot).toBe(DEPOT_TELEPHONE)
    expect(admises.length * refusees.length).toBeGreaterThan(0)
    for (const d of admises) expect(destinationCorbeilleAdmise(d.chemin, d.vers), d.vers).toBe(true)
    for (const d of refusees) expect(destinationCorbeilleAdmise(d.chemin, d.vers), d.vers).toBe(false)
  })
})

describe('générateur des jeux d’essai (bureau/essais/vecteurs.ts)', () => {
  it('le fichier commité est celui du générateur : un changement du protocole demande de le régénérer', () => {
    // Pour régénérer : TRACKER_ECRIRE_VECTEURS=1, test « réécrit » ci-dessous (commande en tête du générateur).
    expect(readFileSync(FICHIER_VECTEURS, 'utf8')).toBe(texteVecteurs())
    expect(JSON.parse(texteVecteurs())).toEqual(genererVecteurs())
  })

  it.skipIf(process.env.TRACKER_ECRIRE_VECTEURS !== '1')('réécrit bureau/sansFil.vecteurs.json', () => {
    writeFileSync(FICHIER_VECTEURS, texteVecteurs(), 'utf8')
  })
})
