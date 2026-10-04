import { describe, expect, it } from 'vitest';
import {
  MARK_GUIDE_DEFAULTS, START_MARK_GUIDE, beepIntervalMs, beepStartM, courseMarks, isCourseFinished, isLoopCourse, markName, remainingCourseM,
  sanitizeBeepCurve, sanitizeMarkGuide, skipMark, stepMarkGuide, validationRadiusM, type LatLon, type MarkGuideState, type MarkGuideStep,
} from './markGuide';

/** Mètres par degré de latitude, et de longitude à la latitude de `O`. */
const M_PER_DEG_LAT = 111195;
const O = { lat: 43.4, lon: 3.7 };
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((O.lat * Math.PI) / 180);
/** Position à `east` m à l'est et `north` m au nord de `O`. */
const at = (east: number, north: number): LatLon => ({ lat: O.lat + north / M_PER_DEG_LAT, lon: O.lon + east / M_PER_DEG_LON });

/** Positions le long de sommets donnés, à `speedMs` m/s, une toutes les `stepS` secondes. */
const sail = (pts: [number, number][], speedMs: number, stepS: number): LatLon[] => {
  const out = [at(pts[0][0], pts[0][1])];
  const stepM = speedMs * stepS;
  for (let k = 1; k < pts.length; k++) {
    const [e0, n0] = pts[k - 1];
    const [e1, n1] = pts[k];
    const count = Math.max(1, Math.round(Math.hypot(e1 - e0, n1 - n0) / stepM));
    for (let j = 1; j <= count; j++) out.push(at(e0 + ((e1 - e0) * j) / count, n0 + ((n1 - n0) * j) / count));
  }
  return out;
};

/** Rejoue des positions ; rend l'état final et chaque événement, avec la position où il est arrivé. */
const replay = (fixes: LatLon[], marks: LatLon[], state: MarkGuideState = START_MARK_GUIDE) => {
  const events: { event: MarkGuideStep['event']; index: number }[] = [];
  let last: MarkGuideStep | null = null;
  fixes.forEach((fix, index) => {
    last = stepMarkGuide(state, fix, marks, MARK_GUIDE_DEFAULTS);
    state = last.state;
    if (last.event) events.push({ event: last.event, index });
  });
  return { state, events, last: last as MarkGuideStep | null };
};

describe('courbe des bips', () => {
  it('commence au point le plus lointain, valide au plus proche', () => {
    expect(beepStartM(MARK_GUIDE_DEFAULTS)).toBe(200);
    expect(validationRadiusM(MARK_GUIDE_DEFAULTS)).toBe(50);
  });

  it('se tait au-delà du début des bips', () => {
    expect(beepIntervalMs(201, MARK_GUIDE_DEFAULTS)).toBeNull();
    expect(beepIntervalMs(NaN, MARK_GUIDE_DEFAULTS)).toBeNull();
  });

  it('rend la valeur de chaque point, et interpole entre deux', () => {
    expect(beepIntervalMs(200, MARK_GUIDE_DEFAULTS)).toBe(2000);
    expect(beepIntervalMs(150, MARK_GUIDE_DEFAULTS)).toBe(1200);
    expect(beepIntervalMs(175, MARK_GUIDE_DEFAULTS)).toBe(1600);
    expect(beepIntervalMs(75, MARK_GUIDE_DEFAULTS)).toBe(425);
  });

  it('garde l\'intervalle le plus court en deçà de la validation', () => {
    expect(beepIntervalMs(50, MARK_GUIDE_DEFAULTS)).toBe(250);
    expect(beepIntervalMs(10, MARK_GUIDE_DEFAULTS)).toBe(250);
  });

  it('est nettoyée : triée, bornée, sans distance en double', () => {
    expect(sanitizeBeepCurve([
      { distanceM: 300, intervalMs: 3000 },
      { distanceM: 2, intervalMs: 20 },
      { distanceM: 300, intervalMs: 1000 },
      { distanceM: 'loin', intervalMs: 1000 },
      { distanceM: 120.4, intervalMs: 999 },
    ])).toEqual([
      { distanceM: 5, intervalMs: 100 },
      { distanceM: 120, intervalMs: 1000 },
      { distanceM: 300, intervalMs: 3000 },
    ]);
  });

  it('refuse une courbe de moins de deux points ou de plus de huit', () => {
    expect(sanitizeBeepCurve([{ distanceM: 50, intervalMs: 250 }])).toBeNull();
    expect(sanitizeBeepCurve(Array.from({ length: 9 }, (_, i) => ({ distanceM: 50 + i * 10, intervalMs: 500 })))).toBeNull();
    expect(sanitizeBeepCurve('courbe')).toBeNull();
  });

  it('relit un réglage, vibration active à défaut', () => {
    expect(sanitizeMarkGuide({ curve: MARK_GUIDE_DEFAULTS.curve })).toEqual(MARK_GUIDE_DEFAULTS);
    expect(sanitizeMarkGuide({ curve: MARK_GUIDE_DEFAULTS.curve, vibrate: false })?.vibrate).toBe(false);
    expect(sanitizeMarkGuide({ curve: [] })).toBeNull();
    expect(sanitizeMarkGuide(null)).toBeNull();
  });
});

