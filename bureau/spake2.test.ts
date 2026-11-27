import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { p256 } from '@noble/curves/nist.js'
import { describe, expect, it } from 'vitest'
import type { ClesSpake2, EtatSpake2, IdentitesSpake2, RaisonSpake2 } from './spake2'
import {
  AAD_APPAIRAGE,
  ErreurSpake2,
  ID_TELEPHONE,
  M_P256,
  N_P256,
  TAILLE_PART,
  commencer,
  commencerAppairage,
  conclure,
  confirmationValide,
  identitesAppairage,
  octetsDepuisHex,
  octetsEnHex,
  scalaireDuCode,
  tirerScalaire,
} from './spake2'

const hex = (o: Uint8Array) => Buffer.from(o).toString('hex')
const deHex = (t: string) => Uint8Array.from(Buffer.from(t, 'hex'))
const texte = (t: string) => Uint8Array.from(Buffer.from(t, 'utf8'))
const grand = (t: string) => BigInt(`0x${t}`)

/** Ordre du groupe de P-256 (FIPS 186-4), recopié ici pour ne pas dépendre de la bibliothèque. */
const ORDRE_P256 = grand('ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551')

/** Annexe B de la RFC 9382, suite P256-SHA256-HKDF-HMAC, sans AAD ; w, x et y donnés directement. */
const VECTEURS_RFC = [
  {
    A: 'server',
    B: 'client',
    w: '2ee57912099d31560b3a44b1184b9b4866e904c49d12ac5042c97dca461b1a5f',
    x: '43dd0fd7215bdcb482879fca3220c6a968e66d70b1356cac18bb26c84a78d729',
    y: 'dcb60106f276b02606d8ef0a328c02e4b629f84f89786af5befb0bc75b6e66be',
    pA: '04a56fa807caaa53a4d28dbb9853b9815c61a411118a6fe516a8798434751470f9010153ac33d0d5f2047ffdb1a3e42c9b4e6be662766e1eeb4116988ede5f912c',
    pB: '0406557e482bd03097ad0cbaa5df82115460d951e3451962f1eaf4367a420676d09857ccbc522686c83d1852abfa8ed6e4a1155cf8f1543ceca528afb591a1e0b7',
    K: '0412af7e89717850671913e6b469ace67bd90a4df8ce45c2af19010175e37eed69f75897996d539356e2fa6a406d528501f907e04d97515fbe83db277b715d3325',
    TT: '06000000000000007365727665720600000000000000636c69656e74410000000000000004a56fa807caaa53a4d28dbb9853b9815c61a411118a6fe516a8798434751470f9010153ac33d0d5f2047ffdb1a3e42c9b4e6be662766e1eeb4116988ede5f912c41000000000000000406557e482bd03097ad0cbaa5df82115460d951e3451962f1eaf4367a420676d09857ccbc522686c83d1852abfa8ed6e4a1155cf8f1543ceca528afb591a1e0b741000000000000000412af7e89717850671913e6b469ace67bd90a4df8ce45c2af19010175e37eed69f75897996d539356e2fa6a406d528501f907e04d97515fbe83db277b715d332520000000000000002ee57912099d31560b3a44b1184b9b4866e904c49d12ac5042c97dca461b1a5f',
    hashTT: '0e0672dc86f8e45565d338b0540abe6915bdf72e2b35b5c9e5663168e960a91b',
    Ke: '0e0672dc86f8e45565d338b0540abe69',
    Ka: '15bdf72e2b35b5c9e5663168e960a91b',
    KcA: '00c12546835755c86d8c0db7851ae86f',
    KcB: 'a9fa3406c3b781b93d804485430ca27a',
    cA: '58ad4aa88e0b60d5061eb6b5dd93e80d9c4f00d127c65b3b35b1b5281fee38f0',
    cB: 'd3e2e547f1ae04f2dbdbf0fc4b79f8ecff2dff314b5d32fe9fcef2fb26dc459b',
  },
  {
    A: '',
    B: 'client',
    w: '0548d8729f730589e579b0475a582c1608138ddf7054b73b5381c7e883e2efae',
    x: '403abbe3b1b4b9ba17e3032849759d723939a27a27b9d921c500edde18ed654b',
    y: '903023b6598908936ea7c929bd761af6039577a9c3f9581064187c3049d87065',
    pA: '04a897b769e681c62ac1c2357319a3d363f610839c4477720d24cbe32f5fd85f44fb92ba966578c1b712be6962498834078262caa5b441ecfa9d4a9485720e918a',
    pB: '04e0f816fd1c35e22065d5556215c097e799390d16661c386e0ecc84593974a61b881a8c82327687d0501862970c64565560cb5671f696048050ca66ca5f8cc7fc',
    K: '048f83ec9f6e4f87cc6f9dc740bdc2769725f923364f01c84148c049a39a735ebda82eac03e00112fd6a5710682767cff5361f7e819e53d8d3c3a2922e0d837aa6',
    TT: '00000000000000000600000000000000636c69656e74410000000000000004a897b769e681c62ac1c2357319a3d363f610839c4477720d24cbe32f5fd85f44fb92ba966578c1b712be6962498834078262caa5b441ecfa9d4a9485720e918a410000000000000004e0f816fd1c35e22065d5556215c097e799390d16661c386e0ecc84593974a61b881a8c82327687d0501862970c64565560cb5671f696048050ca66ca5f8cc7fc4100000000000000048f83ec9f6e4f87cc6f9dc740bdc2769725f923364f01c84148c049a39a735ebda82eac03e00112fd6a5710682767cff5361f7e819e53d8d3c3a2922e0d837aa620000000000000000548d8729f730589e579b0475a582c1608138ddf7054b73b5381c7e883e2efae',
    hashTT: '642f05c473c2cd79909f9a841e2f30a70bf89b18180af97353ba198789c2b963',
    Ke: '642f05c473c2cd79909f9a841e2f30a7',
    Ka: '0bf89b18180af97353ba198789c2b963',
    KcA: 'c6be376fc7cd1301fd0a13adf3e7bffd',
    KcB: 'b7243f4ae60440a49b3f8cab3c1fba07',
    cA: '47d29e6666af1b7dd450d571233085d7a9866e4d49d2645e2df975489521232b',
    cB: '3313c5cefc361d27fb16847a91c2a73b766ffa90a4839122a9b70a2f6bd1d6df',
  },
  {
    A: 'server',
    B: '',
    w: '626e0cdc7b14c9db3e52a0b1b3a768c98e37852d5db30febe0497b14eae8c254',
    x: '07adb3db6bc623d3399726bfdbfd3d15a58ea776ab8a308b00392621291f9633',
    y: 'b6a4fc8dbb629d4ba51d6f91ed1532cf87adec98f25dd153a75accafafedec16',
    pA: '04f88fb71c99bfffaea370966b7eb99cd4be0ff1a7d335caac4211c4afd855e2e15a873b298503ad8ba1d9cbb9a392d2ba309b48bfd7879aefd0f2cea6009763b0',
    pB: '040c269d6be017dccb15182ac6bfcd9e2a14de019dd587eaf4bdfd353f031101e7cca177f8eb362a6e83e7d5e729c0732e1b528879c086f39ba0f31a9661bd34db',
    K: '0445ee233b8ecb51ebd6e7da3f307e88a1616bae2166121221fdc0dadb986afaf3ec8a988dc9c626fa3b99f58a7ca7c9b844bb3e8dd9554aafc5b53813504c1cbe',
    TT: '06000000000000007365727665720000000000000000410000000000000004f88fb71c99bfffaea370966b7eb99cd4be0ff1a7d335caac4211c4afd855e2e15a873b298503ad8ba1d9cbb9a392d2ba309b48bfd7879aefd0f2cea6009763b04100000000000000040c269d6be017dccb15182ac6bfcd9e2a14de019dd587eaf4bdfd353f031101e7cca177f8eb362a6e83e7d5e729c0732e1b528879c086f39ba0f31a9661bd34db41000000000000000445ee233b8ecb51ebd6e7da3f307e88a1616bae2166121221fdc0dadb986afaf3ec8a988dc9c626fa3b99f58a7ca7c9b844bb3e8dd9554aafc5b53813504c1cbe2000000000000000626e0cdc7b14c9db3e52a0b1b3a768c98e37852d5db30febe0497b14eae8c254',
    hashTT: '005184ff460da2ce59062c87733c299c3521297d736598fc0a1127600efa1afb',
    Ke: '005184ff460da2ce59062c87733c299c',
    Ka: '3521297d736598fc0a1127600efa1afb',
    KcA: 'f3da53604f0aeecea5a33be7bddf6edf',
    KcB: '9e3f86848736f159bd92b6e107ec6799',
    cA: 'bc9f9bbe99f26d0b2260e6456e05a86196a3307ec6663a18bf6ac825736533b2',
    cB: 'c2370e1bf813b086dff0d834e74425a06e6390f48f5411900276dcccc5a297ec',
  },
  {
    A: '',
    B: '',
    w: '7bf46c454b4c1b25799527d896508afd5fc62ef4ec59db1efb49113063d70cca',
    x: '8cef65df64bb2d0f83540c53632de911b5b24b3eab6cc74a97609fd659e95473',
    y: 'd7a66f64074a84652d8d623a92e20c9675c61cb5b4f6a0063e4648a2fdc02d53',
    pA: '04a65b367a3f613cf9f0654b1b28a1e3a8a40387956c8ba6063e8658563890f46ca1ef6a676598889fc28de2950ab8120b79a5ef1ea4c9f44bc98f585634b46d66',
    pB: '04589f13218822710d98d8b2123a079041052d9941b9cf88c6617ddb2fcc0494662eea8ba6b64692dc318250030c6af045cb738bc81ba35b043c3dcb46adf6f58d',
    K: '041a3c03d51b452537ca2a1fea6110353c6d5ed483c4f0f86f4492ca3f378d40a994b4477f93c64d928edbbcd3e85a7c709b7ea73ee97986ce3d1438e135543772',
    TT: '00000000000000000000000000000000410000000000000004a65b367a3f613cf9f0654b1b28a1e3a8a40387956c8ba6063e8658563890f46ca1ef6a676598889fc28de2950ab8120b79a5ef1ea4c9f44bc98f585634b46d66410000000000000004589f13218822710d98d8b2123a079041052d9941b9cf88c6617ddb2fcc0494662eea8ba6b64692dc318250030c6af045cb738bc81ba35b043c3dcb46adf6f58d4100000000000000041a3c03d51b452537ca2a1fea6110353c6d5ed483c4f0f86f4492ca3f378d40a994b4477f93c64d928edbbcd3e85a7c709b7ea73ee97986ce3d1438e13554377220000000000000007bf46c454b4c1b25799527d896508afd5fc62ef4ec59db1efb49113063d70cca',
    hashTT: 'fc6374762ba5cf11f4b2caa08b2cd1b9907ae0e26e8d6234318d91583cd74c86',
    Ke: 'fc6374762ba5cf11f4b2caa08b2cd1b9',
    Ka: '907ae0e26e8d6234318d91583cd74c86',
    KcA: '5dbd2f477166b7fb6d61febbd77a5563',
    KcB: '7689b4654407a5faeffdc8f18359d8a3',
    cA: 'dfb4db8d48ae5a675963ea5e6c19d98d4ea028d8e898dad96ea19a80ade95dca',
    cB: 'd0f0609d1613138d354f7e95f19fb556bf52d751947241e8c7118df5ef0ae175',
  },
]

