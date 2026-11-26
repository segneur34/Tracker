import { describe, expect, it } from 'vitest';
import type { SportType } from '../core/types';
import { statSession, surfStatSession } from '../test/record.fixture';
import {
  LEVEL_RULES, levelSessionOf, restingHrForme, sessionEffort, sportIntensityClass, sportLevel, windowDays,
  type FormeSource, type LevelSession,
} from './sportLevel';

// Dates à l'heure locale : les fenêtres se comptent en jours du calendrier, sans dépendre du fuseau de la machine.
const NOW = new Date(2026, 10, 26, 12).getTime();
/** 8 h du matin, `daysAgo` jours avant aujourd'hui. */
const dayAt = (daysAgo: number, hour = 8) => new Date(2026, 10, 26 - daysAgo, hour).getTime();

const KMH = 1 / 3.6;

const session = (daysAgo: number, minutes: number, sport: SportType, speedKmh: number | null, over: Partial<LevelSession> = {}): LevelSession => ({
  file: `s-${sport}-${daysAgo}.json`,
  startMs: dayAt(daysAgo),
  timeS: minutes * 60,
  sport,
  speedMs: speedKmh === null ? null : speedKmh * KMH,
  hr: null,
  zoneBounds: null,
  excluded: null,
  ...over,
});

/** Jours `d` de `from` à `to` dont `(d - shift) mod 7` est dans `residues` : un rythme hebdomadaire. */
const weekly = (residues: number[], from: number, to: number, shift = 0): number[] => {
  const days: number[] = [];
  for (let d = from; d <= to; d++) if (residues.includes((((d - shift) % 7) + 7) % 7)) days.push(d);
  return days;
};

/** Rang FRIEND d'une VO2max de 49,8 chez un homme de 20 à 29 ans (5 km en 20 min) : 65,3. */
const FORME_COUREUR = 50 + ((49.8 - 45.4) / (52.6 - 45.4)) * 25;
/** Vélo : 3,0 W/kg au seuil, VO2max 11 × 3 / 0,75 + 7 = 51, homme de 30 à 39 ans : 82,9. */
const FORME_VELO = 75 + ((51 - 46.5) / (57.9 - 46.5)) * 20;

const forme = (kind: FormeSource['kind'], points: number): FormeSource => ({ kind, points, atMs: dayAt(40), file: null, text: `${kind} ${points}` });

const part = (level: ReturnType<typeof sportLevel>, id: 'efforts' | 'regularite' | 'forme') => level.parts.find((p) => p.id === id)!;

/** Coureur du profil 1 : 3 courses de 45 min par semaine à 12 km/h pendant 6 mois, arrêté depuis `stop` jours. */
const coureur = (stop: number) => weekly([1, 3, 5], stop + 1, stop + 180, stop).map((d) => session(d, 45, 'running', 12));

