import { readMarkerSync } from './syncBase';

/**
 * Guet du marqueur de la mémoire : l'ordinateur qui a changé les sessions du téléphone par une synchronisation pose
 * l'instant dans son marqueur (`markerTextWithSync`). L'application relit ce seul petit fichier au retour au premier
 * plan, et à rythme lent tant qu'elle reste à l'écran (`pollWhileVisible`), et relit sa mémoire (`refreshLibrary`)
 * quand l'instant a changé depuis sa dernière lecture, une fois.
 *
 * - La première lecture d'un dossier ne fait que se retenir : son ouverture vient de tout lire.
 * - Un marqueur sans instant, ou qui ne se lit pas, ne dit rien : l'instant retenu reste le même.
 * - Deux retours rapprochés ne lisent pas deux fois en même temps.
 */
export interface SyncMarkerWatch {
  /** Retient l'instant que porte le marqueur de ce dossier (`folderKey`), lu à l'ouverture ou à une relecture voulue. */
  note(folderKey: string, markerText: string | null): void;
  /** Relit le marqueur ; rend vrai si la relecture de la mémoire a été lancée. */
  check(folderKey: string, read: () => Promise<string | null>): Promise<boolean>;
}

/**
 * Rythme de relecture du marqueur tant que l'application est à l'écran : par le câble, le téléphone reste souvent
 * posé, l'application ouverte, pendant toute la synchronisation, sans repasser par l'arrière-plan. Assez lent pour
 * qu'une lecture d'un seul petit fichier ne coûte rien, assez court pour que la liste suive peu après la fin.
 */
export const SYNC_MARKER_POLL_MS = 25_000;

/** Ce que la relecture lente sait de la page : visible ou non, et le signal d'un changement. */
export interface VisibilitySource {
  visible(): boolean;
  /** Abonne au changement de visibilité ; rend de quoi se désabonner. */
  subscribe(listener: () => void): () => void;
}

/**
 * Lance `check` toutes les `periodMs` tant que la page est visible : une seule minuterie à la fois, aucune page
 * cachée. Rend l'arrêt (minuterie et abonnement). Une lecture qui échoue n'arrête rien : le tour suivant réessaie.
 */
export const pollWhileVisible = (check: () => void, source: VisibilitySource, periodMs = SYNC_MARKER_POLL_MS): (() => void) => {
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = (): void => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };
  const follow = (): void => {
    if (!source.visible()) stop();
    else if (timer === null) timer = setInterval(check, periodMs);
  };
  const unsubscribe = source.subscribe(follow);
  follow();
  return () => {
    unsubscribe();
    stop();
  };
};

export const createSyncMarkerWatch = (refresh: () => Promise<void>): SyncMarkerWatch => {
  let seen: { key: string; synchro: number | null } | null = null;
  let checking = false;
  return {
    note: (key, text) => {
      const synchro = readMarkerSync(text);
      if (seen?.key === key && synchro === null) return;
      seen = { key, synchro };
    },
    check: async (key, read) => {
      if (checking) return false;
      checking = true;
      try {
        const synchro = readMarkerSync(await read());
        const before = seen;
        if (before?.key !== key) {
          seen = { key, synchro };
          return false;
        }
        if (synchro === null || synchro === before.synchro) return false;
        seen = { key, synchro };
        void refresh().catch(() => undefined);
        return true;
      } catch {
        return false;
      } finally {
        checking = false;
      }
    },
  };
};
