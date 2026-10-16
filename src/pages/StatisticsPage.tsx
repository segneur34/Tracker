import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from 'recharts';
import PanelTitle from '../components/PanelTitle';
import ResizablePanel from '../components/ResizablePanel';
import SectionTabs, { type SectionDefinition } from '../components/SectionTabs';
import ZoomableChart, { ChartZoomProbe } from '../components/ZoomableChart';
import { IconChevronRight } from '../components/icons';
import { HEART_RATE_COLOR, HEART_ZONE_COLORS, zoneLabel } from '../components/heartRateColors';
import { CARD_STYLE, HALF_PANEL_STYLE } from '../components/styles';
import PageHeader from '../components/ui/PageHeader';
import { FAMILY_ACCENT, FAMILY_LABEL, activitiesOfFamily, activityFamily, sessionActivity, type Activity } from '../core/activities';
import { SPORT_FAMILIES, SPORT_PROFILES, type SportFamily } from '../core/sportProfiles';
import {
  SPEED_UNIT_LABEL, formatDistance, formatDuration, formatShortDuration, formatSpeed, formatSpeedValue, isInverseUnit, toDisplaySpeed,
  type DistanceUnit, type SpeedUnit,
} from '../core/units';
import { useChartZoom } from '../hooks/useChartZoom';
import { useNarrowScreen } from '../hooks/useNarrowScreen';
import { useOpenSession } from '../hooks/useLibraryNavigation';
import { useOpenSections } from '../hooks/useOpenSections';
import { runnerHeartRateZones, useRunnerProfile } from '../hooks/useRunnerProfile';
import { useSessionLibrary } from '../hooks/useSessionLibrary';
import { effectiveDistanceUnit, effectiveSpeedUnit, useVisibility } from '../hooks/useSportSettings';
import {
  STATS_PERIODS, averageMovingSpeedMs, cardioLoadBars, cardioTotals, dateTicks, heartRatePoints, formatDateTick, groupTotals, inBounds, isStatsPeriod, maxSpeedSeries, recordKindsOf,
  regularity, statSessionOf, statsPeriodBounds, statsTotals, topSessions, type MaxSpeedPoint, type StatSession, type StatsPeriod,
  type StatsRecordKind, type StatsTotals,
} from '../library/stats';
import './analysisMobile.css';
import './StatisticsPage.css';

/**
 * Statistiques (lot 5, étape 1) : une vue d'ensemble, puis une famille, puis
 * une activité, sur une période au choix, tirées du résumé des fiches sans
 * relire un seul GPX (`library/stats.ts`). Le choix est dans l'adresse
 * (`?famille=&activite=&periode=`) : le retour arrière remonte d'un niveau.
 * Les sessions d'une activité ou d'une famille cachée n'y sont pas, ni celles
 * à classer ; une famille cachée ouverte par son adresse montre tout.
 *
 * Onglets et panneaux comme les pages d'analyse (`docs/MISE_EN_PAGE.md`),
 * sans carte. La vitesse max et les records demandent une famille : mêlées,
 * les unités ne se comparent pas.
 */

type StatsSection = 'general' | 'vitesse' | 'regularite' | 'records' | 'cardio';

const STATS_SECTIONS: SectionDefinition<StatsSection>[] = [
  { key: 'general', label: 'général' },
  { key: 'vitesse', label: 'vitesse max' },
  { key: 'regularite', label: 'régularité' },
  { key: 'records', label: 'records' },
  // Seulement quand une session de la période a de la FC ; les bpm se comparent d'une famille à l'autre.
  { key: 'cardio', label: 'cardio' },
];

const STATS_SECTION_DEFAULTS: Record<StatsSection, boolean> = { general: true, vitesse: true, regularite: true, records: false, cardio: false };

/** Fractions des zones cardiaques : les mêmes dans tous les calculs (`HeartRateProfile`). */
const ZONE_FRACTIONS = SPORT_PROFILES.running.heartRate.zoneFractions;

const STORAGE_ID = 'statistiques';
const panelId = (name: string) => `${STORAGE_ID}.${name}`;
const panelStyle = { ...CARD_STYLE, ...HALF_PANEL_STYLE, fontSize: '14px' } as const;
const chartPanelStyle = { ...CARD_STYLE, ...HALF_PANEL_STYLE, display: 'flex', flexDirection: 'column', overflow: 'hidden' } as const;
const noteStyle = { color: 'var(--muted)', fontSize: '12px', marginTop: '8px' } as const;

