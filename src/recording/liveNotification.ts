import { formatClock } from '../core/units';
import type { RecordingNotificationContent } from '../platform/notification';
import type { TestPhase } from './fitnessTest';
import { phaseName, type IntervalStep, type IntervalTimerState } from './intervalTimer';
import { liveFieldLabel, liveFieldShortLabel, liveFieldValue, type LiveFieldContext, type LiveFieldKey } from './liveFields';

/**
 * Texte de la notification de l'enregistrement, visible écran verrouillé.
 *
 * - Titre : l'activité, puis l'état s'il y en a un : la phase du compteur du
 *   fractionné (« Travail 3/8 »), la pause.
 * - Chronomètre d'Android dans l'en-tête, qui tourne seul : le décompte de la
 *   phase du compteur quand elle avance, sinon la durée de la session (depuis
 *   son premier point, pauses comprises, comme `recordingDurationMs`). Aucun
 *   en pause manuelle : la durée figée passe dans le titre, après « en pause »,
 *   pour que la ligne repliée garde ses deux chiffres.
 * - Ligne repliée : les chiffres choisis, libellé court et valeur.
 * - Texte déplié : un chiffre par ligne, libellé complet.
 */

/**
 * Étape de l'entraînement pour le chiffre « Étape » (26/10) : celle du
 * compteur quand une séance avance ou attend en pause, sinon le palier de la
 * rampe d'un test guidé, sans total ; `null` hors des deux.
 */
export const trainingStep = (
  interval: IntervalStep | null,
  test: { active: boolean; phase: TestPhase; step: number } | null,
): LiveFieldContext['step'] => {
  if (interval) return { rep: interval.rep, of: interval.of };
  if (test?.active && test.phase === 'rampe' && test.step > 0) return { rep: test.step, of: null };
  return null;
};

export interface LiveNotificationInput {
  activityName: string;
  /** Chiffres choisis pour la notification, dans l'ordre. */
  fields: LiveFieldKey[];
  context: LiveFieldContext;
  /** Pause en cours : manuelle (GPS coupé), automatique (immobilité), ou aucune. */
  paused: 'manual' | 'auto' | null;
  /** Premier point de la session, en ms ; `null` avant lui. */
  startedAtMs: number | null;
  /** Séance du compteur qui court ou attend en pause, avec son nombre de répétitions ; `null` sinon. */
  interval: { state: IntervalTimerState } | null;
  /** Instant présent, en ms. */
  nowMs: number;
}

const SEPARATOR = ' · ';

/** Arrondi à la seconde : un même chronomètre recalculé ne doit pas passer pour un changement. */
const toSecond = (ms: number): number => Math.round(ms / 1000) * 1000;

export const liveNotification = ({
  activityName, fields, context, paused, startedAtMs, interval, nowMs,
}: LiveNotificationInput): RecordingNotificationContent => {
  const phase = interval?.state.phase ?? null;
  const counterRunning = phase !== null && interval?.state.status === 'running';

  const titleParts = [activityName];
  if (phase && interval) titleParts.push(interval.state.status === 'paused' ? `${phaseName(phase)} en pause` : phaseName(phase));
  if (paused === 'manual') titleParts.push(`en pause ${formatClock(context.durationMs)}`);
  else if (paused === 'auto') titleParts.push('pause auto');

  const values = fields.map((key) => ({
    short: liveFieldShortLabel(key, context),
    label: liveFieldLabel(key, context),
    value: liveFieldValue(key, context),
  }));
  const text = values.map((v) => `${v.short} ${v.value}`);
  const lines = values.map((v) => `${v.label} : ${v.value}`);

  let chrono: RecordingNotificationContent['chrono'] = null;
  if (paused !== 'manual') {
    if (counterRunning && interval) chrono = { baseMs: toSecond(nowMs + interval.state.remainingMs), countDown: true };
    else if (startedAtMs !== null) chrono = { baseMs: toSecond(startedAtMs), countDown: false };
  }

  return { title: titleParts.join(SEPARATOR), text: text.join(SEPARATOR), lines, chrono };
};

/** Clé d'une notification : deux notifications de même clé disent la même chose. */
export const liveNotificationKey = (content: RecordingNotificationContent, standalone: boolean): string =>
  JSON.stringify([content.title, content.text, content.lines, content.chrono, standalone]);
