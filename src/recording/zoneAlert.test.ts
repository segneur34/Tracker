import { describe, expect, it } from 'vitest';
import {
  armableBand, bandLabel, boundBpm, outOfRangePick, picksBand, sanitizeBand, sanitizeBandPicks, startZoneAlert, stepZoneAlert, validBand, zoneAlertParams, zoneBand,
  type HeartBand, type ZoneAlertParams, type ZoneSignal, type ZoneTarget,
} from './zoneAlert';

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

/** Joue une suite de mesures sur une bande (course à bornes) ; `changes` remplace la bande à l'heure donnée, compte remis à zéro. */
const runBand = (samples: Sample[], band: HeartBand, changes: { t: number; band: HeartBand }[] = []): { t: number; signal: ZoneSignal }[] => {
  let state = startZoneAlert();
  let current = band;
  const out: { t: number; signal: ZoneSignal }[] = [];
  for (const s of samples) {
    const change = changes.find((c) => c.t === s.t);
    if (change) {
      current = change.band;
      state = { ...startZoneAlert(), lastSignalMs: state.lastSignalMs };
    }
    const next = stepZoneAlert(state, { timeMs: s.t * 1000, bpm: s.bpm, active: s.active ?? true }, { band: current, params: PARAMS });
    state = next.state;
    if (next.signal) out.push({ t: s.t, signal: next.signal });
  }
  return out;
};

describe('course à bornes (05/11)', () => {
  it('une zone visée est la bande de son bas à son haut : mêmes signaux', () => {
    expect(zoneBand(3, BOUNDS)).toEqual({ minBpm: 140, maxBpm: 159 });
    expect(zoneBand(5, BOUNDS)).toEqual({ minBpm: 180, maxBpm: null });
    expect(zoneBand(0, BOUNDS)).toBeNull();
    for (const bpm of [139, 140, 159, 160, 175]) {
      expect(runBand(every(1, 0, 300, () => bpm), zoneBand(3, BOUNDS)!)).toEqual(run(every(1, 0, 300, () => bpm), 3));
    }
  });

  it('mini seul : trop bas seulement', () => {
    expect(times(runBand(every(1, 0, 600, () => 130), { minBpm: 140, maxBpm: null }))).toEqual([13, 53, 113, 173, 233]);
    expect(runBand(every(1, 0, 600, () => 210), { minBpm: 140, maxBpm: null })).toEqual([]);
    expect(runBand(every(1, 0, 60, () => 130), { minBpm: 140, maxBpm: null })[0].signal).toBe('accelere');
  });

  it('maxi seul : trop haut seulement', () => {
    expect(runBand(every(1, 0, 60, () => 170), { minBpm: null, maxBpm: 160 })[0].signal).toBe('trop');
    expect(runBand(every(1, 0, 600, () => 60), { minBpm: null, maxBpm: 160 })).toEqual([]);
    // Borne comprise : 160 n'est pas au-dessus.
    expect(runBand(every(1, 0, 600, () => 160), { minBpm: null, maxBpm: 160 })).toEqual([]);
  });

  it('mini au-dessus du maxi, ou aucune borne : refusée, aucun signal', () => {
    expect(validBand({ minBpm: 160, maxBpm: 140 })).toBe(false);
    expect(validBand({ minBpm: null, maxBpm: null })).toBe(false);
    expect(validBand({ minBpm: 150, maxBpm: 150 })).toBe(true);
    expect(validBand({ minBpm: 10, maxBpm: null })).toBe(false);
    expect(runBand(every(1, 0, 300, () => 220), { minBpm: 160, maxBpm: 140 })).toEqual([]);
  });

  it('boundBpm : bord d’une zone, seuil, BPM saisi', () => {
    const zones = { bounds: BOUNDS, s1: 148, s2: 171 };
    expect(boundBpm('2', 'min', zones)).toBe(120);
    expect(boundBpm('2', 'max', zones)).toBe(139);
    expect(boundBpm('5', 'max', zones)).toBeNull();
    expect(boundBpm('s1', 'min', zones)).toBe(148);
    expect(boundBpm('s2', 'max', zones)).toBe(171);
    expect(boundBpm('bpm', 'max', zones, 152.4)).toBe(152);
    expect(boundBpm('bpm', 'max', null, 152)).toBe(152);
    // Hors plage : gardé tel quel, pour que la bande soit refusée (pas effacé sans un mot).
    expect(boundBpm('bpm', 'min', zones, 400)).toBe(400);
    expect(boundBpm('bpm', 'min', zones, null)).toBeNull();
    expect(boundBpm('aucune', 'min', zones)).toBeNull();
    expect(boundBpm('3', 'min', null)).toBeNull();
  });

  it('bande changée en direct : le compte repart de zéro', () => {
    // Trop haut dès 3 s sous 150 ; à 20 s, maxi relevé à 160 (rien) puis, à 30 s, ramené à 150 : la sortie repart de
    // zéro, premier signal vers 43 s (FC relissée), deuxième 40 s après, pas le rappel de 60 s d'avant.
    const signals = runBand(every(1, 0, 120, () => 155), { minBpm: null, maxBpm: 150 }, [
      { t: 20, band: { minBpm: null, maxBpm: 160 } },
      { t: 30, band: { minBpm: null, maxBpm: 150 } },
    ]);
    expect(signals.map((s) => s.signal)).toEqual(['trop', 'trop', 'trop']);
    expect(signals[0].t).toBe(13);
    expect(signals[1].t).toBeGreaterThanOrEqual(40);
    expect(signals[1].t).toBeLessThanOrEqual(43);
    expect(signals[2].t - signals[1].t).toBe(40);
  });

  it('bande relue et dite en clair', () => {
    expect(sanitizeBand({ minBpm: 140, maxBpm: 160 })).toEqual({ minBpm: 140, maxBpm: 160 });
    expect(sanitizeBand({ maxBpm: 160 })).toEqual({ minBpm: null, maxBpm: 160 });
    expect(sanitizeBand({ minBpm: '140' })).toBeNull();
    expect(sanitizeBand(3)).toBeNull();
    expect(bandLabel({ minBpm: 140, maxBpm: 160 })).toBe('140–160 bpm');
    expect(bandLabel({ minBpm: 140, maxBpm: null })).toBe('140 bpm et plus');
    expect(bandLabel({ minBpm: null, maxBpm: 160 })).toBe('160 bpm au plus');
  });
});

