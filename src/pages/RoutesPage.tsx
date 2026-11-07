import { plural } from '../core/basics';
import { useMemo, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import MemoryStatus from '../components/MemoryStatus';
import ActivityFilterTabs from '../components/ActivityFilterTabs';
import RouteList from '../components/RouteList';
import { IconFile, IconRoute, IconShare } from '../components/icons';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import PageHeader from '../components/ui/PageHeader';
import { activityCounts } from '../core/activities';
import { useRouteLibrary, type SavedRoute } from '../hooks/useRouteLibrary';
import { useVisibility } from '../hooks/useSportSettings';
import { ROUTE_SORTS, isRouteSort, routeActivity, routeDistanceM, shownRoutes, sortRoutes, type RouteSort } from '../planning/routeList';
import { plainError } from '../platform/errorText';
import { readPickedFile } from '../platform/files';
import { isNativeApp } from '../platform/runtime';
import { shareFile } from '../platform/share';
import { jsonStore } from '../platform/storage';

/**
 * Tous les itinéraires planifiés (point 68), ouverts depuis la carte de
 * l'accueil, qui n'en montre que les derniers : tri au choix, retenu sur
 * l'appareil (`tracker.routeList`), et onglets par activité. Chaque ligne
 * ouvre l'itinéraire, ou part dessus (« Partir »). Ceux d'une activité
 * cachée dans Réglages n'y sont pas (§10, point 100).
 *
 * Lot 194 : « Partager » envoie le GPX d'un itinéraire, sa fiche en extension,
 * vers une autre application ; « Importer un itinéraire » range celui d'un GPX
 * choisi dans les fichiers, souligné dans la liste.
 */

const PREFS_KEY = 'tracker.routeList';
/** Onglet des itinéraires rangés sans activité connue. */
const WITHOUT_ACTIVITY = '';

const readSort = (): RouteSort => {
  const stored = jsonStore.read<{ sort?: unknown }>(PREFS_KEY)?.sort;
  return isRouteSort(stored) ? stored : 'recent';
};

function RoutesPage() {
  const { routes: allRoutes, loaded, error, canSave, importGpx, shareFileOf } = useRouteLibrary();
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [imported, setImported] = useState<string | null>(null);
  const { activities, isShown } = useVisibility();
  const routes = useMemo(() => shownRoutes(allRoutes, activities, isShown), [allRoutes, activities, isShown]);
  const [sort, setSortState] = useState<RouteSort>(readSort);
  const setSort = (next: RouteSort) => {
    setSortState(next);
    jsonStore.write(PREFS_KEY, { sort: next });
  };
  const [filter, setFilter] = useState<string | null>(null);

  const counts = useMemo(() => activityCounts(routes.map((r) => routeActivity(r, activities)), activities), [routes, activities]);
  const withoutActivity = routes.filter((r) => routeActivity(r, activities) === null).length;
  const distances = useMemo(() => new Map(routes.map((r) => [r.base, routeDistanceM(r.record)])), [routes]);
  const shown = useMemo(() => {
    const filtered = filter === null
      ? routes
      : routes.filter((r) => (routeActivity(r, activities)?.id ?? WITHOUT_ACTIVITY) === filter);
    return sortRoutes(filtered, sort, (r) => distances.get(r.base) ?? 0);
  }, [routes, activities, filter, sort, distances]);
  /** Range l'itinéraire du GPX choisi ; le champ est vidé pour accepter de reprendre le même fichier. */
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setNote(null);
    try {
      const saved = await importGpx(await readPickedFile(file), file.name);
      setFilter(null);
      setImported(saved.base);
      setNote({ text: `« ${saved.record.name} » est rangé dans vos itinéraires.`, error: false });
    } catch (err) {
      setNote({ text: plainError(err, 'Import impossible.'), error: true });
    }
  };

  const share = async (saved: SavedRoute) => {
    setNote(null);
    try {
      const { fileName, text } = await shareFileOf(saved);
      const outcome = await shareFile(new Blob([text], { type: 'application/gpx+xml' }), fileName, "Partager l'itinéraire");
      if (outcome === 'downloaded') setNote({ text: 'Ce navigateur ne partage pas de fichier : le GPX est téléchargé.', error: false });
    } catch (err) {
      setNote({ text: `Partage impossible : ${plainError(err, 'erreur inconnue')}`, error: true });
    }
  };

  const tabCount = counts.length + (withoutActivity > 0 ? 1 : 0);

  return (
    <div className="ui-page" style={{ '--tab-accent': 'var(--neutral-accent)' } as React.CSSProperties}>
      <PageHeader
        title="Itinéraires planifiés"
        back={{ to: '/', label: 'Accueil' }}
        subtitle={loaded ? plural(routes.length, 'itinéraire') : undefined} />

      <MemoryStatus />
      {error && <div className="ui-alert ui-alert--danger">{error}</div>}

      <div className="ui-flex-between ui-wrap">
        {routes.length > 0 && (
          <label className="ui-row-s2 ui-center ui-text-m">
            <span className="ui-eyebrow">Trier</span>
            <select className="ui-field ui-field--s" value={sort} onChange={(e) => isRouteSort(e.target.value) && setSort(e.target.value)}>
              {ROUTE_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        )}
        <span className="ui-row-s2 ui-wrap ui-ml-auto">
          {canSave && (
            <label className="ui-btn ui-btn--secondary ui-btn--s">
              <IconFile size={16} />
              Importer un itinéraire
              {/* Sur le téléphone, pas de filtre : Android grise parfois les GPX. Le contenu est vérifié à la lecture. */}
              <input type="file" accept={isNativeApp() ? undefined : '.gpx'} hidden onChange={(e) => void importFile(e)} />
            </label>
          )}
          <Link to="/itineraires" className="ui-btn ui-btn--secondary ui-btn--s">
            <IconRoute size={18} /> Planifier
          </Link>
        </span>
      </div>

      {note && <div className={`ui-alert ${note.error ? 'ui-alert--danger' : 'ui-alert--success'}`}>{note.text}</div>}

      {tabCount > 1 && (
        <ActivityFilterTabs total={routes.length} counts={counts} selected={filter} onSelect={setFilter}
          withoutCount={withoutActivity} withoutId={WITHOUT_ACTIVITY} />
      )}

      <Card>
        {shown.length > 0 ? (
          <RouteList routes={shown} activities={activities} currentBase={imported}
            actions={(saved) => (
              <Button size="s" variant="ghost" className="route-list__icon-btn" title="Partager"
                onClick={() => void share(saved)} aria-label={`Partager ${saved.record.name}`}>
                <IconShare size={24} />
              </Button>
            )} />
        ) : (
          <p className="ui-hint ui-hint--m">
            Aucun itinéraire pour l'instant. <Link to="/itineraires">Planifiez-en un</Link> : il apparaîtra ici, prêt à suivre.
          </p>
        )}
      </Card>
    </div>
  );
}

export default RoutesPage;
