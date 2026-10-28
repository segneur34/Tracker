import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { alertes, lireBacklog, lireDate, principal, tableauDeBord } from './backlog.mjs'

const AUJOURDHUI = new Date(2026, 9, 28) // 28/10/2026

/** Fichier synthétique ; chaque zone se remplace par un tableau de lignes. */
function fichier({
  maintenant = [
    'APK 1.2.3 installée le 28/10 (versionCode 1002003).',
    '',
    '- 10 · [idée] Icône : rond rouge · noté 20/10 · petit · Sonnet/medium · à valider (abc123, 1.2.3)',
    '  - essai 5 : bouton rond → disque blanc et rond rouge.',
    '- 11 · [dette] Petites dettes · noté 20/10 · petit · Sonnet/medium · à valider sur lecture (def456)',
    '- 12 · [outil] Ce lot · noté 28/10 · petit · Opus/high · en cours',
  ],
  ensuite = [
    '1. 13 · [dette] Dépendances : TypeScript · noté 21/10 · petit · Opus/medium · à briefer',
    '2. 14 · [idée] Tests guidés : VMA · noté 22/10 · gros · Opus/high · à briefer · dépend de : maquette · détail : docs/backlog/14-vma.md',
  ],
  occasion = [
    '**Une sortie surf**',
    '- essai 6 : une vraie session → vagues crédibles.',
    '',
    '**Une course avec la ceinture**',
    '- 15 · [idée] Cadence : seuils · noté 17/10 · gros · Fable/high · à briefer',
    '  - essai 7 : une course → 170 pas/min.',
  ],
  plusTard = [
    '- 16 · [idée] Mode daltonien · noté 08/10 · gros',
    '- 17 · [dette] Brouillon · noté 01/07 · petit',
  ],
  questions = ['- Q3 · lot 15 · Lequel ? · par défaut : le premier · posée le 20/10'],
  prochains = 'Prochains numéros : élément 18, essai 8, question Q4.',
} = {}) {
  return [
    '# Reste à faire',
    '',
    prochains,
    '- Une ligne par élément : `- N · [type] Titre · …` (règle, ignorée par le lecteur).',
    '',
    '## Maintenant', '', ...maintenant, '',
    '## Ensuite', '', ...ensuite, '',
    '## Ça attend une occasion', '', ...occasion, '',
    '## Plus tard', '', ...plusTard, '',
    '## Questions', '', ...questions, '',
  ].join('\n')
}

function bord(texte) {
  const r = lireBacklog(texte, AUJOURDHUI)
  return { r, lignes: tableauDeBord(r, AUJOURDHUI), alertes: alertes(r, AUJOURDHUI) }
}

describe('lireDate', () => {
  it('lit jj/mm dans l\'année courante, et une date future dans l\'année précédente', () => {
    expect(lireDate('01/10', AUJOURDHUI)).toEqual(new Date(2026, 9, 1))
    expect(lireDate('28/10', AUJOURDHUI)).toEqual(new Date(2026, 9, 28))
    expect(lireDate('15/12', AUJOURDHUI)).toEqual(new Date(2025, 11, 15))
  })
  it('lit jj/mm/aaaa telle quelle et refuse une date qui n\'existe pas', () => {
    expect(lireDate('03/05/2024', AUJOURDHUI)).toEqual(new Date(2024, 4, 3))
    expect(lireDate('31/02', AUJOURDHUI)).toBeNull()
    expect(lireDate('demain', AUJOURDHUI)).toBeNull()
  })
  it('choisit l\'année avant de juger la date : un 29/02 vaut l\'année bissextile d\'avant', () => {
    expect(lireDate('29/02', new Date(2025, 0, 15))).toEqual(new Date(2024, 1, 29))
    expect(lireDate('29/02', AUJOURDHUI)).toBeNull() // lu le 28/10/2026 : le 29/02/2026 n'existe pas
  })
})

