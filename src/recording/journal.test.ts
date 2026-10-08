import { describe, expect, it } from 'vitest';
import type { LocationFix } from '../platform/location';
import { buildGpx } from './gpxWriter';
import { runCommand, startRun } from './intervalTimer';
import { journalActivityLine, journalBreakLine, journalFixLine, journalHeaderLine, journalIntervalsLine, parseJournal } from './journal';
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
