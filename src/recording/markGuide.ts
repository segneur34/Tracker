import { distanceToSegmentM, haversineDistance, initialBearing } from '../core/kinematics';

/**
 * Guidage vers les balises d'un parcours de voile, pendant l'enregistrement :
 * les points de l'itinéraire suivi, à valider dans l'ordre, départ compris.
 *
 * En approche, des bips de plus en plus rapprochés : l'intervalle entre deux
 * bips suit une courbe à points (distance, intervalle), réglée par activité.
 * Le point le plus lointain de la courbe fixe le début des bips ; le plus
 * proche, la distance de validation, saluée d'un bip long. La balise suivante
 * prend alors le relais.
 *
 * Tout est pur : le contrôleur (`hooks/useMarkGuide.ts`) fait avancer l'état
 * à chaque position reçue et joue les sons (`platform/beeper.ts`). Unités SI
 * (règle 1) : mètres, millisecondes, degrés.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

/** Un point de la courbe : à `distanceM` de la balise, un bip toutes les `intervalMs`. */
export interface BeepPoint {
  distanceM: number;
  intervalMs: number;
}

export interface MarkGuideSettings {
  /** Courbe des bips, triée par distance croissante (`sanitizeMarkGuide`). */
  curve: BeepPoint[];
  /** Vibration avec chaque bip, longue à la validation. */
  vibrate: boolean;
}

/** Réglage par défaut : la demande de l'utilisateur, 200 m, 150, 130, 100, puis validation à 50 m. */
export const MARK_GUIDE_DEFAULTS: MarkGuideSettings = {
  curve: [
    { distanceM: 50, intervalMs: 250 },
    { distanceM: 100, intervalMs: 600 },
    { distanceM: 130, intervalMs: 1000 },
    { distanceM: 150, intervalMs: 1200 },
    { distanceM: 200, intervalMs: 2000 },
  ],
  vibrate: true,
};

/** Bornes de la courbe : nombre de points, distances et intervalles admis. */
export const BEEP_CURVE_LIMITS = {
  minPoints: 2,
  maxPoints: 8,
  minDistanceM: 5,
  maxDistanceM: 2000,
  minIntervalMs: 100,
  maxIntervalMs: 5000,
} as const;

/** Vitesse de l'approche simulée par « Écouter », en nœuds. */
export const SIMULATED_APPROACH_KN = 15;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * Courbe nettoyée : valeurs ramenées dans les bornes, distances au mètre et
 * intervalles à 10 ms, triée par distance, une distance n'apparaissant
 * qu'une fois. `null` si elle n'a pas entre 2 et 8 points exploitables.
 */
export const sanitizeBeepCurve = (raw: unknown): BeepPoint[] | null => {
  if (!Array.isArray(raw)) return null;
  const L = BEEP_CURVE_LIMITS;
  const points: BeepPoint[] = [];
  for (const p of raw) {
    if (!isObject(p) || typeof p.distanceM !== 'number' || typeof p.intervalMs !== 'number') continue;
    if (!isFinite(p.distanceM) || !isFinite(p.intervalMs)) continue;
    const distanceM = Math.round(clamp(p.distanceM, L.minDistanceM, L.maxDistanceM));
    const intervalMs = Math.round(clamp(p.intervalMs, L.minIntervalMs, L.maxIntervalMs) / 10) * 10;
    if (points.some((q) => q.distanceM === distanceM)) continue;
    points.push({ distanceM, intervalMs });
  }
  points.sort((a, b) => a.distanceM - b.distanceM);
  return points.length >= L.minPoints && points.length <= L.maxPoints ? points : null;
};

/** Réglage relu (Réglages, `reglages.json`) ; `null` s'il est illisible. Vibration active à défaut. */
export const sanitizeMarkGuide = (raw: unknown): MarkGuideSettings | null => {
  if (!isObject(raw)) return null;
  const curve = sanitizeBeepCurve(raw.curve);
  if (!curve) return null;
  return { curve, vibrate: typeof raw.vibrate === 'boolean' ? raw.vibrate : true };
};

/** Distance de validation : le point le plus proche de la courbe. */
export const validationRadiusM = (settings: MarkGuideSettings): number => settings.curve[0].distanceM;

/** Distance où les bips commencent : le point le plus lointain de la courbe. */
export const beepStartM = (settings: MarkGuideSettings): number => settings.curve[settings.curve.length - 1].distanceM;

/**
 * Intervalle entre deux bips à `distanceM` de la balise, interpolé entre les
 * deux points de la courbe qui l'encadrent, en millisecondes ; celui du point
 * le plus proche en deçà. `null` au-delà du début des bips : silence.
 */
export const beepIntervalMs = (distanceM: number, settings: MarkGuideSettings): number | null => {
  const { curve } = settings;
  if (!isFinite(distanceM) || distanceM > beepStartM(settings)) return null;
  if (distanceM <= curve[0].distanceM) return curve[0].intervalMs;
  const k = curve.findIndex((p) => p.distanceM >= distanceM);
  const a = curve[k - 1];
  const b = curve[k];
  const t = (distanceM - a.distanceM) / (b.distanceM - a.distanceM);
  return Math.round(a.intervalMs + t * (b.intervalMs - a.intervalMs));
};

/** Sort d'une balise laissée derrière soi. */
export type MarkOutcome = 'validated' | 'skipped';

export interface MarkGuideState {
  /** Balise visée ; égale au nombre de balises une fois le parcours fini. */
  target: number;
  /** Sort de chaque balise déjà laissée, dans l'ordre. */
  outcomes: MarkOutcome[];
  /** Position précédente : la validation se juge sur le segment qui en part. */
  previous: LatLon | null;
}