describe('note de niveau : les six sportifs de l\'étude (§6, poids J1)', () => {
  it('1. coureur de 28 ans : efforts 70, régularité 100, forme 65, note 78, Très sportif', () => {
    const level = sportLevel(coureur(0), 28, [forme('course', FORME_COUREUR)], NOW);
    // 18 courses dans les 42 jours, 45 min vigoureuses (× 2) : 270 min par semaine, entre 150 (50) et 300 (75).
    expect(part(level, 'efforts').points).toBeCloseTo(70, 6);
    expect(part(level, 'efforts').proof).toBe('270 min d\'effort par semaine, dont 270 vigoureuses, sur 6 semaines');
    expect(part(level, 'regularite').points).toBeCloseTo(100, 6);
    expect(part(level, 'regularite').proof).toBe('3 jours actifs par semaine en moyenne, sur 12 semaines');
    expect(part(level, 'forme').points).toBeCloseTo(65.28, 2);
    expect(level.note).toBe(78);
    expect(level.palier?.label).toBe('Très sportif');
    expect(level.capped).toBe(false);
    expect(level.parts.map((p) => p.weight)).toEqual([0.5, 0.3, 0.2]);
  });

  it('2. wing de 45 ans, 2 sorties de 1 h 30 sans ceinture : 55 et 67, forme absente, note 59, Actif', () => {
    const sessions = weekly([2, 5], 1, 180).map((d) => session(d, 90, 'wingfoil', 20));
    const level = sportLevel(sessions, 45, [], NOW);
    // 12 sorties modérées en 42 jours : 180 min par semaine.
    expect(part(level, 'efforts').points).toBeCloseTo(55, 6);
    expect(part(level, 'regularite').points).toBeCloseTo(200 / 3, 6);
    expect(part(level, 'forme').points).toBeNull();
    expect(part(level, 'forme').missingHint).toBe('Pas encore mesurée. Cours un 5 km ou fais un test de FC de repos.');
    // Forme absente : poids remis à l'échelle, 62,5 et 37,5 ; 0,625 × 55 + 0,375 × 66,7 = 59,4.
    const [effortsWeight, regularityWeight, formeWeight] = level.parts.map((p) => p.weight);
    expect(effortsWeight).toBeCloseTo(0.625, 9);
    expect(regularityWeight).toBeCloseTo(0.375, 9);
    expect(formeWeight).toBe(0);
    expect(level.note).toBe(59);
    expect(level.palier?.label).toBe('Actif');
  });

  it('3. marcheuse de 62 ans, 1 h par jour à 5 km/h : 75 et 100, note 74 au plafond (84 sans)', () => {
    const sessions = Array.from({ length: 181 }, (_, d) => session(d, 60, 'running', 5));
    const level = sportLevel(sessions, 62, [], NOW);
    // 420 min modérées par semaine, aucune vigoureuse : Ec = min(420, 300 + 0) = 300, 75 points.
    expect(part(level, 'efforts').points).toBeCloseTo(75, 6);
    expect(part(level, 'efforts').proof).toBe('420 min d\'effort par semaine, sur 6 semaines');
    expect(part(level, 'regularite').points).toBeCloseTo(100, 6);
    expect(part(level, 'regularite').proof).toBe('7 jours actifs par semaine en moyenne, sur 12 semaines');
    expect(level.uncapped).toBe(84);
    expect(level.note).toBe(74);
    expect(level.capped).toBe(true);
    expect(level.palier?.label).toBe('Sportif');
  });

  it('4. vélo du samedi, 35 ans, 4 h à 25 km/h : 90 et 33, forme 83, note 72, Sportif', () => {
    const sessions = weekly([3], 1, 180).map((d) => session(d, 240, 'cycling', 25));
    const level = sportLevel(sessions, 35, [forme('velo', FORME_VELO)], NOW);
    // 6 sorties vigoureuses : 480 min par semaine, entre 300 (75) et 600 (100).
    expect(part(level, 'efforts').points).toBeCloseTo(90, 6);
    expect(part(level, 'regularite').points).toBeCloseTo(100 / 3, 6);
    expect(part(level, 'forme').points).toBeCloseTo(82.9, 1);
    expect(level.note).toBe(72);
    expect(level.palier?.label).toBe('Sportif');
  });

  it('5. débutante de 30 ans, depuis 3 semaines 3 courses-marches de 30 min à 6,5 km/h : 30 et 50, note 38', () => {
    const sessions = [20, 18, 16, 13, 11, 9, 6, 4, 2].map((d) => session(d, 30, 'running', 6.5));
    const level = sportLevel(sessions, 30, [], NOW);
    // Fenêtre des efforts ramenée aux 21 jours depuis la première session : 270 min modérées en 3 semaines, 90 par semaine.
    expect(part(level, 'efforts').points).toBeCloseTo(30, 6);
    expect(part(level, 'efforts').proof).toBe('90 min d\'effort par semaine, sur 3 semaines');
    // Régularité au moins sur 6 semaines : 3 tranches pleines, 3 vides.
    expect(part(level, 'regularite').points).toBeCloseTo(50, 6);
    expect(level.note).toBe(38);
    expect(level.palier?.label).toBe('En route');
  });

  it('6. le coureur arrêté depuis un mois : 25 (26 dans l\'étude) et 64, forme 65, note 45, Actif', () => {
    const level = sportLevel(coureur(30), 28, [forme('course', FORME_COUREUR)], NOW);
    // Restent dans les 42 jours les jours 31 à 41 : 5 courses, 450 min sur 6 semaines, 75 par semaine.
    expect(part(level, 'efforts').points).toBeCloseTo(25, 6);
    // 7 tranches pleines, une à 2 jours sur 3, 4 vides : 7,67 / 12.
    expect(part(level, 'regularite').points).toBeCloseTo(((7 + 2 / 3) / 12) * 100, 6);
    expect(level.note).toBe(45);
    expect(level.palier?.label).toBe('Actif');
  });
});

