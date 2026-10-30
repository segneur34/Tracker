import { describe, expect, it } from 'vitest';
import { BASE_COLOR, baseActivity, type Activity } from '../core/activities';
import type { LocationFix } from '../platform/location';
import { buildGpx } from './gpxWriter';
import type { SessionTest } from './fitnessTest';
import { runCommand, startRun } from './intervalTimer';
import {
  journalActivity, journalActivityLine, journalBreakLine, journalFixLine, journalHeaderLine, journalHeartRateLine, journalIntervalsLine, journalNoteLine, journalTestLine,
  parseJournal,
} from './journal';
import { roundFix, splitIntoSegments } from './session';

const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);

const fixes: LocationFix[] = [
  { timeMs: T0, lat: 43.1234567, lon: 3.7654321, accuracyM: 4.2, altitudeM: 2.5, speedMs: 5.43, bearingDeg: 270.1 },
  { timeMs: T0 + 1000, lat: 43.1234667, lon: 3.7654221 },
  { timeMs: T0 + 2000, lat: 43.1234767, lon: 3.7654121, speedMs: 0, bearingDeg: 0 },
];

const journalOf = (list: LocationFix[]): string =>
  journalHeaderLine('kite', T0 - 5000) + list.map(journalFixLine).join('');

describe('journal', () => {
  it('relit l\'en-tête et toutes les positions, valeurs absentes comprises', () => {
    const parsed = parseJournal(journalOf(fixes));
    expect(parsed.header).toEqual({ format: 'tracker-journal', version: 1, sport: 'kite', startedAtMs: T0 - 5000 });
    expect(parsed.fixes).toEqual(fixes.map((f) => ({
      accuracyM: undefined, altitudeM: undefined, speedMs: undefined, bearingDeg: undefined, ...f,
    })));
  });

  it("garde la fréquence cardiaque, et relit les lignes d'avant elle", () => {
    const withHr: LocationFix = { timeMs: T0, lat: 43, lon: 3, heartRateBpm: 151 };
    expect(journalFixLine(withHr)).toBe(`[${T0},43,3,null,null,null,null,151]
`);
    expect(journalFixLine({ timeMs: T0, lat: 43, lon: 3 })).toBe(`[${T0},43,3,null,null,null,null]
`);
    const parsed = parseJournal(journalOf([withHr, { timeMs: T0 + 1000, lat: 43, lon: 3 }]));
    expect(parsed.fixes.map((f) => f.heartRateBpm)).toEqual([151, undefined]);
  });

  it('ignore une dernière ligne tronquée par un arrêt brutal', () => {
    const text = journalOf(fixes);
    const truncated = text.slice(0, text.length - 12);
    expect(parseJournal(truncated).fixes).toHaveLength(2);
  });

  it('récupère les positions même sans en-tête lisible', () => {
    const text = '{"format":"tracker-jou\n' + fixes.map(journalFixLine).join('');
    const parsed = parseJournal(text);
    expect(parsed.header).toBeNull();
    expect(parsed.fixes).toHaveLength(3);
  });

  it('écarte les lignes illisibles et les positions qui ne sont pas plus récentes', () => {
    const text = journalOf([fixes[0], fixes[1]]) + 'n\'importe quoi\n' + journalFixLine(fixes[0]) + '[1,2]\n' + journalFixLine(fixes[2]);
    expect(parseJournal(text).fixes.map((f) => f.timeMs)).toEqual([T0, T0 + 1000, T0 + 2000]);
  });

  it('rend un en-tête nul pour un support inconnu', () => {
    const text = '{"format":"tracker-journal","version":1,"sport":"parapente","startedAtMs":0}\n';
    expect(parseJournal(text).header).toBeNull();
  });

  it('redonne, après un arrêt brutal, le même GPX que l\'arrêt normal', () => {
    const received = fixes.map((f) => roundFix({ ...f, lat: f.lat + 1e-9 }));
    const meta = { name: 'Kitesurf, 23/09/2026 14:00', sport: 'kite' as const };
    const fromMemory = buildGpx(splitIntoSegments(received, []), meta);
    const parsed = parseJournal(journalOf(received));
    const fromJournal = buildGpx(splitIntoSegments(parsed.fixes, parsed.breaks), meta);
    expect(fromJournal).toBe(fromMemory);
  });

  it('retrouve, avec une coupure au milieu, les mêmes segments qu\'en mémoire', () => {
    const received = fixes.map(roundFix);
    const meta = { name: 'Kitesurf, 23/09/2026 14:00', sport: 'kite' as const };
    const text = journalHeaderLine('kite', T0 - 5000)
      + journalFixLine(received[0])
      + journalBreakLine(received[1].timeMs)
      + journalFixLine(received[1])
      + journalFixLine(received[2]);
    const parsed = parseJournal(text);
    expect(parsed.breaks).toEqual([1]);
    const fromJournal = buildGpx(splitIntoSegments(parsed.fixes, parsed.breaks), meta);
    const fromMemory = buildGpx([[received[0]], [received[1], received[2]]], meta);
    expect(fromJournal).toBe(fromMemory);
  });

  it('ignore une coupure posée avant toute position', () => {
    const text = journalHeaderLine('kite', T0 - 5000) + journalBreakLine(T0 - 1000) + journalFixLine(fixes[0]);
    expect(parseJournal(text).breaks).toEqual([]);
  });

  it('ignore une ligne de coupure tronquée par un arrêt brutal', () => {
    const text = journalOf([fixes[0]]) + journalBreakLine(fixes[1].timeMs);
    const truncated = text.slice(0, text.length - 5);
    const parsed = parseJournal(truncated);
    expect(parsed.fixes).toHaveLength(1);
    expect(parsed.breaks).toEqual([]);
  });

  it("garde l'activité de l'en-tête, et l'ignore abîmée", () => {
    const withActivity = journalHeaderLine('kite', T0, { id: 'a-kite-lac', name: 'Kite au lac' });
    expect(parseJournal(withActivity).header?.activity).toEqual({ id: 'a-kite-lac', name: 'Kite au lac' });
    const broken = JSON.stringify({ format: 'tracker-journal', version: 1, sport: 'kite', startedAtMs: T0, activity: { id: 3 } }) + '\n';
    expect(parseJournal(broken).header).toEqual({ format: 'tracker-journal', version: 1, sport: 'kite', startedAtMs: T0 });
  });

  it('retient le dernier changement d\'activité, sans rien perdre des positions ni des coupures', () => {
    const text = journalHeaderLine('wingfoil', T0, { id: 'wingfoil', name: 'Voile' })
      + journalFixLine(fixes[0])
      + journalActivityLine('kite', { id: 'a-kite', name: 'Kite' })
      + journalBreakLine(fixes[1].timeMs)
      + journalFixLine(fixes[1])
      + journalActivityLine('running', { id: 'running', name: 'Course' })
      + journalFixLine(fixes[2]);
    const parsed = parseJournal(text);
    expect(parsed.activityChange).toEqual({ sport: 'running', activity: { id: 'running', name: 'Course' } });
    // L'en-tête reste celui du départ : c'est au lecteur de faire primer le changement.
    expect(parsed.header?.sport).toBe('wingfoil');
    expect(parsed.fixes).toHaveLength(3);
    expect(parsed.breaks).toEqual([1]);
    expect(parseJournal(journalOf(fixes)).activityChange).toBeNull();
  });

  it('ignore un changement d\'activité abîmé ou tronqué, le précédent reste', () => {
    const good = journalActivityLine('kite', { id: 'a-kite', name: 'Kite' });
    const broken = `${JSON.stringify(['activity', { sport: 'moth', id: 'x', name: 'Moth' }])}\n`;
    const truncated = journalActivityLine('running', { id: 'running', name: 'Course' }).slice(0, 20);
    const parsed = parseJournal(journalOf(fixes) + good + broken + truncated);
    expect(parsed.activityChange).toEqual({ sport: 'kite', activity: { id: 'a-kite', name: 'Kite' } });
    expect(parsed.fixes).toHaveLength(3);
    // Sans en-tête lisible, le changement vaut quand même.
    expect(parseJournal(good + journalFixLine(fixes[0])).activityChange?.sport).toBe('kite');
  });

  it("relit chaque séance du compteur dans son dernier état, et l'ignore abîmée", () => {
    const workout = { reps: 2, workS: 60, restS: 30 };
    const first = startRun(workout, T0);
    const paused = runCommand(first, 'pause', T0 + 10_000);
    const second = startRun(workout, T0 + 500_000);
    const broken = `${JSON.stringify(['intervals', { workout: {}, startedAtMs: T0 }])}\n`;
    const text = journalOf(fixes) + journalIntervalsLine(first) + journalIntervalsLine(second) + journalIntervalsLine(paused)
      + broken + journalIntervalsLine(second).slice(0, 30);
    const parsed = parseJournal(text);
    expect(parsed.intervalRuns).toEqual([paused, second]);
    expect(parsed.fixes).toHaveLength(3);
    expect(parseJournal(journalOf(fixes)).intervalRuns).toEqual([]);
  });
});

