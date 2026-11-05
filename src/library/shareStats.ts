import type { ShareStat } from '../core/shareImage';
import { FOIL_RATIO_LABEL, type Treatment } from '../core/sportProfiles';
import { commaDecimal, formatDistance, formatDuration, formatSessionDate, formatShortDuration, formatLandSpeed, type DistanceUnit, type SpeedUnit } from '../core/units';
import { downloadBaseName } from './naming';
import { RATINGS, WIND_LEVELS, type Rating, type WindLevel } from './notes';
import type { SessionSummary } from './record';

/**
 * Lignes ajoutées à l'image de partage le 05/11 (lot 145), à la fin de la liste,
 * les mêmes clés dans l'analyse ouverte et dans le résumé d'une fiche : le choix
 * retenu pour l'activité vaut aux deux endroits. Voile : manœuvres réussies, part
 * du vol pompée (sur foil), vent ; à pied : meilleur kilomètre (temps) ; à vélo :
 * puissance moyenne et meilleures 5 min ; partout : l'appréciation.
 */
export const SHARE_EXTRA_KEYS: Record<Treatment, readonly string[]> = {
  voile: ['maneuverSuccess', 'pumpingShare', 'wind', 'rating'],
  course: ['top-d1km', 'rating'],
  velo: ['puissance', 'top-t5min', 'rating'],
  surf: ['rating'],
  muscu: ['rating'],
};

/** Ce qui donne les lignes ajoutées : l'analyse ouverte (ses calculs) ou la fiche (son résumé, ses notes) ; absent ou `null` : « — ». */
export interface ShareExtras {
  /** Voile : virements et empannages réussis, sur le total classé. */
  maneuvers?: { success: number; total: number } | null;
  /** Voile sur foil : part du vol pompée, de 0 à 1. */
  pumpingShare?: number | null;
  /** Voile : direction du vent retenue, en degrés, et sa force notée dans « matos et conditions ». */
  windDeg?: number | null;
  windLevel?: WindLevel | null;
  /** À pied : temps du meilleur kilomètre, en secondes. */
  best1kmS?: number | null;
  /** À vélo : vitesse des meilleures 5 min, en m/s. */
  best5minMs?: number | null;
  /** À vélo : puissance moyenne en mouvement, en watts. */
  avgPowerW?: number | null;
  /** Appréciation de la séance. */
  rating?: Rating | null;
}

const DASH = '—';

/** Libellé de l'appréciation, sans icône ni emoji (« Bien ») ; `null` sans appréciation. */
export const ratingLabel = (rating: Rating | null | undefined): string | null => RATINGS.find((r) => r.value === rating)?.label ?? null;

/** « 230° · moyen », « 230° », « Moyen » : le vent dit en clair, « — » sans rien. */
export const windShareValue = (deg: number | null | undefined, level: WindLevel | null | undefined): string => {
  const dir = deg === null || deg === undefined || !Number.isFinite(deg) ? null : `${Math.round(((deg % 360) + 360) % 360)}°`;
  const force = WIND_LEVELS.find((w) => w.value === level)?.label ?? null;
  if (dir && force) return `${dir} · ${force.toLowerCase()}`;
  return dir ?? force ?? DASH;
};

/** « 83 % (10/12) » : la réussite des manœuvres, « — » sans manœuvre classée. */
export const maneuverSuccessValue = (m: { success: number; total: number } | null | undefined): string =>
  m && m.total > 0 ? `${Math.round((m.success / m.total) * 100)} % (${m.success}/${m.total})` : DASH;

/**
 * Lignes ajoutées de l'image de partage (`SHARE_EXTRA_KEYS`), dans leur ordre ;
 * la part du vol pompée sur foil seulement. Une valeur absente vaut « — ».
 */
