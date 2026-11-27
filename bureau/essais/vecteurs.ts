// Générateur de `bureau/sansFil.vecteurs.json`, les jeux d'essai de la liaison sans fil relus tels quels par les
// tests du PC (`trames.test.ts`, `spake2.test.ts`, `sonde.test.ts`, `appairage.test.ts`) et par ceux du téléphone.
//
// Relancer après tout changement du protocole (`trames.ts`, `spake2.ts`, `sonde.ts`, `appairage.ts`, listes fermées
// de `telephone.ts`), depuis la racine du dépôt :
//   cmd         set TRACKER_ECRIRE_VECTEURS=1&& npx vitest run bureau/trames.test.ts -t "réécrit"
//   Git Bash    TRACKER_ECRIRE_VECTEURS=1 npx vitest run bureau/trames.test.ts -t "réécrit"
// puis relire le diff du fichier. Sans la variable, le test « le fichier commité est celui du générateur » échoue tant
// que le fichier n'est pas régénéré. Ce module n'est lancé que par vitest : la coquille est en CommonJS (`"type":
// "commonjs"` de `bureau/package.json`), si bien que Node ne sait pas l'exécuter seul, et `bureau/tsconfig.json` ne
// compile que `bureau/*.ts` : rien d'ici n'est emballé.
//
// Tout est fixe (scalaires x et y, nonces, jetons, dates) : le fichier ne change que si le protocole change. Le
// générateur ne prouve pas la justesse des calculs, il ne fait que les recopier : `spake2.ts` est prouvé par les
// vecteurs de la RFC 9382, annexe B (`spake2.test.ts`), et c'est le code du téléphone, qui relit ce fichier, qui fait
// foi de l'autre côté. Les listes de chemins sont écrites à la main ici, puis comparées aux règles de `telephone.ts` :
// un écart arrête la génération.

import { hacherJeton } from '../appairage'
import { commencer, conclure, identitesAppairage, scalaireDuCode, AAD_APPAIRAGE, ID_TELEPHONE } from '../spake2'
import { PORT_SONDE, encoderQuestion, encoderReponse, identifiantDeSonde } from '../sonde'
import { cheminAdmis, cheminEcrivable, cheminRetirable, destinationCorbeilleAdmise, DEPOT_TELEPHONE, LONGUEUR_MAX_BRUT } from '../telephone'
import type { EnTete, Message, RaisonTrame } from '../trames'
import { DecodeurTrames, ErreurTrame, LIMITES, PORT_SANS_FIL, cheminLisible, encoderMessage, encoderTrame, lireMessage } from '../trames'

type Emetteur = 'pc' | 'telephone'

const hex = (o: Uint8Array): string => Buffer.from(o).toString('hex')
const deHex = (t: string): Uint8Array => Uint8Array.from(Buffer.from(t, 'hex'))
const suite = (debut: number, longueur: number): Uint8Array => Uint8Array.from({ length: longueur }, (_, i) => (debut + i) & 0xff)
const grand = (t: string): bigint => BigInt(`0x${t}`)

// ---------- échange SPAKE2 ----------

const CAS_SPAKE2 = [
  { nom: 'code 042917', code: '042917', empreinteHex: '794b52b389eb92d0301942216091a202ca1589ec7278e58715ab7f73a7226859', x: suite(0x01, 32), y: suite(0x21, 32) },
  { nom: 'code 999999', code: '999999', empreinteHex: hex(suite(0xa0, 32)), x: suite(0x41, 32), y: suite(0x61, 32) },
]

function casSpake2() {
  return CAS_SPAKE2.map((c) => {
    const w = scalaireDuCode(c.code)
    const ids = identitesAppairage(deHex(c.empreinteHex))
    const a = commencer('A', w, grand(hex(c.x)), ids)
    const b = commencer('B', w, grand(hex(c.y)), ids)
    const clesA = conclure(a, b.part)
    const clesB = conclure(b, a.part)
    if (hex(clesA.k) !== hex(clesB.k)) throw new Error(`${c.nom} : les deux côtés n'ont pas le même K`)
    return {
      nom: c.nom,
      code: c.code,
      empreinteHex: c.empreinteHex,
      idA: ID_TELEPHONE,
      aad: AAD_APPAIRAGE,
      wHex: w.toString(16).padStart(64, '0'),
      xHex: hex(c.x),
      yHex: hex(c.y),
      partAHex: hex(a.part),
      partBHex: hex(b.part),
      kHex: hex(clesA.k),
      confirmationAHex: hex(clesA.confirmationEnvoyee),
      confirmationBHex: hex(clesB.confirmationEnvoyee),
    }
  })
}

// ---------- trames valides ----------

const NONCE_TELEPHONE = hex(suite(0x00, 32))
const NONCE_PC = hex(suite(0x20, 32))
const JETON_BONJOUR = hex(suite(0xa0, 32))
const JETON_APPAIRE = hex(suite(0xc0, 32))
const IDENTIFIANT_PC = hex(suite(0x10, 16))
const SESSION = 'sessions/2026-11-21 wing.gpx'
const ITINERAIRE = 'itineraires/tour du lac.json'
/** Sous-dossiers de la corbeille du téléphone, au format du programme Windows (`trashDirName`). */
const DEPOT_SESSION = '1795647914477-1795000000000'
const DEPOT_ITINERAIRE = '1795647914477-tour du lac'

