/**
 * Compteur du fractionné (§10, point 89) : une séance faite de blocs, dans
 * l'ordre. Un bloc de séries est une suite de répétitions, chacune un temps
 * de travail suivi d'un temps de repos (aucun après la dernière) ; un bloc
 * libre est une phase d'un seul tenant (échauffement, récupération, retour au
 * calme), hors des répétitions.
 *
 * Il suit l'horloge, pas les positions GPS : il tourne avec ou sans
 * enregistrement. Tout se déduit de la séance, de l'instant de son lancement
 * et de ses commandes datées (pause, reprise, « Passer », arrêt) : l'état à un
 * instant, les bips à venir, les phases accomplies. Rien n'est à rattraper
 * quand l'écran se rallume, et une séance se rejoue à l'identique (tests).
 *
 * Les temps de séance sont en secondes depuis le lancement, pauses ôtées et
 * « Passer » compris ; les instants, en millisecondes de l'horloge.
 */

import { BEEP_FINAL_MS, BEEP_LONG_MS, BEEP_SHORT_MS } from '../core/beepDurations';
import { formatMinSecHours } from '../core/units';

/** Bloc de répétitions : travail, repos, travail… sans repos après la dernière. */
export interface IntervalSeriesBlock {
  kind: 'series';
  reps: number;
  workS: number;
  restS: number;
}

/** Nom d'un bloc libre. */
export type IntervalFreeLabel = 'Échauffement' | 'Récupération' | 'Retour au calme';

export const INTERVAL_FREE_LABELS: readonly IntervalFreeLabel[] = ['Échauffement', 'Récupération', 'Retour au calme'];

/** Bloc libre : une seule phase, hors des répétitions. */
export interface IntervalFreeBlock {
  kind: 'libre';
  label: IntervalFreeLabel;
  durationS: number;
}

export type IntervalBlock = IntervalSeriesBlock | IntervalFreeBlock;

/**
 * Une séance. `reps`, `workS` et `restS` sont ceux de son premier bloc de
 * séries : une séance d'un seul bloc n'a pas de `blocks`, comme avant les
 * blocs (24/10), et une version d'avant lit encore le premier bloc d'une
 * séance qui en a plusieurs.
 */
export interface IntervalWorkout {
  /** Nombre de répétitions. */
  reps: number;
  /** Temps de travail de chaque répétition, en secondes. */
  workS: number;
  /** Temps de repos entre deux répétitions, en secondes ; 0 : aucun. */
  restS: number;
  /** Les blocs, dans l'ordre, quand la séance n'est pas un seul bloc de séries. */
  blocks?: IntervalBlock[];
}

/** Bornes de la saisie : des secondes entières. */
export const INTERVAL_LIMITS = {
  reps: { min: 1, max: 99 },
  workS: { min: 5, max: 3600 },
  restS: { min: 0, max: 3600 },
  /** Durée d'un bloc libre. */
  freeS: { min: 5, max: 3600 },
  /** Blocs d'une séance. */
  blocks: { min: 1, max: 20 },
} as const;

/** Séance proposée la première fois : 10 × 1 min, 1 min de repos. */
export const DEFAULT_INTERVAL_WORKOUT: IntervalWorkout = { reps: 10, workS: 60, restS: 60 };

/** Séances gardées, au plus. */
export const MAX_INTERVAL_PRESETS = 30;

/** Sons du compteur : bip court, bip long, et le long double de la fin de séance. */
export type IntervalToneKind = 'court' | 'long' | 'final';

/** Durée de chaque son, en millisecondes (`core/beepDurations.ts`). */
export const INTERVAL_TONE_MS: Record<IntervalToneKind, number> = { court: BEEP_SHORT_MS, long: BEEP_LONG_MS, final: BEEP_FINAL_MS };

/**
 * Compte à rebours avant le premier travail, en secondes : on lance le
 * compteur, le signal du départ se joue, puis le travail commence.
 */
