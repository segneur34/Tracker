import { useCallback, useEffect, useState } from 'react';
import { ROUTES_DIR, routePath } from '../library/folderLayout';
import type { PlannedRoute } from '../planning/route';
import { buildRouteGpx } from '../planning/routeGpx';
import {
  isWritableRouteRecord, parseRouteRecord, recordToRoute, routeFileBase, routeToRecord, serializeRouteRecord,
  type RouteRecord,
} from '../planning/routeRecord';
import { currentMemoryFolder, useSessionLibrary } from './useSessionLibrary';

/**
 * Itinéraires rangés dans `itineraires/` du dossier mémoire, à côté des
 * sessions : une fiche JSON qui fait foi et son GPX, réécrits ensemble. Le
 * nom de fichier est tiré du nom de l'itinéraire à son premier rangement et
 * ne change plus ; renommer ne touche qu'au contenu.
 */

export interface SavedRoute {
  /** Nom des fichiers, sans extension : la clé de stockage. */
  base: string;
  record: RouteRecord;
  /** Fiche d'une version plus récente de l'application : lue, jamais réécrite. */
  readOnly: boolean;
}

const NO_FOLDER = 'Aucun dossier mémoire accessible : choisissez-le dans Réglages pour ranger vos itinéraires.';

const requireFolder = async () => {
  const folder = await currentMemoryFolder();
  if (!folder) throw new Error(NO_FOLDER);
  return folder;
};

/** Itinéraires du dossier, du plus récemment rangé au plus ancien. Une fiche illisible est ignorée. */
const listRoutes = async (): Promise<SavedRoute[]> => {
  const folder = await currentMemoryFolder();
  if (!folder) return [];
  const entries = await folder.list(ROUTES_DIR);
  const routes: SavedRoute[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'file' || !/\.json$/i.test(entry.name)) continue;
    const text = await folder.readText(routePath(entry.name));
    const record = text === null ? null : parseRouteRecord(text);
    if (record) routes.push({ base: entry.name.replace(/\.json$/i, ''), record, readOnly: !isWritableRouteRecord(record) });
  }
  return routes.sort((a, b) => (a.record.updatedAt < b.record.updatedAt ? 1 : a.record.updatedAt > b.record.updatedAt ? -1 : 0));
};

export const useRouteLibrary = () => {
  const { status, folderLabel } = useSessionLibrary();
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Incrémenté après chaque écriture : la liste est relue. */
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  // Relu quand la mémoire s'ouvre, change de dossier, ou après une écriture.
  useEffect(() => {
    if (status !== 'ready') return;
    let cancelled = false;
    listRoutes().then(
      (list) => {
        if (cancelled) return;
        setRoutes(list);
        setError(null);
      },
      (err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Lecture des itinéraires impossible.');
      }
    );
    return () => {
      cancelled = true;
    };
  }, [status, folderLabel, version]);

  /**
   * Range un itinéraire : sous ses fichiers s'il en a (`existing`), sinon sous
   * un nouveau nom. Rend l'itinéraire rangé.
   */
  const save = useCallback(
    async (route: PlannedRoute, meta: { name: string; activityId: string | null }, existing?: SavedRoute): Promise<SavedRoute> => {
      if (existing?.readOnly) throw new Error('Cet itinéraire vient d\'une version plus récente de l\'application : rangez-le sous un autre nom.');
      const folder = await requireFolder();
      const base = existing?.base ?? routeFileBase(meta.name, (await folder.list(ROUTES_DIR)).map((e) => e.name));
      const now = new Date().toISOString();
      const record = routeToRecord(
        route,
        { ...meta, createdAt: existing?.record.createdAt ?? now, updatedAt: now },
        existing?.record
      );
      await folder.writeText(routePath(`${base}.gpx`), buildRouteGpx(route, meta.name));
      await folder.writeText(routePath(`${base}.json`), serializeRouteRecord(record));
      reload();
      return { base, record, readOnly: false };
    },
    [reload]
  );

  const rename = useCallback(
    (saved: SavedRoute, name: string) => save(recordToRoute(saved.record), { name, activityId: saved.record.activityId }, saved),
    [save]
  );

  const remove = useCallback(
    async (saved: SavedRoute) => {
      const folder = await requireFolder();
      await folder.remove(routePath(`${saved.base}.json`));
      await folder.remove(routePath(`${saved.base}.gpx`));
      reload();
    },
    [reload]
  );

  return {
    /** Faux tant qu'aucun dossier mémoire n'est accessible : l'itinéraire se planifie, mais ne se range pas. */
    canSave: status === 'ready',
    /** Vide tant que la mémoire n'est pas ouverte. */
    routes: status === 'ready' ? routes : [],
    error,
    save,
    rename,
    remove,
  };
};
