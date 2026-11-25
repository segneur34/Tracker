import { describe, expect, it } from 'vitest';
import { angleDiff } from '../core/angles';
import { computeKinematics } from '../core/kinematics';
import type { ActiveRun } from '../core/sessionStats';
import { SPORT_PROFILES } from '../core/sportProfiles';
import type { RawTrackPoint, TrackPoint } from '../core/types';
import { M_PER_DEG_LAT } from '../test/geo.fixture';
import { alignedWaveSense, enteredWaveSense, estimateWaveSense, isAgainstWaveSense, type WaveSense } from './waveSense';

/** Seuils du profil du surf. */
const WS = SPORT_PROFILES.surf.surf!.waveSense;
const PZ = SPORT_PROFILES.surf.surf!.peakZone;

const T0 = Date.UTC(2026, 9, 10, 9, 0, 0);

/** Jambe à vitesse et cap constants ; `wave`, elle fait partie d'une vague (des jambes de vague qui se suivent en font une seule) ; `sparse`, un seul pas. */
interface Leg {
  s: number;
  speed: number;
  heading: number;
  wave?: boolean;
  sparse?: boolean;
}

/** Trace par jambes, à la cadence donnée, et les bornes de ses vagues, en indices de points. */
const build = (legs: Leg[], cadenceS: number): { track: TrackPoint[]; waves: ActiveRun[] } => {
  const raw: RawTrackPoint[] = [];
  let lat = 43.4;
  let lon = 3.6;
  let t = 0;
  const marks: [number, number][] = [];
  let inWave = false;
  raw.push({ lat, lon, time: new Date(T0) });
  for (const leg of legs) {
    const from = t;
    const steps = leg.sparse ? 1 : Math.max(1, Math.round(leg.s / cadenceS));
    const dt = leg.s / steps;
    for (let k = 0; k < steps; k++) {
      const d = leg.speed * dt;
      lat += (d * Math.cos((leg.heading * Math.PI) / 180)) / M_PER_DEG_LAT;
      lon += (d * Math.sin((leg.heading * Math.PI) / 180)) / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
      t += dt;
      raw.push({ lat, lon, time: new Date(T0 + Math.round(t * 1000)), speedMs: leg.speed, courseDeg: leg.heading });
    }
    if (leg.wave && inWave) marks[marks.length - 1][1] = t;
    else if (leg.wave) marks.push([from, t]);
    inWave = leg.wave === true;
  }
  const profile = SPORT_PROFILES.surf;
  const track = computeKinematics(raw, { medianWindowSeconds: profile.medianWindowSeconds, maxSpeedMs: profile.maxPlausibleSpeedMs });
  const indexAt = (s: number) => track.findIndex((p) => Math.abs(p.timeMs - T0 - Math.round(s * 1000)) <= 1);
  return { track, waves: marks.map(([a, b]) => ({ start: indexAt(a), end: indexAt(b) })) };
};

/** Une rame vers le large (le nord), une attente, puis la vague, pour chaque cap donné. */
const session = (waves: { heading: number; speed?: number; sparse?: boolean }[]): Leg[] =>
  waves.flatMap((w) => [
    { s: 40, speed: 1, heading: 0 },
    { s: 20, speed: 0.1, heading: 0 },
    { s: 12, speed: w.speed ?? 5, heading: w.heading, wave: true, sparse: w.sparse },
  ]);

/** Gauches et droites mêlées, à 45 et 50° de part et d'autre du sud, à des vitesses diverses. */
const MIXED = [
  { heading: 130, speed: 5 }, { heading: 230, speed: 6 }, { heading: 135, speed: 5 },
  { heading: 225, speed: 5.5 }, { heading: 130, speed: 6 }, { heading: 230, speed: 5 },
];

