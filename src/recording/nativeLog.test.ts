import { describe, expect, it, vi } from 'vitest';
import { SPORT_PROFILES } from '../core/sportProfiles';
import type { LocationFix } from '../platform/location';
import { sameData } from '../test/sameData';
import {
  journalBreakLine, journalFixLine, journalHeaderLine, journalPauseLine, journalResumeLine, journalStopLine, parseJournal,
  type JournalPause, type ParsedJournal,
} from './journal';
import {
  NATIVE_LOG_FORMAT, NATIVE_LOG_VERSION, catchUpFromNativeLog, parseNativeLog, withCaughtUpLines, type CatchUpPhase, type CatchUpSettings,
} from './nativeLog';
import { judgeSettle } from './gpsSettle';
import { rebuildRecordingStats } from './resume';
import { evaluateAutoPause, isNewerFix, recordingDurationMs, roundFix, splitIntoSegments } from './session';

const SESSION = Date.UTC(2026, 10, 15, 9, 0, 0);
const T0 = SESSION + 2000;
const at = (s: number): number => T0 + Math.round(s * 1000);
/** Pause automatique sous 0,3 m/s pendant 10 s : assez courte pour une trace d'essai. */
const SETTINGS: CatchUpSettings = {
  ...SPORT_PROFILES.wingfoil.recording, autoPauseSpeedMs: 0.3, autoPauseDelayS: 10, maxGapS: SPORT_PROFILES.wingfoil.maxGapS,
};
const SAILING = 5;
const STILL = 0.05;

type Step =
  | { kind: 'fix'; fix: LocationFix }
  | { kind: 'pause' | 'resume' | 'start'; atMs: number }
  | { kind: 'stop'; atMs: number; reason: string };

/** Position brute, comme le téléphone la donne : plus de décimales que le journal n'en garde. */
const rawFix = (s: number, speedMs: number, northM: number): LocationFix => ({
  timeMs: at(s),
  lat: 47.5 + northM / 111_320 + 1.23e-8,
  lon: -3.123456789,
  accuracyM: 3.4567,
  altitudeM: 1.2345,
  speedMs: speedMs + 0.0049,
  bearingDeg: 12.3456,
});

/** Ce que le service a vu, dans l'ordre : positions à `hz` Hz, ordres de pause, relance, arrêt par la garde. */
const trace = (hz: number) => {
  const steps: Step[] = [];
  let index = 0;
  let northM = 0;
  const api = {
    steps,
    /** Positions jusqu'à `untilS`, exclu, à `speedMs`. */
    run(untilS: number, speedMs: number) {
      for (; index / hz < untilS; index++) {
        northM += speedMs / hz;
        steps.push({ kind: 'fix', fix: rawFix(index / hz, speedMs, northM) });
      }
      return api;
    },
    /** Aucune position jusqu'à `s`. */
    silentUntil(s: number) {
      index = Math.ceil(s * hz);
      return api;
    },
    pause(s: number) {
      steps.push({ kind: 'pause', atMs: at(s) });
      return api;
    },
    resume(s: number) {
      steps.push({ kind: 'resume', atMs: at(s) });
      return api;
    },
    start(s: number) {
      steps.push({ kind: 'start', atMs: at(s) });
      return api;
    },
    stop(s: number, reason: string) {
      steps.push({ kind: 'stop', atMs: at(s), reason });
      return api;
    },
  };
  return api;
};

const headerLine = (session: number): string => JSON.stringify({ format: NATIVE_LOG_FORMAT, version: NATIVE_LOG_VERSION, session });

const nativeLine = (step: Step): string => {
  if (step.kind === 'stop') return JSON.stringify(['stop', step.atMs, step.reason]);
  if (step.kind !== 'fix') return JSON.stringify([step.kind, step.atMs]);
  const { timeMs, lat, lon, accuracyM, altitudeM, speedMs, bearingDeg } = step.fix;
  return JSON.stringify([timeMs, lat, lon, accuracyM ?? null, altitudeM ?? null, speedMs ?? null, bearingDeg ?? null]);
};

/** Le fichier du service, tel qu'il l'écrit. */
const nativeText = (steps: Step[], session = SESSION): string => `${[headerLine(session), ...steps.map(nativeLine)].join('\n')}\n`;