export const shareExtraStats = (
  treatment: Treatment,
  extras: ShareExtras,
  options: { foil?: boolean; units?: { speed: SpeedUnit; distance: DistanceUnit } } = {}
): ShareStat[] => {
  const { foil = false, units = { speed: 'kmh', distance: 'km' } } = options;
  const value = (v: number | null | undefined, format: (n: number) => string): string =>
    v === null || v === undefined || !Number.isFinite(v) ? DASH : format(v);
  const rows: Record<string, ShareStat> = {
    maneuverSuccess: { key: 'maneuverSuccess', label: 'Manœuvres réussies', value: maneuverSuccessValue(extras.maneuvers) },
    pumpingShare: { key: 'pumpingShare', label: 'Pumping', value: value(extras.pumpingShare, (s) => `${Math.round(s * 100)} % du vol`) },
    wind: { key: 'wind', label: 'Vent', value: windShareValue(extras.windDeg, extras.windLevel) },
    'top-d1km': { key: 'top-d1km', label: 'Meilleur 1 km', value: value(extras.best1kmS, formatShortDuration) },
    puissance: { key: 'puissance', label: 'Puissance moyenne', value: value(extras.avgPowerW, (w) => `${Math.round(w)} W`) },
    'top-t5min': { key: 'top-t5min', label: 'Meilleures 5 min', value: value(extras.best5minMs, (ms) => formatLandSpeed(ms, units.speed, units.distance)) },
    rating: { key: 'rating', label: 'Appréciation', value: ratingLabel(extras.rating) ?? DASH },
  };
  return SHARE_EXTRA_KEYS[treatment].filter((key) => key !== 'pumpingShare' || foil).map((key) => rows[key]);
};

/** Ratio de vol d'une voile sur foil : temps en vol sur temps en mouvement, en pour cent, comme « général » (`activeRatio`). */
const flightRatioValue = (movingS: number | null, inMotionS: number | undefined): string =>
  movingS === null || inMotionS === undefined || inMotionS <= 0 ? DASH : `${commaDecimal(Math.min(100, (movingS / inMotionS) * 100).toFixed(1))}%`;

/**
 * Chiffres de l'image de partage tirés du résumé d'une fiche, là où l'analyse
 * n'est pas ouverte (fin d'un enregistrement). Les clés sont celles des
 * onglets « général » des analyses : le choix retenu pour l'activité vaut
 * aux deux endroits ; un chiffre que la session n'a pas vaut « — ». Sans
 * seuil d'activité (`withActiveThreshold` faux, bateau), la voile n'a ni
 * distance, temps ni moyenne actifs, comme son onglet « général ». Sur foil
 * (`foil`), le temps actif est le temps en vol, et le dit, suivi du ratio de
 * vol. Les lignes ajoutées le 05/11 (`shareExtraStats`) suivent, l'appréciation
 * et la force du vent lues dans les notes de la fiche (`notes`).
 */
export const summaryShareStats = (
  summary: SessionSummary,
  treatment: Treatment,
  units: { speed: SpeedUnit; distance: DistanceUnit },
  withActiveThreshold = true,
  foil = false,
  notes: { rating?: Rating | null; windLevel?: WindLevel | null; windDeg?: number | null } = {}
): ShareStat[] => {
  const results = summary.maneuverResults;
  const success = results ? results.tackSuccess + results.jibeSuccess : 0;
  const extras = shareExtraStats(treatment, {
    maneuvers: results ? { success, total: success + results.tackFail + results.jibeFail } : null,
    pumpingShare: summary.pumpingShare,
    // Le vent saisi dans la fiche, sinon celui que l'analyse a retenu.
    windDeg: notes.windDeg ?? summary.windDirDeg,
    windLevel: notes.windLevel,
    best1kmS: summary.best1kmS,
    best5minMs: summary.best5minMs,
    avgPowerW: summary.avgPowerW,
    rating: notes.rating,
  }, { foil, units });
  return [...summaryBaseStats(summary, treatment, units, withActiveThreshold, foil), ...extras];
};