export const INTERVAL_LEAD_IN_S = 3;

/**
 * Retard toléré d'un bip, en secondes : le programme est calculé un instant
 * après la commande qui le demande ; un bip dû à ce moment-là se joue encore,
 * tout de suite.
 */
const TONE_GRACE_S = 0.25;

const inRange = (value: unknown, range: { min: number; max: number }): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max;

const sanitizeSeries = (value: Record<string, unknown>): IntervalSeriesBlock | null => {
  const { reps, workS, restS } = value;
  return inRange(reps, INTERVAL_LIMITS.reps) && inRange(workS, INTERVAL_LIMITS.workS) && inRange(restS, INTERVAL_LIMITS.restS)
    ? { kind: 'series', reps, workS, restS }
    : null;
};

const sanitizeBlock = (value: unknown): IntervalBlock | null => {
  if (typeof value !== 'object' || value === null) return null;
  const block = value as Record<string, unknown>;
  if (block.kind === 'series') return sanitizeSeries(block);
  if (block.kind !== 'libre' || !INTERVAL_FREE_LABELS.includes(block.label as IntervalFreeLabel)) return null;
  return inRange(block.durationS, INTERVAL_LIMITS.freeS)
    ? { kind: 'libre', label: block.label as IntervalFreeLabel, durationS: block.durationS }
    : null;
};

/**
 * Séance faite de ces blocs ; `null` si l'un n'est pas valable, s'ils sont
 * trop nombreux, ou sans bloc de séries. Un seul bloc de séries donne une
 * séance sans `blocks`.
 */
export const workoutFromBlocks = (blocks: readonly IntervalBlock[]): IntervalWorkout | null => {
  if (blocks.length < INTERVAL_LIMITS.blocks.min || blocks.length > INTERVAL_LIMITS.blocks.max) return null;
  const clean = blocks.map(sanitizeBlock);
  if (clean.some((b) => b === null)) return null;
  const kept = clean as IntervalBlock[];
  const first = kept.find((b): b is IntervalSeriesBlock => b.kind === 'series');
  if (!first) return null;
  const head = { reps: first.reps, workS: first.workS, restS: first.restS };
  return kept.length === 1 ? head : { ...head, blocks: kept };
};

/** Blocs d'une séance : les siens, ou son seul bloc de séries. */
export const workoutBlocks = (workout: IntervalWorkout): IntervalBlock[] =>
  workout.blocks ?? [{ kind: 'series', reps: workout.reps, workS: workout.workS, restS: workout.restS }];

/**
 * Séance lue du stockage ou d'une saisie ; `null` si elle n'en est pas une.
 * Des blocs abîmés (ou d'une version future) laissent le premier bloc de séries.
 */
export const sanitizeWorkout = (value: unknown): IntervalWorkout | null => {
  if (typeof value !== 'object' || value === null) return null;
  const { blocks } = value as Record<string, unknown>;
  if (Array.isArray(blocks)) {
    const fromBlocks = workoutFromBlocks(blocks as IntervalBlock[]);
    if (fromBlocks) return fromBlocks;
  }
  const head = sanitizeSeries(value as Record<string, unknown>);
  return head ? { reps: head.reps, workS: head.workS, restS: head.restS } : null;
};

const sameBlock = (a: IntervalBlock, b: IntervalBlock): boolean =>
  a.kind === 'series' && b.kind === 'series'
    ? a.reps === b.reps && a.workS === b.workS && a.restS === b.restS
    : a.kind === 'libre' && b.kind === 'libre' && a.label === b.label && a.durationS === b.durationS;

export const sameWorkout = (a: IntervalWorkout, b: IntervalWorkout): boolean => {
  const blocksA = workoutBlocks(a);
  const blocksB = workoutBlocks(b);
  return blocksA.length === blocksB.length && blocksA.every((block, i) => sameBlock(block, blocksB[i]));
};

