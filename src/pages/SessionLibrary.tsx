import { plural } from '../core/basics';
import { weekdayDayMonthYear } from '../core/calendar';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageBackdrop from '../components/PageBackdrop';
import { FAMILY_ICON } from '../components/familyIcons';
import { IconHelp } from '../components/icons';
import ActivityFilterTabs from '../components/ActivityFilterTabs';
import ActivityIcon from '../components/ActivityIcon';
import ActivitySelect, { ActivitySheet } from '../components/ActivitySelect';
import ImportButtons from '../components/ImportButtons';
import { useHelp } from '../components/helpContext';
import MemoryStatus from '../components/MemoryStatus';
import RefreshLibraryButton from '../components/RefreshLibraryButton';
import SessionRenameField from '../components/SessionRenameField';
import RouteList from '../components/RouteList';
import TrainingHub from '../components/TrainingHub';
import { sessionColorTrack, sessionSpeedRange, type SessionColorTrack } from '../library/sessionTrack';
import { drawTrackPreview, thinForPreview, trackPreviewView } from '../components/drawTrackPreview';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import MoreMenu from '../components/ui/MoreMenu';
import { PREVIEW_MAX_POINTS } from '../core/displayConfig';
import { coloredSegments } from '../core/trackColor';
import { createHeldCache } from '../core/heldCache';
import { FAMILY_ACCENT, FAMILY_LABEL, activitiesOfFamily, activityCounts, sessionActivity, type Activity } from '../core/activities';
import { smoothHeartRate } from '../core/heartRate';
import { heartRatePointsFrom, heartRatePreviewPath, repsDone } from '../core/heartRateSession';
import { parseGpx } from '../core/gpxParser';
import { getSportProfile, hasPositions, sportFamily, sportTreatment, type SportFamily } from '../core/sportProfiles';
import { HEART_RATE_COLOR } from '../components/heartRateColors';
import { formatDuration, formatShortDuration, formatLandSpeed, formatSpeed, formatDistanceAuto } from '../core/units';
import { useOpenSession } from '../hooks/useLibraryNavigation';
import { useElementSize } from '../hooks/useElementSize';
import { useNearViewport } from '../hooks/useNearViewport';
import { useRouteLibrary } from '../hooks/useRouteLibrary';
import { useAppliedTheme, useThemedShade } from '../hooks/useTheme';
import { readSessionGpx, removeSession, updateSessionRecord, useLibraryFields } from '../hooks/useSessionLibrary';
import { PLANNING_FAMILIES } from '../settings/activitySettings';
import { activitySpeedRanges, effectiveDistanceUnit, effectiveSpeedUnit, useVisibility } from '../hooks/useSportSettings';
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

/** Tournure de chaque famille dans « Aucune session … » et photo de son bandeau (refonte du 22/10) ; nom et couleur : `FAMILY_LABEL`, `FAMILY_ACCENT`. */
const FAMILY: Record<SportFamily, { title: string; accent: string; of: string; banner: string }> = {
  voile: { title: FAMILY_LABEL.voile, accent: FAMILY_ACCENT.voile, of: 'de voile', banner: bannerVoile },
  course: { title: FAMILY_LABEL.course, accent: FAMILY_ACCENT.course, of: 'à pied', banner: bannerCourse },
  velo: { title: FAMILY_LABEL.velo, accent: FAMILY_ACCENT.velo, of: 'de vélo', banner: bannerVelo },
  fractionne: { title: FAMILY_LABEL.fractionne, accent: FAMILY_ACCENT.fractionne, of: "d'entraînement", banner: bannerFractionne },
  surf: { title: FAMILY_LABEL.surf, accent: FAMILY_ACCENT.surf, of: 'de surf', banner: bannerSurf },
};

/** Activité d'une session d'après sa fiche (`sessionActivity`), `null` pour une session à classer. */
const activityOf = (session: LibrarySession, activities: Activity[]): Activity | null =>
  sessionActivity(activities, session.record.activityId, session.record.sport);

const formatTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });


/** Chiffres d'une ligne, selon le traitement de son calcul. */
const rowStats = (session: LibrarySession, activity: Activity | null): string[] => {
  const { summary } = session.record;
  // Sans trace (muscu, lot I du 25/10) : durée, FC moyenne et max, répétitions ; ni distance ni vitesse.
  if (session.record.sport !== null && !hasPositions(session.record.sport)) {
    const stats = [formatDuration(summary.endMs - summary.startMs)];
    if (summary.heartRate) stats.push(`FC moy. ${summary.heartRate.avgBpm}`, `FC max ${summary.heartRate.maxBpm}`);
    const reps = repsDone(session.record.intervals);
    if (reps > 0) stats.push(`${reps} rép.`);
    return stats;
  }
  const distanceUnit = activity ? effectiveDistanceUnit(activity) : 'km';
  const stats = [formatDuration(summary.endMs - summary.startMs), formatDistanceAuto(summary.distanceM, distanceUnit)];
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
    if (summary.test.lastStepSpeedMs !== null) stats.push(formatLandSpeed(summary.test.lastStepSpeedMs, effectiveSpeedUnit(activity), distanceUnit));
  } else {
    if (summary.movingTimeS && summary.distanceM > 0) {
      stats.push(formatLandSpeed(summary.distanceM / summary.movingTimeS, effectiveSpeedUnit(activity), distanceUnit));
    }
    if (summary.elevationGainM !== null) stats.push(`D+ ${Math.round(summary.elevationGainM)} m`);
  }
  // Répétitions du compteur, quand la session en a (fractionné).
  const reps = repsDone(session.record.intervals);
  if (reps > 0) stats.push(`${reps} rép.`);
  return stats;
};

/** Courbes de FC des vignettes sans trace (muscu), déjà calculées : comme `previewCache`. */
const heartPreviewCache = new Map<string, string | null>();

/** Cadre de la courbe de FC d'une vignette, en unités du dessin (étiré à la vignette). */
const HEART_PREVIEW_VIEW = { width: 200, height: 100 } as const;

/**
 * Vignette d'une session sans trace (muscu, lot I du 25/10, question 1 : la
 * courbe de FC à la place de la carte), lue quand la ligne approche de
 * l'écran, une fois ; un toucher ouvre l'analyse, comme la carte.
 */
function SessionHeartRatePreview({ session, folderLabel, onOpen }: { session: LibrarySession; folderLabel: string | null; onOpen: () => void }) {
  const frame = useRef<HTMLDivElement>(null);
  const { file } = session;
  const sport = session.record.sport;
  const cacheKey = `${folderLabel}|${file}|${sport}`;
  const near = useNearViewport(frame, heartPreviewCache.has(cacheKey), PREVIEW_PRELOAD_MARGIN);
  const [path, setPath] = useState<string | null | undefined>(() => heartPreviewCache.get(cacheKey));

  useEffect(() => {
    if (!near || heartPreviewCache.has(cacheKey) || sport === null) return;
    let cancelled = false;
    void (async () => {
      const gpx = await readSessionGpx(file);
      if (cancelled) return;
      let drawn: string | null = null;
      try {
        if (gpx !== null) {
          const points = heartRatePointsFrom(parseGpx(gpx).timedPoints);
          const { smoothS, gapS } = getSportProfile(sport).heartRate;
          drawn = heartRatePreviewPath(points, smoothHeartRate(points, smoothS, gapS), HEART_PREVIEW_VIEW.width, HEART_PREVIEW_VIEW.height, PREVIEW_MAX_POINTS);
        }
      } catch {
        drawn = null;
      }
      heartPreviewCache.set(cacheKey, drawn);
      setPath(drawn);
    })();
    return () => { cancelled = true; };
  }, [near, file, sport, cacheKey]);

  return (
    <div ref={frame} className="lib-row__preview" role="link" aria-label="Ouvrir l'analyse" onClick={onOpen}>
      {path ? (
        <svg viewBox={`0 0 ${HEART_PREVIEW_VIEW.width} ${HEART_PREVIEW_VIEW.height}`} preserveAspectRatio="none" aria-hidden="true"
          style={{ position: 'absolute', inset: '12% 6%', width: '88%', height: '76%', overflow: 'visible' }}>
          <path d={path} fill="none" stroke={HEART_RATE_COLOR} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
      ) : (
        <span className="lib-row__preview-status">{path === null ? 'Courbe indisponible' : 'FC…'}</span>
      )}
    </div>
  );
}