describe('guidage vers les balises', () => {
  // Départ à terre, une bouée au large, une autre plus loin, retour : tout en mètres depuis O.
  const marks = [at(0, 0), at(0, 600), at(400, 600)];
  const course: [number, number][] = [[0, 0], [0, 600], [400, 600], [400, 900]];

  it('valide le départ dès la première position, puis chaque balise en passant', () => {
    const fixes = sail(course, 5, 1);
    const { state, events } = replay(fixes, marks);
    expect(events.map((e) => e.event)).toEqual(['validated', 'validated', 'finished']);
    expect(events[0].index).toBe(0);
    expect(state.outcomes).toEqual(['validated', 'validated', 'validated']);
    expect(isCourseFinished(state, marks)).toBe(true);
  });

  it('donne distance et cap vers la balise visée', () => {
    const step = stepMarkGuide({ ...START_MARK_GUIDE, target: 1 }, at(0, 100), marks, MARK_GUIDE_DEFAULTS);
    expect(step.event).toBeNull();
    expect(step.distanceM).toBeCloseTo(500, 0);
    expect(step.bearingDeg!).toBeCloseTo(0, 1);
  });

  it('rend les mêmes validations à 1 Hz et à 5 Hz', () => {
    const slow = replay(sail(course, 5, 1), marks);
    const fast = replay(sail(course, 5, 0.2), marks);
    expect(fast.state.outcomes).toEqual(slow.state.outcomes);
    expect(fast.events.map((e) => e.event)).toEqual(slow.events.map((e) => e.event));
    // Validées au même endroit, à une position lente près (5 m).
    slow.events.forEach((e, k) => expect(Math.abs(fast.events[k].index * 0.2 - e.index)).toBeLessThanOrEqual(1));
  });

  it('valide une balise passée entre deux positions éloignées', () => {
    // Cadence lâche : une position à 100 m avant la bouée, la suivante 100 m après, à 30 m de côté.
    const fixes = [at(30, 500), at(30, 700)];
    const { events } = replay(fixes, marks, { ...START_MARK_GUIDE, target: 1, outcomes: ['validated'] });
    expect(events).toEqual([{ event: 'validated', index: 1 }]);
  });

  it('valide une position qui saute d\'un coup dans le rayon', () => {
    const fixes = [at(300, 300), at(10, 590)];
    const { events } = replay(fixes, marks, { ...START_MARK_GUIDE, target: 1, outcomes: ['validated'] });
    expect(events).toEqual([{ event: 'validated', index: 1 }]);
  });

  it('ne valide pas une balise laissée à plus de la distance de validation', () => {
    const fixes = sail([[0, 0], [80, 600], [400, 600]], 5, 1);
    // La bouée 2 (0, 600) est laissée à 80 m : pas validée ; la suivante reste visée par la bouée 2.
    const { state } = replay(fixes, marks);
    expect(state.outcomes).toEqual(['validated']);
    expect(state.target).toBe(1);
  });

  it('« Passer » laisse la balise visée et vise la suivante', () => {
    const skipped = skipMark({ ...START_MARK_GUIDE, target: 1, outcomes: ['validated'] }, marks);
    expect(skipped.target).toBe(2);
    expect(skipped.outcomes).toEqual(['validated', 'skipped']);
    const finished = skipMark(skipMark(skipped, marks), marks);
    expect(finished.target).toBe(3);
    expect(finished.outcomes).toEqual(['validated', 'skipped', 'skipped']);
  });

  it('ne guide plus une fois le parcours fini', () => {
    const done: MarkGuideState = { target: 3, outcomes: ['validated', 'validated', 'validated'], previous: at(400, 600) };
    const step = stepMarkGuide(done, at(0, 0), marks, MARK_GUIDE_DEFAULTS);
    expect(step.event).toBeNull();
    expect(step.distanceM).toBeNull();
    expect(beepIntervalMs(step.distanceM ?? NaN, MARK_GUIDE_DEFAULTS)).toBeNull();
  });

  it('sur une boucle, l\'arrivée au départ ne se valide qu\'après les autres balises', () => {
    const loop = [at(0, 0), at(0, 600), at(400, 600), at(0, 0)];
    const { state, events } = replay(sail([[0, 0], [0, 600], [400, 600], [0, 0]], 5, 1), loop);
    expect(events.map((e) => e.event)).toEqual(['validated', 'validated', 'validated', 'finished']);
    expect(state.outcomes).toHaveLength(4);
    // Au départ, seul le premier point est validé, pas l'arrivée qui s'y confond.
    expect(replay([at(0, 0), at(0, 5)], loop).state.target).toBe(1);
  });

  it('compte la distance restante par les balises', () => {
    const state: MarkGuideState = { target: 1, outcomes: ['validated'], previous: null };
    expect(remainingCourseM(state, marks, 250)).toBeCloseTo(650, 0);
    expect(remainingCourseM({ ...state, target: 3 }, marks, 0)).toBe(0);
  });
});