/** Durée en m:ss, h:mm:ss au-delà d'une heure. */
export const formatIntervalClock = (seconds: number): string => {
  return formatMinSecHours(Math.max(0, Math.ceil(seconds)));
};

/** Nom d'un bloc : « 10 × 1:00 / 0:30 », sans repos « 10 × 1:00 » ; un bloc libre, « Échauffement 10:00 ». */
export const blockLabel = (block: IntervalBlock): string =>
  block.kind === 'libre'
    ? `${block.label} ${formatIntervalClock(block.durationS)}`
    : `${block.reps} × ${formatIntervalClock(block.workS)}${block.restS > 0 ? ` / ${formatIntervalClock(block.restS)}` : ''}`;

/** Nom d'une séance : celui de chaque bloc, dans l'ordre, liés par « + ». */
export const workoutLabel = (workout: IntervalWorkout): string => workoutBlocks(workout).map(blockLabel).join(' + ');

/** Durée d'un bloc, en secondes. */
export const blockDurationS = (block: IntervalBlock): number =>
  block.kind === 'libre' ? block.durationS : block.reps * block.workS + (block.reps - 1) * block.restS;

/** Durée totale d'une séance, en secondes. */
export const workoutDurationS = (workout: IntervalWorkout): number =>
  workoutBlocks(workout).reduce((sum, block) => sum + blockDurationS(block), 0);

// --- Séances gardées ---

export interface IntervalPreset {
  id: string;
  name: string;
  workout: IntervalWorkout;
}

/** Séances gardées lues du stockage : les valables, sans doublon d'identifiant, `MAX_INTERVAL_PRESETS` au plus. */
export const sanitizePresets = (value: unknown): IntervalPreset[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const list: IntervalPreset[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, name, workout } = item as Record<string, unknown>;
    const clean = sanitizeWorkout(workout);
    if (typeof id !== 'string' || id === '' || seen.has(id) || clean === null) continue;
    seen.add(id);
    list.push({ id, name: typeof name === 'string' && name.trim() !== '' ? name.trim() : workoutLabel(clean), workout: clean });
    if (list.length === MAX_INTERVAL_PRESETS) break;
  }
  return list;
};

/** Identifiant libre pour une nouvelle séance gardée. */
export const newPresetId = (existing: IntervalPreset[]): string => {
  const taken = new Set(existing.map((p) => p.id));
  let n = existing.length + 1;
  while (taken.has(`s${n}`)) n++;
  return `s${n}`;
};

/** Liste avec une séance de plus, sous ce nom (vide : son libellé) ; telle quelle au-delà de `MAX_INTERVAL_PRESETS` ou pour une séance non valable. */
export const addPreset = (presets: IntervalPreset[], name: string, workout: IntervalWorkout): IntervalPreset[] => {
  const clean = sanitizeWorkout(workout);
  if (!clean || presets.length >= MAX_INTERVAL_PRESETS) return presets;
  return [...presets, { id: newPresetId(presets), name: name.trim() || workoutLabel(clean), workout: clean }];
};

/** Liste où la séance `id` prend ce nom (vide : son libellé) et ces blocs ; telle quelle si elle n'y est plus ou n'est pas valable. */
export const replacePreset = (presets: IntervalPreset[], id: string, name: string, workout: IntervalWorkout): IntervalPreset[] => {
  const clean = sanitizeWorkout(workout);
  if (!clean || !presets.some((p) => p.id === id)) return presets;
  return presets.map((p) => (p.id === id ? { id, name: name.trim() || workoutLabel(clean), workout: clean } : p));
};

/** Liste sans la séance `id`. */
export const withoutPreset = (presets: IntervalPreset[], id: string): IntervalPreset[] => presets.filter((p) => p.id !== id);

// --- Genres de séances ---

/**
 * Deux listes de séances, une seule mécanique (25/10) : celles du Fractionné,
 * lancées avec une activité et rangées avec la session, et celles du Timer,
 * hors de toute activité, sans GPS ni session.
 */