describe('note de niveau : la table d\'arrêt (§3)', () => {
  const rows: [number, number, number, boolean, number, string][] = [
    // arrêt (jours), efforts, régularité, forme présente, note, palier
    [0, 70, 100, true, 78, 'Très sportif'],
    [14, 55, 250 / 3, true, 66, 'Sportif'],
    [30, 25, ((7 + 2 / 3) / 12) * 100, true, 45, 'Actif'],
    [90, 0, 0, true, 13, 'Au repos'],
    [365, 0, 0, false, 0, 'Au repos'],
  ];
  it.each(rows)('arrêté depuis %i jours : efforts %d, régularité %d', (stop, efforts, regularity, hasForme, note, palier) => {
    const level = sportLevel(coureur(stop), 28, hasForme ? [forme('course', FORME_COUREUR)] : [], NOW);
    // Une part à zéro parce que rien n'a été fait reste à zéro, elle n'est pas retirée.
    expect(part(level, 'efforts').points).toBeCloseTo(efforts, 6);
    expect(part(level, 'regularite').points).toBeCloseTo(regularity, 6);
    expect(level.note).toBe(note);
    expect(level.palier?.label).toBe(palier);
  });
});

describe('note de niveau : parts absentes, plafond, âge', () => {
  const wing = weekly([2, 5], 1, 180).map((d) => session(d, 90, 'wingfoil', 20));

  it('une part absente est retirée, pas mise à zéro', () => {
    const absent = sportLevel(wing, 45, [], NOW);
    const zero = sportLevel(wing, 45, [forme('coeur', 0)], NOW);
    expect(absent.note).toBe(59);
    // 0,5 × 55 + 0,3 × 66,7 + 0,2 × 0 = 47,5.
    expect(zero.note).toBe(48);
    expect(zero.parts.map((p) => p.weight)).toEqual([0.5, 0.3, 0.2]);
  });

  it('sans aucune session, efforts et régularité sont absents et la note aussi ; la forme seule fait la note', () => {
    const empty = sportLevel([], 30, [], NOW);
    expect(empty.note).toBeNull();
    expect(empty.palier).toBeNull();
    expect(empty.parts.every((p) => p.points === null && p.weight === 0 && p.missingHint !== null)).toBe(true);
    const formeOnly = sportLevel([], 30, [forme('coeur', 80)], NOW);
    expect(formeOnly.note).toBe(80);
    expect(formeOnly.parts.map((p) => p.weight)).toEqual([0, 0, 1]);
  });

  it('plafond : un test de FC de repos lève le plafond de la marcheuse (62 bpm à 62 ans)', () => {
    const walks = Array.from({ length: 181 }, (_, d) => session(d, 60, 'running', 5));
    const heart = restingHrForme([{ atMs: dayAt(10), bpm: 62 }], 'f', 1964, NOW)!;
    // Femmes de 60 à 79 ans : 59 au 10e percentile, 64 au 25e ; 62 → rang 19, 81 points.
    expect(heart.points).toBeCloseTo(81, 6);
    const level = sportLevel(walks, 62, [heart], NOW);
    expect(level.capped).toBe(false);
    // 0,5 × 75 + 0,3 × 100 + 0,2 × 81 = 83,7.
    expect(level.note).toBe(84);
    expect(level.palier?.label).toBe('Très sportif');
  });

  it('plafond : sans forme, jamais de palier qui la demande, même avec un plafond relevé', () => {
    const walks = Array.from({ length: 181 }, (_, d) => session(d, 60, 'running', 5));
    const level = sportLevel(walks, 62, [], NOW, { ...LEVEL_RULES, capWithoutForme: 100 });
    expect(level.note).toBe(84);
    expect(level.capped).toBe(false);
    expect(level.palier?.label).toBe('Sportif');
  });

  it('wing avec un test de FC de repos à 58 bpm : forme 82, note 64', () => {
    const heart = restingHrForme([{ atMs: dayAt(10), bpm: 58 }], 'h', 1981, NOW)!;
    expect(heart.points).toBeCloseTo(82.5, 6);
    expect(heart.text).toMatch(/^FC de repos 58 le .+, plus basse que celle de 83 % des hommes de 40 à 59 ans$/);
    expect(sportLevel(wing, 45, [heart], NOW).note).toBe(64);
  });

  it('moins de 18 ans : repères des efforts multipliés par 420/150', () => {
    const sessions = Array.from({ length: 50 }, (_, d) => session(d, 60, 'running', 5));
    // 420 min modérées par semaine : 75 points pour un adulte (plafond de 300), 50 à 15 ans (le premier repère, 150 × 2,8).
    expect(part(sportLevel(sessions, 30, [], NOW), 'efforts').points).toBeCloseTo(75, 6);
    expect(part(sportLevel(sessions, 15, [], NOW), 'efforts').points).toBeCloseTo(50, 6);
    expect(part(sportLevel(sessions, 18, [], NOW), 'efforts').points).toBeCloseTo(75, 6);
    // Âge inconnu : repères des adultes.
    expect(part(sportLevel(sessions, null, [], NOW), 'efforts').points).toBeCloseTo(75, 6);
  });

  it('au-delà de 600 min par semaine : 100 points, pas plus', () => {
    const sessions = Array.from({ length: 50 }, (_, d) => session(d, 60, 'running', 12));
    // 840 min vigoureuses (× 2) par semaine.
    expect(part(sportLevel(sessions, 30, [], NOW), 'efforts').points).toBe(100);
  });
});

