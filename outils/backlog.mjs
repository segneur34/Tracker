// Tableau de bord du reste à faire : lit docs/BACKLOG.md, vérifie la forme de ses lignes et imprime, en français
// courant et en vingt lignes au plus, ce qui attend l'utilisateur, ce qui attend Claude, ce qui attend une occasion,
// ce qui dort en « Plus tard », puis les alertes.
//
//   node outils/backlog.mjs [chemin]     (défaut : docs/BACKLOG.md, depuis la racine du dépôt)
//
// Code de sortie 1 s'il y a une erreur de forme (ligne illisible, zone manquante, numéro en double), 0 sinon :
// une limite dépassée (Maintenant, Ensuite, questions) n'est qu'une alerte. Sans dépendance.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Titres de zone, exactement ceux du fichier. */
export const ZONES = {
  Maintenant: 'maintenant',
  Ensuite: 'ensuite',
  'Ça attend une occasion': 'occasion',
  'Plus tard': 'plusTard',
  Questions: 'questions',
}

/** Règles du fichier (en-tête de docs/BACKLOG.md). */
export const LIMITES = { lotsAvecEssais: 3, ensuite: 7, questions: 5, joursQuestion: 28, joursPlusTard: 90 }

const TYPES = ['bogue', 'idée', 'dette', 'outil']
const SEP = ' · '
// Champs d'une ligne d'élément après le titre, dans leur ordre ; l'état est le seul champ libre.
const CHAMPS = ['noté', 'taille', 'modèle', 'état', 'dépend', 'détail']
const JOUR_MS = 24 * 3600 * 1000

const RE_LISTE = /^(\s*)(?:-|(\d+)\.)\s+(.*)$/
const RE_ELEMENT = /^(\d+) · \[([^\]]+)\] (.+)$/
const RE_ESSAI = /^essai (\d+) : (.+?) → (.+)$/
const RE_QUESTION = /^Q(\d+) · (.+)$/
const RE_DATE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/
const RE_MODELE = /^(Fable|Opus|Sonnet|Haiku)\/(low|medium|high|xhigh|max)$/
const RE_PROCHAINS = /Prochains numéros : élément (\d+), essai (\d+), question Q(\d+)/

/**
 * Date `jj/mm` ou `jj/mm/aaaa` ; sans année, celle de `aujourdhui`, et une date qui tomberait dans le futur est prise
 * pour l'année précédente : l'année se choisit sur le jour et le mois, avant de juger la date (un 29/02 lu une année
 * non bissextile peut valoir l'année d'avant). Rend `null` si la date n'existe pas.
 */
export function lireDate(texte, aujourdhui) {
  const m = RE_DATE.exec(texte.trim())
  if (!m) return null
  const jour = Number(m[1])
  const mois = Number(m[2])
  let annee = Number(m[3])
  if (!m[3]) {
    const futur = mois > aujourdhui.getMonth() + 1 || (mois === aujourdhui.getMonth() + 1 && jour > aujourdhui.getDate())
    annee = aujourdhui.getFullYear() - (futur ? 1 : 0)
  }
  const date = new Date(annee, mois - 1, jour)
  if (date.getMonth() !== mois - 1 || date.getDate() !== jour) return null
  return date
}