export type WorkoutKind = 'fractionne' | 'timer';

/** Séance proposée la première fois au Timer : 8 × 40 s, 20 s de repos. */
export const DEFAULT_TIMER_WORKOUT: IntervalWorkout = { reps: 8, workS: 40, restS: 20 };

// --- Phases ---

/** `pret` : le compte à rebours du départ, qui n'est pas une répétition ; `libre` : un bloc libre. */
export type IntervalPhaseKind = 'pret' | 'travail' | 'repos' | 'libre';

export interface IntervalPhase {
  kind: IntervalPhaseKind;
  /** Répétition, de 1 à `of` ; un repos porte celle qu'il suit ; 1 pour le départ et un bloc libre. */
  rep: number;
  /** Répétitions du bloc de la phase ; 1 pour le départ et un bloc libre. */
  of: number;
  /** Indice du bloc de la phase, à partir de 0 (celui du premier bloc pour le départ). */
  block: number;
  /** Rang du bloc parmi les blocs de séries, à partir de 1 ; 0 hors d'un bloc de séries. */
  series: number;
  /** Nombre de blocs de séries de la séance. */
  seriesCount: number;
  /** Nom d'un bloc libre. */
  label?: IntervalFreeLabel;
  /** Bornes en temps de séance, en secondes. */
  startS: number;
  endS: number;
}

/**
 * Phases d'une séance, dans l'ordre : départ, puis chaque bloc, un bloc de
 * séries en travail, repos, travail… sans repos après sa dernière répétition.
 */
export const workoutPhases = (workout: IntervalWorkout): IntervalPhase[] => {
  const blocks = workoutBlocks(workout);
  const seriesCount = blocks.filter((b) => b.kind === 'series').length;
  const phases: IntervalPhase[] = [
    { kind: 'pret', rep: 1, of: 1, block: 0, series: 0, seriesCount, startS: 0, endS: INTERVAL_LEAD_IN_S },
  ];
  let t = INTERVAL_LEAD_IN_S;
  let series = 0;
  blocks.forEach((block, index) => {
    if (block.kind === 'libre') {
      phases.push({ kind: 'libre', rep: 1, of: 1, block: index, series: 0, seriesCount, label: block.label, startS: t, endS: t + block.durationS });
      t += block.durationS;
      return;
    }
    series++;
    const at = { of: block.reps, block: index, series, seriesCount };
    for (let rep = 1; rep <= block.reps; rep++) {
      phases.push({ kind: 'travail', rep, ...at, startS: t, endS: t + block.workS });
      t += block.workS;
      if (rep < block.reps && block.restS > 0) {
        phases.push({ kind: 'repos', rep, ...at, startS: t, endS: t + block.restS });
        t += block.restS;
      }
    }
  });
  return phases;
};

/**
 * Nom d'une phase : « Départ », « Travail 3/10 », « Repos 3/10 », le nom d'un
 * bloc libre ; « Série 2 · Travail 3/5 » quand la séance a plusieurs blocs de séries.
 */
export const phaseName = (phase: IntervalPhase): string => {
  if (phase.kind === 'pret') return 'Départ';
  if (phase.kind === 'libre') return phase.label ?? 'Libre';
  const name = `${phase.kind === 'travail' ? 'Travail' : 'Repos'} ${phase.rep}/${phase.of}`;
  return phase.seriesCount > 1 ? `Série ${phase.series} · ${name}` : name;
};

// --- Séance lancée ---

export type IntervalCommand = 'pause' | 'resume' | 'skip' | 'stop';

export interface IntervalRun {
  workout: IntervalWorkout;
  /** Instant du lancement, en ms ; il identifie la séance. */
  startedAtMs: number;
  /** Commandes acceptées, dans l'ordre. */
  commands: { kind: IntervalCommand; atMs: number }[];
  /** Séance du Timer, qu'aucune session ne reçoit ; absent : du Fractionné. */
  kind?: 'timer';
}

