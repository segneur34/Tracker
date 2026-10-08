/**
 * Compteur du fractionné (§10, point 89) : une séance de répétitions, chacune
 * un temps de travail suivi d'un temps de repos (aucun après la dernière).
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

export interface IntervalWorkout {
  /** Nombre de répétitions. */
  reps: number;
  /** Temps de travail de chaque répétition, en secondes. */
  workS: number;
  /** Temps de repos entre deux répétitions, en secondes ; 0 : aucun. */
  restS: number;
}

/** Bornes de la saisie : des secondes entières. */
export const INTERVAL_LIMITS = {
  reps: { min: 1, max: 99 },
  workS: { min: 5, max: 3600 },
  restS: { min: 0, max: 3600 },
} as const;

/** Séance proposée la première fois : 10 × 1 min, 1 min de repos. */
export const DEFAULT_INTERVAL_WORKOUT: IntervalWorkout = { reps: 10, workS: 60, restS: 60 };

/** Séances gardées, au plus. */
export const MAX_INTERVAL_PRESETS = 30;

/** Sons du compteur : bip court, bip long, et le long double de la fin de séance. */
export type IntervalToneKind = 'court' | 'long' | 'final';

/** Durée de chaque son, en millisecondes (comme `platform/beeper.ts` et `TonePlayer.java`). */
export const INTERVAL_TONE_MS: Record<IntervalToneKind, number> = { court: 120, long: 800, final: 1600 };

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

/** Séance lue du stockage ou d'une saisie ; `null` si elle n'en est pas une. */
export const sanitizeWorkout = (value: unknown): IntervalWorkout | null => {
  if (typeof value !== 'object' || value === null) return null;
  const { reps, workS, restS } = value as Record<string, unknown>;
  return inRange(reps, INTERVAL_LIMITS.reps) && inRange(workS, INTERVAL_LIMITS.workS) && inRange(restS, INTERVAL_LIMITS.restS)
    ? { reps, workS, restS }
    : null;
};

export const sameWorkout = (a: IntervalWorkout, b: IntervalWorkout): boolean =>
  a.reps === b.reps && a.workS === b.workS && a.restS === b.restS;

