import { describe, expect, it } from 'vitest';
import {
  INTERVAL_TONE_MS, lapsWithin, newPresetId, readIntervalRun, readIntervalSeries, runCommand, runLaps, sanitizePresets,
  sanitizeWorkout, seriesWithin, startRun, timerStateAt, upcomingSchedule, workoutDurationS, workoutLabel, workoutPhases,
  type IntervalRun, type IntervalTone, type IntervalWorkout,
} from './intervalTimer';

const T0 = 1_700_000_000_000;
const at = (s: number) => T0 + s * 1000;
/** 3 × 1:00, 0:30 de repos : départ 0-3, travail 3-63, repos 63-93, travail 93-153, repos 153-183, travail 183-243. */
const workout: IntervalWorkout = { reps: 3, workS: 60, restS: 30 };
const run = startRun(workout, T0);

/** La séance après une suite de commandes, chacune à son instant (en secondes). */
const withCommands = (base: IntervalRun, ...commands: [IntervalRun['commands'][number]['kind'], number][]): IntervalRun =>
  commands.reduce((r, [kind, s]) => runCommand(r, kind, at(s)), base);

describe('séance', () => {
  it('découpe la séance en phases, compte à rebours du départ en tête, sans repos après la dernière répétition', () => {
    expect(workoutPhases(workout).map((p) => [p.kind, p.rep, p.startS, p.endS])).toEqual([
      ['pret', 1, 0, 3], ['travail', 1, 3, 63], ['repos', 1, 63, 93], ['travail', 2, 93, 153], ['repos', 2, 153, 183], ['travail', 3, 183, 243],
    ]);
    expect(workoutDurationS(workout)).toBe(240);
    expect(workoutPhases({ reps: 2, workS: 30, restS: 0 }).map((p) => p.kind)).toEqual(['pret', 'travail', 'travail']);
  });

  it('nomme une séance', () => {
    expect(workoutLabel({ reps: 10, workS: 60, restS: 30 })).toBe('10 × 1:00 / 0:30');
    expect(workoutLabel({ reps: 5, workS: 3600, restS: 0 })).toBe('5 × 1:00:00');
  });

  it('écarte une séance hors bornes ou en secondes non entières', () => {
    expect(sanitizeWorkout({ reps: 8, workS: 45, restS: 15 })).toEqual({ reps: 8, workS: 45, restS: 15 });
    expect(sanitizeWorkout({ reps: 0, workS: 45, restS: 15 })).toBeNull();
    expect(sanitizeWorkout({ reps: 8, workS: 2, restS: 15 })).toBeNull();
    expect(sanitizeWorkout({ reps: 8, workS: 45.5, restS: 15 })).toBeNull();
    expect(sanitizeWorkout('8 × 45')).toBeNull();
  });
});

describe('timerStateAt', () => {
  it('suit les phases à l’horloge, puis se termine', () => {
    expect(timerStateAt(run, at(1))).toMatchObject({ status: 'running', phase: { kind: 'pret' }, remainingMs: 2000 });
    expect(timerStateAt(run, at(13))).toMatchObject({ status: 'running', phase: { kind: 'travail', rep: 1 }, remainingMs: 50_000 });
    expect(timerStateAt(run, at(68))).toMatchObject({ status: 'running', phase: { kind: 'repos', rep: 1 }, remainingMs: 25_000 });
    expect(timerStateAt(run, at(242))).toMatchObject({ phase: { kind: 'travail', rep: 3 }, remainingMs: 1000 });
    expect(timerStateAt(run, at(243))).toMatchObject({ status: 'finished', phase: null });
    expect(timerStateAt(run, at(5000)).status).toBe('finished');
  });

  it('gèle pendant une pause, et reprend où elle en était', () => {
    const paused = withCommands(run, ['pause', 30], ['resume', 100]);
    expect(timerStateAt(paused, at(80))).toMatchObject({ status: 'paused', remainingMs: 33_000 });
    expect(timerStateAt(paused, at(120))).toMatchObject({ status: 'running', phase: { kind: 'travail', rep: 1 }, remainingMs: 13_000 });
  });

  it('« Passer » termine la phase en cours tout de suite', () => {
    const skipped = withCommands(run, ['skip', 10]);
    expect(timerStateAt(skipped, at(10))).toMatchObject({ phase: { kind: 'repos', rep: 1 }, remainingMs: 30_000 });
    expect(timerStateAt(skipped, at(40))).toMatchObject({ phase: { kind: 'travail', rep: 2 }, remainingMs: 60_000 });
    // Passer la dernière phase clôt la séance.
    expect(timerStateAt(withCommands(run, ['skip', 200]), at(200)).status).toBe('finished');
  });

  it('« Passer » en pause : la phase suivante attend la reprise', () => {
    const r = withCommands(run, ['pause', 20], ['skip', 25], ['resume', 50]);
    expect(timerStateAt(r, at(40))).toMatchObject({ status: 'paused', phase: { kind: 'repos' }, remainingMs: 30_000 });
    expect(timerStateAt(r, at(60))).toMatchObject({ status: 'running', phase: { kind: 'repos' }, remainingMs: 20_000 });
  });

  it('l’arrêt clôt la séance', () => {
    expect(timerStateAt(withCommands(run, ['stop', 70]), at(80))).toMatchObject({ status: 'stopped', phase: null });
  });
});

