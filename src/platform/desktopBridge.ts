/**
 * Pont vers le programme Windows (la coquille du dossier `bureau/`), seul fichier qui lit `window.trackerBureau`.
 * Dans un navigateur et sur le téléphone, ce pont n'existe pas : `desktopBridge()` rend `null` et rien de ce qui en
 * dépend ne s'exécute.
 *
 * La coquille lit et écrit le dossier mémoire pour la page. Chaque fonction rend une promesse de
 * `{ ok: true, valeur }` ou `{ ok: false, code, message }` et ne rejette pas pour une erreur du disque. Les chemins
 * de fichier sont relatifs à une racine : `memoire` (le dossier retenu) ou `candidat` (le dossier proposé ou choisi,
 * en lecture seule jusqu'à son adoption) ; la page ne donne jamais de chemin absolu.
 *
 * Les types sont décrits ici, à la main : ceux de la coquille emploient les types de Node, que l'application n'a pas.
 * La tâche à attendre avant de fermer la fenêtre s'y pose aussi (`onDesktopClose`, lot 232). Le téléphone branché
 * par câble s'y lit, s'y écrit et s'y met de côté, jamais effacé (`telephone`, élément 217) : `phoneCable.ts`.
 */

/** Code d'une erreur du pont, lisible par `fileErrorCode`. */
export type BridgeErrorCode = 'NOT_FOUND' | 'PERMISSION' | 'NO_SPACE' | 'UNKNOWN';

export type BridgeAnswer<T> = { ok: true; valeur: T } | { ok: false; code: BridgeErrorCode; message: string };

/** Racine d'un chemin de fichier : le dossier retenu, ou le dossier proposé ou choisi (lecture seule). */
export type DesktopRoot = 'memoire' | 'candidat';

/** Le dossier retenu, au lancement. */
export type DesktopOpening =
  /** Aucun dossier retenu : premier lancement, ou dossier oublié. */
  | { etat: 'aucun' }
  /** Le dossier retenu s'ouvre, ou n'existe plus (il n'est jamais recréé). */
  | { etat: 'pret' | 'introuvable'; chemin: string; oneDrive: boolean }
  /** Le dossier retenu ne se lit pas ; `chemin` vaut `null` quand c'est le réglage du programme qui ne se lit pas. */
  | { etat: 'illisible'; chemin: string | null; oneDrive: boolean; code: BridgeErrorCode; detail: string };

/** Dossier proposé au premier lancement (il peut ne pas exister encore). */
export interface DesktopProposal {
  chemin: string;
  /** Vrai si le dossier proposé est lui-même dans OneDrive. */
  oneDrive: boolean;
  /** Vrai si Documents est dans OneDrive, d'où un dossier proposé hors de Documents. */
  documentsOneDrive: boolean;
}

/** Dossier désigné dans la fenêtre de Windows. */
export interface DesktopChoice {
  chemin: string;
  /** Son nom (le chemin entier pour la racine d'un disque). */
  nom: string;
  /** Noms de ce qu'il contient. */
  noms: string[];
  oneDrive: boolean;
}

export interface DesktopAdoption {
  chemin: string;
  oneDrive: boolean;
}

export interface DesktopEntry {
  name: string;
  kind: 'file' | 'directory';
  size: number;
  mtimeMs: number;
}

export interface DesktopFileTarget {
  racine: DesktopRoot;
  chemin: string;
}

export interface DesktopMemoryBridge {
  ouvrir(): Promise<BridgeAnswer<DesktopOpening>>;
  /** Pose le dossier proposé comme candidat. */
  proposer(): Promise<BridgeAnswer<DesktopProposal>>;
  /** Fenêtre de Windows ; `null` si l'utilisateur renonce. Pose le dossier choisi comme candidat. */
  choisir(argument?: { titre?: string; documents?: boolean }): Promise<BridgeAnswer<DesktopChoice | null>>;
  /** Retient le candidat (ou son sous-dossier `Tracker`), en le créant s'il manque. */
  adopter(argument?: { descendre?: boolean }): Promise<BridgeAnswer<DesktopAdoption>>;
  oublier(): Promise<BridgeAnswer<null>>;
  lister(argument: DesktopFileTarget): Promise<BridgeAnswer<DesktopEntry[]>>;
  lireTexte(argument: DesktopFileTarget): Promise<BridgeAnswer<string | null>>;
  lireOctets(argument: DesktopFileTarget): Promise<BridgeAnswer<Uint8Array | null>>;
  stat(argument: DesktopFileTarget): Promise<BridgeAnswer<{ size: number; mtimeMs: number } | null>>;
  ecrireTexte(argument: DesktopFileTarget & { texte: string }): Promise<BridgeAnswer<null>>;
  ecrireOctets(argument: DesktopFileTarget & { octets: Uint8Array }): Promise<BridgeAnswer<null>>;
  effacer(argument: DesktopFileTarget): Promise<BridgeAnswer<null>>;
  /** Efface un sous-dossier vide ; refusé s'il contient encore quelque chose. Absent d'une coquille plus ancienne. */
  effacerDossier?(argument: DesktopFileTarget): Promise<BridgeAnswer<null>>;
}

