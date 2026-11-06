import { describe, expect, it } from 'vitest';
import { smoothHeartRate } from './heartRate';
import type { HeartRateSessionPoint } from './heartRateSession';
import { estimateHrEnergy, hrEnergyKcal, type HrEnergyAthlete, type HrEnergyEstimate } from './hrEnergy';
import { SPORT_PROFILES } from './sportProfiles';
import { J_PER_KCAL } from './units';

const ENERGY = SPORT_PROFILES.wingfoil.hrEnergy!;
const HEART = SPORT_PROFILES.wingfoil.heartRate;
const MAN: HrEnergyAthlete = { weightKg: 75, age: 40, sex: 'm', hrMax: null };
const WOMAN: HrEnergyAthlete = { weightKg: 65, age: 40, sex: 'f', hrMax: null };

/** Trace de `durationS` secondes à `hz` points par seconde ; `hrAt(t)` : FC à t secondes, `undefined` sans FC. */
const trace = (durationS: number, hz: number, hrAt: (t: number) => number | undefined): HeartRateSessionPoint[] => {
  const out: HeartRateSessionPoint[] = [];
  for (let k = 0; k <= durationS * hz; k++) {
    const t = k / hz;
    const hr = hrAt(t);
    out.push({ timeMs: t * 1000, ...(hr !== undefined ? { hr } : {}) });
  }
  return out;
};

const estimate = (points: HeartRateSessionPoint[], athlete: HrEnergyAthlete): HrEnergyEstimate | null =>
  estimateHrEnergy(points, smoothHeartRate(points, HEART.smoothS, HEART.gapS), athlete, HEART, ENERGY);

/** Estimation attendue, sinon échec du test. */
const done = (points: HeartRateSessionPoint[], athlete: HrEnergyAthlete) => {
  const e = estimate(points, athlete);
  if (e?.kind !== 'estimation') throw new Error(`pas d'estimation : ${JSON.stringify(e)}`);
  return e;
};

const kcal = (j: number) => j / J_PER_KCAL;

