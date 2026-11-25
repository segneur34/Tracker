import { useSyncExternalStore } from 'react';
import { routeStore } from './routeFiles';
import { deleteFromTrash, emptyWholeTrash, restoreFromTrash, trashStore, useLibraryFields, type TrashState } from './useSessionLibrary';
import { deletesToTrash, type TrashEntry } from '../library/trash';

/**
 * Vrai si une suppression faite maintenant part à la corbeille : le dossier ouvert est celui du disque du programme
 * Windows, en écriture (`deletesToTrash`, la condition de `trashFolderOf`). Les phrases de confirmation le suivent ;
 * faux partout ailleurs, où elles ne changent pas.
 */
export const useDeletesToTrash = (): boolean => {
  const { folderKind, memoryReadOnly } = useLibraryFields('folderKind', 'memoryReadOnly');
  return deletesToTrash(folderKind, memoryReadOnly);
};

/**
 * Corbeille du programme Windows, pour Réglages › Mémoire : ses entrées, et les gestes qui les ramènent ou les
 * effacent (`sessionLibrary/trashRestore.ts`). Vide hors du programme Windows.
 */
export const useTrash = (): TrashState => useSyncExternalStore(trashStore.subscribe, trashStore.get);

/** Restaure une ligne ; la liste des itinéraires est relue quand c'en est un. Rend la phrase du compte rendu. */
export const restoreTrashEntry = async (entry: TrashEntry): Promise<string> => {
  try {
    return await restoreFromTrash(entry);
  } finally {
    if (entry.kind === 'itineraire') routeStore.reload();
  }
};

export { deleteFromTrash as deleteTrashEntry, emptyWholeTrash as emptyTrash };
