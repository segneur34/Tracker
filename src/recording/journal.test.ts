import { describe, expect, it } from 'vitest';
import type { LocationFix } from '../platform/location';
import { buildGpx } from './gpxWriter';
import { journalFixLine, journalHeaderLine, parseJournal } from './journal';
import { roundFix } from './session';

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
    const fromMemory = buildGpx(received, meta);
    const fromJournal = buildGpx(parseJournal(journalOf(received)).fixes, meta);
    expect(fromJournal).toBe(fromMemory);
  });
});
