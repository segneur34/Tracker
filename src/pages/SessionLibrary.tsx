import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer } from 'react-leaflet';
import OsmTileLayer from '../components/OsmTileLayer';
import { Link, useSearchParams } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import MapAutoResize from '../components/MapAutoResize';
import ActivitySelect, { ActivitySheet } from '../components/ActivitySelect';
import ImportButtons from '../components/ImportButtons';
import MemoryStatus from '../components/MemoryStatus';
import RefreshLibraryButton from '../components/RefreshLibraryButton';
import RouteList from '../components/RouteList';
import TrackSegmentsLayer, { type TrackSegment } from '../components/TrackSegmentsLayer';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import HelpButton from '../components/ui/HelpButton';
import PageHeader from '../components/ui/PageHeader';
import { sampledIndices } from '../core/chartZoom';
import { PREVIEW_MAX_POINTS, trackBounds, type TrackBounds } from '../core/displayConfig';
import { parseGpx } from '../core/gpxParser';
import { referenceSpeedMs as sessionReferenceSpeedMs } from '../core/sessionSpeed';
import { buildCumulativeTrack } from '../core/sessionStats';
import { isValidSpeedRange, type SpeedRangeMs } from '../core/speedGradient';
import { coloredSegments, trackColorSpeedsMs } from '../core/trackColor';
import { FAMILY_BASE, activitiesOfFamily, activityCounts, sessionActivity, type Activity } from '../core/activities';
import { sportFamily, sportTreatment, type SportFamily } from '../core/sportProfiles';
import { formatDistance, formatDuration, formatSpeed, msToKnots, toDisplayDistance } from '../core/units';
import { useOpenSession } from '../hooks/useLibraryNavigation';
import { useRouteLibrary } from '../hooks/useRouteLibrary';
import { readSessionGpx, removeSession, updateSessionRecord, useSessionLibrary } from '../hooks/useSessionLibrary';
import {
  PLANNING_FAMILIES, TREATMENT_SPEED_RANGE_MS, effectiveDistanceUnit, effectiveSpeedUnit, readStoredActivities, readStoredSettings,
} from '../hooks/useSportSettings';
import type { LibrarySession } from '../library/record';
import { analysisTrack } from '../library/summary';
import { routeActivity, routesOfFamily } from '../planning/routeList';
import { isNativeApp } from '../platform/runtime';
import { suggestSpeedRangeMs } from '../sailing/sailingConfig';
import './SessionLibrary.css';

/**
 * Bibliothèque d'une famille : Voile, Course, Vélo, Fractionné. La liste des
 * sessions de la mémoire, filtrable par activité (`?activite=<id>` pour
 * arriver filtré, depuis l'accueil), les sessions à classer, l'import de GPX
 * ou d'un dossier entier, la suppression. La vue « Planifiées »
 * (`?vue=planifiees`) montre à la place les itinéraires de la famille, filtrés
 * par les mêmes onglets d'activité ; le fractionné, qui ne planifie pas, n'en a pas.
 */

const FAMILY: Record<SportFamily, { title: string; accent: string; of: string }> = {
  voile: { title: 'Voile', accent: 'var(--voile)', of: 'de voile' },
  course: { title: 'Course à pied', accent: 'var(--course)', of: 'de course' },
  velo: { title: 'Vélo', accent: 'var(--velo)', of: 'de vélo' },
  fractionne: { title: 'Fractionné', accent: 'var(--fractionne)', of: 'de fractionné' },
};

/** Activité d'une session d'après sa fiche (`sessionActivity`), `null` pour une session à classer. */
const activityOf = (session: LibrarySession, activities: Activity[]): Activity | null =>
  sessionActivity(activities, session.record.activityId, session.record.sport);

const formatDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

const formatTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });


/** Chiffres d'une ligne, selon le traitement de son calcul. */
const rowStats = (session: LibrarySession, activity: Activity | null): string[] => {
  const { summary } = session.record;
  // Deux décimales sous 10 unités, une au-delà.
  const distanceUnit = activity ? effectiveDistanceUnit(activity) : 'km';
  const decimals = toDisplayDistance(summary.distanceM, distanceUnit) < 10 ? 2 : 1;
  const stats = [formatDuration(summary.endMs - summary.startMs), formatDistance(summary.distanceM, distanceUnit, decimals)];
  if (activity === null) return stats;
  if (sportTreatment(activity.base) === 'voile') {
    stats.push(`max ${formatSpeed(summary.maxSpeedMs, effectiveSpeedUnit(activity))}`);
    if (summary.maneuverCount !== undefined) stats.push(`${summary.maneuverCount} manœuvres`);
  } else {
    if (summary.movingTimeS && summary.distanceM > 0) {
      stats.push(formatSpeed(summary.distanceM / summary.movingTimeS, effectiveSpeedUnit(activity)));
    }
    if (summary.elevationGainM !== null) stats.push(`D+ ${Math.round(summary.elevationGainM)} m`);
  }
  // Répétitions du compteur, quand la session en a (fractionné).
  const reps = session.record.intervals?.reduce((n, series) => n + series.laps.filter((l) => l.kind === 'travail').length, 0) ?? 0;
  if (reps > 0) stats.push(`${reps} rép.`);
  return stats;
};

/**
 * Bornes de couleur d'une vignette d'aperçu, dans cet ordre, comme le module d'analyse :
 * 0. celles enregistrées dans la fiche de la session (`analysis.speedRange`) ;
 * 1. celles réglées pour son activité dans Réglages (`tracker.sportSettings`) ;
 * 2. en voile, les bornes suggérées par l'allure de la session (`suggestSpeedRangeMs`,
 *    mesurées sur la trace entière comme dans l'analyse) ;
 * 3. à défaut, le défaut du traitement de son calcul (celui du calcul par défaut de la
 *    famille pour une session à classer).
 */
const previewSpeedRange = (
  session: LibrarySession,
  activity: Activity | null,
  family: SportFamily,
  suggested: SpeedRangeMs | null
): SpeedRangeMs => {
  const { record } = session;
  if (record.analysis?.speedRange) return record.analysis.speedRange;
  if (activity) {
    const override = readStoredSettings().speedRanges?.[activity.id];
    if (override && isValidSpeedRange(override)) return override;
  }
  if (suggested) return suggested;
  return TREATMENT_SPEED_RANGE_MS[sportTreatment(record.sport ?? FAMILY_BASE[family])];
};

/**
 * Trace d'une vignette : au plus `PREVIEW_MAX_POINTS` points, chacun avec sa vitesse
 * de couleur calculée sur la trace entière, l'emprise de la trace et, en voile, les
 * bornes suggérées par l'allure.
 */
interface PreviewTrack {
  points: { lat: number; lon: number; colorMs: number }[];
  bounds: TrackBounds;
  suggested: SpeedRangeMs | null;
}

/** Marge sous l'écran où une vignette se charge déjà, pour être prête quand on y arrive. */
const PREVIEW_PRELOAD_MARGIN = '200px';

/**
 * Vignette carte d'une session, toujours affichée à droite de ses chiffres :
 * le GPX est relu quand la ligne approche de l'écran, une fois, puis la trace
 * est réduite à `PREVIEW_MAX_POINTS` points dessinés sur un canevas, pour que
 * toutes les vignettes visibles restent légères. Figée (ni glisser ni zoomer :
 * le doigt fait défiler la liste) ; un toucher ouvre l'analyse.
 */