export const startRun = (workout: IntervalWorkout, nowMs: number, kind: WorkoutKind = 'fractionne'): IntervalRun =>
  kind === 'timer' ? { workout, startedAtMs: nowMs, commands: [], kind } : { workout, startedAtMs: nowMs, commands: [] };

export type IntervalStatus = 'running' | 'paused' | 'finished' | 'stopped';

interface Walk {
  phases: IntervalPhase[];
  /** Instant où chaque phase s'est terminée, pour celles qui le sont, dans l'ordre. */
  ends: number[];
  /** Temps de séance à l'instant demandé, en secondes. */
  elapsedS: number;
  status: IntervalStatus;
  /** Instant de la fin (dernière phase finie ou passée, ou arrêt), `null` avant. */
  endedAtMs: number | null;
}

/**
 * Déroule la séance jusqu'à `untilMs` : elle avance à l'horloge sauf en
 * pause ; « Passer » termine la phase en cours à l'instant même ; l'arrêt, ou
 * la fin de la dernière phase, la clôt.
 */
const walk = (run: IntervalRun, untilMs: number): Walk => {
  const phases = workoutPhases(run.workout);
  const ends: number[] = [];
  let elapsedS = 0;
  let t = run.startedAtMs;
  let running = true;
  let endedAtMs: number | null = null;
  let stopped = false;

  const advance = (to: number) => {
    if (to <= t) return;
    if (running && endedAtMs === null) {
      const target = elapsedS + (to - t) / 1000;
      while (ends.length < phases.length && phases[ends.length].endS <= target) {
        ends.push(t + (phases[ends.length].endS - elapsedS) * 1000);
      }
      elapsedS = Math.min(target, phases[phases.length - 1].endS);
      if (ends.length === phases.length) endedAtMs = ends[ends.length - 1];
    }
    t = to;
  };

  for (const command of run.commands) {
    if (command.atMs > untilMs || endedAtMs !== null) break;
    advance(command.atMs);
    if (endedAtMs !== null) break;
    if (command.kind === 'pause') running = false;
    else if (command.kind === 'resume') running = true;
    else if (command.kind === 'skip') {
      elapsedS = phases[ends.length].endS;
      ends.push(command.atMs);
      if (ends.length === phases.length) endedAtMs = command.atMs;
    } else {
      endedAtMs = command.atMs;
      stopped = true;
    }
  }
  advance(untilMs);
  const status: IntervalStatus = endedAtMs !== null ? (stopped ? 'stopped' : 'finished') : running ? 'running' : 'paused';
  return { phases, ends, elapsedS, status, endedAtMs };
};

/**
 * Séance après une commande, à l'instant `nowMs` ; inchangée si la commande
 * n'a pas de sens (pause d'une séance déjà en pause, commande après la fin).
 */
export const runCommand = (run: IntervalRun, kind: IntervalCommand, nowMs: number): IntervalRun => {
  const { status } = walk(run, nowMs);
  const allowed =
    (kind === 'pause' && status === 'running') ||
    (kind === 'resume' && status === 'paused') ||
    ((kind === 'skip' || kind === 'stop') && (status === 'running' || status === 'paused'));
  return allowed ? { ...run, commands: [...run.commands, { kind, atMs: nowMs }] } : run;
};

export interface IntervalTimerState {
  status: IntervalStatus;
  /** Phase en cours, `null` une fois la séance close. */
  phase: IntervalPhase | null;
  /** Temps restant de la phase en cours, en ms. */
  remainingMs: number;
  /** Temps de séance écoulé, en secondes. */
  elapsedS: number;
}

/** État de la séance à l'instant `nowMs`. */
export const timerStateAt = (run: IntervalRun, nowMs: number): IntervalTimerState => {
  const { phases, ends, elapsedS, status } = walk(run, nowMs);
  if (status === 'finished' || status === 'stopped') return { status, phase: null, remainingMs: 0, elapsedS };
  const phase = phases[ends.length];
  return { status, phase, remainingMs: Math.max(0, (phase.endS - elapsedS) * 1000), elapsedS };
};

