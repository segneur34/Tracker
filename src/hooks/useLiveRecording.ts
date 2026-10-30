import { useSyncExternalStore } from 'react';
import type { Activity } from '../core/activities';
import { getSportProfile, hasPositions, sportFamily, sportTreatment, usesMarkCourse } from '../core/sportProfiles';
import { METERS_PER_DISTANCE_UNIT } from '../core/units';
import { REFERENCE_RIDER_KG, cyclingEnergyParams } from '../cycling/energy';
import type { LocationFix } from '../platform/location';
import { createFollowCursor, type FollowCursor, type FollowProgress, type FollowedTrace } from '../recording/followedTrace';
import {
  EMPTY_LIVE_STATS, LIVE_STATS_DEFAULTS, computeLiveStats, createLiveStatsMemory, heartOnlyLiveStats, type LiveEnergySetup, type LiveStats,
  type LiveStatsMemory, type LiveStatsOptions,
} from '../recording/liveStats';
import { runningEnergyParams, walkingEnergyParams } from '../running/energy';
import { getFollowedTrace, subscribeToFollowedTrace } from './useFollowedTrace';
import { getLiveHeartSegments, getLiveSegments, getRecorderState, subscribeToRecorder } from './useRecorder';
import { readRunnerProfile } from './useRunnerProfile';
import { effectiveBikeSetup, effectiveDistanceUnit, effectiveEnergyModel } from './useSportSettings';
import { createListeners } from './createStore';

/**
 * Trace et statistiques de l'enregistrement en cours, hors des composants
 * comme l'enregistreur : la page Enregistrer les affiche, la notification de
 * l'enregistrement les reprend écran éteint, sans calcul en double.
 *
 * Recalculées à l'arrivée des positions, par l'état de l'enregistreur qui les
 * garde (`subscribeToRecorder`, seule boucle sûre écran éteint), une fois la
 * position comptée, au plus toutes les `PAGE_REFRESH_MS` quand une page les lit,
 * toutes les `BACKGROUND_REFRESH_MS` sinon : une longue trace coûte, et
 * l'enregistreur n'en porte pas le coût. Une page qui regarde a en plus un
 * dernier calcul différé, pour ne pas rester sur un état vieux de quelques
 * secondes quand les positions s'arrêtent (pause manuelle, fin d'un rejeu).
 *
 * Le « dernier kilomètre » (ou mille) suit l'unité de distance de l'activité ;
 * la puissance et l'énergie (course, vélo), le modèle de l'analyse. En dehors
 * d'un parcours de voile, l'avancement sur la trace suivie est calculé ici.
 * Sans position (muscu), la FC moyenne seule, sur les mesures de la ceinture
 * (`heartOnlyLiveStats`) : aucun calcul GPS.
 */

/** Intervalle minimal entre deux recalculs quand une page regarde, en temps réel. */
const PAGE_REFRESH_MS = 2000;
/** Intervalle minimal entre deux recalculs sans page, pour la notification. */
const BACKGROUND_REFRESH_MS = 5000;

export interface LiveRecording {
  segments: LocationFix[][];
  stats: LiveStats;
  /** Instant du dernier calcul, en ms ; `null` avant le premier. */
  updatedMs: number | null;
  /**
   * Avancement sur la trace suivie, hors parcours de voile (compté par
   * balises, `useMarkGuide`) ; `null` sans trace ou avant de l'avoir rejointe.
   */
  progress: FollowProgress | null;
}

const EMPTY: LiveRecording = { segments: [], stats: EMPTY_LIVE_STATS, updatedMs: null, progress: null };

/** Modèle de la puissance et de l'énergie en direct, celui de l'analyse ; aucun en voile ni en surf. */
const liveEnergySetup = (activity: Activity): LiveEnergySetup | undefined => {
  const treatment = sportTreatment(activity.base);
  const runner = readRunnerProfile();
  if (treatment === 'course') {
    const params = effectiveEnergyModel(activity) === 'marche'
      ? walkingEnergyParams(runner.economyMlKgKm, runner.weightKg)
      : runningEnergyParams(runner.economyMlKgKm);
    return { family: treatment, params, massKg: runner.weightKg };
  }
  if (treatment === 'velo') {
    const { bikeType, bikeKg } = effectiveBikeSetup(activity);
    return { family: treatment, params: cyclingEnergyParams(bikeType, bikeKg, runner.weightKg ?? REFERENCE_RIDER_KG) };
  }
  return undefined;
};

/**
 * Options du calcul du direct pour une activité : celles par défaut, le
 * « dernier kilomètre » (ou mille) dans son unité de distance, et le modèle
 * d'énergie de l'analyse. Les libellés du direct les reprennent.
 */
