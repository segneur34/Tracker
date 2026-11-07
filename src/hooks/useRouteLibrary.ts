import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { PlannedRoute } from '../planning/route';
import type { MarkGuideSettings } from '../recording/markGuide';
import { importRouteGpx, removeRoute, routeShareFile, routeStore, saveRoute, type SavedRoute } from './routeFiles';
import { useLibraryFields } from './useSessionLibrary';

export type { SavedRoute } from './routeFiles';

/**
 * Itinéraires rangés dans `itineraires/` du dossier mémoire, pour les pages :
 * la lecture et l'écriture sont dans `routeFiles.ts`, partagées avec la file
 * des fichiers reçus.
 */

/** Liste vide partagée : une référence stable tant que la mémoire n'est pas ouverte. */
const NO_ROUTES: SavedRoute[] = [];

export const useRouteLibrary = () => {
  const { status, folderLabel, revision } = useLibraryFields('status', 'folderLabel', 'revision');
  const { items, loaded, error } = useSyncExternalStore(routeStore.store.subscribe, routeStore.store.get);

  // Lu quand la mémoire s'ouvre, change de dossier ou est relue (« Mettre à jour ») : une seule lecture pour toutes les pages.
  useEffect(() => {
    if (status === 'ready') routeStore.ensure(`${folderLabel ?? ''}|${revision}`);
  }, [status, folderLabel, revision]);

  /**
   * Range un itinéraire : sous ses fichiers s'il en a (`existing`), sinon sous
   * un nouveau nom. Rend l'itinéraire rangé.
   */
  const save = useCallback(
    (
      route: PlannedRoute,
      meta: { name: string; activityId: string | null; markGuide?: MarkGuideSettings | null },
      existing?: SavedRoute
    ): Promise<SavedRoute> => saveRoute(route, meta, existing),
    []
  );

  const remove = useCallback((saved: SavedRoute) => removeRoute(saved), []);

  return {
    /** Faux tant qu'aucun dossier mémoire n'est accessible : l'itinéraire se planifie, mais ne se range pas. */
    canSave: status === 'ready',
    /** Vide tant que la mémoire n'est pas ouverte. */
    routes: status === 'ready' ? items : NO_ROUTES,
    /** Faux tant que la liste n'est pas lue : le nombre d'itinéraires n'est pas encore connu. */
    loaded: status === 'ready' && loaded,
    error,
    save,
    remove,
    /** Range l'itinéraire d'un GPX choisi dans les fichiers (lot 194) ; lève, message en clair. */
    importGpx: importRouteGpx,
    /** GPX à partager d'un itinéraire rangé, avec sa fiche en extension (lot 194). */
    shareFileOf: routeShareFile,
  };
};