describe('notes du journal', () => {
  const first = { timeMs: T0 + 1500, lat: 43.12346, lon: 3.76542, label: null };
  const second = { timeMs: T0 + 500, lat: 43.1234, lon: 3.7654, label: null };

  it("relit les repères, dans l'ordre du temps, sans gêner les positions", () => {
    const text = journalHeaderLine('kite', T0 - 5000) + journalFixLine(fixes[0]) + journalNoteLine(first)
      + journalFixLine(fixes[1]) + journalNoteLine(second) + journalFixLine(fixes[2]);
    const parsed = parseJournal(text);
    expect(parsed.marks).toEqual([second, first]);
    expect(parsed.fixes).toHaveLength(3);
    expect(parsed.breaks).toEqual([]);
  });

  it('ignore une note abîmée, et rend une liste vide sans note', () => {
    const text = journalOf(fixes) + '["note",{"timeMs":"hier","lat":43,"lon":3}]\n' + '["note",{"timeMs":1,"lat":4';
    const parsed = parseJournal(text);
    expect(parsed.marks).toEqual([]);
    expect(parsed.fixes).toHaveLength(3);
    expect(parseJournal(journalOf(fixes)).marks).toEqual([]);
  });
});

describe('test du journal', () => {
  const TEST: SessionTest = {
    protocol: 'fc-max',
    version: 1,
    settings: { warmupS: 480, age: 35, ageSource: 'profil', lowBpm: 110, highBpm: 147, zoneMethod: 'max' },
    startMs: T0,
    rampStartMs: T0 + 480_000,
    v0Ms: 2.5,
    steps: [{ startMs: T0 + 480_000, targetMs: 2.5 }],
    rampEndMs: null,
    dropMs: null,
    endReason: null,
    endMs: null,
    signals: [{ t: T0, s: 'debut' }, { t: T0 + 480_000, s: 'palier' }],
  };

  it('relit le dernier état lisible du test, sans gêner les positions', () => {
    const later: SessionTest = { ...TEST, steps: [...TEST.steps, { startMs: T0 + 540_000, targetMs: 2.67 }] };
    const text = journalOf(fixes.slice(0, 2)) + journalTestLine(TEST) + journalFixLine(fixes[2]) + journalTestLine(later) + '["test",{"protocol":"fc-max"';
    const parsed = parseJournal(text);
    expect(parsed.test).toEqual(later);
    expect(parsed.fixes).toHaveLength(3);
  });

  it('rend null sans test, ou si le seul est abîmé', () => {
    expect(parseJournal(journalOf(fixes)).test).toBeNull();
    expect(parseJournal(journalOf(fixes) + '["test",{"protocol":"vma"}]\n').test).toBeNull();
  });
});

