import { errorMessage } from '../core/basics';
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ReferenceArea } from 'recharts';
import './analysisMobile.css';
import ActivitySelect from '../components/ActivitySelect';
import CollapsibleSectionTabs from '../components/CollapsibleSectionTabs';
import EmptyTabPanel from '../components/EmptyTabPanel';
import GeneralStats from '../components/GeneralStats';
import HeartRatePanel, { CardioCurve } from '../components/HeartRatePanel';
import { HelpText } from '../components/Help';
import { zoneLabel } from '../components/heartRateColors';
import { markReferenceLines } from '../components/markReferenceLines';
import PanelTitle, { SessionDate } from '../components/PanelTitle';
import ResizablePanel from '../components/ResizablePanel';
import { SessionMarksList } from '../components/SessionMarks';
import SessionNameEditor from '../components/SessionNameEditor';
import SessionNotesPanel, { type GearField } from '../components/SessionNotesPanel';
import SessionSaveBar from '../components/SessionSaveBar';
import { CARD_STYLE, HALF_PANEL_STYLE } from '../components/styles';
import PageHeader from '../components/ui/PageHeader';
import StatTile from '../components/ui/StatTile';
import { MUSCU_TABS, tabDefaults } from '../core/analysisTabs';
import { parseGpx } from '../core/gpxParser';
import { analyzeHeartRateSession, heartRatePointsFrom, type HeartRateSessionPoint, type SessionPhase } from '../core/heartRateSession';
import { shareableStats, type ShareStat } from '../core/shareImage';
import { hasPositions } from '../core/sportProfiles';
import { formatDuration } from '../core/units';
import { useAnalysisSession } from '../hooks/useAnalysisSession';
import { useAnalysisTabs } from '../hooks/useAnalysisTabs';
import { zoomHint } from '../components/zoomHint';
import { useTimeChartAxis } from '../hooks/useTimeChartAxis';
import { libraryPath } from '../hooks/useLibraryNavigation';
import { useNarrowScreen } from '../hooks/useNarrowScreen';
import { useAnalysisHeart } from '../hooks/useAnalysisHeart';
import { useLibrarySession } from '../hooks/useSessionLibrary';
import { useSessionMarks } from '../hooks/useSessionMarks';
import { useSportSettings } from '../hooks/useSportSettings';
import type { IntervalSeries } from '../recording/intervalTimer';
import { SPEED_COLOR } from '../components/chartStyle';

/**
 * Analyse d'une session sans trace (muscu, lot I du 25/10) : la page
 * d'analyse de l'Entraînement sans la rangée de la carte
 * (`docs/MISE_EN_PAGE.md`), montée par `/fractionne/analyse` quand le calcul
 * de la session est sans position (`App.tsx`). « Général » : durée, FC
 * moyenne et max, répétitions faites, temps par zone, et la courbe de FC avec
 * les phases du compteur posées dessus (`record.intervals`) et les repères du
 * bouton « Note » ; « cardio » : le panneau commun, sans carte ; « matériel et
 * notes » ; « réglages » : l'activité, vers une autre activité sans trace
 * seulement.
 */

const FAMILY = 'fractionne' as const;
const PAGE = { title: 'Analyse muscu', backLabel: 'Entraînement', accent: 'var(--fractionne)', storageId: 'muscu' } as const;
const MUSCU_SECTION_DEFAULTS = tabDefaults(MUSCU_TABS);
const NO_INTERVALS: IntervalSeries[] = [];
const NO_POINTS: HeartRateSessionPoint[] = [];

/** Phases du compteur sur la courbe : couleurs de données, en dur, et leur nom dans la clé. */
const PHASE_STYLE: Record<SessionPhase['kind'], { color: string; opacity: number; label: string }> = {
  travail: { color: '#ef6c00', opacity: 0.18, label: 'travail' },
  repos: { color: SPEED_COLOR, opacity: 0.12, label: 'récupération' },
  libre: { color: '#757575', opacity: 0.1, label: 'bloc libre' },
};

const gearFields = (labels: [string, string]): GearField[] => [
  { field: 'gear1', label: labels[0], placeholder: 'ex. charges, machine' },
  { field: 'gear2', label: labels[1], placeholder: 'ex. modèle, taille' },
];

/** Session lue : son fichier, et ses points à l'heure (sans position). */
interface LoadedSession {
  file: string;
  points: HeartRateSessionPoint[];
}

