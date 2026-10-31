import type { ShareStat } from '../core/shareImage';
import type { Treatment } from '../core/sportProfiles';
import { formatDistance, formatDuration, formatSessionDate, formatShortDuration, formatLandSpeed, type DistanceUnit, type SpeedUnit } from '../core/units';
import { downloadBaseName } from './naming';
import type { SessionSummary } from './record';

/**
 * Chiffres de l'image de partage tirés du résumé d'une fiche, là où l'analyse
 * n'est pas ouverte (fin d'un enregistrement). Les clés sont celles des
 * onglets « général » des analyses : le choix retenu pour l'activité vaut
 * aux deux endroits ; un chiffre que la session n'a pas vaut « — ». Sans
 * seuil d'activité (`withActiveThreshold` faux, bateau), la voile n'a ni
 * distance, temps ni moyenne actifs, comme son onglet « général ». Sur foil
 * (`foil`), le temps actif est le temps en vol, et le dit.
 */
export const summaryShareStats = (
  summary: SessionSummary,
  treatment: Treatment,
  units: { speed: SpeedUnit; distance: DistanceUnit },
  withActiveThreshold = true,
  foil = false
): ShareStat[] => {
  const totalS = Math.max((summary.endMs - summary.startMs) / 1000, 0);
  const movingS = summary.movingTimeS;
  const movingM = summary.movingDistanceM ?? null;
  const distance = formatDistance(summary.distanceM, units.distance);
  const speed = (ms: number | null) => (ms === null || !Number.isFinite(ms) ? '—' : formatLandSpeed(ms, units.speed, units.distance));
  const per = (m: number | null, s: number | null) => (m === null || s === null || s <= 0 ? null : m / s);

  if (treatment === 'voile') {
    const active = new Set(['activeDistance', 'activeTime', 'activeAverage']);
    return [
      { key: 'distance', label: 'Distance', value: distance },
      { key: 'activeDistance', label: 'Distance active', value: movingM === null ? '—' : formatDistance(movingM, units.distance) },
      { key: 'totalTime', label: 'Temps total', value: formatDuration(totalS * 1000) },
      { key: 'activeTime', label: foil ? 'Temps en vol' : 'Temps actif', value: movingS === null ? '—' : formatDuration(movingS * 1000) },
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
      { key: 'maxSpeed', label: 'Vitesse max', value: speed(summary.maxSpeedMs) },
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