const nativeLog = (steps: Step[]) => parseNativeLog(nativeText(steps));

/**
 * La page en direct, réduite à ce qu'elle écrit dans son journal et garde en mémoire : les règles de la réception
 * d'une position et des boutons de pause, écrites à part du rattrapage pour lui servir de référence. Son horloge est
 * l'heure des positions.
 */
const livePage = (settings: CatchUpSettings) => {
  const auto = { speedMs: settings.autoPauseSpeedMs, delayS: settings.autoPauseDelayS };
  const lines: string[] = [journalHeaderLine('wingfoil', SESSION)];
  let manualPause: JournalPause | null = null;
  let autoPausedSinceMs: number | null = null;
  let belowSinceMs: number | null = null;
  let pendingBreak = false;
  let manualBreakAutoPartMs: number | null = null;
  let lastReceivedMs: number | null = null;
  let settled = false;
  let settleFirstMs: number | null = null;
  const receive = (received: LocationFix): void => {
    if (!isNewerFix(lastReceivedMs, received)) return;
    const fix = roundFix(received);
    lastReceivedMs = fix.timeMs;
    if (manualPause) return;
    if (!settled) {
      const verdict = judgeSettle(settleFirstMs, fix, settings);
      settleFirstMs = verdict.settled ? null : verdict.firstSeenMs;
      if (!verdict.settled) return;
      settled = true;
    }
    const judged = evaluateAutoPause(autoPausedSinceMs !== null, belowSinceMs, fix, auto);
    belowSinceMs = judged.belowSinceMs;
    if (judged.event === 'pause') {
      autoPausedSinceMs = fix.timeMs;
      return;
    }
    if (judged.event === 'resume') {
      pendingBreak = true;
      autoPausedSinceMs = null;
    }
    if (autoPausedSinceMs !== null) return;
    if (pendingBreak) lines.push(journalBreakLine(fix.timeMs));
    pendingBreak = false;
    lines.push(journalFixLine(fix));
    manualBreakAutoPartMs = null;
  };
  return {
    lines,
    play(step: Step): void {
      if (step.kind === 'fix') receive(step.fix);
      else if (step.kind === 'pause' && !manualPause) {
        manualPause = { atMs: step.atMs, autoPartMs: step.atMs - (autoPausedSinceMs ?? step.atMs) };
        autoPausedSinceMs = null;
        belowSinceMs = null;
        lines.push(journalPauseLine(manualPause.atMs, manualPause.autoPartMs));
      } else if (step.kind === 'resume' && manualPause) {
        pendingBreak = true;
        manualBreakAutoPartMs = manualPause.autoPartMs;
        manualPause = null;
        belowSinceMs = null;
        lines.push(journalResumeLine(step.atMs));
      }
    },
    phase: (): CatchUpPhase => ({ manualPause, autoPausedSinceMs, belowSinceMs, pendingBreak, manualBreakAutoPartMs, lastReceivedMs, settleFirstMs }),
  };
};

/** La page qui a tout reçu en direct : son journal, et ce qu'elle a en mémoire à la fin. */
const liveSession = (steps: Step[], settings = SETTINGS) => {
  const page = livePage(settings);
  steps.forEach((step) => page.play(step));
  return { lines: page.lines, text: page.lines.join(''), phase: page.phase() };
};

/** Ce qui fait une session relue : positions, segments, statistiques, pause en cours. */
const sessionOf = (parsed: ParsedJournal) => ({
  fixes: parsed.fixes,
  breaks: parsed.breaks,
  segments: splitIntoSegments(parsed.fixes, parsed.breaks).map((segment) => segment.length),
  stats: rebuildRecordingStats(parsed.fixes, parsed.manualBreaks.map((b) => ({ index: b.fixIndex, autoPartMs: b.autoPartMs }))),
  openPause: parsed.openPause,
  resumedPause: parsed.resumedPause,
});

/** Rattrape le journal `text` de la page, et rend ce qu'il devient. */
const caughtUp = (text: string, steps: Step[], settings = SETTINGS) => {
  const result = catchUpFromNativeLog(parseJournal(text), nativeLog(steps), settings);
  const merged = withCaughtUpLines(text, result.lines);
  return { result, merged, parsed: parseJournal(merged) };
};