describe('runCommand', () => {
  it('ignore une commande sans objet', () => {
    expect(runCommand(run, 'resume', at(5))).toBe(run);
    const paused = runCommand(run, 'pause', at(5));
    expect(runCommand(paused, 'pause', at(6))).toBe(paused);
    const done = runCommand(run, 'stop', at(5));
    expect(runCommand(done, 'skip', at(6))).toBe(done);
    expect(runCommand(run, 'pause', at(300))).toBe(run);
  });
});

describe('upcomingSchedule', () => {
  it('finit chaque signal à l’instant du changement : court, court, long, le même vers un travail et vers un repos', () => {
    const { tones, cues } = upcomingSchedule(run, T0, false);
    const signal = (t: IntervalTone) => `${t.tone === 'court' ? 'c' : t.tone === 'long' ? 'L' : 'F'}${t.delayMs / 1000}`;
    expect(tones.map(signal)).toEqual([
      'c0.2', 'c1.2', 'L2.2', // départ : le travail commence à 3 s, à la fin du bip long
      'c60.2', 'c61.2', 'L62.2', // vers le repos, à 63 s
      'c90.2', 'c91.2', 'L92.2',
      'c150.2', 'c151.2', 'L152.2',
      'c180.2', 'c181.2', 'L182.2',
      'c239.4', 'L240.4', 'F241.4', // fin de séance : court, long, long double, fini à 243 s
    ]);
    expect(cues.map((c) => [c.delayMs, c.title, c.phaseMs])).toEqual([
      [0, 'Départ', 3000], [3000, 'Travail 1/3', 60_000], [63_000, 'Repos 1/3', 30_000], [93_000, 'Travail 2/3', 60_000],
      [153_000, 'Repos 2/3', 30_000], [183_000, 'Travail 3/3', 60_000], [243_000, 'Terminé', 0],
    ]);
  });

  it('joue encore le premier bip du départ quand le programme est calculé un instant après le lancement', () => {
    expect(upcomingSchedule(run, T0 + 300, false).tones[0]).toEqual({ delayMs: 0, tone: 'court' });
  });

  it('ne prend rien à la phase suivante : chaque bip commence et finit dans la phase qui finit (essai sur 10 s / 10 s)', () => {
    const tenTen = startRun({ reps: 3, workS: 10, restS: 10 }, T0);
    const phases = workoutPhases(tenTen.workout);
    const { tones } = upcomingSchedule(tenTen, T0, false);
    expect(tones).toHaveLength(phases.length * 3);
    for (const tone of tones) {
      const atS = tone.delayMs / 1000;
      const phase = phases.find((ph) => atS >= ph.startS && atS < ph.endS)!;
      expect(atS + INTERVAL_TONE_MS[tone.tone] / 1000).toBeLessThanOrEqual(phase.endS + 1e-9);
      expect(phase.endS - atS).toBeLessThanOrEqual(3.6 + 1e-9);
    }
    // Le dernier bip de chaque signal finit pile au changement.
    for (const ph of phases) {
      const last = tones.filter((t) => t.delayMs / 1000 < ph.endS).pop()!;
      expect(last.delayMs / 1000 + INTERVAL_TONE_MS[last.tone] / 1000).toBeCloseTo(ph.endS, 9);
    }
  });

  it('en cours de phase, ne programme que ce qui reste ; après « Passer », un bip long annonce la phase', () => {
    const { tones, cues } = upcomingSchedule(run, at(61.5), false);
    expect(tones[0]).toEqual({ delayMs: 700, tone: 'long' });
    expect(cues[0]).toEqual({ delayMs: 0, title: 'Travail 1/3', phaseMs: 1500 });
    const skipped = withCommands(run, ['skip', 10]);
    expect(upcomingSchedule(skipped, at(10), true).tones.slice(0, 2)).toEqual([{ delayMs: 0, tone: 'long' }, { delayMs: 27_200, tone: 'court' }]);
  });

  it('ne joue pas avant le début d’une phase trop courte pour tout son signal', () => {
    const short = startRun({ reps: 2, workS: 5, restS: 2 }, T0);
    const shorts = upcomingSchedule(short, T0, false).tones.filter((t) => t.tone === 'court').map((t) => t.delayMs);
    expect(shorts).toEqual([200, 1200, 5200, 6200, 8200, 11_400]);
  });

  it('ne programme rien en pause ni après la fin', () => {
    expect(upcomingSchedule(withCommands(run, ['pause', 10]), at(20), false)).toEqual({ tones: [], cues: [] });
    expect(upcomingSchedule(run, at(300), false)).toEqual({ tones: [], cues: [] });
  });
});

