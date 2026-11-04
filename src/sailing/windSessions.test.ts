// @vitest-environment node
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { parseGpx } from '../core/gpxParser';
import { analyzeSailing, counts, degApart, jibesOf, komootRaw, rawToGpx, sailRaw, tacksOf, topSpeeds, upDownLegs, NO_NOISE, SAIL_T0 } from '../test/sailing.fixture';
import { windInputWarning } from './sailingAnalytics';
import { polarWindCandidates } from './wind';

/**
 * Sessions réalistes passées par la chaîne réelle (sondes C1 de l'audit du
 * 03/11, reprises au lot 149) : filet du vent, avertissement du vent saisi,
 * virage en un seul pas, dates qui reculent. Les chiffres attendus sont ceux
 * relevés le 04/11, avant et après le lot, notés à chaque cas.
 */

beforeAll(() => {
  vi.stubGlobal('DOMParser', XmlDomParser);
});

const WIND = 20;

describe('vent : polaire seule, sans manœuvre qui départage (C1-2)', () => {
  const run = (legs: { twa: number; durationS: number }[]) => analyzeSailing(sailRaw({ windDeg: WIND, legs, hz: 1, seed: 5 }));

  it('un bord de près, une abattée, un bord de largue : rien ne départage, le vent est demandé', () => {
    // Avant comme après : 290° non fiable (0,22), candidats polaires 109°, 0°, 197°.
    const a = run([{ twa: 45, durationS: 600 }, { twa: 135, durationS: 600 }]);
    expect(a.windEstimate.reliable).toBe(false);
    expect(a.currentWind).toBeNull();
  });

  it('près tribord, virement, près bâbord, abattée, largue : un seul virement suffit', () => {
    // Avant comme après : 19° fiable, par la polaire.
    const a = run([{ twa: 45, durationS: 400 }, { twa: -45, durationS: 400 }, { twa: -135, durationS: 400 }]);
    expect(a.windEstimate.reliable).toBe(true);
    expect(degApart(a.windEstimate.direction, WIND)).toBeLessThanOrEqual(3);
  });

  it('deux virements, aucun empannage', () => {
    // Avant comme après : 20° fiable, par la polaire.
    const a = run([{ twa: 45, durationS: 300 }, { twa: -45, durationS: 300 }, { twa: 45, durationS: 300 }, { twa: 135, durationS: 300 }]);
    expect(a.windEstimate.reliable).toBe(true);
    expect(degApart(a.windEstimate.direction, WIND)).toBeLessThanOrEqual(3);
  });

  it('allers-retours au près seulement (6 virements) : la direction votée par les virages est le filet', () => {
    // Avant : 154° non fiable (confiance 0), le vrai vent absent des candidats polaires 109°, 154°, 199°.
    // Après : 20° fiable, orienté par les virages, 6 virements comptés.
    const a = run(Array.from({ length: 7 }, (_, i) => ({ twa: i % 2 === 0 ? 45 : -45, durationS: 150 })));
    expect(a.windEstimate.reliable).toBe(true);
    expect(a.windEstimate.orientedBy).toBe('virages');
    expect(degApart(a.windEstimate.direction, WIND)).toBeLessThanOrEqual(3);
    expect(tacksOf(a)).toBe(6);
  });

  it('empannages seulement (6), jamais de près', () => {
    // Avant comme après : 17° fiable, par la polaire, 6 empannages.
    const a = run(Array.from({ length: 7 }, (_, i) => ({ twa: i % 2 === 0 ? 135 : -135, durationS: 150 })));
    expect(a.windEstimate.reliable).toBe(true);
    expect(degApart(a.windEstimate.direction, WIND)).toBeLessThanOrEqual(5);
    expect(jibesOf(a)).toBe(6);
  });
});

describe('vent : longue session (C1-2)', () => {
  // Les sept sessions retrouvent 19° à 20° par les virages, avant comme après le lot ; le meilleur candidat
  // polaire est le trou de couverture (111° à 116°), le vrai vent son troisième candidat.
  const cases: { name: string; legs: number; legS: number; hz: number; seed: number }[] = [
    { name: '12 bords 95 s, 1 Hz, graine 3', legs: 12, legS: 95, hz: 1, seed: 3 },
    { name: '12 bords 90 s, 5 Hz, graine 11', legs: 12, legS: 90, hz: 5, seed: 11 },
    { name: '30 bords 90 s, 5 Hz, graine 11', legs: 30, legS: 90, hz: 5, seed: 11 },
    { name: '60 bords 90 s, 5 Hz, graine 11', legs: 60, legS: 90, hz: 5, seed: 11 },
    { name: '120 bords 90 s, 1 Hz, graine 11', legs: 120, legS: 90, hz: 1, seed: 11 },
    { name: '120 bords 90 s, 5 Hz, graine 3', legs: 120, legS: 90, hz: 5, seed: 3 },
    { name: '60 bords 90 s, 1 Hz, graine 3', legs: 60, legS: 90, hz: 1, seed: 3 },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const a = analyzeSailing(sailRaw({ windDeg: WIND, legs: upDownLegs(c.legs, c.legS), hz: c.hz, seed: c.seed }));
      const best = polarWindCandidates(a.points, a.polarMinSpeedKn, 1)[0].direction;
      expect(degApart(best, WIND)).toBeGreaterThan(60);
      expect(a.windEstimate.reliable).toBe(true);
      expect(a.windEstimate.orientedBy).toBe('virages');
      expect(degApart(a.windEstimate.direction, WIND)).toBeLessThanOrEqual(3);
      // `legs − 1` virements puis autant d'empannages ; un ou deux virages bruités tombent « incohérents ».
      expect(tacksOf(a)).toBeGreaterThanOrEqual(c.legs - 2);
      expect(jibesOf(a)).toBeGreaterThanOrEqual(c.legs - 2);
    }, 120_000);
  }

  it('décélération brutale (sans inertie, 5 Hz) : jamais « fiable » loin du vrai vent', () => {
    // Audit du 03/11 (avant le lot 144) : 106° fiable à 0,68, 254 virages écartés. Avant le lot 149 : 26° ;
    // après : 20° par les virages.
    const a = analyzeSailing(sailRaw({ windDeg: WIND, legs: upDownLegs(60, 90), hz: 5, seed: 11, speedTauS: 0 }));
    expect(!a.windEstimate.reliable || degApart(a.windEstimate.direction, WIND) <= 10).toBe(true);
    expect(degApart(a.windEstimate.direction, WIND)).toBeLessThanOrEqual(10);
  }, 120_000);
});