describe('estimateHrEnergy', () => {
  it('1 h à FC 130 : 716 kcal pour un homme de 75 kg, 466 pour une femme de 65 kg (Keytel, recherche §6)', () => {
    const points = trace(3600, 1, () => 130);
    const man = done(points, MAN);
    expect(kcal(man.totalJ)).toBeCloseTo(715.6, 0);
    expect(Math.abs(kcal(man.totalJ) / 715.6 - 1)).toBeLessThan(0.01);
    expect(Math.abs(kcal(done(points, WOMAN).totalJ) / 465.8 - 1)).toBeLessThan(0.01);
    // Dont repos : 1 kcal/kg/h.
    expect(kcal(man.restJ)).toBeCloseTo(75, 6);
    expect(man.measuredS).toBe(3600);
    expect(man.coverage).toBe(1);
    expect(man.sexAveraged).toBe(false);
    expect(hrEnergyKcal(man.totalJ, ENERGY.displayStepKcal)).toBe(720);
  });

  it('même total à 1 Hz et à 5 Hz', () => {
    const steady = (hz: number) => done(trace(3600, hz, () => 130), MAN).totalJ;
    expect(kcal(steady(5))).toBeCloseTo(kcal(steady(1)), 3);
    const varying = (hz: number) => done(trace(3600, hz, (t) => 120 + 25 * Math.sin(t / 300)), MAN).totalJ;
    expect(Math.abs(varying(5) / varying(1) - 1)).toBeLessThan(0.002);
  });

  it('sous le plancher, le repos : 20 min à 70 bpm font poids / 60 kcal par minute, jamais moins', () => {
    const e = done(trace(1200, 1, () => 70), MAN);
    expect(kcal(e.totalJ)).toBeCloseTo((75 / 60) * 20, 6);
    expect(e.belowFloorS).toBe(1200);
    // Juste au-dessus du plancher, Keytel reprend : plus que le repos.
    const above = done(trace(1200, 1, () => 95), MAN);
    expect(above.totalJ).toBeGreaterThan(e.totalJ);
    expect(above.belowFloorS).toBe(0);
  });

  it('trou de FC de 5 s interpolé ; de 60 s hors total, couverture réduite', () => {
    const full = done(trace(3600, 1, () => 130), MAN);
    const short = done(trace(3600, 1, (t) => (t > 1000 && t < 1006 ? undefined : 130)), MAN);
    expect(short.measuredS).toBe(3600);
    expect(kcal(short.totalJ)).toBeCloseTo(kcal(full.totalJ), 3);
    const long = done(trace(3600, 1, (t) => (t > 1000 && t < 1061 ? undefined : 130)), MAN);
    expect(long.measuredS).toBe(3600 - 61);
    expect(long.coverage).toBeLessThan(1);
    // Couverture au-dessus de 80 % : extrapolé au débit moyen, le même total.
    expect(long.extrapolated).toBe(true);
    expect(kcal(long.totalJ)).toBeCloseTo(kcal(full.totalJ), 3);
  });

  it('couverture de 90 % : total extrapolé ; de 50 % : la part mesurée seule', () => {
    const full = done(trace(3600, 1, () => 130), MAN);
    const most = done(trace(3600, 1, (t) => (t <= 3240 ? 130 : undefined)), MAN);
    expect(most.coverage).toBeCloseTo(0.9, 6);
    expect(most.extrapolated).toBe(true);
    expect(kcal(most.totalJ)).toBeCloseTo(kcal(full.totalJ), 3);
    expect(kcal(most.restJ)).toBeCloseTo(75, 6);
    const half = done(trace(3600, 1, (t) => (t <= 1800 ? 130 : undefined)), MAN);
    expect(half.coverage).toBeCloseTo(0.5, 6);
    expect(half.extrapolated).toBe(false);
    expect(half.measuredS).toBe(1800);
    expect(kcal(half.totalJ)).toBeCloseTo(kcal(full.totalJ / 2), 3);
    expect(kcal(half.restJ)).toBeCloseTo(37.5, 6);
  });

  it('sans poids ou sans âge : profil incomplet ; sous le temps minimal de FC : rien', () => {
    const points = trace(3600, 1, () => 130);
    expect(estimate(points, { ...MAN, weightKg: null })).toEqual({ kind: 'profil-incomplet' });
    expect(estimate(points, { ...MAN, age: null })).toEqual({ kind: 'profil-incomplet' });
    expect(estimate(trace(3600, 1, (t) => (t <= 30 ? 130 : undefined)), MAN)).toBeNull();
    expect(estimate(trace(3600, 1, () => undefined), { ...MAN, weightKg: null })).toBeNull();
  });

  it('sans sexe : moyenne des deux équations', () => {
    const points = trace(3600, 1, () => 130);
    const m = done(points, MAN).totalJ;
    const f = done(points, { ...MAN, sex: 'f' }).totalJ;
    const either = done(points, { ...MAN, sex: null });
    expect(kcal(either.totalJ)).toBeCloseTo(kcal((m + f) / 2), 3);
    expect(either.sexAveraged).toBe(true);
  });

  it('FC bornée à la FC max, sinon à 220 − âge + 10', () => {
    const at = (bpm: number, hrMax: number | null) => done(trace(3600, 1, () => bpm), { ...MAN, hrMax }).totalJ;
    expect(kcal(at(200, null))).toBeCloseTo(kcal(at(190, null)), 3);
    expect(at(185, null)).toBeLessThan(at(190, null));
    expect(kcal(at(200, 180))).toBeCloseTo(kcal(at(180, 180)), 3);
  });

  it('pause de l\'enregistrement : la durée de session ne la compte pas', () => {
    // 30 min, pause de 10 min, 30 min : la reprise porte `segmentStart`.
    const first = trace(1800, 1, () => 130);
    const second = trace(1800, 1, () => 130).map((p, k) => ({ ...p, timeMs: p.timeMs + 2400_000, ...(k === 0 ? { segmentStart: true as const } : {}) }));
    const e = done([...first, ...second], MAN);
    expect(e.sessionS).toBe(3600);
    expect(e.coverage).toBe(1);
    expect(Math.abs(kcal(e.totalJ) / 715.6 - 1)).toBeLessThan(0.01);
  });
});
