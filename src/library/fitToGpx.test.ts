import { describe, expect, it } from 'vitest';
import { parseGpx } from '../core/gpxParser';
import { computeKinematics } from '../core/kinematics';
import { buildCumulativeTrack, segmentDistanceM } from '../core/sessionStats';
import { buildFitActivity, type FitPointSpec } from '../test/fit.fixture';
import { fitToGpx, isFitActivity } from './fitToGpx';
import { guessSport } from './naming';

const T0 = Date.UTC(2026, 9, 10, 10, 0, 0);

/** Point à la seconde `s` d'une trace rectiligne à vitesse fixe, position et mesures comprises. */
const point = (s: number, speedMs = 3): FitPointSpec => ({
  timeMs: T0 + s * 1000, lat: 43.5 + (s * speedMs) / 111_195, lon: 3.9, altitudeM: 12.4, speedMs, hr: 150, cadence: 85, distanceM: 999_000 + s,
});

const seconds = (n: number, step = 1): FitPointSpec[] => Array.from({ length: n }, (_, k) => point(k * step));

const gpxOf = (bytes: Uint8Array): string => {
  const out = fitToGpx(bytes);
  if (out.kind !== 'session') throw new Error(`pas de session : ${out.kind}`);
  return out.gpx;
};

describe('du FIT au GPX, relu par parseGpx', () => {
  it('positions, heure, altitude, vitesse, FC et cadence font l\'aller-retour', () => {
    const parsed = parseGpx(gpxOf(buildFitActivity({ points: seconds(3) })));
    expect(parsed.rawPoints).toHaveLength(3);
    expect(parsed.hasDeviceSpeed).toBe(true);
    expect(parsed.timedPoints).toEqual([]);
    const [p] = parsed.rawPoints;
    expect(p.lat).toBeCloseTo(43.5, 6);
    expect(p.lon).toBeCloseTo(3.9, 6);
    expect(p.rawTimeMs).toBe(T0);
    expect(p.ele).toBe(12.4);
    expect(p.speedMs).toBe(3);
    expect(p.hr).toBe(150);
  });

  it('cadence : le FIT donne des foulées, `buildGpx` divise des pas par 2, le GPX porte les foulées du FIT', () => {
    const parsed = parseGpx(gpxOf(buildFitActivity({ points: [point(0), { ...point(1), cadence: 171 }, { ...point(2), cadence: 85, fractionalCadence: 64 }] })));
    expect(parsed.rawPoints.map((p) => p.cadence)).toEqual([85, 171, 86]);
  });

  it('un point sans mesure n\'écrit pas sa mesure', () => {
    const parsed = parseGpx(gpxOf(buildFitActivity({ points: [{ timeMs: T0, lat: 43.5, lon: 3.9 }, { timeMs: T0 + 1000, lat: 43.5001, lon: 3.9 }] })));
    expect(parsed.hasDeviceSpeed).toBe(false);
    expect(parsed.rawPoints[0]).toMatchObject({ hr: undefined, cadence: undefined, speedMs: undefined, ele: undefined });
  });

  it('la distance du FIT n\'entre pas dans le GPX : celle de la session reste l\'intégrale de la vitesse (règle 6)', () => {
    const gpx = gpxOf(buildFitActivity({ points: seconds(11) }));
    expect(gpx).not.toMatch(/distance/i);
    expect(gpx).not.toContain('999');
    const { cumDist } = buildCumulativeTrack(computeKinematics(parseGpx(gpx).rawPoints));
    // 10 s à 3 m/s, et non la distance de 999 km que le fichier annonce.
    expect(cumDist[cumDist.length - 1]).toBeCloseTo(30, 0);
  });

  it('écarte les points sans position, comme dans un GPX', () => {
    const { lat: _lat, lon: _lon, ...noFix } = point(1);
    const parsed = parseGpx(gpxOf(buildFitActivity({ points: [point(0), noFix, point(2)] })));
    expect(parsed.rawPoints.map((p) => p.rawTimeMs)).toEqual([T0, T0 + 2000]);
    expect(parsed.timedPoints).toEqual([]);
  });

  it('nomme la session comme un enregistrement', () => {
    const { trackName } = parseGpx(gpxOf(buildFitActivity({ points: seconds(2), sessionSports: [2] })));
    expect(trackName).toMatch(/^Vélo.*, 10\/10\/2026 \d\d:00$/);
    const unknown = parseGpx(gpxOf(buildFitActivity({ points: seconds(2), sessionSports: [0] })));
    expect(unknown.trackName).toMatch(/^Session, 10\/10\/2026 \d\d:00$/);
  });
});

