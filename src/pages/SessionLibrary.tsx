import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer } from 'react-leaflet';
import BaseTileLayer from '../components/BaseTileLayer';
import { Link, useSearchParams } from 'react-router-dom';
import MapAutoResize from '../components/MapAutoResize';
import PageBackdrop from '../components/PageBackdrop';
import { FAMILY_ICON } from '../components/familyIcons';import { IconHelp } from '../components/icons';
import ActivityIcon from '../components/ActivityIcon';
import ActivitySelect, { ActivitySheet } from '../components/ActivitySelect';
import ImportButtons from '../components/ImportButtons';
import { useHelp } from '../components/helpContext';
import MemoryStatus from '../components/MemoryStatus';
import RefreshLibraryButton from '../components/RefreshLibraryButton';
import RouteList from '../components/RouteList';
import TrainingHub from '../components/TrainingHub';
import { sessionColorTrack, sessionSpeedRange, type SessionColorTrack } from '../components/sessionTrack';
import TrackSegmentsLayer, { type TrackSegment } from '../components/TrackSegmentsLayer';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import MoreMenu from '../components/ui/MoreMenu';
import { sampledIndices } from '../core/chartZoom';
import { PREVIEW_MAX_POINTS } from '../core/displayConfig';
import { coloredSegments } from '../core/trackColor';
import { activitiesOfFamily, activityCounts, sessionActivity, type Activity } from '../core/activities';
import { sportFamily, sportTreatment, type SportFamily } from '../core/sportProfiles';
import { formatDistance, formatDuration, formatShortDuration, formatSpeed, toDisplayDistance } from '../core/units';
import { useOpenSession } from '../hooks/useLibraryNavigation';
import { useRouteLibrary } from '../hooks/useRouteLibrary';
import { readSessionGpx, removeSession, updateSessionRecord, useLibraryFields } from '../hooks/useSessionLibrary';
import {
  PLANNING_FAMILIES, effectiveDistanceUnit, effectiveSpeedUnit, useVisibility,
} from '../hooks/useSportSettings';
import type { LibrarySession } from '../library/record';
import { routeActivity, routesOfFamily } from '../planning/routeList';
import { isNativeApp } from '../platform/runtime';
import bannerCourse from '../assets/bandeaux/course.webp';
import bannerFractionne from '../assets/bandeaux/fractionne.webp';
import bannerSurf from '../assets/bandeaux/surf.webp';
import bannerVelo from '../assets/bandeaux/velo.webp';
import bannerVoile from '../assets/bandeaux/voile.webp';
import './SessionLibrary.css';

/**
 * Bibliothèque d'une famille : Voile, À pied, Vélo, Surf, Entraînement (l'ancien Fractionné, 24/10). La liste des
 * sessions de la mémoire, filtrable par activité (`?activite=<id>` pour
 * arriver filtré, depuis l'accueil), les sessions à classer, l'import de GPX
 * ou d'un dossier entier, la suppression. La vue « Planifiées »
 * (`?vue=planifiees`) montre à la place les itinéraires de la famille, filtrés
 * par les mêmes onglets d'activité ; le fractionné et le surf, qui ne planifient pas, n'en ont pas.
 *
 * Les sessions et itinéraires d'une activité cachée dans Réglages n'y sont
 * pas, une ligne dit combien ; la page d'une famille cachée, ouverte par son
 * adresse, montre tout et le rappelle (§10, point 100).
 */