type CasCommun = {
  nom: string
  code: string
  empreinteHex: string
  idA: string
  aad: string
  wHex: string
  xHex: string
  yHex: string
  partAHex: string
  partBHex: string
  kHex: string
  confirmationAHex: string
  confirmationBHex: string
}
type Trame = { nom: string; emetteur: string; enTete: Record<string, unknown> }
type ReponseSonde = { nonceHex: string; port: number; identifiantPcHex: string; identifiantSondeHex: string; octetsHex: string }
const vecteurs = JSON.parse(readFileSync(path.join(__dirname, 'sansFil.vecteurs.json'), 'utf8')) as {
  spake2: { cas: CasCommun[] }
  trames: Trame[]
  sondes: { questions: { nonceHex: string; octetsHex: string }[]; reponses: ReponseSonde[] }
}

/** Raison de l'`ErreurSpake2` levée par `action`, ou `null` si rien n'est levé. */
function raison(action: () => unknown): RaisonSpake2 | null {
  try {
    action()
    return null
  } catch (e) {
    if (e instanceof ErreurSpake2) return e.raison
    throw e
  }
}

/** Aléa qui rend les suites données, dans l'ordre. */
function aleaFixe(...suites: Uint8Array[]): (taille: number) => Uint8Array {
  let i = 0
  return (taille) => {
    const s = suites[i++]
    if (!s || s.length !== taille) throw new Error('aléa épuisé')
    return s
  }
}

