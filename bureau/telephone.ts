// Le « dossier distant » : le dossier `Documents/Tracker` du téléphone branché, vu du processus principal. Une
// interface (le débogage USB dans `adb.ts`), sa mise en œuvre « dossier local » pour les tests et le banc, et les
// gestionnaires des canaux `telephone:*` du pont. Sans Electron.
//
// Lecture, écriture et mise de côté, jamais d'effacement d'un fichier de l'utilisateur :
// - un fichier écrit l'est TOUJOURS sous `nom.tracker-new`, taille relue, puis renommé sur `nom` d'un seul `mv -f`
//   (`nomProvisoire`) ; jamais sous `.tracker-tmp`, que l'application du téléphone prendrait, resté seul, pour un
//   remplacement achevé. Un `.tracker-new` resté seul est caché puis effacé par le téléphone ; le seul effacement
//   que ce code connaisse est celui de ce provisoire, juste après un envoi raté ;
// - un fichier retiré est déplacé hors de la mémoire, dans la corbeille du téléphone, `Documents/Tracker-corbeille/
//   AAAA-MM-JJ/` (`nomCorbeille` : `Documents/<racine>-corbeille` pour une racine d'essai), sous le même chemin
//   relatif ; rien ne la purge ;
// - rien n'est écrit ni déplacé pendant que l'application du téléphone tient un service de premier plan
//   (enregistrement, ceinture cardio, compteur du fractionné) : `enregistrement`, relu avant chaque écriture.
//
// Sécurité :
// - la page ne lit ni ne retire un fichier que par un chemin rendu par le dernier listage : tout autre chemin est
//   refusé, si bien qu'elle ne peut pas atteindre un fichier quelconque du téléphone ; un retrait relit le fichier et
//   refuse s'il a changé depuis (taille, date) ;
// - elle n'écrit que dans la liste fermée `cheminEcrivable` (un fichier posé dans `sessions/`, `itineraires/` ou
//   `reglages/`, ou `tracker.json`, `fc-repos.json`), ne retire que de `sessions/` et d'`itineraires/`
//   (`cheminRetirable`), et ne vise dans la corbeille qu'un fichier de même sous-dossier, sous un jour bien formé
//   (`retraitAdmis`) ; tout est vérifié ici avant toute commande au téléphone ;
// - les chemins sont relatifs à `Documents/Tracker`, séparés par `/`, sans `.` ni `..`, sans caractère de contrôle
//   ni nom provisoire (`segmentAdmis`) ; un lien ou un dossier à la place d'un fichier est refusé ;
// - une lecture dont la taille diffère de celle du listage échoue, et son fichier temporaire est effacé ;
// - le dossier temporaire n'est jamais dans la mémoire du programme (vérifié à chaque listage et à chaque écriture).
//
// Mode d'essai (`TRACKER_BANC=1`) seulement, `telephoneDepuisEnvironnement` lit :
//   TRACKER_BANC_TELEPHONE          dossier local qui joue la mémoire partagée du téléphone (son `/sdcard`) ;
//                                   son sous-dossier `Documents/Tracker` est celui qui est lu, écrit, et dont on met
//                                   de côté dans `Documents/Tracker-corbeille`
//   TRACKER_BANC_TELEPHONE_ETAT     état imposé : pret, absent, autorisation, horsLigne, adbIntrouvable, occupe ou plusieurs
//   TRACKER_BANC_TELEPHONE_COUPURE  téléphone débranché après ce nombre d'opérations réussies (lectures, écritures,
//                                   mises de côté) ; une écriture coupée laisse son provisoire à moitié écrit
//   TRACKER_BANC_TELEPHONE_ENREGISTREMENT  « 1 » : le téléphone d'essai enregistre, rien n'y est écrit
//   TRACKER_BANC_TELEPHONE_PANNE    « listage » : après la première écriture réussie, le listage suivant, une seule
//                                   fois, est partiel (refusé comme celui du câble) : une synchronisation coupée en route
//   TRACKER_BANC_RACINE_TELEPHONE   racine déplacée vers `Documents/<valeur>`, valeur bornée à `Tracker-essai` ou
//                                   `Tracker-essai-<minuscules et chiffres>` (`RACINE_ESSAI`) ; sans dossier local,
//                                   c'est le vrai téléphone qui est lu et écrit, sur cette racine seulement, sa
//                                   corbeille étant `Documents/<valeur>-corbeille`
// Hors de ce mode, aucune de ces variables n'est lue : le vrai téléphone, sur `Documents/Tracker`.

