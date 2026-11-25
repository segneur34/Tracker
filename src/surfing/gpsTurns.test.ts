import { describe, expect, it } from 'vitest';
import { initialBearing } from '../core/geo';
import { computeKinematics } from '../core/kinematics';
import type { TrackPoint } from '../core/types';
import { at, mPerDegLon } from '../test/geo.fixture';
import { seededRandom } from '../test/sailing.fixture';
import { SPORT_PROFILES } from '../core/sportProfiles';
import { countDirectionChanges, directionChanges, gpsTurnsOf, rideEndMsOf, rotationEnds, type GpsTurnOptions } from './gpsTurns';

/** Règles des virages du profil du surf. */
const TURN_RULES = SPORT_PROFILES.surf.surf!.turnRules;

/** Points d'une vague à 1 Hz, de caps donnés (cap de l'appareil, ou cap des positions seul). */
const pointsWithHeadings = (headings: number[], device = true): TrackPoint[] =>
  headings.map((h, i) => ({
    lat: 43, lon: 3, time: new Date(i * 1000), timeMs: i * 1000, speedMs: 5, smoothedSpeedMs: 5,
    bearing: device ? 0 : h, ...(device ? { courseDeg: h } : {}), speedSource: 'doppler',
  }));

describe('countDirectionChanges', () => {
  it('compte bottom turn, top turn et cutback d\'au moins 60°', () => {
    // Point de départ, puis +120°, −180°, +60°.
    const track = pointsWithHeadings([0, 200, 260, 320, 260, 200, 140, 200]);
    expect(countDirectionChanges(track, 0, track.length - 1, 60)).toBe(3);
  });

  it('ignore le tremblement du cap', () => {
    const track = pointsWithHeadings([0, 200, 215, 195, 212, 190, 205, 198]);
    expect(countDirectionChanges(track, 0, track.length - 1, 60)).toBe(0);
  });

  it('passe le nord sans compter de faux virage', () => {
    const track = pointsWithHeadings([0, 340, 355, 10, 25, 40]);
    expect(countDirectionChanges(track, 0, track.length - 1, 60)).toBe(1);
  });

  it('prend le cap des positions sans cap de l\'appareil', () => {
    const track = pointsWithHeadings([0, 200, 260, 320, 260, 200, 140, 200], false);
    expect(countDirectionChanges(track, 0, track.length - 1, 60)).toBe(3);
  });
});

describe('directionChanges', () => {
  it("rend le départ et l'instant de chaque retournement, avec son sens", () => {
    expect(directionChanges([0, 30, 90, 120, 100, 40, 0, 10], 60)).toEqual([
      { from: 0, at: 2, direction: 1 },
      { from: 3, at: 5, direction: -1 },
    ]);
  });

  it('ne compte rien sous le seuil, ni sur un cap trop court', () => {
    expect(directionChanges([0, 20, -10, 30, 0], 60)).toEqual([]);
    expect(directionChanges([0], 60)).toEqual([]);
  });
});