function tramesValides(spake2: ReturnType<typeof casSpake2>) {
  const cas = spake2[0]
  const texte = (t: string) => Uint8Array.from(Buffer.from(t, 'utf8'))
  const messages: [string, Emetteur, Message][] = [
    ['ping', 'pc', { type: 'ping', id: 1 }],
    ['lire, deuxième bloc', 'pc', { type: 'lire', id: 7, chemin: 'sessions/2026-11-20.gpx', debut: 1_048_576, longueur: 1_048_576 }],
    ['bloc de 5 octets', 'telephone', { type: 'bloc', id: 7, debut: 0, octets: texte('hello') }],
    ['liste, chemin accentué', 'telephone', { type: 'liste', id: 2, fichiers: [{ chemin: 'sessions/été.gpx', taille: 1234, dateMs: 1_790_000_000_000 }] }],
    ['refus', 'pc', { type: 'refus', raison: 'code' }],
    ['bonjour avec une capacité inconnue, ignorée', 'telephone', { type: 'bonjour', version: 1, nom: 'Pixel 8', jeton: JETON_BONJOUR, capacites: ['ecriture', 'futur' as 'ecriture'] }],
    ['bonjour sans capacité', 'telephone', { type: 'bonjour', version: 1, nom: 'Pixel 8', jeton: JETON_BONJOUR }],
    ['bienvenue', 'pc', { type: 'bienvenue', identifiantPc: IDENTIFIANT_PC, nomPc: 'BUREAU' }],
    ["lire, fichier d'itinéraire", 'pc', { type: 'lire', id: 8, chemin: ITINERAIRE, debut: 0, longueur: 4096 }],
    ["lire, journal d'enregistrement", 'pc', { type: 'lire', id: 9, chemin: 'journaux/2026-11-21 09-30.txt', debut: 0, longueur: 300 }],
    ['lire, fichier du listage complet, dans la corbeille', 'pc', { type: 'lire', id: 20, chemin: `${DEPOT_TELEPHONE}/${DEPOT_SESSION}/2026-11-21 wing.gpx`, debut: 0, longueur: 11 }],
    ['lire, provisoire du listage complet', 'pc', { type: 'lire', id: 21, chemin: 'sessions/2026-11-22.gpx.tracker-new', debut: 0, longueur: 7 }],
    [
      'liste des cinq dossiers',
      'telephone',
      {
        type: 'liste',
        id: 3,
        fichiers: [
          { chemin: 'itineraires/tour du lac.json', taille: 2048, dateMs: 1_795_000_001_000 },
          { chemin: 'journaux/2026-11-21 09-30.txt', taille: 300, dateMs: 1_795_000_005_000 },
          { chemin: 'reglages/pixel-8.json', taille: 512, dateMs: 1_795_000_002_000 },
          { chemin: SESSION, taille: 11, dateMs: 1_795_000_003_000 },
          { chemin: 'tracker.json', taille: 120, dateMs: 1_795_000_000_000 },
        ],
      },
    ],
    ['listerTout', 'pc', { type: 'listerTout', id: 22 }],
    [
      'listeTout, dossier entier',
      'telephone',
      {
        type: 'listeTout',
        id: 22,
        fichiers: [
          { chemin: `${DEPOT_TELEPHONE}/${DEPOT_SESSION}/2026-11-21 wing.gpx`, taille: 11, dateMs: 1_795_000_003_000, ordinaire: true },
          { chemin: `${DEPOT_TELEPHONE}/corbeille.json`, taille: 90, dateMs: 1_795_647_914_000, ordinaire: true },
          { chemin: 'photos/lien', taille: 0, dateMs: 1_795_000_000_000, ordinaire: false },
          { chemin: 'sessions/2026-11-22.gpx.tracker-new', taille: 7, dateMs: 1_795_000_006_000, ordinaire: true },
          { chemin: 'sessions/vieux/a.gpx', taille: 5, dateMs: 1_790_000_000_000, ordinaire: true },
          { chemin: 'tracker.json', taille: 120, dateMs: 1_795_000_000_000, ordinaire: true },
        ],
      },
    ],
    ['ecrire, premier bloc', 'pc', { type: 'ecrire', id: 10, chemin: SESSION, debut: 0, taille: 11, octets: texte('<gpx>') }],
    ['ecrire, dernier bloc', 'pc', { type: 'ecrire', id: 11, chemin: SESSION, debut: 5, taille: 11, octets: texte('</gpx>') }],
    ['ecrire, fichier vide', 'pc', { type: 'ecrire', id: 12, chemin: 'reglages/pixel-8.json', debut: 0, taille: 0, octets: new Uint8Array(0) }],
    ['ecrire, fichier de la racine', 'pc', { type: 'ecrire', id: 16, chemin: 'tracker.json', debut: 0, taille: 2, octets: texte('{}') }],
    ['valider', 'pc', { type: 'valider', id: 13, chemin: SESSION, taille: 11 }],
    ['deplacer, session vers la corbeille', 'pc', { type: 'deplacer', id: 14, chemin: SESSION, taille: 11, dateMs: 1_795_000_003_000, vers: `${DEPOT_TELEPHONE}/${DEPOT_SESSION}/2026-11-21 wing.gpx` }],
    ['deplacer, itinéraire vers la corbeille', 'pc', { type: 'deplacer', id: 17, chemin: ITINERAIRE, taille: 2048, dateMs: 1_795_000_001_000, vers: `${DEPOT_TELEPHONE}/${DEPOT_ITINERAIRE}/tour du lac.json` }],
    ['listerCorbeille', 'pc', { type: 'listerCorbeille', id: 18 }],
    ['listeCorbeille', 'telephone', { type: 'listeCorbeille', id: 18, dossiers: [DEPOT_SESSION, DEPOT_ITINERAIRE] }],
    ['ecrit', 'telephone', { type: 'ecrit', id: 13, chemin: SESSION, taille: 11, dateMs: 1_795_000_004_000 }],
    ['fait', 'telephone', { type: 'fait', id: 10 }],
    ['erreur, téléphone qui enregistre', 'telephone', { type: 'erreur', id: 14, code: 'PERMISSION', message: "Le téléphone enregistre une session : rien n'y est écrit pendant ce temps." }],
    ['pong, téléphone qui enregistre', 'telephone', { type: 'pong', id: 5, enregistre: true }],
    ['pong, téléphone libre', 'telephone', { type: 'pong', id: 6, enregistre: false }],
    [
      'appairer, échange SPAKE2',
      'telephone',
      { type: 'appairer', version: 1, nom: 'Pixel 8', nonceTelephone: NONCE_TELEPHONE, partA: cas.partAHex, capacites: ['ecriture', 'spake2'] },
    ],
    ['defi, échange SPAKE2', 'pc', { type: 'defi', noncePc: NONCE_PC, partB: cas.partBHex }],
    ['preuve, confirmation du téléphone', 'telephone', { type: 'preuve', preuve: cas.confirmationAHex }],
    ['appaire, confirmation du PC', 'pc', { type: 'appaire', preuve: cas.confirmationBHex, jeton: JETON_APPAIRE, identifiantPc: IDENTIFIANT_PC, nomPc: 'BUREAU' }],
  ]
  return messages.map(([nom, emetteur, message]) => {
    const octets = encoderMessage(message)
    const trames = new DecodeurTrames(LIMITES).pousser(octets)
    if (trames.length !== 1) throw new Error(`${nom} : une trame attendue`)
    lireMessage(trames[0])
    return { nom, emetteur, enTete: trames[0].enTete, corpsHex: hex(trames[0].corps), octetsHex: hex(octets) }
  })
}

