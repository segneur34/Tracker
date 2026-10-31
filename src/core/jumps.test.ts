import { describe, expect, it } from 'vitest';
import { decodeImu, encodeImu, selectImuWindows, type ImuRecording } from './imuFile';
import { SYNTH_WALL_MS, synthImu as record, type SynthMotion as Motion } from './imuSynthetic.fixture';
import { pruneImuFile } from './imuPrune';
import { jumpCurveRows, jumpDoubtLabel, jumpTrackSpan, measureJumps, pruneWindows, type MeasuredJump, type SessionJump } from './jumps';
import { SPORT_PROFILES } from './sportProfiles';
import { nearestIndexAtTime as trackIndexAtTime } from './search';

const G = 9.80665;
const D = SPORT_PROFILES.wingfoil.jumps!.detection;
const WALL_MS = SYNTH_WALL_MS;

/**
 * Un saut : poussée pendant `pushS` jusqu'à la vitesse verticale `v0`, vol
 * de `flightS` à l'accélération verticale `−fall` (g sans portance),
 * atterrissage qui annule la vitesse en `landS`. Rend l'accélération
 * verticale à l'instant t, 0 hors du saut.
 */
const jump = (takeoffS: number, v0: number, fall = G, pushS = 0.3, landS = 0.3) => {
  const flightS = (2 * v0) / fall;
  return {
    flightS,
    heightM: (v0 * v0) / (2 * fall),
    az: (t: number) => {
      if (t >= takeoffS - pushS && t < takeoffS) return v0 / pushS;
      if (t >= takeoffS && t < takeoffS + flightS) return -fall;
      if (t >= takeoffS + flightS && t < takeoffS + flightS + landS) return v0 / landS;
      return 0;
    },
  };
};

/** Clapot : quelques sinus de 2 à 4 Hz, 0,3 g au plus. */
const chop = (t: number) => 0.15 * G * Math.sin(2 * Math.PI * 2.3 * t) + 0.1 * G * Math.sin(2 * Math.PI * 3.7 * t + 1) + 0.05 * G * Math.sin(2 * Math.PI * 1.1 * t + 2);

/** Sauts d'une capture ; la distance cumulée de la trace est intégrée pas à pas, comme `buildCumulativeTrack`. */
const jumpsOf = (rec: ImuRecording, track: { timeMs: number; smoothedSpeedMs: number; stepM?: number }[] = []): MeasuredJump[] => {
  const cumDist = [0];
  for (let i = 1; i < track.length; i++) {
    cumDist.push(cumDist[i - 1] + (track[i].stepM ?? (track[i].smoothedSpeedMs * (track[i].timeMs - track[i - 1].timeMs)) / 1000));
  }
  return measureJumps(rec, D, track, cumDist).jumps;
};

