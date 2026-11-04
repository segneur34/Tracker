import { describe, expect, it } from 'vitest';
import { journalBreakLine, journalFixLine, journalHeaderLine, journalPauseLine, journalResumeLine, journalStopLine, parseJournal } from './journal';
import { NO_RECOVERY_SERVICES, continuedPause, rebuildRecordingStats, recoveryDecision, resumedPhase, type RecoveryFacts } from './resume';
import { EMPTY_RECORDING_STATS, addFixAfterManualPause, addFixToStats, recordingDurationMs, displayedDurationMs, type RecordingStats } from './session';

const T0 = Date.UTC(2026, 10, 4, 9, 0, 0);
const OFFER_S = 600;
const GPS_ALIVE = { gps: true, belt: false };

const facts = (patch: Partial<NonNullable<RecoveryFacts['journal']>> = {}, rest: Partial<RecoveryFacts> = {}): RecoveryFacts => ({
  journal: { hasHeader: true, stopped: false, lastLineMs: T0, withPositions: true, ...patch },
  services: NO_RECOVERY_SERVICES,
  nowMs: T0,
  offerMaxAgeS: OFFER_S,
  ...rest,
});

describe('recoveryDecision', () => {
  it('service vivant et journal : reprise, quel que soit son âge', () => {
    expect(recoveryDecision(facts({}, { services: GPS_ALIVE }))).toBe('resume');
    expect(recoveryDecision(facts({}, { services: GPS_ALIVE, nowMs: T0 + 5 * 3600_000 }))).toBe('resume');
  });

  it('sans position, c\'est le service de la ceinture qui vaut preuve, pas celui du GPS', () => {
    expect(recoveryDecision(facts({ withPositions: false }, { services: { gps: false, belt: true } }))).toBe('resume');
    expect(recoveryDecision(facts({ withPositions: false }, { services: GPS_ALIVE }))).toBe('offer');
    expect(recoveryDecision(facts({ withPositions: true }, { services: { gps: false, belt: true } }))).toBe('offer');
  });

  it('application tuée : « Continuer » proposé à 9 min 59, plus à 10 min ni à 10 min 01', () => {
    expect(recoveryDecision(facts({}, { nowMs: T0 + 599_000 }))).toBe('offer');
    expect(recoveryDecision(facts({}, { nowMs: T0 + 600_000 }))).toBe('pending');
    expect(recoveryDecision(facts({}, { nowMs: T0 + 601_000 }))).toBe('pending');
  });

  it('âge négatif (horloge reculée) ou sans horodatage : pas d\'offre', () => {
    expect(recoveryDecision(facts({}, { nowMs: T0 - 1000 }))).toBe('pending');
    expect(recoveryDecision(facts({ lastLineMs: null }))).toBe('pending');
  });

  it('une ligne « stop » : ni reprise ni offre, service vivant compris', () => {
    expect(recoveryDecision(facts({ stopped: true }))).toBe('pending');
    expect(recoveryDecision(facts({ stopped: true }, { services: GPS_ALIVE }))).toBe('pending');
  });

  it('journal illisible (sans en-tête) : en attente, service vivant compris', () => {
    expect(recoveryDecision(facts({ hasHeader: false }))).toBe('pending');
    expect(recoveryDecision(facts({ hasHeader: false }, { services: GPS_ALIVE }))).toBe('pending');
  });

  it('sans journal : rien, sauf un service qui tourne pour personne', () => {
    expect(recoveryDecision({ journal: null, services: NO_RECOVERY_SERVICES, nowMs: T0, offerMaxAgeS: OFFER_S })).toBe('none');
    expect(recoveryDecision({ journal: null, services: GPS_ALIVE, nowMs: T0, offerMaxAgeS: OFFER_S })).toBe('stopServices');
    expect(recoveryDecision({ journal: null, services: { gps: false, belt: true }, nowMs: T0, offerMaxAgeS: OFFER_S })).toBe('stopServices');
  });
});

/** Temps de `n` points à `hz` Hz depuis `fromS`. */
const times = (fromS: number, toS: number, hz: number): number[] => {
  const out: number[] = [];
  for (let k = Math.round(fromS * hz); k <= Math.round(toS * hz); k++) out.push(T0 + Math.round((k / hz) * 1000));
  return out;
};