// ---------- messages invalides ----------

function messagesInvalides() {
  const un = Uint8Array.of(0x41)
  const vide = new Uint8Array(0)
  const depot = (dossier: string, nom: string) => `${DEPOT_TELEPHONE}/${dossier}/${nom}`
  const deplacer = (champs: Record<string, unknown>): EnTete => ({
    type: 'deplacer',
    id: 1,
    chemin: 'sessions/a.gpx',
    taille: 1,
    dateMs: 0,
    vers: depot(DEPOT_SESSION, 'a.gpx'),
    ...champs,
  })
  const ecrire = (champs: Record<string, unknown>): EnTete => ({ type: 'ecrire', id: 1, chemin: 'sessions/a.gpx', debut: 0, taille: 1, ...champs })
  const element = { chemin: 'tracker.json', taille: 1, dateMs: 0, ordinaire: true }
  const cas: [string, Emetteur, EnTete, Uint8Array, RaisonTrame][] = [
    ['ecrire, chemin hors des dossiers écrivables', 'pc', ecrire({ chemin: 'autre/a.gpx' }), un, 'MESSAGE_INVALIDE'],
    ['ecrire, fichier de la racine non écrivable', 'pc', ecrire({ chemin: 'index.json' }), un, 'MESSAGE_INVALIDE'],
    ["ecrire, lieux.json n'est pas écrivable", 'pc', ecrire({ chemin: 'lieux.json' }), un, 'MESSAGE_INVALIDE'],
    ["ecrire, journal d'enregistrement", 'pc', ecrire({ chemin: 'journaux/a.txt' }), un, 'MESSAGE_INVALIDE'],
    ['ecrire, dans la corbeille', 'pc', ecrire({ chemin: depot(DEPOT_SESSION, 'a.gpx') }), un, 'MESSAGE_INVALIDE'],
    ['ecrire, chemin qui remonte', 'pc', ecrire({ chemin: 'sessions/../tracker.json' }), un, 'MESSAGE_INVALIDE'],
    ['ecrire, nom provisoire', 'pc', ecrire({ chemin: 'sessions/a.gpx.tracker-new' }), un, 'MESSAGE_INVALIDE'],
    ['ecrire sans chemin', 'pc', { type: 'ecrire', id: 1, debut: 0, taille: 1 }, un, 'MESSAGE_INVALIDE'],
    ['ecrire, début négatif', 'pc', ecrire({ debut: -1 }), un, 'MESSAGE_INVALIDE'],
    ["ecrire, taille qui n'est pas un entier", 'pc', ecrire({ taille: 1.5 }), un, 'MESSAGE_INVALIDE'],
    ['ecrire, bloc qui déborde la taille annoncée', 'pc', ecrire({ taille: 3 }), Uint8Array.from([0x41, 0x42, 0x43, 0x44]), 'MESSAGE_INVALIDE'],
    ['ecrire, dernier bloc qui déborde', 'pc', ecrire({ debut: 2, taille: 3 }), Uint8Array.from([0x41, 0x42]), 'MESSAGE_INVALIDE'],
    ['ecrire, corps vide pour un fichier non vide', 'pc', ecrire({ taille: 5 }), vide, 'MESSAGE_INVALIDE'],
    ['valider avec un corps', 'pc', { type: 'valider', id: 1, chemin: 'sessions/a.gpx', taille: 1 }, un, 'MESSAGE_INVALIDE'],
    ['valider, taille négative', 'pc', { type: 'valider', id: 1, chemin: 'sessions/a.gpx', taille: -1 }, vide, 'MESSAGE_INVALIDE'],
    ['valider, chemin hors liste', 'pc', { type: 'valider', id: 1, chemin: 'lieux.json.bak', taille: 1 }, vide, 'MESSAGE_INVALIDE'],
    ["effacer n'existe pas dans ce protocole", 'pc', { type: 'effacer', id: 1, chemin: 'sessions/a.gpx' }, vide, 'MESSAGE_INCONNU'],
    ['lire, chemin qui remonte', 'pc', { type: 'lire', id: 1, chemin: 'sessions/../a.gpx', debut: 0, longueur: 10 }, vide, 'MESSAGE_INVALIDE'],
    ['lire, chemin absolu', 'pc', { type: 'lire', id: 1, chemin: '/sdcard/a.gpx', debut: 0, longueur: 10 }, vide, 'MESSAGE_INVALIDE'],
    ['lire, antislash', 'pc', { type: 'lire', id: 1, chemin: 'sessions\\a.gpx', debut: 0, longueur: 10 }, vide, 'MESSAGE_INVALIDE'],
    ['lire, longueur nulle', 'pc', { type: 'lire', id: 1, chemin: 'sessions/a.gpx', debut: 0, longueur: 0 }, vide, 'MESSAGE_INVALIDE'],
    ['ping avec un corps', 'pc', { type: 'ping', id: 1 }, un, 'MESSAGE_INVALIDE'],
    ['commande inconnue', 'pc', { type: 'renommer', id: 1, chemin: 'sessions/a.gpx' }, vide, 'MESSAGE_INCONNU'],
    ['listerTout sans id', 'pc', { type: 'listerTout' }, vide, 'MESSAGE_INVALIDE'],
    ['listerCorbeille avec un corps', 'pc', { type: 'listerCorbeille', id: 1 }, un, 'MESSAGE_INVALIDE'],
    ['deplacer, depuis reglages/', 'pc', deplacer({ chemin: 'reglages/pixel-8.json', vers: depot(DEPOT_SESSION, 'pixel-8.json') }), vide, 'MESSAGE_INVALIDE'],
    ['deplacer, depuis un sous-dossier', 'pc', deplacer({ chemin: 'sessions/vieux/a.gpx' }), vide, 'MESSAGE_INVALIDE'],
    ['deplacer, un provisoire', 'pc', deplacer({ chemin: 'sessions/a.gpx.tracker-new', vers: depot(DEPOT_SESSION, 'a.gpx.tracker-new') }), vide, 'MESSAGE_INVALIDE'],
    ["deplacer, vers l'ancienne corbeille du câble", 'pc', deplacer({ vers: 'Tracker-corbeille/2026-11-21/sessions/a.gpx' }), vide, 'MESSAGE_INVALIDE'],
    ['deplacer, vers un autre nom', 'pc', deplacer({ vers: depot(DEPOT_SESSION, 'b.gpx') }), vide, 'MESSAGE_INVALIDE'],
    ['deplacer, vers un sous-dossier mal nommé', 'pc', deplacer({ vers: depot('2024-vacances', 'a.gpx') }), vide, 'MESSAGE_INVALIDE'],
    ['deplacer, vers la racine de la corbeille', 'pc', deplacer({ vers: `${DEPOT_TELEPHONE}/a.gpx` }), vide, 'MESSAGE_INVALIDE'],
    ['deplacer, vers un dossier trop profond', 'pc', deplacer({ vers: `${DEPOT_TELEPHONE}/${DEPOT_SESSION}/sessions/a.gpx` }), vide, 'MESSAGE_INVALIDE'],
    ['deplacer sans vers', 'pc', { type: 'deplacer', id: 1, chemin: 'sessions/a.gpx', taille: 1, dateMs: 0 }, vide, 'MESSAGE_INVALIDE'],
    ['deplacer sans date', 'pc', { type: 'deplacer', id: 1, chemin: 'sessions/a.gpx', taille: 1, vers: depot(DEPOT_SESSION, 'a.gpx') }, vide, 'MESSAGE_INVALIDE'],
    ['deplacer, taille négative', 'pc', deplacer({ taille: -1 }), vide, 'MESSAGE_INVALIDE'],
    ['bonjour, capacites qui n’est pas un tableau', 'telephone', { type: 'bonjour', version: 1, nom: 'Pixel 8', jeton: JETON_BONJOUR, capacites: 'ecriture' }, vide, 'MESSAGE_INVALIDE'],
    ['appairer, capacité qui n’est pas un texte', 'telephone', { type: 'appairer', version: 1, nom: 'Pixel 8', nonceTelephone: NONCE_TELEPHONE, capacites: ['ecriture', 1] }, vide, 'MESSAGE_INVALIDE'],
    ['listeTout, élément sans ordinaire', 'telephone', { type: 'listeTout', id: 1, fichiers: [{ chemin: 'tracker.json', taille: 1, dateMs: 0 }] }, vide, 'MESSAGE_INVALIDE'],
    ['listeTout, chemin vide', 'telephone', { type: 'listeTout', id: 1, fichiers: [{ ...element, chemin: '' }] }, vide, 'MESSAGE_INVALIDE'],
    ['listeTout, taille négative', 'telephone', { type: 'listeTout', id: 1, fichiers: [{ ...element, taille: -1 }] }, vide, 'MESSAGE_INVALIDE'],
    ["listeTout, fichiers qui n'est pas un tableau", 'telephone', { type: 'listeTout', id: 1, fichiers: {} }, vide, 'MESSAGE_INVALIDE'],
    ["listeCorbeille, dossier qui n'est pas un texte", 'telephone', { type: 'listeCorbeille', id: 1, dossiers: [DEPOT_SESSION, 7] }, vide, 'MESSAGE_INVALIDE'],
    ['listeCorbeille sans dossiers', 'telephone', { type: 'listeCorbeille', id: 1 }, vide, 'MESSAGE_INVALIDE'],
    ['ecrit, chemin hors liste', 'telephone', { type: 'ecrit', id: 1, chemin: 'index.json', taille: 1, dateMs: 0 }, vide, 'MESSAGE_INVALIDE'],
    ['ecrit sans date', 'telephone', { type: 'ecrit', id: 1, chemin: 'sessions/a.gpx', taille: 1 }, vide, 'MESSAGE_INVALIDE'],
    ['fait avec un corps', 'telephone', { type: 'fait', id: 1 }, un, 'MESSAGE_INVALIDE'],
    ["pong, enregistre qui n'est pas un booléen", 'telephone', { type: 'pong', id: 1, enregistre: 'oui' }, vide, 'MESSAGE_INVALIDE'],
  ]
  return cas.map(([nom, emetteur, enTete, corps, erreur]) => {
    const octets = encoderTrame(enTete, corps)
    const trames = new DecodeurTrames(LIMITES).pousser(octets)
    let obtenu: RaisonTrame | null = null
    try {
      lireMessage(trames[0])
    } catch (e) {
      if (!(e instanceof ErreurTrame)) throw e
      obtenu = e.raison
    }
    if (trames.length !== 1 || obtenu !== erreur) throw new Error(`${nom} : ${erreur} attendu, ${obtenu ?? 'rien'} obtenu`)
    return { nom, emetteur, octetsHex: hex(octets), erreur }
  })
}