/**
 * Séance close, finie ou arrêtée : il n'en reste que l'écran « terminée »,
 * qu'on ne revoit pas en revenant sur la page (26/10).
 */
export const isRunClosed = (run: IntervalRun, nowMs: number): boolean => {
  const { status } = timerStateAt(run, nowMs);
  return status === 'finished' || status === 'stopped';
};

/** Étape d'une séance : la répétition de travail en cours, ou la dernière faite, sur toutes celles de la séance. */
export interface IntervalStep {
  rep: number;
  of: number;
}

/**
 * Étape à l'instant `nowMs`, pour la notification (26/10) : les répétitions
 * sont comptées sur toute la séance, tous blocs de séries confondus ; un repos
 * ou un bloc libre garde celle qui le précède, 0 avant la première (départ,
 * échauffement). `null` une fois la séance close.
 */
export const intervalStepAt = (run: IntervalRun, nowMs: number): IntervalStep | null => {
  const { phase } = timerStateAt(run, nowMs);
  if (!phase) return null;
  const work = workoutPhases(run.workout).filter((p) => p.kind === 'travail');
  return { rep: work.filter((p) => p.startS <= phase.startS).length, of: work.length };
};

/** Un son programmé, après `delayMs`. */
export interface IntervalTone {
  delayMs: number;
  tone: IntervalToneKind;
}

/** Changement de phase à venir, pour la notification : son nom, et le temps qu'elle durera. */
export interface IntervalPhaseCue {
  delayMs: number;
  /** Nom de la phase (`phaseName`), ou « Terminé ». */
  title: string;
  /** Temps de la phase à partir de ce changement, en ms (le reste, pour celle en cours) ; 0 pour la fin. */
  phaseMs: number;
}

export interface IntervalSchedule {
  tones: IntervalTone[];
  cues: IntervalPhaseCue[];
}

/**
 * Signal de la fin d'une phase (essais de l'utilisateur, 07/10, sur 10 s /
 * 10 s) : un bip par seconde, dans les dernières secondes de la phase qui
 * finit, le dernier se taisant à l'instant même du changement, pour ne rien
 * prendre à la suivante. Le même vers un travail et vers un repos : court,
 * court, long. À la fin de la séance : court, long, puis un long double.
 */
const SIGNALS: Record<'phase' | 'fin', IntervalToneKind[]> = {
  phase: ['court', 'court', 'long'],
  fin: ['court', 'long', 'final'],
};

/** Sons d'un signal, chacun avec son début en secondes avant la fin de la phase : une seconde entre deux débuts, le dernier finit à 0. */
const signalTones = (kinds: IntervalToneKind[]): { atS: number; tone: IntervalToneKind }[] => {
  const lastS = INTERVAL_TONE_MS[kinds[kinds.length - 1]] / 1000;
  return kinds.map((tone, i) => ({ atS: -lastS - (kinds.length - 1 - i), tone }));
};

/**
 * Programme des sons et des changements de phase, depuis `nowMs` jusqu'à la
 * fin, pour une séance qui avance sans plus de commande : le signal de la
 * fin de chaque phase (`SIGNALS`), le compte à rebours du départ compris.
 * Un bip ne tombe jamais avant le début de sa phase : une phase plus courte
 * que son signal n'en garde que la fin. Vide si la séance n'avance pas
 * (pause, fin). `announce` : après « Passer », la phase commence tout de
 * suite, un bip long l'annonce.
 */