function SessionPreviewMap({ session, activity, family, onOpen }: {
  session: LibrarySession;
  activity: Activity | null;
  family: SportFamily;
  onOpen: () => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  // Sans IntersectionObserver, chargée tout de suite.
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  const [track, setTrack] = useState<PreviewTrack | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const { file } = session;
  const sport = session.record.sport;
  const referenceOverrideMs = session.record.analysis?.referenceSpeedMs ?? null;

  useEffect(() => {
    const el = frame.current;
    if (!el || near) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setNear(true);
    }, { rootMargin: PREVIEW_PRELOAD_MARGIN });
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    void (async () => {
      const gpx = await readSessionGpx(file);
      if (cancelled) return;
      if (gpx === null) { setStatus('error'); return; }
      try {
        // La trace et sa couleur telles que l'analyse les calcule : filtres du support, allure de la session.
        const { rawPoints } = parseGpx(gpx);
        const referenceMs = referenceOverrideMs ?? sessionReferenceSpeedMs(rawPoints);
        const points = analysisTrack(rawPoints, sport, referenceMs);
        const bounds = trackBounds(points);
        if (points.length < 2 || bounds === null) { setStatus('error'); return; }
        const treatment = sportTreatment(sport ?? FAMILY_BASE[family]);
        const colorMs = trackColorSpeedsMs(points, treatment);
        setTrack({
          points: sampledIndices(0, points.length - 1, PREVIEW_MAX_POINTS)
            .map((i) => ({ lat: points[i].lat, lon: points[i].lon, colorMs: colorMs[i] })),
          bounds,
          suggested: sport !== null && treatment === 'voile'
            ? suggestSpeedRangeMs(sport, msToKnots(referenceMs), points, buildCumulativeTrack(points))
            : null,
        });
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [near, file, sport, referenceOverrideMs, family]);

  const range = useMemo(
    () => (track ? previewSpeedRange(session, activity, family, track.suggested) : null),
    [track, session, activity, family]
  );
  /** Traits de la vignette, mémorisés : un balayage de la bibliothèque ne les redessine pas. */
  const segments = useMemo(
    (): TrackSegment[] => (track && range ? coloredSegments(track.points, range) : []),
    [track, range]
  );

  return (
    <div
      ref={frame}
      className="lib-row__preview"
      role="link"
      aria-label="Ouvrir l'analyse"
      // Le lien de la mention OSM compris : un toucher sur la vignette ouvre l'analyse, rien d'autre.
      onClick={(e) => { e.preventDefault(); onOpen(); }}>
      {status === 'ready' && track && range ? (
        <MapContainer
          bounds={track.bounds}
          boundsOptions={{ padding: [8, 8], maxZoom: 17 }}
          preferCanvas
          dragging={false}
          touchZoom={false}
          doubleClickZoom={false}
          scrollWheelZoom={false}
          boxZoom={false}
          keyboard={false}
          zoomControl={false}
          style={{ position: 'absolute', inset: 0 }}>
          <MapAutoResize />
          <OsmTileLayer />
          <TrackSegmentsLayer segments={segments} weight={3} />
        </MapContainer>
      ) : (
        <span className="lib-row__preview-status">{status === 'error' ? 'Carte indisponible' : 'Carte…'}</span>
      )}
    </div>
  );
}

function SessionRow({
  session, activity, activities, family, confirming, onAskDelete, onCancelDelete,
}: {
  session: LibrarySession;
  activity: Activity | null;
  /** Toutes les activités, pour classer une session. */
  activities: Activity[];
  family: SportFamily;
  confirming: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
}) {
  const openSession = useOpenSession();
  const { record } = session;
  const { startMs } = record.summary;
  const unclassified = record.sport === null;
  /** Nom en cours de saisie ; `null` hors renommage. */
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  /** Activité demandée avant l'analyse d'une session à classer. */
  const [asking, setAsking] = useState(false);

  /**
   * Ouvre l'analyse. Une session à classer (le fichier ne dit pas son
   * activité) la demande d'abord : sans elle, le module et ses seuils
   * seraient pris au hasard. Une fiche en lecture seule ne peut pas la
   * garder : la session s'ouvre dans le module de la page, comme avant.
   */
  const open = () => {
    if (unclassified && !session.readOnly) setAsking(true);
    else openSession(session.file, family);
  };
  const classifyAndOpen = (chosen: Activity) => {
    setAsking(false);
    updateSessionRecord(session.file, { sport: chosen.base, activityId: chosen.id });
    openSession(session.file, sportFamily(chosen.base));
  };

  const saveName = () => {
    if (nameDraft === null) return;
    updateSessionRecord(session.file, { name: nameDraft });
    setNameDraft(null);
  };

  return (
    <li className="lib-row">
      <div className="lib-row__head-line">
        <button type="button" className="lib-row__main" onClick={open}>
          {record.name && <span className="lib-row__name">{record.name}</span>}
          <span className="lib-row__head">
            <span className={record.name ? 'lib-row__sport lib-row__sport--sub' : 'lib-row__sport'}>
              {activity ? activity.name : 'À classer'}
            </span>
            <span className="lib-row__date">{formatDate(startMs)} · {formatTime(startMs)}</span>
          </span>
          <span className="lib-row__stats num">{rowStats(session, activity).join(' · ')}</span>
          {record.notes?.comment && <span className="lib-row__note">{record.notes.comment}</span>}
          {session.warning && <span className="lib-row__warning">{session.warning}</span>}
        </button>
        <SessionPreviewMap session={session} activity={activity} family={family} onOpen={open} />
      </div>
      {asking && (
        <ActivitySheet
          activities={activities}
          value={null}
          heading={{ title: 'Quelle activité ?', hint: "Le fichier ne la dit pas : choisissez-la avant l'analyse. Elle reste dans la fiche de la session." }}
          onChoose={classifyAndOpen}
          onClose={() => setAsking(false)} />
      )}

      <div className="lib-row__actions">
        {nameDraft !== null ? (
          <>
            <input
              className="ui-field ui-field--s lib-row__rename"
              value={nameDraft}
              autoFocus
              maxLength={80}
              placeholder="Nom de la session"
              aria-label="Nom de la session"
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName();
                else if (e.key === 'Escape') setNameDraft(null);
              }} />
            <Button size="s" onClick={saveName}>Valider</Button>
            <Button size="s" variant="ghost" onClick={() => setNameDraft(null)}>Annuler</Button>
          </>
        ) : (
          <>
            {unclassified && !session.readOnly && (
              <ActivitySelect
                activities={activities}
                value={null}
                placeholder="Classer…"
                label="Classer la session"
                onChange={(chosen) => updateSessionRecord(session.file, { sport: chosen.base, activityId: chosen.id })} />
            )}
            {!session.readOnly && !confirming && (
              <Button size="s" variant="ghost" onClick={() => setNameDraft(record.name ?? '')}>Renommer</Button>
            )}
            {!session.readOnly && (confirming ? (
              <>
                <Button size="s" variant="danger" onClick={() => void removeSession(session.file)}>Confirmer</Button>
                <Button size="s" variant="ghost" onClick={onCancelDelete}>Annuler</Button>
              </>
            ) : (
              <Button size="s" variant="ghost" onClick={onAskDelete}>Supprimer</Button>
            ))}
          </>
        )}
      </div>
    </li>
  );
}

function SessionLibrary({ family }: { family: SportFamily }) {
  const library = useSessionLibrary();
  const { title, accent } = FAMILY[family];
  // Relues à l'ouverture de la page : les activités se changent dans Réglages.
  const [activities] = useState(readStoredActivities);
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<string>(() => params.get('activite') ?? 'all');
  const plans = PLANNING_FAMILIES.includes(family);
  const planned = plans && params.get('vue') === 'planifiees';
  const setPlanned = (next: boolean) => setParams((current) => {
    const updated = new URLSearchParams(current);
    if (next) updated.set('vue', 'planifiees');
    else updated.delete('vue');
    return updated;
  }, { replace: true });
  const { routes } = useRouteLibrary();
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmFile, setConfirmFile] = useState<string | null>(null);

  /** Activité de chaque session, calculée une fois par liste. */
  const activityByFile = useMemo(
    () => new Map(library.sessions.map((s) => [s.file, activityOf(s, activities)])),
    [library.sessions, activities]
  );
  const familySessions = useMemo(
    () => library.sessions.filter((s) => s.record.sport !== null && sportFamily(s.record.sport) === family),
    [library.sessions, family]
  );
  const unclassified = useMemo(() => library.sessions.filter((s) => s.record.sport === null), [library.sessions]);
  const familyRoutes = useMemo(() => routesOfFamily(routes, activities, family), [routes, activities, family]);
  /** Activités présentes dans la vue, dans l'ordre de Réglages puis celles de base, avec leur nombre d'éléments. */
  const counts = useMemo(
    () => activityCounts(
      planned ? familyRoutes.map((r) => routeActivity(r, activities)) : familySessions.map((s) => activityByFile.get(s.file) ?? null),
      activitiesOfFamily(activities, family)
    ),
    [planned, activities, family, familySessions, familyRoutes, activityByFile]
  );
  // Une activité sans élément ici (ou seule, donc sans onglets) : « tous », jamais une liste vide sans issue.
  const activeFilter = counts.length > 1 && counts.some((c) => c.activity.id === filter) ? filter : 'all';
  const shown = activeFilter === 'all' ? familySessions : familySessions.filter((s) => activityByFile.get(s.file)?.id === activeFilter);
  const shownRoutes = activeFilter === 'all' ? familyRoutes : familyRoutes.filter((r) => routeActivity(r, activities)?.id === activeFilter);
  const native = isNativeApp();

  const row = (session: LibrarySession) => (
    <SessionRow
      key={session.file}
      session={session}
      activity={activityByFile.get(session.file) ?? null}
      activities={activities}
      family={family}
      confirming={confirmFile === session.file}
      onAskDelete={() => setConfirmFile(session.file)}
      onCancelDelete={() => setConfirmFile(null)} />
  );

  return (
    <div className="ui-page" style={{ '--lib-accent': accent, '--help-accent': accent } as React.CSSProperties}>
      <PageHeader title={title} subtitle={`${familySessions.length} session${familySessions.length > 1 ? 's' : ''}`} />

      <MemoryStatus />

      <div className="lib-actions">
        <ImportButtons />
        <RefreshLibraryButton />
        <HelpButton
          open={helpOpen}
          onToggle={() => setHelpOpen(!helpOpen)}
          label="À quoi sert « Ajouter les sessions d'un dossier » ?" />
      </div>
      {helpOpen && (
        <p className="lib-hint">
          {native
            ? "« Ajouter les sessions d'un dossier » reprend celles d'un dossier Tracker copié depuis le PC ou un autre téléphone, notes comprises. On peut aussi copier les fichiers directement dans Documents › Tracker › sessions : ils apparaissent avec « Mettre à jour », ou au lancement suivant."
            : "« Ajouter les sessions d'un dossier » reprend celles d'un dossier Tracker copié depuis le téléphone ou un autre PC, notes comprises. Chrome demande alors s'il faut importer les fichiers « sur ce site » : ils restent sur ce PC, Tracker n'envoie rien sur internet. Le dossier mémoire de ce PC, lui, se choisit dans Réglages › Mémoire ; des fichiers copiés dedans pendant que Tracker est ouvert apparaissent avec « Mettre à jour »."}
        </p>
      )}

      {plans && (
        <div className="ui-tabs" aria-label="Vue" style={{ '--tab-accent': accent } as React.CSSProperties}>
          <button type="button" className="ui-tab" aria-pressed={!planned} onClick={() => setPlanned(false)}>
            réalisées ({familySessions.length})
          </button>
          <button type="button" className="ui-tab" aria-pressed={planned} onClick={() => setPlanned(true)}>
            planifiées ({familyRoutes.length})
          </button>
        </div>
      )}

      {counts.length > 1 && (
        <div className="ui-tabs" style={{ '--tab-accent': accent } as React.CSSProperties}>
          <button type="button" className="ui-tab" aria-pressed={activeFilter === 'all'} onClick={() => setFilter('all')}>
            tous ({planned ? familyRoutes.length : familySessions.length})
          </button>
          {counts.map(({ activity, count }) => (
            <button key={activity.id} type="button" className="ui-tab" aria-pressed={activeFilter === activity.id} onClick={() => setFilter(activity.id)}>
              {activity.name} ({count})
            </button>
          ))}
        </div>
      )}

      {planned && (
        <Card>
          {shownRoutes.length > 0 ? (
            <RouteList routes={shownRoutes} activities={activities} />
          ) : (
            <p className="lib-hint">
              Aucun itinéraire {FAMILY[family].of} pour l'instant.{' '}
              <Link to="/itineraires">Planifiez-en un</Link> et rangez-le sous une de ces activités : il apparaîtra ici.
            </p>
          )}
        </Card>
      )}

      {!planned && unclassified.length > 0 && (
        <Card heading="À classer">
          <p className="lib-hint">
            Traces dont l'activité n'est pas connue : choisissez-la pour les ranger en voile, en course, à vélo ou en fractionné. Ouvrir l'une d'elles la demande d'abord.
          </p>
          <ul className="lib-list">{unclassified.map(row)}</ul>
        </Card>
      )}

      {planned ? null : shown.length > 0 ? (
        <ul className="lib-list">{shown.map(row)}</ul>
      ) : (
        library.status === 'ready' && !library.scanning && (
          <Card>
            <p className="lib-hint">
              Aucune session {FAMILY[family].of} pour l'instant. Enregistrez-en une, ou
              importez des GPX : ils sont rangés dans la mémoire et analysés ici.
            </p>
          </Card>
        )
      )}
    </div>
  );
}

export default SessionLibrary;
