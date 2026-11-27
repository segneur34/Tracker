import { readFileSync } from 'node:fs'
import path from 'node:path'
import { p256 } from '@noble/curves/nist.js'
import { describe, expect, it } from 'vitest'
import type { Alea } from './appairage'
import {
  DUREE_FENETRE_MS,
  FenetreAppairage,
  RegistreTelephones,
  TENTATIVES_MAX,
  depuisHex,
  egalATempsConstant,
  enHex,
  hacherJeton,
  tirerCode,
  tirerJeton,
} from './appairage'
import type { ClesSpake2 } from './spake2'
import { M_P256, commencerAppairage, conclure, confirmationValide, scalaireDuCode } from './spake2'
import type { EnTete, Message } from './trames'
import { encoderMessage } from './trames'

type CasSpake2 = {
  code: string
  empreinteHex: string
  yHex: string
  partAHex: string
  partBHex: string
  confirmationAHex: string
  confirmationBHex: string
}
type Vecteurs = {
  trames: { nom: string; enTete: EnTete; octetsHex: string }[]
  jetons: { jetonHex: string; hachageHex: string }[]
  spake2: { cas: CasSpake2[] }
}
const vecteurs = JSON.parse(readFileSync(path.join(__dirname, 'sansFil.vecteurs.json'), 'utf8')) as Vecteurs

const deHex = (t: string) => Uint8Array.from(Buffer.from(t, 'hex'))

/** Aléa d'essai : des octets qui se suivent, d'une graine donnée. */
function aleaSuite(graine = 0): Alea {
  let n = graine
  return (taille) => Uint8Array.from({ length: taille }, () => n++ & 0xff)
}

/** Aléa d'essai qui rend les suites d'octets données, dans l'ordre. */
function aleaFixe(...suites: Uint8Array[]): Alea {
  return (taille) => {
    const suite = suites.shift()
    if (!suite || suite.length !== taille) throw new Error(`aléa d'essai : ${taille} octets demandés hors de la suite prévue`)
    return suite
  }
}

/** Horloge d'essai qu'on avance à la main. */
function horlogeManuelle(depart = 1_000_000) {
  const h = { t: depart, lire: () => h.t }
  return h
}

const empreinte = Uint8Array.from({ length: 32 }, (_, i) => 0xa0 + i)

/**
 * Le téléphone : son nonce, et pour un code tapé, sa part (x neuf à chaque offre) puis sa confirmation une fois la
 * part du PC reçue.
 */
function telephone(graine: number) {
  const nonceTelephone = Uint8Array.from({ length: 32 }, (_, i) => (graine + i) & 0xff)
  const alea = aleaSuite(graine + 7)
  return {
    nonceTelephone,
    offrir(code: string, emp = empreinte) {
      const etat = commencerAppairage('A', code, emp, alea)
      return { partA: etat.part, cles: (partB: Uint8Array): ClesSpake2 => conclure(etat, partB) }
    },
  }
}

function nouvelleFenetre(horloge = horlogeManuelle()) {
  return { horloge, fenetre: new FenetreAppairage({ empreinte, horloge: horloge.lire, alea: aleaSuite(1) }) }
}

/** Un code différent de `code`. */
const autreCode = (code: string) => (code === '000000' ? '000001' : '000000')

type Tentative = Extract<ReturnType<FenetreAppairage['commencer']>, { ok: true }>

/** Commence une tentative au code donné et rend la tentative avec la confirmation cA du téléphone. */
function commencerAvec(fenetre: FenetreAppairage, tel: ReturnType<typeof telephone>, code: string, emp = empreinte) {
  const offre = tel.offrir(code, emp)
  const t = fenetre.commencer(tel.nonceTelephone, offre.partA)
  if (!t.ok) throw new Error(`tentative refusée : ${t.raison}`)
  const cles = offre.cles(t.partB)
  return { t: t as Tentative, cles, confirmationA: cles.confirmationEnvoyee }
}

describe('code', () => {
  it('tire 6 chiffres sans biais : un tirage de la tranche incomplète est refait', () => {
    const tirages = [Uint8Array.from([0xff, 0xff, 0xff, 0xff]), Uint8Array.from([0, 0, 0, 42])]
    expect(tirerCode(() => tirages.shift()!)).toBe('000042')
    // 4 293 999 999, plus grand tirage admis ; 4 294 000 000 ouvre la tranche incomplète.
    expect(tirerCode(() => Uint8Array.from([0xff, 0xf1, 0x3d, 0x7f]))).toBe('999999')
    const bord = [Uint8Array.from([0xff, 0xf1, 0x3d, 0x80]), Uint8Array.from([0, 0, 0, 7])]
    expect(tirerCode(() => bord.shift()!)).toBe('000007')
    expect(tirerCode()).toMatch(/^\d{6}$/)
  })
})

