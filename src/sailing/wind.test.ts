import { describe, expect, it } from 'vitest';
import type { PointData } from './pointData';
import { sessionManeuverThresholds } from './sailingConfig';
import { buildWindTimeline, circularStats, describeWindCandidate, estimateWindFromPolar, estimateWindPolar, interpolateDirection, observeTurns, pointerWindDeg, polarSampling, polarWindCandidates, prepareWindPolar, speedPolar, scoreWindCandidate, windDegFromText } from './wind';
import { angleDiff, circularMean } from '../core/angles';

describe('buildWindTimeline', () => {
  const MIN = 60 * 1000;
  const maxGap = 30 * MIN;

  it('rend le repli au-delà du trou maximal, aux bords comme au milieu', () => {
    const wind = buildWindTimeline([{ timeMs: 120 * MIN, direction: 40 }], 10, maxGap);
    // Deux heures avant l'unique manœuvre : le vent global, pas la mesure la plus proche.
    expect(wind(0)).toBe(10);
    expect(wind(240 * MIN)).toBe(10);
    // À moins de 30 min : la valeur la plus proche.
    expect(wind(110 * MIN)).toBe(40);
    expect(wind(140 * MIN)).toBe(40);
    // Un trou de 31 min au milieu : le repli.
    const twin = buildWindTimeline([{ timeMs: 0, direction: 40 }, { timeMs: 31 * MIN, direction: 50 }], 10, maxGap);
    expect(twin(15 * MIN)).toBe(10);
  });

  it('rend le repli sans aucune mesure, et interpole entre deux', () => {
    expect(buildWindTimeline([], 10, maxGap)(5 * MIN)).toBe(10);
    const wind = buildWindTimeline([{ timeMs: 0, direction: 350 }, { timeMs: 10 * MIN, direction: 10 }], 180, maxGap);
    expect(wind(5 * MIN)).toBeCloseTo(0, 6);
  });
});

describe('windDegFromText', () => {
  it('lit un entier et le ramène dans [0, 360[', () => {
    expect(windDegFromText('245')).toBe(245);
    expect(windDegFromText(' 370 ')).toBe(10);
    expect(windDegFromText('-10')).toBe(350);
    expect(windDegFromText('359.6')).toBe(0);
  });

  it('ne dit rien d\'un texte vide ou illisible', () => {
    expect(windDegFromText('')).toBeNull();
    expect(windDegFromText('abc')).toBeNull();
    expect(windDegFromText('12a')).toBeNull();
  });
});

describe('interpolateDirection', () => {
  const MIN = 60 * 1000;
  const samples = [
    { timeMs: 10 * MIN, direction: 350 },
    { timeMs: 20 * MIN, direction: 10 },
  ];

  it('interpole entre deux mesures sans traverser le saut 359 → 0', () => {
    expect(interpolateDirection(samples, 15 * MIN, 0, 30 * MIN)).toBeCloseTo(0, 6);
  });

  it('garde la valeur la plus proche avant la première et après la dernière mesure', () => {
    // Début et fin de session : la courbe doit couvrir toute la trace, pas
    // seulement l'intervalle entre la première et la dernière manœuvre.
    expect(interpolateDirection(samples, 0, 0, 30 * MIN)).toBe(350);
    expect(interpolateDirection(samples, 45 * MIN, 0, 30 * MIN)).toBe(10);
  });

  it('s\'interrompt au-delà du trou maximal, aux bords comme entre deux mesures', () => {
    expect(interpolateDirection(samples, 51 * MIN, 0, 30 * MIN)).toBeNull();
    expect(interpolateDirection(samples, 15 * MIN, 0, 5 * MIN)).toBeNull();
    expect(interpolateDirection([], 15 * MIN, 0, 30 * MIN)).toBeNull();
  });
});

describe('circularMean', () => {
  it('moyenne 350° et 10° à 0°, et non à 180°', () => {
    expect(circularMean([350, 10]).mean).toBeCloseTo(0, 6);
  });

  it('donne un vecteur court quand les directions s\'opposent', () => {
    expect(circularMean([0, 180]).R).toBeLessThan(1e-9);
  });

  it('tient compte des poids', () => {
    const { mean } = circularMean([0, 90], [3, 1]);
    expect(mean).toBeGreaterThan(0);
    expect(mean).toBeLessThan(45);
  });
});