export const START_MARK_GUIDE: MarkGuideState = { target: 0, outcomes: [], previous: null };

/** Vrai une fois la dernière balise laissée. */
export const isCourseFinished = (state: MarkGuideState, marks: ReadonlyArray<LatLon>): boolean => state.target >= marks.length;

export interface MarkGuideStep {
  state: MarkGuideState;
  /** Distance et cap de la position à la balise visée ; `null` parcours fini. */
  distanceM: number | null;
  bearingDeg: number | null;
  /** `validated` : une balise vient d'être validée ; `finished` : c'était la dernière. */
  event: 'validated' | 'finished' | null;
}

/** Distance et cap de `from` à la balise visée, `null` si le parcours est fini. */
export const aimAtTarget = (
  from: LatLon,
  state: MarkGuideState,
  marks: ReadonlyArray<LatLon>
): { distanceM: number | null; bearingDeg: number | null } => {
  const mark = marks[state.target];
  if (!mark) return { distanceM: null, bearingDeg: null };
  return {
    distanceM: haversineDistance(from.lat, from.lon, mark.lat, mark.lon),
    bearingDeg: initialBearing(from.lat, from.lon, mark.lat, mark.lon),
  };
};

/**
 * Avance le guidage d'une position. La balise visée est validée si le
 * segment parcouru depuis la position précédente passe à la distance de
 * validation : une trace peu dense qui la frôle entre deux points la valide
 * quand même (règle 10), et le résultat ne dépend pas de la cadence. Une
 * seule balise par position : la suivante se juge à partir de la prochaine.
 */
export const stepMarkGuide = (
  state: MarkGuideState,
  fix: LatLon,
  marks: ReadonlyArray<LatLon>,
  settings: MarkGuideSettings
): MarkGuideStep => {
  const position = { lat: fix.lat, lon: fix.lon };
  const mark = marks[state.target];
  if (!mark) return { state: { ...state, previous: position }, distanceM: null, bearingDeg: null, event: null };

  const gapM = state.previous
    ? distanceToSegmentM(mark, state.previous, position)
    : haversineDistance(mark.lat, mark.lon, position.lat, position.lon);
  if (gapM > validationRadiusM(settings)) {
    const next = { ...state, previous: position };
    return { state: next, ...aimAtTarget(position, next, marks), event: null };
  }
  const next: MarkGuideState = { target: state.target + 1, outcomes: [...state.outcomes, 'validated'], previous: position };
  return { state: next, ...aimAtTarget(position, next, marks), event: isCourseFinished(next, marks) ? 'finished' : 'validated' };
};

/** « Passer » : la balise visée est laissée sans validation, la suivante prend le relais. */
export const skipMark = (state: MarkGuideState, marks: ReadonlyArray<LatLon>): MarkGuideState =>
  isCourseFinished(state, marks) ? state : { ...state, target: state.target + 1, outcomes: [...state.outcomes, 'skipped'] };

/**
 * Distance restante par les balises : jusqu'à la balise visée
 * (`distanceToTargetM`), puis de balise en balise jusqu'à l'arrivée, en
 * mètres. 0 une fois le parcours fini.
 */
export const remainingCourseM = (state: MarkGuideState, marks: ReadonlyArray<LatLon>, distanceToTargetM: number): number => {
  if (isCourseFinished(state, marks)) return 0;
  let total = distanceToTargetM;
  for (let i = state.target + 1; i < marks.length; i++) {
    total += haversineDistance(marks[i - 1].lat, marks[i - 1].lon, marks[i].lat, marks[i].lon);
  }
  return total;
};

/** Balise à dessiner sur la carte : position, numéro, et sort (laissée, visée, à venir). */
export interface CourseMark extends LatLon {
  label: string;
  state: MarkOutcome | 'target' | 'next';
}

const samePlace = (a: LatLon, b: LatLon): boolean => a.lat === b.lat && a.lon === b.lon;

/** Vrai si le parcours revient à son départ : sa dernière balise est la première. */
export const isLoopCourse = (marks: ReadonlyArray<LatLon>): boolean =>
  marks.length >= 3 && samePlace(marks[0], marks[marks.length - 1]);

/**
 * Balises à dessiner, numérotées 1, 2, 3… Sans guidage (`state` nul), toutes
 * à venir. Sur une boucle, l'arrivée se confond avec le départ : un seul
 * repère, « 1 », visé de nouveau quand l'arrivée l'est.
 */
export const courseMarks = (
  marks: ReadonlyArray<LatLon>,
  state: Pick<MarkGuideState, 'target' | 'outcomes'> | null
): CourseMark[] => {
  const stateOf = (i: number): CourseMark['state'] => {
    if (!state) return 'next';
    if (i < state.target) return state.outcomes[i] ?? 'validated';
    return i === state.target ? 'target' : 'next';
  };
  const loop = isLoopCourse(marks);
  const last = marks.length - 1;
  const shown = loop ? marks.slice(0, -1) : marks;
  return shown.map((m, i) => {
    // Le départ d'une boucle porte aussi l'arrivée, dès qu'il est laissé.
    const index = loop && i === 0 && state !== null && state.target > 0 ? last : i;
    return { lat: m.lat, lon: m.lon, label: String(i + 1), state: stateOf(index) };
  });
};

/** Nom d'une balise dans la carte de guidage : Départ, Balise 2…, Arrivée. */
export const markName = (index: number, count: number): string =>
  index === 0 ? 'Départ' : index === count - 1 ? 'Arrivée' : `Balise ${index + 1}`;
