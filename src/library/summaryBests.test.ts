import { describe, expect, it } from 'vitest';
import { cyclingEnergyParams, resistiveForceN } from '../cycling/energy';
import { phasesTrack } from '../test/track.fixture';
import { SUMMARY_BESTS_BOUNDS, parseRecord, type SessionSummary } from './record';
import { sessionRecord } from '../test/record.fixture';
import { summarizeSession } from './summary';
import { isSummaryOutdated, summaryOptions, summaryOptionsKey } from './summaryOptions';
import type { SessionRecord } from './record';

/** Meilleurs efforts du résumé (lot 146) : 5 km, 10 km, et à vélo la puissance des meilleurs 20 min. */

const START_MS = Date.parse('2026-09-20T10:00:00Z');
const track = (phases: [number, number][], hz = 1) => phasesTrack(phases, hz, { startMs: START_MS });
const POWER: { bikeType: 'route' | 'gravel'; bikeKg: number; riderKg: number | null } = { bikeType: 'route', bikeKg: 8.5, riderKg: 70 };

describe('meilleurs efforts du résumé (lot 146)', () => {
  it('course de 6 km à vitesse constante : le 5 km exact à 1 s près, pas de 10 km ; 1 Hz = 5 Hz', () => {
    const at1 = summarizeSession(track([[2000, 3]]), 'running')!.bests!;
    expect(Math.abs(at1.d5kmS! - 5000 / 3)).toBeLessThanOrEqual(1);
    expect(at1.d10kmS).toBeUndefined();
    expect(at1.p20minW).toBeUndefined();
    const at5 = summarizeSession(track([[2000, 3]], 5), 'running')!.bests!;
    expect(Math.abs(at5.d5kmS! - at1.d5kmS!)).toBeLessThanOrEqual(1);
    expect(at5.d10kmS).toBeUndefined();
  });

  it('garde le meilleur passage : 5 km plus vite au milieu de la course', () => {
    const bests = summarizeSession(track([[600, 2.5], [1250, 4], [600, 2.5]]), 'running')!.bests!;
    expect(Math.abs(bests.d5kmS! - 1250)).toBeLessThanOrEqual(1);
  });

  it('rien sur une session trop courte, rien en voile ni en surf', () => {
    expect(summarizeSession(track([[600, 3]]), 'running')!.bests).toBeUndefined();
    expect(summarizeSession(track([[3000, 5]]), 'wingfoil')!.bests).toBeUndefined();
    expect(summarizeSession(track([[3000, 5]]), 'surf')!.bests).toBeUndefined();
  });

  it('vélo : 5 km, 10 km, et la puissance des meilleurs 20 min du modèle du vélo ; 1 Hz = 5 Hz', () => {
    const v = 8;
    const expected = (resistiveForceN(v, 0, cyclingEnergyParams('route', POWER.bikeKg, 70)) * v) / 0.97;
    const at1 = summarizeSession(track([[1500, v]]), 'cycling', { cyclingPower: POWER })!.bests!;
    expect(Math.abs(at1.d5kmS! - 5000 / v)).toBeLessThanOrEqual(1);
    expect(Math.abs(at1.d10kmS! - 10000 / v)).toBeLessThanOrEqual(1);
    expect(Math.abs(at1.p20minW! - expected)).toBeLessThanOrEqual(1);
    expect(at1.powerRiderKg).toBe(70);
    const at5 = summarizeSession(track([[1500, v]], 5), 'cycling', { cyclingPower: POWER })!.bests!;
    expect(Math.abs(at5.p20minW! - at1.p20minW!)).toBeLessThanOrEqual(1);
    expect(Math.abs(at5.d10kmS! - at1.d10kmS!)).toBeLessThanOrEqual(1);
  });

  it('vélo : un arrêt compte à 0 W dans la fenêtre ; sous 20 min, pas de puissance mais le poids retenu', () => {
    const v = 8;
    const steady = summarizeSession(track([[1500, v]]), 'cycling', { cyclingPower: POWER })!.bests!.p20minW!;
    const stopped = summarizeSession(track([[600, v], [300, 0], [600, v]]), 'cycling', { cyclingPower: POWER })!.bests!.p20minW!;
    expect(stopped).toBeLessThan(steady);
    const short = summarizeSession(track([[900, v]]), 'cycling', { cyclingPower: POWER })!.bests!;
    expect(short.p20minW).toBeUndefined();
    expect(short.powerRiderKg).toBe(70);
  });

  it('vélo sans poids du pratiquant : ni puissance ni poids retenu', () => {
    const bests = summarizeSession(track([[1500, 8]]), 'cycling')!.bests!;
    expect(bests.p20minW).toBeUndefined();
    expect(bests.powerRiderKg).toBeUndefined();
    expect(bests.d10kmS).toBeDefined();
  });

  it('les réglages du résumé : le vélo de l’activité, le poids du vélo de la session, le pratiquant même sans poids', () => {
    const cycling = { bikeType: 'gravel' as const, bikeKg: 12, riderKg: 70 };
    const options = summaryOptions('cycling', null, { thresholdOverride: undefined, foil: null, cycling });
    expect(options.cyclingPower).toEqual(cycling);
    const analysis = { bikeWeightKg: 15 } as Parameters<typeof summaryOptions>[1];
    expect(summaryOptions('cycling', analysis, { thresholdOverride: undefined, foil: null, cycling }).cyclingPower).toEqual({ ...cycling, bikeKg: 15 });
    expect(summaryOptions('cycling', null, { thresholdOverride: undefined, foil: null, cycling: { ...cycling, riderKg: null } }).cyclingPower).toEqual({ ...cycling, riderKg: null });
    expect(summaryOptions('running', null, { thresholdOverride: undefined, foil: null, cycling }).cyclingPower).toBeUndefined();
    // Sans poids du pratiquant, la puissance n'est pas cherchée.
    const bests = summarizeSession(track([[1500, 8]]), 'cycling', { cyclingPower: { ...POWER, riderKg: null } })!.bests!;
    expect(bests.p20minW).toBeUndefined();
    expect(bests.powerRiderKg).toBeUndefined();
  });

  it('empreinte : le type et le poids du vélo à vélo seulement, pas le poids du pratiquant', () => {
    const key = (cycling: { bikeType: 'route' | 'gravel'; bikeKg: number; riderKg: number | null }, sport: 'cycling' | 'running' = 'cycling') =>
      summaryOptionsKey(sport, summaryOptions(sport, null, { thresholdOverride: undefined, foil: null, cycling }));
    expect(key(POWER)).toBe(JSON.stringify([null, null, null, null, ['route', 8.5]]));
    expect(key({ ...POWER, riderKg: 90 })).toBe(key(POWER));
    expect(key({ ...POWER, bikeKg: 10 })).not.toBe(key(POWER));
    expect(key({ ...POWER, bikeType: 'gravel' })).not.toBe(key(POWER));
    expect(key(POWER, 'running')).toBe(JSON.stringify([null, null, null, null]));
  });

  it('fiche relue : les meilleurs efforts gardés, une valeur abîmée ou invraisemblable oubliée', () => {
    const summary = summarizeSession(track([[1500, 8]]), 'cycling', { cyclingPower: POWER })!;
    const raw = { ...sessionRecord(), summary: { ...summary, bests: { d5kmS: 'abîmé', d10kmS: 2500, p20minW: -3, powerRiderKg: 70 } } };
    const read = parseRecord(JSON.stringify(raw))!;
    expect(read.summary.bests).toEqual({ d10kmS: 2500, powerRiderKg: 70 });
    const none = parseRecord(JSON.stringify({ ...raw, summary: { ...summary, bests: { d5kmS: null } } }))!;
    expect(none.summary.bests).toBeUndefined();
    // Hors des bornes (`SUMMARY_BESTS_BOUNDS`) : 1 s au 5 km, 1e9 W, 0,001 kg.
    const absurd = parseRecord(JSON.stringify({ ...raw, summary: { ...summary, bests: { d5kmS: 1, d10kmS: 2500, p20minW: 1e9, powerRiderKg: 0.001 } } }))!;
    expect(absurd.summary.bests).toEqual({ d10kmS: 2500 });
    // Le vélo garde ses chiffres : 10 km en 1 250 s, 5 km en 450 s ; sous 300 s et 600 s, oubliés.
    expect(parseRecord(JSON.stringify(raw))!.summary.bests).toBeDefined();
    expect(parseRecord(JSON.stringify({ ...raw, summary: { ...summary } }))!.summary.bests).toEqual(summary.bests);
    expect(parseRecord(JSON.stringify({ ...raw, summary: { ...summary, bests: { d5kmS: 450, d10kmS: 1250 } } }))!.summary.bests).toEqual({ d5kmS: 450, d10kmS: 1250 });
    expect(parseRecord(JSON.stringify({ ...raw, summary: { ...summary, bests: { d5kmS: 299, d10kmS: 599 } } }))!.summary.bests).toBeUndefined();
    const edges = { d5kmS: SUMMARY_BESTS_BOUNDS.d5kmS.max, d10kmS: SUMMARY_BESTS_BOUNDS.d10kmS.min, p20minW: 2000, powerRiderKg: 20 };
    expect(parseRecord(JSON.stringify({ ...raw, summary: { ...summary, bests: edges } }))!.summary.bests).toEqual(edges);
  });

  it('à refaire une fois le poids du pratiquant connu, ou si le vélo de l’activité change dans Réglages', () => {
    const device = (over: Partial<typeof POWER> | { riderKg: null } = {}) => () => ({ thresholdOverride: undefined, foil: null, cycling: { ...POWER, ...over } });
    const record = (summary: SessionSummary, made: ReturnType<typeof device>) => ({
      gpx: 'a.gpx', sport: 'cycling', activityId: null, analysis: null,
      summary: { ...summary, optionsKey: summaryOptionsKey('cycling', summaryOptions('cycling', null, made())) },
    }) as unknown as SessionRecord;
    const unknown = device({ riderKg: null });
    const without = record(summarizeSession(track([[1500, 8]]), 'cycling', summaryOptions('cycling', null, unknown()))!, unknown);
    expect(isSummaryOutdated(without, unknown)).toBe(false);
    expect(isSummaryOutdated(without, device())).toBe(true);
    const known = device();
    const withPower = record(summarizeSession(track([[1500, 8]]), 'cycling', summaryOptions('cycling', null, known()))!, known);
    expect(isSummaryOutdated(withPower, known)).toBe(false);
    // Poids du pratiquant changé : rien à refaire ; poids ou type du vélo changé : à refaire.
    expect(isSummaryOutdated(withPower, device({ riderKg: 90 }))).toBe(false);
    expect(isSummaryOutdated(withPower, device({ bikeKg: 10 }))).toBe(true);
    expect(isSummaryOutdated(withPower, device({ bikeType: 'gravel' } as Partial<typeof POWER>))).toBe(true);
  });
});
