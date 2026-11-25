// Pont entre la page et la coquille. Il tourne dans le bac à sable (`sandbox: true`) : un seul fichier, sans
// `require` de fichiers voisins (les noms des canaux sont donc écrits ici, gardés égaux à ceux de `memoire.ts` par
// un test), et rien d'Electron n'est donné à la page tel quel : une fonction par canal, qui ne passe qu'un argument.
//
// Chaque fonction rend une promesse de `{ ok: true, valeur }` ou `{ ok: false, code, message }` ; elle ne rejette
// jamais pour une erreur du disque. Les chemins sont relatifs à une racine, `memoire` (le dossier retenu) ou
// `candidat` (le dossier proposé ou choisi, en lecture seule) : la page ne donne jamais de chemin absolu.

import { contextBridge, ipcRenderer } from 'electron'

/** Version de l'application, passée par la coquille en argument de la page (`--tracker-version=…`). */
function versionPassee(): string {
  const prefixe = '--tracker-version='
  const argument = process.argv.find((a) => a.startsWith(prefixe))
  return argument ? argument.slice(prefixe.length) : ''
}

/** Message sans argument. */
const sans = (canal: string) => () => ipcRenderer.invoke(canal)

/** Message à un seul argument, passé tel quel (les tableaux d'octets sont copiés par Electron, sans base64). */
const avec = (canal: string) => (argument: unknown) => ipcRenderer.invoke(canal, argument)

const memoire = Object.freeze({
  ouvrir: sans('memoire:ouvrir'),
  proposer: sans('memoire:proposer'),
  choisir: avec('memoire:choisir'),
  adopter: avec('memoire:adopter'),
  oublier: sans('memoire:oublier'),
  lister: avec('memoire:lister'),
  lireTexte: avec('memoire:lireTexte'),
  lireOctets: avec('memoire:lireOctets'),
  stat: avec('memoire:stat'),
  ecrireTexte: avec('memoire:ecrireTexte'),
  ecrireOctets: avec('memoire:ecrireOctets'),
  effacer: avec('memoire:effacer'),
})

/**
 * Le dossier `Documents/Tracker` du téléphone branché, en lecture seule (noms gardés égaux à ceux de `telephone.ts`
 * par un test) : `etat()`, `lister()`, et `lireOctets({ chemin })` d'un fichier du dernier listage seulement.
 */
const telephone = Object.freeze({
  etat: sans('telephone:etat'),
  lister: sans('telephone:lister'),
  lireOctets: avec('telephone:lireOctets'),
})

/**
 * Avant de fermer la fenêtre, la coquille demande à la page de vider ses écritures en attente (`coquille:fermeture`,
 * lot 232) : chaque rappel inscrit par `surFermeture` est attendu, la promesse qu'il rend comprise, puis la réponse
 * part (`coquille:fermeturePrete`), même si un rappel a échoué. Sans rappel inscrit (page d'une version plus
 * ancienne), elle part aussitôt. La coquille n'attend la réponse que quelques secondes.
 */
const rappelsFermeture = new Set<() => unknown>()
ipcRenderer.on('coquille:fermeture', () => {
  void Promise.allSettled([...rappelsFermeture].map(async (rappel) => rappel())).then(() => ipcRenderer.send('coquille:fermeturePrete'))
})

contextBridge.exposeInMainWorld(
  'trackerBureau',
  Object.freeze({
    version: versionPassee(),
    memoire,
    telephone,
    /** Inscrit un rappel attendu avant la fermeture de la fenêtre ; rend la fonction de désabonnement. */
    surFermeture: (rappel: () => unknown) => {
      rappelsFermeture.add(rappel)
      return () => {
        rappelsFermeture.delete(rappel)
      }
    },
  }),
)