describe('circularStats', () => {
  it('mesure des écarts autour de la moyenne sans dérouler', () => {
    const stats = circularStats([350, 10, 20]);
    expect(Math.abs(angleDiff(stats.mean, 6.7))).toBeLessThan(1);
    expect(stats.minDev).toBeLessThan(-15);
    expect(stats.maxDev).toBeGreaterThan(12);
  });

  it('a un écart-type nul pour des directions identiques', () => {
    expect(circularStats([42, 42, 42]).stdDevDeg).toBeCloseTo(0, 6);
  });

  it('ne diverge pas sur une série qui alterne un angle et son opposé', () => {
    // Le déroulement arithmétique donnerait 38, 218, 398, 578… ; la moyenne
    // vectorielle reste bornée et signale la dispersion par un R quasi nul.
    const stats = circularStats([38, 218, 38, 218, 38, 218]);
    expect(stats.R).toBeLessThan(0.1);
    expect(stats.mean).toBeGreaterThanOrEqual(0);
    expect(stats.mean).toBeLessThan(360);
  });
});

/** Polaire synthétique : vitesses max par cap, construites à la main. */
const polarWith = (entries: [number, number][]): number[] => {
  const maxSpeeds = new Array<number>(360).fill(0);
  for (const [bearing, speed] of entries) maxSpeeds[((bearing % 360) + 360) % 360] = speed;
  return maxSpeeds;
};

describe('scoreWindCandidate', () => {
  it('pénalise lourdement la vitesse dans l\'angle mort', () => {
    const maxSpeeds = polarWith([[0, 15], [45, 12], [315, 12]]);
    const withFastNoGo = scoreWindCandidate(maxSpeeds, 0);
    const clean = scoreWindCandidate(polarWith([[45, 12], [315, 12]]), 0);
    expect(withFastNoGo.score).toBeLessThan(clean.score);
    expect(withFastNoGo.noGo).toBe(15);
  });

  it('récompense les deux bords de près et sanctionne le déséquilibre', () => {
    const balanced = scoreWindCandidate(polarWith([[45, 12], [315, 12]]), 0);
    const oneSided = scoreWindCandidate(polarWith([[45, 24]]), 0);
    expect(balanced.left).toBe(12);
    expect(balanced.right).toBe(12);
    expect(balanced.score).toBeGreaterThan(oneSided.score);
  });
});

/** Trace immobile en position, mais avec cap et vitesse imposés. */
const buildPoints = (samples: { bearing: number; speed: number }[]): PointData[] => {
  const start = Date.parse('2026-01-01T10:00:00Z');
  return samples.map((s, i) => ({
    lat: 43.6,
    lon: 3.8,
    timeMs: start + i * 1000,
    smoothedSpeed: s.speed,
    bearing: s.bearing,
  }));
};

/**
 * Polaire réaliste d'un wingfoil pour un vent donné : rien dans le cône de
 * ±40°, près à 12 nœuds, largue à 18, portant à 14, et un petit trou au vent
 * arrière pur, rarement navigué.
 */
const realisticPolar = (windDir: number): { bearing: number; speed: number }[] => {
  const samples: { bearing: number; speed: number }[] = [];
  for (let twa = 40; twa <= 165; twa++) {
    const speed = twa < 60 ? 12 : twa < 125 ? 18 : 14;
    samples.push({ bearing: windDir + twa, speed });
    samples.push({ bearing: windDir - twa, speed });
  }
  return samples.map((s) => ({ ...s, bearing: ((s.bearing % 360) + 360) % 360 }));
};

describe('estimateWindFromPolar', () => {
  it('centre le vent au milieu de l\'angle mort', () => {
    const estimate = estimateWindFromPolar(buildPoints(realisticPolar(0)));
    expect(Math.abs(angleDiff(estimate.direction, 0))).toBeLessThanOrEqual(3);
    expect(estimate.clarity).toBeGreaterThan(0.95);
    expect(estimate.symmetry).toBeGreaterThan(0.95);
  });

  it('distingue l\'angle mort de son jumeau au vent arrière', () => {
    const estimate = estimateWindFromPolar(buildPoints(realisticPolar(90)));
    expect(Math.abs(angleDiff(estimate.direction, 90))).toBeLessThanOrEqual(3);
    expect(estimate.contrast).toBeGreaterThan(0.15);
  });

  it('retrouve le vent quelle que soit sa direction', () => {
    for (const wind of [0, 38, 135, 200, 270, 350]) {
      const estimate = estimateWindFromPolar(buildPoints(realisticPolar(wind)));
      expect(Math.abs(angleDiff(estimate.direction, wind))).toBeLessThanOrEqual(3);
    }
  });

  it('signale un angle mort brouillé', () => {
    // Autant de vitesse dans le cône qu'au près.
    const samples: { bearing: number; speed: number }[] = [];
    for (let b = 0; b < 360; b += 2) samples.push({ bearing: b, speed: 12 });
    const estimate = estimateWindFromPolar(buildPoints(samples));
    expect(estimate.clarity).toBeLessThan(0.3);
  });
});

