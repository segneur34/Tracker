import { X509Certificate, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { createSecureContext } from 'node:tls'
import { describe, expect, it } from 'vitest'
import { NOM_CERTIFICAT, certificatUtilisable, empreinteCertificat, empreinteLisible, fabriquerCertificat } from './certificat'

const MAINTENANT = Date.UTC(2026, 10, 20, 12, 0, 0)
const fabrique = fabriquerCertificat({ maintenant: MAINTENANT, alea: (n) => new Uint8Array(n).fill(0xff) })

describe('fabriquerCertificat', () => {
  it('fabrique un certificat que X509Certificate relit, signé par sa propre clé, apparié à sa clé', () => {
    const x = new X509Certificate(fabrique.certificat)
    expect(x.subject).toBe(`CN=${NOM_CERTIFICAT}`)
    expect(x.issuer).toBe(`CN=${NOM_CERTIFICAT}`)
    expect(x.ca).toBe(false)
    expect(x.verify(x.publicKey)).toBe(true)
    expect(x.checkPrivateKey(createPrivateKey(fabrique.cle))).toBe(true)
    expect(x.publicKey.asymmetricKeyType).toBe('ec')
    expect(x.publicKey.asymmetricKeyDetails?.namedCurve).toBe('prime256v1')
    expect(Buffer.from(x.raw).equals(Buffer.from(fabrique.der))).toBe(true)
  })

  it('porte un numéro de série positif de 16 octets et une validité de la veille à la fin de 9999', () => {
    const x = new X509Certificate(fabrique.certificat)
    expect(x.serialNumber).toMatch(/^7F(FF){15}$/i)
    expect(Date.parse(x.validFrom)).toBe(MAINTENANT - 24 * 3600 * 1000)
    expect(Date.parse(x.validTo)).toBe(Date.UTC(9999, 11, 31, 23, 59, 59))
  })

  it('a pour empreinte le SHA-256 de ses octets DER, celle que donne X509Certificate', () => {
    const x = new X509Certificate(fabrique.certificat)
    expect(fabrique.empreinte).toHaveLength(32)
    expect(empreinteLisible(fabrique.empreinte)).toBe(x.fingerprint256)
    expect(empreinteLisible(empreinteCertificat(fabrique.certificat))).toBe(x.fingerprint256)
    expect(empreinteLisible(empreinteCertificat(fabrique.der))).toBe(x.fingerprint256)
  })

  it('sert de certificat à un serveur TLS de Node', () => {
    expect(() => createSecureContext({ key: fabrique.cle, cert: fabrique.certificat })).not.toThrow()
  })

  it('signe avec la clé rendue, que la clé publique du certificat vérifie', () => {
    const message = Buffer.from('tracker')
    const signature = sign('sha256', message, createPrivateKey(fabrique.cle))
    expect(verify('sha256', message, new X509Certificate(fabrique.certificat).publicKey, signature)).toBe(true)
  })

  it('tient sur une paire de clés donnée, et deux certificats ont deux empreintes', () => {
    const cles = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const a = fabriquerCertificat({ cles, maintenant: MAINTENANT })
    const b = fabriquerCertificat({ cles, maintenant: MAINTENANT })
    expect(createPublicKey(a.cle).export({ type: 'spki', format: 'der' })).toEqual(cles.publicKey.export({ type: 'spki', format: 'der' }))
    expect(empreinteLisible(a.empreinte)).not.toBe(empreinteLisible(b.empreinte))
  })

  it('écrit en GeneralizedTime une date après 2049', () => {
    const x = new X509Certificate(fabriquerCertificat({ maintenant: Date.UTC(2060, 0, 2, 3, 4, 5) }).certificat)
    expect(Date.parse(x.validFrom)).toBe(Date.UTC(2060, 0, 1, 3, 4, 5))
  })
})

describe('certificatUtilisable', () => {
  it('admet le certificat et sa clé pendant leur validité', () => {
    expect(certificatUtilisable(fabrique.certificat, fabrique.cle, MAINTENANT)).toBe(true)
  })

  it('refuse une autre clé, un texte abîmé, ou une date avant le début', () => {
    const autre = fabriquerCertificat({ maintenant: MAINTENANT })
    expect(certificatUtilisable(fabrique.certificat, autre.cle, MAINTENANT)).toBe(false)
    expect(certificatUtilisable(fabrique.certificat.replace(/[A-Z]/, 'z'), fabrique.cle, MAINTENANT)).toBe(false)
    // Un octet de l'émetteur changé : le certificat se lit encore, sa signature ne tient plus.
    const der = Buffer.from(fabrique.der)
    der[der.indexOf(Buffer.from(NOM_CERTIFICAT))] ^= 0x20
    const abime = `-----BEGIN CERTIFICATE-----\n${der.toString('base64')}\n-----END CERTIFICATE-----\n`
    expect(new X509Certificate(abime).issuer).toBe(`CN=t${NOM_CERTIFICAT.slice(1)}`)
    expect(certificatUtilisable(abime, fabrique.cle, MAINTENANT)).toBe(false)
    expect(certificatUtilisable('rien', fabrique.cle, MAINTENANT)).toBe(false)
    expect(certificatUtilisable(fabrique.certificat, 'rien', MAINTENANT)).toBe(false)
    expect(certificatUtilisable(fabrique.certificat, fabrique.cle, MAINTENANT - 2 * 24 * 3600 * 1000)).toBe(false)
  })
})