describe('rotationEnds', () => {
  /** Lectures à 1 Hz. */
  const everySecond = (i: number) => i * 1000;
  const endsOf = (heading: number[], timeMsOf = everySecond) => rotationEnds(heading, timeMsOf, directionChanges(heading, 60), TURN_RULES.pauseRateDegS, TURN_RULES.pauseWindowS);

  it("la rotation s'achève à sa première pause : le cap n'avance plus de 15° sur la seconde qui suit", () => {
    // Le seuil est atteint au pas 2 (90°) ; le cap avance encore de 30°, puis recule : fin au pas 3. Retour : seuil au pas 5, fin au pas 6.
    expect(endsOf([0, 30, 90, 120, 100, 40, 0, -5, -3])).toEqual([3, 6]);
    // Une rotation qui s'étale : 60° atteints au pas 2, puis 20° par seconde pendant 3 s, puis 8° : fin au pas 5.
    expect(endsOf([0, 30, 60, 80, 100, 120, 128, 130])).toEqual([5]);
  });

  it('un cap qui tremble ou dérive après le virage ne repousse pas la fin', () => {
    expect(endsOf([0, 45, 90, 90, 90, 90])).toEqual([2]);
    expect(endsOf([0, 45, 90, 95, 86, 94, 85, 96])).toEqual([2]);
    // Dérive de 3° par seconde dans le sens du virage.
    expect(endsOf([0, 45, 90, 93, 96, 99, 102, 105])).toEqual([2]);
  });

  it('une sortie dans le même sens, plus tard, ne repousse pas la fin du virage', () => {
    const heading = [0, 30, 90, 90, 90, 90, 90, 135, 180];
    expect(directionChanges(heading, 60)).toHaveLength(1);
    expect(endsOf(heading)).toEqual([2]);
  });

  it('la fenêtre est en temps : même fin à 5 Hz, et un long pas se juge sur sa durée', () => {
    // Le même virage à 5 Hz : 90° en 1,5 s (12° par pas), fini au pas 10, soit 2 s ; la pause est vue à 3° près de la fin.
    const fine = Array.from({ length: 30 }, (_, i) => Math.min(90, Math.max(0, (i - 2.5) * 12)));
    const [end] = endsOf(fine, (i) => i * 200);
    expect(end * 0.2).toBeGreaterThanOrEqual(1.6);
    expect(end * 0.2).toBeLessThanOrEqual(2);
    // Pas de 4 s : 50° de plus sur le pas suivant, moins de 15°/s × 4 s : pause ; 70°, la rotation dure encore.
    expect(endsOf([0, 90, 140, 140], (i) => i * 4000)).toEqual([1]);
    expect(endsOf([0, 90, 160, 160], (i) => i * 4000)).toEqual([2]);
  });

  it('faute de lectures sur une seconde entière, la fenêtre est ce qui reste ; la dernière lecture finit la rotation', () => {
    // Le cap tourne encore à 60°/s quand les lectures s'arrêtent : la fin est la dernière lecture.
    const turning = Array.from({ length: 12 }, (_, i) => i * 12);
    expect(endsOf(turning, (i) => i * 200)).toEqual([11]);
  });
});

const MS_PER_KMH = 1 / 3.6;

