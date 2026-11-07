import type { LibrarySession } from '../../library/record';
import type { SettingsFileInfo } from '../../library/settingsFile';
import type { MemoryKind } from '../../platform/memoryFolder';
import { createListeners } from '../createStore';

/**
 * État publié de la bibliothèque des sessions (lot 113) : ce que les pages lisent (`useSessionLibrary`), ses
 * abonnés et ses messages. Première couche : n'importe aucune autre partie de `hooks/sessionLibrary/`.
 */

export type LibraryStatus = 'opening' | 'ready' | 'needs-permission' | 'unavailable';

/** Résultat d'un fichier reçu d'une autre application (`incoming`), dit par un bandeau jusqu'à ce qu'on le ferme. */
export interface IncomingNotice {
  id: string;
  text: string;
  /** Session à ouvrir (« Voir la session »), rangée ou déjà présente. */
  file: string | null;
  /** Itinéraire rangé (lot 194), à ouvrir dans la planification (« Voir l'itinéraire ») : nom de ses fichiers. */
  route?: string;
  /** Rien n'a été rangé. */
  trouble: boolean;
}

export interface LibraryState {
  status: LibraryStatus;
  folderKind: MemoryKind | null;
  /** Où se trouve la mémoire, en clair. */
  folderLabel: string | null;
  /** Dossier d'une disposition plus récente (marqueur) : lu, et rien n'y est écrit (`readOnlyFolder`). */
  memoryReadOnly: boolean;
  /** Pourquoi aucune mémoire n'est accessible, en clair. */
  reason: string | null;
  /** Sessions, une par identité, de la plus récente à la plus ancienne. */
  sessions: LibrarySession[];
  /**
   * Fiches en cours de création ou de recalcul ; `creating` : parmi elles, les GPX sans fiche
   * (fiches à créer), seuls dits « Lecture des traces sans fiche ».
   */
  scanning: { done: number; total: number; creating: { done: number; total: number } } | null;
  /** Sessions dont le résumé reste à refaire dans le passage en cours (version du calcul ou réglages changés). */
  toUpdate: number;
  /** Fichiers d'une session déjà présente sous un autre nom, ignorés. */
  duplicates: string[];
  /** GPX qu'on n'a pas su lire. */
  unreadable: string[];
  /** GPX et fiches trop gros pour être lus (`MAX_LISTED_FILE_BYTES`), laissés en place. */
  tooLarge: string[];
  /** Sessions enregistrées qui attendent un dossier mémoire (téléphone). */
  pendingCount: number;
  /** Nom de cet appareil, celui de son fichier de réglages. */
  deviceName: string;
  /** Fichiers de réglages du dossier (`reglages/`), celui de l'appareil en tête. */
  settingsFiles: SettingsFileInfo[];
  /** Fichier de réglages d'un autre appareil apparu dans le dossier, jamais vu par celui-ci : proposé une fois. */
  settingsOffer: SettingsFileInfo | null;
  /** Relecture du dossier en cours (« Mettre à jour »). */
  refreshing: boolean;
  /** Import en cours (GPX ou dossier), d'où qu'il parte. */
  importing: boolean;
  /** Question posée avant d'importer un dossier : son nombre d'activités de montre (`answerImportQuestion`). */
  importQuestion: { watchActivities: number } | null;
  /** Résultats des fichiers reçus d'une autre application, à dire. */
  incomingNotices: IncomingNotice[];
  /** Incrémenté à chaque relecture du dossier : les listes tenues ailleurs (itinéraires) se relisent. */
  revision: number;
  /** Compte rendu de la dernière action (import, copie, relecture). */
  message: string | null;
  error: string | null;
}

const INITIAL_STATE: LibraryState = {
  status: 'opening',
  folderKind: null,
  folderLabel: null,
  memoryReadOnly: false,
  reason: null,
  sessions: [],
  scanning: null,
  toUpdate: 0,
  duplicates: [],
  unreadable: [],
  tooLarge: [],
  pendingCount: 0,
  deviceName: '',
  settingsFiles: [],
  settingsOffer: null,
  refreshing: false,
  importing: false,
  importQuestion: null,
  incomingNotices: [],
  revision: 0,
  message: null,
  error: null,
};

let state = INITIAL_STATE;

const listeners = createListeners();

/** État publié, lu par les autres parties de la bibliothèque. */
export const libraryState = (): LibraryState => state;

export const setState = (patch: Partial<LibraryState>): void => {
  state = { ...state, ...patch };
  listeners.notify();
};

export const subscribe = listeners.subscribe;

/** Phrase terminée par un point, pour en mettre plusieurs à la suite. */
export const sentence = (text: string): string => (/[.!?…]$/.test(text) ? text : `${text}.`);

/**
 * Ajoute une erreur à celles déjà affichées, sans la répéter : plusieurs
 * peuvent survenir à l'ouverture d'un dossier sans que l'une cache l'autre.
 */
export const reportError = (text: string): void => {
  const message = sentence(text);
  if (state.error?.includes(message)) return;
  setState({ error: state.error ? `${sentence(state.error)} ${message}` : message });
};

/** Erreur du démarrage de l'application (hors de la mémoire), dite dans le même bandeau. */
export const reportStartupError = (text: string): void => reportError(text);

/** Laisse l'interface respirer entre deux traces lourdes. */
export const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export const dismissLibraryMessage = (): void => setState({ message: null, error: null });

/** Ferme le bandeau d'un fichier reçu d'une autre application. */
export const dismissIncomingNotice = (id: string): void =>
  setState({ incomingNotices: state.incomingNotices.filter((notice) => notice.id !== id) });

/** Ferme la proposition d'un nouveau fichier de réglages ; il reste dans la liste de Réglages › Mémoire. */
export const dismissSettingsOffer = (): void => setState({ settingsOffer: null });

/** État de la bibliothèque, lu hors d'un composant. */
export const readLibraryState = (): LibraryState => state;