/** Durée en m:ss, h:mm:ss au-delà d'une heure. */
export const formatIntervalClock = (seconds: number): string => {
  const total = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

/** Nom d'une séance : « 10 × 1:00 / 0:30 », sans repos « 10 × 1:00 ». */
export const workoutLabel = (workout: IntervalWorkout): string =>
  `${workout.reps} × ${formatIntervalClock(workout.workS)}${workout.restS > 0 ? ` / ${formatIntervalClock(workout.restS)}` : ''}`;

/** Durée totale d'une séance, en secondes. */
export const workoutDurationS = (workout: IntervalWorkout): number =>
  workout.reps * workout.workS + (workout.reps - 1) * workout.restS;

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

// --- Phases ---

/** `pret` : le compte à rebours du départ, qui n'est pas une répétition. */
export type IntervalPhaseKind = 'pret' | 'travail' | 'repos';

export interface IntervalPhase {
  kind: IntervalPhaseKind;
  /** Répétition, de 1 à `reps` ; un repos porte celle qu'il suit. */
  rep: number;
  /** Bornes en temps de séance, en secondes. */
  startS: number;
  endS: number;
}

/** Phases d'une séance, dans l'ordre : départ, travail, repos, travail… sans repos à la fin. */
export const workoutPhases = (workout: IntervalWorkout): IntervalPhase[] => {
  const phases: IntervalPhase[] = [{ kind: 'pret', rep: 1, startS: 0, endS: INTERVAL_LEAD_IN_S }];
  let t = INTERVAL_LEAD_IN_S;
  for (let rep = 1; rep <= workout.reps; rep++) {
    phases.push({ kind: 'travail', rep, startS: t, endS: t + workout.workS });
    t += workout.workS;
    if (rep < workout.reps && workout.restS > 0) {
      phases.push({ kind: 'repos', rep, startS: t, endS: t + workout.restS });
      t += workout.restS;
    }
  }
  return phases;
};

/** Nom d'une phase : « Départ », « Travail 3/10 », « Repos 3/10 ». */
export const phaseName = (phase: IntervalPhase, reps: number): string =>
  phase.kind === 'pret' ? 'Départ' : `${phase.kind === 'travail' ? 'Travail' : 'Repos'} ${phase.rep}/${reps}`;

// --- Séance lancée ---

export type IntervalCommand = 'pause' | 'resume' | 'skip' | 'stop';

export interface IntervalRun {
  workout: IntervalWorkout;
  /** Instant du lancement, en ms ; il identifie la séance. */
  startedAtMs: number;
  /** Commandes acceptées, dans l'ordre. */
  commands: { kind: IntervalCommand; atMs: number }[];
}

export const startRun = (workout: IntervalWorkout, nowMs: number): IntervalRun => ({ workout, startedAtMs: nowMs, commands: [] });

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

/** Un son programmé, après `delayMs`. */
export interface IntervalTone {
  delayMs: number;
  tone: IntervalToneKind;
}

/** Changement de phase à venir, pour la notification : son nom, et le temps qu'elle durera. */
export interface IntervalPhaseCue {
  delayMs: number;
  /** « Travail 3/10 », « Repos 3/10 », ou « Terminé ». */
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
  const reps = run.workout.reps;
  const tones: IntervalTone[] = [];
  const cues: IntervalPhaseCue[] = [];
  const current = ends.length;
  const delayOf = (s: number) => Math.max(0, Math.round((s - elapsedS) * 1000));
  const cue = (phase: IntervalPhase, delayMs: number, phaseMs: number) =>
    cues.push({ delayMs, title: phaseName(phase, reps), phaseMs });

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

/** Une phase telle qu'elle s'est déroulée, en instants de l'horloge ; le départ n'en est pas une. */
export interface IntervalLap {
  kind: 'travail' | 'repos';
  rep: number;
  startMs: number;
  endMs: number;
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
    const { kind, rep } = phases[j];
    if (kind !== 'pret' && endMs > startMs) laps.push({ kind, rep, startMs, endMs });
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
  const { kind, rep, startMs, endMs } = value as Record<string, unknown>;
  return (kind === 'travail' || kind === 'repos') && typeof rep === 'number' && Number.isInteger(rep) && rep >= 1 &&
    typeof startMs === 'number' && typeof endMs === 'number' && isFinite(startMs) && endMs > startMs;
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
    const kept = laps.filter(isLap).map(({ kind, rep, startMs, endMs }) => ({ kind, rep, startMs, endMs }));
    if (kept.length > 0) list.push({ workout: clean, laps: kept });
  }
  return list.length > 0 ? list : null;
};

/** Séance relue d'une ligne de journal ; `null` si elle n'en est pas une. */
export const readIntervalRun = (value: unknown): IntervalRun | null => {
  if (typeof value !== 'object' || value === null) return null;
  const { workout, startedAtMs, commands } = value as Record<string, unknown>;
  const clean = sanitizeWorkout(workout);
  if (clean === null || typeof startedAtMs !== 'number' || !isFinite(startedAtMs) || !Array.isArray(commands)) return null;
  const kinds: IntervalCommand[] = ['pause', 'resume', 'skip', 'stop'];
  const kept = commands.filter((c): c is IntervalRun['commands'][number] => {
    if (typeof c !== 'object' || c === null) return false;
    const { kind, atMs } = c as Record<string, unknown>;
    return kinds.includes(kind as IntervalCommand) && typeof atMs === 'number' && isFinite(atMs);
  });
  return { workout: clean, startedAtMs, commands: kept.map(({ kind, atMs }) => ({ kind, atMs })) };
};