describe('note de niveau : intensité', () => {
  it('à pied et à vélo selon la vitesse moyenne en mouvement, bornes du Compendium', () => {
    const cls = (sport: SportType, kmh: number | null) => sportIntensityClass({ sport, speedMs: kmh === null ? null : kmh * KMH });
    expect(cls('running', 3.5)).toBe('leger');
    expect(cls('running', 5)).toBe('modere');
    expect(cls('running', 7)).toBe('vigoureux');
    expect(cls('running', null)).toBe('modere');
    // 5,28 m/s = 19,01 km/h : 19 km/h tout juste reste modéré.
    expect(cls('cycling', 19)).toBe('modere');
    expect(cls('cycling', 19.1)).toBe('vigoureux');
    expect(cls('bateau', 10)).toBe('leger');
    expect(cls('kite', 30)).toBe('modere');
    expect(cls('surf', null)).toBe('modere');
    expect(cls('muscu', null)).toBe('modere');
    expect(cls('run-intervals', 5)).toBe('vigoureux');
    expect(cls('run-test', 5)).toBe('vigoureux');
    expect(cls('night-hr', null)).toBeNull();
  });

  it('avec ceinture, la FC par zones prime sur l\'intensité du sport', () => {
    const bounds = [100, 120, 140, 160, 180];
    const histogram = (bpm: number, seconds: number) => ({ fromBpm: bpm, seconds: [seconds] });
    const wing = (hr: LevelSession['hr'], zoneBounds: readonly number[] | null = bounds) => session(1, 60, 'wingfoil', 20, { hr, zoneBounds });
    // Sans FC : 60 min modérées.
    expect(sessionEffort(wing(null))).toEqual({ equivalentMin: 60, vigorousMin: 0 });
    // Toute l'heure en zone 4 : vigoureuse, 120 min équivalentes.
    expect(sessionEffort(wing({ coveredS: 3600, histogram: histogram(170, 3600) }))).toEqual({ equivalentMin: 120, vigorousMin: 120 });
    // Sous la zone 1 : légère, 30 min.
    expect(sessionEffort(wing({ coveredS: 3600, histogram: histogram(90, 3600) }))?.equivalentMin).toBe(30);
    // FC sur la moitié : 30 min en zone 4 (60), le reste au sport (30).
    expect(sessionEffort(wing({ coveredS: 1800, histogram: histogram(170, 1800) }))).toEqual({ equivalentMin: 90, vigorousMin: 60 });
    // FC plus longue que le temps compté (arrêts entendus) : ramenée au temps compté.
    expect(sessionEffort(wing({ coveredS: 7200, histogram: histogram(170, 7200) }))).toEqual({ equivalentMin: 120, vigorousMin: 120 });
    // FC sans zones (ni âge ni seuils) : l'intensité du sport.
    expect(sessionEffort(wing({ coveredS: 3600, histogram: histogram(170, 3600) }, null))?.equivalentMin).toBe(60);
  });

  it('un test de FC de repos et une FC de nuit ne comptent pas ; un test de FC max compte comme un effort vigoureux', () => {
    const resting = session(2, 5, 'run-test', null, { excluded: 'fc-repos' });
    const night = session(3, 480, 'night-hr', null);
    const fcMax = session(4, 20, 'run-test', 8);
    expect(sessionEffort(resting)).toBeNull();
    expect(sessionEffort(night)).toBeNull();
    expect(sessionEffort(fcMax)).toEqual({ equivalentMin: 40, vigorousMin: 40 });
    const level = sportLevel([resting, night, fcMax, session(100, 30, 'running', null, { excluded: 'fc-repos' })], 30, [], NOW);
    expect(level.uncounted).toEqual([
      { file: resting.file, startMs: resting.startMs, reason: 'fc-repos' },
      { file: night.file, startMs: night.startMs, reason: 'fc-nuit' },
    ]);
    // 40 min équivalentes ; la première session (100 jours) garde la fenêtre entière : 40 / 6 semaines.
    expect(part(level, 'efforts').points).toBeCloseTo((40 / 6 / 150) * 50, 6);
  });
});