function MuscuModule() {
  const panelId = (name: string) => `${PAGE.storageId}.${name}`;
  const { activity, setActivity, profile, hrOffsetBpm, gearLabels, gearGroups } = useSportSettings(FAMILY);
  const narrow = useNarrowScreen();

  const [loaded, setLoaded] = useState<LoadedSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Lecture du GPX de la session : ses points à l'heure, sans position. */
  const load = useCallback((content: string, file: string) => {
    try {
      setLoaded({ file, points: heartRatePointsFrom(parseGpx(content).timedPoints) });
      setLoadError(null);
    } catch (err) {
      setLoaded(null);
      setLoadError(errorMessage(err, 'Lecture du GPX impossible.'));
    }
  }, []);
  // Session de l'adresse : son activité devient celle du module ; son brouillon, écrit dans sa fiche par « Enregistrer la session ».
  // Activité : vers une autre activité sans trace seulement (la session n'a pas de positions).
  const {
    requested, shownFile, error: sessionError, draft, allActivities, changeActivity: changeSessionActivity,
  } = useAnalysisSession({ family: FAMILY, activity, setActivity, load, loadedFile: loaded?.file ?? null });
  const points = shownFile ? loaded!.points : NO_POINTS;
  const record = useLibrarySession(shownFile)?.record;
  const intervals = record?.intervals ?? NO_INTERVALS;
  const sessionKey = shownFile;

  const { runner, retainHr, heart, hrZones: zones } = useAnalysisHeart(points, profile.heartRate, hrOffsetBpm);
  const analysis = useMemo(
    () => analyzeHeartRateSession(points, intervals, profile.heartRate, zones?.bounds ?? null),
    [points, intervals, profile.heartRate, zones]
  );

  // Onglets : ceux de l'activité ; « cardio » seulement avec assez de FC. Le point survolé s'efface à chaque session.
  const { open, toggle, toggleOf, advanced, shown } = useAnalysisTabs({
    storageId: PAGE.storageId, tabs: MUSCU_TABS, defaults: MUSCU_SECTION_DEFAULTS, activity, sessionKey,
  });
  const sections = useMemo(() => shown((s) => s.key !== 'cardio' || heart.present), [shown, heart.present]);

  // Repères du bouton « Note » : liste de « Général », traits sur la courbe ; « Voir » met le trait en violet.
  const noDistances = useMemo(() => points.map(() => 0), [points]);
  const marks = useSessionMarks(draft, points, noDistances);
  const [shownMark, setShownMark] = useState<number | null>(null);

  // Courbe de FC, en minutes depuis le départ.
  const t0 = points[0]?.timeMs ?? 0;
  const { minutes, zoom, cardioZoom } = useTimeChartAxis(points, sessionKey);
  const smoothed = analysis?.smoothed;
  const phaseKinds = useMemo(() => [...new Set(analysis?.phases.map((p) => p.kind) ?? [])], [analysis]);

  /** Chiffres de « général », repris par l'image de partage (mêmes clés que `summaryShareStats`). */
  const generalStats: ShareStat[] = useMemo(() => {
    if (!analysis) return [];
    const { stats } = analysis;
    return [
      { key: 'totalTime', label: 'Durée', value: formatDuration(analysis.endMs - analysis.startMs) },
      { key: 'activeTime', label: 'Hors pauses', value: formatDuration(analysis.durationS * 1000) },
      { key: 'heartRate', label: 'FC moyenne', value: stats ? `${Math.round(stats.avgBpm)} bpm` : '—' },
      { key: 'heartRateMax', label: 'FC max', value: stats ? `${stats.maxBpm} bpm` : '—' },
      { key: 'reps', label: 'Répétitions', value: analysis.reps > 0 ? String(analysis.reps) : '—' },
    ];
  }, [analysis]);

  return (
    <div className="an-page" style={{ padding: '20px' }}>
      <div className="an-sheet">
        <div className="an-sheet__head">
          <PageHeader title={PAGE.title} subtitle={shownFile ? (
            <SessionNameEditor file={shownFile}
              share={generalStats.length > 0 ? { family: FAMILY, segments: [], stats: shareableStats(generalStats) } : undefined} />
          ) : undefined} back={{ to: libraryPath(FAMILY), label: PAGE.backLabel }} />
          {(sessionError ?? loadError) && <div className="ui-alert ui-alert--warning" style={{ marginTop: '10px' }}>{sessionError ?? loadError}</div>}
        </div>
      </div>

      <SessionSaveBar draft={draft} />

      {requested === null && (
        <p style={{ color: 'var(--muted)' }}>
          Aucune session ouverte : choisissez-en une dans <Link to={libraryPath(FAMILY)}>{PAGE.backLabel}</Link>.
        </p>
      )}
      {shownFile && !analysis && (
        <div className="ui-alert ui-alert--warning" style={{ maxWidth: '520px' }}>Le fichier n'a pas assez de mesures de la ceinture.</div>
      )}

      {/* Pas de carte : les onglets en tête, leurs panneaux deux par ligne sur ordinateur (`docs/MISE_EN_PAGE.md`). */}
      {analysis && (
        <div className="an-carte-col" style={{ marginTop: '10px' }}>
          <CollapsibleSectionTabs sections={sections} open={open} onToggle={toggle} advancedOpen={advanced.open} onToggleAdvanced={advanced.toggle} accent={PAGE.accent} />
          <div className="an-carte-panels">
            {open.general && (
              <ResizablePanel id={panelId('general')} style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE, fontSize: 'var(--text-s)' }}>
                <div style={{ marginBottom: '10px' }}>
                  <PanelTitle label="Général" extra={<SessionDate track={points} />} open={open.general} onToggle={toggleOf('general')} helpKey="muscu:general" />
                </div>
                <HelpText helpKey="muscu:general" note>
                  FC lissée sur {profile.heartRate.smoothS} s ; un trou de plus de {profile.heartRate.gapS} s (ceinture retirée, pause) n'est ni compté ni tracé.
                  {' '}Bandes de couleur : les phases du compteur. Traits numérotés : les notes posées pendant la séance.
                  {narrow ? ` ${zoomHint(true, 'la courbe')}` : " Tirez une zone sur la courbe pour zoomer, double-clic pour zoomer autour d'un point."}
                </HelpText>
                <GeneralStats stats={generalStats} />
                {zones && analysis.zoneTimes && (
                  <div className="an-sheet__stats an-sheet__stats--always" style={{ marginTop: '6px' }} aria-label="Temps par zone">
                    {analysis.zoneTimes.map((s, zone) => (s > 0 ? (
                      <StatTile key={zone} label={zoneLabel(zone)} value={formatDuration(s * 1000)} />
                    ) : null))}
                  </div>
                )}
                {smoothed && minutes.length > 1 && (
                  <div style={{ marginTop: '10px' }}>
                    <CardioCurve minutes={minutes} smoothed={smoothed} zoom={zoom} zones={zones?.bounds ?? null} thresholds={zones ? { s1: zones.s1, s2: zones.s2 } : null}
                      style={{ width: '100%', height: '220px' }}>
                      {analysis.phases.map((phase) => (
                        <ReferenceArea key={`${phase.kind}-${phase.startMs}`} yAxisId="hr" x1={(phase.startMs - t0) / 60_000} x2={(phase.endMs - t0) / 60_000}
                          fill={PHASE_STYLE[phase.kind].color} fillOpacity={PHASE_STYLE[phase.kind].opacity} stroke="none" ifOverflow="hidden" />
                      ))}
                      {markReferenceLines(marks.located, (m) => (m.mark.timeMs - t0) / 60_000, shownMark, 'hr')}
                    </CardioCurve>
                    {phaseKinds.length > 0 && (
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '4px', fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
                        {phaseKinds.map((kind) => (
                          <span key={kind} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: PHASE_STYLE[kind].color, opacity: 0.6 }} />
                            {PHASE_STYLE[kind].label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {intervals.length === 0 && (
                  <p style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)', margin: '8px 0 0' }}>Séance faite sans le compteur : pas de phases à poser sur la courbe.</p>
                )}
                {!zones && (
                  <p style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)', margin: '8px 0 0' }}>
                    Pour le temps par zone, saisir la FC max ou l'année de naissance dans <Link to="/parametres">Réglages</Link>, bloc « Pratiquant ».
                  </p>
                )}
                <SessionMarksList view={marks} distanceUnit="km" withDistance={false} shownMs={shownMark} accent={PAGE.accent} onShow={setShownMark} />
              </ResizablePanel>
            )}

            {open.cardio && (heart.present ? (
              <ResizablePanel id={panelId('cardio')} style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE, fontSize: 'var(--text-s)' }}>
                <HeartRatePanel track={points} minutes={minutes} heart={heart} params={profile.heartRate} zones={zones} profileHrMax={runner.hrMax} runner={runner}
                  onRetainHrMax={(bpm) => retainHr('hrMax', bpm, { kind: 'seance', atMs: points[0]?.timeMs ?? null })}
                  selectedZone={null} onSelectZone={() => undefined} 
                  zoom={cardioZoom} mapless open={open.cardio} onToggle={toggleOf('cardio')} />
              </ResizablePanel>
            ) : (
              <EmptyTabPanel id={panelId('cardio.vide')} label="Cardio" open={open.cardio} onToggle={toggleOf('cardio')}>
                Pas assez de FC dans cette session pour l'onglet cardio.
              </EmptyTabPanel>
            ))}

            {open.notes && (
              <ResizablePanel id={panelId('notes')} style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE, display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                <SessionNotesPanel notes={draft.edits.notes} setNotes={draft.updateNotes} family={FAMILY} conditions="libre" draft={draft}
                  gearFields={gearFields(gearLabels)} gearGroups={gearGroups} activityId={activity.id} open={open.notes} onToggle={toggleOf('notes')} />
              </ResizablePanel>
            )}

            {open.reglages && (
              <ResizablePanel id={panelId('reglages')} style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE, fontSize: 'var(--text-s)' }}>
                <div style={{ marginBottom: '10px' }}>
                  <PanelTitle label="Réglages de la session" open={open.reglages} onToggle={toggleOf('reglages')} helpKey="muscu:reglages" />
                </div>
                <HelpText helpKey="muscu:reglages" note>
                  Une session sans GPS ne change que pour une autre activité sans trace : elle n'a pas de positions pour une analyse à pied, à vélo ou en voile.
                </HelpText>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <strong>Activité :</strong>
                  <ActivitySelect
                    activities={allActivities.filter((a) => !hasPositions(a.base))}
                    value={activity.id}
                    extra={activity}
                    families={[FAMILY]}
                    onChange={(next) => changeSessionActivity(shownFile, next)} />
                </label>
              </ResizablePanel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default MuscuModule;