// ---------- trames invalides ----------

function tramesInvalides() {
  const prefixe = (n: number, m: number) => {
    const p = Buffer.alloc(8)
    p.writeUInt32BE(n, 0)
    p.writeUInt32BE(m, 4)
    return p
  }
  const avecPrefixe = (enTete: Buffer) => Buffer.concat([prefixe(enTete.length, 0), enTete])
  const ping = Buffer.from(JSON.stringify({ type: 'ping', id: 1 }), 'utf8')
  const cas: [string, Uint8Array, RaisonTrame][] = [
    ['en-tête de longueur nulle', prefixe(0, 0), 'EN_TETE_VIDE'],
    ['en-tête de 8 Mio + 1', prefixe(LIMITES.enTete + 1, 0), 'EN_TETE_TROP_LONG'],
    ['corps de 1 Mio + 1', prefixe(15, LIMITES.corps + 1), 'CORPS_TROP_LONG'],
    ['requête HTTP', Buffer.from('GET / HTTP/1.1\r\n', 'ascii'), 'EN_TETE_TROP_LONG'],
    ['ping amputé de son dernier octet', encoderTrame({ type: 'ping', id: 1 }).subarray(0, 8 + ping.length - 1), 'TRONQUEE'],
    ['en-tête qui est un tableau', avecPrefixe(Buffer.from('[1]', 'ascii')), 'EN_TETE_ILLISIBLE'],
    ["en-tête qui n'est pas de l'UTF-8", avecPrefixe(Buffer.from([0xff, 0x22, 0x22, 0x22])), 'EN_TETE_ILLISIBLE'],
    ['en-tête sans type', avecPrefixe(Buffer.from('{"id":1}', 'ascii')), 'EN_TETE_ILLISIBLE'],
    ["en-tête précédé d'une marque d'ordre d'octets", avecPrefixe(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), ping])), 'EN_TETE_ILLISIBLE'],
  ]
  return cas.map(([nom, octets, erreur]) => {
    let obtenu: RaisonTrame | null = null
    try {
      const d = new DecodeurTrames(LIMITES)
      d.pousser(octets)
      d.fin()
    } catch (e) {
      if (!(e instanceof ErreurTrame)) throw e
      obtenu = e.raison
    }
    if (obtenu !== erreur) throw new Error(`${nom} : ${erreur} attendu, ${obtenu ?? 'rien'} obtenu`)
    return { nom, octetsHex: hex(octets), erreur }
  })
}

