import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { MapContainer, Polyline, TileLayer } from 'react-leaflet';
import { useSearchParams } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import MapAutoResize from '../components/MapAutoResize';
import MemoryStatus from '../components/MemoryStatus';
import { IconChevronRight, IconFile } from '../components/icons';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import HelpButton from '../components/ui/HelpButton';
import PageHeader from '../components/ui/PageHeader';
import { trackBounds } from '../core/displayConfig';
import { parseGpx } from '../core/gpxParser';
import { computeKinematics } from '../core/kinematics';
import { referenceSpeedMs as sessionReferenceSpeedMs } from '../core/sessionSpeed';
import { isValidSpeedRange, speedGradientColor } from '../core/speedGradient';
import { activitiesOfFamily, sessionActivity, type Activity } from '../core/activities';
import { sportFamily, type SportFamily } from '../core/sportProfiles';
import type { RawTrackPoint, TrackPoint } from '../core/types';
import { formatDistance, formatDuration, formatSpeed, knotsToMs, msToKnots, toDisplayDistance } from '../core/units';
import { useOpenSession } from '../hooks/useLibraryNavigation';
import { importFiles, importFromFolder, readSessionGpx, removeSession, updateSessionRecord, useSessionLibrary } from '../hooks/useSessionLibrary';
import { effectiveDistanceUnit, effectiveSpeedUnit, readStoredActivities, readStoredSettings } from '../hooks/useSportSettings';
import type { LibrarySession } from '../library/record';
import { isNativeApp } from '../platform/runtime';
import { DEFAULT_SPEED_RANGE_MS } from '../running/runningAnalytics';
import { DEFAULT_SAILING_SPEED_RANGE_MS, SPEED_RANGE_MAX_MARGIN_KN, suggestActiveThresholdKn } from '../sailing/sailingConfig';
import './SessionLibrary.css';

/**
 * Bibliothèque d'une famille : les onglets Voile et Course. La liste des
 * sessions de la mémoire, filtrable par activité (`?activite=<id>` pour
 * arriver filtré, depuis l'accueil), les sessions à classer, l'import de GPX
 * ou d'un dossier entier, la suppression.
 */

const FAMILY: Record<SportFamily, { title: string; accent: string }> = {
  voile: { title: 'Voile', accent: 'var(--voile)' },
  course: { title: 'Course à pied', accent: 'var(--course)' },
};

/** Activité d'une session d'après sa fiche (`sessionActivity`), `null` pour une session à classer. */
const activityOf = (session: LibrarySession, activities: Activity[]): Activity | null =>
  sessionActivity(activities, session.record.activityId, session.record.sport);

const formatDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

const formatTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });


/** Chiffres d'une ligne, selon la famille. */
const rowStats = (session: LibrarySession, activity: Activity | null): string[] => {
  const { summary } = session.record;
  // Deux décimales sous 10 unités, une au-delà.
  const distanceUnit = activity ? effectiveDistanceUnit(activity) : 'km';
  const decimals = toDisplayDistance(summary.distanceM, distanceUnit) < 10 ? 2 : 1;
  const stats = [formatDuration(summary.endMs - summary.startMs), formatDistance(summary.distanceM, distanceUnit, decimals)];
  if (activity === null) return stats;
  if (sportFamily(activity.base) === 'voile') {
    stats.push(`max ${formatSpeed(summary.maxSpeedMs, effectiveSpeedUnit(activity))}`);
    if (summary.maneuverCount !== undefined) stats.push(`${summary.maneuverCount} manœuvres`);
  } else {
    if (summary.movingTimeS && summary.distanceM > 0) {
      stats.push(formatSpeed(summary.distanceM / summary.movingTimeS, effectiveSpeedUnit(activity)));
    }
    if (summary.elevationGainM !== null) stats.push(`D+ ${Math.round(summary.elevationGainM)} m`);
  }
  return stats;
};

/**
 * Bornes de couleur d'une vignette d'aperçu, dans cet ordre, comme le module d'analyse :
 * 0. celles enregistrées dans la fiche de la session (`analysis.speedRange`) ;
 * 1. celles réglées pour son activité dans Réglages (`tracker.sportSettings`) ;
 * 2. en voile, les bornes suggérées par l'allure de la session, comme le module d'analyse :
 *    seuil d'activité suggéré en bas, pic de vitesse déjà enregistré dans la fiche
 *    (`summary.maxSpeedMs`) plus une marge en haut — l'allure vient de la fiche si elle a été
 *    imposée, sinon des points bruts du GPX qu'on vient de lire ;
 * 3. à défaut (course, support inconnu, ou pic non mesuré), le défaut de la famille.
 */