describe('vent saisi loin du vent calculé (C1-3)', () => {
  const base = sailRaw({ windDeg: WIND, legs: upDownLegs(12, 95), hz: 1, seed: 3 });
  const warningAt = (off: number) => {
    const a = analyzeSailing(base, { windDeg: WIND + off });
    return { a, warning: windInputWarning({ manualDeg: WIND + off, autoWind: a.windEstimate, stats: a.maneuvers }) };
  };

  it('à 30° d’écart, les 22 manœuvres restent classées : aucun avertissement', () => {
    const { a, warning } = warningAt(30);
    expect(tacksOf(a) + jibesOf(a)).toBe(22);
    expect(warning).toBeNull();
  });

  it('à 60° d’écart, 22 virages tombent « sens incertain » : l’avertissement est levé', () => {
    const { a, warning } = warningAt(60);
    expect(tacksOf(a) + jibesOf(a)).toBeLessThanOrEqual(1);
    expect(warning).toEqual({ manualDeg: 80, autoDeg: a.windEstimate.direction, unclassified: 22 });
  });
});

describe('virage entier dans un seul pas, enregistreur économique (C1-1)', () => {
  const legsAt = (twa: number) => [{ twa, durationS: 120 }, { twa: -twa, durationS: 120 }, { twa, durationS: 120 }, { twa: -twa, durationS: 120 }];

  it('virement de 90° dans un silence de 20 s : les trois virements sont lus, le point de reprise porte le cap du nouveau bord', () => {
    // Avant : 0 virement, rien d'écarté, cap de la corde (12°) au point de reprise ; après : 3, cap 335°.
    const a = analyzeSailing(komootRaw(WIND, legsAt(45), 20), { windDeg: WIND });
    expect(tacksOf(a)).toBe(3);
    expect(jibesOf(a)).toBe(0);
    const resume = a.track.findIndex((p) => p.gapDistanceM !== undefined);
    expect(resume).toBeGreaterThan(0);
    expect(degApart(a.points[resume].bearing, a.points[resume + 1].bearing)).toBeLessThanOrEqual(1);
  });

  for (const [twa, turn] of [[65, 130], [75, 150]] as const) {
    it(`virage de ${turn}° dans un silence de 20 s : trois virements, comme avant`, () => {
      const a = analyzeSailing(komootRaw(WIND, legsAt(twa), 20), { windDeg: WIND });
      expect(tacksOf(a)).toBe(3);
      expect(counts(a).undecided).toBe(0);
    });
  }

  it('témoin dense à 1 Hz : trois virements', () => {
    const a = analyzeSailing(sailRaw({ windDeg: WIND, legs: legsAt(45), hz: 1, noise: NO_NOISE, transitionS: 4 }), { windDeg: WIND });
    expect(tacksOf(a)).toBe(3);
    expect(a.track.every((p) => p.gapDistanceM === undefined)).toBe(true);
    expect(a.track[0].timeMs).toBe(SAIL_T0);
  });
});

describe('dates qui reculent dans le fichier (C1-4, C2-1)', () => {
  const base = sailRaw({ windDeg: WIND, legs: upDownLegs(12, 95), hz: 1, seed: 3 });

  it('deux points permutés : le point daté en arrière est écarté, mêmes manœuvres, mêmes tops, même vent', () => {
    // Avant : top 2 s 17,36 → 18,35 nd et un tour complet fantôme ; après : identiques au fichier en ordre.
    const a = analyzeSailing(parseGpx(rawToGpx(base)).rawPoints);
    const swapped = [...base];
    [swapped[700], swapped[701]] = [swapped[701], swapped[700]];
    const parsed = parseGpx(rawToGpx(swapped)).rawPoints;
    expect(parsed).toHaveLength(base.length - 1);
    const s = analyzeSailing(parsed);
    expect(counts(s)).toEqual(counts(a));
    expect(counts(s).rejected?.fullTurn).toBe(0);
    for (const [key, speed] of Object.entries(topSpeeds(a))) expect(topSpeeds(s)[key], key).toBeCloseTo(speed ?? 0, 2);
    expect(degApart(a.windEstimate.direction, s.windEstimate.direction)).toBeLessThanOrEqual(1);
  });
});