describe('runLaps', () => {
  it('rend les phases faites avec leurs instants réels : la pause allonge, « Passer » écourte', () => {
    const r = withCommands(run, ['pause', 30], ['resume', 50], ['skip', 100]);
    expect(runLaps(r, at(130)).map((l) => [l.kind, l.rep, (l.startMs - T0) / 1000, (l.endMs - T0) / 1000])).toEqual([
      ['travail', 1, 3, 83], ['repos', 1, 83, 100], ['travail', 2, 100, 130],
    ]);
  });

  it('termine la phase en cours à l’arrêt, et rend toute la séance une fois finie', () => {
    expect(runLaps(withCommands(run, ['stop', 70]), at(500)).map((l) => (l.endMs - T0) / 1000)).toEqual([63, 70]);
    // Arrêtée pendant le compte à rebours : aucune répétition.
    expect(runLaps(withCommands(run, ['stop', 2]), at(500))).toEqual([]);
    expect(runLaps(run, at(500))).toHaveLength(5);
  });

  it('ramène les phases à la fenêtre d’un enregistrement', () => {
    const laps = runLaps(run, at(500));
    const kept = lapsWithin(laps, at(70), at(160));
    expect(kept.map((l) => [l.kind, l.rep, (l.startMs - T0) / 1000, (l.endMs - T0) / 1000])).toEqual([
      ['repos', 1, 70, 93], ['travail', 2, 93, 153], ['repos', 2, 153, 160],
    ]);
    const before = startRun(workout, at(-1000));
    expect(seriesWithin([run, before], at(0), at(100)).map((s) => s.laps.length)).toEqual([3]);
  });
});

describe('séances gardées et relecture', () => {
  it('garde les séances valables, sans doublon', () => {
    const presets = sanitizePresets([
      { id: 's1', name: ' Pyramide ', workout },
      { id: 's1', name: 'Doublon', workout },
      { id: 's2', name: '', workout: { reps: 4, workS: 120, restS: 60 } },
      { id: 's3', name: 'Abîmée', workout: { reps: 0 } },
      'texte',
    ]);
    expect(presets).toEqual([
      { id: 's1', name: 'Pyramide', workout },
      { id: 's2', name: '4 × 2:00 / 1:00', workout: { reps: 4, workS: 120, restS: 60 } },
    ]);
    expect(newPresetId(presets)).toBe('s3');
    expect(newPresetId([{ id: 's2', name: 'x', workout }])).toBe('s3');
  });

  it('relit les séances d’une fiche et une séance du journal', () => {
    const series = [{ workout, laps: runLaps(run, at(500)) }];
    expect(readIntervalSeries(JSON.parse(JSON.stringify(series)))).toEqual(series);
    expect(readIntervalSeries([{ workout, laps: [{ kind: 'sprint', rep: 1, startMs: 0, endMs: 1 }] }])).toBeNull();
    expect(readIntervalSeries(undefined)).toBeNull();
    const r = withCommands(run, ['pause', 30], ['resume', 50]);
    expect(readIntervalRun(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(readIntervalRun({ workout, startedAtMs: 'hier', commands: [] })).toBeNull();
  });
});