// ---------- règles de chemin, écrites à la main puis comparées à telephone.ts ----------

function regle(nom: string, admet: (c: string) => boolean, admis: string[], refuses: string[]) {
  for (const c of admis) if (!admet(c)) throw new Error(`${nom} : ${JSON.stringify(c.slice(0, 80))} devrait être admis`)
  for (const c of refuses) if (admet(c)) throw new Error(`${nom} : ${JSON.stringify(c.slice(0, 80))} devrait être refusé`)
  return { admis, refuses }
}

const LISTES_ADMIS = [
  'index.json',
  'tracker.json',
  'photo.jpg',
  'sessions',
  'sessions/2026-11-21 wing.gpx',
  'sessions/été.gpx',
  'itineraires/tour du lac.json',
  'reglages/pixel-8.json',
  'journaux/2026-11-21 09-30.txt',
]

const TOUJOURS_REFUSES = [
  '',
  '/index.json',
  'sessions/',
  '../a.gpx',
  'sessions/../a.gpx',
  'sessions/.',
  'sessions\\a.gpx',
  'C:/a.gpx',
  'sessions/a.',
  'sessions/a ',
  'sessions/con.gpx',
  'sessions/a\u0001.gpx',
  'sessions/a|b.gpx',
]

function regles() {
  const profond = (longueur: number) => `${'a/'.repeat(Math.floor((longueur - 2) / 2))}aa`.padEnd(longueur, 'a')
  const long = (longueur: number) => `sessions/${'a'.repeat(longueur - 'sessions/'.length)}`
  if (profond(LONGUEUR_MAX_BRUT).length !== LONGUEUR_MAX_BRUT || long(512).length !== 512) throw new Error('longueurs des chemins d’essai')
  const corbeille = `${DEPOT_TELEPHONE}/${DEPOT_SESSION}/2026-11-21 wing.gpx`
  return {
    cheminsListe: regle('cheminAdmis', cheminAdmis, LISTES_ADMIS, [
      ...TOUJOURS_REFUSES,
      'sessions/a/b.gpx',
      'autre/a.gpx',
      'Sessions/a.gpx',
      'a.gpx.tracker-tmp',
      'itineraires/r.json.TRACKER-NEW',
      `${DEPOT_TELEPHONE}/corbeille.json`,
      corbeille,
    ]),
    cheminsLecture: regle(
      'cheminLisible',
      cheminLisible,
      [
        ...LISTES_ADMIS,
        'sessions/a/b.gpx',
        'autre/a.gpx',
        'Sessions/a.gpx',
        'a.gpx.tracker-tmp',
        'itineraires/r.json.TRACKER-NEW',
        `${DEPOT_TELEPHONE}/corbeille.json`,
        corbeille,
        profond(LONGUEUR_MAX_BRUT),
      ],
      [...TOUJOURS_REFUSES, 'sessions//a.gpx', profond(LONGUEUR_MAX_BRUT + 1)],
    ),
    cheminsEcriture: regle(
      'cheminEcrivable',
      cheminEcrivable,
      ['tracker.json', 'fc-repos.json', SESSION, 'sessions/été.gpx', ITINERAIRE, 'reglages/pixel-8.json', long(512)],
      [
        '',
        'index.json',
        'photo.jpg',
        'lieux.json',
        'TRACKER.JSON',
        'tracker.json.tracker-tmp',
        'sessions',
        'sessions/',
        '/tracker.json',
        'sessions/a/b.gpx',
        'autre/a.gpx',
        'Sessions/a.gpx',
        'journaux/2026-11-21 09-30.txt',
        corbeille,
        '../tracker.json',
        'sessions/../tracker.json',
        'sessions/..',
        'sessions/.',
        'sessions\\a.gpx',
        'sessions/a.gpx.tracker-tmp',
        'itineraires/r.json.TRACKER-NEW',
        'sessions/a.',
        'sessions/a ',
        'sessions/con.gpx',
        'reglages/LPT1',
        'sessions/a\u0001.gpx',
        'sessions/a\u007f.gpx',
        'sessions/a:b.gpx',
        'sessions/a|b.gpx',
        long(513),
      ],
    ),
    cheminsRetrait: regle(
      'cheminRetirable',
      cheminRetirable,
      [SESSION, 'sessions/été.gpx', ITINERAIRE],
      ['', 'sessions', 'tracker.json', 'reglages/pixel-8.json', 'journaux/2026-11-21 09-30.txt', 'sessions/vieux/a.gpx', 'sessions/a.gpx.tracker-new', corbeille],
    ),
    destinationsCorbeille: destinations(),
  }
}

