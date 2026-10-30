import { describe, expect, it } from 'vitest';
import { startZoneAlert, stepZoneAlert, zoneAlertParams, type ZoneAlertParams, type ZoneSignal, type ZoneTarget } from './zoneAlert';

// Z1 dès 100, Z2 dès 120, Z3 dès 140, Z4 dès 160, Z5 dès 180.
const BOUNDS = [100, 120, 140, 160, 180];
const PARAMS = zoneAlertParams({ smoothS: 5, gapS: 10 });

interface Sample {
  t: number;
  bpm: number | null;
  active?: boolean;
}

/** Joue une suite de mesures (heures en secondes) ; rend les signaux et leur heure. */
const run = (samples: Sample[], target: ZoneTarget = 3, params: ZoneAlertParams = PARAMS): { t: number; signal: ZoneSignal }[] => {
  let state = startZoneAlert();
  const out: { t: number; signal: ZoneSignal }[] = [];
  for (const s of samples) {
    const next = stepZoneAlert(state, { timeMs: s.t * 1000, bpm: s.bpm, active: s.active ?? true }, { bounds: BOUNDS, target, params });
    state = next.state;
    if (next.signal) out.push({ t: s.t, signal: next.signal });
  }
  return out;
};

/** Mesures à pas régulier (`stepS`) de `fromS` à `toS` exclu, FC donnée par l'heure. */
const every = (stepS: number, fromS: number, toS: number, bpm: (t: number) => number | null, active = true): Sample[] => {
  const out: Sample[] = [];
  for (let i = 0; fromS + i * stepS < toS - 1e-9; i++) {
    const t = Math.round((fromS + i * stepS) * 1000) / 1000;
    out.push({ t, bpm: bpm(t), active });
  }
  return out;
};

const times = (signals: { t: number }[]) => signals.map((s) => s.t);

describe('stepZoneAlert', () => {
  it('1 Hz : premier signal 10 s après la sortie, puis 40 s, puis trois rappels à 60 s, puis silence', () => {
    // FC lissée lisible dès 3 s (moitié de la fenêtre de 5 s couverte) : sortie vue à 3 s.
    const signals = run(every(1, 0, 600, () => 170));
    expect(times(signals)).toEqual([13, 53, 113, 173, 233]);
    expect(signals.every((s) => s.signal === 'trop')).toBe(true);
  });

  it('5 Hz : mêmes signaux à moins d’une seconde près', () => {
    const signals = times(run(every(0.2, 0, 600, () => 170)));
    expect(signals).toHaveLength(5);
    [13, 53, 113, 173, 233].forEach((t, i) => expect(Math.abs(signals[i] - t)).toBeLessThan(1));
  });

  it('cadence de 2 à 3 s : mêmes signaux à moins de 3 s près', () => {
    const samples: Sample[] = [];
    for (let t = 0, i = 0; t < 600; t += i++ % 2 === 0 ? 2 : 3) samples.push({ t, bpm: 100 });
    const signals = run(samples);
    expect(signals).toHaveLength(5);
    expect(signals.every((s) => s.signal === 'accelere')).toBe(true);
    [13, 53, 113, 173, 233].forEach((t, i) => expect(Math.abs(signals[i].t - t)).toBeLessThan(3));
  });

  it('aller-retour de 8 s hors zone : silence, pas de « ok »', () => {
    expect(run(every(1, 0, 120, (t) => (t >= 30 && t < 38 ? 175 : 150)))).toEqual([]);
  });

  it('retour dans la zone après un signal : un seul « ok »', () => {
    const signals = run(every(1, 0, 150, (t) => (t >= 30 && t < 60 ? 175 : 150)));
    expect(signals.map((s) => s.signal)).toEqual(['trop', 'bien']);
  });

  it('« ok » au moins 3 s après le dernier signal', () => {
    const params = zoneAlertParams({ smoothS: 1, gapS: 10 });
    // Sortie vue à 1 s, signal à 11 s, retour vu à 12 s : « ok » à 14 s.
    const signals = run(every(1, 0, 30, (t) => (t < 12 ? 175 : 150)), 3, params);
    expect(signals).toEqual([{ t: 11, signal: 'trop' }, { t: 14, signal: 'bien' }]);
  });

  it('pause au milieu : la sortie est oubliée, le compte repart de la reprise', () => {
    const samples = [
      ...every(1, 0, 8, () => 175),
      ...every(1, 8, 28, () => 175, false),
      ...every(1, 28, 60, () => 175),
    ];
    const signals = run(samples);
    // Reprise à 28 s : FC lissée lisible à 31 s, premier signal à 41 s.
    expect(signals[0]).toEqual({ t: 41, signal: 'trop' });
  });

  it('perte de contact : la sortie est oubliée, le compte repart du retour de la FC', () => {
    const signals = run(every(1, 0, 60, (t) => (t >= 8 && t < 28 ? null : 175)));
    expect(signals[0]).toEqual({ t: 41, signal: 'trop' });
  });

  it('trou de mesure plus long que gapS : idem', () => {
    const signals = run([...every(1, 0, 8, () => 175), ...every(1, 28, 60, () => 175)]);
    expect(signals[0]).toEqual({ t: 41, signal: 'trop' });
  });

  it('pause après un signal : pas de « ok » à la reprise dans la zone', () => {
    const samples = [...every(1, 0, 20, () => 175), ...every(1, 20, 30, () => 150, false), ...every(1, 30, 60, () => 150)];
    expect(run(samples).map((s) => s.signal)).toEqual(['trop']);
  });

  it('trop haut puis trop bas : le compte repart de zéro', () => {
    const signals = run(every(1, 0, 60, (t) => (t < 8 ? 175 : 110)));
    expect(signals.map((s) => s.signal)).toEqual(['accelere']);
    expect(signals[0].t).toBeGreaterThanOrEqual(18);
  });

  it('Z1 : sous la zone, accélère ; Z5 : jamais trop haut', () => {
    expect(run(every(1, 0, 30, () => 90), 1).map((s) => s.signal)).toEqual(['accelere']);
    expect(run(every(1, 0, 300, () => 220), 5)).toEqual([]);
  });

  it('aucune zone visée : jamais de signal', () => {
    expect(run(every(1, 0, 300, () => 220), 0)).toEqual([]);
  });

  it('délais surchargés', () => {
    const params = zoneAlertParams({ smoothS: 5, gapS: 10 }, { firstDelayS: 5, secondDelayS: 20, repeatEveryS: 30, repeatCount: 1 });
    expect(times(run(every(1, 0, 300, () => 175), 3, params))).toEqual([8, 28, 58]);
  });
});
