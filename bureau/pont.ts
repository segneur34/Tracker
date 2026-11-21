// Canaux entre la page et le processus principal : forme des réponses, contrôle de l'expéditeur, branchement des
// gestionnaires. Sans Electron à l'exécution (seulement ses types), pour être testé.
//
// Aucune exception ne traverse le pont : chaque gestionnaire rend `{ ok: true, valeur }` ou
// `{ ok: false, code, message }`, et une erreur imprévue devient `UNKNOWN`.

import { estDeLApplication } from './origine'
import type { CodeErreur } from './disque'
import { codeDe } from './disque'

export type Reponse<T> = { ok: true; valeur: T } | { ok: false; code: CodeErreur; message: string }

export function reussite<T>(valeur: T): Reponse<T> {
  return { ok: true, valeur }
}

export function echec(code: CodeErreur, message: string): Reponse<never> {
  return { ok: false, code, message }
}

/** Réponse d'une action : sa valeur, ou son erreur mise en code et en phrase. */
export async function enReponse<T>(action: () => Promise<T>): Promise<Reponse<T>> {
  try {
    return reussite(await action())
  } catch (e) {
    return echec(codeDe(e), e instanceof Error ? e.message : String(e))
  }
}

/** Ce que le contrôle de l'expéditeur lit d'un message reçu (`IpcMainInvokeEvent` d'Electron). */
export type EvenementPont = {
  sender: unknown
  senderFrame: { url: string; parent: unknown } | null
}

/**
 * Vrai si le message vient de la page de la fenêtre principale (`attendu`, son contenu), de son cadre de tête et
 * d'une adresse de l'application : un autre contenu, un cadre intégré ou une page étrangère n'atteignent pas le disque.
 */
export function expediteurAdmis(evenement: EvenementPont, attendu: unknown): boolean {
  const cadre = evenement.senderFrame
  return attendu !== null && attendu !== undefined && evenement.sender === attendu && cadre !== null && cadre.parent === null && estDeLApplication(cadre.url)
}

export type Gestionnaire = (argument: unknown) => Promise<Reponse<unknown>>

/** Ce que le branchement demande de `ipcMain`. */
export type Canaux = {
  handle(canal: string, rappel: (evenement: EvenementPont, ...args: unknown[]) => Promise<unknown>): void
}

/**
 * Sert chaque gestionnaire sur son canal. Un message dont l'expéditeur n'est pas admis reçoit un refus
 * (`PERMISSION`) sans atteindre le gestionnaire ; seul le premier argument est passé.
 */
export function brancherCanaux(
  canaux: Canaux,
  admis: (evenement: EvenementPont) => boolean,
  gestionnaires: Record<string, Gestionnaire>,
  journal: (message: string) => void = () => undefined,
): void {
  for (const [canal, gestionnaire] of Object.entries(gestionnaires)) {
    canaux.handle(canal, async (evenement, argument) => {
      if (!admis(evenement)) {
        journal(`message refusé sur ${canal} : expéditeur inconnu`)
        return echec('PERMISSION', 'Message refusé : il ne vient pas de la page de Tracker.')
      }
      try {
        return await gestionnaire(argument)
      } catch (e) {
        return echec('UNKNOWN', e instanceof Error ? e.message : String(e))
      }
    })
  }
}

/**
 * Une seule action à la fois : un appel lancé pendant qu'une action tourne reçoit la même promesse, sans en lancer
 * une seconde (une seule fenêtre de choix ouverte, même après deux clics).
 */
export function uneALaFois<A, T>(action: (argument: A) => Promise<T>): (argument: A) => Promise<T> {
  let enCours: Promise<T> | null = null
  return (argument) => {
    if (enCours) return enCours
    const courant = action(argument)
    enCours = courant
    const liberer = () => {
      if (enCours === courant) enCours = null
    }
    courant.then(liberer, liberer)
    return courant
  }
}
