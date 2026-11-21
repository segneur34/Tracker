import { describe, expect, it } from 'vitest'
import { copiesARetirer, worktreesDe } from './copies.mjs'

const B = 'C:/Users/x/AppData/Local/Temp/tracker-banc'
const w = (nom, utilise, dossier = B) => ({ chemin: `${dossier}/${nom}`, utilise })

describe('worktreesDe', () => {
  it('lit la sortie porcelain', () => {
    const t = 'worktree C:/depot\nHEAD abc\nbranch refs/heads/main\n\nworktree C:/tmp/avant-1a2b3c4\nHEAD def\ndetached\n'
    expect(worktreesDe(t).map((x) => x.chemin)).toEqual(['C:/depot', 'C:/tmp/avant-1a2b3c4'])
  })
})

describe('copiesARetirer', () => {
  const six = [w('avant-aaa1111', 1), w('avant-bbb2222', 5), w('avant-ccc3333', 3), w('avant-ddd4444', 9), w('avant-eee5555', 2)]

  it('garde les plus récemment utilisées et retire les autres', () => {
    const r = copiesARetirer({ worktrees: six, brouillon: B, garder: 3 })
    expect(r.sort()).toEqual([`${B}/avant-aaa1111`, `${B}/avant-eee5555`])
  })

  it('ne retire jamais la copie du passage en cours, même la plus ancienne', () => {
    const r = copiesARetirer({ worktrees: six, brouillon: B, courante: `${B}/avant-aaa1111`, garder: 3 })
    expect(r).not.toContain(`${B}/avant-aaa1111`)
    expect(r.sort()).toEqual([`${B}/avant-ccc3333`, `${B}/avant-eee5555`])
  })

  it('ne touche ni le dépôt, ni un worktree hors du brouillon, ni un nom étranger', () => {
    const autres = [
      { chemin: 'C:/Users/x/tracker', utilise: 0 },
      w('avant-fff6666', 0, 'C:/Users/x/AppData/Local/Temp/autre'),
      w('avant-ggg7777', 0, `${B}/sous`),
      w('essai', 0),
      w('avant-', 0),
    ]
    expect(copiesARetirer({ worktrees: autres, brouillon: B, garder: 0 })).toEqual([])
  })

  it('compare les chemins sans tenir compte des barres ni de la casse', () => {
    const r = copiesARetirer({ worktrees: [w('avant-abc1234', 1), w('avant-abc5678', 2)], brouillon: 'c:\\users\\x\\appdata\\local\\temp\\tracker-banc\\', garder: 1 })
    expect(r).toEqual([`${B}/avant-abc1234`])
  })

  it('ne retire rien quand il y en a assez peu', () => {
    expect(copiesARetirer({ worktrees: six.slice(0, 3), brouillon: B, garder: 3 })).toEqual([])
    expect(copiesARetirer({ worktrees: [], brouillon: B })).toEqual([])
  })
})