describe('pauses de la minuterie', () => {
  const stop = T0 + 10_000;
  const restart = T0 + 70_000;
  const around: FitPointSpec[] = [...seconds(11), ...Array.from({ length: 11 }, (_, k) => point(70 + k))];

  it('une pause sépare deux `<trkseg>`, relus en reprise', () => {
    const gpx = gpxOf(buildFitActivity({ points: around, timer: [[T0, true], [stop, false], [restart, true]] }));
    expect(gpx.match(/<trkseg>/g)).toHaveLength(2);
    const { rawPoints } = parseGpx(gpx);
    expect(rawPoints).toHaveLength(22);
    const resumes = rawPoints.filter((p) => p.segmentStart);
    expect(resumes).toHaveLength(1);
    expect(resumes[0].rawTimeMs).toBe(restart);
    // Rien n'est parcouru pendant la pause de 60 s.
    expect(segmentDistanceM(computeKinematics(rawPoints), 11)).toBe(0);
  });

  it('un point relevé pendant la pause n\'est pas gardé, ceux de l\'arrêt et du départ le sont', () => {
    const during = [point(30), point(40)];
    const points = [...around.slice(0, 11), ...during, ...around.slice(11)];
    const { rawPoints } = parseGpx(gpxOf(buildFitActivity({ points, timer: [[stop, false], [restart, true]] })));
    expect(rawPoints.map((p) => p.rawTimeMs)).toContain(stop);
    expect(rawPoints.map((p) => p.rawTimeMs)).toContain(restart);
    expect(rawPoints.map((p) => p.rawTimeMs)).not.toContain(T0 + 30_000);
    expect(rawPoints).toHaveLength(22);
  });

  it('sans minuterie, ou seulement démarrée, un seul segment', () => {
    expect(gpxOf(buildFitActivity({ points: seconds(5) })).match(/<trkseg>/g)).toHaveLength(1);
    expect(gpxOf(buildFitActivity({ points: seconds(5), timer: [[T0, true]] })).match(/<trkseg>/g)).toHaveLength(1);
  });

  it('un arrêt final sans reprise ne coupe rien de plus', () => {
    const gpx = gpxOf(buildFitActivity({ points: seconds(5), timer: [[T0, true], [T0 + 4000, false]] }));
    expect(gpx.match(/<trkseg>/g)).toHaveLength(1);
    expect(parseGpx(gpx).rawPoints).toHaveLength(5);
  });

  it('une minuterie arrêtée d\'un bout à l\'autre ne perd pas la trace', () => {
    const { rawPoints } = parseGpx(gpxOf(buildFitActivity({ points: [point(5), point(6), point(7)], timer: [[T0, false]] })));
    expect(rawPoints).toHaveLength(3);
  });

  it('même résultat à 1 Hz et à intervalles variables (règles 2 et 10)', () => {
    const timer: [number, boolean][] = [[T0, true], [T0 + 60_000, false], [T0 + 120_000, true]];
    const every = (times: number[]) => parseGpx(gpxOf(buildFitActivity({ points: times.map((s) => point(s)), timer })));
    const dense = every([...Array.from({ length: 61 }, (_, k) => k), ...Array.from({ length: 61 }, (_, k) => 120 + k)]);
    // Enregistrement « intelligent » : un point de temps en temps, jusqu'à 17 s d'écart.
    const sparse = every([0, 1, 2, 19, 25, 41, 58, 60, 120, 122, 137, 150, 166, 180]);
    const shape = (points: typeof dense.rawPoints) => {
      const resumes = points.filter((p) => p.segmentStart).map((p) => p.rawTimeMs);
      let meters = 0;
      for (let k = 1; k < points.length; k++) {
        meters += points[k].segmentStart ? 0 : ((points[k].rawTimeMs! - points[k - 1].rawTimeMs!) / 1000) * (points[k].speedMs ?? 0);
      }
      return { resumes, first: points[0].rawTimeMs, last: points[points.length - 1].rawTimeMs, meters };
    };
    expect(shape(sparse.rawPoints)).toStrictEqual(shape(dense.rawPoints));
    expect(shape(dense.rawPoints).meters).toBe(360);
  });
});