/** Journal de la page coupé juste avant sa première position de `fromS` ou plus tard : la queue perdue. */
const cutBefore = (lines: string[], fromS: number): string => {
  const firstLost = lines.findIndex((line, i) => {
    const value: unknown = JSON.parse(line);
    return i > 0 && Array.isArray(value) && typeof value[0] === 'number' && value[0] >= at(fromS);
  });
  return lines.slice(0, firstLost < 0 ? lines.length : firstLost).join('');
};

/**
 * Une sortie avec tout ce qui ouvre un segment : arrêt et pause automatique, pause manuelle en route, pause
 * automatique devenue manuelle, levée à l'arrêt.
 */
const outing = (hz: number): Step[] =>
  trace(hz)
    .run(20, SAILING)
    .run(35, STILL)
    .run(50.45, SAILING)
    .pause(50.45).run(62.35, SAILING).resume(62.35)
    .run(70, SAILING)
    .run(84.25, STILL)
    .pause(84.25).run(88.65, STILL).resume(88.65)
    .run(104, STILL)
    .run(115, SAILING)
    .steps;

describe('parseNativeLog', () => {
  it('relit en-tête, positions, pauses, relance et arrêt par la garde, dans l\'ordre du fichier', () => {
    const text = [
      headerLine(SESSION),
      `[${at(1)},47.123456789,-3.123456789,4.25,12.345,3.456,187.45]`,
      `[${at(2)},47.1234571,-3.1234569,null,null,null,null]`,
      `["pause",${at(3)}]`,
      `["resume",${at(4)}]`,
      '',
      `["start",${at(5)}]`,
      `["stop",${at(6)},"still"]`,
      '',
    ].join('\n');
    expect(parseNativeLog(text)).toEqual({
      session: SESSION,
      entries: [
        { kind: 'fix', fix: { timeMs: at(1), lat: 47.123456789, lon: -3.123456789, accuracyM: 4.25, altitudeM: 12.345, speedMs: 3.456, bearingDeg: 187.45 } },
        { kind: 'fix', fix: { timeMs: at(2), lat: 47.1234571, lon: -3.1234569, accuracyM: undefined, altitudeM: undefined, speedMs: undefined, bearingDeg: undefined } },
        { kind: 'pause', atMs: at(3) },
        { kind: 'resume', atMs: at(4) },
        { kind: 'start', atMs: at(5) },
        { kind: 'stop', atMs: at(6), reason: 'still' },
      ],
    });
  });

  it('ignore la dernière ligne tronquée, une ligne illisible ou inconnue, et garde le reste', () => {
    const text = [
      headerLine(SESSION),
      `[${at(1)},47.1,-3.1]`,
      'pas du JSON',
      '["inconnu",12]',
      '["pause","tôt"]',
      `[${at(2)},"47.1",-3.1]`,
      `["stop",${at(3)},"autre"]`,
      `[${at(4)},47.2,-3.2,4.5,1`,
    ].join('\n');
    const log = parseNativeLog(text);
    expect(log?.entries.map((entry) => entry.kind)).toEqual(['fix', 'stop']);
    expect(log?.entries[1]).toEqual({ kind: 'stop', atMs: at(3), reason: null });
  });

  it('sans en-tête lisible, ou d\'une autre version : rien', () => {
    expect(parseNativeLog(null)).toBeNull();
    expect(parseNativeLog('')).toBeNull();
    expect(parseNativeLog(`[${at(1)},47.1,-3.1]\n`)).toBeNull();
    expect(parseNativeLog(`${headerLine(SESSION).slice(0, 30)}\n[${at(1)},47.1,-3.1]\n`)).toBeNull();
    expect(parseNativeLog(`${JSON.stringify({ format: NATIVE_LOG_FORMAT, version: 2, session: SESSION })}\n`)).toBeNull();
    expect(parseNativeLog(`${JSON.stringify({ format: 'tracker-journal', version: 1, session: SESSION })}\n`)).toBeNull();
  });
});