/** Marge sous l'écran où une vignette se charge déjà, pour être prête quand on y arrive. */
const PREVIEW_PRELOAD_MARGIN = '200px';

/**
 * Ce qu'il faut savoir d'une trace pour cadrer et colorer sa vignette :
 * emprise et, en voile, bornes suggérées par l'allure. La clé tient tout ce
 * dont la trace dépend ; un GPX rangé n'est jamais réécrit.
 */
type PreviewMeta = Pick<SessionColorTrack, 'bounds' | 'suggested'>;
const previewMeta = new Map<string, PreviewMeta>();
const PREVIEW_META_MAX = 400;

/**
 * Points des vignettes déjà calculées (E-O7) : revenir sur la bibliothèque, ou
 * changer de bornes ou de taille, ne relit ni ne réanalyse le GPX. Chaque
 * trace est gardée réduite au zoom de sa vignette (`zoom`) ; une vignette
 * d'un zoom plus fort relit le GPX. Au plus `PREVIEW_POINTS_MAX` points en
 * tout, les moins récents oubliés d'abord.
 */
const previewPoints = new Map<string, { points: SessionColorTrack['points']; zoom: number }>();
const PREVIEW_POINTS_MAX = 400_000;
let previewPointCount = 0;

const rememberMeta = (key: string, meta: PreviewMeta): void => {
  previewMeta.delete(key);
  if (previewMeta.size >= PREVIEW_META_MAX) previewMeta.delete(previewMeta.keys().next().value!);
  previewMeta.set(key, meta);
};

const rememberPoints = (key: string, points: SessionColorTrack['points'], zoom: number): void => {
  previewPointCount -= previewPoints.get(key)?.points.length ?? 0;
  previewPoints.delete(key);
  previewPoints.set(key, { points, zoom });
  previewPointCount += points.length;
  for (const [oldest, entry] of previewPoints) {
    if (previewPointCount <= PREVIEW_POINTS_MAX || oldest === key) break;
    previewPoints.delete(oldest);
    previewPointCount -= entry.points.length;
  }
};

/**
 * Vignettes dessinées (PNG en adresse d'objet), en mémoire le temps de la
 * page seulement : ni dans la fiche ni dans un cache de l'appareil. La clé
 * tient la session, la taille, la densité de l'écran, le thème économe et les
 * bornes de couleur ; une vignette affichée n'est jamais libérée.
 */
const previewImages = createHeldCache<string>(200, (url) => URL.revokeObjectURL(url));