export const liveStatsOptionsFor = (activity: Activity): LiveStatsOptions => ({
  ...LIVE_STATS_DEFAULTS,
  lastDistanceM: METERS_PER_DISTANCE_UNIT[effectiveDistanceUnit(activity)],
  energy: liveEnergySetup(activity),
});

/** Trace suivie dont l'avancement se compte le long d'elle : pas un parcours à balises (voile, surf). */
const tracedAlong = (trace: FollowedTrace | null, activity: Activity): FollowedTrace | null =>
  trace && !(trace.marks && usesMarkCourse(sportFamily(activity.base))) ? trace : null;

let live: LiveRecording = EMPTY;
/** Ce qui a servi au dernier calcul : rien de neuf, pas de recalcul. */
let computedFor: { pointCount: number; activity: Activity; trace: FollowedTrace | null } | null = null;
/**
 * Mémoire du direct de la session en cours (segments fermés calculés une fois, cinématique reprise) et curseur
 * sur la trace suivie, qui ne relit que les positions nouvelles (27/10) ; jetés au retour au repos.
 */
let memory: LiveStatsMemory = createLiveStatsMemory();
let follow: { trace: FollowedTrace; cursor: FollowCursor } | null = null;
let lastRunMs = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Pages qui lisent le direct (`useLiveRecording`). */
const pageListeners = createListeners();
/** Abonnés hors React (notification), qui ne pressent pas le rythme. */
// Un abonné en échec n'arrête pas le direct.
const backgroundListeners = createListeners({ safe: true });

const publish = () => {
  pageListeners.notify();
  backgroundListeners.notify();
};

const clearTimer = () => {
  if (timer !== null) clearTimeout(timer);
  timer = null;
};

/** Revient au direct vide, et le dit s'il ne l'était pas. */
const reset = () => {
  clearTimer();
  computedFor = null;
  memory = createLiveStatsMemory();
  follow = null;
  if (live === EMPTY) return;
  live = EMPTY;
  publish();
};

const compute = () => {
  const { status, activity, stats } = getRecorderState();
  if (status === 'idle' || activity === null) return;
  // Avant la première position, rien à calculer.
  if (stats.pointCount === 0) {
    reset();
    return;
  }
  const trace = getFollowedTrace();
  if (computedFor && computedFor.pointCount === stats.pointCount && computedFor.activity === activity && computedFor.trace === trace) return;
  computedFor = { pointCount: stats.pointCount, activity, trace };
  lastRunMs = Date.now();
  if (!hasPositions(activity.base)) {
    live = { segments: [], stats: heartOnlyLiveStats(getLiveHeartSegments(), getSportProfile(activity.base).heartRate), updatedMs: lastRunMs, progress: null };
    publish();
    return;
  }
  const segments = getLiveSegments();
  const computed = computeLiveStats(segments, getSportProfile(activity.base), liveStatsOptionsFor(activity), memory);
  const along = tracedAlong(trace, activity);
  if (along && follow?.trace !== along) follow = { trace: along, cursor: createFollowCursor(along) };
  live = { segments, stats: computed, updatedMs: lastRunMs, progress: along ? follow!.cursor.progress(segments) : null };
  publish();
};

/** Recalcule dès que le rythme le permet ; sans page, une position plus tardive s'en chargera. */
const request = () => {
  const { status, activity } = getRecorderState();
  if (status === 'idle' || activity === null) {
    reset();
    return;
  }
  if (timer !== null) return;
  const refreshMs = pageListeners.size() > 0 ? PAGE_REFRESH_MS : BACKGROUND_REFRESH_MS;
  const waitMs = Math.max(0, refreshMs - (Date.now() - lastRunMs));
  if (waitMs === 0) compute();
  else if (pageListeners.size() > 0) {
    timer = setTimeout(() => {
      timer = null;
      compute();
    }, waitMs);
  }
};

let started = false;

/** Branche le direct sur l'enregistreur ; à appeler une fois au démarrage de l'application. */
export const startLiveRecording = (): void => {
  if (started) return;
  started = true;
  subscribeToRecorder(request);
  subscribeToFollowedTrace(request);
  request();
};

/** Trace et statistiques du moment, hors React. */
export const getLiveRecording = (): LiveRecording => live;

/** Chaque recalcul, hors React ; sans effet sur le rythme. Rend le désabonnement. */
export const subscribeToLiveRecording = (listener: () => void): (() => void) => backgroundListeners.subscribe(listener);

const subscribe = (listener: () => void) => {
  const unsubscribe = pageListeners.subscribe(listener);
  // Une page qui arrive passe au rythme rapide.
  queueMicrotask(request);
  return unsubscribe;
};

/** Trace et statistiques de l'enregistrement en cours, pour une page ; vides au repos. */
export const useLiveRecording = (): LiveRecording => useSyncExternalStore(subscribe, () => live);