describe('balises à dessiner', () => {
  const marks = [at(0, 0), at(0, 600), at(400, 600)];
  const loop = [...marks, at(0, 0)];

  it('numérote les balises, toutes à venir sans guidage', () => {
    expect(courseMarks(marks, null).map((m) => [m.label, m.state])).toEqual([['1', 'next'], ['2', 'next'], ['3', 'next']]);
  });

  it('marque les balises laissées, la visée et les suivantes', () => {
    const state: MarkGuideState = { target: 2, outcomes: ['validated', 'skipped'], previous: null };
    expect(courseMarks(marks, state).map((m) => m.state)).toEqual(['validated', 'skipped', 'target']);
  });

  it('sur une boucle, un seul repère au départ, visé de nouveau pour l\'arrivée', () => {
    expect(isLoopCourse(loop)).toBe(true);
    expect(isLoopCourse(marks)).toBe(false);
    const start: MarkGuideState = { target: 0, outcomes: [], previous: null };
    expect(courseMarks(loop, start).map((m) => [m.label, m.state])).toEqual([['1', 'target'], ['2', 'next'], ['3', 'next']]);
    const middle: MarkGuideState = { target: 2, outcomes: ['validated', 'validated'], previous: null };
    expect(courseMarks(loop, middle).map((m) => m.state)).toEqual(['next', 'validated', 'target']);
    const arrival: MarkGuideState = { target: 3, outcomes: ['validated', 'validated', 'validated'], previous: null };
    expect(courseMarks(loop, arrival).map((m) => m.state)).toEqual(['target', 'validated', 'validated']);
    const done: MarkGuideState = { target: 4, outcomes: ['validated', 'validated', 'validated', 'skipped'], previous: null };
    expect(courseMarks(loop, done).map((m) => m.state)).toEqual(['skipped', 'validated', 'validated']);
  });

  it('nomme départ, balises et arrivée', () => {
    expect([0, 1, 2, 3].map((i) => markName(i, 4))).toEqual(['Départ', 'Balise 2', 'Balise 3', 'Arrivée']);
  });
});