describe.each([1, 5])('rattrapage à %i Hz', (hz) => {
  it('journal coupé n\'importe où, puis rattrapé : la session de la page qui a tout reçu en direct', () => {
    const steps = outing(hz);
    const live = liveSession(steps);
    const expected = sessionOf(parseJournal(live.text));
    // La sortie d'essai passe bien par tout : quatre reprises, donc cinq segments, et du temps de pause manuelle.
    expect(expected.segments).toHaveLength(5);
    expect(expected.stats.manualPausedMs).toBeGreaterThan(10_000);
    const log = nativeLog(steps);
    for (let kept = 1; kept <= live.lines.length; kept++) {
      const text = live.lines.slice(0, kept).join('');
      const result = catchUpFromNativeLog(parseJournal(text), log, SETTINGS);
      const merged = parseJournal(withCaughtUpLines(text, result.lines));
      // Boucle chaude : l'assertion n'est fabriquée que si la garde voit un écart (`sameData` vrai entraîne `toEqual` vrai).
      if (!sameData(sessionOf(merged), expected)) expect(sessionOf(merged), `coupé après ${kept} lignes`).toEqual(expected);
      if (!sameData(result.phase, live.phase)) expect(result.phase, `coupé après ${kept} lignes`).toEqual(live.phase);
      // Rejoué sur le journal complété : rien de plus.
      const again = catchUpFromNativeLog(merged, log, SETTINGS);
      if (!sameData(again.lines, [])) expect(again.lines, `rejoué, coupé après ${kept} lignes`).toEqual([]);
      if (!sameData(again.phase, result.phase)) expect(again.phase, `rejoué, coupé après ${kept} lignes`).toEqual(result.phase);
    }
  });

  it('GPS qui se cale au départ, application fermée : la trace part de la première position calée, comme en direct', () => {
    // Incertitude de 30 m les trois premières secondes, puis celle de `rawFix`, sous le seuil du calage.
    const settling = (steps: Step[]): Step[] =>
      steps.map((step) => (step.kind === 'fix' && step.fix.timeMs < at(3) ? { kind: 'fix', fix: { ...step.fix, accuracyM: 30 } } : step));
    const steps = settling(trace(hz).run(20, SAILING).steps);
    const live = liveSession(steps);
    expect(parseJournal(live.text).fixes[0].timeMs).toBe(at(3));
    expect(live.phase.settleFirstMs).toBeNull();
    const log = nativeLog(steps);
    for (let kept = 1; kept <= live.lines.length; kept++) {
      const text = live.lines.slice(0, kept).join('');
      const result = catchUpFromNativeLog(parseJournal(text), log, SETTINGS);
      const merged = parseJournal(withCaughtUpLines(text, result.lines));
      expect(sessionOf(merged), `coupé après ${kept} lignes`).toEqual(sessionOf(parseJournal(live.text)));
      expect(result.phase, `coupé après ${kept} lignes`).toEqual(live.phase);
    }

    // Fermée avant la fin du calage : rien de gardé, et la première position vue est rendue pour la suite en direct.
    const early = settling(trace(hz).run(2, SAILING).steps);
    const header = liveSession([]).text;
    const still = caughtUp(header, early);
    expect(still.result.lines).toEqual([]);
    expect(still.result.phase.settleFirstMs).toBe(at(0));
    expect(still.result.phase).toEqual(liveSession(early).phase);
    expect(still.result.caughtUpToMs).toBe(at(2 - 1 / hz));
  });

  it('les positions rattrapées sont arrondies comme en direct, et ne portent pas de fréquence cardiaque', () => {
    const steps = trace(hz).run(20, SAILING).steps;
    const live = liveSession(steps);
    const { result } = caughtUp(cutBefore(live.lines, 8), steps);
    expect(result.lines).toEqual(live.lines.filter((line) => (JSON.parse(line) as number[])[0] >= at(8)));
    expect(result.keptCount).toBe(result.lines.length);
    expect(result.lines.every((line) => (JSON.parse(line) as unknown[]).length === 7)).toBe(true);
    expect(result.caughtUpToMs).toBe(at(20 - 1 / hz));
  });

  it('pause manuelle ouverte à la coupure : rien n\'est gardé, jusqu\'à sa levée', () => {
    const paused = trace(hz).run(10.45, SAILING).pause(10.45).run(30.35, SAILING);
    const text = liveSession(paused.steps).text;
    const still = caughtUp(text, paused.steps);
    expect(still.result.lines).toEqual([]);
    expect(still.result.phase.manualPause).toEqual({ atMs: at(10.45), autoPartMs: 0 });
    expect(still.result.phase.pendingBreak).toBe(false);
    expect(still.result.caughtUpToMs).toBe(hz === 1 ? at(30) : at(30.2));

    // La levée, que la page n'a pas vue, puis la suite : un segment neuf, et la pause hors de la durée.
    const lifted = paused.resume(30.35).run(40, SAILING).steps;
    const live = liveSession(lifted);
    const after = caughtUp(text, lifted);
    expect(after.result.lines[0]).toBe(journalResumeLine(at(30.35)));
    expect(sessionOf(after.parsed)).toEqual(sessionOf(parseJournal(live.text)));
    expect(sessionOf(after.parsed).segments).toHaveLength(2);
    expect(after.result.phase).toEqual(live.phase);
    expect(after.result.phase.manualPause).toBeNull();
  });

  it('pause posée dans la queue perdue du journal : écrite à son heure, rien de gardé ensuite', () => {
    const steps = trace(hz).run(20.45, SAILING).pause(20.45).run(40, SAILING).steps;
    const live = liveSession(steps);
    // Les cinq dernières secondes avant la pause, et la pause, n'ont pas été écrites.
    const text = cutBefore(live.lines, 15);
    expect(parseJournal(text).openPause).toBeNull();
    const { result, parsed } = caughtUp(text, steps);
    expect(result.lines[result.lines.length - 1]).toBe(journalPauseLine(at(20.45)));
    expect(result.keptCount).toBe(result.lines.length - 1);
    expect(sessionOf(parsed)).toEqual(sessionOf(parseJournal(live.text)));
    expect(parsed.openPause).toEqual({ atMs: at(20.45), autoPartMs: 0 });
    expect(result.phase).toEqual(live.phase);
    expect(parsed.fixes[parsed.fixes.length - 1].timeMs).toBeLessThan(at(20.45));
  });

  it('pause puis levée déjà au journal, sans position gardée depuis : les positions de la pause ne reviennent pas', () => {
    const steps = trace(hz).run(10.45, SAILING).pause(10.45).run(20.35, SAILING).resume(20.35).run(30, SAILING).steps;
    const live = liveSession(steps);
    const text = live.lines.slice(0, live.lines.indexOf(journalResumeLine(at(20.35))) + 1).join('');
    const { result, parsed } = caughtUp(text, steps);
    expect(result.lines[0]).toBe(journalBreakLine(parsed.fixes[parsed.breaks[0]].timeMs));
    expect(parsed.fixes.some((fix) => fix.timeMs > at(10.45) && fix.timeMs < at(20.35))).toBe(false);
    expect(sessionOf(parsed)).toEqual(sessionOf(parseJournal(live.text)));

    // L'ordre du service horodaté quelques millisecondes après la ligne de la page : la même levée, pas une autre.
    const late = steps.map((step) => (step.kind === 'resume' ? { ...step, atMs: step.atMs + 40 } : step));
    expect(sessionOf(caughtUp(text, late).parsed)).toEqual(sessionOf(parseJournal(live.text)));
  });

  it('pause automatique à cheval sur la coupure : jugée sur l\'heure des positions, reprise dans un segment neuf', () => {
    const steps = trace(hz).run(10, SAILING).run(40, STILL).run(50, SAILING).steps;
    const live = liveSession(steps);
    // Coupé 4 s après l'arrêt : l'ancre de la pause est dans le journal de la page, son déclenchement dans celui du service.
    const { result, parsed } = caughtUp(cutBefore(live.lines, 14), steps);
    expect(sessionOf(parsed)).toEqual(sessionOf(parseJournal(live.text)));
    expect(result.phase).toEqual(live.phase);
    expect(parsed.fixes.some((fix) => fix.timeMs >= at(20) && fix.timeMs < at(40))).toBe(false);
    expect(parsed.fixes[parsed.breaks[0]].timeMs).toBe(at(40));

    // Le service s'arrête là, en pleine pause automatique : elle est rendue en cours, à l'heure de son déclenchement.
    const untilPause = steps.filter((step) => step.kind !== 'fix' || step.fix.timeMs < at(30));
    const inPause = caughtUp(cutBefore(live.lines, 14), untilPause);
    expect(inPause.result.phase.autoPausedSinceMs).toBe(at(20));
    expect(inPause.result.phase.pendingBreak).toBe(false);
    expect(inPause.parsed.fixes[inPause.parsed.fixes.length - 1].timeMs).toBeLessThan(at(20));
    expect(inPause.result.caughtUpToMs).toBe(at(30 - 1 / hz));
  });

  it('une seule position couvrant 40 s, service resté en marche : un trou de la trace, pas un segment', () => {
    const sailing = trace(hz).run(10, SAILING).silentUntil(50).run(50.1, SAILING).steps;
    const live = liveSession(sailing);
    const text = cutBefore(live.lines, 10);
    const moving = caughtUp(text, sailing);
    expect(moving.result.lines).toEqual([live.lines[live.lines.length - 1]]);
    expect(sessionOf(moving.parsed)).toEqual(sessionOf(parseJournal(live.text)));
    expect(moving.parsed.breaks).toEqual([]);
    expect(sessionOf(moving.parsed).stats.longestGapS).toBeCloseTo(40 + 1 / hz, 6);

    // À l'arrêt depuis 2 s à la coupure : la position suivante, 40 s plus tard, déclenche la pause automatique à elle seule.
    const stopped = trace(hz).run(8, SAILING).run(10, STILL).silentUntil(50).run(50.1, STILL).steps;
    const stoppedLive = liveSession(stopped);
    const still = caughtUp(cutBefore(stoppedLive.lines, 10), stopped);
    expect(still.result.lines).toEqual([]);
    expect(still.result.phase.autoPausedSinceMs).toBe(at(50));
    expect(still.result.phase).toEqual(stoppedLive.phase);
  });

  it('journal du service qui ne remonte pas jusqu\'à la dernière position de la page : segment neuf au-delà de maxGapS', () => {
    const steps = trace(hz).run(10, SAILING).silentUntil(50).run(55, SAILING).steps;
    const text = liveSession(steps.filter((step) => step.kind === 'fix' && step.fix.timeMs < at(10))).text;
    const afterGap = steps.filter((step) => step.kind === 'fix' && step.fix.timeMs >= at(50));
    const far = caughtUp(text, afterGap);
    expect(far.result.lines[0]).toBe(journalBreakLine(at(50)));
    expect(sessionOf(far.parsed).segments).toHaveLength(2);
    expect(catchUpFromNativeLog(far.parsed, nativeLog(afterGap), SETTINGS).lines).toEqual([]);

    // À moins de maxGapS, c'est un pas ordinaire.
    const close = trace(hz).run(10, SAILING).silentUntil(15).run(20, SAILING).steps.filter((step) => step.kind === 'fix' && step.fix.timeMs >= at(15));
    const near = caughtUp(text, close);
    expect(near.parsed.breaks).toEqual([]);
    expect(near.result.keptCount).toBe(5 * hz);

    // Sans aucune position, rien ne prouve que le service tournait : la suivante ouvrira un segment.
    const empty = caughtUp(text, []);
    expect(empty.result.matched).toBe(true);
    expect(empty.result.lines).toEqual([]);
    expect(empty.result.phase.pendingBreak).toBe(true);
  });

  it('service relancé en route : la suite ouvre un segment', () => {
    const steps = trace(hz).run(10, SAILING).silentUntil(100).start(100).run(110, SAILING).steps;
    const text = liveSession(steps.filter((step) => step.kind === 'fix' && step.fix.timeMs < at(5))).text;
    const { result, parsed } = caughtUp(text, steps);
    expect(parsed.fixes).toHaveLength(20 * hz);
    expect(parsed.fixes[parsed.breaks[0]].timeMs).toBe(at(100));
    expect(parsed.breaks).toHaveLength(1);
    expect(result.phase.pendingBreak).toBe(false);
  });

  it('journal du service absent, illisible ou d\'une autre session : rien n\'est ajouté, la coupure reste un segment', () => {
    const steps = trace(hz).run(20, SAILING).steps;
    const journal = parseJournal(cutBefore(liveSession(steps).lines, 10));
    const asToday = {
      matched: false, lines: [], keptCount: 0, caughtUpToMs: null, guardStop: null,
      phase: { manualPause: null, autoPausedSinceMs: null, belowSinceMs: null, pendingBreak: true, manualBreakAutoPartMs: null, lastReceivedMs: at(10 - 1 / hz), settleFirstMs: null },
    };
    expect(catchUpFromNativeLog(journal, null, SETTINGS)).toEqual(asToday);
    expect(catchUpFromNativeLog(journal, parseNativeLog('illisible'), SETTINGS)).toEqual(asToday);
    expect(catchUpFromNativeLog(journal, parseNativeLog(nativeText(steps, SESSION + 1)), SETTINGS)).toEqual(asToday);
    // Journal de la page sans en-tête lisible : sa session est inconnue.
    expect(catchUpFromNativeLog({ ...journal, header: null }, nativeLog(steps), SETTINGS)).toEqual(asToday);

    // Pause manuelle en cours : elle le reste, et sa levée ouvrira le segment.
    const paused = parseJournal(liveSession(trace(hz).run(10.45, SAILING).pause(10.45).steps).text);
    const kept = catchUpFromNativeLog(paused, null, SETTINGS);
    expect(kept.phase.manualPause).toEqual({ atMs: at(10.45), autoPartMs: 0 });
    expect(kept.phase.pendingBreak).toBe(false);
  });

  it('dernière ligne tronquée, côté service comme côté page : ignorée, le reste est rattrapé', () => {
    const steps = trace(hz).run(20, SAILING).steps;
    const live = liveSession(steps);
    const expected = sessionOf(parseJournal(live.lines.slice(0, -1).join('')));
    // Le service a été tué en écrivant sa dernière position, la page en écrivant la sienne.
    const cutNative = nativeText(steps).slice(0, -20);
    const cutJournal = `${cutBefore(live.lines, 10)}[${at(10)},47.5`;
    const result = catchUpFromNativeLog(parseJournal(cutJournal), parseNativeLog(cutNative), SETTINGS);
    expect(sessionOf(parseJournal(withCaughtUpLines(cutJournal, result.lines)))).toEqual(expected);
    expect(result.caughtUpToMs).toBe(at(20 - 2 / hz));
  });

  it('doublons et positions redélivrées : chacune une seule fois, dans l\'ordre', () => {
    const steps = trace(hz).run(20, SAILING).steps;
    const live = liveSession(steps);
    // Chaque position écrite deux fois, et une vieille position redélivrée à la fin.
    const doubled = [...steps.flatMap((step) => [step, step]), steps[0], steps[steps.length - 3]];
    const text = cutBefore(live.lines, 10);
    const { result, parsed } = caughtUp(text, doubled);
    expect(result.lines).toEqual(caughtUp(text, steps).result.lines);
    expect(sessionOf(parsed)).toEqual(sessionOf(parseJournal(live.text)));
    expect(result.phase.lastReceivedMs).toBe(at(20 - 1 / hz));
  });

  it('arrêt par la garde : la trace entière jusqu\'à lui, sa ligne « stop », et rien après', () => {
    const steps = trace(hz).run(20, SAILING).stop(3620, 'still').silentUntil(3630).run(3640, SAILING).steps;
    const live = liveSession(steps.filter((step) => step.kind === 'fix' && step.fix.timeMs < at(20)));
    const text = cutBefore(live.lines, 12);
    const { result, parsed } = caughtUp(text, steps);
    expect(result.guardStop).toEqual({ atMs: at(3620), reason: 'still' });
    expect(result.lines[result.lines.length - 1]).toBe(journalStopLine(at(3620)));
    expect(parsed.stoppedAtMs).toBe(at(3620));
    expect(parsed.fixes).toEqual(parseJournal(live.text).fixes);

    // Rejoué : la garde est toujours dite, sa ligne n'est pas récrite.
    const again = catchUpFromNativeLog(parsed, nativeLog(steps), SETTINGS);
    expect(again.lines).toEqual([]);
    expect(again.guardStop).toEqual({ atMs: at(3620), reason: 'still' });
  });

  it('« Arrêter » déjà au journal de la page : les positions d\'avant sont rattrapées, pas celles d\'après', () => {
    const steps = trace(hz).run(30, SAILING).steps;
    const live = liveSession(steps.filter((step) => step.kind === 'fix' && step.fix.timeMs <= at(20)));
    const text = `${cutBefore(live.lines, 12)}${journalStopLine(at(20))}`;
    const { result, parsed } = caughtUp(text, steps);
    expect(parsed.fixes).toEqual(parseJournal(live.text).fixes);
    expect(parsed.breaks).toEqual([]);
    expect(result.guardStop).toBeNull();
    expect(result.caughtUpToMs).toBe(at(30 - 1 / hz));
  });
});

