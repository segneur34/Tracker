import { describe, expect, it } from 'vitest';
import { ageGradeClass, ageGradePercent, ageGradeStandardS } from './ageGrade';
import { AGE_GRADE_STANDARDS } from './ageGradeTables';
import { vdotFromRace } from './vdot';
import { vo2maxBand, vo2maxPercentile } from './vo2maxNorms';

describe('référence de l’âge (tables WMA et USATF, lot 146)', () => {
  it('reprend les temps standard des tables', () => {
    expect(ageGradeStandardS('h', 40, 5000)).toBe(812);
    expect(ageGradeStandardS('h', 40, 10000)).toBe(1644);
    expect(ageGradeStandardS('f', 40, 5000)).toBe(878);
    expect(ageGradeStandardS('f', 40, 10000)).toBe(1794);
    expect(ageGradeStandardS('h', 25, 10000)).toBe(1584);
    for (const sex of ['h', 'f'] as const) for (const table of Object.values(AGE_GRADE_STANDARDS[sex])) expect(table).toHaveLength(96);
  });

  it('hommes de 40 ans, 10 km en 41 min : 66,8 %, niveau local', () => {
    const percent = ageGradePercent('h', 40, 10000, 2460)!;
    expect(percent).toBeCloseTo(66.8, 1);
    expect(ageGradeClass(percent)).toEqual({ key: 'local', label: 'niveau local' });
  });

  it('femmes de 20 ans, 5 km en 834 s : 100 %', () => {
    expect(ageGradePercent('f', 20, 5000, 834)).toBeCloseTo(100, 6);
  });

  it('borne l’âge à 5 et 100 ans, garde l’âge entier', () => {
    expect(ageGradePercent('h', 120, 10000, 3000)).toBe(ageGradePercent('h', 100, 10000, 3000));
    expect(ageGradePercent('h', 2, 5000, 1500)).toBe(ageGradePercent('h', 5, 5000, 1500));
    expect(ageGradeStandardS('h', 40.9, 5000)).toBe(812);
  });

  it('rien hors des quatre distances, ni pour un temps nul', () => {
    expect(ageGradePercent('h', 40, 6000, 1500)).toBeNull();
    expect(ageGradePercent('h', 40, 5000, 0)).toBeNull();
    expect(ageGradeStandardS('f', 30, 21097.5)).not.toBeNull();
    expect(ageGradeStandardS('f', 30, 42195)).not.toBeNull();
  });

  it('classes : mondial, national, régional, local, loisir', () => {
    expect([95, 90, 85, 75, 70, 65, 59.9].map((p) => ageGradeClass(p).key)).toEqual(['mondial', 'mondial', 'national', 'regional', 'regional', 'local', 'loisir']);
  });
});

describe('VDOT de Daniels et Gilbert (lot 146)', () => {
  it('rejoint les tables de Daniels : 5 km en 19 min 57 s et 10 km en 41 min 21 s font 50', () => {
    expect(Math.abs(vdotFromRace(5000, 19 * 60 + 57)! - 50)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(vdotFromRace(10000, 41 * 60 + 21)! - 50)).toBeLessThanOrEqual(0.5);
  });

  it('plus vite, plus haut ; rien pour une course vide', () => {
    expect(vdotFromRace(5000, 1100)!).toBeGreaterThan(vdotFromRace(5000, 1200)!);
    expect(vdotFromRace(0, 1200)).toBeNull();
    expect(vdotFromRace(5000, 0)).toBeNull();
  });
});

describe('normes de VO2max FRIEND 2022 (lot 146)', () => {
  it('le 50e percentile exact', () => {
    expect(vo2maxPercentile('h', 45, 34.8)).toMatchObject({ kind: 'within', percentile: 50 });
    expect(vo2maxPercentile('f', 25, 35.6)).toMatchObject({ kind: 'within', percentile: 50 });
  });

  it('interpole entre deux colonnes', () => {
    // Hommes de 40 à 49 ans : 50e à 34,8, 75e à 41,8 ; à mi-chemin, le 62,5e.
    expect(vo2maxPercentile('h', 40, (34.8 + 41.8) / 2).percentile).toBeCloseTo(62.5, 6);
  });

  it('sous le 5e et au-dessus du 95e : les bornes, dites comme telles', () => {
    expect(vo2maxPercentile('h', 40, 15)).toMatchObject({ kind: 'below', percentile: 5 });
    expect(vo2maxPercentile('h', 40, 60)).toMatchObject({ kind: 'above', percentile: 95 });
    expect(vo2maxPercentile('h', 40, 19.7)).toMatchObject({ kind: 'within', percentile: 5 });
    expect(vo2maxPercentile('h', 40, 53.2)).toMatchObject({ kind: 'within', percentile: 95 });
  });

  it('avant 20 ans, la tranche des 20 à 29 ans ; après 89, la dernière', () => {
    expect(vo2maxBand('f', 16)).toMatchObject({ fromAge: 20, toAge: 29 });
    expect(vo2maxBand('h', 95)).toMatchObject({ fromAge: 80, toAge: 89 });
    expect(vo2maxBand('h', 49)).toMatchObject({ fromAge: 40, toAge: 49 });
  });
});