function destinations() {
  const depot = (dossier: string, nom: string) => `${DEPOT_TELEPHONE}/${dossier}/${nom}`
  const admises = [
    { chemin: SESSION, vers: depot(DEPOT_SESSION, '2026-11-21 wing.gpx') },
    { chemin: SESSION, vers: depot(`${DEPOT_SESSION}-2`, '2026-11-21 wing.gpx') },
    { chemin: ITINERAIRE, vers: depot(DEPOT_ITINERAIRE, 'tour du lac.json') },
    { chemin: 'sessions/été.gpx', vers: depot('1795647914477-Tour_ du lac_', 'été.gpx') },
  ]
  const refusees = [
    { chemin: SESSION, vers: 'Tracker-corbeille/2026-11-21/sessions/2026-11-21 wing.gpx' },
    { chemin: SESSION, vers: depot(DEPOT_SESSION, 'autre.gpx') },
    { chemin: SESSION, vers: depot('2024-vacances', '2026-11-21 wing.gpx') },
    { chemin: SESSION, vers: depot('179564791447-1795000000000', '2026-11-21 wing.gpx') },
    { chemin: SESSION, vers: depot('1795647914477-tour  du lac', '2026-11-21 wing.gpx') },
    { chemin: SESSION, vers: depot('1795647914477-Lac.', '2026-11-21 wing.gpx') },
    { chemin: SESSION, vers: depot('1795647914477-a:b', '2026-11-21 wing.gpx') },
    { chemin: SESSION, vers: depot('1795647914477-a.tracker-new', '2026-11-21 wing.gpx') },
    { chemin: SESSION, vers: depot(`1795647914477-${'a'.repeat(81)}`, '2026-11-21 wing.gpx') },
    { chemin: SESSION, vers: `${DEPOT_TELEPHONE}/2026-11-21 wing.gpx` },
    { chemin: SESSION, vers: `${DEPOT_TELEPHONE}/${DEPOT_SESSION}/sessions/2026-11-21 wing.gpx` },
    { chemin: SESSION, vers: `Corbeille/${DEPOT_SESSION}/2026-11-21 wing.gpx` },
    { chemin: 'reglages/pixel-8.json', vers: depot(DEPOT_SESSION, 'pixel-8.json') },
    { chemin: 'sessions/vieux/a.gpx', vers: depot(DEPOT_SESSION, 'a.gpx') },
  ]
  for (const d of admises) if (!destinationCorbeilleAdmise(d.chemin, d.vers)) throw new Error(`destination devrait être admise : ${d.vers}`)
  for (const d of refusees) if (destinationCorbeilleAdmise(d.chemin, d.vers)) throw new Error(`destination devrait être refusée : ${d.vers}`)
  return { depot: DEPOT_TELEPHONE, admises, refusees }
}