describe('journal d’une session sans position (muscu, lot I du 25/10)', () => {
  it('relit les mesures de la ceinture et leurs coupures, à part des positions ; une ligne abîmée est ignorée', () => {
    const text = [
      journalHeaderLine('muscu', T0),
      journalHeartRateLine({ timeMs: T0, heartRateBpm: 90 }),
      journalHeartRateLine({ timeMs: T0 + 1000, heartRateBpm: 92 }),
      journalHeartRateLine({ timeMs: T0 + 1000, heartRateBpm: 93 }),
      journalBreakLine(T0 + 30_000),
      journalHeartRateLine({ timeMs: T0 + 30_000, heartRateBpm: 110 }),
      journalHeartRateLine({ timeMs: T0 + 31_000 }),
      '["hr","x",3]',
      '["hr", 12',
    ].join('');
    const parsed = parseJournal(text);
    expect(parsed.header?.sport).toBe('muscu');
    expect(parsed.fixes).toEqual([]);
    expect(parsed.breaks).toEqual([]);
    expect(parsed.heartFixes).toEqual([
      { timeMs: T0, heartRateBpm: 90 }, { timeMs: T0 + 1000, heartRateBpm: 92 }, { timeMs: T0 + 30_000, heartRateBpm: 110 }, { timeMs: T0 + 31_000 },
    ]);
    expect(parsed.heartBreaks).toEqual([2]);
  });

  it('un journal à positions n’a aucune mesure à part', () => {
    const parsed = parseJournal(journalHeaderLine('running', T0) + journalFixLine({ timeMs: T0, lat: 43, lon: 3 }));
    expect(parsed.heartFixes).toEqual([]);
    expect(parsed.fixes).toHaveLength(1);
  });
});

describe('journalActivity (lot 67, sortie de useRecorder)', () => {
  const list: Activity[] = [
    { id: 'running', name: 'Course', base: 'running', color: '#d11a1a' },
    { id: 'trail-1', name: 'Trail', base: 'running', color: '#a01010' },
    { id: 'moth-1', name: 'Moth', base: 'wingfoil', color: '#004aad' },
  ];

  it("reprend l'activité de la liste, du même calcul", () => {
    expect(journalActivity('running', { id: 'trail-1', name: 'Ancien nom' }, list)).toBe(list[1]);
  });

  it("d'un autre calcul ou absente de la liste : reconstruite sous le nom gardé, couleur du calcul", () => {
    expect(journalActivity('running', { id: 'moth-1', name: 'Moth' }, list))
      .toEqual({ id: 'moth-1', name: 'Moth', base: 'running', color: BASE_COLOR.running });
    expect(journalActivity('cycling', { id: 'gravel-2', name: 'Gravel' }, list))
      .toEqual({ id: 'gravel-2', name: 'Gravel', base: 'cycling', color: BASE_COLOR.cycling });
  });

  it("sans activité dans l'en-tête : l'activité de base du calcul", () => {
    expect(journalActivity('surf', undefined, list)).toEqual(baseActivity('surf'));
  });
});