const previewSpeedRange = (
  session: LibrarySession,
  activity: Activity | null,
  family: SportFamily,
  rawPoints: RawTrackPoint[]
): { minMs: number; maxMs: number } => {
  const { record } = session;
  if (record.analysis?.speedRange) return record.analysis.speedRange;
  if (activity) {
    const override = readStoredSettings().speedRanges?.[activity.id];
    if (override && isValidSpeedRange(override)) return override;
  }
  if (record.sport && family === 'voile' && record.summary.maxSpeedMs > 0) {
    const referenceKn = msToKnots(record.analysis?.referenceSpeedMs ?? sessionReferenceSpeedMs(rawPoints));
    return {
      minMs: knotsToMs(suggestActiveThresholdKn(record.sport, referenceKn)),
      maxMs: record.summary.maxSpeedMs + knotsToMs(SPEED_RANGE_MAX_MARGIN_KN),
    };
  }
  return family === 'voile' ? DEFAULT_SAILING_SPEED_RANGE_MS : DEFAULT_SPEED_RANGE_MS;
};

/** Aperçu carte d'une session, chargé et analysé à la demande (aucun point de trace en mémoire avant). */
function SessionPreviewMap({ session, activity, family }: { session: LibrarySession; activity: Activity | null; family: SportFamily }) {
  const [track, setTrack] = useState<TrackPoint[] | null>(null);
  const [range, setRange] = useState<{ minMs: number; maxMs: number } | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const gpx = await readSessionGpx(session.file);
      if (cancelled) return;
      if (gpx === null) { setStatus('error'); return; }
      try {
        const { rawPoints } = parseGpx(gpx);
        const points = computeKinematics(rawPoints);
        if (points.length < 2) { setStatus('error'); return; }
        setTrack(points);
        setRange(previewSpeedRange(session, activity, family, rawPoints));
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [session, activity, family]);

  if (status === 'loading') return <div className="lib-row__preview-status">Chargement de la carte…</div>;
  if (status === 'error' || track === null || range === null) return <div className="lib-row__preview-status">Carte indisponible.</div>;

  const { minMs, maxMs } = range;
  return (
    <MapContainer
      bounds={trackBounds(track) ?? undefined}
      boundsOptions={{ padding: [12, 12], maxZoom: 17 }}
      style={{ height: '160px', width: '100%' }}
      zoomControl={false}
      attributionControl={false}>
      <MapAutoResize />
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {track.slice(1).map((point, index) => (
        <Polyline
          key={index}
          positions={[[track[index].lat, track[index].lon], [point.lat, point.lon]]}
          pathOptions={{ color: speedGradientColor(point.smoothedSpeedMs, minMs, maxMs), weight: 4 }} />
      ))}
    </MapContainer>
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
  const [previewOpen, setPreviewOpen] = useState(false);
  /** Une fois monté, l'aperçu reste en vie (juste masqué) pour ne pas relire le GPX à chaque redépli. */
  const [previewMounted, setPreviewMounted] = useState(false);
  /** Nom en cours de saisie ; `null` hors renommage. */
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  const saveName = () => {
    if (nameDraft === null) return;
    updateSessionRecord(session.file, { name: nameDraft });
    setNameDraft(null);
  };

  return (
    <li className="lib-row">
      <div className="lib-row__head-line">
        <button type="button" className="lib-row__main" onClick={() => openSession(session.file, family)}>
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
          <IconChevronRight className="lib-row__chevron" />
        </button>
        <button
          type="button"
          className="lib-row__preview-toggle"
          aria-expanded={previewOpen}
          aria-label={previewOpen ? 'Masquer l\'aperçu carte' : 'Aperçu carte'}
          onClick={() => { setPreviewOpen((open) => !open); setPreviewMounted(true); }}>
          <IconChevronRight style={{ transform: previewOpen ? 'rotate(90deg)' : undefined }} />
        </button>
      </div>

      {previewMounted && (
        <div className="lib-row__preview" style={previewOpen ? undefined : { display: 'none' }}>
          <SessionPreviewMap session={session} activity={activity} family={family} />
        </div>
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
              <select
                className="ui-field ui-field--s"
                value=""
                aria-label="Classer la session"
                onChange={(e) => {
                  const chosen = activities.find((a) => a.id === e.target.value);
                  if (chosen) updateSessionRecord(session.file, { sport: chosen.base, activityId: chosen.id });
                }}>
                <option value="" disabled>Classer…</option>
                {(['voile', 'course'] as const).map((f) => (
                  <optgroup key={f} label={FAMILY[f].title}>
                    {activitiesOfFamily(activities, f).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </optgroup>
                ))}
              </select>
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
  const [params] = useSearchParams();
  const [filter, setFilter] = useState<string>(() => params.get('activite') ?? 'all');
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmFile, setConfirmFile] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

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
  /** Activités présentes dans la liste, dans l'ordre de Réglages puis celles de base, avec leur nombre de sessions. */
  const counts = useMemo(() => {
    const byId = new Map<string, { activity: Activity; count: number }>();
    for (const a of activitiesOfFamily(activities, family)) byId.set(a.id, { activity: a, count: 0 });
    for (const s of familySessions) {
      const a = activityByFile.get(s.file);
      if (!a) continue;
      const entry = byId.get(a.id) ?? { activity: a, count: 0 };
      byId.set(a.id, { ...entry, count: entry.count + 1 });
    }
    return [...byId.values()].filter((e) => e.count > 0);
  }, [activities, family, familySessions, activityByFile]);
  // Une activité sans session ici (ou seule, donc sans onglets) : « tous », jamais une liste vide sans issue.
  const activeFilter = counts.length > 1 && counts.some((c) => c.activity.id === filter) ? filter : 'all';
  const shown = activeFilter === 'all' ? familySessions : familySessions.filter((s) => activityByFile.get(s.file)?.id === activeFilter);
  const canImport = library.status === 'ready' || library.pendingCount > 0 || library.status === 'unavailable';

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? [...event.target.files] : [];
    event.target.value = '';
    if (files.length === 0) return;
    setImporting(true);
    try {
      await importFiles(files);
    } finally {
      setImporting(false);
    }
  };

  const handleNativeFolder = async () => {
    setImporting(true);
    try {
      await importFromFolder();
    } finally {
      setImporting(false);
    }
  };

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
        <label className={`ui-btn ui-btn--secondary${!canImport || importing ? ' lib-disabled' : ''}`}>
          <IconFile size={18} />
          {importing ? 'Import en cours…' : 'Importer des GPX'}
          <input type="file" accept=".gpx" multiple hidden disabled={!canImport || importing} onChange={handleImport} />
        </label>
        {native ? (
          <Button disabled={!canImport || importing} onClick={() => void handleNativeFolder()}>
            Ajouter les sessions d'un dossier
          </Button>
        ) : (
          <label className={`ui-btn ui-btn--secondary${!canImport || importing ? ' lib-disabled' : ''}`}>
            Ajouter les sessions d'un dossier
            <input
              type="file"
              multiple
              hidden
              disabled={!canImport || importing}
              ref={(el) => el?.setAttribute('webkitdirectory', '')}
              onChange={handleImport} />
          </label>
        )}
        <HelpButton
          open={helpOpen}
          onToggle={() => setHelpOpen(!helpOpen)}
          label="À quoi sert « Ajouter les sessions d'un dossier » ?" />
      </div>
      {helpOpen && (
        <p className="lib-hint">
          {native
            ? "« Ajouter les sessions d'un dossier » reprend celles d'un dossier Tracker copié depuis le PC ou un autre téléphone, notes comprises. On peut aussi copier les fichiers directement dans Documents › Tracker › sessions : ils apparaissent au lancement suivant."
            : "« Ajouter les sessions d'un dossier » reprend celles d'un dossier Tracker copié depuis le téléphone ou un autre PC, notes comprises. Chrome demande alors s'il faut importer les fichiers « sur ce site » : ils restent sur ce PC, Tracker n'envoie rien sur internet. Le dossier mémoire de ce PC, lui, se choisit dans Réglages › Mémoire."}
        </p>
      )}

      {counts.length > 1 && (
        <div className="ui-tabs" style={{ '--tab-accent': accent } as React.CSSProperties}>
          <button type="button" className="ui-tab" aria-pressed={activeFilter === 'all'} onClick={() => setFilter('all')}>
            tous ({familySessions.length})
          </button>
          {counts.map(({ activity, count }) => (
            <button key={activity.id} type="button" className="ui-tab" aria-pressed={activeFilter === activity.id} onClick={() => setFilter(activity.id)}>
              {activity.name} ({count})
            </button>
          ))}
        </div>
      )}

      {unclassified.length > 0 && (
        <Card heading="À classer">
          <p className="lib-hint">
            Traces dont l'activité n'est pas connue : choisissez-la pour les ranger en voile ou en course.
          </p>
          <ul className="lib-list">{unclassified.map(row)}</ul>
        </Card>
      )}

      {shown.length > 0 ? (
        <ul className="lib-list">{shown.map(row)}</ul>
      ) : (
        library.status === 'ready' && !library.scanning && (
          <Card>
            <p className="lib-hint">
              Aucune session {family === 'voile' ? 'de voile' : 'de course'} pour l'instant. Enregistrez-en une, ou
              importez des GPX : ils sont rangés dans la mémoire et analysés ici.
            </p>
          </Card>
        )
      )}
    </div>
  );
}

export default SessionLibrary;