describe('sauts : hauteur', () => {
  it('mesure un vol libre de 2 m, téléphone penché de 30°, à g·T²/8 près', () => {
    const j = jump(30, Math.sqrt(2 * G * 2));
    const jumps = jumpsOf(record({ durationS: 60, az: (t) => j.az(t) + chop(t) * 0.3 }));
    expect(jumps).toHaveLength(1);
    expect(jumps[0].heightM).toBeCloseTo(2, 1);
    expect(Math.abs(jumps[0].heightM - 2)).toBeLessThan(0.05);
    expect(Math.abs(jumps[0].flightS - j.flightS)).toBeLessThan(0.05);
    expect(Math.abs(jumps[0].heightM - (G * jumps[0].flightS ** 2) / 8)).toBeLessThan(0.08);
    expect(jumps[0].doubts).toEqual([]);
  });

  it('mesure un vol porté par l\'aile sous la borne de la parabole', () => {
    // Portance verticale de 0,5 g et traction horizontale de 0,3 g en vol, 0,2 g de traction en navigation.
    const j = jump(30, 3.5, 0.5 * G);
    const inFlight = (t: number) => t >= 30 && t < 30 + j.flightS;
    const jumps = jumpsOf(record({ durationS: 60, az: j.az, ay: (t) => (inFlight(t) ? 0.3 * G : 0.2 * G) }));
    expect(jumps).toHaveLength(1);
    expect(Math.abs(jumps[0].heightM - j.heightM)).toBeLessThan(0.07);
    expect(jumps[0].heightM).toBeLessThan((G * jumps[0].flightS ** 2) / 8);
    expect(jumps[0].doubts).toEqual([]);
  });

  it('donne le même saut à 50, 100 et 200 Hz', () => {
    const j = jump(30, 4);
    const at = (rateHz: number) => jumpsOf(record({ durationS: 60, rateHz, az: (t) => j.az(t) + chop(t) * 0.3 }));
    const [a, b, c] = [at(50), at(100), at(200)];
    for (const r of [a, b, c]) expect(r).toHaveLength(1);
    expect(Math.abs(a[0].heightM - b[0].heightM)).toBeLessThan(0.03);
    expect(Math.abs(c[0].heightM - b[0].heightM)).toBeLessThan(0.03);
    expect(Math.abs(a[0].flightS - b[0].flightS)).toBeLessThan(0.03);
  });

  it('suit une rotation complète pendant un vol porté (360°/s, backloop)', () => {
    const j = jump(30, 3.5, 0.5 * G);
    const inFlight = (t: number) => t >= 30 && t < 30 + j.flightS;
    const tilt = (t: number) => Math.PI / 6 + (t < 30 ? 0 : t < 30 + j.flightS ? (2 * Math.PI * (t - 30)) / j.flightS : 2 * Math.PI);
    const jumps = jumpsOf(record({ durationS: 60, az: j.az, ay: (t) => (inFlight(t) ? 0.3 * G : 0.2 * G), tilt }));
    expect(jumps).toHaveLength(1);
    expect(Math.abs(jumps[0].heightM - j.heightM)).toBeLessThan(0.1);
  });

  it('résiste au biais, à l\'erreur d\'échelle et à la dérive du gyroscope', () => {
    const j = jump(30, Math.sqrt(2 * G * 1.5));
    const jumps = jumpsOf(record({
      durationS: 60, az: (t) => j.az(t) + chop(t) * 0.3, bias: 0.2, scale: 0.01, gyroDrift: (0.1 * Math.PI) / 180, gaps: [[10, 10.3]],
    }));
    expect(jumps).toHaveLength(1);
    expect(Math.abs(jumps[0].heightM - 1.5)).toBeLessThan(0.1);
    expect(jumps[0].doubts).toEqual([]);
  });

  it('rend la courbe du saut calée sur le décollage, au sommet à mi-vol', () => {
    const j = jump(30, Math.sqrt(2 * G * 1));
    const [only] = jumpsOf(record({ durationS: 60, az: j.az }));
    const { stepS, startS, heightsM } = only.curve;
    expect(stepS).toBeCloseTo(0.05, 6);
    expect(startS).toBeLessThan(0);
    expect(Math.abs(Math.round(startS / stepS) * stepS - startS)).toBeLessThan(1e-9);
    const top = heightsM.indexOf(Math.max(...heightsM));
    expect(Math.abs(startS + top * stepS - only.flightS / 2)).toBeLessThan(0.1);
    expect(Math.max(...heightsM)).toBeCloseTo(only.heightM, 1);
  });
});

describe('sauts : ce qui n\'en est pas', () => {
  it('ne trouve rien dans 10 min de clapot', () => {
    const rec = record({ durationS: 600, az: chop, noise: 0.3 });
    expect(jumpsOf(rec)).toEqual([]);
    expect(pruneWindows(rec, D)).toEqual([]);
  });

  it('ne trouve rien dans une houle de 1,5 m à 8 s', () => {
    const swell = (t: number) => -0.75 * (2 * Math.PI / 8) ** 2 * Math.sin((2 * Math.PI * t) / 8);
    expect(jumpsOf(record({ durationS: 300, az: (t) => swell(t) + chop(t) * 0.5 }))).toEqual([]);
  });

  it('ne range aucun pompage sur foil (1,5 Hz, ±1,4 m/s)', () => {
    const w = 2 * Math.PI * 1.5;
    const amplitude = 1.4 / w;
    const rec = record({ durationS: 120, az: (t) => -amplitude * w * w * Math.sin(w * t), ay: () => 0.2 * G });
    expect(jumpsOf(rec)).toEqual([]);
    expect(pruneWindows(rec, D)).toEqual([]);
  });
});