/** Fonction affine par morceaux, tenue à ses bornes. */
const lin = (points: [number, number][]) => (t: number): number => {
  if (t <= points[0][0]) return points[0][1];
  for (let k = 1; k < points.length; k++) {
    const [t0, v0] = points[k - 1];
    const [t1, v1] = points[k];
    if (t <= t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return points[points.length - 1][1];
};

/** Pas d'intégration des positions, en secondes : les heures des points en sont des multiples. */
const PATH_DT_S = 0.01;

/** Tirage gaussien centré réduit, d'un tirage uniforme à graine fixe. */
const gaussian = (uniform: () => number) => (): number => {
  let u = 0;
  while (u === 0) u = uniform();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * uniform());
};

/**
 * Vague fabriquée, aux heures `timesS` (secondes, croissantes, de 0 à
 * `durationS`) : la vitesse (km/h) et le cap (degrés) sont des fonctions du
 * temps, les positions leur intégrale tous les `PATH_DT_S`, plus un bruit de
 * position corrélé d'écart type `noiseM` (constante de temps de 8 s, celle
 * d'un GPS ordinaire), le même pour toutes les cadences d'une même graine.
 * Le cap du pas (`bearing`) est celui des positions, comme le calcule le
 * noyau ; avec `device`, le cap de l'appareil est le cap vrai.
 */
const rideAt = (
  timesS: readonly number[], durationS: number, speedKmh: (t: number) => number, heading: (t: number) => number, device: boolean,
  noiseM = 0, seed = 1
): TrackPoint[] => {
  const n = Math.round(durationS / PATH_DT_S) + 1;
  const east = new Float64Array(n);
  const north = new Float64Array(n);
  const draw = gaussian(seededRandom(seed));
  const tauS = 8;
  let ex = 0;
  let ey = 0;
  let x = 0;
  let y = 0;
  for (let k = 0; k < n; k++) {
    east[k] = x + ex;
    north[k] = y + ey;
    const t = k * PATH_DT_S;
    const v = speedKmh(t) * MS_PER_KMH;
    const h = (heading(t) * Math.PI) / 180;
    x += v * Math.sin(h) * PATH_DT_S;
    y += v * Math.cos(h) * PATH_DT_S;
    ex += (-ex / tauS) * PATH_DT_S + noiseM * Math.sqrt((2 * PATH_DT_S) / tauS) * draw();
    ey += (-ey / tauS) * PATH_DT_S + noiseM * Math.sqrt((2 * PATH_DT_S) / tauS) * draw();
  }
  const positions = timesS.map((t) => {
    const k = Math.min(n - 1, Math.round(t / PATH_DT_S));
    return at(east[k], north[k]);
  });
  return timesS.map((t, i) => {
    const v = speedKmh(t) * MS_PER_KMH;
    const h = ((heading(t) % 360) + 360) % 360;
    const [a, b] = i === 0 ? [positions[0], positions[1]] : [positions[i - 1], positions[i]];
    return {
      ...positions[i], time: new Date(t * 1000), timeMs: Math.round(t * 1000), speedMs: v, smoothedSpeedMs: v,
      bearing: initialBearing(a.lat, a.lon, b.lat, b.lon), ...(device ? { courseDeg: h } : {}), speedSource: 'doppler',
    };
  });
};

/** Heures régulières, un point tous les `cadenceS` de 0 à `durationS`. */
const regularTimes = (durationS: number, cadenceS: number): number[] => {
  const out: number[] = [];
  for (let k = 0; k * cadenceS <= durationS + 1e-9; k++) out.push(Math.round(k * cadenceS * 1000) / 1000);
  return out;
};

/** Heures irrégulières, de pas tirés entre 0,2 et 1,5 s (au centième), graine fixe. */
const irregularTimes = (durationS: number, seed: number): number[] => {
  const draw = seededRandom(seed);
  const out = [0];
  for (;;) {
    const next = Math.round((out[out.length - 1] + 0.2 + 1.3 * draw()) * 100) / 100;
    if (next > durationS) return out;
    out.push(next);
  }
};

/**
 * Vague idéale des règles : un point tous les `cadenceS` de 0 à `durationS`,
 * à la vitesse (km/h) et au cap (degrés) donnés par des fonctions du temps
 * (s), immobile : sans cap de l'appareil, le cap du pas est le cap vrai de
 * l'instant, sans corde (elle ne mesure rien). Les règles s'y éprouvent sur
 * un cap exact ; le cap des positions, sur `rideAt`.
 */
const ride = (durationS: number, speedKmh: (t: number) => number, heading: (t: number) => number, cadenceS: number, device: boolean): TrackPoint[] =>
  regularTimes(durationS, cadenceS).map((t) => {
    const v = speedKmh(t) * MS_PER_KMH;
    const h = ((heading(t) % 360) + 360) % 360;
    return {
      lat: 43, lon: 3, time: new Date(t * 1000), timeMs: t * 1000, speedMs: v, smoothedSpeedMs: v,
      bearing: device ? 0 : h, ...(device ? { courseDeg: h } : {}), speedSource: 'doppler',
    };
  });

/** Les règles d'une session, et le trou de la trace du surf. */
const RULES: GpsTurnOptions = { ...TURN_RULES, maxGapS: 10 };

/** Chaque cadence régulière, avec et sans cap de l'appareil. */
const CASES = [1, 0.2].flatMap((cadenceS) => [true, false].map((device) => ({ cadenceS, device })));

const count = (track: TrackPoint[], o: GpsTurnOptions = RULES): number => countDirectionChanges(track, 0, track.length - 1, 60, o);

describe('règles des virages : un virage relie deux glisses', () => {
  it('les règles du profil : plancher de 2 m/s, 3 s de glisse après le virage, 2 s de mise en vitesse, pause sous 15°/s sur 1 s', () => {
    const { courseMinSpeedMs, minRideAfterS, settleS, pauseRateDegS, pauseWindowS } = TURN_RULES;
    expect([courseMinSpeedMs, minRideAfterS, settleS, pauseRateDegS, pauseWindowS]).toEqual([2, 3, 2, 15, 1]);
  });

  /**
   * Une vague sans virage : 14 s de ligne droite qui monte à 11 km/h, le cap
   * bruité de ± 30° tant que la vitesse est sous 7 km/h, puis la sortie, 90° en
   * 2 s pendant que la vitesse retombe de 9 à 4 km/h.
   */
  const exitSpeed = lin([[0, 4], [8, 11], [12, 11], [14, 9], [16, 4], [18, 3]]);
  const exitHeading = (t: number) => (exitSpeed(t) < 7 && t < 8 ? 30 * Math.cos(Math.PI * t) : lin([[14, 0], [16, 90]])(t));

  it.each(CASES)('ligne droite puis sortie en travers quand la vitesse tombe : 0 (pas de $cadenceS s, cap de l\'appareil $device)', ({ cadenceS, device }) => {
    const track = ride(18, exitSpeed, exitHeading, cadenceS, device);
    expect(count(track)).toBe(0);
    // Sans les règles, le bruit du départ et la sortie comptaient.
    expect(count(track, {})).toBeGreaterThanOrEqual(1);
  });

  /**
   * Mise en vitesse : le plancher est passé à 2,1 s, le cap de l'appareil est
   * encore à 50° de celui de la glisse jusqu'à 3,9 s, puis la glisse file droit,
   * avec un écart de 15° de l'autre côté vers 10 s : 65° entre les deux.
   */
  const settleSpeed = lin([[0, 5.1], [7, 12.1], [20, 12.1], [23, 3]]);
  const settleHeading = (t: number) => (t < 3.9 ? 50 : t >= 10 && t <= 11 ? -15 : 0);

  it.each(CASES)('cap pas encore posé à la mise en vitesse : 0 (pas de $cadenceS s, cap de l\'appareil $device)', ({ cadenceS, device }) => {
    const track = ride(23, settleSpeed, settleHeading, cadenceS, device);
    expect(count(track)).toBe(0);
    // Le plancher seul ne suffit pas : la mise en vitesse lue, l'écart fait un virage.
    expect(count(track, { ...RULES, settleS: 0 })).toBe(1);
  });

  /** Pic bref à 20 km/h au départ, puis glisse à 13 km/h, 65 % du maximum, avec deux virages de 90°. */
  const peakSpeed = lin([[0, 6], [3, 20], [4, 20], [6, 13], [26, 13], [29, 3]]);
  const peakHeading = (t: number) => lin([[10, 0], [11.5, 90]])(t) - lin([[17, 0], [18.5, 90]])(t);

  it.each(CASES)('deux virages de 90° loin sous le pic de vitesse du départ : 2 (pas de $cadenceS s, cap de l\'appareil $device)', ({ cadenceS, device }) => {
    expect(count(ride(29, peakSpeed, peakHeading, cadenceS, device))).toBe(2);
  });

  /**
   * Un dernier virage de 90°, fini à 10 s, puis `rideAfterS` secondes de glisse
   * à 14 km/h avant que la vitesse ne passe sous le plancher (elle perd 6 km/h
   * par seconde : le plancher est passé 6,8 / 6 s après le début de la chute).
   */
  const speedUntil = (rideEndS: number) => {
    const dropAt = rideEndS - 6.8 / 6;
    return lin([[dropAt, 14], [dropAt + 2, 2]]);
  };
  const turnHeading = lin([[8.5, 0], [10, 90]]);
  const lastTurn = (rideAfterS: number, cadenceS: number, device: boolean, heading: (t: number) => number = turnHeading): TrackPoint[] =>
    ride(Math.ceil(10 + rideAfterS + 1), speedUntil(10 + rideAfterS), heading, cadenceS, device);

  it.each(CASES)('dernier cutback suivi de 5 s de glisse : 1 ; vague fermée dans la seconde : 0 (pas de $cadenceS s, cap de l\'appareil $device)', ({ cadenceS, device }) => {
    expect(count(lastTurn(5, cadenceS, device))).toBe(1);
    expect(count(lastTurn(0.8, cadenceS, device))).toBe(0);
    expect(count(lastTurn(0.8, cadenceS, device), {})).toBe(1);
  });

  it.each(CASES)('à la frontière des 3 s : 2,5 s de glisse après le virage, 0 ; 3,5 s, 1 (pas de $cadenceS s, cap de l\'appareil $device)', ({ cadenceS, device }) => {
    expect(count(lastTurn(2.5, cadenceS, device))).toBe(0);
    expect(count(lastTurn(3.5, cadenceS, device))).toBe(1);
    // La durée est une option : à 2 s, les deux comptent ; à 4 s, aucune.
    expect(count(lastTurn(2.5, cadenceS, device), { ...RULES, minRideAfterS: 2 })).toBe(1);
    expect(count(lastTurn(3.5, cadenceS, device), { ...RULES, minRideAfterS: 4 })).toBe(0);
    // La glisse restante est rendue avec chaque changement, à une demi-seconde près de la vraie.
    const [turn] = gpsTurnsOf(lastTurn(3.5, cadenceS, device), 0, lastTurn(3.5, cadenceS, device).length - 1, 60, RULES);
    expect(Math.abs(turn.rideAfterS - 3.5)).toBeLessThan(0.5);
    expect(turn).toMatchObject({ direction: 1, counted: true });
  });

  it.each(CASES)('virage, 5 s de glisse, puis sortie dans le même sens : 1 (pas de $cadenceS s, cap de l\'appareil $device)', ({ cadenceS, device }) => {
    // 0 → 90° de 8,5 à 10 s, glisse droite, sortie 90 → 180° de 15 à 17 s, plancher passé à 17,3 s : un seul changement, sans inversion.
    const heading = (t: number) => turnHeading(t) + lin([[15, 0], [17, 90]])(t);
    const track = ride(19, speedUntil(17.3), heading, cadenceS, device);
    expect(count(track, {})).toBe(1);
    expect(count(track)).toBe(1);
  });

  it.each(CASES)('dernier virage suivi de 5 s de glisse au cap bruité de ± 5°, ou qui dérive de 3°/s dans son sens : 1 (pas de $cadenceS s, cap de l\'appareil $device)', ({ cadenceS, device }) => {
    // Bruit fixe, différent d'une lecture à l'autre, sur toute la vague.
    const noisy = (t: number) => turnHeading(t) + 5 * Math.sin(40 * t + 1);
    expect(count(lastTurn(5, cadenceS, device, noisy))).toBe(1);
    const drifting = (t: number) => turnHeading(t) + 3 * Math.max(0, t - 10);
    expect(count(lastTurn(5, cadenceS, device, drifting))).toBe(1);
    // Les mêmes, la vague fermée dans la seconde : toujours la sortie.
    expect(count(lastTurn(0.8, cadenceS, device, noisy))).toBe(0);
    expect(count(lastTurn(0.8, cadenceS, device, drifting))).toBe(0);
  });

  /** Quatre virages de 90° en 1 s, alternés, toutes les 2,5 s : finis à 7, 9,5, 12 et 14,5 s ; puis `glideS` de glisse. */
  const chained = (glideS: number, cadenceS: number, device: boolean): TrackPoint[] => {
    const turn = (at: number) => lin([[at, 0], [at + 1, 90]]);
    const heading = (t: number) => turn(6)(t) - turn(8.5)(t) + turn(11)(t) - turn(13.5)(t);
    return ride(Math.ceil(14.5 + glideS + 1), speedUntil(14.5 + glideS), heading, cadenceS, device);
  };

  it.each(CASES)('quatre virages enchaînés toutes les 2,5 s puis 4 s de glisse : 4 ; puis 1 s seulement : 3 (pas de $cadenceS s, cap de l\'appareil $device)', ({ cadenceS, device }) => {
    expect(count(chained(4, cadenceS, device))).toBe(4);
    expect(count(chained(1, cadenceS, device))).toBe(3);
  });

  it.each(CASES)('repassage sous le plancher en cours de vague : la mise en vitesse ne se relance pas (pas de $cadenceS s, cap de l\'appareil $device)', ({ cadenceS, device }) => {
    // La vitesse tombe à 5 km/h de 9 à 12 s, puis reprend ; la glisse dure jusqu'à 20 s.
    const speed = (t: number) => (t < 13 ? lin([[8, 14], [9, 5], [12, 5], [13, 14]])(t) : speedUntil(20)(t));
    // Cutback lent, 120° tournés sous le plancher : il se lit à la reprise, et compte.
    expect(count(ride(21, speed, lin([[9.5, 0], [12, 120]]), cadenceS, device))).toBe(1);
    // Aller et retour de 90° dans les 2 s qui suivent la reprise : lus tous les deux, sans nouvelle attente.
    const quick = (t: number) => lin([[12.4, 0], [13, 90]])(t) - lin([[13.4, 0], [14, 90]])(t);
    expect(count(ride(21, speed, quick, cadenceS, device))).toBe(2);
  });

  /** Sur foil : la vague est en vol, à 22 km/h ; deux virages, puis on se dégage (120° en 1,5 s) quand elle finit. */
  const foilHeading = (t: number) => lin([[6, 0], [7.5, 90]])(t) - lin([[12, 0], [13.5, 90]])(t) + lin([[18.5, 0], [20, 120]])(t);

  it.each(CASES)('sur foil, deux virages puis se dégager pour pomper : 2 (pas de $cadenceS s, cap de l\'appareil $device)', ({ cadenceS, device }) => {
    // Cinq secondes de vol avant la vague : elle part lancée, le point situé à 5 s est son début, le dernier point sa fin.
    const track = ride(25, () => 22, (t) => foilHeading(t - 5), cadenceS, device);
    const start = track.findIndex((p) => p.timeMs >= 5000);
    const end = track.length - 1;
    const foil = { ...RULES, rideEndMs: track[end].timeMs };
    expect(countDirectionChanges(track, start, end, 60, foil)).toBe(2);
    expect(countDirectionChanges(track, start, end, 60)).toBe(3);
  });

  it.each(CASES)('vague prise lancée : pas de mise en vitesse, un virage dès la deuxième seconde compte (pas de $cadenceS s, cap de l\'appareil $device)', ({ cadenceS, device }) => {
    const track = ride(20, () => 22, lin([[6.2, 0], [7.2, 90]]), cadenceS, device);
    const start = track.findIndex((p) => p.timeMs >= 5000);
    expect(countDirectionChanges(track, start, track.length - 1, 60, RULES)).toBe(1);
    // La même vague partie de l'arrêt : le virage tombe dans la mise en vitesse.
    const fromRest = ride(20, lin([[4.5, 3], [5, 22]]), lin([[6.2, 0], [7.2, 90]]), cadenceS, device);
    expect(countDirectionChanges(fromRest, start, fromRest.length - 1, 60, RULES)).toBe(0);
  });

  it('un point toutes les 4 s : au plus un virage, sans erreur', () => {
    for (const device of [true, false]) {
      expect(count(ride(18, exitSpeed, exitHeading, 4, device))).toBeLessThanOrEqual(1);
      expect(count(ride(23, settleSpeed, settleHeading, 4, device))).toBeLessThanOrEqual(1);
      expect(count(lastTurn(5, 4, device))).toBeLessThanOrEqual(1);
      expect(count(lastTurn(0.8, 4, device))).toBeLessThanOrEqual(1);
      expect(count(lastTurn(5, 4, device, (t) => turnHeading(t) + lin([[15, 0], [17, 90]])(t)))).toBeLessThanOrEqual(1);
    }
  });

  it('une vague toute sous le plancher : aucun cap lu, aucun virage', () => {
    const slow = ride(12, () => 6, (t) => (t < 6 ? 0 : 120), 1, true);
    expect(count(slow)).toBe(0);
    expect(count(slow, {})).toBe(1);
  });
});

describe('cap des positions : une corde de 0,9 s, la même vague à toute cadence', () => {
  /**
   * Une vague de 24 s : 20 km/h de 2 à 18 s, le cap à 30° ± 40° sur une
   * période de 5 s, de 4 à 14 s, puis droit : trois changements de direction
   * d'au moins 60° (le premier demi-écart, 40°, ne compte pas).
   */
  const DURATION_S = 24;
  const speed = lin([[0, 4], [2, 20], [18, 20], [20, 4], [24, 3]]);
  const heading = (t: number) => 30 + (t > 4 && t < 14 ? 40 * Math.sin((2 * Math.PI * (t - 4)) / 5) : 0);
  const EXPECTED = 3;
  const SEEDS = [1, 2, 3];
  const wave = (times: number[], noiseM: number, seed: number, device = false) => rideAt(times, DURATION_S, speed, heading, device, noiseM, seed);
  const turnsOf = (track: TrackPoint[], o: GpsTurnOptions = RULES) => gpsTurnsOf(track, 0, track.length - 1, 60, o);
  const oneHz = regularTimes(DURATION_S, 1);
  const fiveHz = regularTimes(DURATION_S, 0.2);
  /** Un point par seconde, avancé ou retardé de 40 ms au plus. */
  const jitteredOneHz = (seed: number) => {
    const draw = seededRandom(seed);
    return oneHz.map((t) => (t === 0 ? 0 : Math.round((t + (draw() - 0.5) * 0.08) * 100) / 100));
  };

  it('la corde vaut 0,9 s, surchargeable : à 0, le cap de chaque pas, que le bruit fait trembler à 5 Hz', () => {
    expect(TURN_RULES.courseStrideS).toBe(0.9);
    const noisy = wave(fiveHz, 1.2, 1);
    expect(count(noisy)).toBe(EXPECTED);
    expect(count(noisy, { ...RULES, courseStrideS: 0 })).toBeGreaterThan(EXPECTED);
  });

  it.each([0, 1.2])('à 1 Hz, rien ne change, gigue de 40 ms comprise : la corde est le pas (bruit de %s m)', (noiseM) => {
    for (const seed of SEEDS) {
      for (const times of [oneHz, jitteredOneHz(seed)]) {
        const track = wave(times, noiseM, seed);
        expect(turnsOf(track)).toEqual(turnsOf(track, { ...RULES, courseStrideS: 0 }));
      }
    }
  });

  it.each([0, 0.5])('la même vague compte trois virages à 1 Hz, à 5 Hz et en cadence irrégulière, de 0,2 à 1,5 s (bruit de %s m)', (noiseM) => {
    for (const seed of SEEDS) {
      for (const times of [oneHz, fiveHz, irregularTimes(DURATION_S, seed)]) expect(count(wave(times, noiseM, seed))).toBe(EXPECTED);
    }
  });

  it('bruit de 1,2 m : le même compte à 1 Hz et à 5 Hz, celui de la vague', () => {
    for (const seed of SEEDS) {
      expect(count(wave(oneHz, 1.2, seed))).toBe(EXPECTED);
      expect(count(wave(fiveHz, 1.2, seed))).toBe(EXPECTED);
    }
  });

  it("le cap de l'appareil se lit tel quel, sans corde, même à 5 Hz", () => {
    for (const seed of SEEDS) {
      const track = wave(fiveHz, 1.2, seed, true);
      expect(turnsOf(track)).toEqual(turnsOf(track, { ...RULES, courseStrideS: 0 }));
      expect(count(track)).toBe(EXPECTED);
    }
  });

  it('un point toutes les 4 s : le cap du pas, comme avant, sans erreur', () => {
    const track = wave(regularTimes(DURATION_S, 4), 1.2, 1);
    expect(turnsOf(track)).toEqual(turnsOf(track, { ...RULES, courseStrideS: 0 }));
  });

  it.each([false, true])('une position qui saute de 30 m sur le côté, puis revient : ni départ ni arrivée de corde, le même compte à 1 Hz et à 5 Hz (vitesse Doppler %s)', (doppler) => {
    /** La trace passée par le noyau, le point de 10 s déporté de 30 m à angle droit du cap de 30°. */
    const jumped = (times: number[], hd: (t: number) => number) => {
      const raw = rideAt(times, DURATION_S, speed, hd, false).map((p) => ({ lat: p.lat, lon: p.lon, time: p.time, ...(doppler ? { speedMs: p.speedMs } : {}) }));
      const k = times.findIndex((t) => t >= 10);
      const shift = at(30 * Math.cos(Math.PI / 6), -30 * Math.sin(Math.PI / 6));
      const origin = at(0, 0);
      raw[k] = { ...raw[k], lat: raw[k].lat + shift.lat - origin.lat, lon: raw[k].lon + shift.lon - origin.lon };
      const track = computeKinematics(raw);
      return countDirectionChanges(track, 0, track.length - 1, 60, { ...RULES, maxGapS: 10 });
    };
    expect(jumped(oneHz, heading)).toBe(EXPECTED);
    expect(jumped(fiveHz, heading)).toBe(EXPECTED);
    // En ligne droite : aucun virage sans Doppler, où le noyau répare le cap du point sauté ; avec, il le laisse, mais les deux cadences s'accordent.
    const straight = () => 30;
    if (!doppler) expect(jumped(oneHz, straight)).toBe(0);
    expect(jumped(fiveHz, straight)).toBe(jumped(oneHz, straight));
  });

  it('la corde ne remonte pas au-delà d\'une reprise', () => {
    // Ligne droite au nord à 5 Hz ; à 10 s, la trace reprend 50 m plus à l'est. Le cap du pas de la reprise est celui du pas suivant, comme dans le noyau.
    const straight = (resumed: boolean) => {
      const track = rideAt(fiveHz, DURATION_S, () => 20, () => 0, false);
      const k = track.findIndex((p) => p.timeMs >= 10_000);
      for (let i = k; i < track.length; i++) track[i] = { ...track[i], lon: track[i].lon + 50 / mPerDegLon(track[i].lat) };
      track[k] = { ...track[k], bearing: track[k + 1].bearing, ...(resumed ? { segmentStart: true } : {}) };
      return track;
    };
    const chord = { courseStrideS: TURN_RULES.courseStrideS };
    expect(countDirectionChanges(straight(true), 0, fiveHz.length - 1, 60, chord)).toBe(0);
    // Sans la reprise, la corde enjambe le saut et y voit un virage.
    expect(countDirectionChanges(straight(false), 0, fiveHz.length - 1, 60, chord)).toBeGreaterThan(0);
  });
});

describe('rideEndMsOf', () => {
  const FLOOR = TURN_RULES.courseMinSpeedMs;

  it('le dernier instant au-dessus du plancher, interpolé entre deux points, à 1 Hz comme à 5 Hz', () => {
    // De 14 à 2 km/h entre 10 et 12 s : 7,2 km/h à 11,133 s.
    for (const cadenceS of [1, 0.2, 4]) {
      const track = ride(16, lin([[10, 14], [12, 2]]), () => 0, cadenceS, true);
      const endMs = rideEndMsOf(track, 0, track.length - 1, FLOOR);
      if (cadenceS < 4) expect(endMs).toBeCloseTo(11_133.3, 0);
      // Sur un long pas, la vitesse est supposée tomber d'un point à l'autre : la fin est dans ce pas.
      else expect(endMs > 8000 && endMs < 12_000).toBe(true);
    }
  });

  it('la fin de la vague si son dernier point tient le plancher, son début si aucun ne le tient', () => {
    const fast = ride(10, () => 15, () => 0, 1, true);
    expect(rideEndMsOf(fast, 2, 8, FLOOR)).toBe(8000);
    const slow = ride(10, () => 5, () => 0, 1, true);
    expect(rideEndMsOf(slow, 2, 8, FLOOR)).toBe(2000);
  });

  it('un trou de la trace ne s\'interpole pas : la fin est le dernier point au-dessus du plancher', () => {
    const track = ride(10, (t) => (t <= 6 ? 15 : 3), () => 0, 1, true).filter((p) => p.timeMs <= 6000 || p.timeMs >= 9000);
    expect(rideEndMsOf(track, 0, track.length - 1, FLOOR, 2)).toBe(6000);
    expect(rideEndMsOf(track, 0, track.length - 1, FLOOR)).toBeGreaterThan(6000);
  });
});