describe.each([[1], [5]])('statistiques refaites depuis le journal, à %i Hz', (hz) => {
  /** Une session vécue point à point : course, pause manuelle levée, course, pause automatique devenue manuelle, course. */
  const lived = () => {
    let stats: RecordingStats = EMPTY_RECORDING_STATS;
    const first = times(0, 60, hz);
    const second = times(120, 180, hz);
    const third = times(300, 360, hz);
    first.forEach((timeMs) => { stats = addFixToStats(stats, { timeMs, accuracyM: 4 }); });
    second.forEach((timeMs, i) => { stats = i === 0 ? addFixAfterManualPause(stats, { timeMs, accuracyM: 4 }, 0) : addFixToStats(stats, { timeMs, accuracyM: 4 }); });
    third.forEach((timeMs, i) => { stats = i === 0 ? addFixAfterManualPause(stats, { timeMs, accuracyM: 4 }, 30_000) : addFixToStats(stats, { timeMs, accuracyM: 4 }); });
    return { stats, first, second, third };
  };

  it('égales à celles faites point à point, durée figée des pauses manuelles comprise', () => {
    const { stats, first, second, third } = lived();
    const points = [...first, ...second, ...third].map((timeMs) => ({ timeMs, accuracyM: 4 }));
    const rebuilt = rebuildRecordingStats(points, [
      { index: first.length, autoPartMs: 0 },
      { index: first.length + second.length, autoPartMs: 30_000 },
    ]);
    expect(rebuilt).toEqual(stats);
    // 60 + 60 + 60 s en mouvement, 30 s de pause automatique avant l'appui.
    expect(recordingDurationMs(rebuilt)).toBe(210_000);
  });

  it('relues d\'un vrai journal : le même résultat', () => {
    const { stats, first, second, third } = lived();
    const fix = (timeMs: number) => journalFixLine({ timeMs, lat: 43, lon: 3, accuracyM: 4 });
    const text = journalHeaderLine('running', T0)
      + first.map(fix).join('')
      + journalPauseLine(T0 + 60_000) + journalResumeLine(T0 + 120_000) + journalBreakLine(second[0])
      + second.map(fix).join('')
      + journalPauseLine(T0 + 240_000, 30_000) + journalResumeLine(T0 + 300_000) + journalBreakLine(third[0])
      + third.map(fix).join('');
    const parsed = parseJournal(text);
    const rebuilt = rebuildRecordingStats(parsed.fixes, parsed.manualBreaks.map((b) => ({ index: b.fixIndex, autoPartMs: b.autoPartMs })));
    expect(rebuilt).toEqual(stats);
    expect(parsed.breaks).toEqual([first.length, first.length + second.length]);
  });
});

describe('resumedPhase', () => {
  it('pause manuelle en cours : son horloge, à l\'identique, durée toujours figée', () => {
    const phase = resumedPhase({ openPause: { atMs: T0 + 90_000, autoPartMs: 30_000 }, resumedPause: null });
    expect(phase).toEqual({ pauseClock: { sinceMs: T0 + 60_000, frozenAtMs: T0 + 90_000 }, pendingBreak: false, manualBreakAutoPartMs: null });
    // Figée : même dix minutes plus tard, la part automatique seule s'ajoute.
    const stats = { ...EMPTY_RECORDING_STATS, firstMs: T0, lastMs: T0 + 60_000 };
    expect(displayedDurationMs(stats, phase.pauseClock, T0 + 700_000)).toBe(90_000);
  });

  it('pause levée sans point depuis : le prochain point clôt la pause', () => {
    expect(resumedPhase({ openPause: null, resumedPause: { atMs: T0, autoPartMs: 5000 } }))
      .toEqual({ pauseClock: null, pendingBreak: true, manualBreakAutoPartMs: 5000 });
  });

  it('en plein enregistrement : le prochain point ouvre un segment, et son écart reste de la durée', () => {
    expect(resumedPhase({ openPause: null, resumedPause: null })).toEqual({ pauseClock: null, pendingBreak: true, manualBreakAutoPartMs: null });
  });
});

