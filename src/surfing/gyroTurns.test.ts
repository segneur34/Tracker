import { describe, expect, it } from 'vitest';
import { synthImu, SYNTH_WALL_MS, type SynthMotion } from '../core/imuSynthetic.fixture';
import { computeKinematics } from '../core/kinematics';
import { buildCumulativeTrack } from '../core/sessionStats';
import { SPORT_PROFILES } from '../core/sportProfiles';
import type { RawTrackPoint } from '../core/types';
import { M_PER_DEG_LAT } from '../test/geo.fixture';
import { gyroWaveTurns } from './gyroTurns';
import { runSurfSession, surfProfileOf } from './surfSession';

const profile = surfProfileOf(SPORT_PROFILES.surf)!;
const D = profile.surf.gyroTurns;
const RAD = Math.PI / 180;

/**
 * Séance synthétique, alignée sur la capture (`SYNTH_WALL_MS`) : attente,
 * rame, une vague de 10 s (30 à 40 s), rame de retour, attente ; une seconde
 * vague de 80 à 90 s si `second`. Vitesses en m/s, cap constant au nord.
 */
const session = (cadenceS: number, second = false) => {
  const phases: [number, number][] = [[20, 0], [10, 1.2], [10, 5], [20, 1.2], [20, 0]];
  if (second) phases.push([10, 5], [20, 0]);
  const raw: RawTrackPoint[] = [];
  let lat = 43.4;
  let t = 0;
  raw.push({ lat, lon: 3.6, time: new Date(SYNTH_WALL_MS), speedMs: 0 });
  for (const [s, speed] of phases) {
    const steps = Math.round(s / cadenceS);
    for (let k = 0; k < steps; k++) {
      t += cadenceS;
      lat += (speed * cadenceS) / M_PER_DEG_LAT;
      raw.push({ lat, lon: 3.6, time: new Date(SYNTH_WALL_MS + Math.round(t * 1000)), speedMs: speed, ...(speed > 0 ? { courseDeg: 0 } : {}) });
    }
  }
  const track = computeKinematics(raw, { medianWindowSeconds: profile.medianWindowSeconds, maxSpeedMs: profile.maxPlausibleSpeedMs });
  return runSurfSession(track, buildCumulativeTrack(track), profile, { threshold: profile.defaultActiveThreshold, foil: false, waveThreshold: null }).analysis.waves;
};

/** Cap du buste (rad) : des virages `[instant de début (s), angle (°), vitesse (°/s)]`, en plus d'une dérive en °/s. */
const yawOf = (turns: [number, number, number][], driftDegS = 0) => (t: number) => {
  let deg = driftDegS * t;
  for (const [at, angle, rate] of turns) {
    const len = Math.abs(angle) / rate;
    deg += angle * Math.min(1, Math.max(0, (t - at) / len));
  }
  return deg * RAD;
};

/** Trois virages de 90° à 120°/s, alternés, dans la vague de 30 à 40 s. */
const THREE: [number, number, number][] = [[32, 90, 120], [35, -90, 120], [38, 90, 120]];

const capture = (m: Partial<SynthMotion> & { yaw: (t: number) => number }) => synthImu({ durationS: 80, az: () => 0, tilt: () => 0, ...m });

