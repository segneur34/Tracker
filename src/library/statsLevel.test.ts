import { describe, expect, it } from 'vitest';
import { statSession } from '../test/record.fixture';
import { bestOf, cyclingLevel, levelProfileOf, runningLevel } from './statsLevel';

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();

describe('onglet « niveau » des statistiques (lot 146)', () => {
  const man = levelProfileOf({ sex: 'm', birthYear: 1986, weightKg: 70 })!;

  it('lit le sexe et l’année de naissance, rien sans l’un d’eux', () => {
    expect(man).toEqual({ sex: 'h', birthYear: 1986, weightKg: 70 });
    expect(levelProfileOf({ sex: 'f', birthYear: 1990, weightKg: null })).toEqual({ sex: 'f', birthYear: 1990, weightKg: null });
    expect(levelProfileOf({ sex: null, birthYear: 1986, weightKg: 70 })).toBeNull();
    expect(levelProfileOf({ sex: 'm', birthYear: null, weightKg: 70 })).toBeNull();
  });

  it('garde le meilleur temps de la période, le plus ancien à égalité ; la plus haute puissance', () => {
    const a = statSession(at(2026, 9, 1), { bests: { d5kmS: 1500, d10kmS: 3100 } });
    const b = statSession(at(2026, 9, 2), { bests: { d5kmS: 1450 } });
    const c = statSession(at(2026, 9, 3), { bests: { d5kmS: 1450, p20minW: 220 } });
    const d = statSession(at(2026, 9, 4), { bests: { p20minW: 230 } });
    expect(bestOf([a, b, c, d], 'd5kmS')).toEqual({ session: b, value: 1450 });
    expect(bestOf([a, b, c, d], 'd10kmS')?.session).toBe(a);
    expect(bestOf([a, b, c, d], 'p20minW')?.value).toBe(230);
    expect(bestOf([statSession(at(2026, 9, 5))], 'd5kmS')).toBeNull();
  });

  it('à pied : la référence de l’âge l’année de la session, et la VO2max la plus haute des deux', () => {
    // 40 ans en 2026 : 10 km en 41 min, 66,8 % ; 5 km en 19 min 57 s.
    const run10 = statSession(at(2026, 10, 12), { bests: { d10kmS: 2460 } });
    const run5 = statSession(at(2026, 10, 4), { bests: { d5kmS: 1197 } });
    const level = runningLevel([run10, run5], man);
    expect(level.d10km?.percent).toBeCloseTo(66.8, 1);
    expect(level.d10km?.classLabel).toBe('niveau local');
    expect(level.d10km?.session).toBe(run10);
    expect(level.d5km?.percent).toBeCloseTo((812 / 1197) * 100, 6);
    // 41 min au 10 km vaut un peu mieux que 19 min 57 s au 5 km (VDOT 50) : l'estimation vient du 10 km.
    expect(level.vo2?.from).toBe('d10kmS');
    expect(level.vo2?.session).toBe(run10);
    expect(level.vo2?.vo2).toBeGreaterThan(50);
    expect(level.vo2?.standing).toMatchObject({ kind: 'within', band: { fromAge: 40, toAge: 49 } });
    const slower = runningLevel([statSession(at(2026, 10, 12), { bests: { d10kmS: 2700 } }), run5], man);
    expect(slower.vo2?.from).toBe('d5kmS');
    expect(slower.vo2?.vo2).toBeCloseTo(50, 0);
    // Une course d'il y a dix ans : l'âge de cette année-là.
    const old = runningLevel([statSession(at(2016, 10, 12), { bests: { d10kmS: 2460 } })], man);
    expect(old.d10km?.percent).toBeCloseTo((1584 / 2460) * 100, 6);
    expect(runningLevel([], man)).toEqual({ d5km: null, d10km: null, vo2: null });
  });

  it('à vélo : 95 % des meilleurs 20 min sur le poids de l’estimation, puis le barème ; sans poids, pas de niveau', () => {
    const ride = statSession(at(2026, 10, 4), { bests: { p20minW: 212, powerRiderKg: 72 } });
    const level = cyclingLevel([ride], man);
    expect(level.best).toEqual({ session: ride, watts: 212 });
    expect(level.wkg).toBeCloseTo((212 * 0.95) / 72, 9);
    expect(level.levelLabel).toBe('entraîné');
    const noWeight = cyclingLevel([statSession(at(2026, 10, 4), { bests: { p20minW: 212 } })], { ...man, weightKg: null });
    expect(noWeight.wkg).toBeNull();
    expect(noWeight.levelLabel).toBeNull();
    expect(cyclingLevel([], man)).toEqual({ best: null, wkg: null, levelLabel: null });
  });
});