describe('describeWindCandidate', () => {
  it('décrit la direction imposée, et non le meilleur score', () => {
    const points = buildPoints(realisticPolar(90));
    const described = describeWindCandidate(points, 90);

    expect(described.direction).toBe(90);
    expect(described).toEqual(estimateWindFromPolar(points));
  });

  it('sépare le vent de son jumeau au vent arrière', () => {
    // C'est tout l'intérêt de pouvoir décrire une direction imposée : le
    // jumeau est testé comme candidat sans être un maximum du score polaire,
    // et sa confiance propre est bien plus basse que celle du vrai vent.
    const points = buildPoints(realisticPolar(90));
    const confianceDe = (direction: number) => {
      const c = describeWindCandidate(points, direction);
      return c.symmetry * c.coverage * c.clarity;
    };

    expect(confianceDe(90)).toBeGreaterThan(confianceDe(270));
  });

  it('normalise la direction reçue', () => {
    const points = buildPoints(realisticPolar(0));
    expect(describeWindCandidate(points, -90).direction).toBe(270);
    expect(describeWindCandidate(points, 450).direction).toBe(90);
  });
});

describe('prepareWindPolar', () => {
  it("rend les candidats, les descripteurs, l'estimation polaire et le soutien des fonctions qu'il remplace", () => {
    // Polaires nettes (orientées par la polaire) et couverture symétrique
    // (orientée par les virages, contraste faible), trace vide comprise.
    const symmetric: { bearing: number; speed: number }[] = [];
    for (let b = 0; b < 360; b += 2) symmetric.push({ bearing: b, speed: 12 });
    for (const points of [buildPoints(realisticPolar(0)), buildPoints(realisticPolar(137)), buildPoints(symmetric), []]) {
      for (const minSpeedKn of [2, 5]) {
        const stage = prepareWindPolar(points, minSpeedKn);
        expect(stage.points).toBe(points);
        expect(stage.minSpeedKn).toBe(minSpeedKn);
        expect(stage.candidates).toEqual(polarWindCandidates(points, minSpeedKn, 3));
        expect(stage.candidates[0]).toEqual(estimateWindFromPolar(points, minSpeedKn));
        for (const direction of [0, 90, 211, -90, 450]) {
          expect(stage.describe(direction)).toEqual(describeWindCandidate(points, direction, minSpeedKn));
        }
        expect(stage.polar).toEqual(estimateWindPolar(points, { minSpeedKn }));
        expect(stage.sampling).toBe(polarSampling(points));
      }
    }
  });
});

describe('observeTurns', () => {
  it('relève un virage franc et cohérent', () => {
    const samples: { bearing: number; speed: number }[] = [];
    for (let t = 0; t < 20; t++) samples.push({ bearing: 45, speed: 12 });
    for (let t = 0; t <= 6; t++) samples.push({ bearing: 45 - t * 15, speed: 12 - t * 1.5 });
    for (let t = 0; t < 20; t++) samples.push({ bearing: 315, speed: 12 });

    const turns = observeTurns(buildPoints(samples));
    expect(turns).toHaveLength(1);
    expect(Math.abs(turns[0].cumulativeTurn)).toBeGreaterThanOrEqual(85);
  });

  it('écarte une chute dont le cap oscille, et tolère qu\'une chute rectiligne passe', () => {
    // Trente secondes à l'eau : vitesse nulle, cap qui oscille d'un côté à
    // l'autre. Le virage net reste petit devant la somme des rotations.
    const samples: { bearing: number; speed: number }[] = [];
    for (let t = 0; t < 20; t++) samples.push({ bearing: 45, speed: 12 });
    for (let t = 0; t < 30; t++) samples.push({ bearing: t % 2 === 0 ? 120 : 330, speed: 0.5 });
    for (let t = 0; t < 20; t++) samples.push({ bearing: 45, speed: 12 });

    const turns = observeTurns(buildPoints(samples));
    expect(turns.filter((t) => t.slow)).toHaveLength(0);
  });
});

