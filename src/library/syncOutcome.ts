import type { SyncRefusal, SyncSideName } from './syncBase';
import type { SyncExtraCopy, SyncExtraLeft, SyncExtraOp, SyncExtrasPlan } from './syncExtras';
import type { SyncFirstReason, SyncItem, SyncPlan } from './syncPlan';
import type { RouteSyncItem, RouteSyncPlan } from './syncRoutes';

/**
 * Ce qu'a fait une synchronisation des sessions entre l'ordinateur et le téléphone, tel que l'exécutant le rend
 * (`hooks/sessionLibrary/sync.ts`) et que le compte rendu le lit (`syncReport.ts`). Types seulement, et le résultat
 * vide d'une synchronisation qui n'a rien fait.
 */

/**
 * Pourquoi rien n'a été fait : refus des marqueurs, base d'une version plus récente, mémoire de l'ordinateur sans
 * corbeille (`noTrash`) ou dont la corbeille ne se lit pas (`trashLocked`), mémoire non prête (`memory`), import ou
 * synchronisation déjà en cours (`busy`), copie de sécurité impossible avant la première synchronisation d'un
 * téléphone (`safetyCopy`, sa raison dans `SyncOutcome.error`), téléphone qui enregistre une session (`phoneRecording`).
 */
export type SyncStop = SyncRefusal | 'newerBase' | 'noTrash' | 'trashLocked' | 'memory' | 'busy' | 'safetyCopy' | 'phoneRecording';

export interface SyncFailure {
  item: SyncItem;
  detail: string;
}

/** Ce qu'est devenu chaque fichier de réglages, de FC repos et chaque journal. */
export interface SyncExtrasOutcome {
  /** Écritures faites : fichier de réglages recopié, ou fonte écrite d'un côté. */
  done: SyncExtraOp[];
  /** Journaux copiés du téléphone vers l'ordinateur. */
  copied: SyncExtraCopy[];
  /** Fichiers laissés, et pourquoi (règles du plan, changé depuis sa lecture, erreur sur l'ordinateur). */
  left: SyncExtraLeft[];
  /** Écritures vers un téléphone qu'on ne peut pas écrire : elles restent à faire. */
  withheld: SyncExtraOp[];
}

/** Ce qu'est devenu chaque itinéraire (`itineraires/`), sur le modèle des sessions. */
export interface SyncRoutesOutcome {
  /**
   * Vrai si les itinéraires n'ont pas été touchés parce que le téléphone ne liste pas `itineraires/` (téléphone ou
   * coquille plus anciens) : ils attendent le câble ou la mise à jour.
   */
  waiting: boolean;
  /** Le plan des itinéraires exécuté, restrictions comprises ; `null` s'il n'a pas été fait. */
  plan: RouteSyncPlan | null;
  /** Itinéraires dont une suppression que cette passe pouvait faire ne l'a pas été (écartée, ou à confirmer). */
  withheldDeletions: RouteSyncItem[];
  /** Itinéraires dont une écriture ou un retrait sur le téléphone attend un téléphone qu'on peut écrire. */
  withheldForPhone: RouteSyncItem[];
  /** Itinéraires dont toutes les opérations ont été faites. */
  done: RouteSyncItem[];
  /** Laissés pour la fois suivante : un fichier n'était plus celui du plan. */
  skipped: RouteSyncItem[];
  /** Arrêtés par une erreur sur l'ordinateur, avec son texte. */
  failed: { item: RouteSyncItem; detail: string }[];
}

export interface SyncUnknownActivity {
  /** L'appareil qui a reçu la fiche, et qui ne connaît pas son activité. */
  side: SyncSideName;
  startMs: number;
  activityId: string;
}

/**
 * Ce qu'une réponse « Tout garder » ou « Les garder » a réglé à cette passe : les sessions (leur instant de départ) et
 * les itinéraires (leur identité) qui étaient encore dans le cas montré par la question. `fromTrash` : ceux d'entre
 * eux sortis de la corbeille de l'ordinateur ; les autres reviennent par une copie depuis l'appareil qui les tient
 * encore, dans le plan (ou attendent un téléphone qu'on peut écrire).
 */
export interface SyncKeptOutcome {
  sessions: number[];
  routes: string[];
  fromTrash: { sessions: number[]; routes: string[] };
}

/**
 * Noms montrés de ce dont parle l'issue : chaque session du plan entier et des réponses (`kept`), par instant de
 * départ, telle que l'appelant la nomme (`SyncOptions.shownName`) ; chaque itinéraire par son identité, sous la base
 * de ses fichiers. Pris avant les écritures : une session supprimée garde le nom qu'elle avait.
 */
export interface SyncNames {
  sessions: Record<number, string>;
  routes: Record<string, string>;
}