describe('rattrapage, 1 Hz contre 5 Hz', () => {
  it('mêmes segments, même durée à une cadence près', () => {
    const [slow, fast] = [1, 5].map((hz) => {
      const steps = outing(hz);
      const live = liveSession(steps);
      return sessionOf(caughtUp(cutBefore(live.lines, 25), steps).parsed);
    });
    expect(fast.segments).toHaveLength(slow.segments.length);
    expect(Math.abs(recordingDurationMs(fast.stats) - recordingDurationMs(slow.stats))).toBeLessThanOrEqual(4000);
    // Deux pauses manuelles, chacune bornée par une position de chaque côté : un pas à 1 Hz par borne.
    expect(Math.abs((fast.stats.manualPausedMs ?? 0) - (slow.stats.manualPausedMs ?? 0))).toBeLessThanOrEqual(4000);
  });
});

describe('catchUpFromNativeLog', () => {
  it('ne lit aucune horloge', () => {
    const now = vi.spyOn(Date, 'now');
    try {
      const steps = outing(1);
      const text = cutBefore(liveSession(steps).lines, 25);
      catchUpFromNativeLog(parseJournal(text), parseNativeLog(nativeText(steps)), SETTINGS);
      expect(now).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });
});

describe.each([1, 5])('rattrapage à %i Hz, réglages du profil', (hz) => {
  /** Incertitude de 30 m jusqu'à `untilS`, puis celle de `rawFix`, sous le seuil du calage. */
  const loose = (steps: Step[], untilS: number): Step[] =>
    steps.map((step) => (step.kind === 'fix' && step.fix.timeMs < at(untilS) ? { kind: 'fix', fix: { ...step.fix, accuracyM: 30 } } : step));

  it('calage lu dans le profil : à 0 s, aucun calage, la première position est gardée', () => {
    const steps = loose(trace(hz).run(20, SAILING).steps, 3);
    const header = liveSession([]).text;
    const without = { ...SETTINGS, settleMaxWaitS: 0 };
    const { result, parsed } = caughtUp(header, steps, without);
    expect(parsed.fixes[0].timeMs).toBe(at(0));
    expect(result.keptCount).toBe(20 * hz);
    expect(result.phase).toEqual(liveSession(steps, without).phase);
  });

  it('GPS jamais calé : la trace part au bout du délai du profil, à l\'heure des positions', () => {
    const steps = loose(trace(hz).run(20, SAILING).steps, 20);
    const { parsed } = caughtUp(liveSession([]).text, steps);
    expect(parsed.fixes[0].timeMs).toBe(at(SETTINGS.settleMaxWaitS));
    expect(sessionOf(parsed)).toEqual(sessionOf(parseJournal(liveSession(steps).text)));
  });

  it('une seule position qui couvre tout le délai du calage : gardée, la trace part d\'elle', () => {
    const steps = loose(trace(hz).run(1 / hz, SAILING).silentUntil(40).run(45, SAILING).steps, 45);
    const { result, parsed } = caughtUp(liveSession([]).text, steps);
    expect(parsed.fixes[0].timeMs).toBe(at(40));
    expect(result.phase.settleFirstMs).toBeNull();
    expect(result.phase).toEqual(liveSession(steps).phase);
  });

  it('arrêt par la garde au bout de la durée maximale : raison « timeout », rien après', () => {
    const steps = trace(hz).run(20, SAILING).stop(12 * 3600, 'timeout').run(12 * 3600 + 5, SAILING).steps;
    const live = liveSession(steps.filter((step) => step.kind === 'fix' && step.fix.timeMs < at(20)));
    const { result, parsed } = caughtUp(cutBefore(live.lines, 12), steps);
    expect(result.guardStop).toEqual({ atMs: at(12 * 3600), reason: 'timeout' });
    expect(parsed.stoppedAtMs).toBe(at(12 * 3600));
    expect(parsed.fixes).toEqual(parseJournal(live.text).fixes);
  });
});