/** Les deux côtés conclus l'un face à l'autre. */
function echange(a: EtatSpake2, b: EtatSpake2): { clesA: ClesSpake2; clesB: ClesSpake2 } {
  return { clesA: conclure(a, b.part), clesB: conclure(b, a.part) }
}

describe('vecteurs de la RFC 9382, annexe B', () => {
  it('M et N sont ceux que l’algorithme de l’annexe A tire de leur graine', () => {
    // Graine hachée par SHA-256 itéré, 33 octets formatés en point compressé, premier point valide.
    const genere = (graine: string): string => {
      const iteree = (n: number) => {
        let h: Buffer = Buffer.from(graine, 'ascii')
        for (let i = 0; i < n; i++) h = createHash('sha256').update(h).digest()
        return h
      }
      for (let i = 1; i < 1000; i++) {
        const s = Buffer.concat([iteree(i), iteree(i + 1)]).subarray(0, 33)
        s[0] = (s[0] & 1) | 2
        try {
          const p = p256.Point.fromBytes(Uint8Array.from(s))
          if (!p.is0()) return s.toString('hex')
        } catch {
          // point hors de la courbe : bloc suivant
        }
      }
      throw new Error('aucun point')
    }
    expect(genere('1.2.840.10045.3.1.7 point generation seed (M)')).toBe(M_P256)
    expect(genere('1.2.840.10045.3.1.7 point generation seed (N)')).toBe(N_P256)
  })

  for (const v of VECTEURS_RFC) {
    it(`rejoue A='${v.A}', B='${v.B}'`, () => {
      const ids: IdentitesSpake2 = { idA: texte(v.A), idB: texte(v.B), aad: new Uint8Array(0) }
      const a = commencer('A', grand(v.w), grand(v.x), ids)
      const b = commencer('B', grand(v.w), grand(v.y), ids)
      expect(hex(a.part)).toBe(v.pA)
      expect(hex(b.part)).toBe(v.pB)
      const { clesA, clesB } = echange(a, b)
      for (const c of [clesA, clesB]) {
        expect(hex(c.partA)).toBe(v.pA)
        expect(hex(c.partB)).toBe(v.pB)
        expect(hex(c.k)).toBe(v.K)
        expect(hex(c.transcription)).toBe(v.TT)
        expect(hex(c.ke) + hex(c.ka)).toBe(v.hashTT)
        expect(hex(c.ke)).toBe(v.Ke)
        expect(hex(c.ka)).toBe(v.Ka)
        expect(hex(c.kcA)).toBe(v.KcA)
        expect(hex(c.kcB)).toBe(v.KcB)
        expect(hex(c.confirmationA)).toBe(v.cA)
        expect(hex(c.confirmationB)).toBe(v.cB)
      }
      expect(hex(clesA.confirmationEnvoyee)).toBe(v.cA)
      expect(hex(clesB.confirmationEnvoyee)).toBe(v.cB)
      expect(confirmationValide(clesB, clesA.confirmationEnvoyee)).toBe(true)
      expect(confirmationValide(clesA, clesB.confirmationEnvoyee)).toBe(true)
      // Chacun refuse sa propre confirmation renvoyée : un reflet ne passe pas pour celle de l'autre.
      expect(confirmationValide(clesA, clesA.confirmationEnvoyee)).toBe(false)
      expect(confirmationValide(clesB, clesB.confirmationEnvoyee)).toBe(false)
    })
  }
})

