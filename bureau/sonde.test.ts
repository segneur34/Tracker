import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { InfoAdresse } from './sonde'
import {
  NOM_PC_MAX_OCTETS,
  PORT_SONDE,
  SIGNATURE_SONDE,
  VERSION_SONDE_V2,
  VERSIONS_SONDE,
  adresseDeDiffusion,
  adressePrivee,
  adressesPrivees,
  decoderQuestion,
  decoderReponse,
  encoderQuestion,
  encoderReponse,
  identifiantDeSonde,
  lireIPv4,
  memeReseau,
  nomPcPourSonde,
  questionDAutreVersion,
} from './sonde'

type Vecteurs = {
  sondes: {
    port: number
    questions: { nonceHex: string; octetsHex: string }[]
    reponses: { nonceHex: string; port: number; identifiantPcHex: string; identifiantSondeHex: string; octetsHex: string }[]
    etrangers: { nom: string; octetsHex: string }[]
  }
}
const { sondes } = (JSON.parse(readFileSync(path.join(__dirname, 'sansFil.vecteurs.json'), 'utf8')) as Vecteurs)

const hex = (o: Uint8Array) => Buffer.from(o).toString('hex')
const deHex = (t: string) => Uint8Array.from(Buffer.from(t, 'hex'))

describe('question et réponse de découverte', () => {
  it('reproduisent les jeux d’essai partagés avec le téléphone : identifiant de sonde sous HMAC du nonce, sans nom', () => {
    // Un seul format, à l'octet 2 : jamais l'octet 1, sous lequel une application lirait l'identifiant en clair.
    expect(VERSIONS_SONDE).toEqual([2])
    expect(sondes.questions.length).toBeGreaterThan(0)
    for (const v of sondes.questions) {
      expect(hex(encoderQuestion(deHex(v.nonceHex)))).toBe(v.octetsHex)
      expect(deHex(v.octetsHex)[4]).toBe(VERSION_SONDE_V2)
      expect(decoderQuestion(deHex(v.octetsHex))).toEqual({ nonce: deHex(v.nonceHex) })
      expect(decoderReponse(deHex(v.octetsHex))).toBeNull()
      expect(questionDAutreVersion(deHex(v.octetsHex))).toBe(false)
    }
    expect(sondes.reponses.length).toBeGreaterThan(1)
    for (const v of sondes.reponses) {
      const identifiant = identifiantDeSonde(deHex(v.identifiantPcHex), deHex(v.nonceHex))
      expect(hex(identifiant)).toBe(v.identifiantSondeHex)
      // Jamais l'identifiant du PC en clair.
      expect(v.octetsHex).not.toContain(v.identifiantPcHex)
      const reponse = { nonce: deHex(v.nonceHex), port: v.port, identifiant }
      expect(hex(encoderReponse(reponse))).toBe(v.octetsHex)
      expect(decoderReponse(deHex(v.octetsHex))).toEqual(reponse)
      expect(decoderQuestion(deHex(v.octetsHex))).toBeNull()
    }
    // Un autre nonce donne un autre identifiant de sonde : un hôte du réseau ne suit pas le PC d'une question à l'autre.
    expect(new Set(sondes.reponses.map((v) => v.identifiantSondeHex)).size).toBe(sondes.reponses.length)
    expect(() => identifiantDeSonde(new Uint8Array(15), new Uint8Array(16))).toThrow()
  })

  it('ignorent un paquet étranger, dont toute question ou réponse de version 1', () => {
    expect(sondes.etrangers.length).toBeGreaterThan(0)
    for (const v of sondes.etrangers) {
      expect(decoderQuestion(deHex(v.octetsHex)), v.nom).toBeNull()
      expect(decoderReponse(deHex(v.octetsHex)), v.nom).toBeNull()
    }
    expect(decoderQuestion(new Uint8Array(0))).toBeNull()
    expect(decoderReponse(Buffer.from('\x00\x00\x01\x00\x00\x01', 'latin1'))).toBeNull()
  })

  it('reconnaissent une question d’une autre version, et elle seule', () => {
    const etranger = (nom: string) => deHex(sondes.etrangers.find((v) => v.nom === nom)!.octetsHex)
    expect(questionDAutreVersion(etranger('question de version 1'))).toBe(true)
    expect(questionDAutreVersion(etranger('autre version'))).toBe(true)
    for (const nom of ["question d'un téléphone Gtracker (autre signature)", 'question amputée', 'question allongée', 'réponse de version 1, identifiant du PC en clair']) {
      expect(questionDAutreVersion(etranger(nom)), nom).toBe(false)
    }
  })

  it('ne se croisent pas avec celles de Gtracker : autre signature, autre port, au même format', () => {
    expect(Buffer.from(SIGNATURE_SONDE).toString('ascii')).toBe('TRKR')
    expect(PORT_SONDE).toBe(48248)
    expect(sondes.port).toBe(PORT_SONDE)
    // Une question de Gtracker, octet pour octet celle de Tracker sous « GTRK » : ni question, ni réponse, ni autre version.
    const question = Buffer.from(encoderQuestion(new Uint8Array(16)))
    Buffer.from('GTRK', 'ascii').copy(question, 0)
    expect(decoderQuestion(question)).toBeNull()
    expect(questionDAutreVersion(question)).toBe(false)
    const reponse = Buffer.from(encoderReponse({ nonce: new Uint8Array(16), port: 48217, identifiant: new Uint8Array(16) }))
    Buffer.from('GTRK', 'ascii').copy(reponse, 0)
    expect(decoderReponse(reponse)).toBeNull()
  })

  it('refusent d’encoder un champ hors bornes', () => {
    const base = { nonce: new Uint8Array(16), port: 48247, identifiant: new Uint8Array(16) } as const
    expect(() => encoderQuestion(new Uint8Array(15))).toThrow()
    expect(() => encoderReponse({ ...base, nonce: new Uint8Array(15) })).toThrow()
    expect(() => encoderReponse({ ...base, port: 0 })).toThrow()
    expect(() => encoderReponse({ ...base, port: 65536 })).toThrow()
    expect(() => encoderReponse({ ...base, identifiant: new Uint8Array(8) })).toThrow()
  })

  it('ramènent le nom du PC à 64 octets sans couper un caractère', () => {
    expect(nomPcPourSonde('BUREAU\u0007-1')).toBe('BUREAU-1')
    const long = nomPcPourSonde('é'.repeat(40))
    expect(long).toBe('é'.repeat(32))
    expect(Buffer.byteLength(nomPcPourSonde('a' + '€'.repeat(30)), 'utf8')).toBeLessThanOrEqual(NOM_PC_MAX_OCTETS)
    expect(nomPcPourSonde('a' + '😀'.repeat(20)).endsWith('😀')).toBe(true)
  })
})