describe('tableau de bord', () => {
  it('imprime les quatre blocs sans alerte sur un fichier en forme', () => {
    const { r, lignes, alertes: a } = bord(fichier())
    expect(r.erreurs).toEqual([])
    expect(a).toEqual([])
    expect(lignes).toEqual([
      'Vous',
      "- Essais à faire sur l'APK 1.2.3 : 5 (lot 10).",
      '- Question Q3 (lot 15) : Lequel ? Sinon Claude fera : le premier, à partir du 17/11.',
      '- À relire et valider, sans essai : lots 11.',
      'Claude',
      '- En cours : 12 (Ce lot).',
      "- Prêts, dans l'ordre : 13 Dépendances (petit, Opus/medium) ; 14 Tests guidés (gros, Opus/high).",
      'Ça attend une occasion',
      '- Une sortie surf : essai 6.',
      '- Une course avec la ceinture : essai 7 ; lot 15.',
      'Plus tard',
      '- 2 idées ou dettes ; 90 jours ou plus, à garder ou lâcher : 17 Brouillon (noté 01/07).',
      'Alertes : aucune.',
    ])
    expect(lignes.length).toBeLessThanOrEqual(20)
  })

  it('ne compte pas les lots validés sur lecture dans la limite de Maintenant', () => {
    const lot = (n, essai) => [
      `- ${n} · [idée] Lot ${n} · noté 20/10 · petit · à valider`,
      ...(essai ? [`  - essai ${essai} : quoi → attendu.`] : []),
    ]
    const maintenant = [...lot(10, 1), ...lot(11, 2), ...lot(12, 3), ...lot(20), ...lot(21)]
    const { r, lignes, alertes: a } = bord(fichier({ maintenant, prochains: '' }))
    expect(r.erreurs).toEqual([])
    expect(a).toEqual([])
    expect(lignes).toContain('- Rien avant validation : 3 lots attendent leurs essais.')
    expect(lignes).toContain('- À relire et valider, sans essai : lots 20, 21.')
  })

  it('alerte au-delà de 3 lots avec essais, de 7 dans Ensuite, de 5 questions et de 4 semaines', () => {
    const maintenant = [10, 11, 12, 13].flatMap((n) => [
      `- ${n} · [idée] Lot ${n} · noté 20/10 · à valider`,
      `  - essai ${n} : quoi → attendu.`,
    ])
    const ensuite = [20, 21, 22, 23, 24, 25, 26, 27].map((n, i) => `${i + 1}. ${n} · [idée] Prêt ${n} · noté 20/10 · petit`)
    const questions = [1, 2, 3, 4, 5].map((n) => `- Q${n} · Question ${n} ? · par défaut : oui · posée le 20/10`)
    questions.push('- Q6 · Vieille ? · par défaut : non · posée le 20/09')
    const { r, alertes: a } = bord(fichier({ maintenant, ensuite, questions, occasion: [], plusTard: [], prochains: '' }))
    expect(r.erreurs).toEqual([])
    expect(a).toEqual([
      "Maintenant : 4 lots attendent des essais au téléphone (3 au plus) : valider avant d'en lancer un autre.",
      'Ensuite : 8 éléments (7 au plus) : en renvoyer en Plus tard.',
      'Questions : 6 ouvertes (5 au plus).',
      'Q6 sans réponse depuis 4 semaines ou plus : proposer de la trancher par défaut.',
    ])
  })

  it('alerte le jour même affiché par « à partir du » (28 jours), et nomme une idée dès 90 jours', () => {
    const questions = [
      '- Q1 · Pile 28 jours ? · par défaut : oui · posée le 30/09',
      '- Q2 · 27 jours ? · par défaut : oui · posée le 01/10',
    ]
    const plusTard = ['- 16 · [idée] Pile 90 jours · noté 30/07', '- 17 · [idée] 89 jours · noté 31/07']
    const { r, lignes, alertes: a } = bord(fichier({ questions, plusTard, prochains: '' }))
    expect(r.erreurs).toEqual([])
    expect(a).toEqual(['Q1 sans réponse depuis 4 semaines ou plus : proposer de la trancher par défaut.'])
    expect(lignes).toContain('- Question Q1 : Pile 28 jours ? Sinon Claude fera : oui, à partir du 28/10.')
    expect(lignes).toContain('- 2 idées ou dettes ; 90 jours ou plus, à garder ou lâcher : 16 Pile 90 jours (noté 30/07).')
  })

  it('range un lot bloqué chez vous et un lot à revoir chez Claude, hors de la limite de 3', () => {
    const lot = (n, etat, essai) => [
      `- ${n} · [idée] Lot ${n} : détail · noté 20/10 · petit · ${etat}`,
      ...(essai ? [`  - essai ${essai} : quoi → attendu.`] : []),
    ]
    const maintenant = [
      ...lot(10, 'à valider (abc, 1.0.0)', 1),
      ...lot(11, 'à valider (def, 1.0.1)', 2),
      ...lot(20, 'bloqué (Q3), stash'),
      ...lot(21, 'à revoir : bogue n° 13'),
    ]
    const { r, lignes, alertes: a } = bord(fichier({ maintenant, prochains: '' }))
    expect(r.erreurs).toEqual([])
    expect(a).toEqual([])
    expect(lignes.slice(0, 4)).toEqual([
      'Vous',
      '- Essais à faire : 1 (lot 10), 2 (lot 11).',
      '- Question Q3 (lot 15) : Lequel ? Sinon Claude fera : le premier, à partir du 17/11.',
      '- Lot 20 bloqué par Q3 : Lot 20.',
    ])
    expect(lignes).toContain('- À revoir après le bogue 13 : lot 21.')
    expect(lignes).toContain("- Prêts, dans l'ordre : 13 Dépendances (petit, Opus/medium) ; 14 Tests guidés (gros, Opus/high).")
    expect(lignes.some((l) => l.startsWith('- En cours'))).toBe(false)
  })

  it('alerte quand les prochains numéros de l\'en-tête sont en retard', () => {
    const { r, alertes: a } = bord(fichier({ prochains: 'Prochains numéros : élément 17, essai 8, question Q4.' }))
    expect(r.erreurs).toEqual([])
    expect(a).toEqual(["« Prochains numéros » de l'en-tête en retard sur les numéros employés : le mettre à jour."])
  })
})

