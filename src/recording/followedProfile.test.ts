import { describe, expect, it } from 'vitest';
import { accumulateElevation } from '../core/elevation';
import { ELEVATION_PRESETS } from '../core/sportProfiles';
import { at } from '../test/geo.fixture';
import { followedAltitudeAt, followedProfile, followedRowIndex, hasFollowedElevation, remainingGainM } from './followedProfile';
import { followedTraceFromPoints, followedTraceLengthM, type FollowedPoint, type FollowedTrace } from './followedTrace';

const MIN_GAIN = ELEVATION_PRESETS.route.minGainM;

/** Route vers le nord : (distance en mètres, altitude). */
const road = (rows: [number, number | undefined][]): FollowedTrace => followedTraceFromPoints(
  rows.map(([d, eleM]): FollowedPoint => (eleM !== undefined ? { ...at(0, d), eleM } : at(0, d))), 'Bosses', 'route'
)!;

/** Deux bosses connues : 100 → 150 → 120 → 170 → 100, sur 2 km. */
const hills = road([[0, 100], [500, 150], [1000, 120], [1500, 170], [2000, 100]]);
const TOTAL_GAIN = 50 + 50;

describe('hasFollowedElevation', () => {
  it('oui avec deux altitudes à la suite', () => {
    expect(hasFollowedElevation(hills)).toBe(true);
  });

  it('non sans altitude, avec une seule, ou deux séparées par un trou', () => {
    expect(hasFollowedElevation(road([[0, undefined], [500, undefined]]))).toBe(false);
    expect(hasFollowedElevation(road([[0, 100], [500, undefined]]))).toBe(false);
    expect(hasFollowedElevation(road([[0, 100], [500, undefined], [1000, 120]]))).toBe(false);
  });
});

describe('followedProfile', () => {
  it('sa dernière ligne tombe à la longueur que mesure le suivi', () => {
    const { rows, cumM } = followedProfile(hills);
    expect(rows[rows.length - 1].distM).toBe(followedTraceLengthM(hills));
    expect(cumM[cumM.length - 1]).toBe(followedTraceLengthM(hills));
  });

  it('une ligne tous les 10 m, chacune avec sa position, son altitude et sa pente', () => {
    const { rows } = followedProfile(hills);
    expect(rows[1].distM).toBe(10);
    expect(rows[50].eleM).toBeCloseTo(150, 0);
    expect(rows[20].grade).toBeCloseTo(0.1, 1);
    expect(rows[50].lat).toBeCloseTo(at(0, 500).lat, 4);
  });

  it('est calculé une fois par trace', () => {
    expect(followedProfile(hills)).toBe(followedProfile(hills));
    const other = { ...hills };
    expect(followedProfile(other)).not.toBe(followedProfile(hills));
  });
});

describe('followedRowIndex', () => {
  const { rows } = followedProfile(hills);

  it('rend la ligne la plus proche', () => {
    expect(followedRowIndex(rows, 0)).toBe(0);
    expect(followedRowIndex(rows, 14)).toBe(1);
    expect(followedRowIndex(rows, 16)).toBe(2);
  });

  it('reste dans le profil, dernière ligne comprise', () => {
    expect(followedRowIndex(rows, -5)).toBe(0);
    expect(followedRowIndex(rows, followedTraceLengthM(hills))).toBe(rows.length - 1);
    expect(followedRowIndex(rows, 1e7)).toBe(rows.length - 1);
    expect(followedRowIndex([], 10)).toBe(0);
  });

  it('atteint la dernière ligne, plus courte que le pas', () => {
    const short = road([[0, 100], [1004, 110]]);
    const shortRows = followedProfile(short).rows;
    const lengthM = followedTraceLengthM(short);
    expect(followedRowIndex(shortRows, lengthM - 1)).toBe(shortRows.length - 1);
  });
});

describe('followedAltitudeAt', () => {
  it('interpole entre deux points, et s\'arrête aux bouts', () => {
    const lengthM = followedTraceLengthM(hills);
    expect(followedAltitudeAt(hills, lengthM / 8)).toBeCloseTo(125, 3);
    expect(followedAltitudeAt(hills, lengthM / 4)).toBeCloseTo(150, 3);
    expect(followedAltitudeAt(hills, 0)).toBe(100);
    expect(followedAltitudeAt(hills, -10)).toBe(100);
    expect(followedAltitudeAt(hills, lengthM + 10)).toBe(100);
  });

  it('`null` dans un trou d\'altitude', () => {
    const gappy = road([[0, 100], [500, undefined], [1000, 120], [1500, 130]]);
    expect(followedAltitudeAt(gappy, 250)).toBeNull();
    expect(followedAltitudeAt(gappy, 750)).toBeNull();
    expect(followedAltitudeAt(gappy, 1250)).toBeCloseTo(125, 0);
  });
});

describe('remainingGainM', () => {
  it('au départ, le dénivelé de toute la trace', () => {
    const whole = accumulateElevation(hills.points.map((p) => p.eleM ?? NaN), MIN_GAIN).gainM;
    expect(whole).toBe(TOTAL_GAIN);
    expect(remainingGainM(hills, 0, MIN_GAIN)).toBe(whole);
  });

  it('décroît le long de la trace, à partir de l\'altitude du moment', () => {
    const lengthM = followedTraceLengthM(hills);
    // Mi-première montée : 25 m de cette montée, puis les 50 m de la seconde.
    expect(remainingGainM(hills, lengthM / 8, MIN_GAIN)).toBeCloseTo(75, 3);
    // Au premier sommet : la seconde montée seule.
    expect(remainingGainM(hills, lengthM / 4, MIN_GAIN)).toBeCloseTo(50, 3);
    // Après le second sommet : plus rien à monter.
    expect(remainingGainM(hills, (lengthM * 3) / 4 + 10, MIN_GAIN)).toBe(0);
  });

  it('0 à l\'arrivée, et au-delà', () => {
    const lengthM = followedTraceLengthM(hills);
    expect(remainingGainM(hills, lengthM, MIN_GAIN)).toBe(0);
    expect(remainingGainM(hills, lengthM + 50, MIN_GAIN)).toBe(0);
  });

  it('saute les trous d\'altitude', () => {
    const gappy = road([[0, 100], [500, 150], [1000, undefined], [1500, 180], [2000, 200]]);
    expect(remainingGainM(gappy, 0, MIN_GAIN)).toBe(100);
    // Dans le trou : pas d'altitude du moment, le reste part du point suivant qui en a une.
    expect(remainingGainM(gappy, 750, MIN_GAIN)).toBe(20);
  });

  it('0 sans altitude du tout', () => {
    expect(remainingGainM(road([[0, undefined], [500, undefined]]), 0, MIN_GAIN)).toBe(0);
  });
});