/** État du téléphone branché par câble, lu par la coquille. */
export type DesktopPhoneState =
  /** Un téléphone prêt à être lu ; `nom` est son modèle. */
  | { etat: 'pret'; nom: string }
  /** Rien de branché, ou rien de vu. */
  | { etat: 'absent' }
  /** Le téléphone attend que l'utilisateur accepte cet ordinateur. */
  | { etat: 'autorisation' }
  /** Le téléphone est vu mais ne répond pas. */
  | { etat: 'horsLigne' }
  /** L'outil du débogage USB n'est pas sur le poste ; `dossier` est celui où copier son dossier `platform-tools`. */
  | { etat: 'adbIntrouvable'; dossier: string }
  /** Un autre programme tient la liaison avec le téléphone. */
  | { etat: 'occupe' }
  /** Plusieurs appareils sont branchés : refusé. */
  | { etat: 'plusieurs'; nombre: number };

/**
 * Fichier du téléphone : chemin relatif à `Documents/Tracker` (racine, `sessions/`, `itineraires/`, `reglages/`,
 * `journaux/`), taille en octets, date à la seconde.
 */
export interface DesktopPhoneFile {
  chemin: string;
  taille: number;
  dateMs: number;
}

/**
 * Le dossier `Documents/Tracker` du téléphone branché. La lecture est là depuis le lot 2 ; l'écriture et la mise de
 * côté (élément 217, sous-lot 3c) manquent à une coquille plus ancienne. Rien n'y efface un fichier : un retrait est
 * un déplacement dans un dépôt de la corbeille de la mémoire du téléphone (`corbeille/<dépôt>/`, lot 242-1).
 */
export interface DesktopPhoneBridge {
  etat(): Promise<BridgeAnswer<DesktopPhoneState>>;
  /** `NOT_FOUND` si le dossier est absent du téléphone ; `UNKNOWN` si le téléphone n'est pas prêt ou s'est perdu. */
  lister(): Promise<BridgeAnswer<DesktopPhoneFile[]>>;
  /** Octets d'un fichier rendu par le dernier `lister` seulement ; `UNKNOWN` pour tout échec. */
  lireOctets(argument: { chemin: string }): Promise<BridgeAnswer<Uint8Array>>;
  /** Vrai si l'application du téléphone enregistre (rien n'y est alors écrit) ; après un `lister`. */
  enregistrement?(): Promise<BridgeAnswer<boolean>>;
  /**
   * Écrit un fichier de la liste fermée de la coquille (`sessions/`, `itineraires/`, `reglages/`, `tracker.json`,
   * `fc-repos.json`, et le seul `corbeille/<dépôt>/depose.json`, jamais par-dessus un autre) après un `lister`, et rend
   * le fichier tel qu'il est sur le téléphone ; `PERMISSION` hors liste ou pendant un enregistrement.
   */
  ecrireOctets?(argument: { chemin: string; octets: Uint8Array }): Promise<BridgeAnswer<DesktopPhoneFile>>;
  /** Noms des sous-dossiers de la corbeille du téléphone (`dossier` : `corbeille`, seule valeur admise). */
  listerCorbeille?(argument: { dossier: string }): Promise<BridgeAnswer<string[]>>;
  /**
   * Déplace un fichier du dernier `lister` (`sessions/` ou `itineraires/`) dans un dépôt de la corbeille du téléphone,
   * sous `vers` (`corbeille/<dépôt>/<même nom>`), sans jamais écraser ; refusé si le dépôt ne tient pas `depose.json`,
   * si le fichier a changé depuis le listage, ou pendant un enregistrement.
   */
  mettreDeCote?(argument: { chemin: string; vers: string }): Promise<BridgeAnswer<null>>;
  /**
   * Copie de sécurité des deux dossiers (la mémoire retenue de l'ordinateur et ce que liste le téléphone) dans un
   * dossier neuf de `<Documents>Tracker-copies`, avant la première synchronisation d'un téléphone ; rend son chemin.
   */
  copieSecurite?(): Promise<BridgeAnswer<string>>;
  /** Vrai si ce chemin est une copie de sécurité encore là, sous le dossier des copies, et non vide. */
  copieExiste?(argument: { chemin: string }): Promise<BridgeAnswer<boolean>>;
}

export interface DesktopBridge {
  version: string;
  memoire: DesktopMemoryBridge;
  /** Le téléphone branché ; absent d'une coquille plus ancienne, qui ne le lit pas. */
  telephone?: DesktopPhoneBridge;
  /**
   * Pose la tâche que la coquille attend avant de fermer sa fenêtre (écritures en attente), échec compris ; elle ferme
   * de toute façon après son propre plafond. Absent d'une coquille plus ancienne.
   */
  surFermeture?(rappel: () => Promise<void>): void;
}

/** Le pont du programme Windows, `null` ailleurs (navigateur, téléphone). */
export const desktopBridge = (): DesktopBridge | null => {
  if (typeof window === 'undefined') return null;
  const bridge = (window as unknown as { trackerBureau?: Partial<DesktopBridge> }).trackerBureau;
  return typeof bridge === 'object' && bridge !== null && typeof bridge.memoire?.ouvrir === 'function'
    ? (bridge as DesktopBridge)
    : null;
};


/**
 * Programme Windows : `task` (écritures en attente) est attendue avant que la fenêtre se ferme par sa croix. Sans
 * effet ailleurs et dans une coquille plus ancienne, qui ferme sans attendre. Un appel au démarrage suffit.
 */
export const onDesktopClose = (task: () => Promise<void>): void => {
  const bridge = desktopBridge();
  if (typeof bridge?.surFermeture !== 'function') return;
  try {
    bridge.surFermeture(() => task().catch(() => undefined));
  } catch {
    // Pont refermé : la fenêtre se ferme sans attendre, comme avec une coquille plus ancienne.
  }
};