describe('erreurs de forme', () => {
  it('signale un numéro d\'élément et un numéro d\'essai en double', () => {
    const plusTard = ['- 10 · [idée] Doublon · noté 08/10', '- 18 · [idée] Autre · noté 08/10']
    const occasion = ['**Une sortie**', '- essai 5 : encore → doublon.']
    const { r } = bord(fichier({ plusTard, occasion, prochains: '' }))
    expect(r.erreurs.map((e) => e.message)).toEqual(['élément 10 en double', 'essai 5 en double'])
  })

  it('signale une ligne illisible avec son numéro, et le code de sortie vaut 1', () => {
    const texte = fichier({ plusTard: ['- 16 · [idée] Bon · noté 08/10', '- une idée sans forme'] })
    const r = lireBacklog(texte, AUJOURDHUI)
    const ligne = texte.split('\n').indexOf('- une idée sans forme') + 1
    expect(r.erreurs).toEqual([{ ligne, message: "ligne d'élément illisible (« N · [type] Titre · noté jj/mm · … »)" }])
    const chemin = join(mkdtempSync(join(tmpdir(), 'backlog-')), 'BACKLOG.md')
    writeFileSync(chemin, texte)
    const sortie = []
    expect(principal(chemin, AUJOURDHUI, (s) => sortie.push(s))).toBe(1)
    expect(sortie.join('\n')).toContain(`Forme : ${chemin}:${ligne} : ligne d'élément illisible`)
    writeFileSync(chemin, fichier())
    expect(principal(chemin, AUJOURDHUI, () => {})).toBe(0)
  })

  it('refuse un type inconnu, une date manquante, des champs hors d\'ordre et un Ensuite non numéroté', () => {
    const plusTard = [
      '- 16 · [envie] Type inconnu · noté 08/10',
      '- 17 · [idée] Sans date · petit',
      '- 18 · [idée] Désordre · petit · noté 08/10',
    ]
    const ensuite = ['- 19 · [idée] Puce · noté 08/10']
    const { r } = bord(fichier({ plusTard, ensuite, prochains: '' }))
    expect(r.erreurs.map((e) => e.message)).toEqual([
      'Ensuite est une liste numérotée (« 1. N · … »)',
      'type inconnu « [envie] » (bogue, idée, dette ou outil)',
      "date d'entrée manquante (« noté jj/mm »)",
      'champ « noté 08/10 » hors de son ordre (noté, taille, modèle, état, dépend de, détail)',
    ])
  })

  it('signale une zone manquante, un essai sans lot et du texte libre dans une zone', () => {
    const texte = fichier({ maintenant: ['- essai 9 : seul → rien.'], plusTard: ['Une phrase libre.'] })
      .replace('## Questions', '## Divers')
    const { r } = bord(texte)
    expect(r.erreurs.map((e) => e.message)).toEqual([
      "essai hors de son lot (sous-ligne en retrait) ou hors d'une condition d'occasion",
      'texte hors forme (ni élément, ni essai, ni ligne APK, ni condition en gras)',
      'titre de zone inconnu « Divers »',
      'zone « Questions » manquante',
    ])
  })
})