describe('sport écrit dans le GPX', () => {
  const typeOf = (sessionSports: number[], sportMessage?: number) =>
    parseGpx(gpxOf(buildFitActivity({ points: seconds(2), sessionSports, sportMessage }))).trackType;

  it('le numéro du profil FIT devient un nom lu par `guessSport`', () => {
    const cases: [number, string][] = [[1, 'running'], [2, 'cycling'], [21, 'cycling'], [32, 'bateau'], [38, 'surf'], [43, 'windsurf'], [44, 'kite']];
    for (const [code, sport] of cases) expect(guessSport(typeOf([code]))).toBe(sport);
  });

  it('un sport connu du FIT mais pas d\'ici garde son nom et reste à classer', () => {
    expect(typeOf([11])).toBe('walking');
    expect(guessSport('walking')).toBeNull();
  });

  it('générique, inconnu, ou sans sport : pas de `<type>`, session à classer', () => {
    expect(typeOf([0])).toBeUndefined();
    expect(typeOf([200])).toBeUndefined();
    expect(typeOf([])).toBeUndefined();
    expect(typeOf([18])).toBeUndefined();
  });

  it('sans session, le sport du message `sport`', () => {
    expect(typeOf([], 1)).toBe('running');
  });

  it('multisport : une seule session, typée si un seul sport hors transitions, à classer sinon', () => {
    expect(typeOf([1, 3, 1])).toBe('running');
    expect(typeOf([5, 3, 2, 3, 1])).toBeUndefined();
  });
});

describe('FIT refusés', () => {
  it('sans aucune position (tapis, salle) : refusé, en clair', () => {
    const out = fitToGpx(buildFitActivity({ points: [{ timeMs: T0, hr: 120 }, { timeMs: T0 + 1000, hr: 121 }] }));
    expect(out).toStrictEqual({ kind: 'refused', reason: 'aucune position dans ce fichier (tapis, salle) : pas de trace à ranger' });
  });

  it('coupé : garde les points lus ; coupé avant le premier : refusé', () => {
    const whole = buildFitActivity({ points: seconds(4) });
    expect(parseGpx(gpxOf(whole.subarray(0, whole.length - 30))).rawPoints.length).toBeGreaterThan(0);
    const cut = fitToGpx(whole.subarray(0, 20));
    expect(cut).toStrictEqual({ kind: 'refused', reason: 'fichier coupé avant le premier point' });
  });

  it('type différent d\'une activité : ni session ni erreur', () => {
    expect(fitToGpx(buildFitActivity({ points: seconds(2), fileType: 2 }))).toStrictEqual({ kind: 'not-activity' });
  });

  it('signature fausse ou fichier vide : une erreur en clair', () => {
    expect(() => fitToGpx(new Uint8Array())).toThrow('fichier vide');
    expect(() => fitToGpx(new TextEncoder().encode('pas un FIT du tout'))).toThrow("ce n'est pas un fichier FIT");
  });

  it('`isFitActivity` : vrai pour une activité, ou un FIT sans type lisible', () => {
    expect(isFitActivity(buildFitActivity({ points: seconds(2) }))).toBe(true);
    expect(isFitActivity(buildFitActivity({ points: seconds(2), fileType: 6 }))).toBe(false);
    expect(isFitActivity(new TextEncoder().encode('pas un FIT du tout'))).toBe(false);
  });
});