describe('gyroWaveTurns', () => {
  it('la séance synthétique a bien une vague, de 30 à 40 s environ', () => {
    const waves = session(1);
    expect(waves).toHaveLength(1);
    expect(waves[0].startMs - SYNTH_WALL_MS).toBeLessThan(32_000);
    expect(waves[0].endMs - SYNTH_WALL_MS).toBeGreaterThan(39_000);
  });

  it('compte trois virages de 90° à 120°/s', () => {
    expect(gyroWaveTurns(capture({ yaw: yawOf(THREE) }), D, session(1))).toEqual([3]);
  });

  it('une dérive lente de 2°/s sur toute la vague n\'ajoute aucun virage', () => {
    expect(gyroWaveTurns(capture({ yaw: yawOf(THREE, 2) }), D, session(1))).toEqual([3]);
    expect(gyroWaveTurns(capture({ yaw: yawOf([], 2) }), D, session(1))).toEqual([0]);
  });

  it('une rotation lente, sous la vitesse minimale, n\'est pas un virage', () => {
    // 90° à 20°/s : 4,5 s pour tourner, le buste ne vire pas.
    expect(gyroWaveTurns(capture({ yaw: yawOf([[32, 90, 20]]) }), D, session(1))).toEqual([0]);
  });

  it('une dérive secouée par le buste (rame, pumping) n\'est pas un virage, malgré ses pointes de vitesse', () => {
    // 90° en 9 s, et le buste qui oscille de ±15° une fois par seconde (pointes près de 100°/s) : séance témoin du 14/10.
    const shaken = (t: number) => yawOf([[30.5, 90, 10]])(t) + 15 * RAD * Math.sin(2 * Math.PI * t);
    expect(gyroWaveTurns(capture({ yaw: shaken }), D, session(1))).toEqual([0]);
  });

  it('un virage vif après un palier qui dérive en sens contraire compte', () => {
    // Le cap revient de 10° en 5 s, puis tourne de 90° à 120°/s : l'extrême d'où part le virage est 5 s plus tôt.
    expect(gyroWaveTurns(capture({ yaw: yawOf([[31, -10, 2], [36, 90, 120]]) }), D, session(1))).toEqual([1]);
  });

  it.each([30, 60, 85])('un virage, téléphone penché de %i° : un virage (la projection sur la verticale tient)', (deg) => {
    expect(gyroWaveTurns(capture({ yaw: yawOf([[34, 120, 120]]), tilt: () => deg * RAD }), D, session(1))).toEqual([1]);
  });

  it('tient avec la force centripète du virage, téléphone penché', () => {
    const yaw = yawOf(THREE);
    // À 5 m/s, la force vers l'intérieur du virage vaut v·ψ' (près de 1 g à 120°/s).
    const ay = (t: number) => 5 * (yaw(t + 0.0005) - yaw(t - 0.0005)) / 0.001;
    expect(gyroWaveTurns(capture({ yaw, ay, tilt: () => 30 * RAD }), D, session(1))).toEqual([3]);
  });

  it('mêmes virages avec une capture à 50 et 200 Hz et une trace à 1 et 5 Hz', () => {
    for (const rateHz of [50, 200]) {
      const rec = capture({ yaw: yawOf(THREE), rateHz });
      for (const cadenceS of [1, 0.2]) expect(gyroWaveTurns(rec, D, session(cadenceS))).toEqual([3]);
    }
  });

  it('une vague que la capture ne couvre pas en entier garde ses virages GPS (null)', () => {
    const waves = session(1, true);
    expect(waves).toHaveLength(2);
    // Capture arrêtée à 85 s : la seconde vague (80 à 90 s) n'est couverte qu'en partie.
    const rec = synthImu({ durationS: 85, az: () => 0, tilt: () => 0, yaw: yawOf(THREE) });
    expect(gyroWaveTurns(rec, D, waves)).toEqual([3, null]);
    // Capture élaguée dont les fenêtres évitent la première vague.
    const pruned = { ...rec, header: { ...rec.header, windows: [[50e6, 85e6]] as [number, number][] } };
    expect(gyroWaveTurns(pruned, D, waves)).toEqual([null, null]);
  });

  it('témoin à plat, sans vague : rien, et rien ne plante', () => {
    const rec = synthImu({ durationS: 60, az: () => 0, noise: 0.3 });
    expect(gyroWaveTurns(rec, D, [])).toEqual([]);
    // Une « vague » sur une capture immobile : aucun virage.
    expect(gyroWaveTurns(rec, D, [{ startMs: SYNTH_WALL_MS + 20_000, endMs: SYNTH_WALL_MS + 30_000 }])).toEqual([0]);
    // Vague vide ou à l'envers : pas de calcul.
    expect(gyroWaveTurns(rec, D, [{ startMs: SYNTH_WALL_MS + 20_000, endMs: SYNTH_WALL_MS + 20_000 }])).toEqual([null]);
  });
});
