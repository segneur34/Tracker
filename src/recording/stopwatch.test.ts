import { describe, expect, it } from 'vitest';
import { formatStopwatch, readStopwatch, startStopwatch, stopwatchCommand, stopwatchState, type Stopwatch, type StopwatchCommand } from './stopwatch';

const T0 = 1_700_000_000_000;
const at = (s: number) => T0 + s * 1000;
const sw = startStopwatch(T0);

/** Le chrono après une suite de commandes, chacune à son instant (en secondes). */
const withCommands = (base: Stopwatch, ...commands: [StopwatchCommand, number][]): Stopwatch =>
  commands.reduce((w, [kind, s]) => stopwatchCommand(w, kind, at(s)), base);

describe('chronomètre', () => {
  it('compte depuis le départ', () => {
    expect(stopwatchState(sw, at(12.3))).toEqual({ status: 'running', elapsedMs: 12300, laps: [], currentLapMs: 12300 });
  });

  it('prend des tours : temps du tour et cumul', () => {
    const w = withCommands(sw, ['lap', 30], ['lap', 75]);
    const state = stopwatchState(w, at(80));
    expect(state.laps).toEqual([
      { n: 1, lapMs: 30000, totalMs: 30000 },
      { n: 2, lapMs: 45000, totalMs: 75000 },
    ]);
    expect(state.currentLapMs).toBe(5000);
    expect(state.elapsedMs).toBe(80000);
  });

  it('ôte les pauses du temps et des tours', () => {
    const w = withCommands(sw, ['lap', 10], ['pause', 20], ['resume', 50], ['lap', 60]);
    const state = stopwatchState(w, at(70));
    expect(state.laps.map((l) => l.lapMs)).toEqual([10000, 20000]);
    expect(state.elapsedMs).toBe(40000);
    expect(stopwatchState(w, at(30))).toMatchObject({ status: 'paused', elapsedMs: 20000 });
  });

  it('refuse les commandes sans objet', () => {
    const paused = withCommands(sw, ['pause', 10]);
    expect(stopwatchCommand(paused, 'lap', at(15))).toBe(paused);
    expect(stopwatchCommand(paused, 'pause', at(15))).toBe(paused);
    expect(stopwatchCommand(sw, 'resume', at(5))).toBe(sw);
    expect(stopwatchCommand(paused, 'resume', at(5))).toBe(paused);
  });

  it("se recalcule juste quand l'horloge saute (arrière-plan, écran éteint)", () => {
    const w = withCommands(sw, ['lap', 10]);
    expect(stopwatchState(w, at(3610)).elapsedMs).toBe(3_610_000);
    expect(stopwatchState(w, at(3610)).currentLapMs).toBe(3_600_000);
    // Une commande postérieure à l'instant demandé n'y compte pas.
    expect(stopwatchState(w, at(5)).laps).toEqual([]);
  });

  it("relit le chrono gardé, en écartant ce qui est abîmé", () => {
    const w = withCommands(sw, ['lap', 10], ['pause', 20]);
    expect(readStopwatch(JSON.parse(JSON.stringify(w)))).toEqual(w);
    expect(readStopwatch(null)).toBeNull();
    expect(readStopwatch({ startedAtMs: 'x', commands: [] })).toBeNull();
    expect(readStopwatch({ startedAtMs: T0, commands: [{ kind: 'reset', atMs: T0 }, { kind: 'lap', atMs: at(1) }, 3] }))
      .toEqual({ startedAtMs: T0, commands: [{ kind: 'lap', atMs: at(1) }] });
  });

  it('affiche le temps au dixième', () => {
    expect(formatStopwatch(0)).toBe('0:00.0');
    expect(formatStopwatch(83_490)).toBe('1:23.4');
    expect(formatStopwatch(3_723_400)).toBe('1:02:03.4');
    expect(formatStopwatch(-5)).toBe('0:00.0');
  });
});