describe('scalaires', () => {
  it('tire w du code par SHA-512 réduit modulo l’ordre du groupe', () => {
    for (const code of ['042917', '999999', '000000']) {
      const condense = createHash('sha512').update(Buffer.concat([Buffer.from('tracker-spake2-w'), Buffer.of(0), Buffer.from(code, 'ascii')])).digest('hex')
      expect(scalaireDuCode(code)).toBe(grand(condense) % ORDRE_P256)
    }
    expect(scalaireDuCode('042917')).not.toBe(scalaireDuCode('42917'))
    for (const faux of ['', '04291a', ' 042917', '０４２９１７']) expect(raison(() => scalaireDuCode(faux)), faux).toBe('code')
  })

  it('tire un scalaire secret par rejet : ni zéro, ni au-delà de l’ordre', () => {
    const zero = new Uint8Array(32)
    const trop = new Uint8Array(32).fill(0xff)
    const ordre = deHex(ORDRE_P256.toString(16))
    const bon = deHex('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20')
    expect(tirerScalaire(aleaFixe(zero, trop, ordre, bon))).toBe(grand(hex(bon)))
    expect(tirerScalaire(aleaFixe(deHex((ORDRE_P256 - 1n).toString(16))))).toBe(ORDRE_P256 - 1n)
    expect(raison(() => tirerScalaire(() => new Uint8Array(31)))).toBe('scalaire')
  })

  it('refuse un w ou un secret hors de [1, n)', () => {
    const ids = identitesAppairage(new Uint8Array(32))
    expect(raison(() => commencer('A', 0n, 1n, ids))).toBe('scalaire')
    expect(raison(() => commencer('A', 1n, 0n, ids))).toBe('scalaire')
    expect(raison(() => commencer('B', 1n, ORDRE_P256, ids))).toBe('scalaire')
    expect(raison(() => commencer('B', ORDRE_P256 + 5n, 1n, ids))).toBe('scalaire')
  })
})