/**
 * Vignette carte d'une session, toujours affichée à droite de ses chiffres :
 * quand la ligne approche de l'écran, le GPX est relu une fois, et la trace,
 * réduite au demi-pixel près à l'échelle de la vignette, est dessinée sur son
 * fond en une image fixe (`drawTrackPreview`), au cadrage et à la coloration
 * de l'analyse ; redessinée seulement si la vignette change de taille ou la
 * trace de bornes. Aucune carte vivante : une longue bibliothèque reste
 * légère. Un toucher ouvre l'analyse. En économe (décision du 28/10), la
 * trace seule, sur le fond noir des cartes de la page, sans le plan d'OSM.
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
  const { eco } = useAppliedTheme();
  const size = useElementSize(frame);
  const { file } = session;
  const sport = session.record.sport;
  const referenceOverrideMs = session.record.analysis?.referenceSpeedMs ?? null;
  const cacheKey = `${folderLabel}|${file}|${sport}|${referenceOverrideMs}|${family}`;
  /** Emprise et bornes suggérées tirées du GPX par cette vignette, pour sa clé. */
  const [loaded, setLoaded] = useState<{ key: string; meta: PreviewMeta } | null>(null);
  const meta = previewMeta.get(cacheKey) ?? (loaded?.key === cacheKey ? loaded.meta : null);
  // Déjà calculée, rien à attendre.
  const near = useNearViewport(frame, meta !== null, PREVIEW_PRELOAD_MARGIN);
  const [image, setImage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  /** Trace colorée tirée du GPX, comme l'analyse la calcule, gardée pour la vignette ; `null` si elle manque ou est illisible. */
  const loadTrack = useCallback(async (): Promise<SessionColorTrack | null> => {
    const gpx = await readSessionGpx(file);
    if (gpx === null) return null;
    try {
      const track = sessionColorTrack(gpx, sport, referenceOverrideMs, family);
      if (track) {
        rememberMeta(cacheKey, { bounds: track.bounds, suggested: track.suggested });
        // Points entiers, réduits au premier dessin.
        rememberPoints(cacheKey, track.points, Infinity);
      }
      return track;
    } catch {
      return null;
    }
  }, [file, sport, referenceOverrideMs, family, cacheKey]);

  useEffect(() => {
    if (!near || meta) return undefined;
    let cancelled = false;
    void loadTrack().then((track) => {
      if (cancelled) return;
      if (track) setLoaded({ key: cacheKey, meta: { bounds: track.bounds, suggested: track.suggested } });
      else setFailed(true);
    });
    return () => { cancelled = true; };
  }, [near, meta, cacheKey, loadTrack]);

  const range = useMemo(
    () => (meta ? sessionSpeedRange(session.record, activity ? activitySpeedRanges(activity) : null, family, meta.suggested) : null),
    [meta, session, activity, family]
  );
  const width = size?.width ?? 0;
  const height = size?.height ?? 0;
  const minMs = range?.minMs ?? null;
  const maxMs = range?.maxMs ?? null;

  useEffect(() => {
    if (!meta || minMs === null || maxMs === null || width < 1 || height < 1) return undefined;
    const view = trackPreviewView(meta.bounds, width, height);
    if (!view) return undefined;
    const pixelRatio = window.devicePixelRatio || 1;
    const imageKey = `${cacheKey}|${width}x${height}@${pixelRatio}|${eco ? 'econome' : 'plan'}|${minMs}|${maxMs}`;
    const controller = new AbortController();
    let held = false;
    let draft: string | null = null;
    const dropDraft = () => {
      if (draft) URL.revokeObjectURL(draft);
      draft = null;
    };
    void (async () => {
      const cached = previewImages.acquire(imageKey);
      if (cached) {
        held = true;
        setImage(cached);
        return;
      }
      let stored = previewPoints.get(cacheKey);
      if (!stored || stored.zoom < view.zoom) {
        const track = await loadTrack();
        stored = track ? { points: track.points, zoom: Infinity } : undefined;
      }
      if (controller.signal.aborted) return;
      if (!stored) {
        setFailed(true);
        return;
      }
      // Réduite une fois au zoom de la vignette, puis gardée ainsi.
      const points = stored.zoom === view.zoom ? stored.points : thinForPreview(stored.points, view);
      if (stored.zoom !== view.zoom) rememberPoints(cacheKey, points, view.zoom);
      const png = await drawTrackPreview(
        { view, segments: coloredSegments(points, { minMs, maxMs }), pixelRatio, withMap: !eco },
        {
          signal: controller.signal,
          onTrace: (trace) => {
            dropDraft();
            draft = URL.createObjectURL(trace);
            setImage(draft);
          },
        }
      );
      if (controller.signal.aborted || !png) return;
      held = true;
      setImage(previewImages.put(imageKey, URL.createObjectURL(png)));
      // L'image d'attente, remplacée, part après le rendu.
      setTimeout(dropDraft, 0);
    })();
    return () => {
      controller.abort();
      dropDraft();
      if (held) previewImages.release(imageKey);
    };
  }, [meta, minMs, maxMs, width, height, eco, cacheKey, loadTrack]);

  return (
    <div ref={frame} className="lib-row__preview" role="link" aria-label="Ouvrir l'analyse" onClick={onOpen}>
      {image ? (
        <>
          <img className="lib-row__preview-image" src={image} alt="" draggable={false} />
          {/* Mention qu'exigent les conditions d'usage d'OSM, comme celle de Leaflet (`MAP_BASES.plan.attribution`), sans lien : un toucher ouvre l'analyse. */}
          {!eco && <span className="lib-row__preview-credit">© <span className="lib-row__preview-credit-name">OpenStreetMap</span></span>}
        </>
      ) : (
        <span className="lib-row__preview-status">{failed ? 'Carte indisponible' : 'Carte…'}</span>
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
  const shown = useThemedShade();
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
              {activity && <ActivityIcon activity={activity} className="lib-row__icon" style={{ color: shown(activity.color) }} />}
              {activity ? activity.name : 'À classer'}
            </span>
            <span className="lib-row__date">{weekdayDayMonthYear(startMs)} · {formatTime(startMs)}</span>
          </span>
          <span className="lib-row__stats num">{rowStats(session, activity).join(' · ')}</span>
          {record.notes?.comment && <span className="lib-row__note">{record.notes.comment}</span>}
          {session.warning && <span className="lib-row__warning">{session.warning}</span>}
        </button>
        {record.sport !== null && !hasPositions(record.sport)
          ? <SessionHeartRatePreview session={session} folderLabel={folderLabel} onOpen={open} />
          : <SessionPreviewMap session={session} activity={activity} family={family} folderLabel={folderLabel} onOpen={open} />}
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
            <SessionRenameField value={nameDraft} onChange={setNameDraft} onSave={saveName} onCancel={() => setNameDraft(null)}
              className="ui-field ui-field--s lib-row__rename" />
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

/**
 * Résumés refaits en tâche de fond (version du calcul, réglage d'activité changé), lot 37 : une
 * ligne tant qu'il en reste, lue à part pour que le compteur ne redessine pas la liste.
 */
function OutdatedSummaries() {
  const { toUpdate } = useLibraryFields('toUpdate');
  if (toUpdate <= 0) return null;
  return <p className="ui-hint ui-hint--m">{plural(toUpdate, 'session')} à mettre à jour</p>;
}

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
    <div className="ui-page ui-page--backdrop lib-page" style={{ '--lib-accent': accent, '--help-accent': accent, ...(family === 'fractionne' ? { '--btn-accent': accent } : {}) } as React.CSSProperties}>
      <PageBackdrop variant={family} />
      {/* Bandeau photo de la famille : son icône, son nom, ses activités et le nombre de sessions ; « … » en haut à droite. */}
      <header className="ui-photo-banner lib-banner" style={{ '--banner': `url(${banner})` } as React.CSSProperties}>
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
      <OutdatedSummaries />
      {/* Entraînement : les types d'entraînement en tuiles, avant les sessions (24/10). */}
      {family === 'fractionne' && <TrainingHub />}
      {helpOpen && (
        <p className="ui-hint ui-hint--m">
          {native
            ? "« Ajouter les sessions d'un dossier » reprend celles d'un dossier Tracker copié depuis le PC ou un autre téléphone, notes comprises. On peut aussi copier les fichiers directement dans Documents › Tracker › sessions : ils apparaissent avec « Mettre à jour », ou au lancement suivant."
            : "« Ajouter les sessions d'un dossier » reprend celles d'un dossier Tracker copié depuis le téléphone ou un autre PC, notes comprises. Chrome demande alors s'il faut importer les fichiers « sur ce site » : ils restent sur ce PC, Tracker n'envoie rien sur internet. Le dossier mémoire de ce PC, lui, se choisit dans Réglages › Mémoire ; des fichiers copiés dedans pendant que Tracker est ouvert apparaissent avec « Mettre à jour »."}
        </p>
      )}

      {familyHidden && (
        <p className="ui-hint ui-hint--m">
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
        <ActivityFilterTabs total={planned ? familyRoutes.length : familySessions.length} counts={counts} accent={accent}
          selected={activeFilter === 'all' ? null : activeFilter} onSelect={(id) => setFilter(id ?? 'all')} />
      )}

      {hiddenCount > 0 && (
        <p className="ui-hint ui-hint--m">
          Activités cachées : {hiddenCount} {planned ? 'itinéraire' : 'session'}{hiddenCount > 1 ? 's' : ''} en moins dans la liste.
          Elles se ré-affichent dans <Link to="/parametres">Réglages</Link>.
        </p>
      )}

      {planned && (shownRoutes.length > 0 || hiddenCount === 0) && (
        <Card>
          {shownRoutes.length > 0 ? (
            <RouteList routes={shownRoutes} activities={activities} />
          ) : (
            <p className="ui-hint ui-hint--m">
              Aucun itinéraire {FAMILY[family].of} pour l'instant.{' '}
              <Link to="/itineraires">Planifiez-en un</Link> et rangez-le sous une de ces activités : il apparaîtra ici.
            </p>
          )}
        </Card>
      )}

      {!planned && unclassified.length > 0 && (
        <Card heading="À classer">
          <p className="ui-hint ui-hint--m">
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
            <p className="ui-hint ui-hint--m">
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