describe('choix des bornes retenus (05/11)', () => {
  const zones = { bounds: BOUNDS, s1: 148, s2: 171 };

  it('bande des choix : zone, seuil, BPM saisi ; une zone suit le pratiquant', () => {
    expect(picksBand({ min: { choice: '2', bpm: 999 }, max: { choice: 's2', bpm: null } }, zones)).toEqual({ minBpm: 120, maxBpm: 171 });
    expect(picksBand({ min: { choice: 'aucune', bpm: null }, max: { choice: 'bpm', bpm: 155 } }, null)).toEqual({ minBpm: null, maxBpm: 155 });
    expect(picksBand({ min: { choice: '2', bpm: 120 }, max: { choice: 'aucune', bpm: null } }, { ...zones, bounds: [105, 125, 145, 165, 185] }).minBpm).toBe(125);
  });

  it('choix relus contrôlés', () => {
    expect(sanitizeBandPicks({ min: { choice: '3', bpm: 140 }, max: { choice: 'bpm', bpm: 160 } })).toEqual({ min: { choice: '3', bpm: 140 }, max: { choice: 'bpm', bpm: 160 } });
    // Pas de maxi « Z5 » : la borne illisible vaut « aucune ».
    expect(sanitizeBandPicks({ min: { choice: 's1', bpm: 'x' }, max: { choice: '5', bpm: 1 } })).toEqual({ min: { choice: 's1', bpm: null }, max: { choice: 'aucune', bpm: null } });
    expect(sanitizeBandPicks({})).toBeNull();
    expect(sanitizeBandPicks('140')).toBeNull();
  });
});

describe('bande armée des choix (05/11)', () => {
  const zones = { bounds: BOUNDS, s1: 148, s2: 171 };

  it('un BPM saisi hors de 25 à 250 est signalé et la bande n’est pas armée', () => {
    const picks = { min: { choice: 'bpm' as const, bpm: 300 }, max: { choice: 'bpm' as const, bpm: 160 } };
    expect(outOfRangePick(picks.min)).toBe(true);
    expect(outOfRangePick(picks.max)).toBe(false);
    expect(armableBand(picks, zones)).toBeNull();
    expect(armableBand({ ...picks, min: { choice: 'bpm', bpm: 20 } }, zones)).toBeNull();
  });

  it('un « BPM » laissé vide n’arme pas l’autre borne seule', () => {
    expect(armableBand({ min: { choice: 'bpm', bpm: null }, max: { choice: 'bpm', bpm: 160 } }, zones)).toBeNull();
  });

  it('mini au-dessus du maxi refusé ; une bande juste est armée', () => {
    expect(armableBand({ min: { choice: 'bpm', bpm: 170 }, max: { choice: 'bpm', bpm: 160 } }, zones)).toBeNull();
    expect(armableBand({ min: { choice: '3', bpm: null }, max: { choice: 'bpm', bpm: 160 } }, zones)).toEqual({ minBpm: 140, maxBpm: 160 });
    expect(armableBand({ min: { choice: 'aucune', bpm: null }, max: { choice: 's2', bpm: null } }, zones)).toEqual({ minBpm: null, maxBpm: 171 });
    expect(armableBand({ min: { choice: 'aucune', bpm: null }, max: { choice: 'aucune', bpm: null } }, zones)).toBeNull();
  });
});