describe('note de niveau : fenêtres', () => {
  it('fenêtre ramenée aux jours depuis la première session, sans descendre sous le minimum', () => {
    expect(windowDays(null, NOW, 42, 14)).toBe(42);
    expect(windowDays(dayAt(100), NOW, 42, 14)).toBe(42);
    expect(windowDays(dayAt(20), NOW, 42, 14)).toBe(21);
    expect(windowDays(dayAt(3), NOW, 42, 14)).toBe(14);
    // Aujourd'hui compris : une session du matin même ouvre une fenêtre d'un jour.
    expect(windowDays(dayAt(0), NOW, 42, 1)).toBe(1);
  });

  it('nouvel utilisateur : une heure de marche il y a 3 jours compte sur 2 semaines, pas sur 6', () => {
    const level = sportLevel([session(3, 60, 'running', 5)], 30, [], NOW);
    // 60 min sur 14 jours : 30 par semaine, 10 points ; une tranche sur 6 à 1 jour actif sur 3.
    expect(part(level, 'efforts').points).toBeCloseTo(10, 6);
    expect(part(level, 'efforts').proof).toBe('30 min d\'effort par semaine, sur 2 semaines');
    expect(part(level, 'regularite').points).toBeCloseTo((1 / 3 / 6) * 100, 6);
    expect(part(level, 'regularite').proof).toBe('0,2 jour actif par semaine en moyenne, sur 6 semaines');
  });

  it('jour actif dès 20 min équivalentes, plusieurs sessions du même jour additionnées', () => {
    const history = session(100, 0, 'running', 5);
    // 15 min de marche lente (légère, 7,5 éq.) : pas actif ; deux fois 10 min modérées le même jour : actif.
    const slow = sportLevel([history, session(1, 15, 'running', 3)], 30, [], NOW);
    expect(part(slow, 'regularite').points).toBe(0);
    const twice = sportLevel([history, session(1, 10, 'running', 5), { ...session(1, 10, 'running', 5), startMs: dayAt(1, 18), file: 'soir' }], 30, [], NOW);
    expect(part(twice, 'regularite').points).toBeCloseTo((1 / 3 / 12) * 100, 6);
  });

  it('une session à venir est ignorée', () => {
    const future = { ...session(0, 60, 'running', 12), startMs: NOW + 3_600_000 };
    expect(sportLevel([future], 30, [], NOW).note).toBeNull();
  });
});