function debutDuJour(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function joursEntre(avant, apres) {
  return Math.round((debutDuJour(apres).getTime() - debutDuJour(avant).getTime()) / JOUR_MS)
}

function jjmm(date) {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Les champs d'une ligne d'élément après « N · [type] » : titre, puis champs reconnus dans leur ordre. */
function lireChamps(reste, erreur, aujourdhui) {
  const morceaux = reste.split(SEP)
  const element = { titre: morceaux[0].trim() }
  let rang = -1
  for (const brut of morceaux.slice(1)) {
    const morceau = brut.trim()
    let champ
    if (morceau.startsWith('noté ')) {
      champ = 'noté'
      const date = lireDate(morceau.slice(5), aujourdhui)
      if (!date) erreur(`date illisible « ${morceau} » (jj/mm ou jj/mm/aaaa)`)
      element.note = date
    } else if (morceau === 'petit' || morceau === 'gros') {
      champ = 'taille'
      element.taille = morceau
    } else if (RE_MODELE.test(morceau)) {
      champ = 'modèle'
      element.modele = morceau
    } else if (morceau.startsWith('dépend de : ')) {
      champ = 'dépend'
      element.depend = morceau.slice('dépend de : '.length)
    } else if (morceau.startsWith('détail : ')) {
      champ = 'détail'
      element.detail = morceau.slice('détail : '.length)
    } else {
      champ = 'état'
      if (element.etat !== undefined) erreur(`champ inconnu « ${morceau} » (un seul état par ligne)`)
      element.etat = morceau
    }
    const r = CHAMPS.indexOf(champ)
    if (r <= rang) erreur(`champ « ${morceau} » hors de son ordre (noté, taille, modèle, état, dépend de, détail)`)
    rang = Math.max(rang, r)
  }
  if (!element.titre) erreur('titre vide')
  if (!('note' in element)) erreur('date d\'entrée manquante (« noté jj/mm »)')
  return element
}

/**
 * Lit le texte de docs/BACKLOG.md. Rend les zones, l'APK, les essais, les questions et les erreurs de forme
 * (`{ ligne, message }`, ligne comptée à partir de 1).
 */
export function lireBacklog(texte, aujourdhui = new Date()) {
  const r = {
    apk: null,
    prochains: null,
    maintenant: [],
    ensuite: [],
    occasion: [], // conditions : { condition, elements: [], essais: [] }
    plusTard: [],
    questions: [],
    essais: [], // tous, pour les doublons : { numero, ligne }
    erreurs: [],
    zonesVues: new Set(),
  }
  let zone = null
  let dernier = null // dernier élément lu, pour ses sous-lignes d'essai
  const lignes = texte.split(/\r?\n/)
  lignes.forEach((ligne, i) => {
    const numero = i + 1
    const erreur = (message) => r.erreurs.push({ ligne: numero, message })
    const titre = /^## (.+?)\s*$/.exec(ligne)
    if (titre) {
      zone = ZONES[titre[1]] ?? null
      dernier = null
      if (!zone) {
        erreur(`titre de zone inconnu « ${titre[1]} »`)
        zone = 'inconnue' // ses lignes sont ignorées : l'erreur du titre suffit
      } else if (r.zonesVues.has(zone)) erreur(`zone « ${titre[1]} » en double`)
      else r.zonesVues.add(zone)
      return
    }
    if (zone === 'inconnue') return
    if (zone === null) {
      const p = RE_PROCHAINS.exec(ligne)
      if (p) r.prochains = { element: Number(p[1]), essai: Number(p[2]), question: Number(p[3]) }
      return // en-tête : règles en texte libre
    }
    if (!ligne.trim()) return
    const liste = RE_LISTE.exec(ligne)
    if (!liste) {
      const apk = /^APK (\S+)/.exec(ligne)
      const gras = /^\*\*(.+)\*\*\s*$/.exec(ligne)
      if (zone === 'maintenant' && apk && !r.apk) r.apk = apk[1]
      else if (zone === 'occasion' && gras) {
        r.occasion.push({ condition: gras[1], elements: [], essais: [] })
        dernier = null
      } else erreur('texte hors forme (ni élément, ni essai, ni ligne APK, ni condition en gras)')
      return
    }
    const retrait = liste[1].length
    const numerote = liste[2] !== undefined
    const contenu = liste[3]

    if (zone === 'questions') {
      const q = RE_QUESTION.exec(contenu)
      if (!q || retrait > 0 || numerote) return erreur('question illisible (« - Qn · lot N · question · par défaut : … · posée le jj/mm »)')
      const champs = q[2].split(SEP).map((s) => s.trim())
      const question = { numero: Number(q[1]), ligne: numero, texte: '', lot: null, defaut: null, posee: null }
      for (const c of champs) {
        if (/^lot \d+$/.test(c)) question.lot = c.slice(4)
        else if (c.startsWith('par défaut : ')) question.defaut = c.slice('par défaut : '.length)
        else if (c.startsWith('posée le ')) {
          question.posee = lireDate(c.slice('posée le '.length), aujourdhui)
          if (!question.posee) erreur(`date illisible « ${c} »`)
        } else if (!question.texte) question.texte = c
      }
      if (!question.defaut) erreur(`Q${question.numero} sans réponse par défaut (« par défaut : … »)`)
      if (!question.posee) erreur(`Q${question.numero} sans date (« posée le jj/mm »)`)
      r.questions.push(question)
      return
    }

    const essai = RE_ESSAI.exec(contenu)
    if (essai) {
      if (numerote) return erreur('un essai s\'écrit « - essai N : quoi → attendu », sans numéro de liste')
      const e = { numero: Number(essai[1]), quoi: essai[2], attendu: essai[3], ligne: numero }
      r.essais.push(e)
      if (retrait > 0) {
        if (!dernier) return erreur('sous-ligne d\'essai sans élément au-dessus')
        dernier.essais.push(e)
      } else if (zone === 'occasion' && r.occasion.length) {
        r.occasion.at(-1).essais.push(e)
      } else {
        erreur('essai hors de son lot (sous-ligne en retrait) ou hors d\'une condition d\'occasion')
      }
      return
    }

    const el = RE_ELEMENT.exec(contenu)
    if (!el || retrait > 0) {
      return erreur(retrait > 0
        ? 'sous-ligne illisible (seules les sous-lignes « - essai N : quoi → attendu » sont permises)'
        : 'ligne d\'élément illisible (« N · [type] Titre · noté jj/mm · … »)')
    }
    if (!TYPES.includes(el[2])) erreur(`type inconnu « [${el[2]}] » (bogue, idée, dette ou outil)`)
    if (zone === 'ensuite' && !numerote) erreur('Ensuite est une liste numérotée (« 1. N · … »)')
    if (zone !== 'ensuite' && numerote) erreur('liste numérotée hors d\'Ensuite')
    const element = { numero: Number(el[1]), type: el[2], ligne: numero, zone, essais: [], ...lireChamps(el[3], erreur, aujourdhui) }
    dernier = element
    if (zone === 'occasion') {
      if (!r.occasion.length) return erreur('élément d\'occasion sans condition en gras au-dessus')
      r.occasion.at(-1).elements.push(element)
    } else {
      r[zone].push(element)
    }
  })

  for (const [titre, cle] of Object.entries(ZONES)) {
    if (!r.zonesVues.has(cle)) r.erreurs.push({ ligne: 0, message: `zone « ${titre} » manquante` })
  }
  doublons(tousLesElements(r), (x) => x.numero, (x) => `élément ${x.numero} en double`, r.erreurs)
  doublons(r.essais, (x) => x.numero, (x) => `essai ${x.numero} en double`, r.erreurs)
  doublons(r.questions, (x) => x.numero, (x) => `Q${x.numero} en double`, r.erreurs)
  return r
}

export function tousLesElements(r) {
  return [...r.maintenant, ...r.ensuite, ...r.occasion.flatMap((c) => c.elements), ...r.plusTard]
}

function doublons(liste, cle, message, erreurs) {
  const vus = new Set()
  for (const x of liste) {
    if (vus.has(cle(x))) erreurs.push({ ligne: x.ligne, message: message(x) })
    vus.add(cle(x))
  }
}

function numeros(liste) {
  return liste.map((x) => x.numero).join(', ')
}

/** Titre court : ce qui précède le premier « : ». */
function titreCourt(element) {
  return element.titre.split(' : ')[0]
}

/**
 * Les lots de Maintenant par sorte : bloqué par une question, à revoir après un bogue (ni l'un ni l'autre ne compte
 * dans la limite), avec des essais au téléphone (la limite), à valider sur lecture, en cours.
 */
export function rangerMaintenant(r) {
  const s = { bloques: [], aRevoir: [], avecEssais: [], surLecture: [], enCours: [] }
  for (const e of r.maintenant) {
    const etat = e.etat ?? ''
    if (/^bloqué/.test(etat)) s.bloques.push(e)
    else if (/^à revoir/.test(etat)) s.aRevoir.push(e)
    else if (e.essais.length) s.avecEssais.push(e)
    else if (/^à valider/.test(etat)) s.surLecture.push(e)
    else s.enCours.push(e)
  }
  return s
}

/** Les alertes de limite (pas des erreurs de forme). */
export function alertes(r, aujourdhui = new Date()) {
  const a = []
  const lotsAvecEssais = rangerMaintenant(r).avecEssais
  if (lotsAvecEssais.length > LIMITES.lotsAvecEssais) {
    a.push(`Maintenant : ${lotsAvecEssais.length} lots attendent des essais au téléphone (${LIMITES.lotsAvecEssais} au plus) : valider avant d'en lancer un autre.`)
  }
  if (r.ensuite.length > LIMITES.ensuite) {
    a.push(`Ensuite : ${r.ensuite.length} éléments (${LIMITES.ensuite} au plus) : en renvoyer en Plus tard.`)
  }
  if (r.questions.length > LIMITES.questions) {
    a.push(`Questions : ${r.questions.length} ouvertes (${LIMITES.questions} au plus).`)
  }
  for (const q of r.questions) {
    if (q.posee && joursEntre(q.posee, aujourdhui) >= LIMITES.joursQuestion) {
      a.push(`Q${q.numero} sans réponse depuis 4 semaines ou plus : proposer de la trancher par défaut.`)
    }
  }
  if (r.prochains) {
    const maxElement = Math.max(0, ...tousLesElements(r).map((e) => e.numero))
    const maxEssai = Math.max(0, ...r.essais.map((e) => e.numero))
    const maxQuestion = Math.max(0, ...r.questions.map((q) => q.numero))
    if (maxElement >= r.prochains.element || maxEssai >= r.prochains.essai || maxQuestion >= r.prochains.question) {
      a.push('« Prochains numéros » de l\'en-tête en retard sur les numéros employés : le mettre à jour.')
    }
  }
  return a
}

/** Le tableau de bord, en lignes de texte (vingt au plus pour un fichier dans ses limites). */
export function tableauDeBord(r, aujourdhui = new Date(), chemin = 'docs/BACKLOG.md') {
  const out = []
  const { bloques, aRevoir, avecEssais: lotsAvecEssais, surLecture, enCours } = rangerMaintenant(r)

  out.push('Vous')
  const essais = lotsAvecEssais.flatMap((e) => e.essais.map((x) => `${x.numero} (lot ${e.numero})`))
  if (essais.length) out.push(`- Essais à faire${r.apk ? ` sur l'APK ${r.apk}` : ''} : ${essais.join(', ')}.`)
  for (const q of r.questions) {
    const p = q.posee
    const limite = p ? `, à partir du ${jjmm(new Date(p.getFullYear(), p.getMonth(), p.getDate() + LIMITES.joursQuestion))}` : ''
    out.push(`- Question Q${q.numero}${q.lot ? ` (lot ${q.lot})` : ''} : ${q.texte} Sinon Claude fera : ${q.defaut}${limite}.`)
  }
  for (const e of bloques) {
    const q = /Q ?(\d+)/.exec(e.etat)
    out.push(`- Lot ${e.numero} bloqué${q ? ` par Q${q[1]}` : ''} : ${titreCourt(e)}.`)
  }
  if (surLecture.length) out.push(`- À relire et valider, sans essai : lots ${numeros(surLecture)}.`)
  if (out.length === 1) out.push('- Rien.')

  out.push('Claude')
  if (enCours.length) out.push(`- En cours : ${enCours.map((e) => `${e.numero} (${titreCourt(e)})`).join(', ')}.`)
  for (const e of aRevoir) {
    const b = /bogue n° ?(\d+)/.exec(e.etat)
    out.push(`- À revoir après le bogue ${b ? b[1] : '?'} : lot ${e.numero}.`)
  }
  if (lotsAvecEssais.length >= LIMITES.lotsAvecEssais) {
    out.push(`- Rien avant validation : ${lotsAvecEssais.length} lots attendent leurs essais.`)
  } else if (r.ensuite.length) {
    const prets = r.ensuite.map((e) => `${e.numero} ${titreCourt(e)} (${[e.taille, e.modele].filter(Boolean).join(', ')})`)
    out.push(`- Prêts, dans l'ordre : ${prets.join(' ; ')}.`)
  } else {
    out.push('- Rien de prêt.')
  }

  out.push('Ça attend une occasion')
  for (const c of r.occasion) {
    const parts = []
    const essaisC = [...c.essais, ...c.elements.flatMap((e) => e.essais)].map((e) => e.numero).sort((x, y) => x - y)
    if (essaisC.length) parts.push(`${essaisC.length > 1 ? 'essais' : 'essai'} ${essaisC.join(', ')}`)
    if (c.elements.length) parts.push(`${c.elements.length > 1 ? 'lots' : 'lot'} ${numeros(c.elements)}`)
    out.push(`- ${c.condition} : ${parts.join(' ; ') || 'rien'}.`)
  }
  if (!r.occasion.length) out.push('- Rien.')

  out.push('Plus tard')
  const vieux = r.plusTard.filter((e) => e.note && joursEntre(e.note, aujourdhui) >= LIMITES.joursPlusTard)
  const nb = r.plusTard.length
  out.push(`- ${nb} ${nb > 1 ? 'idées ou dettes' : 'idée ou dette'} ; ${vieux.length
    ? `90 jours ou plus, à garder ou lâcher : ${vieux.map((e) => `${e.numero} ${titreCourt(e)} (noté ${jjmm(e.note)})`).join(', ')}`
    : 'aucune n\'a 90 jours'}.`)

  const lesAlertes = alertes(r, aujourdhui)
  const erreurs = r.erreurs.map((e) => `Forme : ${chemin}${e.ligne ? `:${e.ligne}` : ''} : ${e.message}.`)
  if (!lesAlertes.length && !erreurs.length) out.push('Alertes : aucune.')
  else {
    out.push('Alertes')
    for (const x of [...erreurs, ...lesAlertes]) out.push(`- ${x}`)
  }
  return out
}

/** Lance le tableau de bord sur un fichier ; rend le code de sortie. */
export function principal(chemin = 'docs/BACKLOG.md', aujourdhui = new Date(), ecrire = console.log) {
  let texte
  try {
    texte = readFileSync(chemin, 'utf8')
  } catch (e) {
    ecrire(`Impossible de lire ${chemin} : ${e.message}`)
    return 1
  }
  const r = lireBacklog(texte, aujourdhui)
  ecrire(tableauDeBord(r, aujourdhui, chemin).join('\n'))
  return r.erreurs.length ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = principal(process.argv[2])
}
