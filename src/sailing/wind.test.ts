import { describe, expect, it } from 'vitest';
import type { PointData } from '../utils/kinematics';
import {
  angleDiff,
  circularMean,
  circularStats,
  describeWindCandidate,
  estimateWindFromPolar,
  interpolateDirection,
  observeTurns,
  scoreWindCandidate,
} from './wind';

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
    time: new Date(start + i * 1000).toISOString(),
    timeMs: start + i * 1000,
    speed: s.speed,
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