describe('appairage', () => {
  const empreinte = deHex('794b52b389eb92d0301942216091a202ca1589ec7278e58715ab7f73a7226859')
  const autreEmpreinte = deHex('a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf')
  const aleaX = () => aleaFixe(deHex('11'.repeat(32)))
  const aleaY = () => aleaFixe(deHex('22'.repeat(32)))

  it('pose les identités : le téléphone, l’empreinte vue, l’AAD', () => {
    const ids = identitesAppairage(empreinte)
    expect(Buffer.from(ids.idA).toString('ascii')).toBe(ID_TELEPHONE)
    expect(hex(ids.idB)).toBe(hex(empreinte))
    expect(Buffer.from(ids.aad).toString('ascii')).toBe(AAD_APPAIRAGE)
    expect(raison(() => identitesAppairage(new Uint8Array(31)))).toBe('identite')
  })

  it('conclut quand les deux côtés ont le même code et la même empreinte', () => {
    const { clesA, clesB } = echange(commencerAppairage('A', '042917', empreinte, aleaX()), commencerAppairage('B', '042917', empreinte, aleaY()))
    expect(confirmationValide(clesB, clesA.confirmationEnvoyee)).toBe(true)
    expect(confirmationValide(clesA, clesB.confirmationEnvoyee)).toBe(true)
    expect(hex(clesA.ke)).toBe(hex(clesB.ke))
  })

  it('échoue des deux côtés sur un mauvais code, sans rien lever', () => {
    const { clesA, clesB } = echange(commencerAppairage('A', '042917', empreinte, aleaX()), commencerAppairage('B', '042918', empreinte, aleaY()))
    expect(confirmationValide(clesB, clesA.confirmationEnvoyee)).toBe(false)
    expect(confirmationValide(clesA, clesB.confirmationEnvoyee)).toBe(false)
  })

  it('échoue quand un relais passe les parts entre deux liaisons TLS (deux empreintes)', () => {
    // Le téléphone voit le certificat du relais, le vrai PC le sien ; le relais connaît même le code.
    const { clesA, clesB } = echange(commencerAppairage('A', '042917', autreEmpreinte, aleaX()), commencerAppairage('B', '042917', empreinte, aleaY()))
    expect(confirmationValide(clesB, clesA.confirmationEnvoyee)).toBe(false)
    expect(confirmationValide(clesA, clesB.confirmationEnvoyee)).toBe(false)
  })

  it('échoue face à un PC Gtracker : autres identités, même au bon code et sur le même certificat', () => {
    expect([ID_TELEPHONE, AAD_APPAIRAGE]).toEqual(['tracker-telephone', 'tracker-appairage-1'])
    // Le PC Gtracker : son idA, son AAD et son étiquette du code.
    const etiquette = Buffer.from('gtracker-spake2-w')
    const wGtracker = BigInt(`0x${createHash('sha512').update(Buffer.concat([etiquette, Buffer.of(0), Buffer.from('042917', 'ascii')])).digest('hex')}`) % ORDRE_P256
    const idsGtracker: IdentitesSpake2 = { idA: texte('gtracker-telephone'), idB: empreinte, aad: texte('gtracker-appairage-2') }
    const gtracker = commencer('B', wGtracker, grand('22'.repeat(32)), idsGtracker)
    const tel = commencerAppairage('A', '042917', empreinte, aleaX())
    const { clesA, clesB } = echange(tel, gtracker)
    expect(confirmationValide(clesB, clesA.confirmationEnvoyee)).toBe(false)
    expect(confirmationValide(clesA, clesB.confirmationEnvoyee)).toBe(false)
  })

  it('refuse une confirmation de mauvaise longueur ou modifiée', () => {
    const { clesA, clesB } = echange(commencerAppairage('A', '042917', empreinte, aleaX()), commencerAppairage('B', '042917', empreinte, aleaY()))
    const cA = clesA.confirmationEnvoyee
    expect(confirmationValide(clesB, cA.subarray(0, 31))).toBe(false)
    expect(confirmationValide(clesB, Uint8Array.from([...cA, 0]))).toBe(false)
    const modifiee = Uint8Array.from(cA)
    modifiee[31] ^= 1
    expect(confirmationValide(clesB, modifiee)).toBe(false)
  })

  it('refuse une part neutre, hors de la courbe ou de mauvaise longueur', () => {
    const a = commencerAppairage('A', '042917', empreinte, aleaX())
    const b = commencerAppairage('B', '042917', empreinte, aleaY())
    const valide = b.part
    const horsCourbe = Uint8Array.from(valide)
    horsCourbe[64] ^= 1
    const mauvaisPrefixe = Uint8Array.from(valide)
    mauvaisPrefixe[0] = 0x05
    const horsDuCorps = Uint8Array.from([0x04, ...new Uint8Array(64).fill(0xff)])
    const compresse = p256.Point.fromBytes(valide).toBytes(true)
    const refusees: [string, Uint8Array][] = [
      ['neutre codé sur un octet', Uint8Array.of(0)],
      ['neutre en coordonnées nulles', Uint8Array.from([0x04, ...new Uint8Array(64)])],
      ['hors de la courbe', horsCourbe],
      ['coordonnées hors du corps', horsDuCorps],
      ['préfixe autre que 0x04', mauvaisPrefixe],
      ['point compressé', compresse],
      ['64 octets', valide.subarray(0, 64)],
      ['66 octets', Uint8Array.from([...valide, 0])],
      ['vide', new Uint8Array(0)],
    ]
    for (const [nom, part] of refusees) expect(raison(() => conclure(a, part)), nom).toBe('part')
    expect(raison(() => conclure(a, valide))).toBeNull()
    expect(valide.length).toBe(TAILLE_PART)
  })

  it('refuse un K neutre : la part de l’autre vaut w·N (ou w·M), sans part aléatoire', () => {
    const a = commencerAppairage('A', '042917', empreinte, aleaX())
    const b = commencerAppairage('B', '042917', empreinte, aleaY())
    const w = scalaireDuCode('042917')
    expect(raison(() => conclure(a, p256.Point.fromHex(N_P256).multiply(w).toBytes(false)))).toBe('cle')
    expect(raison(() => conclure(b, p256.Point.fromHex(M_P256).multiply(w).toBytes(false)))).toBe('cle')
  })
})