const summaryBaseStats = (
  summary: SessionSummary,
  treatment: Treatment,
  units: { speed: SpeedUnit; distance: DistanceUnit },
  withActiveThreshold: boolean,
  foil: boolean
): ShareStat[] => {
  const totalS = Math.max((summary.endMs - summary.startMs) / 1000, 0);
  const movingS = summary.movingTimeS;
  const movingM = summary.movingDistanceM ?? null;
  const distance = formatDistance(summary.distanceM, units.distance);
  const speed = (ms: number | null) => (ms === null || !Number.isFinite(ms) ? '—' : formatLandSpeed(ms, units.speed, units.distance));
  const per = (m: number | null, s: number | null) => (m === null || s === null || s <= 0 ? null : m / s);

  if (treatment === 'voile') {
    const active = new Set(['activeDistance', 'activeTime', 'activeRatio', 'activeAverage']);
    return [
      { key: 'distance', label: 'Distance', value: distance },
      { key: 'activeDistance', label: 'Distance active', value: movingM === null ? '—' : formatDistance(movingM, units.distance) },
      { key: 'totalTime', label: 'Temps total', value: formatDuration(totalS * 1000) },
      { key: 'activeTime', label: foil ? 'Temps en vol' : 'Temps actif', value: movingS === null ? '—' : formatDuration(movingS * 1000) },
      // Sur foil : la part du temps en mouvement passée en vol (05/11), comme « général ».
      ...(foil ? [{ key: 'activeRatio', label: FOIL_RATIO_LABEL, value: flightRatioValue(movingS, summary.inMotionS) }] : []),
      { key: 'averageSpeed', label: 'Vitesse moyenne', value: speed(per(summary.distanceM, totalS)) },
      { key: 'activeAverage', label: 'Moyenne active', value: speed(per(movingM, movingS)) },
      { key: 'maxSpeed', label: 'Vitesse max', value: speed(summary.maxSpeedMs) },
      { key: 'maneuvers', label: 'Manœuvres', value: summary.maneuverCount === undefined ? '—' : String(summary.maneuverCount) },
    ].filter((stat) => withActiveThreshold || !active.has(stat.key));
  }
  if (treatment === 'muscu') {
    // Sans trace (lot I du 25/10) : la durée et la FC, comme l'onglet « général » de son analyse.
    const hr = summary.heartRate;
    return [
      { key: 'totalTime', label: 'Durée', value: formatDuration(totalS * 1000) },
      { key: 'activeTime', label: 'Hors pauses', value: movingS === null ? '—' : formatDuration(movingS * 1000) },
      { key: 'heartRate', label: 'FC moyenne', value: hr ? `${Math.round(hr.avgBpm)} bpm` : '—' },
      { key: 'heartRateMax', label: 'FC max', value: hr ? `${hr.maxBpm} bpm` : '—' },
    ];
  }
  if (treatment === 'surf') {
    return [
      { key: 'totalTime', label: 'Durée de la session', value: formatDuration(totalS * 1000) },
      { key: 'waves', label: 'Vagues', value: summary.waveCount === undefined ? '—' : String(summary.waveCount) },
      { key: 'longestWave', label: 'Plus longue vague', value: summary.longestWaveM == null ? '—' : `${Math.round(summary.longestWaveM)} m` },
      // Sans vague, pas de vitesse max (Q34) : « — », comme sa page.
      { key: 'maxSpeed', label: 'Vitesse max', value: summary.maxSpeedMs > 0 ? speed(summary.maxSpeedMs) : '—' },
      { key: 'longestFlight', label: 'Plus long vol', value: summary.longestFlightS == null ? '—' : formatShortDuration(summary.longestFlightS) },
      { key: 'distance', label: 'Distance totale', value: distance },
    ];
  }
  return [
    { key: 'distance', label: 'Distance', value: distance },
    { key: 'activeDistance', label: 'Distance en mouvement', value: movingM === null ? '—' : formatDistance(movingM, units.distance) },
    { key: 'totalTime', label: 'Temps de parcours', value: formatDuration(totalS * 1000) },
    { key: 'activeTime', label: 'Temps en mouvement', value: movingS === null ? '—' : formatDuration(movingS * 1000) },
    { key: 'movingAverage', label: 'Moyenne en mouvement', value: speed(per(movingM ?? summary.distanceM, movingS)) },
    { key: 'overallAverage', label: 'Moyenne sur le temps total', value: speed(per(summary.distanceM, totalS)) },
    { key: 'elevationGain', label: 'Dénivelé', value: summary.elevationGainM === null ? '—' : `+${Math.round(summary.elevationGainM)} m` },
    { key: 'maxSpeed', label: 'Vitesse max', value: speed(summary.maxSpeedMs) },
    { key: 'heartRate', label: 'FC moyenne', value: summary.heartRate ? `${Math.round(summary.heartRate.avgBpm)} bpm` : '—' },
    { key: 'cadence', label: 'Cadence', value: summary.cadence ? `${Math.round(summary.cadence.avgSpm)} pas/min` : '—' },
  ];
};

/**
 * Titre de l'image de partage (nom de la session, sinon son activité, sinon sa
 * famille), sa ligne d'activité et de date, et le nom du fichier partagé, sans
 * extension ni nettoyage (`safeFileName`).
 */
export const shareLabels = (
  name: string | null,
  activityName: string | null,
  familyLabel: string,
  startMs: number,
  file: string
): { title: string; subtitle: string; baseName: string } => {
  const named = name?.trim() || null;
  const title = named ?? activityName ?? familyLabel;
  return {
    title,
    subtitle: [named ? activityName : null, formatSessionDate(startMs)].filter(Boolean).join(' · '),
    baseName: downloadBaseName(title, named ? activityName : null, startMs, file),
  };
};