describe('polarSampling', () => {
  const at = (stepS: number, count: number, resumeAt: number | null = null): PointData[] =>
    Array.from({ length: count }, (_, k) => ({
      lat: 43.6,
      lon: 3.8,
      timeMs: Math.round(k * stepS * 1000),
      smoothedSpeed: 12,
      bearing: 45,
      ...(resumeAt === k ? { segmentStart: true as const } : {}),
    }));

  it('vaut exactement 1 à 1 Hz comme à 5 Hz', () => {
    expect(polarSampling(at(1, 600))).toBe(1);
    expect(polarSampling(at(0.2, 3000))).toBe(1);
    // Jusqu'à la durée d'un virage, rien ne change.
    expect(polarSampling(at(5, 120))).toBe(1);
  });

  it('se rabat continûment sur une trace clairsemée : 5/17 à un point toutes les 17 s', () => {
    expect(polarSampling(at(17, 40))).toBeCloseTo(5 / 17, 10);
    expect(polarSampling(at(10, 40))).toBeCloseTo(0.5, 10);
    expect(polarSampling(at(10, 40))).toBeGreaterThan(polarSampling(at(11, 40)));
  });

  it('ne compte pas le pas de reprise de pause, et vaut 1 sans aucun pas', () => {
    // Une pause de 10 min au milieu d'une trace à 1 Hz, marquée : la trace reste dense.
    const points = [...at(1, 300), ...at(1, 300).map((p, k) => ({ ...p, timeMs: p.timeMs + 900 * 1000, ...(k === 0 ? { segmentStart: true as const } : {}) }))];
    expect(polarSampling(points)).toBe(1);
    expect(polarSampling(at(1, 1))).toBe(1);
    expect(polarSampling([])).toBe(1);
  });
});

describe('pointerWindDeg', () => {
  it('0° en haut, sens horaire, comme une boussole', () => {
    expect(pointerWindDeg(0, -10)).toBe(0);
    expect(pointerWindDeg(10, 0)).toBe(90);
    expect(pointerWindDeg(0, 10)).toBe(180);
    expect(pointerWindDeg(-10, 0)).toBe(270);
  });

  it('arrondit au degré et ne rend jamais 360', () => {
    expect(pointerWindDeg(Math.sin(0.3 * Math.PI / 180) * -1, -1)).toBe(0);
    expect(pointerWindDeg(10, -10)).toBe(45);
  });
});

describe('speedPolar', () => {
  const at = (bearing: number, speed: number): PointData => ({ lat: 0, lon: 0, timeMs: 0, smoothedSpeed: speed, bearing });

  it('range chaque point par son angle au vent, la vitesse max par case', () => {
    const polar = speedPolar([at(95, 12), at(99, 15), at(300, 20)], 90, 3);
    expect(polar).toHaveLength(36);
    expect(polar[0]).toEqual({ angle: '0°', vitesse: 15 });
    // 300 − 90 = 210° au vent.
    expect(polar[21].vitesse).toBe(20);
  });

  it('suit le vent : le tourner décale la polaire', () => {
    const track = [at(95, 12)];
    expect(speedPolar(track, 90, 3)[0].vitesse).toBe(12);
    expect(speedPolar(track, 100, 3)[35].vitesse).toBe(12);
  });

  it('écarte les points sous la vitesse minimale', () => {
    expect(speedPolar([at(95, 2)], 90, 3).every((b) => b.vitesse === 0)).toBe(true);
  });
});

describe('speedPolar au seuil accordé à la session', () => {
  it('remplit plus de cases au seuil de la session qu\'au seuil fixe du profil sur une trace lente', () => {
    // Planche lente : tous les caps balayés en dix minutes, vitesse de 1,5 à 7 nœuds selon l'angle au vent.
    const points: PointData[] = [];
    for (let t = 0; t <= 600; t++) {
      const bearing = (t * 0.6) % 360;
      const twa = Math.abs(angleDiff(bearing, 0));
      const speed = twa < 35 ? 1.5 : twa < 110 ? 7 : 4.4;
      points.push({ lat: 43.6, lon: 3.8, timeMs: t * 1000, smoothedSpeed: speed, bearing });
    }
    const profileKn = 5;
    const sessionKn = sessionManeuverThresholds('windsurf', 4.4).polarMinSpeedKn;
    expect(sessionKn).toBeLessThan(profileKn);
    const filled = (minKn: number) => speedPolar(points, 0, minKn).filter((b) => b.vitesse > 0).length;
    expect(filled(sessionKn)).toBeGreaterThan(filled(profileKn));
  });
});

describe('observeTurns et reprise de pause', () => {
  const buildTurn = (resume: boolean): PointData[] => {
    const points: PointData[] = [];
    const push = (t: number, bearing: number, segmentStart = false) =>
      points.push({ lat: 43.6, lon: 3.8, timeMs: t * 1000, smoothedSpeed: 12, bearing, ...(segmentStart ? { segmentStart: true as const } : {}) });
    for (let t = 0; t <= 60; t++) push(t, 90);
    // Un pas de 20 s, à travers lequel le cap passe de 90° à 270°.
    for (let t = 80; t <= 140; t++) push(t, 270, resume && t === 80);
    return points;
  };

  it('lit un demi-tour compressé dans un seul pas, mais jamais à travers une reprise de pause', () => {
    expect(observeTurns(buildTurn(false), 5).length).toBe(1);
    expect(observeTurns(buildTurn(true), 5).length).toBe(0);
  });
});
