import { describe, expect, it } from 'vitest';
import type { FolderEntry } from '../platform/memoryFolder';
import { RECORD_FORMAT, RECORD_VERSION, SUMMARY_CALC_VERSION, type SessionRecord } from './record';
import { planReconcile, type LibraryCache } from './reconcile';

const file = (name: string, size = 100, mtimeMs = 1000): FolderEntry => ({ name, kind: 'file', size, mtimeMs });

const record = (gpx: string): SessionRecord => ({
  format: RECORD_FORMAT,
  version: RECORD_VERSION,
  gpx,
  sport: 'running',
  source: 'import',
  addedAt: '2026-09-23T13:00:00.000Z',
  title: null,
  name: null,
  summary: {
    calcVersion: SUMMARY_CALC_VERSION, startMs: 1, endMs: 2, distanceM: 3, movingTimeS: 1,
    elevationGainM: null, maxSpeedMs: 3, pointCount: 2, samplingS: 1,
  },
  notes: null,
  analysis: null,
});

describe('planReconcile', () => {
  it('reprend du cache une fiche inchangée et relit une fiche modifiée', () => {
    const cache: LibraryCache = {
      'a.json': { size: 100, mtimeMs: 1000, record: record('a.gpx') },
      'b.json': { size: 100, mtimeMs: 1000, record: record('b.gpx') },
    };
    const plan = planReconcile(
      [file('a.gpx'), file('a.json'), file('b.gpx'), file('b.json', 100, 2000)],
      [],
      cache
    );
    expect(Object.keys(plan.reuse)).toEqual(['a.gpx']);
    expect(plan.read).toEqual(['b.gpx']);
    expect(plan.summarize).toEqual([]);
  });

  it('relit une fiche absente du cache, résume un GPX sans fiche', () => {
    const plan = planReconcile([file('a.gpx'), file('a.json'), file('copie-du-pc.gpx')], [], {});
    expect(plan.read).toEqual(['a.gpx']);
    expect(plan.summarize).toEqual(['copie-du-pc.gpx']);
    expect(plan.gpxFiles).toEqual(['a.gpx', 'copie-du-pc.gpx']);
  });

  it('laisse de côté une fiche sans GPX et les sous-dossiers', () => {
    const plan = planReconcile(
      [file('orpheline.json'), file('a.gpx'), { name: 'vieux', kind: 'directory', size: 0, mtimeMs: 0 }],
      [],
      {}
    );
    expect(plan.orphanRecords).toEqual(['orpheline.json']);
    expect(plan.gpxFiles).toEqual(['a.gpx']);
  });

  it('repère les GPX posés à la racine, et rien d\'autre', () => {
    const plan = planReconcile(
      [],
      [file('tracker.json'), file('reglages.json'), file('LISEZMOI.txt'), file('2026-09-23_18-00-00_running.GPX')],
      {}
    );
    expect(plan.rootGpx).toEqual(['2026-09-23_18-00-00_running.GPX']);
  });
});
