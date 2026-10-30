import { describe, expect, it } from 'vitest';
import { isCompleteGpxText, planPendingTemps } from './pendingTemps';

/** Temporaires du dossier en attente laissés par un plantage (lot 84, A). */
describe('planPendingTemps', () => {
  it('efface un temporaire dont la cible est là', () => {
    const plan = planPendingTemps(['s.gpx', 's.gpx.tmp', 's.imu', 's.imu.tmp']);
    expect(plan.stale).toEqual(['s.gpx.tmp', 's.imu.tmp']);
    expect(plan.sessions).toEqual([]);
    expect(plan.orphanImuTemps).toEqual([]);
  });

  it('reprend un GPX temporaire sans son GPX, avec ses capteurs déjà renommés', () => {
    const plan = planPendingTemps(['s.imu', 's.gpx.tmp']);
    expect(plan.sessions).toEqual([{ temp: 's.gpx.tmp', gpx: 's.gpx', imu: 's.imu', imuTemp: null }]);
    expect(plan.stale).toEqual([]);
  });

  it('joint à un GPX temporaire ses capteurs encore temporaires, sans en faire des orphelins', () => {
    const plan = planPendingTemps(['s.gpx.tmp', 's.imu.tmp']);
    expect(plan.sessions).toEqual([{ temp: 's.gpx.tmp', gpx: 's.gpx', imu: null, imuTemp: 's.imu.tmp' }]);
    expect(plan.orphanImuTemps).toEqual([]);
  });

  it('joint à un GPX en attente les capteurs temporaires qui lui manquent', () => {
    const plan = planPendingTemps(['s.gpx', 's.imu.tmp']);
    expect(plan.imuTemps).toEqual({ 's.gpx': 's.imu.tmp' });
    expect(plan.sessions).toEqual([]);
  });

  it('tient pour orphelins des capteurs temporaires sans GPX', () => {
    expect(planPendingTemps(['s.imu.tmp', 'autre.gpx']).orphanImuTemps).toEqual(['s.imu.tmp']);
  });

  it("ne touche pas aux temporaires d'une écriture en cours, ni à un autre .tmp", () => {
    const plan = planPendingTemps(['s.gpx.tmp', 's.imu.tmp', 't.gpx', 't.gpx.tmp', 'notes.txt.tmp'], new Set(['s.gpx', 't.gpx']));
    expect(plan).toEqual({ stale: [], sessions: [], imuTemps: {}, orphanImuTemps: [] });
  });
});

describe('isCompleteGpxText', () => {
  it('reconnaît un GPX écrit jusqu’au bout, fin de ligne comprise', () => {
    expect(isCompleteGpxText('<gpx><trk></trk></gpx>\n')).toBe(true);
    expect(isCompleteGpxText('<gpx><trk></trk></GPX>')).toBe(true);
  });

  it('refuse un GPX tronqué ou vide', () => {
    expect(isCompleteGpxText('<gpx><trk><trkseg><trkpt lat="43')).toBe(false);
    expect(isCompleteGpxText('')).toBe(false);
  });
});