describe('jeton et outils', () => {
  it('hache le jeton comme les jeux d’essai partagés avec le téléphone', () => {
    for (const v of vecteurs.jetons) expect(hacherJeton(deHex(v.jetonHex))).toBe(v.hachageHex)
    expect(() => hacherJeton(new Uint8Array(31))).toThrow()
  })

  it('compare à temps constant, longueurs différentes comprises', () => {
    expect(egalATempsConstant(Uint8Array.from([1, 2]), Uint8Array.from([1, 2]))).toBe(true)
    expect(egalATempsConstant(Uint8Array.from([1, 2]), Uint8Array.from([1, 3]))).toBe(false)
    expect(egalATempsConstant(Uint8Array.from([1, 2]), Uint8Array.from([1, 2, 3]))).toBe(false)
    expect(depuisHex('0A', 1)).toBeNull()
    expect([...(depuisHex('0a', 1) ?? [])]).toEqual([10])
  })
})

describe('FenetreAppairage', () => {
  it('rejoue les trames partagées avec le téléphone : defi, puis appaire, à l’octet près', () => {
    const cas = vecteurs.spake2.cas[0]
    const trame = (nom: string) => {
      const v = vecteurs.trames.find((x) => x.nom === nom)
      if (!v) throw new Error(`trame absente des jeux d'essai : ${nom}`)
      return v
    }
    const appairer = trame('appairer, échange SPAKE2').enTete
    const defi = trame('defi, échange SPAKE2')
    const preuve = trame('preuve, confirmation du téléphone').enTete
    const appaire = trame('appaire, confirmation du PC')
    // Le code du jeu d'essai (042917 = 0x0000a7a5), le noncePc et y du jeu d'essai, puis le jeton de `appaire`.
    const alea = aleaFixe(Uint8Array.from([0, 0, 0xa7, 0xa5]), deHex(defi.enTete.noncePc as string), deHex(cas.yHex), deHex(appaire.enTete.jeton as string))
    const fenetre = new FenetreAppairage({ empreinte: deHex(cas.empreinteHex), horloge: horlogeManuelle().lire, alea })
    expect(fenetre.code).toBe(cas.code)
    expect(appairer.partA).toBe(cas.partAHex)
    const t = fenetre.commencer(deHex(appairer.nonceTelephone as string), deHex(cas.partAHex))
    if (!t.ok) throw new Error('tentative refusée')
    expect(enHex(t.partB)).toBe(cas.partBHex)
    expect(enHex(encoderMessage({ type: 'defi', noncePc: enHex(t.noncePc), partB: enHex(t.partB) }))).toBe(defi.octetsHex)
    expect(preuve.preuve).toBe(cas.confirmationAHex)
    const c = t.conclure(deHex(cas.confirmationAHex))
    if (!c.ok) throw new Error('appairage refusé')
    expect(enHex(c.confirmationB)).toBe(cas.confirmationBHex)
    const message: Message = { type: 'appaire', preuve: enHex(c.confirmationB), jeton: enHex(c.jeton), identifiantPc: appaire.enTete.identifiantPc as string, nomPc: 'BUREAU' }
    expect(enHex(encoderMessage(message))).toBe(appaire.octetsHex)
  })

  it('appaire au bon code : le téléphone vérifie la confirmation du PC et reçoit un jeton, la fenêtre se ferme', () => {
    const { fenetre } = nouvelleFenetre()
    const { t, cles, confirmationA } = commencerAvec(fenetre, telephone(0x10), fenetre.code)
    const c = t.conclure(confirmationA)
    if (!c.ok) throw new Error('appairage refusé')
    expect(confirmationValide(cles, c.confirmationB)).toBe(true)
    expect(c.jeton).toHaveLength(32)
    expect(fenetre.ouverte()).toBe(false)
    expect(fenetre.commencer(telephone(0x30).nonceTelephone, telephone(0x30).offrir('123456').partA)).toEqual({ ok: false, raison: 'fenetre' })
  })

  it('tire un y neuf à chaque tentative : deux tentatives au même code n’ont pas la même part', () => {
    const { fenetre } = nouvelleFenetre()
    const a = commencerAvec(fenetre, telephone(1), fenetre.code)
    const b = commencerAvec(fenetre, telephone(2), fenetre.code)
    expect(enHex(a.t.partB)).not.toBe(enHex(b.t.partB))
    expect(enHex(a.t.noncePc)).not.toBe(enHex(b.t.noncePc))
  })

  it('refuse un mauvais code et compte l’échec ; trois échecs ferment la fenêtre', () => {
    const { fenetre } = nouvelleFenetre()
    const faux = autreCode(fenetre.code)
    for (let i = 1; i <= 3; i++) {
      const { t, confirmationA } = commencerAvec(fenetre, telephone(i * 40), faux)
      expect(t.conclure(confirmationA)).toEqual({ ok: false, raison: 'code', fenetreFermee: i === 3 })
      expect(fenetre.echecs).toBe(i)
    }
    expect(fenetre.ouverte()).toBe(false)
    expect(fenetre.restantMs()).toBe(0)
    expect(fenetre.commencer(telephone(200).nonceTelephone, telephone(200).offrir(fenetre.code).partA)).toEqual({ ok: false, raison: 'fenetre' })
  })

  it('compte aussitôt une part refusée comme un code faux, mais répond comme à un code deviné faux', () => {
    const { fenetre } = nouvelleFenetre()
    const horsCourbe = Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : 1))
    // w·M pour le bon code : K serait neutre, ce qui dirait que le code deviné est juste.
    const wM = p256.Point.fromHex(M_P256).multiply(scalaireDuCode(fenetre.code)).toBytes(false)
    const faux = commencerAvec(fenetre, telephone(3), autreCode(fenetre.code))
    for (const [i, part] of [horsCourbe, wM].entries()) {
      const t = fenetre.commencer(telephone(i + 1).nonceTelephone, part)
      if (!t.ok) throw new Error('tentative refusée')
      // Compté avant toute réponse : le téléphone qui s'arrête après `defi` ne l'efface pas.
      expect(fenetre.echecs).toBe(i + 1)
      // Une part du PC comme une autre : un point de la courbe, neuf.
      expect(p256.Point.fromBytes(t.partB).is0()).toBe(false)
      expect(enHex(t.partB)).not.toBe(enHex(faux.t.partB))
      // Quelle que soit la confirmation, même issue qu'une confirmation fausse, sans échec de plus.
      expect(t.conclure(new Uint8Array(32))).toEqual({ ok: false, raison: 'code', fenetreFermee: false })
      expect(t.conclure(new Uint8Array(32))).toEqual({ ok: false, raison: 'nonce', fenetreFermee: false })
      expect(fenetre.echecs).toBe(i + 1)
    }
    expect(fenetre.tentatives).toBe(3)
    // Le troisième code faux, celui d'une confirmation, ferme la fenêtre comme les autres.
    expect(faux.t.conclure(faux.confirmationA)).toEqual({ ok: false, raison: 'code', fenetreFermee: true })
    expect(() => fenetre.commencer(telephone(9).nonceTelephone, new Uint8Array(64))).toThrow()
  })

  it('juge la conclusion d’une part refusée sur la fenêtre telle qu’elle était sans elle', () => {
    // Troisième code faux par une part refusée : la fenêtre se ferme aussitôt, mais la réponse reste `code`, comme
    // pour une troisième confirmation fausse.
    const { fenetre, horloge } = nouvelleFenetre()
    for (let i = 0; i < 2; i++) {
      const { t, confirmationA } = commencerAvec(fenetre, telephone(40 + i * 40), autreCode(fenetre.code))
      t.conclure(confirmationA)
    }
    const wM = p256.Point.fromHex(M_P256).multiply(scalaireDuCode(fenetre.code)).toBytes(false)
    const t = fenetre.commencer(telephone(1).nonceTelephone, wM)
    if (!t.ok) throw new Error('tentative refusée')
    expect(fenetre.ouverte()).toBe(false)
    expect(t.conclure(new Uint8Array(32))).toEqual({ ok: false, raison: 'code', fenetreFermee: true })
    // Expirée entre-temps : `fenetre`, comme pour toute confirmation.
    const autre = nouvelleFenetre(horloge)
    const u = autre.fenetre.commencer(telephone(2).nonceTelephone, Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : 1)))
    if (!u.ok) throw new Error('tentative refusée')
    horloge.t += DUREE_FENETRE_MS
    expect(u.conclure(new Uint8Array(32))).toEqual({ ok: false, raison: 'fenetre', fenetreFermee: true })
  })

  it('après trois échecs, même une tentative commencée avant et au bon code échoue', () => {
    const { fenetre } = nouvelleFenetre()
    const enCours = commencerAvec(fenetre, telephone(1), fenetre.code)
    for (let i = 0; i < 3; i++) {
      const { t, confirmationA } = commencerAvec(fenetre, telephone(50 + i * 40), autreCode(fenetre.code))
      t.conclure(confirmationA)
    }
    expect(enCours.t.conclure(enCours.confirmationA)).toEqual({ ok: false, raison: 'fenetre', fenetreFermee: true })
  })

  it('refuse un nonce rejoué, une confirmation rejouée sur une autre tentative et une tentative conclue deux fois', () => {
    const { fenetre } = nouvelleFenetre()
    const tel = telephone(7)
    const premiere = commencerAvec(fenetre, tel, fenetre.code)
    expect(fenetre.commencer(tel.nonceTelephone, tel.offrir(fenetre.code).partA)).toEqual({ ok: false, raison: 'nonce' })

    const seconde = commencerAvec(fenetre, telephone(99), fenetre.code)
    expect(seconde.t.conclure(premiere.confirmationA)).toMatchObject({ ok: false, raison: 'code' })

    expect(premiere.t.conclure(new Uint8Array(32))).toMatchObject({ ok: false, raison: 'code' })
    expect(premiere.t.conclure(premiere.confirmationA)).toMatchObject({ ok: false, raison: 'nonce' })
    expect(fenetre.echecs).toBe(2)
  })

  it('refuse une confirmation faite sur le certificat d’un autre (intermédiaire qui relaie)', () => {
    const { fenetre } = nouvelleFenetre()
    const autreEmpreinte = Uint8Array.from({ length: 32 }, () => 0x11)
    const { t, confirmationA } = commencerAvec(fenetre, telephone(3), fenetre.code, autreEmpreinte)
    expect(t.conclure(confirmationA)).toMatchObject({ ok: false, raison: 'code' })
  })

  it('se ferme d’elle-même au bout de 2 minutes, tentative commencée comprise', () => {
    const { fenetre, horloge } = nouvelleFenetre()
    expect(fenetre.restantMs()).toBe(DUREE_FENETRE_MS)
    const { t, confirmationA } = commencerAvec(fenetre, telephone(5), fenetre.code)
    horloge.t += DUREE_FENETRE_MS - 1
    expect(fenetre.ouverte()).toBe(true)
    expect(fenetre.restantMs()).toBe(1)
    horloge.t += 1
    expect(fenetre.ouverte()).toBe(false)
    expect(t.conclure(confirmationA)).toEqual({ ok: false, raison: 'fenetre', fenetreFermee: true })
    expect(fenetre.commencer(telephone(80).nonceTelephone, telephone(80).offrir(fenetre.code).partA)).toEqual({ ok: false, raison: 'fenetre' })
    expect(fenetre.echecs).toBe(0)
  })

  it('commence au plus dix tentatives : la onzième est refusée et ferme la fenêtre', () => {
    const { fenetre } = nouvelleFenetre()
    const enCours = Array.from({ length: TENTATIVES_MAX }, (_, i) => commencerAvec(fenetre, telephone(i * 3), fenetre.code))
    expect(fenetre.tentatives).toBe(TENTATIVES_MAX)
    expect(fenetre.ouverte()).toBe(true)
    expect(fenetre.commencer(telephone(200).nonceTelephone, telephone(200).offrir(fenetre.code).partA)).toEqual({ ok: false, raison: 'fenetre' })
    expect(fenetre.ouverte()).toBe(false)
    expect(fenetre.tentatives).toBe(TENTATIVES_MAX)
    expect(enCours[0].t.conclure(enCours[0].confirmationA)).toMatchObject({ ok: false, raison: 'fenetre' })
  })

  it('ne compte pas un nonce rejoué comme une tentative', () => {
    const { fenetre } = nouvelleFenetre()
    const tel = telephone(1)
    const partA = tel.offrir(fenetre.code).partA
    fenetre.commencer(tel.nonceTelephone, partA)
    for (let i = 0; i < 20; i++) expect(fenetre.commencer(tel.nonceTelephone, partA)).toEqual({ ok: false, raison: 'nonce' })
    expect(fenetre.tentatives).toBe(1)
    expect(fenetre.ouverte()).toBe(true)
  })

  it('se ferme à la demande', () => {
    const { fenetre } = nouvelleFenetre()
    const { t, confirmationA } = commencerAvec(fenetre, telephone(9), fenetre.code)
    fenetre.fermer()
    expect(t.conclure(confirmationA)).toMatchObject({ ok: false, raison: 'fenetre' })
  })
})

