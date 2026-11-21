// Requêtes de la page qui repartent sur le réseau (tuiles de cartes, recherche de lieux).
//
// Les serveurs de cartes d'OpenStreetMap, tenus par des bénévoles, exigent qu'un programme se présente : sans
// `Referer`, ou avec le `User-Agent` générique d'Electron, la requête est refusée, et le refus arrive comme une
// image PNG de statut 200 (« Access blocked »), que la page prendrait pour une vraie tuile et garderait. Ici, la
// fabrication des en-têtes d'une requête sortante et la détection d'une réponse de refus ; rien d'Electron.
//
// Aucun en-tête ne porte de donnée personnelle : seulement le nom du programme, sa version et l'adresse de l'application.

import { ORIGINE } from './origine'

/** Nom sous lequel le programme se présente aux serveurs (`Tracker/1.0.09`). */
export function nomDuProgramme(version: string): string {
  return `Tracker/${version}`
}

/**
 * En-têtes d'une requête sortante : ceux que la page a envoyés, sauf le `User-Agent` (le programme se nomme à la place
 * du navigateur intégré) et le `Referer` (l'adresse de l'application, que la page n'expose pas à la coquille).
 */
export function entetesSortants(entetesPage: HeadersInit, version: string): Headers {
  const entetes = new Headers(entetesPage)
  entetes.set('user-agent', nomDuProgramme(version))
  entetes.set('referer', `${ORIGINE}/`)
  return entetes
}

/**
 * Vrai si le serveur a refusé la requête par son en-tête `x-blocked` : le refus d'OpenStreetMap est servi avec un statut
 * 200 et une image. Un vrai statut d'échec (dont 404, que la page lit comme « tuile absente ») passe tel quel.
 */
export function estUnRefus(entetes: Headers): boolean {
  return entetes.has('x-blocked')
}

/** Réponse rendue à la page à la place d'un refus : un statut d'échec, sans image, pour qu'elle ne garde rien. */
export const STATUT_REFUS = 403