const RECORD_LABEL: Record<StatsRecordKind, string> = {
  vitesse: 'Vitesse max',
  distance: 'Distance',
  duree: 'Durée',
  denivele: 'Dénivelé positif',
  manoeuvres: 'Manœuvres',
  vague: 'Plus longue vague',
  vol: 'Plus long vol',
};

const isFamily = (value: unknown): value is SportFamily => SPORT_FAMILIES.some((f) => f === value);

/** Familles qui comptent le dénivelé et la vitesse moyenne en action. */
const isLandFamily = (family: SportFamily | null): boolean => family === 'course' || family === 'velo' || family === 'fractionne';

const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`;

const decimal = (value: number, digits = 1): string => value.toFixed(digits).replace('.', ',');

const shortDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

/** Distance, deux décimales sous 10 unités, une au-delà, comme la bibliothèque. */
const distanceText = (m: number, unit: DistanceUnit): string =>
  formatDistance(m, unit, m / (unit === 'km' ? 1000 : 1852) < 10 ? 2 : 1);

const Stat = ({ label, value, title }: { label: string; value: ReactNode; title?: string }) => (
  <div className="an-sheet__stat" title={title}>
    <span className="an-sheet__stat-label">{label}</span>
    <strong className="an-sheet__stat-value">{value}</strong>
  </div>
);

/** Rangée de pastilles : un choix parmi plusieurs. */
function Chips<K extends string>({ label, items, value, onChoose, accent }: {
  label: string;
  items: { key: K; label: string }[];
  value: K;
  onChoose: (key: K) => void;
  accent: string;
}) {
  return (
    <div className="ui-tabs ui-tabs--compact stats-chips" role="group" aria-label={label} style={{ '--tab-accent': accent } as React.CSSProperties}>
      {items.map((item) => (
        <button key={item.key} type="button" className="ui-tab" aria-pressed={value === item.key} onClick={() => onChoose(item.key)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** Ligne d'un groupe (famille, activité) qui descend d'un niveau. */
const GroupRow = ({ color, name, totals, distanceUnit, onOpen }: {
  color: string; name: string; totals: StatsTotals; distanceUnit: DistanceUnit; onOpen: () => void;
}) => (
  <li>
    <button type="button" className="stats-row" onClick={onOpen}>
      <span className="stats-row__swatch" style={{ background: color }} />
      <span className="stats-row__name">{name}</span>
      <span className="stats-row__meta num">
        {plural(totals.sessions, 'session')} · {formatDuration(totals.durationS * 1000)} · {distanceText(totals.distanceM, distanceUnit)}
      </span>
      <IconChevronRight size={16} className="stats-row__chevron" />
    </button>
  </li>
);

/** Ligne du graphe de la vitesse max : un point par session, valeurs dans l'unité. */
interface SpeedRow extends MaxSpeedPoint {
  speed: number;
  best: number;
}

function StatisticsPage() {
  const [params, setParams] = useSearchParams();
  const { status, sessions, scanning } = useSessionLibrary();
  const { activities, families, isShown, shownActivities } = useVisibility();
  const openSession = useOpenSession();
  const narrow = useNarrowScreen();
  const [nowMs] = useState(() => Date.now());
  const [picked, setPicked] = useState<string | null>(null);
  const { open, toggle } = useOpenSections<StatsSection>(STORAGE_ID, STATS_SECTION_DEFAULTS);

  // Le choix, lu dans l'adresse.
  const familyParam = params.get('famille');
  const family: SportFamily | null = isFamily(familyParam) ? familyParam : null;
  const familyHidden = family !== null && !families.includes(family);
  const periodParam = params.get('periode');
  const period: StatsPeriod = isStatsPeriod(periodParam) ? periodParam : 'tout';
  // Sessions classées et visibles ; celles d'une famille cachée ouverte par son adresse aussi. Une session
  // peut tenir d'une activité de base, hors de la liste (son calcul sans activité créée, activité supprimée) :
  // elle est gardée avec les activités de la liste, pour avoir sa pastille, son nom et sa couleur.
  const { all, activityById } = useMemo(() => {
    const list: StatSession[] = [];
    const byId = new Map(activities.map((a) => [a.id, a]));
    for (const s of sessions) {
      const a = sessionActivity(activities, s.record.activityId, s.record.sport);
      if (!a) continue;
      if (!isShown(a) && !(familyHidden && activityFamily(a) === family)) continue;
      if (!byId.has(a.id)) byId.set(a.id, a);
      list.push(statSessionOf(s.file, s.record, a));
    }
    return { all: list, activityById: byId };
  }, [sessions, activities, isShown, familyHidden, family]);
  const activityParam = params.get('activite');
  const activity: Activity | null =
    family !== null && activityParam !== null && activityById.get(activityParam) && activityFamily(activityById.get(activityParam)!) === family
      ? activityById.get(activityParam)!
      : null;

  /** Change l'adresse : famille et activité s'empilent dans l'historique, la période le remplace. */
  const go = (next: { famille?: SportFamily | null; activite?: string | null; periode?: StatsPeriod }, replace = false) => {
    const p = new URLSearchParams();
    const f = next.famille !== undefined ? next.famille : family;
    const a = next.activite !== undefined ? next.activite : activity?.id ?? null;
    const per = next.periode ?? period;
    if (f) p.set('famille', f);
    if (f && a) p.set('activite', a);
    if (per !== 'tout') p.set('periode', per);
    setPicked(null);
    setParams(p, { replace });
  };

  const scoped = useMemo(
    () => all.filter((s) => (family === null || s.family === family) && (activity === null || s.activityId === activity.id)),
    [all, family, activity]
  );
  const bounds = useMemo(() => statsPeriodBounds(period, nowMs), [period, nowMs]);
  const inPeriod = useMemo(() => scoped.filter((s) => inBounds(s.startMs, bounds)), [scoped, bounds]);
  const totals = useMemo(() => statsTotals(inPeriod), [inPeriod]);
  const activityOrder = useMemo(() => activities.map((a) => a.id), [activities]);
  const regular = useMemo(() => regularity(scoped, bounds, nowMs, activityOrder), [scoped, bounds, nowMs, activityOrder]);

  // Unités : celles de l'activité, sinon de la première activité visible de la famille.
  const unitActivityOf = (f: SportFamily): Activity | null => shownActivities(f)[0] ?? activitiesOfFamily(activities, f)[0] ?? null;
  const unitActivity = activity ?? (family ? unitActivityOf(family) : null);
  const speedUnit: SpeedUnit = unitActivity ? effectiveSpeedUnit(unitActivity) : 'kmh';
  const distanceUnit: DistanceUnit = unitActivity ? effectiveDistanceUnit(unitActivity) : 'km';
  const accent = family ? FAMILY_ACCENT[family] : 'var(--ink-2)';

  // Pastilles : les familles visibles (et celle ouverte par l'adresse), puis toutes les activités visibles de la
  // famille, avec ou sans session, et celles de base qui en ont.
  const familyItems: { key: SportFamily | 'tout'; label: string }[] = [
    { key: 'tout', label: 'Tout' },
    ...SPORT_FAMILIES.filter((f) => families.includes(f) || f === family).map((f) => ({ key: f, label: FAMILY_LABEL[f] })),
  ];
  const activityItems = useMemo(() => {
    if (family === null) return [];
    const withSessions = new Set(all.filter((s) => s.family === family).map((s) => s.activityId));
    const listed = activitiesOfFamily(activities, family).filter((a) => isShown(a) || familyHidden || withSessions.has(a.id) || a.id === activity?.id);
    const extra = [...withSessions].filter((id) => !listed.some((a) => a.id === id)).map((id) => activityById.get(id)!);
    return [...listed, ...extra].map((a) => ({ key: a.id, label: a.name }));
  }, [all, family, activities, isShown, familyHidden, activity, activityById]);

  // Cardio : la FC du résumé, zones et charge recalculées avec le profil du moment.
  const { profile: runner } = useRunnerProfile();
  const hrZones = useMemo(() => runnerHeartRateZones(runner, ZONE_FRACTIONS), [runner]);
  const hasCardio = inPeriod.some((s) => s.heartRate !== null);
  const cardio = useMemo(() => cardioTotals(inPeriod, hrZones?.bounds ?? null), [inPeriod, hrZones]);
  const loadBars = useMemo(() => (hrZones ? cardioLoadBars(regular.bars, inPeriod, hrZones.bounds) : []), [hrZones, regular.bars, inPeriod]);
  const hrPoints = useMemo(() => heartRatePoints(inPeriod), [inPeriod]);
  const hrSeries = useMemo(() => {
    const byActivity = new Map<string, typeof hrPoints>();
    for (const p of hrPoints) byActivity.set(p.activityId, [...(byActivity.get(p.activityId) ?? []), p]);
    return [...byActivity.entries()];
  }, [hrPoints]);
  const hrTicks = hrPoints.length > 0 ? dateTicks(hrPoints[0].startMs - 86_400_000, hrPoints[hrPoints.length - 1].startMs + 86_400_000, narrow ? 4 : 6) : null;

  const sections = STATS_SECTIONS.filter((s) => (family !== null || (s.key !== 'vitesse' && s.key !== 'records')) && (s.key !== 'cardio' || hasCardio));

  // Vitesse max : un point par session de la sélection (période comprise), le record en escalier.
  const speedRows: SpeedRow[] = useMemo(
    () => maxSpeedSeries(inPeriod).map((p) => ({ ...p, speed: toDisplaySpeed(p.maxSpeedMs, speedUnit), best: toDisplaySpeed(p.bestMs, speedUnit) })),
    [inPeriod, speedUnit]
  );
  const speedFull = useMemo(() => {
    if (speedRows.length === 0) return null;
    // Une journée de marge de chaque côté : un point seul reste au milieu.
    const pad = 86_400_000;
    return { min: speedRows[0].startMs - pad, max: speedRows[speedRows.length - 1].startMs + pad };
  }, [speedRows]);
  const zoom = useChartZoom(speedFull, `${family}|${activity?.id}|${period}`);
  const speedTicks = zoom.shown ? dateTicks(zoom.shown.min, zoom.shown.max, narrow ? 4 : 6) : null;
  const speedSeries = useMemo(() => {
    const byActivity = new Map<string, SpeedRow[]>();
    for (const row of speedRows) byActivity.set(row.activityId, [...(byActivity.get(row.activityId) ?? []), row]);
    return [...byActivity.entries()];
  }, [speedRows]);
  const pickedRow = speedRows.find((r) => r.file === picked) ?? null;
  const pickedSession = pickedRow ? inPeriod.find((s) => s.file === pickedRow.file) ?? null : null;
  const inverse = isInverseUnit(speedUnit);

  // Régularité : une colonne par activité, empilées.
  const barRows = useMemo(
    () => regular.bars.map((b, i) => ({ i, ...Object.fromEntries(b.stacks.map((s) => [s.activityId, s.count])) })),
    [regular.bars]
  );
  const barActivities = useMemo(() => {
    const ids = new Set(regular.bars.flatMap((b) => b.stacks.map((s) => s.activityId)));
    return activityOrder.filter((id) => ids.has(id));
  }, [regular.bars, activityOrder]);

  const activityName = (id: string) => activityById.get(id)?.name ?? id;
  const activityColor = (id: string) => activityById.get(id)?.color ?? '#888';

  const recordValue = (kind: StatsRecordKind, value: number, s: StatSession): string => {
    const a = activityById.get(s.activityId);
    switch (kind) {
      case 'vitesse': return formatSpeed(value, a ? effectiveSpeedUnit(a) : speedUnit);
      case 'distance': return distanceText(value, a ? effectiveDistanceUnit(a) : distanceUnit);
      case 'duree': return formatDuration(value * 1000);
      case 'denivele': return `${Math.round(value)} m`;
      case 'manoeuvres': return String(value);
      case 'vague': return `${Math.round(value)} m`;
      case 'vol': return formatShortDuration(value);
    }
  };

  const title = activity ? activity.name : family ? FAMILY_LABEL[family] : 'Toutes les activités';
  const periodLabel = STATS_PERIODS.find((p) => p.id === period)!.label;
  const empty = inPeriod.length === 0;
  const lastText = regular.weeksSinceLast === null ? '—'
    : regular.weeksSinceLast === 0 ? 'cette semaine'
    : regular.weeksSinceLast === 1 ? 'la semaine dernière'
    : `il y a ${regular.weeksSinceLast} semaines`;

  return (
    <div className="ui-page ui-page--wide an-page stats-page">
      <PageHeader title="Statistiques" subtitle={`${title} · ${periodLabel === 'Tout' ? 'depuis le début' : periodLabel}`} />

      <div className="stats-choice">
        <Chips label="Famille" items={familyItems} value={family ?? 'tout'} accent={accent}
          onChoose={(key) => go({ famille: key === 'tout' ? null : key, activite: null })} />
        {family !== null && activityItems.length > 0 && (
          <Chips label="Activité" items={[{ key: '', label: 'Toute la famille' }, ...activityItems]} value={activity?.id ?? ''} accent={accent}
            onChoose={(key) => go({ activite: key === '' ? null : key })} />
        )}
        <Chips label="Période" items={STATS_PERIODS.map((p) => ({ key: p.id, label: p.label }))} value={period} accent="var(--ink-2)"
          onChoose={(key) => go({ periode: key }, true)} />
        {familyHidden && <p style={noteStyle}>Cette famille est cachée dans Réglages : elle n'apparaît ici que par son adresse.</p>}
      </div>

      {status === 'opening' ? (
        <p className="stats-hint">Lecture de la mémoire…</p>
      ) : (
        <div className="stats-col">
          <SectionTabs sections={sections} open={open} onToggle={toggle} accent={accent} />
          {scanning && (
            <p className="stats-hint">Fiches en cours de calcul ({scanning.done} / {scanning.total}) : chiffres provisoires.</p>
          )}
          <div className="an-carte-panels stats-panels">
            {open.general && (
              <ResizablePanel id={panelId('general')} style={panelStyle}>
                <div style={{ marginBottom: '10px' }}>
                  <PanelTitle label="Général" open={open.general} onToggle={() => toggle('general')} />
                </div>
                {empty ? (
                  <p className="stats-hint">Aucune session sur la période.</p>
                ) : (
                  <>
                    <div className="an-sheet__stats an-sheet__stats--always">
                      <Stat label="Sessions" value={totals.sessions} />
                      <Stat label="Durée totale" value={formatDuration(totals.durationS * 1000)} title="Du premier au dernier point de chaque session" />
                      {totals.movingTimeS > 0 && <Stat label="Temps en action" value={formatDuration(totals.movingTimeS * 1000)} />}
                      {family !== null && <Stat label="Distance" value={distanceText(totals.distanceM, distanceUnit)} />}
                      {isLandFamily(family) && averageMovingSpeedMs(totals) !== null && (
                        <Stat label="Vitesse moyenne en action" value={formatSpeed(averageMovingSpeedMs(totals), speedUnit)} />
                      )}
                      {isLandFamily(family) && totals.elevationSessions > 0 && <Stat label="Dénivelé positif" value={`${Math.round(totals.elevationGainM)} m`} />}
                      {family !== null && totals.maxSpeedMs !== null && <Stat label="Vitesse max" value={formatSpeed(totals.maxSpeedMs, speedUnit)} />}
                      {family === 'voile' && totals.maneuverSessions > 0 && (
                        <>
                          <Stat label="Manœuvres" value={totals.maneuvers} />
                          <Stat label="Manœuvres par session" value={decimal(totals.maneuvers / totals.maneuverSessions)} />
                        </>
                      )}
                      {family === 'surf' && totals.waveSessions > 0 && (
                        <>
                          <Stat label="Vagues" value={totals.waves} />
                          <Stat label="Vagues par session" value={decimal(totals.waves / totals.waveSessions)} />
                        </>
                      )}
                      {family === 'surf' && totals.longestWaveM !== null && <Stat label="Plus longue vague" value={`${Math.round(totals.longestWaveM)} m`} />}
                      {family === 'surf' && totals.longestFlightS !== null && <Stat label="Plus long vol" value={formatShortDuration(totals.longestFlightS)} />}
                      {totals.reps > 0 && <Stat label="Répétitions du compteur" value={totals.reps} />}
                    </div>
                    {family === 'voile' && totals.maneuverSessions < totals.sessions && (
                      <p style={noteStyle}>
                        Manœuvres comptées sur les {plural(totals.maneuverSessions, 'session')} déjà ouverte{totals.maneuverSessions > 1 ? 's' : ''} dans l'analyse
                        ({totals.sessions - totals.maneuverSessions} jamais ouverte{totals.sessions - totals.maneuverSessions > 1 ? 's' : ''}).
                      </p>
                    )}
                    {family === null && (
                      <ul className="stats-rows">
                        {groupTotals(inPeriod, (s) => s.family, SPORT_FAMILIES).map(({ key, totals: t }) => {
                          const unit = unitActivityOf(key);
                          return (
                            <GroupRow key={key} color={FAMILY_ACCENT[key]} name={FAMILY_LABEL[key]} totals={t}
                              distanceUnit={unit ? effectiveDistanceUnit(unit) : 'km'} onOpen={() => go({ famille: key, activite: null })} />
                          );
                        })}
                      </ul>
                    )}
                    {family !== null && activity === null && (
                      <ul className="stats-rows">
                        {groupTotals(inPeriod, (s) => s.activityId, activityOrder).map(({ key, totals: t }) => {
                          const a = activityById.get(key);
                          return (
                            <GroupRow key={key} color={activityColor(key)} name={activityName(key)} totals={t}
                              distanceUnit={a ? effectiveDistanceUnit(a) : distanceUnit} onOpen={() => go({ activite: key })} />
                          );
                        })}
                      </ul>
                    )}
                  </>
                )}
              </ResizablePanel>
            )}

            {open.vitesse && family !== null && (
              <ResizablePanel id={panelId('vitesse')} defaultHeight={380} minHeight={220} direction="vertical" style={chartPanelStyle}>
                <div style={{ marginBottom: '8px', paddingRight: '28px' }}>
                  <PanelTitle label="Vitesse max" open={open.vitesse} onToggle={() => toggle('vitesse')} />
                </div>
                {speedRows.length === 0 ? (
                  <p className="stats-hint">Aucune session sur la période.</p>
                ) : (
                  <>
                    <ZoomableChart zoom={zoom} style={{ width: '100%', flex: 1, minHeight: 0 }}>
                      <ResponsiveContainer>
                        <ComposedChart margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                          <ChartZoomProbe />
                          <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
                          <XAxis dataKey="startMs" type="number" allowDataOverflow
                            domain={zoom.shown ? [zoom.shown.min, zoom.shown.max] : ['dataMin', 'dataMax']}
                            ticks={speedTicks?.ticks}
                            tickFormatter={(v: number) => formatDateTick(v, speedTicks?.unit ?? 'jour')}
                            tick={{ fill: '#555', fontSize: 11 }} />
                          <YAxis type="number" domain={inverse ? ['auto', 'auto'] : [0, 'auto']} reversed={inverse}
                            tickFormatter={(v: number) => formatSpeedValue(v, speedUnit)} width={46}
                            tick={{ fill: '#555', fontSize: 11 }}
                            label={{ value: SPEED_UNIT_LABEL[speedUnit], angle: -90, position: 'insideLeft', fill: '#555', fontSize: 11 }} />
                          <Tooltip cursor={false} isAnimationActive={false}
                            content={({ active, payload }) => {
                              const row = active ? (payload?.[0]?.payload as SpeedRow | undefined) : undefined;
                              if (!row) return null;
                              return (
                                <div className="stats-tooltip">
                                  <strong>{shortDate(row.startMs)}</strong>
                                  <span>{activityName(row.activityId)} · {formatSpeed(row.maxSpeedMs, speedUnit)}</span>
                                </div>
                              );
                            }} />
                          <Line data={speedRows} dataKey="best" type="stepAfter" stroke="#9aa0a6" strokeDasharray="4 3" strokeWidth={1.5}
                            dot={false} activeDot={false} isAnimationActive={false} name="Record" />
                          {speedSeries.map(([activityId, rows]) => (
                            <Scatter key={activityId} data={rows} dataKey="speed" fill={activityColor(activityId)} isAnimationActive={false}
                              name={activityName(activityId)}
                              onClick={(_, index) => setPicked(rows[index]?.file ?? null)} style={{ cursor: 'pointer' }} />
                          ))}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </ZoomableChart>
                    <div className="stats-picked">
                      {pickedRow && pickedSession ? (
                        <button type="button" className="stats-row" onClick={() => openSession(pickedRow.file, pickedSession.family)}>
                          <span className="stats-row__swatch" style={{ background: activityColor(pickedRow.activityId) }} />
                          <span className="stats-row__name">{shortDate(pickedRow.startMs)}</span>
                          <span className="stats-row__meta num">
                            {pickedSession.name ?? activityName(pickedRow.activityId)} · {formatSpeed(pickedRow.maxSpeedMs, speedUnit)}
                            {pickedRow.isRecord ? ' · record' : ''}
                          </span>
                          <span className="stats-row__open">Ouvrir</span>
                          <IconChevronRight size={16} className="stats-row__chevron" />
                        </button>
                      ) : (
                        <span style={noteStyle}>
                          Un point par session, à la couleur de son activité ; en pointillé, le record établi jusque-là.
                          {narrow ? ' Toucher un point pour le détail, écarter deux doigts pour zoomer.' : ' Cliquer un point pour le détail, tirer une zone pour zoomer.'}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </ResizablePanel>
            )}

            {open.regularite && (
              <ResizablePanel id={panelId('regularite')} defaultHeight={380} minHeight={220} direction="vertical" style={chartPanelStyle}>
                <div style={{ marginBottom: '10px', paddingRight: '28px' }}>
                  <PanelTitle label="Régularité" open={open.regularite} onToggle={() => toggle('regularite')} />
                </div>
                {regular.weeks === 0 ? (
                  <p className="stats-hint">Aucune session sur la période.</p>
                ) : (
                  <>
                    <div className="an-sheet__stats an-sheet__stats--always">
                      <Stat label="Sessions par semaine" value={decimal(regular.perWeek)} title="En moyenne sur les semaines de la période" />
                      <Stat label="Semaines actives" value={`${regular.activeWeeks} / ${regular.weeks}`} />
                      <Stat label="Plus longue série" value={plural(regular.longestStreak, 'semaine')} title="Semaines actives consécutives sur la période" />
                      <Stat label="Série en cours" value={plural(regular.currentStreak, 'semaine')} title="Jusqu'à cette semaine, ou à la précédente si celle-ci est vide" />
                      <Stat label="Dernière session" value={lastText} />
                    </div>
                    <div style={{ flex: 1, minHeight: 140 }}>
                      <ResponsiveContainer>
                        <BarChart data={barRows} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#ddd" vertical={false} />
                          <XAxis dataKey="i" tickFormatter={(i: number) => regular.bars[i]?.label ?? ''} interval="preserveStartEnd" minTickGap={16}
                            tick={{ fill: '#555', fontSize: 11 }} />
                          <YAxis allowDecimals={false} width={30} tick={{ fill: '#555', fontSize: 11 }} />
                          <Tooltip isAnimationActive={false} cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                            labelFormatter={(i) => regular.bars[Number(i)]?.title ?? ''}
                            formatter={(value, name) => [value, activityName(String(name))]}
                            contentStyle={{ fontSize: '12px' }} />
                          {barActivities.map((id) => (
                            <Bar key={id} dataKey={id} stackId="sessions" fill={activityColor(id)} isAnimationActive={false} />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={noteStyle}>Sessions par {regular.barUnit}, empilées par activité.</div>
                  </>
                )}
              </ResizablePanel>
            )}

            {open.cardio && hasCardio && (
              <ResizablePanel id={panelId('cardio')} style={panelStyle}>
                <div style={{ marginBottom: '10px' }}>
                  <PanelTitle label="Cardio" open={open.cardio} onToggle={() => toggle('cardio')} />
                </div>
                <div className="an-sheet__stats an-sheet__stats--always">
                  <Stat label="Sessions avec FC" value={`${cardio.sessions} / ${totals.sessions}`} />
                  <Stat label="Temps mesuré" value={formatDuration(cardio.coveredS * 1000)} />
                  {cardio.avgBpm !== null && <Stat label="FC moyenne" value={`${Math.round(cardio.avgBpm)} bpm`} title="Pondérée par le temps mesuré de chaque session" />}
                  {cardio.maxBpm !== null && <Stat label="FC max" value={`${cardio.maxBpm} bpm`} />}
                  {cardio.load !== null && <Stat label="Charge" value={Math.round(cardio.load)} title="Minutes en Z1 × 1, … en Z5 × 5 (Edwards)" />}
                  {cardio.load !== null && regular.weeks > 0 && <Stat label="Charge par semaine" value={Math.round(cardio.load / regular.weeks)} />}
                </div>

                {cardio.zoneTimesS && cardio.coveredS > 0 && (
                  <div style={{ marginTop: '10px' }}>
                    <div className="stats-records__title">Temps par zone</div>
                    <div style={{ display: 'flex', height: '14px', borderRadius: '4px', overflow: 'hidden', margin: '6px 0' }}>
                      {cardio.zoneTimesS.map((s, z) => s > 0 && (
                        <div key={z} title={`${zoneLabel(z)} : ${formatShortDuration(s)}`} style={{ width: `${(s / cardio.coveredS) * 100}%`, backgroundColor: HEART_ZONE_COLORS[z] }} />
                      ))}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: '12px' }}>
                      {cardio.zoneTimesS.map((s, z) => (
                        <span key={z} style={{ opacity: s > 0 ? 1 : 0.45 }}>
                          <span style={{ display: 'inline-block', width: '9px', height: '9px', borderRadius: '2px', backgroundColor: HEART_ZONE_COLORS[z], marginRight: '4px' }} />
                          {zoneLabel(z)} {formatDuration(s * 1000)} ({Math.round((s / cardio.coveredS) * 100)} %)
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {loadBars.length > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <div className="stats-records__title">Charge par {regular.barUnit}</div>
                    <div style={{ height: '160px' }}>
                      <ResponsiveContainer>
                        <BarChart data={loadBars.map((b, i) => ({ i, load: Math.round(b.load) }))} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#ddd" vertical={false} />
                          <XAxis dataKey="i" tickFormatter={(i: number) => loadBars[i]?.label ?? ''} interval="preserveStartEnd" minTickGap={16} tick={{ fill: '#555', fontSize: 11 }} />
                          <YAxis allowDecimals={false} width={36} tick={{ fill: '#555', fontSize: 11 }} />
                          <Tooltip isAnimationActive={false} cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                            labelFormatter={(i) => loadBars[Number(i)]?.title ?? ''} formatter={(value) => [value, 'Charge']} contentStyle={{ fontSize: '12px' }} />
                          <Bar dataKey="load" fill={HEART_RATE_COLOR} isAnimationActive={false} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {hrPoints.length > 0 && hrTicks && (
                  <div style={{ marginTop: '12px' }}>
                    <div className="stats-records__title">FC moyenne par session</div>
                    <div style={{ height: '160px' }}>
                      <ResponsiveContainer>
                        <ComposedChart margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
                          <XAxis dataKey="startMs" type="number" domain={[hrTicks.ticks[0] ?? 'dataMin', hrTicks.ticks[hrTicks.ticks.length - 1] ?? 'dataMax']}
                            ticks={hrTicks.ticks} tickFormatter={(v: number) => formatDateTick(v, hrTicks.unit)} tick={{ fill: '#555', fontSize: 11 }} />
                          <YAxis type="number" domain={['dataMin - 5', 'dataMax + 5']} allowDecimals={false} width={40} tick={{ fill: HEART_RATE_COLOR, fontSize: 11 }} />
                          <Tooltip cursor={false} isAnimationActive={false}
                            content={({ active, payload }) => {
                              const row = active ? (payload?.[0]?.payload as (typeof hrPoints)[number] | undefined) : undefined;
                              if (!row) return null;
                              return (
                                <div className="stats-tooltip">
                                  <strong>{shortDate(row.startMs)}</strong>
                                  <span>{activityName(row.activityId)} · moy. {row.avgBpm} bpm · max {row.maxBpm} bpm</span>
                                </div>
                              );
                            }} />
                          {hrSeries.map(([activityId, rows]) => (
                            <Scatter key={activityId} data={rows} dataKey="avgBpm" fill={activityColor(activityId)} isAnimationActive={false}
                              name={activityName(activityId)} onClick={(_, index) => { const r = rows[index]; const s = r ? inPeriod.find((x) => x.file === r.file) : undefined; if (r && s) openSession(r.file, s.family); }}
                              style={{ cursor: 'pointer' }} />
                          ))}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                <p style={noteStyle}>
                  {hrZones
                    ? 'Zones et charge recalculées avec les zones de Réglages › Pratiquant. Un point par session, à la couleur de son activité ; le toucher ouvre la session.'
                    : 'Pour les zones et la charge, saisir la FC max ou l\'année de naissance dans Réglages › Pratiquant.'}
                </p>
              </ResizablePanel>
            )}

            {open.records && family !== null && (
              <ResizablePanel id={panelId('records')} style={panelStyle}>
                <div style={{ marginBottom: '10px' }}>
                  <PanelTitle label="Records" open={open.records} onToggle={() => toggle('records')} />
                </div>
                {empty ? (
                  <p className="stats-hint">Aucune session sur la période.</p>
                ) : (
                  <div className="stats-records">
                    {recordKindsOf(family).map((kind) => {
                      const top = topSessions(inPeriod, kind);
                      if (top.length === 0) return null;
                      return (
                        <div key={kind}>
                          <div className="stats-records__title">{RECORD_LABEL[kind]}</div>
                          <ol className="stats-rows">
                            {top.map(({ session: s, value }, rank) => (
                              <li key={s.file}>
                                <button type="button" className="stats-row" onClick={() => openSession(s.file, s.family)}>
                                  <span className="stats-row__rank num">{rank + 1}</span>
                                  <span className="stats-row__swatch" style={{ background: activityColor(s.activityId) }} />
                                  <span className="stats-row__name num">{recordValue(kind, value, s)}</span>
                                  <span className="stats-row__meta">
                                    {shortDate(s.startMs)} · {s.name ?? activityName(s.activityId)}
                                  </span>
                                  <IconChevronRight size={16} className="stats-row__chevron" />
                                </button>
                              </li>
                            ))}
                          </ol>
                        </div>
                      );
                    })}
                  </div>
                )}
              </ResizablePanel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default StatisticsPage;
