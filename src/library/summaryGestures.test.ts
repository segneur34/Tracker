import { describe, expect, it } from 'vitest';
import type { Activity } from '../core/activities';
import { sessionRecord } from '../test/record.fixture';
import type { LibrarySession } from './record';
import { activityValues, noteGestures, readSummaryGestures, settleGestures, waitingGestureActivities, type SummaryGestures } from './summaryGestures';

const activity = (id: string, base: Activity['base']): Activity => ({ id, name: id, base, color: '#000' });

describe('réglages suivis par activité (Q57)', () => {
  it('le seuil réglé ou pré-réglé ; le foil en surf seulement', () => {
    const thresholds: Record<string, number> = { 'a-moth': 7, surf: 4 };
    const values = activityValues(
      [activity('a-moth', 'wingfoil'), activity('surf', 'surf'), activity('a-trail', 'cycling')],
      (a) => ({ thresholdOverride: thresholds[a.id], foil: true }),
    );
    expect(values['a-moth']).toEqual({ threshold: 7 });
    expect(values.surf).toEqual({ threshold: 4, foil: true });
    expect(values['a-trail']).toEqual({ threshold: null });
  });
});

describe('gestes', () => {
  const start: SummaryGestures = { baseline: { course: { threshold: 6 }, surf: { threshold: null, foil: false } }, pending: {} };

  it('sans comparaison passée : référence posée, rien à refaire', () => {
    expect(noteGestures(null, { course: { threshold: 6 } })).toEqual({ baseline: { course: { threshold: 6 } }, pending: {} });
  });

  it('un seuil changé : ce composant seul', () => {
    const next = noteGestures(start, { course: { threshold: 7 }, surf: { threshold: null, foil: false } });
    expect(next.pending).toEqual({ course: { threshold: 7 } });
    expect(next.baseline.course).toEqual({ threshold: 7 });
  });

  it('un seuil retiré vaut un geste ; un foil changé en surf aussi', () => {
    const next = noteGestures(start, { course: { threshold: null }, surf: { threshold: null, foil: true } });
    expect(next.pending).toEqual({ course: { threshold: null }, surf: { foil: true } });
  });

  it('rien de changé : rien à refaire, et ce qui attendait reste', () => {
    expect(noteGestures(start, start.baseline).pending).toEqual({});
    const waiting = { ...start, pending: { course: { threshold: 6 } } };
    expect(noteGestures(waiting, start.baseline).pending).toEqual({ course: { threshold: 6 } });
  });

  it('un second geste remplace le premier sur son composant, et le complète sur l\'autre', () => {
    const first = noteGestures(start, { ...start.baseline, surf: { threshold: 3, foil: false } });
    const second = noteGestures(first, { ...start.baseline, surf: { threshold: 4, foil: true } });
    expect(second.pending.surf).toEqual({ threshold: 4, foil: true });
  });

  it('réglages repris d\'eux-mêmes : référence à jour, pas de geste', () => {
    const next = noteGestures(start, { course: { threshold: 9 }, surf: { threshold: null, foil: true } }, true);
    expect(next.pending).toEqual({});
    expect(next.baseline.course).toEqual({ threshold: 9 });
  });

  it("réglages repris d'eux-mêmes : un geste en attente d'un lancement précédent reste", () => {
    const waiting = { ...start, pending: { course: { threshold: 7 } } };
    const next = noteGestures(waiting, { course: { threshold: 9 }, surf: { threshold: null, foil: true } }, true);
    expect(next.pending).toEqual({ course: { threshold: 7 } });
    expect(next.baseline.course).toEqual({ threshold: 9 });
  });

  it('activité nouvelle : pas de geste ; activité supprimée : elle sort de la référence et de l\'attente', () => {
    const waiting = { ...start, pending: { surf: { foil: true } } };
    const next = noteGestures(waiting, { course: { threshold: 6 }, neuve: { threshold: 3 } });
    expect(next.pending).toEqual({});
    expect(Object.keys(next.baseline).sort()).toEqual(['course', 'neuve']);
  });

  it('gestes faits retirés, les autres gardés', () => {
    const waiting = { ...start, pending: { course: { threshold: 7 }, surf: { foil: true } } };
    expect(settleGestures(waiting, (id) => id === 'surf').pending).toEqual({ surf: { foil: true } });
  });

  it('état relu : mal formé, comme absent ; composants mal formés écartés', () => {
    expect(readSummaryGestures(null)).toBeNull();
    expect(readSummaryGestures({ pending: {} })).toBeNull();
    expect(readSummaryGestures({ baseline: { a: { threshold: 'x', foil: true } } })).toEqual({ baseline: { a: { foil: true } }, pending: {} });
  });
});

describe('activités dont un geste attend encore (lot 113)', () => {
  const session = (file: string, patch: Partial<LibrarySession> = {}, record: Parameters<typeof sessionRecord>[0] = {}): LibrarySession =>
    ({ file, record: sessionRecord({ gpx: file, ...record }), readOnly: false, warning: null, ...patch });

  it('relève l’activité de chaque session qui attend, ni en lecture seule ni sans calcul', () => {
    const sessions = [
      session('a.gpx', {}, { activityId: 'wing' }),
      session('b.gpx', { readOnly: true }, { activityId: 'kite' }),
      session('c.gpx', {}, { sport: null, activityId: 'moth' }),
      session('d.gpx', {}, { activityId: 'faite' }),
      session('e.gpx', {}, { activityId: 'supprimee' }),
    ];
    const ids = waitingGestureActivities(sessions, (s) => s.file !== 'd.gpx', (_sport, id) => (id === 'supprimee' ? null : id ?? null));
    expect([...ids]).toEqual(['wing']);
  });

  it('demande l’activité du geste par le calcul et l’activité de la session', () => {
    const asked: string[] = [];
    waitingGestureActivities([session('a.gpx', {}, { activityId: null })], () => true, (sport, id) => {
      asked.push(`${sport}|${id}`);
      return 'wingfoil';
    });
    expect(asked).toEqual(['wingfoil|null']);
  });
});