// ---------- jetons et sondes ----------

function jetons() {
  return [suite(0, 32), new Uint8Array(32).fill(0xff)].map((j) => ({ jetonHex: hex(j), hachageHex: hacherJeton(j) }))
}

function sondes() {
  const identifiantPc = suite(0x10, 16)
  const nonces = [suite(0x00, 16), suite(0xf0, 16)]
  const ports = [PORT_SANS_FIL, PORT_SANS_FIL + 1]
  const reponses = nonces.map((nonce, i) => {
    const identifiant = identifiantDeSonde(identifiantPc, nonce)
    return { nonceHex: hex(nonce), port: ports[i], identifiantPcHex: hex(identifiantPc), identifiantSondeHex: hex(identifiant), octetsHex: hex(encoderReponse({ nonce, port: ports[i], identifiant })) }
  })
  const question = Buffer.from(encoderQuestion(nonces[0]))
  const reponse = Buffer.from(deHex(reponses[0].octetsHex))
  const avec = (base: Buffer, place: number, octets: number[]) => {
    const b = Buffer.from(base)
    b.set(octets, place)
    return b
  }
  const GTRK = [0x47, 0x54, 0x52, 0x4b]
  const etrangers: [string, Uint8Array][] = [
    ['question de version 1', avec(question, 4, [1])],
    ['réponse de version 1, identifiant du PC en clair', Buffer.concat([avec(reponse, 4, [1]).subarray(0, 24), identifiantPc, Buffer.of(0)])],
    ['réponse de version 1 qui porte le nom du PC', Buffer.concat([avec(reponse, 4, [1]).subarray(0, 24), identifiantPc, Buffer.of(17), Buffer.from('Bureau d’Élise', 'utf8')])],
    ["question d'un téléphone Gtracker (autre signature)", avec(question, 0, GTRK)],
    ["réponse d'un PC Gtracker (autre signature)", avec(reponse, 0, GTRK)],
    ['autre version', avec(question, 4, [3])],
    ['question amputée', question.subarray(0, question.length - 1)],
    ['question allongée', Buffer.concat([question, Buffer.of(0)])],
    ['réponse amputée de son dernier octet', reponse.subarray(0, reponse.length - 1)],
    ['réponse allongée', Buffer.concat([reponse, Buffer.of(0)])],
    ['réponse au port nul', avec(reponse, 22, [0, 0])],
    ["réponse à la bonne taille dont la longueur du nom n'est pas nulle", avec(reponse, 40, [1])],
    ['réponse qui porte un nom', Buffer.concat([avec(reponse, 40, [6]), Buffer.from('BUREAU', 'ascii')])],
    ["réponse dont le nom est plus court qu'annoncé", Buffer.concat([avec(reponse, 40, [2]), Buffer.from('P', 'ascii')])],
  ]
  return {
    port: PORT_SONDE,
    questions: [{ nonceHex: hex(nonces[0]), octetsHex: hex(question) }],
    reponses,
    etrangers: etrangers.map(([nom, octets]) => ({ nom, octetsHex: hex(octets) })),
  }
}

// ---------- le fichier ----------

const DESCRIPTION =
  "Jeux d'essai de la liaison sans fil entre le programme Windows et le téléphone, relus tels quels par les tests du PC et ceux du téléphone. Fichier produit par bureau/essais/vecteurs.ts (comment le relancer : en tête de ce fichier) : ne pas le retoucher à la main. Les formats sont décrits en tête de bureau/trames.ts (trames et messages), bureau/appairage.ts (jeton), bureau/spake2.ts (échange authentifié par le code) et bureau/sonde.ts (découverte UDP). Tous les octets sont en hexadécimal minuscule. emetteur vaut pc pour un message que le PC envoie au téléphone, telephone pour un message que le téléphone envoie au PC."