describe('RegistreTelephones', () => {
  const alea = aleaSuite(100)
  const jetonA = tirerJeton(aleaSuite(0))
  const jetonB = tirerJeton(aleaSuite(50))

  it('reconnaît chaque téléphone à son jeton, et plus du tout une fois retiré', () => {
    const r = new RegistreTelephones()
    const a = r.ajouter('Pixel 8', jetonA, 10, alea)
    const b = r.ajouter('Galaxy', jetonB, 20, alea)
    expect(a.id).not.toBe(b.id)
    expect(r.verifier(enHex(jetonA))).toEqual(a)
    expect(r.verifier(enHex(jetonB))).toEqual(b)
    expect(r.verifier(enHex(tirerJeton(aleaSuite(7))))).toBeNull()
    expect(r.verifier('pas un jeton')).toBeNull()
    expect(r.verifier(enHex(jetonA).toUpperCase())).toBeNull()
    expect(r.retirer(a.id)).toBe(true)
    expect(r.retirer(a.id)).toBe(false)
    expect(r.verifier(enHex(jetonA))).toBeNull()
    expect(r.verifier(enHex(jetonB))).toEqual(b)
  })

  it('se relit de son JSON, qui ne garde que le hachage du jeton', () => {
    const r = new RegistreTelephones()
    const a = r.ajouter('Pixel 8', jetonA, 10, alea)
    r.marquerVu(a.id, 99)
    const texte = r.enJson()
    expect(texte).not.toContain(enHex(jetonA))
    expect(texte).toContain(hacherJeton(jetonA))
    const relu = RegistreTelephones.depuisJson(texte)
    expect(relu.liste()).toEqual([{ ...a, vuLe: 99 }])
    expect(relu.liste()[0]).not.toHaveProperty('hachage')
    expect(relu.verifier(enHex(jetonA))?.id).toBe(a.id)
  })

  it('relit un profil abîmé sans tomber : texte illisible vide, entrée mal formée ou en double écartée', () => {
    expect(RegistreTelephones.depuisJson(null).liste()).toEqual([])
    expect(RegistreTelephones.depuisJson('{').liste()).toEqual([])
    expect(RegistreTelephones.depuisJson('[]').liste()).toEqual([])
    const bon = { id: '00'.repeat(16), nom: 'Pixel', hachage: hacherJeton(jetonA), ajouteLe: 1, vuLe: null }
    const texte = JSON.stringify({
      version: 1,
      telephones: [bon, { ...bon, nom: 'Double' }, { ...bon, id: '11'.repeat(16), hachage: 'court' }, { ...bon, id: '22'.repeat(16), nom: '' }, 'texte'],
    })
    expect(RegistreTelephones.depuisJson(texte).liste()).toEqual([{ id: bon.id, nom: 'Pixel', ajouteLe: 1, vuLe: null }])
  })

  it('pose vuLe à chaque arrivée : à l’appairage, puis à chaque présentation par le jeton', () => {
    const r = new RegistreTelephones()
    const a = r.ajouter('Pixel 8', jetonA, 10, alea)
    // L'appairage est la première arrivée : vu à l'heure de l'ajout.
    expect(a.vuLe).toBe(10)
    expect(r.liste()).toEqual([{ ...a, vuLe: 10 }])
    expect(r.arrivee(enHex(jetonA), 500)).toEqual({ ...a, vuLe: 500 })
    expect(r.liste()[0].vuLe).toBe(500)
    expect(RegistreTelephones.depuisJson(r.enJson()).liste()[0].vuLe).toBe(500)
    expect(r.arrivee(enHex(jetonA), 900)?.vuLe).toBe(900)
    // Jeton inconnu, mal formé ou révoqué : refusé, rien de changé.
    expect(r.arrivee(enHex(jetonB), 1000)).toBeNull()
    expect(r.arrivee('pas un jeton', 1000)).toBeNull()
    expect(r.liste()[0].vuLe).toBe(900)
    r.retirer(a.id)
    expect(r.arrivee(enHex(jetonA), 1100)).toBeNull()
    expect(r.liste()).toEqual([])
  })

  it('refuse un nom de téléphone mal formé', () => {
    expect(() => new RegistreTelephones().ajouter('a\u0000b', jetonA, 1, alea)).toThrow()
  })
})