/** Nom, couleur et photo du bandeau de chaque famille (refonte du 22/10). */
const FAMILY: Record<SportFamily, { title: string; accent: string; of: string; banner: string }> = {
  voile: { title: 'Voile', accent: 'var(--voile)', of: 'de voile', banner: bannerVoile },
  course: { title: 'À pied', accent: 'var(--course)', of: 'à pied', banner: bannerCourse },
  velo: { title: 'Vélo', accent: 'var(--velo)', of: 'de vélo', banner: bannerVelo },
  fractionne: { title: 'Entraînement', accent: 'var(--fractionne)', of: "d'entraînement", banner: bannerFractionne },
  surf: { title: 'Surf', accent: 'var(--surf)', of: 'de surf', banner: bannerSurf },
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
  } else if (sportTreatment(activity.base) === 'surf') {
    // Vagues, plus longue vague ; sur foil, le plus long vol.
    if (summary.waveCount !== undefined) stats.push(`${summary.waveCount} vague${summary.waveCount > 1 ? 's' : ''}`);
    if (summary.longestWaveM != null) stats.push(`plus longue ${Math.round(summary.longestWaveM)} m`);
    if (summary.longestFlightS != null) stats.push(`vol ${formatShortDuration(summary.longestFlightS)}`);
  } else if (summary.test) {
    // Test guidé : FC max et vitesse du dernier palier tenu.
    if (summary.test.hrMaxBpm !== null) stats.push(`FC max ${summary.test.hrMaxBpm}`);
    if (summary.test.lastStepSpeedMs !== null) stats.push(formatSpeed(summary.test.lastStepSpeedMs, effectiveSpeedUnit(activity)));
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
 * Vignettes déjà calculées, réduites à `PREVIEW_MAX_POINTS` points : revenir sur
 * la bibliothèque, ou y refaire défiler une ligne, ne relit ni ne réanalyse
 * son GPX (E-O7). La clé tient tout ce dont la trace dépend ; un GPX rangé
 * n'est jamais réécrit.
 */
const previewCache = new Map<string, SessionColorTrack>();
const PREVIEW_CACHE_MAX = 400;

const rememberPreview = (key: string, track: SessionColorTrack): void => {
  if (previewCache.size >= PREVIEW_CACHE_MAX) previewCache.delete(previewCache.keys().next().value!);
  previewCache.set(key, track);
};

/** Marge sous l'écran où une vignette se charge déjà, pour être prête quand on y arrive. */
const PREVIEW_PRELOAD_MARGIN = '200px';

/**
 * Vignette carte d'une session, toujours affichée à droite de ses chiffres :
 * le GPX est relu quand la ligne approche de l'écran, une fois, puis la trace
 * est réduite à `PREVIEW_MAX_POINTS` points dessinés sur un canevas, pour que
 * toutes les vignettes visibles restent légères. Figée (ni glisser ni zoomer :
 * le doigt fait défiler la liste) ; un toucher ouvre l'analyse.
 */
function SessionPreviewMap({ session, activity, family, folderLabel, onOpen }: {
  session: LibrarySession;
  activity: Activity | null;
  family: SportFamily;
  /** Dossier mémoire en service : un autre dossier peut avoir un fichier de même nom. */
  folderLabel: string | null;
  onOpen: () => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const { file } = session;
  const sport = session.record.sport;
  const referenceOverrideMs = session.record.analysis?.referenceSpeedMs ?? null;
  const cacheKey = `${folderLabel}|${file}|${sport}|${referenceOverrideMs}|${family}`;
  const cached = previewCache.get(cacheKey) ?? null;
  // Sans IntersectionObserver, chargée tout de suite ; déjà calculée, rien à attendre.
  const [near, setNear] = useState(() => cached !== null || typeof IntersectionObserver === 'undefined');
  const [track, setTrack] = useState<SessionColorTrack | null>(cached);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(cached ? 'ready' : 'loading');

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
      // Déjà calculée (autre réglage de la même ligne, revenu à une valeur vue) : reprise telle quelle.
      const known = previewCache.get(cacheKey);
      const gpx = known ? null : await readSessionGpx(file);
      if (cancelled) return;
      if (known) {
        setTrack(known);
        setStatus('ready');
        return;
      }
      if (gpx === null) { setStatus('error'); return; }
      try {
        // La trace et sa couleur telles que l'analyse les calcule, réduite à PREVIEW_MAX_POINTS points.
        const full = sessionColorTrack(gpx, sport, referenceOverrideMs, family);
        if (full === null) { setStatus('error'); return; }
        const reduced = { ...full, points: sampledIndices(0, full.points.length - 1, PREVIEW_MAX_POINTS).map((i) => full.points[i]) };
        rememberPreview(cacheKey, reduced);
        setTrack(reduced);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [near, file, sport, referenceOverrideMs, family, cacheKey]);

  const range = useMemo(
    () => (track ? sessionSpeedRange(session.record, activity, family, track.suggested) : null),
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
          <BaseTileLayer />
          <TrackSegmentsLayer segments={segments} weight={3} />
        </MapContainer>
      ) : (
        <span className="lib-row__preview-status">{status === 'error' ? 'Carte indisponible' : 'Carte…'}</span>
      )}
    </div>
  );
}