export const upcomingSchedule = (run: IntervalRun, nowMs: number, announce: boolean): IntervalSchedule => {
  const { phases, ends, elapsedS, status } = walk(run, nowMs);
  if (status !== 'running') return { tones: [], cues: [] };
  const tones: IntervalTone[] = [];
  const cues: IntervalPhaseCue[] = [];
  const current = ends.length;
  const delayOf = (s: number) => Math.max(0, Math.round((s - elapsedS) * 1000));
  const cue = (phase: IntervalPhase, delayMs: number, phaseMs: number) =>
    cues.push({ delayMs, title: phaseName(phase), phaseMs });

  cue(phases[current], 0, delayOf(phases[current].endS));
  if (announce) tones.push({ delayMs: 0, tone: 'long' });
  for (let j = current; j < phases.length; j++) {
    const phase = phases[j];
    const next = phases[j + 1];
    for (const { atS, tone } of signalTones(SIGNALS[next ? 'phase' : 'fin'])) {
      const at = phase.endS + atS;
      if (at >= phase.startS && at > elapsedS - TONE_GRACE_S) tones.push({ delayMs: delayOf(at), tone });
    }
    const boundary = delayOf(phase.endS);
    if (next) cue(next, boundary, (next.endS - next.startS) * 1000);
    else cues.push({ delayMs: boundary, title: 'Terminé', phaseMs: 0 });
  }
  return { tones, cues };
};

// --- Phases accomplies ---

/**
 * Une phase telle qu'elle s'est déroulée, en instants de l'horloge ; le départ
 * n'en est pas une. Un bloc libre en est une, hors des répétitions : une
 * version d'avant les blocs l'écarte à la lecture.
 */
export interface IntervalLap {
  kind: 'travail' | 'repos' | 'libre';
  rep: number;
  startMs: number;
  endMs: number;
  /** Indice du bloc de la séance ; absent dans une fiche d'avant les blocs : le premier. */
  block?: number;
}

/** Une séance telle qu'elle a été faite pendant un enregistrement. */
export interface IntervalSeries {
  workout: IntervalWorkout;
  laps: IntervalLap[];
}

/**
 * Répétitions commencées avant `nowMs`, avec leurs instants réels (le
 * compte à rebours du départ n'en est pas une) : une pause
 * allonge la phase où elle tombe, « Passer » l'écourte ; celle en cours se
 * termine à `nowMs`, ou à l'arrêt.
 */
export const runLaps = (run: IntervalRun, nowMs: number): IntervalLap[] => {
  const { phases, ends, endedAtMs } = walk(run, nowMs);
  const closeMs = endedAtMs ?? nowMs;
  const laps: IntervalLap[] = [];
  // Les phases finies, puis celle en cours.
  for (let j = 0; j < phases.length && j <= ends.length; j++) {
    const startMs = j === 0 ? run.startedAtMs : ends[j - 1];
    const endMs = j < ends.length ? ends[j] : closeMs;
    const { kind, rep, block } = phases[j];
    if (kind !== 'pret' && endMs > startMs) laps.push({ kind, rep, startMs, endMs, block });
  }
  return laps;
};

/** Phases ramenées à une fenêtre (celle d'un enregistrement) : celles qui la touchent, bornées à elle. */
export const lapsWithin = (laps: IntervalLap[], fromMs: number, toMs: number): IntervalLap[] =>
  laps
    .filter((lap) => lap.endMs > fromMs && lap.startMs < toMs)
    .map((lap) => ({ ...lap, startMs: Math.max(lap.startMs, fromMs), endMs: Math.min(lap.endMs, toMs) }));

/**
 * Séances faites pendant un enregistrement, de `fromMs` à `toMs` : celles
 * qui y ont au moins une phase, dans l'ordre de leur lancement.
 */
export const seriesWithin = (runs: IntervalRun[], fromMs: number, toMs: number): IntervalSeries[] =>
  [...runs]
    .sort((a, b) => a.startedAtMs - b.startedAtMs)
    .map((run) => ({ workout: run.workout, laps: lapsWithin(runLaps(run, toMs), fromMs, toMs) }))
    .filter((series) => series.laps.length > 0);