describe('adresses IPv4 privées', () => {
  it('reconnaît les trois plages privées, et elles seules', () => {
    for (const a of ['10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.254', '192.168.1.23']) expect(adressePrivee(a), a).toBe(true)
    for (const a of ['172.15.0.1', '172.32.0.1', '192.169.0.1', '169.254.1.1', '100.64.0.1', '127.0.0.1', '8.8.8.8', '11.0.0.1', '192.168.1', '192.168.1.256', 'fe80::1', '']) {
      expect(adressePrivee(a), a).toBe(false)
    }
    expect(lireIPv4('255.255.255.255')).toBe(0xffffffff)
  })

  it('calcule l’adresse de diffusion et le même réseau', () => {
    expect(adresseDeDiffusion('192.168.1.23', '255.255.255.0')).toBe('192.168.1.255')
    expect(adresseDeDiffusion('10.1.2.3', '255.0.0.0')).toBe('10.255.255.255')
    expect(adresseDeDiffusion('172.20.5.9', '255.255.240.0')).toBe('172.20.15.255')
    expect(adresseDeDiffusion('x', '255.0.0.0')).toBeNull()
    expect(memeReseau('192.168.1.23', '192.168.1.200', '255.255.255.0')).toBe(true)
    expect(memeReseau('192.168.1.23', '192.168.2.23', '255.255.255.0')).toBe(false)
  })

  it('trie les adresses du PC : vraies cartes d’abord, 192.168 puis 10 puis 172.16, sans boucle locale ni publique', () => {
    const v4 = (address: string, netmask = '255.255.255.0', internal = false): InfoAdresse => ({ address, netmask, family: 'IPv4', internal })
    const cartes: Record<string, InfoAdresse[] | undefined> = {
      'vEthernet (WSL)': [v4('172.28.0.1', '255.255.240.0')],
      'Wi-Fi': [v4('192.168.1.23'), { address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', internal: false }],
      Ethernet: [v4('10.0.0.5', '255.0.0.0'), { address: '172.16.4.2', netmask: '255.255.0.0', family: 4, internal: false }],
      'VirtualBox Host-Only Network': [v4('192.168.56.1')],
      'Loopback Pseudo-Interface 1': [v4('127.0.0.1', '255.0.0.0', true)],
      Public: [v4('81.2.3.4')],
      Rien: undefined,
      Double: [v4('192.168.1.23')],
    }
    expect(adressesPrivees(cartes).map((a) => `${a.carte} ${a.adresse} ${a.diffusion}`)).toEqual([
      'Wi-Fi 192.168.1.23 192.168.1.255',
      'Ethernet 10.0.0.5 10.255.255.255',
      'Ethernet 172.16.4.2 172.16.255.255',
      'VirtualBox Host-Only Network 192.168.56.1 192.168.56.255',
      'vEthernet (WSL) 172.28.0.1 172.28.15.255',
    ])
  })
})