/**
 * Ligne d'une session. Mémorisée, rappels stables : un balayage de la
 * bibliothèque ne redessine que les lignes dont la fiche change (E-O1).
 */
const SessionRow = memo(function SessionRow({
  session, activity, activities, family, folderLabel, confirming, onAskDelete, onCancelDelete,
}: {
  session: LibrarySession;
  activity: Activity | null;
  /** Toutes les activités, pour classer une session. */
  activities: Activity[];
  family: SportFamily;
  folderLabel: string | null;
  confirming: boolean;
  onAskDelete: (file: string) => void;
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
              {activity && <ActivityIcon activity={activity} className="lib-row__icon" style={{ color: activity.color }} />}
              {activity ? activity.name : 'À classer'}
            </span>
            <span className="lib-row__date">{formatDate(startMs)} · {formatTime(startMs)}</span>
          </span>
          <span className="lib-row__stats num">{rowStats(session, activity).join(' · ')}</span>
          {record.notes?.comment && <span className="lib-row__note">{record.notes.comment}</span>}
          {session.warning && <span className="lib-row__warning">{session.warning}</span>}
        </button>
        <SessionPreviewMap session={session} activity={activity} family={family} folderLabel={folderLabel} onOpen={open} />
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
              <Button size="s" variant="ghost" onClick={() => onAskDelete(session.file)}>Supprimer</Button>
            ))}
          </>
        )}
      </div>
    </li>
  );
});