describe('octets en hexadécimal', () => {
  it('lit un texte hexadécimal minuscule de la taille demandée, et lui seul', () => {
    expect(octetsEnHex(Uint8Array.of(0, 171, 255))).toBe('00abff')
    expect(hex(octetsDepuisHex('00abff', 3)!)).toBe('00abff')
    for (const faux of ['00ABFF', '00abf', '00abff00', '00abzz']) expect(octetsDepuisHex(faux, 3), faux).toBeNull()
  })
})

describe('jeux d’essai partagés avec le téléphone', () => {
  it('reproduit chaque cas de la section spake2', () => {
    expect(vecteurs.spake2.cas.length).toBeGreaterThan(0)
    for (const v of vecteurs.spake2.cas) {
      expect(v.idA, v.nom).toBe(ID_TELEPHONE)
      expect(v.aad, v.nom).toBe(AAD_APPAIRAGE)
      const w = scalaireDuCode(v.code)
      expect(w.toString(16).padStart(64, '0'), v.nom).toBe(v.wHex)
      const ids = identitesAppairage(deHex(v.empreinteHex))
      const a = commencer('A', w, grand(v.xHex), ids)
      const b = commencer('B', w, grand(v.yHex), ids)
      expect(hex(a.part), v.nom).toBe(v.partAHex)
      expect(hex(b.part), v.nom).toBe(v.partBHex)
      const { clesA, clesB } = echange(a, b)
      expect(hex(clesA.k), v.nom).toBe(v.kHex)
      expect(hex(clesB.k), v.nom).toBe(v.kHex)
      expect(hex(clesA.confirmationEnvoyee), v.nom).toBe(v.confirmationAHex)
      expect(hex(clesB.confirmationEnvoyee), v.nom).toBe(v.confirmationBHex)
      // Le même cas, par le chemin réel : x et y tirés de l'aléa.
      const reelA = commencerAppairage('A', v.code, deHex(v.empreinteHex), aleaFixe(deHex(v.xHex)))
      expect(hex(reelA.part), v.nom).toBe(v.partAHex)
    }
  })

  it('les trames appairer, defi, preuve et appaire de l’échange portent les octets du premier cas', () => {
    const cas = vecteurs.spake2.cas[0]
    const trame = (nom: string) => {
      const t = vecteurs.trames.find((x) => x.nom === nom)
      if (!t) throw new Error(`trame absente : ${nom}`)
      return t.enTete
    }
    expect(trame('appairer, échange SPAKE2').partA).toBe(cas.partAHex)
    expect(trame('appairer, échange SPAKE2').capacites).toEqual(['ecriture', 'spake2'])
    expect(trame('defi, échange SPAKE2').partB).toBe(cas.partBHex)
    expect(trame('preuve, confirmation du téléphone').preuve).toBe(cas.confirmationAHex)
    expect(trame('appaire, confirmation du PC').preuve).toBe(cas.confirmationBHex)
  })

  it('les sondes de la découverte suivent leur description : version 2, identifiant sous HMAC, nom vide', () => {
    for (const v of vecteurs.sondes.questions) expect(v.octetsHex).toBe(`54524b520201${v.nonceHex}`)
    expect(vecteurs.sondes.reponses.length).toBeGreaterThan(1)
    for (const v of vecteurs.sondes.reponses) {
      const sonde = createHmac('sha256', deHex(v.identifiantPcHex))
        .update(Buffer.concat([Buffer.from('tracker-sonde', 'ascii'), deHex(v.nonceHex)]))
        .digest()
        .subarray(0, 16)
      expect(v.identifiantSondeHex).toBe(hex(sonde))
      expect(v.octetsHex).toBe(`54524b520202${v.nonceHex}${v.port.toString(16).padStart(4, '0')}${v.identifiantSondeHex}00`)
    }
  })
})