const isLap = (value: unknown): value is IntervalLap => {
  if (typeof value !== 'object' || value === null) return false;
  const { kind, rep, startMs, endMs, block } = value as Record<string, unknown>;
  return (kind === 'travail' || kind === 'repos' || kind === 'libre') && typeof rep === 'number' && Number.isInteger(rep) && rep >= 1 &&
    typeof startMs === 'number' && typeof endMs === 'number' && isFinite(startMs) && endMs > startMs &&
    (block === undefined || (typeof block === 'number' && Number.isInteger(block) && block >= 0));
};

/** Séances d'une fiche ; une entrée abîmée est écartée, une liste sans séance valable rend `null`. */
export const readIntervalSeries = (value: unknown): IntervalSeries[] | null => {
  if (!Array.isArray(value)) return null;
  const list: IntervalSeries[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const { workout, laps } = item as Record<string, unknown>;
    const clean = sanitizeWorkout(workout);
    if (clean === null || !Array.isArray(laps)) continue;
    const kept = laps.filter(isLap).map(({ kind, rep, startMs, endMs, block }) => ({ kind, rep, startMs, endMs, ...(block !== undefined ? { block } : {}) }));
    if (kept.length > 0) list.push({ workout: clean, laps: kept });
  }
  return list.length > 0 ? list : null;
};

/** Une phase d'une répétition : travail ou repos. */
export type IntervalRepLap = IntervalLap & { kind: 'travail' | 'repos' };

const isRepLap = (lap: IntervalLap): lap is IntervalRepLap => lap.kind !== 'libre';

/** Un bloc de séries d'une séance faite, à part : de quoi l'analyser comme une séance d'un seul bloc. */
export interface IntervalBlockSeries {
  /** Le bloc, en séance d'un seul bloc. */
  workout: IntervalWorkout;
  /** Ses répétitions : travail et repos, numérotés dans le bloc. */
  laps: IntervalRepLap[];
  /** Rang du bloc parmi les blocs de séries, à partir de 1. */
  series: number;
  /** Nombre de blocs de séries de la séance. */
  seriesCount: number;
}

/**
 * Blocs de séries d'une séance faite, chacun avec ses répétitions ; les blocs
 * libres sont hors des répétitions. Un bloc sans phase faite est omis.
 */
export const seriesBlocks = (series: IntervalSeries): IntervalBlockSeries[] => {
  const blocks = workoutBlocks(series.workout);
  const seriesCount = blocks.filter((b) => b.kind === 'series').length;
  const out: IntervalBlockSeries[] = [];
  let rank = 0;
  blocks.forEach((block, index) => {
    if (block.kind !== 'series') return;
    rank++;
    const laps = series.laps.filter(isRepLap).filter((lap) => (lap.block ?? 0) === index);
    if (laps.length > 0) out.push({ workout: { reps: block.reps, workS: block.workS, restS: block.restS }, laps, series: rank, seriesCount });
  });
  return out;
};

/** Séance relue d'une ligne de journal ; `null` si elle n'en est pas une. */
export const readIntervalRun = (value: unknown): IntervalRun | null => {
  if (typeof value !== 'object' || value === null) return null;
  const { workout, startedAtMs, commands, kind } = value as Record<string, unknown>;
  const clean = sanitizeWorkout(workout);
  if (clean === null || typeof startedAtMs !== 'number' || !isFinite(startedAtMs) || !Array.isArray(commands)) return null;
  const kinds: IntervalCommand[] = ['pause', 'resume', 'skip', 'stop'];
  const kept = commands.filter((c): c is IntervalRun['commands'][number] => {
    if (typeof c !== 'object' || c === null) return false;
    const { kind, atMs } = c as Record<string, unknown>;
    return kinds.includes(kind as IntervalCommand) && typeof atMs === 'number' && isFinite(atMs);
  });
  const run: IntervalRun = { workout: clean, startedAtMs, commands: kept.map((c) => ({ kind: c.kind, atMs: c.atMs })) };
  return kind === 'timer' ? { ...run, kind } : run;
};