/** Ce qu'a fait une synchronisation, pour son compte rendu. */
export interface SyncOutcome {
  /** Vrai pour un passage à blanc (`SyncOptions.dryRun`) : rien n'a été écrit, `plan` est le plan entier permis. */
  preview: boolean;
  /** Plan des fichiers d'à côté, rendu par un passage à blanc ; `null` sinon. */
  extrasPlan: SyncExtrasPlan | null;
  /** Rien n'a été fait, et pourquoi ; `null` : la synchronisation a eu lieu (même coupée). */
  refusal: SyncStop | null;
  /** Vrai si la précédente avait été coupée (témoin trouvé au départ). */
  interrupted: boolean;
  /** Première rencontre des deux dossiers, et pourquoi : rien n'a été supprimé. */
  first: SyncFirstReason | null;
  /** Où la copie de sécurité faite avant la première synchronisation a été rangée ; `null` : pas de copie cette fois. */
  safetyCopy: string | null;
  /** Le plan exécuté, restrictions comprises ; `null` si rien n'a été fait. */
  plan: SyncPlan | null;
  /**
   * Sort des suppressions du plan : `made`, permises (faites, sauf session laissée) ; `excluded`, écartées à la demande
   * (« sans rien supprimer ») ; `awaitingConfirmation`, retenues par le garde-fou, à confirmer (`confirmDeletions`).
   */
  deletions: 'made' | 'excluded' | 'awaitingConfirmation';
  /**
   * Sessions dont une suppression que cette passe pouvait faire ne l'a pas été : écartée (« sans rien supprimer ») ou
   * en attente de confirmation. Elles restent à faire. Le retrait d'un téléphone qu'on ne peut pas écrire n'y est pas :
   * il attend le câble (`withheldForPhone`), et le garde-fou ne le compte pas.
   */
  withheldDeletions: SyncItem[];
  /**
   * Sessions dont une écriture ou un retrait sur le téléphone n'a pas été fait parce que le téléphone ne s'écrivait
   * pas (coquille trop ancienne pour écrire) : elles attendent. Prises dans le plan entier,
   * avant restriction.
   */
  withheldForPhone: SyncItem[];
  /** Vrai si le téléphone a pu être écrit ; faux : seule la moitié de l'ordinateur a été faite. */
  phoneWritable: boolean;
  /** Vrai si un fichier du téléphone a été écrit ou mis de côté : il faut y toucher « Mettre à jour » pour le voir. */
  phoneChanged: boolean;
  /** Vrai si un enregistrement a commencé sur le téléphone en route : tout s'est arrêté là, proprement. */
  recordingStarted: boolean;
  /** Sessions dont toutes les opérations ont été faites. */
  done: SyncItem[];
  /** Sessions laissées pour la fois suivante : un fichier n'était plus celui du plan. */
  skipped: SyncItem[];
  /**
   * Sessions et itinéraires dont une opération a été écartée par la restriction du plan (retrait non permis, restes
   * d'une session déjà supprimée, téléphone en lecture seule), brouillons mis à part : ils restent à faire.
   */
  cut: number;
  /**
   * Sessions supprimées sur le téléphone que l'ordinateur n'a pas mises à sa corbeille parce qu'elles y portent un
   * brouillon non enregistré : leur suppression attend (`SyncOptions.hasUnsavedDraft`).
   */
  drafted: SyncItem[];
  /** Sessions arrêtées par une erreur sur l'ordinateur, avec son texte. */
  failed: SyncFailure[];
  /** Identités dont une copie du téléphone a été rangée à la corbeille avant d'en être retirée. */
  keptFromPhone: number[];
  /** Suppressions refusées et sessions de la corbeille gardées, réglées à cette passe. */
  kept: SyncKeptOutcome;
  /** Noms montrés des sessions et des itinéraires dont parle l'issue. */
  names: SyncNames;
  /** Texte de l'erreur du dossier distant qui a tout arrêté (liaison perdue) ; `null` sinon. */
  linkLost: string | null;
  /** Texte d'une autre erreur qui a tout arrêté avant ou après les sessions, ou raison du refus `safetyCopy` ; `null` sinon. */
  error: string | null;
  /** Fichiers de réglages, tests de FC repos et journaux. */
  extras: SyncExtrasOutcome;
  /** Itinéraires. */
  routes: SyncRoutesOutcome;
  /**
   * Sessions reçues par un appareil qui ne connaît pas leur activité (`SyncOptions.knownActivities`) : de quoi lui
   * conseiller de reprendre les réglages de l'autre.
   */
  unknownActivities: SyncUnknownActivity[];
  /**
   * Vrai si tout le plan a été fait, sans restriction ni session ou itinéraire laissé, et sans fichier de réglages, de FC repos ou
   * journal arrêté par une erreur ou changé pendant la synchronisation : la base porte la date de cette fin.
   */
  complete: boolean;
}

/** Résultat d'une synchronisation qui n'a rien fait, pour la raison `refusal` (`null` : point de départ de l'exécutant). */
export const emptySyncOutcome = (refusal: SyncStop | null): SyncOutcome => ({
  preview: false, extrasPlan: null, refusal, interrupted: false, first: null, safetyCopy: null, plan: null, deletions: 'made', withheldDeletions: [], withheldForPhone: [],
  phoneWritable: false, phoneChanged: false, recordingStarted: false, done: [], skipped: [], cut: 0, drafted: [], failed: [], keptFromPhone: [],
  kept: { sessions: [], routes: [], fromTrash: { sessions: [], routes: [] } }, names: { sessions: {}, routes: {} },
  extras: { done: [], copied: [], left: [], withheld: [] }, unknownActivities: [],
  routes: { waiting: false, plan: null, withheldDeletions: [], withheldForPhone: [], done: [], skipped: [], failed: [] },
  linkLost: null, error: null, complete: false,
});