function SessionLibrary({ family }: { family: SportFamily }) {
  // Les champs lus seulement : ni le compteur du balayage ni les messages ne redessinent la liste.
  const library = useLibraryFields('sessions', 'status', 'scanning', 'folderLabel');
  const { title, accent, banner } = FAMILY[family];
  const { activities, families, isShown } = useVisibility();
  /** Famille cachée, ouverte par son adresse : tout y est montré. */
  const familyHidden = !families.includes(family);
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
  const folderHelp = useHelp('biblio:dossier');
  const helpOpen = folderHelp?.open ?? false;
  const [confirmFile, setConfirmFile] = useState<string | null>(null);
  const cancelDelete = useCallback(() => setConfirmFile(null), []);

  /** Activité de chaque session, calculée une fois par liste. */
  const activityByFile = useMemo(
    () => new Map(library.sessions.map((s) => [s.file, activityOf(s, activities)])),
    [library.sessions, activities]
  );
  /** Élément montré : visible, ou de la page d'une famille cachée ; sans activité, toujours. */
  const listed = useCallback(
    (activity: Activity | null | undefined) => familyHidden || !activity || isShown(activity),
    [familyHidden, isShown]
  );
  const allFamilySessions = useMemo(
    () => library.sessions.filter((s) => s.record.sport !== null && sportFamily(s.record.sport) === family),
    [library.sessions, family]
  );
  const familySessions = useMemo(
    () => allFamilySessions.filter((s) => listed(activityByFile.get(s.file))),
    [allFamilySessions, listed, activityByFile]
  );
  const unclassified = useMemo(() => library.sessions.filter((s) => s.record.sport === null), [library.sessions]);
  const allFamilyRoutes = useMemo(() => routesOfFamily(routes, activities, family), [routes, activities, family]);
  const familyRoutes = useMemo(
    () => allFamilyRoutes.filter((r) => listed(routeActivity(r, activities))),
    [allFamilyRoutes, listed, activities]
  );
  /** Éléments d'activités cachées, retirés de la vue. */
  const hiddenCount = planned ? allFamilyRoutes.length - familyRoutes.length : allFamilySessions.length - familySessions.length;
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
  /** Activités nommées dans le bandeau : celles de la famille montrées ici, dans l'ordre de Réglages. */
  const bannerActivities = useMemo(
    () => activitiesOfFamily(activities, family).filter(listed).map((a) => a.name).join(', '),
    [activities, family, listed]
  );
  const FamilyIcon = FAMILY_ICON[family];

  const row = (session: LibrarySession) => (
    <SessionRow
      key={session.file}
      session={session}
      activity={activityByFile.get(session.file) ?? null}
      activities={activities}
      family={family}
      folderLabel={library.folderLabel}
      confirming={confirmFile === session.file}
      onAskDelete={setConfirmFile}
      onCancelDelete={cancelDelete} />
  );

  return (
    <div className="ui-page ui-page--backdrop lib-page" style={{ '--lib-accent': accent, '--help-accent': accent } as React.CSSProperties}>
      <PageBackdrop variant={family} />
      {/* Bandeau photo de la famille : son icône, son nom, ses activités et le nombre de sessions ; « … » en haut à droite. */}
      <header className="lib-banner" style={{ '--banner': `url(${banner})` } as React.CSSProperties}>
        <div className="lib-banner__more">
          {/* Imports et mise à jour, de moindre usage : derrière « … », pour que la liste vienne tout de suite. */}
          <MoreMenu label="Importer, mettre à jour">
            {library.status === 'ready' && (
              <span className="ui-more__note">
                Mémoire : {library.folderLabel ?? 'ce navigateur'}, {library.sessions.length} session{library.sessions.length > 1 ? 's' : ''} en tout
              </span>
            )}
            <ImportButtons />
            <RefreshLibraryButton />
            <Button aria-expanded={helpOpen} onClick={() => folderHelp?.toggle()}>
              <IconHelp size={18} />
              À quoi sert « Ajouter les sessions d'un dossier » ?
            </Button>
          </MoreMenu>
        </div>
        <div className="lib-banner__title">
          <FamilyIcon size={44} />
          <div>
            <h1>{title}</h1>
            {bannerActivities && <p className="lib-banner__activities">{bannerActivities}</p>}
            <p className="lib-banner__count">{familySessions.length} session{familySessions.length > 1 ? 's' : ''}</p>
          </div>
        </div>
      </header>

      <MemoryStatus compact />
      {/* Entraînement : les types d'entraînement en tuiles, avant les sessions (24/10). */}
      {family === 'fractionne' && <TrainingHub />}
      {helpOpen && (
        <p className="lib-hint">
          {native
            ? "« Ajouter les sessions d'un dossier » reprend celles d'un dossier Tracker copié depuis le PC ou un autre téléphone, notes comprises. On peut aussi copier les fichiers directement dans Documents › Tracker › sessions : ils apparaissent avec « Mettre à jour », ou au lancement suivant."
            : "« Ajouter les sessions d'un dossier » reprend celles d'un dossier Tracker copié depuis le téléphone ou un autre PC, notes comprises. Chrome demande alors s'il faut importer les fichiers « sur ce site » : ils restent sur ce PC, Tracker n'envoie rien sur internet. Le dossier mémoire de ce PC, lui, se choisit dans Réglages › Mémoire ; des fichiers copiés dedans pendant que Tracker est ouvert apparaissent avec « Mettre à jour »."}
        </p>
      )}

      {familyHidden && (
        <p className="lib-hint">
          {title} est caché dans <Link to="/parametres">Réglages</Link> : ni proposé, ni dans la barre. Ses sessions restent toutes ici.
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
              <ActivityIcon activity={activity} className="ui-tab__icon" />
              {activity.name} ({count})
            </button>
          ))}
        </div>
      )}

      {hiddenCount > 0 && (
        <p className="lib-hint">
          Activités cachées : {hiddenCount} {planned ? 'itinéraire' : 'session'}{hiddenCount > 1 ? 's' : ''} en moins dans la liste.
          Elles se ré-affichent dans <Link to="/parametres">Réglages</Link>.
        </p>
      )}

      {planned && (shownRoutes.length > 0 || hiddenCount === 0) && (
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
            Traces dont l'activité n'est pas connue : choisissez-la pour les ranger en voile, à pied, à vélo, en surf ou en entraînement. Ouvrir l'une d'elles la demande d'abord.
          </p>
          <ul className="lib-list">{unclassified.map(row)}</ul>
        </Card>
      )}

      {planned ? null : shown.length > 0 ? (
        <ul className="lib-list">{shown.map(row)}</ul>
      ) : (
        library.status === 'ready' && !library.scanning && hiddenCount === 0 && (
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