describe('sauts : mesures douteuses', () => {
  it('marque un capteur saturé pendant la poussée', () => {
    const j = jump(30, Math.sqrt(2 * G * 1.5), G, 0.05);
    const [only] = jumpsOf(record({ durationS: 60, az: j.az, accelRange: 78.45 }));
    expect(only.doubts).toContain('saturation');
  });

  it('marque un trou dans les mesures autour du vol', () => {
    const j = jump(30, Math.sqrt(2 * G * 1.5));
    const [only] = jumpsOf(record({ durationS: 60, az: j.az, gaps: [[31.5, 31.6]] }));
    expect(only.doubts).toContain('trou');
  });

  it('marque une hauteur au-delà de la parabole (aile qui tire vers le bas)', () => {
    const j = jump(30, 4, 1.3 * G);
    const [only] = jumpsOf(record({ durationS: 60, az: j.az }));
    expect(only.doubts).toContain('parabole');
  });
});

describe('sauts : élagage et trace', () => {
  // Trois sauts, dont un à 5 s du début et deux à 20 s l'un de l'autre.
  const jumps = [jump(5, 4), jump(200, 5), jump(220, 3.5)];
  const motion: Motion = { durationS: 400, az: (t) => jumps.reduce((s, j) => s + j.az(t), 0) + chop(t) * 0.3 };
  // Construit une fois pour les tests du bloc, qui ne font que le lire.
  let recorded: ImuRecording | null = null;
  const recording = (): ImuRecording => (recorded ??= record(motion));

  it('garde chaque saut dans une fenêtre, fenêtres fusionnées et rognées au début', () => {
    const rec = recording();
    const windows = pruneWindows(rec, D);
    expect(windows).toHaveLength(2);
    expect(windows[0][0]).toBe(0);
    expect(windows[1][0]).toBeLessThan(200e6 - 14e6);
    expect(windows[1][1]).toBeGreaterThan(220e6 + 14e6);
    const kept = windows.reduce((s, [a, b]) => s + b - a, 0) / 400e6;
    expect(kept).toBeLessThan(0.3);
  });

  it('donne les mêmes sauts depuis la séance entière et depuis le fichier élagué', async () => {
    const rec = recording();
    const whole = jumpsOf(rec);
    expect(whole).toHaveLength(3);
    const selected = selectImuWindows(rec, pruneWindows(rec, D));
    const pruned = (await decodeImu(await encodeImu(selected.header, selected.series, 1, true)))!;
    expect(pruned.header.windows).toHaveLength(2);
    expect(pruned.series[0].t.length).toBeLessThan(rec.series[0].t.length / 2);
    const fromPruned = jumpsOf(pruned);
    expect(fromPruned).toHaveLength(3);
    fromPruned.forEach((j, k) => {
      expect(Math.abs(j.heightM - whole[k].heightM)).toBeLessThan(0.005);
      expect(Math.abs(j.takeoffMs - whole[k].takeoffMs)).toBeLessThan(1);
    });
  });

  it('tire la vitesse au décollage et la longueur de la trace', () => {
    const track = Array.from({ length: 401 }, (_, s) => ({ timeMs: WALL_MS + s * 1000, smoothedSpeedMs: 8 }));
    const [first] = jumpsOf(recording(), track);
    expect(first.speedMs).toBeCloseTo(8, 6);
    expect(first.lengthM).toBeCloseTo(8 * first.flightS, 3);
    expect(jumpsOf(recording())[0].speedMs).toBeNull();
  });

  for (const hz of [1, 5]) {
    it(`à ${hz} Hz : vitesse lissée au décollage, longueur par la distance cumulée de la trace (Q41, lot 81)`, () => {
      // Vitesse lissée de 6 à 10 m/s en rampe : celle du décollage, interpolée.
      const n = 400 * hz;
      const at = (k: number) => 6 + (4 * k) / n;
      const track = Array.from({ length: n + 1 }, (_, k) => ({ timeMs: WALL_MS + (k * 1000) / hz, smoothedSpeedMs: at(k), speedMs: 99 }));
      const [first] = jumpsOf(recording(), track);
      const kAt = ((first.takeoffMs - WALL_MS) / 1000) * hz;
      expect(first.speedMs).toBeCloseTo(at(kAt), 6);
      // La longueur est l'écart des distances cumulées aux deux bouts : ni plus, ni moins.
      const cum = (ms: number) => {
        const k = ((ms - WALL_MS) / 1000) * hz;
        const k0 = Math.floor(k);
        let d = 0;
        for (let j = 1; j <= k0; j++) d += at(j) / hz;
        return d + (k - k0) * (at(k0 + 1) / hz);
      };
      expect(first.lengthM).toBeCloseTo(cum(first.landingMs) - cum(first.takeoffMs), 6);
    });
  }

  it('une pause de la trace pendant le vol ne compte rien, un trou compte sa distance bornée', () => {
    const base = Array.from({ length: 401 }, (_, s) => ({ timeMs: WALL_MS + s * 1000, smoothedSpeedMs: 8 }));
    const [ref] = jumpsOf(recording(), base);
    const step = Math.floor((ref.takeoffMs - WALL_MS) / 1000) + 1;
    const paused = base.map((p, s) => (s === step ? { ...p, stepM: 0 } : p));
    const [withPause] = jumpsOf(recording(), paused);
    expect(withPause.lengthM).toBeLessThan(ref.lengthM!);
    const holed = base.map((p, s) => (s === step ? { ...p, stepM: 2 } : p));
    const [withHole] = jumpsOf(recording(), holed);
    expect(withHole.lengthM).toBeLessThan(ref.lengthM!);
    expect(withHole.lengthM).toBeGreaterThan(withPause.lengthM!);
  });
});