describe('continuedPause', () => {
  it('sans pause : une pause posée à la dernière ligne, levée aussitôt', () => {
    expect(continuedPause({ openPause: null, resumedPause: null, lastLineMs: T0 }, T0 + 60_000))
      .toEqual({ pause: { atMs: T0, autoPartMs: 0 }, autoPartMs: 0, resumeLine: true });
  });

  it('pause en cours : levée, sans en poser une autre, sa part automatique gardée', () => {
    expect(continuedPause({ openPause: { atMs: T0, autoPartMs: 2000 }, resumedPause: null, lastLineMs: T0 }, T0 + 60_000))
      .toEqual({ pause: null, autoPartMs: 2000, resumeLine: true });
  });

  it('pause déjà levée : rien à écrire', () => {
    expect(continuedPause({ openPause: null, resumedPause: { atMs: T0, autoPartMs: 2000 }, lastLineMs: T0 }, T0 + 60_000))
      .toEqual({ pause: null, autoPartMs: 2000, resumeLine: false });
  });
});

describe('journal rouvert', () => {
  const fix = (s: number) => journalFixLine({ timeMs: T0 + s * 1000, lat: 43, lon: 3 });
  const header = journalHeaderLine('running', T0);

  it('dernière ligne tronquée : ignorée, âge lu sur la précédente lisible, un saut de ligne protège la suite', () => {
    const text = `${header}${fix(1)}${fix(2)}[${T0 + 3000},43.1`;
    const parsed = parseJournal(text);
    expect(parsed.fixes).toHaveLength(2);
    expect(parsed.lastLineMs).toBe(T0 + 2000);
    // Rouvert : le saut de ligne d'abord écrit garde la position suivante lisible.
    const reopened = parseJournal(`${text}\n${journalBreakLine(T0 + 9000)}${fix(9)}`);
    expect(reopened.fixes).toHaveLength(3);
    expect(reopened.breaks).toEqual([2]);
    // Sans lui, la frontière collée à la ligne tronquée se perdrait avec elle.
    expect(parseJournal(`${text}${journalBreakLine(T0 + 9000)}${fix(9)}`).breaks).toEqual([]);
  });

  it('pause et arrêt relus, jamais pris pour des positions', () => {
    const parsed = parseJournal(`${header}${fix(1)}${journalPauseLine(T0 + 2000)}${journalStopLine(T0 + 3000)}`);
    expect(parsed.fixes).toHaveLength(1);
    expect(parsed.openPause).toEqual({ atMs: T0 + 2000, autoPartMs: 0 });
    expect(parsed.stoppedAtMs).toBe(T0 + 3000);
    expect(parsed.lastLineMs).toBe(T0 + 3000);
  });

  it('pause sans part automatique : ligne à deux éléments ; avec : à trois', () => {
    expect(journalPauseLine(T0)).toBe(`["pause",${T0}]\n`);
    expect(journalPauseLine(T0, 0)).toBe(`["pause",${T0}]\n`);
    expect(journalPauseLine(T0, 1500)).toBe(`["pause",${T0},1500]\n`);
    expect(parseJournal(`${header}${journalPauseLine(T0 + 10, 1500)}`).openPause).toEqual({ atMs: T0 + 10, autoPartMs: 1500 });
  });

  it('pause puis levée sans point : levée en attente ; une frontière la clôt', () => {
    const lifted = parseJournal(`${header}${fix(1)}${journalPauseLine(T0 + 2000)}${journalResumeLine(T0 + 5000)}`);
    expect(lifted.openPause).toBeNull();
    expect(lifted.resumedPause).toEqual({ atMs: T0 + 2000, autoPartMs: 0 });
    const closed = parseJournal(`${header}${fix(1)}${journalPauseLine(T0 + 2000)}${journalResumeLine(T0 + 5000)}${journalBreakLine(T0 + 6000)}${fix(6)}`);
    expect(closed.resumedPause).toBeNull();
    expect(closed.manualBreaks).toEqual([{ fixIndex: 1, heartIndex: 0, autoPartMs: 0 }]);
  });

  it('une frontière d\'une pause automatique n\'est pas une pause manuelle', () => {
    expect(parseJournal(`${header}${fix(1)}${journalBreakLine(T0 + 9000)}${fix(9)}`).manualBreaks).toEqual([]);
  });

  it('un point gardé prouve la fin d\'une pause dont la levée s\'est perdue', () => {
    expect(parseJournal(`${header}${fix(1)}${journalPauseLine(T0 + 2000)}${fix(5)}`).openPause).toBeNull();
  });

  it('sans aucune ligne datée : âge inconnu', () => {
    expect(parseJournal('pas du json\n').lastLineMs).toBeNull();
  });
});