import { copyFile, lstat, mkdir, open, readFile, readdir, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { copieSecurite, copieValable } from './copieSecurite'
import { ErreurDisque, SUFFIXE_NEUF, SUFFIXE_REMPLACEMENT, avecEssais, codeDe, segmentAdmis } from './disque'
import { estOctets } from './memoire'
import type { Gestionnaire } from './pont'
import { enReponse } from './pont'

/** État du téléphone, tel que la page le lit. */
export type EtatTelephone =
  /** Un téléphone prêt à être lu ; `nom` est son modèle, pour le message. */
  | { etat: 'pret'; nom: string }
  /** Rien de branché, ou rien de vu. */
  | { etat: 'absent' }
  /** Le téléphone attend que l'utilisateur accepte cet ordinateur. */
  | { etat: 'autorisation' }
  /** Le téléphone est vu mais ne répond pas. */
  | { etat: 'horsLigne' }
  /** L'outil du débogage USB n'est pas sur le poste ; `dossier` est celui où copier son dossier `platform-tools`. */
  | { etat: 'adbIntrouvable'; dossier: string }
  /** Un autre programme tient la liaison avec le téléphone : on n'y touche pas. */
  | { etat: 'occupe' }
  /** Plusieurs appareils sont branchés (ou un émulateur est ouvert) : refusé, pour ne jamais lire le mauvais. */
  | { etat: 'plusieurs'; nombre: number }

/** Valeurs de `etat`, dans l'ordre du type. */
export const ETATS_TELEPHONE = ['pret', 'absent', 'autorisation', 'horsLigne', 'adbIntrouvable', 'occupe', 'plusieurs'] as const satisfies readonly EtatTelephone['etat'][]

/** Un fichier du téléphone : chemin relatif à `Documents/Tracker`, taille en octets, date de modification à la seconde. */
export type FichierTelephone = { chemin: string; taille: number; dateMs: number }

/** Le dossier `Documents/Tracker` d'un téléphone. */
export interface DossierDistant {
  /** État du téléphone ; lève seulement sur une panne imprévue de l'outil. */
  etat(): Promise<EtatTelephone>
  /**
   * Fichiers de la racine et des sous-dossiers listés (`DOSSIERS_LISTES`), triés par chemin, tels que l'application du
   * téléphone les voit. `NOT_FOUND` si le dossier n'existe pas sur le téléphone ; une erreur si le téléphone n'est pas
   * prêt.
   */
  lister(): Promise<FichierTelephone[]>
  /**
   * Copie un fichier rendu par le dernier `lister` vers `fichierLocal` (chemin absolu sur le PC), en gardant sa date
   * de modification. Le fichier entier est passé, pour que le canal règle son délai sur la taille.
   */
  lire(fichier: FichierTelephone, fichierLocal: string): Promise<void>
  /**
   * Vrai si l'application du téléphone tient un service de premier plan (enregistrement, ceinture, compteur) : rien
   * n'est alors écrit. Lève si on ne sait pas le dire. Demande un listage préalable (le téléphone visé).
   */
  enregistrement(): Promise<boolean>
  /**
   * Écrit `fichierLocal` (chemin absolu sur le PC, de `taille` octets) sous `chemin`, admis par `cheminEcrivable`, sur
   * le téléphone du dernier listage : sous `nom.tracker-new`, taille relue, puis `mv -f` sur `nom`. En cas d'échec, le
   * provisoire est retiré et le fichier d'arrivée n'a pas été touché. Refusé pendant un enregistrement. Rend le
   * fichier tel qu'il est sur le téléphone.
   */
  ecrire(chemin: string, fichierLocal: string, taille: number): Promise<FichierTelephone>
  /**
   * Déplace le fichier `fichier` du dernier listage (`cheminRetirable`) dans la corbeille du téléphone, sous `vers`
   * (`Tracker-corbeille/AAAA-MM-JJ/<sessions ou itineraires>/<nom>`, admis par `retraitAdmis`), sans jamais écraser
   * ce qui y est. Refusé s'il a changé depuis le listage, ou pendant un enregistrement ; sans effet s'il n'est plus là.
   */
  mettreDeCote(fichier: FichierTelephone, vers: string): Promise<void>
  /**
   * Fichiers déjà dans un dossier du jour de la corbeille (`dossier` : `Tracker-corbeille/AAAA-MM-JJ`), sous
   * `sessions/` et `itineraires/`, en chemins de la même forme ; vide si le dossier n'existe pas.
   */
  listerCorbeille(dossier: string): Promise<string[]>
  /**
   * Tout ce que porte le dossier, à toute profondeur, sous les noms réels (provisoires compris), pour la copie de
   * sécurité : lecture seule. `ordinaire` faux pour ce qui n'est pas un fichier ordinaire (lien…). Lève si le listage
   * n'est pas complet.
   */
  listerTout(): Promise<FichierBrut[]>
  /** Copie vers `fichierLocal` un fichier du dernier `listerTout` seulement, de la même taille. */
  lireBrut(fichier: FichierTelephone, fichierLocal: string): Promise<void>
}

/** Un élément du dossier entier : chemin réel relatif à la racine, taille, date, et s'il est un fichier ordinaire. */
export type FichierBrut = FichierTelephone & { ordinaire: boolean }

/** Nom du dossier mémoire du téléphone, sous `Documents`. */
export const NOM_RACINE = 'Tracker'

/** Noms admis pour la racine déplacée du mode d'essai : jamais le vrai `Tracker`. */
export const RACINE_ESSAI = /^Tracker-essai(-[a-z0-9]+)?$/

/** Paquet de l'application sur le téléphone (`android/app/build.gradle`, `applicationId`). */
export const PAQUET_APPLICATION = 'io.github.segneur.tracker'

/**
 * Services de premier plan de l'application (`AndroidManifest.xml`) : enregistrement, ceinture cardio sans GPS,
 * compteur du fractionné. L'un d'eux vu dans `dumpsys` bloque toute écriture, au premier plan ou non.
 */
export const SERVICES_APPLICATION = ['RecordingService', 'HeartRateService', 'IntervalTimerService'] as const

/** Sous-dossier des sessions. */
export const DOSSIER_SESSIONS = 'sessions'

/** Sous-dossier des itinéraires. */
export const DOSSIER_ITINERAIRES = 'itineraires'

/** Sous-dossier des réglages de chaque appareil. */
export const DOSSIER_REGLAGES = 'reglages'

/** Sous-dossier des journaux d'enregistrement rendus à l'utilisateur : lus, jamais écrits par le câble. */
export const DOSSIER_JOURNAUX = 'journaux'

/** Sous-dossiers dont les fichiers sont listés et lus, en plus de ceux de la racine. */
export const DOSSIERS_LISTES: readonly string[] = [DOSSIER_SESSIONS, DOSSIER_ITINERAIRES, DOSSIER_REGLAGES, DOSSIER_JOURNAUX]

/**
 * Vrai pour un chemin relatif listable : un fichier de la racine ou de l'un des `DOSSIERS_LISTES`, chaque segment
 * admis sur le disque du PC (`segmentAdmis` : ni vide, ni `.` ou `..`, ni caractère interdit par Windows, antislash et
 * deux-points compris, ni nom provisoire), puisque c'est là qu'il sera rangé. Un chemin absolu commence par un segment
 * vide : refusé.
 */
export function cheminAdmis(chemin: string): boolean {
  const segments = chemin.split('/')
  if (segments.length === 2 && !DOSSIERS_LISTES.includes(segments[0])) return false
  if (segments.length !== 1 && segments.length !== 2) return false
  return segments.every(segmentAdmis)
}

// ---------- listes fermées des écritures et des retraits ----------

/** Sous-dossiers où la page peut écrire des fichiers, posés directement dedans. */
export const DOSSIERS_ECRIVABLES: readonly string[] = [DOSSIER_SESSIONS, DOSSIER_ITINERAIRES, DOSSIER_REGLAGES]

/** Fichiers de la racine que la page peut écrire : le marqueur, les tests de FC repos. */
export const FICHIERS_RACINE_ECRIVABLES: readonly string[] = ['tracker.json', 'fc-repos.json']

/** Sous-dossiers dont la page peut mettre un fichier de côté. */
export const DOSSIERS_RETIRABLES: readonly string[] = [DOSSIER_SESSIONS, DOSSIER_ITINERAIRES]

/** Longueur au-delà de laquelle un chemin est refusé sans examen. */
const LONGUEUR_MAX = 512

/**
 * Seule liste des écritures sur le téléphone, appliquée dans la coquille avant toute commande : un fichier posé
 * directement dans `sessions/`, `itineraires/` ou `reglages/` (nom admis par `segmentAdmis`), ou l'un des
 * `FICHIERS_RACINE_ECRIVABLES`. Tout le reste est refusé : chemin absolu, sous-dossier, autre dossier, barre finale.
 */
export function cheminEcrivable(chemin: unknown): chemin is string {
  if (typeof chemin !== 'string' || chemin.length === 0 || chemin.length > LONGUEUR_MAX) return false
  const segments = chemin.split('/')
  if (segments.length === 1) return FICHIERS_RACINE_ECRIVABLES.includes(chemin)
  return segments.length === 2 && DOSSIERS_ECRIVABLES.includes(segments[0]) && segmentAdmis(segments[1])
}

/** Seule liste des retraits : un fichier posé directement dans `sessions/` ou `itineraires/`. */
export function cheminRetirable(chemin: unknown): chemin is string {
  if (typeof chemin !== 'string' || chemin.length === 0 || chemin.length > LONGUEUR_MAX) return false
  const segments = chemin.split('/')
  return segments.length === 2 && DOSSIERS_RETIRABLES.includes(segments[0]) && segmentAdmis(segments[1])
}

/**
 * Nom de la corbeille vu de la page, sous `Documents/` (`PHONE_TRASH_ROOT` de `src/library/syncBase.ts`, tenu égal
 * par un test) : la page désigne toujours `Tracker-corbeille/…`, la coquille la place à côté de la racine lue.
 */
export const CORBEILLE_PAGE = 'Tracker-corbeille'

/** Dossier de la corbeille du téléphone sous `Documents`, à côté de la racine : `Tracker-corbeille`, ou `Tracker-essai-corbeille`. */
export function nomCorbeille(nomRacine: string): string {
  return `${nomRacine}-corbeille`
}

/** Un jour de la corbeille, `AAAA-MM-JJ`. */
const JOUR = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/** Jour d'un dossier de la corbeille vu de la page (`Tracker-corbeille/AAAA-MM-JJ`), `null` s'il est mal formé. */
export function dossierCorbeilleAdmis(dossier: unknown): string | null {
  if (typeof dossier !== 'string') return null
  const segments = dossier.split('/')
  return segments.length === 2 && segments[0] === CORBEILLE_PAGE && JOUR.test(segments[1]) ? segments[1] : null
}

/** Destination d'un retrait, relative à la corbeille : son jour, son sous-dossier et son nom. */
export type DestinationCorbeille = { jour: string; sous: string; nom: string; relatif: string }

/**
 * Destination d'un retrait de `chemin` vers `vers` (`Tracker-corbeille/AAAA-MM-JJ/<sous>/<nom>`) : `chemin` retirable,
 * même sous-dossier des deux côtés, nom admis ; `null` sinon.
 */
export function retraitAdmis(chemin: unknown, vers: unknown): DestinationCorbeille | null {
  if (!cheminRetirable(chemin) || typeof vers !== 'string' || vers.length > LONGUEUR_MAX) return null
  const segments = vers.split('/')
  if (segments.length !== 4 || segments[0] !== CORBEILLE_PAGE || !JOUR.test(segments[1])) return null
  const [, jour, sous, nom] = segments
  if (sous !== chemin.split('/')[0] || !segmentAdmis(nom)) return null
  return { jour, sous, nom, relatif: `${jour}/${sous}/${nom}` }
}

/** Erreur rendue pour un chemin hors des listes fermées. */
export function cheminRefuse(chemin: unknown): ErreurDisque {
  const texte = typeof chemin === 'string' ? chemin.slice(0, 200) : typeof chemin
  return new ErreurDisque('PERMISSION', `Chemin refusé sur le téléphone : « ${texte} ».`)
}

/** Message rendu quand le téléphone enregistre : la page le reconnaît pour le dire en clair. */
export const MESSAGE_ENREGISTREMENT = "Le téléphone enregistre une session : rien n'y est écrit pendant ce temps."

/** Erreur rendue à une écriture ou un retrait demandé pendant un enregistrement. */
export function enregistrementEnCours(): ErreurDisque {
  return new ErreurDisque('PERMISSION', MESSAGE_ENREGISTREMENT)
}

/** Erreur rendue quand un fichier à retirer a changé depuis le listage. */
export function changeDepuisListage(chemin: string): ErreurDisque {
  return new ErreurDisque('UNKNOWN', `« ${chemin} » a changé sur le téléphone depuis le listage : listez-le de nouveau.`)
}

/** Erreur rendue quand la place visée dans la corbeille est déjà prise. */
export function corbeillePrise(vers: string): ErreurDisque {
  return new ErreurDisque('UNKNOWN', `« ${vers} » est déjà pris dans la corbeille du téléphone.`)
}

// ---------- noms provisoires, comme l'application du téléphone ----------

/**
 * Nom provisoire d'une écriture du câble : toujours `nom.tracker-new`, fichier neuf comme remplacement, renommé
 * ensuite d'un seul `mv -f`. Resté seul après une coupure, le téléphone le cache puis l'efface : l'original est
 * intact. Même règle que `cableTempName` de `src/library/remoteTemps.ts` (la coquille ne lit pas les sources de la
 * page ; un test les compare).
 */
export function nomProvisoire(chemin: string): string {
  return chemin + SUFFIXE_NEUF
}

/** Un fichier tel que le téléphone le montre (`chemin`), et le nom qu'il porte vraiment sur le téléphone (`reel`). */
export type FichierVu = FichierTelephone & { reel: string }

/**
 * Fichiers tels que l'application du téléphone les voit, dossier par dossier (règle de `finishInterruptedReplace` du
 * greffon du dossier mémoire, reprise dans `phoneVisibleNames` de `src/library/remoteTemps.ts`) : `nom.tracker-new`
 * (création interrompue) est caché ; `nom.tracker-tmp` à côté de `nom` (remplacement interrompu, l'original intact)
 * est caché ; `nom.tracker-tmp` seul (l'original déjà retiré) est montré sous `nom`. Suffixes en casse exacte, comme
 * sur le téléphone.
 */
export function commeLeTelephone(bruts: readonly FichierTelephone[]): FichierVu[] {
  const parDossier = new Map<string, FichierTelephone[]>()
  for (const f of bruts) {
    const i = f.chemin.lastIndexOf('/')
    const dossier = i < 0 ? '' : f.chemin.slice(0, i + 1)
    parDossier.set(dossier, [...(parDossier.get(dossier) ?? []), f])
  }
  const vus: FichierVu[] = []
  for (const [dossier, fichiers] of parDossier) {
    const noms = new Set(fichiers.map((f) => f.chemin.slice(dossier.length)))
    for (const f of fichiers) {
      const nom = f.chemin.slice(dossier.length)
      if (nom.endsWith(SUFFIXE_NEUF) && nom.length > SUFFIXE_NEUF.length) continue
      if (nom.endsWith(SUFFIXE_REMPLACEMENT) && nom.length > SUFFIXE_REMPLACEMENT.length) {
        const original = nom.slice(0, -SUFFIXE_REMPLACEMENT.length)
        if (noms.has(original)) continue
        noms.add(original)
        vus.push({ ...f, chemin: dossier + original, reel: f.chemin })
        continue
      }
      vus.push({ ...f, reel: f.chemin })
    }
  }
  return vus
}

/** Fichiers admis (`cheminAdmis`), triés par chemin ; un chemin vu deux fois (nom coupé par un retour à la ligne) est écarté. */
export function fichiersAdmis<F extends FichierTelephone>(fichiers: F[]): F[] {
  const vus = new Map<string, number>()
  for (const f of fichiers) vus.set(f.chemin, (vus.get(f.chemin) ?? 0) + 1)
  return fichiers
    .filter((f) => cheminAdmis(f.chemin) && vus.get(f.chemin) === 1 && Number.isSafeInteger(f.taille) && f.taille >= 0 && Number.isFinite(f.dateMs))
    .sort((a, b) => (a.chemin < b.chemin ? -1 : a.chemin > b.chemin ? 1 : 0))
}

/** Le fichier montré, sans le nom réel (ce que la page reçoit). */
export function sansReel({ chemin, taille, dateMs }: FichierVu): FichierTelephone {
  return { chemin, taille, dateMs }
}

/** Erreur rendue quand le téléphone n'est pas prêt pour un listage ou une lecture. */
export function pasPret(etat: EtatTelephone['etat']): ErreurDisque {
  return new ErreurDisque('UNKNOWN', `Le téléphone n'est pas prêt (${etat}).`)
}

/** Erreur rendue quand le dossier mémoire est absent du téléphone. */
export function racineAbsente(nomRacine: string): ErreurDisque {
  return new ErreurDisque('NOT_FOUND', `Le dossier Documents/${nomRacine} est absent du téléphone.`)
}

/** Erreur rendue pour une écriture ou un retrait sans listage préalable. */
export function pasListe(): ErreurDisque {
  return new ErreurDisque('UNKNOWN', "Le téléphone n'a pas été listé.")
}

// ---------- le dossier local, pour les tests et le banc ----------

/** Nom du téléphone d'essai. */
export const NOM_TELEPHONE_ESSAI = "Téléphone d'essai"

export type OptionsDossierLocal = {
  /** État imposé, à la place de celui que donne le dossier. */
  etatImpose?: EtatTelephone | null
  /** Téléphone débranché après ce nombre d'opérations réussies (lectures, écritures, mises de côté). */
  coupureApres?: number | null
  /** Nom de la racine sous `Documents` : `Tracker` par défaut. */
  nomRacine?: string
  /** Vrai : le téléphone d'essai enregistre, toute écriture et tout retrait sont refusés. */
  enregistrement?: boolean
  /** Vrai : après la première écriture réussie, le listage suivant, une seule fois, est partiel. */
  panneListage?: boolean
}

/** Date d'un fichier à la seconde près, comme la donne `stat -c %Y` du téléphone. */
const alaSeconde = (ms: number): number => Math.floor(ms / 1000) * 1000

/** Fichier ordinaire, dossier, autre chose (lien…) ou rien, sans suivre un lien. */
async function sorteDe(absolu: string): Promise<'fichier' | 'dossier' | 'autre' | null> {
  try {
    const s = await lstat(absolu)
    return s.isSymbolicLink() ? 'autre' : s.isFile() ? 'fichier' : s.isDirectory() ? 'dossier' : 'autre'
  } catch (e) {
    if (codeDe(e) === 'NOT_FOUND') return null
    throw e
  }
}

/**
 * Un dossier local qui joue la mémoire partagée du téléphone (`stockage`, son `/sdcard`) : le dossier lu est
 * `stockage/Documents/Tracker`, sa corbeille `stockage/Documents/Tracker-corbeille`. Il liste comme le câble
 * (provisoires vus comme le téléphone les voit), écrit comme lui (`.tracker-new`, taille relue, renommage) et met de
 * côté comme lui (fichier relu, place libre, déplacement) ; il n'efface jamais un fichier du téléphone. Stockage
 * absent : téléphone absent.
 */
export function dossierLocal(stockage: string | null, options: OptionsDossierLocal = {}): DossierDistant {
  const nomRacine = options.nomRacine ?? NOM_RACINE
  const documents = stockage === null ? null : path.join(path.resolve(stockage), 'Documents')
  const racine = documents === null ? null : path.join(documents, nomRacine)
  const corbeille = documents === null ? null : path.join(documents, nomCorbeille(nomRacine))
  const coupure = options.coupureApres ?? null
  let operations = 0
  let debranche = false
  /** Panne de listage d'essai : armée par la première écriture, consommée par le listage suivant. */
  let panne: 'attente' | 'armee' | 'passee' = options.panneListage ? 'attente' : 'passee'
  /** Nom réel de chaque fichier du dernier listage, par chemin montré ; `null` sans listage valable. */
  let reels: Map<string, string> | null = null

  async function etat(): Promise<EtatTelephone> {
    if (debranche) return { etat: 'absent' }
    if (options.etatImpose) return options.etatImpose
    if (stockage === null) return { etat: 'absent' }
    try {
      return (await stat(stockage)).isDirectory() ? { etat: 'pret', nom: NOM_TELEPHONE_ESSAI } : { etat: 'absent' }
    } catch {
      return { etat: 'absent' }
    }
  }

  async function exigerPret(): Promise<{ r: string; c: string }> {
    const e = await etat()
    if (e.etat !== 'pret' || racine === null || corbeille === null) {
      reels = null
      throw pasPret(e.etat)
    }
    return { r: racine, c: corbeille }
  }

  /** Comme une écriture ou un retrait du câble : prêt, listé, et pas d'enregistrement en cours. */
  async function exigerEcriture(): Promise<{ r: string; c: string; vus: Map<string, string> }> {
    const lieux = await exigerPret()
    if (reels === null) throw pasListe()
    if (options.enregistrement) throw enregistrementEnCours()
    return { ...lieux, vus: reels }
  }

  /** Vrai si la coupure d'essai tombe sur cette opération : le téléphone est alors débranché. */
  function coupe(): boolean {
    if (coupure === null || operations < coupure) return false
    debranche = true
    reels = null
    return true
  }

  const debrancheErreur = () => new ErreurDisque('UNKNOWN', 'Le téléphone a été débranché pendant l’opération.')

  /** Fichiers d'un dossier du téléphone d'essai, provisoires compris, à la seconde près comme ceux du débogage USB. */
  async function fichiersDe(dossier: string, prefixe: string): Promise<FichierTelephone[]> {
    const fichiers: FichierTelephone[] = []
    for (const entree of await readdir(dossier, { withFileTypes: true })) {
      if (!entree.isFile()) continue
      const s = await stat(path.join(dossier, entree.name))
      fichiers.push({ chemin: prefixe + entree.name, taille: s.size, dateMs: alaSeconde(s.mtimeMs) })
    }
    return fichiers
  }

  /** Le fichier du téléphone d'essai d'un chemin relatif admis. */
  const absolu = (base: string, relatif: string) => path.join(base, ...relatif.split('/'))

  /** Refuse un sous-dossier qui serait un lien ou un fichier (rien n'est écrit à travers un lien). */
  async function exigerDossier(dossier: string): Promise<void> {
    const sorte = await sorteDe(dossier)
    if (sorte !== null && sorte !== 'dossier') throw new ErreurDisque('PERMISSION', `« ${path.basename(dossier)} » n'est pas un dossier sur le téléphone.`)
  }

  /** Chemins et tailles du dernier `listerTout`. */
  let tous = new Map<string, number>()

  /** Tout le dossier `dossier`, à toute profondeur, sous le préfixe `prefixe`, sans suivre un lien. */
  async function toutDe(dossier: string, prefixe: string): Promise<FichierBrut[]> {
    const trouves: FichierBrut[] = []
    for (const entree of await readdir(dossier, { withFileTypes: true })) {
      const chemin = prefixe + entree.name
      const absoluEntree = path.join(dossier, entree.name)
      const s = await lstat(absoluEntree)
      if (s.isDirectory()) trouves.push(...(await toutDe(absoluEntree, `${chemin}/`)))
      else trouves.push({ chemin, taille: s.size, dateMs: alaSeconde(s.mtimeMs), ordinaire: s.isFile() })
    }
    return trouves
  }

  return {
    etat,

    async listerTout() {
      const { r } = await exigerPret()
      tous = new Map()
      let trouves: FichierBrut[]
      try {
        trouves = await toutDe(r, '')
      } catch (e) {
        if (codeDe(e) === 'NOT_FOUND') throw racineAbsente(nomRacine)
        throw e
      }
      tous = new Map(trouves.map((f) => [f.chemin, f.taille]))
      return trouves.sort((a, b) => (a.chemin < b.chemin ? -1 : a.chemin > b.chemin ? 1 : 0))
    },

    async lireBrut(fichier, fichierLocal) {
      const { r } = await exigerPret()
      if (tous.get(fichier.chemin) !== fichier.taille) throw new ErreurDisque('UNKNOWN', `Fichier absent du dernier listage complet : « ${fichier.chemin.slice(0, 200)} ».`)
      if (coupe()) throw debrancheErreur()
      await copyFile(absolu(r, fichier.chemin), fichierLocal)
      operations++
    },

    async lister() {
      const { r } = await exigerPret()
      reels = null
      if (panne === 'armee') {
        panne = 'passee'
        throw new ErreurDisque('UNKNOWN', "Listage du téléphone incomplet : find: Permission denied (panne d'essai)")
      }
      let fichiers: FichierTelephone[]
      try {
        if (!(await stat(r)).isDirectory()) throw racineAbsente(nomRacine)
        fichiers = await fichiersDe(r, '')
      } catch (e) {
        if (codeDe(e) === 'NOT_FOUND') throw racineAbsente(nomRacine)
        throw e
      }
      for (const sous of DOSSIERS_LISTES) {
        try {
          fichiers.push(...(await fichiersDe(path.join(r, sous), `${sous}/`)))
        } catch (e) {
          if (codeDe(e) !== 'NOT_FOUND') throw e
        }
      }
      const vus = fichiersAdmis(commeLeTelephone(fichiers))
      reels = new Map(vus.map((f) => [f.chemin, f.reel]))
      return vus.map(sansReel)
    },

    async lire(fichier, fichierLocal) {
      const { r } = await exigerPret()
      if (coupe()) throw debrancheErreur()
      if (!cheminAdmis(fichier.chemin)) throw new ErreurDisque('UNKNOWN', 'Chemin refusé.')
      await copyFile(absolu(r, reels?.get(fichier.chemin) ?? fichier.chemin), fichierLocal)
      const date = new Date(fichier.dateMs)
      await utimes(fichierLocal, date, date)
      operations++
    },

    async enregistrement() {
      await exigerPret()
      if (reels === null) throw pasListe()
      return options.enregistrement === true
    },

    async ecrire(chemin, fichierLocal, taille) {
      if (!cheminEcrivable(chemin)) throw cheminRefuse(chemin)
      const { r, vus } = await exigerEcriture()
      const cible = absolu(r, chemin)
      await exigerDossier(path.dirname(cible))
      const sorte = await sorteDe(cible)
      if (sorte !== null && sorte !== 'fichier') throw new ErreurDisque('PERMISSION', `« ${chemin} » n'est pas un fichier sur le téléphone.`)
      const provisoire = nomProvisoire(cible)
      await mkdir(path.dirname(cible), { recursive: true })
      if (coupe()) {
        // Comme un envoi coupé en route : la moitié du fichier sous son nom provisoire, que le téléphone écartera.
        const octets = await readFile(fichierLocal)
        await writeFile(provisoire, octets.subarray(0, Math.floor(octets.length / 2)))
        throw debrancheErreur()
      }
      try {
        await copyFile(fichierLocal, provisoire)
        const s = await stat(provisoire)
        if (s.size !== taille) throw new ErreurDisque('UNKNOWN', `Écriture incomplète de « ${chemin} » : ${s.size} octets sur ${taille}.`)
        await rename(provisoire, cible)
        vus.set(chemin, chemin)
        operations++
        if (panne === 'attente') panne = 'armee'
        return { chemin, taille: s.size, dateMs: alaSeconde(s.mtimeMs) }
      } catch (e) {
        // Seul effacement du téléphone d'essai : le provisoire de cette écriture, jamais un fichier de l'utilisateur.
        await unlink(provisoire).catch(() => undefined)
        throw e
      }
    },

    async mettreDeCote(fichier, vers) {
      const destination = retraitAdmis(fichier.chemin, vers)
      if (destination === null) throw cheminRefuse(`${fichier.chemin} → ${String(vers)}`)
      const { r, c, vus } = await exigerEcriture()
      const reel = vus.get(fichier.chemin)
      if (reel === undefined) throw new ErreurDisque('UNKNOWN', `Fichier absent du dernier listage du téléphone : « ${fichier.chemin} ».`)
      if (coupe()) throw debrancheErreur()
      const source = absolu(r, reel)
      const sorte = await sorteDe(source)
      if (sorte === null) {
        vus.delete(fichier.chemin)
        return
      }
      if (sorte !== 'fichier') throw new ErreurDisque('PERMISSION', `« ${fichier.chemin} » n'est pas un fichier sur le téléphone.`)
      const s = await stat(source)
      if (s.size !== fichier.taille || alaSeconde(s.mtimeMs) !== fichier.dateMs) throw changeDepuisListage(fichier.chemin)
      // Le remplacement interrompu caché à côté part aussi, et d'abord : seul, le téléphone lui rendrait le nom de l'original.
      const cache = reel === fichier.chemin ? source + SUFFIXE_REMPLACEMENT : null
      const avecCache = cache !== null && (await sorteDe(cache)) === 'fichier'
      const cible = absolu(c, destination.relatif)
      for (const d of [c, path.join(c, destination.jour), path.dirname(cible)]) await exigerDossier(d)
      if ((await sorteDe(cible)) !== null || (avecCache && (await sorteDe(cible + SUFFIXE_REMPLACEMENT)) !== null)) throw corbeillePrise(vers)
      await mkdir(path.dirname(cible), { recursive: true })
      if (avecCache && cache !== null) await rename(cache, cible + SUFFIXE_REMPLACEMENT)
      await rename(source, cible)
      vus.delete(fichier.chemin)
      operations++
    },

    async listerCorbeille(dossier) {
      const jour = dossierCorbeilleAdmis(dossier)
      if (jour === null) throw cheminRefuse(dossier)
      const { c } = await exigerPret()
      if (reels === null) throw pasListe()
      const chemins: string[] = []
      for (const sous of DOSSIERS_RETIRABLES) {
        try {
          for (const entree of await readdir(path.join(c, jour, sous), { withFileTypes: true })) {
            if (entree.isFile()) chemins.push(`${CORBEILLE_PAGE}/${jour}/${sous}/${entree.name}`)
          }
        } catch (e) {
          if (codeDe(e) !== 'NOT_FOUND') throw e
        }
      }
      return chemins.sort()
    },
  }
}

// ---------- les canaux de la page ----------

/** Canaux servis ; le pont de la page (`preload.ts`) porte les mêmes noms. Aucun n'efface sur le téléphone. */
export const CANAUX_TELEPHONE = ['etat', 'lister', 'lireOctets', 'enregistrement', 'ecrireOctets', 'listerCorbeille', 'mettreDeCote', 'copieSecurite', 'copieExiste'] as const

/** Nom du dossier temporaire des lectures et des écritures, dans le profil du programme. */
export const DOSSIER_LECTURES = 'telephone-lecture'

/** Taille maximale d'un fichier écrit sur le téléphone, en octets. */
export const TAILLE_ECRITURE_MAX = 256 * 1024 * 1024

/** Efface un fichier, repris si un autre programme le tient un instant ; sans effet s'il n'existe pas. */
async function effacer(absolu: string): Promise<void> {
  try {
    await avecEssais(async () => {
      try {
        await unlink(absolu)
      } catch (e) {
        if (codeDe(e) !== 'NOT_FOUND') throw e
      }
    })
  } catch {
    // Laissé tel quel : le prochain listage ou le prochain démarrage videra le dossier.
  }
}

/**
 * Vide le dossier temporaire des lectures : seuls les fichiers qu'il a reçus (suffixe `.tracker-tmp`) sont effacés,
 * rien d'autre, même si le dossier venait à en porter. Sans effet s'il n'existe pas.
 */
export async function viderLectures(dossierTemp: string): Promise<void> {
  let noms: string[]
  try {
    noms = await readdir(dossierTemp)
  } catch {
    return
  }
  for (const nom of noms) if (nom.toLowerCase().endsWith(SUFFIXE_REMPLACEMENT)) await effacer(path.join(dossierTemp, nom))
}

/** Vrai si `dedans` est `dossier` ou l'un de ses sous-dossiers (casse ignorée, comme sur le disque de Windows). */
function estSous(dedans: string, dossier: string): boolean {
  const relatif = path.relative(path.resolve(dossier).toLowerCase(), path.resolve(dedans).toLowerCase())
  return relatif === '' || (!relatif.startsWith('..') && !path.isAbsolute(relatif))
}

export type OptionsGestionnaires = {
  /** Dossier mémoire retenu, `null` s'il n'y en a pas : le dossier temporaire ne doit jamais s'y trouver. */
  memoire?: () => Promise<string | null>
  /** Dossier des copies de sécurité (`<Documents>Tracker-copies`) ; absent, `telephone:copieSecurite` refuse. */
  copies?: () => Promise<string>
}

/** File qui fait passer les actions une à une, dans l'ordre des appels. */
export type FileTelephone = <T>(action: () => Promise<T>) => Promise<T>

/** Une action à la fois, dans l'ordre des appels : le téléphone ne reçoit jamais deux commandes ensemble. */
export function enSerie(): FileTelephone {
  let queue: Promise<unknown> = Promise.resolve()
  return <T>(action: () => Promise<T>) => {
    const suite = queue.then(action, action)
    queue = suite.catch(() => undefined)
    return suite
  }
}

/** Champs d'un message reçu de la page, `{}` s'il n'est pas un objet. */
function champs(argument: unknown): Record<string, unknown> {
  return typeof argument === 'object' && argument !== null && !Array.isArray(argument) ? (argument as Record<string, unknown>) : {}
}

/**
 * Gestionnaires des canaux `telephone:*`, à brancher par `brancherCanaux` :
 * - `telephone:etat` rend un `EtatTelephone` ; un téléphone qui n'est plus prêt fait oublier le dernier listage ;
 * - `telephone:lister` rend les `FichierTelephone` (`NOT_FOUND` si `Documents/Tracker` est absent), et vide le
 *   dossier temporaire ;
 * - `telephone:lireOctets({ chemin })` rend les octets d'un fichier du dernier listage, et d'aucun autre ; le fichier
 *   temporaire est effacé, réussite ou échec ;
 * - `telephone:enregistrement()` rend vrai si l'application du téléphone enregistre (rien n'est alors écrit) ;
 * - `telephone:ecrireOctets({ chemin, octets })` écrit un fichier de la liste fermée (`cheminEcrivable`) après un
 *   listage réussi, et rend le `FichierTelephone` écrit ; le fichier temporaire est effacé, réussite ou échec ;
 * - `telephone:listerCorbeille({ dossier })` rend les chemins déjà pris dans un jour de la corbeille du téléphone ;
 * - `telephone:mettreDeCote({ chemin, vers })` déplace un fichier du dernier listage (`cheminRetirable`) dans la
 *   corbeille du téléphone, sous `vers` (`retraitAdmis`) ;
 * - `telephone:copieSecurite()` copie le dossier mémoire retenu et ce que liste le téléphone dans un dossier neuf des
 *   copies de sécurité (`copieSecurite.ts`), et rend son chemin absolu ; rien n'est écrit sur le téléphone ;
 * - `telephone:copieExiste({ chemin })` rend vrai si `chemin` est une copie de sécurité encore là, sous le dossier
 *   des copies, et non vide ; tout autre chemin rend faux.
 * Un chemin hors des listes fermées est refusé (`PERMISSION`) avant toute commande au téléphone.
 */
export function gestionnairesTelephone(dossier: DossierDistant, dossierTemp: string, options: OptionsGestionnaires = {}): Record<string, Gestionnaire> {
  const serie = enSerie()
  /** Fichiers du dernier listage réussi, par chemin, suivis des écritures et retraits ; vide après un listage en échec. */
  let dernier = new Map<string, FichierTelephone>()
  /** Vrai après un listage réussi : le téléphone est connu. */
  let liste = false
  let numero = 0

  function oublier(): void {
    dernier = new Map()
    liste = false
  }

  function exigerListe(): void {
    if (!liste) throw pasListe()
  }

  /** Refuse un dossier temporaire placé dans la mémoire (ou qui la contient). */
  async function verifierTemp(): Promise<void> {
    const memoire = options.memoire ? await options.memoire() : null
    if (memoire !== null && (estSous(dossierTemp, memoire) || estSous(memoire, dossierTemp))) {
      throw new ErreurDisque('UNKNOWN', 'Le dossier temporaire des échanges avec le téléphone est dans la mémoire : refusé.')
    }
  }

  return {
    'telephone:etat': () =>
      enReponse(() =>
        serie(async () => {
          try {
            const e = await dossier.etat()
            if (e.etat !== 'pret') oublier()
            return e
          } catch (erreur) {
            oublier()
            throw erreur
          }
        }),
      ),

    'telephone:lister': () =>
      enReponse(() =>
        serie(async () => {
          oublier()
          await verifierTemp()
          await viderLectures(dossierTemp)
          const fichiers = await dossier.lister()
          dernier = new Map(fichiers.map((f) => [f.chemin, f]))
          liste = true
          return fichiers
        }),
      ),

    'telephone:lireOctets': (argument) =>
      enReponse(() =>
        serie(async (): Promise<Uint8Array> => {
          const chemin = champs(argument).chemin
          if (typeof chemin !== 'string') throw new ErreurDisque('UNKNOWN', 'Message mal formé : « chemin » doit être un texte.')
          const fichier = dernier.get(chemin)
          if (!fichier) throw new ErreurDisque('UNKNOWN', `Fichier absent du dernier listage du téléphone : « ${chemin.slice(0, 200)} ».`)
          await mkdir(dossierTemp, { recursive: true })
          const local = path.join(dossierTemp, `${++numero}${SUFFIXE_REMPLACEMENT}`)
          try {
            await dossier.lire(fichier, local)
            const taille = (await stat(local)).size
            if (taille !== fichier.taille) {
              throw new ErreurDisque('UNKNOWN', `Lecture incomplète de « ${chemin} » : ${taille} octets reçus sur ${fichier.taille}.`)
            }
            return await readFile(local)
          } finally {
            await effacer(local)
          }
        }),
      ),

    'telephone:enregistrement': () =>
      enReponse(() =>
        serie(async (): Promise<boolean> => {
          exigerListe()
          return dossier.enregistrement()
        }),
      ),

    'telephone:ecrireOctets': (argument) =>
      enReponse(() =>
        serie(async (): Promise<FichierTelephone> => {
          const a = champs(argument)
          const chemin = a.chemin
          if (typeof chemin !== 'string') throw new ErreurDisque('UNKNOWN', 'Message mal formé : « chemin » doit être un texte.')
          if (!cheminEcrivable(chemin)) throw cheminRefuse(chemin)
          const octets = a.octets
          if (!estOctets(octets)) throw new ErreurDisque('UNKNOWN', 'Message mal formé : « octets » doit être un Uint8Array.')
          if (octets.byteLength > TAILLE_ECRITURE_MAX) throw new ErreurDisque('UNKNOWN', `Fichier trop gros pour le téléphone : « ${chemin} ».`)
          exigerListe()
          await verifierTemp()
          await mkdir(dossierTemp, { recursive: true })
          const local = path.join(dossierTemp, `${++numero}${SUFFIXE_REMPLACEMENT}`)
          try {
            const poignee = await open(local, 'w')
            try {
              await poignee.writeFile(octets)
              await poignee.sync()
            } finally {
              await poignee.close()
            }
            const ecrit = await dossier.ecrire(chemin, local, octets.byteLength)
            dernier.set(chemin, ecrit)
            return ecrit
          } finally {
            await effacer(local)
          }
        }),
      ),

    'telephone:listerCorbeille': (argument) =>
      enReponse(() =>
        serie(async (): Promise<string[]> => {
          const d = champs(argument).dossier
          if (dossierCorbeilleAdmis(d) === null) throw cheminRefuse(d)
          exigerListe()
          return dossier.listerCorbeille(d as string)
        }),
      ),

    'telephone:mettreDeCote': (argument) =>
      enReponse(() =>
        serie(async (): Promise<null> => {
          const { chemin, vers } = champs(argument)
          if (retraitAdmis(chemin, vers) === null) throw cheminRefuse(typeof chemin === 'string' ? chemin : vers)
          exigerListe()
          const fichier = dernier.get(chemin as string)
          if (!fichier) throw new ErreurDisque('UNKNOWN', `Fichier absent du dernier listage du téléphone : « ${String(chemin).slice(0, 200)} ».`)
          await dossier.mettreDeCote(fichier, vers as string)
          dernier.delete(fichier.chemin)
          return null
        }),
      ),

    'telephone:copieSecurite': () =>
      enReponse(() =>
        serie(async (): Promise<string> => {
          const memoire = options.memoire ? await options.memoire() : null
          if (memoire === null) throw new ErreurDisque('UNKNOWN', 'Aucun dossier mémoire retenu : pas de copie de sécurité.')
          if (!options.copies) throw new ErreurDisque('UNKNOWN', 'Ce programme ne sait pas où ranger les copies de sécurité.')
          // La copie relit le téléphone : le dernier listage de la page change avec lui.
          const dossierCopie = await copieSecurite({ memoire, telephone: dossier, copies: await options.copies() })
          dernier = new Map((await dossier.lister()).map((f) => [f.chemin, f]))
          liste = true
          return dossierCopie
        }),
      ),

    'telephone:copieExiste': (argument) =>
      enReponse(async (): Promise<boolean> => {
        const chemin = champs(argument).chemin
        if (typeof chemin !== 'string' || !options.copies) return false
        return copieValable(chemin, await options.copies())
      }),
  }
}

// ---------- choix du téléphone d'après l'environnement ----------

/** Le téléphone à lire : le vrai, par le débogage USB, sur une racine ; ou le dossier local du mode d'essai. */
export type ChoixTelephone =
  | { canal: 'adb'; nomRacine: string }
  | { canal: 'local'; stockage: string | null; etatImpose: EtatTelephone | null; coupureApres: number | null; nomRacine: string; enregistrement: boolean; panneListage?: boolean }

/**
 * Le téléphone que la coquille lit et écrit, d'après l'environnement. Hors du mode d'essai (`TRACKER_BANC=1`), aucune
 * variable n'est lue : le vrai téléphone, sur `Documents/Tracker`. En mode d'essai :
 * - `TRACKER_BANC_RACINE_TELEPHONE` illisible (hors de `RACINE_ESSAI`) : téléphone absent, jamais le vrai dossier ;
 * - `TRACKER_BANC_TELEPHONE` posé : ce dossier local joue le téléphone (état imposé, coupure et enregistrement lus),
 *   sur la racine déplacée si elle est donnée ;
 * - sinon, `TRACKER_BANC_RACINE_TELEPHONE` posé : le vrai téléphone, sur la racine déplacée seulement ;
 * - sinon : téléphone absent (le mode d'essai ne touche jamais le vrai `Documents/Tracker`).
 * `dossierAdb` est l'endroit donné par l'état `adbIntrouvable` imposé.
 */
export function telephoneDepuisEnvironnement(
  env: Record<string, string | undefined>,
  dossierAdb: string,
  journal: (message: string) => void = () => undefined,
): ChoixTelephone {
  if (env.TRACKER_BANC !== '1') return { canal: 'adb', nomRacine: NOM_RACINE }
  const absent = (nomRacine: string): ChoixTelephone => ({ canal: 'local', stockage: null, etatImpose: null, coupureApres: null, nomRacine, enregistrement: false })
  const racineBrute = env.TRACKER_BANC_RACINE_TELEPHONE?.trim() ?? ''
  if (racineBrute !== '' && !RACINE_ESSAI.test(racineBrute)) {
    journal(`racine du téléphone d'essai refusée : ${racineBrute.slice(0, 60)} ; téléphone absent`)
    return absent(NOM_RACINE)
  }
  const nomRacine = racineBrute === '' ? NOM_RACINE : racineBrute
  const stockage = env.TRACKER_BANC_TELEPHONE?.trim() ? path.resolve(env.TRACKER_BANC_TELEPHONE) : null
  if (stockage === null && racineBrute !== '') {
    journal(`vrai téléphone, racine d'essai : Documents/${nomRacine}`)
    return { canal: 'adb', nomRacine }
  }
  const nom = env.TRACKER_BANC_TELEPHONE_ETAT?.trim() ?? ''
  let etatImpose: EtatTelephone | null = null
  if (nom === 'pret') etatImpose = { etat: 'pret', nom: NOM_TELEPHONE_ESSAI }
  else if (nom === 'adbIntrouvable') etatImpose = { etat: 'adbIntrouvable', dossier: dossierAdb }
  else if (nom === 'plusieurs') etatImpose = { etat: 'plusieurs', nombre: 2 }
  else if (nom === 'absent' || nom === 'autorisation' || nom === 'horsLigne' || nom === 'occupe') etatImpose = { etat: nom }
  else if (nom !== '') journal(`état du téléphone d'essai inconnu, ignoré : ${nom}`)
  const brut = env.TRACKER_BANC_TELEPHONE_COUPURE?.trim() ?? ''
  const coupureApres = /^\d+$/.test(brut) ? Number(brut) : null
  if (brut !== '' && coupureApres === null) journal(`coupure du téléphone d'essai illisible, ignorée : ${brut}`)
  const enregistrement = env.TRACKER_BANC_TELEPHONE_ENREGISTREMENT?.trim() === '1'
  const panneListage = env.TRACKER_BANC_TELEPHONE_PANNE?.trim() === 'listage' ? true : undefined
  journal(
    `téléphone d'essai : ${stockage ?? 'aucun'}${etatImpose ? `, état ${etatImpose.etat}` : ''}${coupureApres !== null ? `, coupure après ${coupureApres}` : ''}${enregistrement ? ', enregistrement en cours' : ''}, racine Documents/${nomRacine}`,
  )
  return { canal: 'local', stockage, etatImpose, coupureApres, nomRacine, enregistrement, panneListage }
}