describe('sauts : élagage du fichier', () => {
  const jumps = [jump(30, 4.5), jump(140, 3.5)];
  const motion: Motion = { durationS: 180, az: (t) => jumps.reduce((s, j) => s + j.az(t), 0) + chop(t) * 0.3 };
  // L'enregistrement et son fichier, construits une fois pour les tests du bloc, qui ne font que les lire.
  let encoded: Promise<Uint8Array> | null = null;
  const wholeFile = (): Promise<Uint8Array> => {
    if (encoded === null) {
      const rec = record(motion);
      encoded = encodeImu(rec.header, rec.series);
    }
    return encoded;
  };

  it('garde les fenêtres des vols, un fichier plus petit, et les mêmes sauts', async () => {
    const whole = await wholeFile();
    const pruned = await pruneImuFile(whole, D);
    expect(pruned.length).toBeLessThan(whole.length / 2);
    const read = (await decodeImu(pruned))!;
    expect(read.header.windows).toHaveLength(2);
    const before = jumpsOf((await decodeImu(whole))!);
    const after = jumpsOf(read);
    expect(after.map((j) => [j.takeoffMs, j.heightM])).toEqual(before.map((j) => [j.takeoffMs, j.heightM]));
  }, 20_000); // Délai explicite : la construction et le codage du fichier dépassaient 5 s sous charge.

  it('rend tel quel un fichier déjà élagué ou illisible', async () => {
    const once = await pruneImuFile(await wholeFile(), D);
    expect(await pruneImuFile(once, D)).toBe(once);
    const junk = new TextEncoder().encode('<gpx></gpx>');
    expect(await pruneImuFile(junk, D)).toBe(junk);
  });
});

describe('sauts sur la carte', () => {
  const at = (...seconds: number[]) => seconds.map((s) => ({ timeMs: WALL_MS + s * 1000 }));

  it('prend le point de trace le plus proche d’un instant', () => {
    const track = at(0, 1, 2, 3, 10);
    expect(trackIndexAtTime(track, WALL_MS + 1400)).toBe(1);
    expect(trackIndexAtTime(track, WALL_MS + 1600)).toBe(2);
    expect(trackIndexAtTime(track, WALL_MS + 8000)).toBe(4);
    expect(trackIndexAtTime(track, WALL_MS - 5000)).toBe(0);
    expect(trackIndexAtTime([], WALL_MS)).toBe(0);
  });

  it('encadre le saut, deux points au moins, même dans un seul intervalle de la trace', () => {
    // À 1 Hz : un vol de 2,3 s à 4,3 s va du point de 4 s à celui de 5 s.
    expect(jumpTrackSpan(at(0, 1, 2, 3, 4, 5, 6), { takeoffMs: WALL_MS + 2300, landingMs: WALL_MS + 4300 }))
      .toEqual({ from: 2, to: 5, start: 2 });
    // Trace clairsemée : tout le vol tient entre deux points.
    expect(jumpTrackSpan(at(0, 10, 20), { takeoffMs: WALL_MS + 12_000, landingMs: WALL_MS + 13_000 }))
      .toEqual({ from: 1, to: 2, start: 1 });
    expect(jumpTrackSpan(at(0), { takeoffMs: WALL_MS, landingMs: WALL_MS + 500 })).toBeNull();
  });
});

