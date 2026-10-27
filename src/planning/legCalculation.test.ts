import { describe, expect, it } from 'vitest';
import type { LegOptions } from './brouter';
import { computeLeg, computeReturn, type LegFetcher } from './legCalculation';
import { LOOP_RETURN_DEFAULTS } from './loopReturn';
import type { ReturnRequest, RouteLeg, RoutePoint, Waypoint } from './route';

const A: Waypoint = { lat: 43.6, lon: 3.8 };
const B: Waypoint = { lat: 43.61, lon: 3.8 };

/** Un degré de latitude fait un peu plus de 111 km : 0,01° ≈ 1 112 m. */
const STEP_M = 1112;

/** Tracé de A à B, détourné vers l'est de `eastDeg` à mi-chemin : plus long que l'aller. */
const via = (from: Waypoint, to: Waypoint, eastDeg: number): RoutePoint[] => [
  { ...from },
  { lat: (from.lat + to.lat) / 2, lon: from.lon + eastDeg },
  { ...to },
];

/** Aller de A à B, sinueux sur un peu plus d'un kilomètre (assez long pour un couloir), calculé. */
const outbound: RouteLeg[] = [{
  mode: 'sentier',
  status: 'ready',
  points: Array.from({ length: 101 }, (_, i) => ({ lat: A.lat + (i / 100) * (B.lat - A.lat), lon: A.lon + 0.002 * Math.sin(i / 5) })),
}];

const request = (outboundLegs: RouteLeg[] = outbound): ReturnRequest => ({
  basis: 'aller', variant: 0, from: B, to: A, mode: 'sentier', outbound: outboundLegs,
});

/** Serveur simulé : rend, à chaque essai, la réponse suivante ; retient les options reçues. */
const fakeServer = (answers: (RoutePoint[] | Error)[]) => {
  const seen: (LegOptions | undefined)[] = [];
  const fetcher: LegFetcher = async (_from, _to, _ways, _vehicle, _signal, options) => {
    seen.push(options);
    const answer = answers[seen.length - 1];
    if (answer instanceof Error) throw answer;
    return { points: answer };
  };
  return { fetcher, seen };
};

const signal = new AbortController().signal;

describe('retour d\'une boucle', () => {
  it('un retour avec couloir trop long passe à l\'essai suivant, puis au plus court', async () => {
    // Deux essais avec couloir (poids 200 puis 20), chacun bien au-delà de 1,5 fois l'aller ; le plus court ensuite.
    const { fetcher, seen } = fakeServer([via(B, A, 0.05), via(B, A, 0.05), via(B, A, 0)]);
    const outcome = await computeReturn(fetcher, request(), 'pieton', 500, 1.5, LOOP_RETURN_DEFAULTS, signal);
    expect(seen).toHaveLength(3);
    expect(seen[0]?.polygons).toBeDefined();
    expect(seen[1]?.polygons).toBeDefined();
    expect(seen[2]?.polygons).toBeUndefined();
    expect(outcome).toMatchObject({ outcome: 'shortest' });
  });

  it('le premier retour sous le rapport est gardé, par d\'autres voies', async () => {
    const { fetcher, seen } = fakeServer([via(B, A, 0.004)]);
    const outcome = await computeReturn(fetcher, request(), 'pieton', 500, 1.5, LOOP_RETURN_DEFAULTS, signal);
    expect(seen).toHaveLength(1);
    expect(outcome).toMatchObject({ outcome: 'avoided' });
  });

  it('un essai avec couloir en échec passe au suivant ; tous en échec, la dernière raison', async () => {
    const { fetcher } = fakeServer([new Error('refusé'), via(B, A, 0.004)]);
    expect(await computeReturn(fetcher, request(), 'pieton', 500, 1.5, LOOP_RETURN_DEFAULTS, signal)).toMatchObject({ outcome: 'avoided' });
    const failing = fakeServer([new Error('un'), new Error('deux'), new Error('trois')]);
    expect(await computeReturn(failing.fetcher, request(), 'pieton', 500, 1.5, LOOP_RETURN_DEFAULTS, signal)).toEqual({ error: 'trois' });
  });

  it('sans rapport (voile), pas de couloir : le plus court d\'office', async () => {
    const { fetcher, seen } = fakeServer([via(B, A, 0)]);
    const outcome = await computeReturn(fetcher, request(), 'pieton', 500, null, LOOP_RETURN_DEFAULTS, signal);
    expect(seen).toEqual([{ alternative: 0 }]);
    expect(outcome).toMatchObject({ outcome: 'shortest' });
  });

  it('aller trop long pour l\'adresse : le plus court, marqué tooLong', async () => {
    const { fetcher, seen } = fakeServer([via(B, A, 0)]);
    const outcome = await computeReturn(fetcher, request(), 'pieton', 500, 1.5, { ...LOOP_RETURN_DEFAULTS, maxParamChars: 10 }, signal);
    expect(seen).toHaveLength(1);
    expect(outcome).toMatchObject({ outcome: 'shortest', tooLong: true });
  });

  it('la part commune ne compte pas la ligne droite d\'un tronçon en échec', async () => {
    const failed: RouteLeg[] = [{ mode: 'sentier', status: 'error', error: 'Pas de réseau', points: [{ ...A }, { ...B }] }];
    // Le retour revient exactement par la ligne droite de l'aller.
    const { fetcher } = fakeServer([[{ ...B }, { ...A }]]);
    const outcome = await computeReturn(fetcher, request(failed), 'pieton', 500, 1.5, LOOP_RETURN_DEFAULTS, signal);
    expect(outcome).toMatchObject({ sharedM: 0 });
  });

  it('un retour qui part loin du point posé est refusé', async () => {
    const far = [{ lat: B.lat + 1000 / STEP_M / 100, lon: B.lon }, { ...A }];
    const { fetcher } = fakeServer([far]);
    const outcome = await computeReturn(fetcher, request(), 'pieton', 500, null, LOOP_RETURN_DEFAULTS, signal);
    expect(outcome).toMatchObject({ error: expect.stringMatching(/Point à 1000 m/) });
  });
});

describe('tronçon', () => {
  it('rend le tracé relié aux points, ou la raison de l\'échec en clair', async () => {
    const ok = fakeServer([via(A, B, 0)]);
    expect(await computeLeg(ok.fetcher, { key: 'k', from: A, to: B, mode: 'sentier' }, 'pieton', 500, signal)).toMatchObject({ points: via(A, B, 0) });
    const ko = fakeServer([new Error('Pas de réseau')]);
    expect(await computeLeg(ko.fetcher, { key: 'k', from: A, to: B, mode: 'sentier' }, 'pieton', 500, signal)).toEqual({ error: 'Pas de réseau' });
  });

  it('un abandon est relancé', async () => {
    const aborting: LegFetcher = async () => {
      throw new DOMException('Abandon', 'AbortError');
    };
    await expect(computeLeg(aborting, { key: 'k', from: A, to: B, mode: 'sentier' }, 'pieton', 500, signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