describe('estimateWaveSense', () => {
  it('trouve le sens des gauches et des droites mêlées, à 1 Hz, à 5 Hz et à un pas de 4 s', () => {
    const senses = [1, 0.2, 4].map((cadenceS) => {
      const { track, waves } = build(session(MIXED), cadenceS);
      expect(waves).toHaveLength(6);
      return estimateWaveSense(track, waves, WS)!;
    });
    for (const sense of senses) {
      expect(Math.abs(angleDiff(sense.directionDeg, 180))).toBeLessThan(5);
      expect(sense.R).toBeGreaterThan(WS.minR);
      expect(sense.R).toBeLessThan(0.8);
      expect(sense.samples).toBe(6);
    }
    expect(Math.abs(angleDiff(senses[1].directionDeg, senses[0].directionDeg))).toBeLessThan(1);
  });

  it('mesure une vague compressée en un seul pas, position interpolée dans le temps', () => {
    const { track, waves } = build(session(MIXED.map((w) => ({ ...w, sparse: true }))), 1);
    expect(waves.every((w) => w.end === w.start + 1)).toBe(true);
    expect(Math.abs(angleDiff(estimateWaveSense(track, waves, WS)!.directionDeg, 180))).toBeLessThan(5);
  });

  it('ne regarde que la descente : une vague qui tourne après la fenêtre garde le cap de son départ', () => {
    const legs = [0, 1, 2, 3].flatMap((): Leg[] => [
      { s: 40, speed: 1, heading: 0 },
      { s: 20, speed: 0.1, heading: 0 },
      { s: 5, speed: 5, heading: 180, wave: true },
      { s: 10, speed: 6, heading: 90, wave: true },
    ]);
    const { track, waves } = build(legs, 1);
    const sense = estimateWaveSense(track, waves, WS)!;
    expect(Math.abs(angleDiff(sense.directionDeg, 180))).toBeLessThan(1);
    expect(sense.R).toBeGreaterThan(0.99);
  });

  it('pondère chaque vague par la longueur de sa descente, sans en écarter', () => {
    const { track, waves } = build(session([
      { heading: 170, speed: 6 }, { heading: 190, speed: 2 }, { heading: 170, speed: 6 }, { heading: 190, speed: 2 },
    ]), 1);
    const sense = estimateWaveSense(track, waves, WS)!;
    // Moyenne pondérée : 175° ; sans pondération, 180°.
    expect(sense.directionDeg).toBeGreaterThan(173);
    expect(sense.directionDeg).toBeLessThan(177);
    expect(sense.samples).toBe(4);
  });

  it('n\'est pas fiable sur trois vagues, ni sur des vagues parties dans tous les sens, et reste rendu', () => {
    const three = build(session(MIXED.slice(0, 3)), 1);
    expect(estimateWaveSense(three.track, three.waves, WS)!.reliable).toBe(false);
    expect(estimateWaveSense(three.track, three.waves, { ...WS, minWaves: 3 })!.reliable).toBe(true);
    const spread = build(session([{ heading: 0 }, { heading: 90 }, { heading: 180 }, { heading: 270 }]), 1);
    expect(estimateWaveSense(spread.track, spread.waves, WS)!.reliable).toBe(false);
  });

  it('ne rend rien sans aucune mesure', () => {
    const { track } = build(session(MIXED.slice(0, 1)), 1);
    expect(estimateWaveSense(track, [], WS)).toBeNull();
  });

  it('dit qu\'il est estimé', () => {
    const { track, waves } = build(session(MIXED), 1);
    expect(estimateWaveSense(track, waves, WS)!.source).toBe('estime');
  });
});

describe('enteredWaveSense', () => {
  it('un sens saisi est fiable, sans mesure, ramené dans le tour', () => {
    expect(enteredWaveSense(200)).toEqual({ directionDeg: 200, R: 1, samples: 0, reliable: true, source: 'saisi' });
    expect(enteredWaveSense(-90).directionDeg).toBe(270);
    expect(enteredWaveSense(450).directionDeg).toBe(90);
  });
});

describe('alignedWaveSense', () => {
  // Départs sur une ligne est-ouest, tous les 40 m.
  const { track } = build([{ s: 120, speed: 1, heading: 90 }], 1);
  const departures = [0, 40, 80, 120];
  const measured = (directionDeg: number, R = 0.9): WaveSense => ({ directionDeg, R, samples: 5, reliable: true, source: 'estime' });

  it('ramène un sens en biais sur la perpendiculaire à la ligne, de son côté, sans toucher au reste', () => {
    expect(alignedWaveSense(track, departures, measured(210), WS, PZ)!.directionDeg).toBeCloseTo(180, 6);
    expect(alignedWaveSense(track, departures, measured(150), WS, PZ)!.directionDeg).toBeCloseTo(180, 6);
    expect(alignedWaveSense(track, departures, measured(330), WS, PZ)!.directionDeg).toBeCloseTo(0, 6);
    expect({ ...alignedWaveSense(track, departures, measured(210), WS, PZ)!, directionDeg: 0 }).toEqual({ ...measured(210), directionDeg: 0 });
  });

  it('laisse un sens trop proche de la ligne, saisi, trop peu concentré, absent, ou si on le demande', () => {
    expect(alignedWaveSense(track, departures, measured(240), WS, PZ)).toEqual(measured(240));
    expect(alignedWaveSense(track, departures, enteredWaveSense(210), WS, PZ)).toEqual(enteredWaveSense(210));
    expect(alignedWaveSense(track, departures, measured(210, WS.minR - 0.01), WS, PZ)).toEqual(measured(210, WS.minR - 0.01));
    expect(alignedWaveSense(track, departures, null, WS, PZ)).toBeNull();
    expect(alignedWaveSense(track, departures, measured(210), WS, PZ, false)).toEqual(measured(210));
  });

  it('demande trois départs : deux font toujours une ligne, sans rien prouver', () => {
    expect(WS.lineMinDepartures).toBe(3);
    expect(alignedWaveSense(track, [0, 120], measured(210), WS, PZ)).toEqual(measured(210));
    expect(alignedWaveSense(track, [0, 60, 120], measured(210), WS, PZ)!.directionDeg).toBeCloseTo(180, 6);
    expect(alignedWaveSense(track, [0, 120], measured(210), { ...WS, lineMinDepartures: 2 }, PZ)!.directionDeg).toBeCloseTo(180, 6);
  });
});

describe('isAgainstWaveSense', () => {
  const sense: WaveSense = { directionDeg: 180, R: 1, samples: 4, reliable: true, source: 'estime' };
  const { track, waves } = build(session([{ heading: 0 }, { heading: 100 }, { heading: 260 }, { heading: 180 }]), 1);

  it('reconnaît un passage vers le large, et garde une vague prise en biais', () => {
    expect(waves.map((w) => isAgainstWaveSense(track, w, sense, WS.againstDeg))).toEqual([true, false, false, false]);
  });

  it('suit l\'angle donné en option', () => {
    expect(isAgainstWaveSense(track, waves[1], sense, 60)).toBe(true);
  });

  it('ne juge pas un passage revenu à son point de départ', () => {
    expect(isAgainstWaveSense(track, { start: waves[0].start, end: waves[0].start }, sense, WS.againstDeg)).toBe(false);
  });
});