describe('jumpDoubtLabel', () => {
  it('dit la borne de la verticale en centimètres, celle du profil', () => {
    expect(jumpDoubtLabel('verticale', { attitudeMaxErrorM: 0.1 })).toBe("verticale incertaine : la hauteur peut s'écarter de plus de 10 cm");
    expect(jumpDoubtLabel('verticale', { attitudeMaxErrorM: 0.15 })).toContain('15 cm');
  });
});

/** Courbe d'un saut et lignes de la courbe, telles que `JumpsPanel` les faisait avant le lot 61 (copie gelée). */
const frozenCurvePoints = (j: SessionJump): Map<number, number> => {
  const points = new Map<number, number>();
  j.curve.heightsM.forEach((h, k) => points.set(Math.round((j.curve.startS + k * j.curve.stepS) * 100), h));
  return points;
};
const frozenCurveRows = (first: SessionJump, second: SessionJump | null, trackIndexAt: (ms: number) => number) => {
  const jumps = second ? [first, second] : [first];
  const points = jumps.map(frozenCurvePoints);
  const instants = [...new Set(points.flatMap((p) => [...p.keys()]))].sort((a, b) => a - b);
  return instants.map((c) => {
    const t = c / 100;
    const owner = points[0].has(c) ? first : second ?? first;
    return { t, premier: points[0].get(c) ?? null, second: points[1]?.get(c) ?? null, index: trackIndexAt(owner.takeoffMs + t * 1000) };
  });
};

/** Saut rangé synthétique : courbe en parabole au pas `stepS`, partie de `startS`. */
const sessionJump = (takeoffMs: number, flightS: number, stepS: number, startS: number): SessionJump => {
  const heightsM: number[] = [];
  for (let t = startS; t <= flightS + 0.5; t += stepS) heightsM.push(Math.round(Math.max(0, 4.9 * t * (flightS - t)) * 100) / 100);
  return {
    takeoffMs, landingMs: takeoffMs + flightS * 1000, flightS, heightM: Math.max(...heightsM), takeoffVerticalMs: 4.9 * flightS,
    speedMs: 8, lengthM: 8 * flightS, doubts: [], curve: { stepS, startS, heightsM },
  };
};

describe('jumpCurveRows, copie gelée de la courbe des sauts', () => {
  /** Trace à 1 Hz et à 5 Hz : point le plus proche d'un instant. */
  for (const hz of [1, 5]) {
    const trackIndexAt = (ms: number) => Math.round(((ms - WALL_MS) / 1000) * hz);
    it(`${hz} Hz : un saut`, () => {
      const one = sessionJump(WALL_MS + 30_000, 1.23, 0.02, -0.3);
      const rows = jumpCurveRows(one, null, trackIndexAt);
      expect(rows).toEqual(frozenCurveRows(one, null, trackIndexAt));
      expect(JSON.stringify(rows)).toBe(JSON.stringify(frozenCurveRows(one, null, trackIndexAt)));
      expect(rows.every((r) => r.second === null)).toBe(true);
    });

    it(`${hz} Hz : deux sauts, pas et durées différents`, () => {
      const a = sessionJump(WALL_MS + 30_000, 1.23, 0.02, -0.3);
      const b = sessionJump(WALL_MS + 95_000, 1.71, 0.05, -0.25);
      for (const [x, y] of [[a, b], [b, a]] as const) {
        const rows = jumpCurveRows(x, y, trackIndexAt);
        expect(rows).toEqual(frozenCurveRows(x, y, trackIndexAt));
        expect(JSON.stringify(rows)).toBe(JSON.stringify(frozenCurveRows(x, y, trackIndexAt)));
      }
    });
  }
});