const LECTURE = {
  trames:
    "Décoder octetsHex donne une trame dont l'en-tête, relu en JSON, vaut enTete (comparer les valeurs, pas l'ordre des champs) et dont le corps vaut corpsHex. Encoder enTete et corpsHex redonne octetsHex quand l'en-tête est écrit dans l'ordre des champs donné, sans espace (JSON.stringify). Chaque message est valide : celui qui le reçoit (le téléphone quand emetteur vaut pc, le PC quand emetteur vaut telephone) le lit sans erreur.",
  tramesInvalides:
    "Décoder octetsHex, avec les limites d'une liaison où le téléphone s'est présenté (en-tête 8 388 608 octets, corps 1 048 576), échoue avec erreur ; TRONQUEE seulement quand le flux s'arrête là. Une marque d'ordre d'octets (EF BB BF) en tête de l'en-tête le rend illisible.",
  messagesInvalides:
    "Décoder octetsHex, avec les mêmes limites, donne exactement une trame, sans erreur ; lire son message échoue avec erreur (MESSAGE_INVALIDE ou MESSAGE_INCONNU). Le téléphone vérifie ceux dont emetteur vaut pc (les commandes qu'il reçoit), le PC les vérifie tous. effacer n'existe pas : c'est un message inconnu.",
  cheminsListe:
    "Règle de cheminAdmis (bureau/telephone.ts) : chemins qu'une liste peut porter (racine, sessions/, itineraires/, reglages/, journaux/) ; chaque texte de admis est accepté, chaque texte de refuses refusé. Un téléphone sans la capacité ecriture ne liste que la racine et sessions/, mais le PC accepte la règle entière.",
  cheminsLecture:
    "Règle de cheminLisible (bureau/trames.ts) : chemins qu'une commande lire peut demander, ceux de cheminAdmis et les chemins réels du listage complet (cheminBrutAdmis : relatif, à toute profondeur, provisoires compris, chaque segment ni vide, ni . ou .., sans antislash, deux-points, caractère interdit par Windows ou de contrôle, sans point ni espace finale, ni nom réservé ; 4 096 caractères au plus).",
  cheminsEcriture:
    "Règle de cheminEcrivable (bureau/telephone.ts), seule liste blanche de ecrire, valider et ecrit, des deux côtés : tracker.json et fc-repos.json à la racine, un fichier posé dans sessions/, itineraires/ ou reglages/. Le chemin le plus long admis a 512 caractères, celui de 513 est refusé.",
  cheminsRetrait: "Règle de cheminRetirable (bureau/telephone.ts) : chemin qu'une commande deplacer peut retirer, un fichier posé dans sessions/ ou itineraires/.",
  destinationsCorbeille:
    "Règle de destinationCorbeilleAdmise(chemin, vers) (bureau/telephone.ts) : vers vaut depot/<sous-dossier>/<nom>, où <nom> est le nom de chemin, inchangé, et <sous-dossier> a la forme des dossiers de la corbeille du programme Windows : 13 chiffres, un tiret, une identité (sans caractère refusé par Windows ni de contrôle, blancs simples, sans point ni espace finale, 80 caractères au plus), suffixe -n facultatif ; le nom entier sans suffixe provisoire. Chaque paire de admises est acceptée, chaque paire de refusees refusée.",
  jetons: 'hachageHex est le SHA-256 des 32 octets de jetonHex.',
  sondes:
    "Un seul format de découverte, à l'octet de version 2, signature TRKR (54 52 4B 52), port UDP sondes.port. Encoder une question (nonceHex) redonne octetsHex, et la décoder rend son nonce. Dans une réponse, identifiantSondeHex tient la place de l'identifiant du PC : les 16 premiers octets de HMAC-SHA256(clé = les 16 octets de identifiantPcHex, « tracker-sonde » en ASCII ‖ les 16 octets du nonce de la question), et la longueur du nom vaut 0 ; encoder nonceHex, port et identifiantSondeHex redonne octetsHex, et le décodage rend ces champs. Chaque paquet de etrangers, dont toute question ou réponse à l'octet de version 1 et tout paquet de Gtracker (signature GTRK), est refusé comme question et comme réponse.",
  spake2:
    "Chaque cas de spake2.cas : w tiré de code, puis l'échange de bureau/spake2.ts joué avec x et y fixés (A = le téléphone, idA, B = le PC, idB = les 32 octets de empreinteHex, aad) donne partAHex (pA), partBHex (pB), kHex (K), confirmationAHex (cA, envoyée par le téléphone dans preuve) et confirmationBHex (cB, envoyée par le PC dans appaire). Les trames « appairer, échange SPAKE2 », « defi, échange SPAKE2 », « preuve, confirmation du téléphone » et « appaire, confirmation du PC » portent les octets du premier cas.",
}

/** Le contenu du fichier, dans l'ordre où il s'écrit. */
export function genererVecteurs() {
  const spake2 = casSpake2()
  return {
    description: DESCRIPTION,
    lecture: LECTURE,
    portSansFil: PORT_SANS_FIL,
    trames: tramesValides(spake2),
    messagesInvalides: messagesInvalides(),
    ...regles(),
    tramesInvalides: tramesInvalides(),
    jetons: jetons(),
    sondes: sondes(),
    spake2: { cas: spake2 },
  }
}

/** Largeur au-delà de laquelle un objet ou un tableau s'écrit sur plusieurs lignes. */
const LARGEUR = 150

/** Un texte JSON, les caractères de contrôle C1 et l'effacement échappés comme le reste des contrôles. */
const texteJson = (s: string) => JSON.stringify(s).replace(/[\u007f-\u009f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)

/** Une valeur sur une seule ligne, espaces après les deux-points et les virgules. */
function enLigne(v: unknown): string {
  if (typeof v === 'string') return texteJson(v)
  if (Array.isArray(v)) return `[${v.map(enLigne).join(', ')}]`
  if (typeof v === 'object' && v !== null) {
    const champs = Object.entries(v).map(([k, x]) => `${texteJson(k)}: ${enLigne(x)}`)
    return champs.length === 0 ? '{}' : `{ ${champs.join(', ')} }`
  }
  return JSON.stringify(v)
}

/** Une valeur sur une ligne si elle tient dans `LARGEUR`, sinon un élément ou un champ par ligne. */
function formater(v: unknown, retrait: string): string {
  const ligne = enLigne(v)
  if (typeof v !== 'object' || v === null || retrait.length + ligne.length <= LARGEUR) return ligne
  const dedans = `${retrait}  `
  if (Array.isArray(v)) return `[\n${v.map((x) => dedans + formater(x, dedans)).join(',\n')}\n${retrait}]`
  return `{\n${Object.entries(v).map(([k, x]) => `${dedans}${texteJson(k)}: ${formater(x, dedans)}`).join(',\n')}\n${retrait}}`
}

/** Le texte du fichier `bureau/sansFil.vecteurs.json`. */
export function texteVecteurs(): string {
  return `${formater(genererVecteurs(), '')}\n`
}