describe('source « cœur » de la forme : dernier test de FC de repos des 180 jours', () => {
  it('garde le plus récent de la fenêtre ; aucun au-delà de 180 jours', () => {
    const tests = [{ atMs: dayAt(200), bpm: 50 }, { atMs: dayAt(30), bpm: 69 }, { atMs: dayAt(60), bpm: 55 }];
    // Homme de 30 ans (20-39) : 69 est la médiane, 50 points.
    const source = restingHrForme(tests, 'h', 1996, NOW)!;
    expect(source.kind).toBe('coeur');
    expect(source.atMs).toBe(dayAt(30));
    expect(source.points).toBeCloseTo(50, 6);
    expect(source.file).toBeNull();
    expect(restingHrForme([{ atMs: dayAt(200), bpm: 50 }], 'h', 1996, NOW)).toBeNull();
    expect(restingHrForme([{ atMs: dayAt(179), bpm: 69 }], 'h', 1996, NOW)).not.toBeNull();
  });

  it('sous la plus petite valeur publiée : 99 points, dit « parmi les 1 % les plus basses »', () => {
    const source = restingHrForme([{ atMs: dayAt(1), bpm: 40 }], 'h', 1996, NOW)!;
    expect(source.points).toBe(99);
    expect(source.text).toMatch(/parmi les 1 % les plus basses des hommes de 20 à 39 ans$/);
    // 80 ans et plus, premier percentile non publié : la plus basse publiée est le 2,5e.
    const old = restingHrForme([{ atMs: dayAt(1), bpm: 40 }], 'f', 1940, NOW)!;
    expect(old.points).toBe(97.5);
    expect(old.text).toMatch(/parmi les 2,5 % les plus basses des femmes de 80 ans et plus$/);
  });

  it('l\'écart de la table est ajouté à la mesure (0 par défaut)', () => {
    const tests = [{ atMs: dayAt(1), bpm: 61 }];
    expect(restingHrForme(tests, 'h', 1996, NOW)!.points).toBeCloseTo(75, 6);
    expect(restingHrForme(tests, 'h', 1996, NOW, { ...LEVEL_RULES, restHrTableOffsetBpm: 8 })!.points).toBeCloseTo(50, 6);
  });
});

describe('levelSessionOf', () => {
  it('temps de la racine, vitesse moyenne en mouvement, FC du résumé', () => {
    const histogram = { fromBpm: 120, seconds: [10, 20] };
    const run = levelSessionOf(statSession(NOW, { movingTimeS: 3000, movingDistanceM: 9000, heartRate: { avgBpm: 130, maxBpm: 150, coveredS: 30, histogram } }), 'running', [1, 2, 3, 4, 5]);
    expect(run).toMatchObject({ timeS: 3000, speedMs: 3, sport: 'running', zoneBounds: [1, 2, 3, 4, 5], excluded: null, hr: { coveredS: 30, histogram } });
    const surf = levelSessionOf(surfStatSession(NOW, { waterTimeS: 3000 }), 'surf', null);
    expect(surf.timeS).toBe(3000);
    expect(levelSessionOf(statSession(NOW, { movingTimeS: null }), 'running', null).speedMs).toBeNull();
  });
});
