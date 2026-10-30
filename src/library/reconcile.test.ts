import { describe, expect, it } from 'vitest';
import type { FolderEntry } from '../platform/memoryFolder';
import type { SessionRecord } from './record';
import { indexByRecordName, planReconcile, type LibraryCache } from './reconcile';
import { sessionRecord } from '../test/record.fixture';

const file = (name: string, size = 100, mtimeMs = 1000): FolderEntry => ({ name, kind: 'file', size, mtimeMs });

const record = (gpx: string): SessionRecord =>
  sessionRecord({ gpx, sport: 'running', source: 'import', title: null }, { startMs: 1, endMs: 2, distanceM: 3, movingTimeS: 1, maxSpeedMs: 3, pointCount: 2 });

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

  it('rapproche une fiche .JSON en majuscules de son GPX, sans orpheline', () => {
    const plan = planReconcile([file('a.gpx'), file('A1.gpx'), file('a.JSON'), file('A1.json')], [], {});
    expect(plan.read).toEqual(['A1.gpx', 'a.gpx']);
    expect(plan.summarize).toEqual([]);
    expect(plan.orphanRecords).toEqual([]);
  });

  it('une fiche .JSON sans GPX reste orpheline sous son vrai nom', () => {
    const plan = planReconcile([file('a.gpx'), file('a.json'), file('z.JSON')], [], {});
    expect(plan.orphanRecords).toEqual(['z.JSON']);
  });

  it('relit une fiche absente du cache, résume un GPX sans fiche', () => {
    const plan = planReconcile([file('a.gpx'), file('a.json'), file('copie-du-pc.gpx')], [], {});
    expect(plan.read).toEqual(['a.gpx']);
    expect(plan.summarize).toEqual(['copie-du-pc.gpx']);
    expect(plan.gpxFiles).toEqual(['a.gpx', 'copie-du-pc.gpx']);
  });

  it('casse mêlée : un GPX en .GPX retrouve sa fiche .json ; une fiche en .JSON retrouve aussi son GPX', () => {
    const plan = planReconcile([file('A.GPX'), file('A.json'), file('b.gpx'), file('b.JSON')], [], {});
    expect(plan.read).toEqual(['A.GPX', 'b.gpx']);
    expect(plan.summarize).toEqual([]);
    expect(plan.orphanRecords).toEqual([]);
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
    expect(plan.rootRecords).toEqual({});
  });

  it('fait suivre à un GPX de la racine la fiche posée à côté de lui, jamais le marqueur ni les réglages', () => {
    const plan = planReconcile(
      [],
      [file('a.gpx'), file('a.json'), file('b.gpx'), file('c.json'), file('tracker.gpx'), file('tracker.json'), file('reglages.gpx'), file('reglages.json')],
      {}
    );
    expect(plan.rootGpx).toEqual(['a.gpx', 'b.gpx', 'reglages.gpx', 'tracker.gpx']);
    expect(plan.rootRecords).toEqual({ 'a.gpx': 'a.json' });
  });
});

describe('indexByRecordName', () => {
  it('retrouve une fiche .JSON par son nom en minuscules et garde son nom réel pour le cache', () => {
    const entries = [file('a.gpx'), file('a.JSON'), file('b.json')];
    const byName = indexByRecordName(entries);
    const entry = byName.get('a.json');
    expect(entry?.name).toBe('a.JSON');
    expect(byName.get('b.json')?.name).toBe('b.json');
    // Le cache rangé sous le nom réel est repris par planReconcile.
    const cache: LibraryCache = { [entry!.name]: { size: 100, mtimeMs: 1000, record: record('a.gpx') } };
    expect(Object.keys(planReconcile(entries, [], cache).reuse)).toEqual(['a.gpx']);
  });
});
