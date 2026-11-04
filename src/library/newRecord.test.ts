import { describe, expect, it } from 'vitest';
import { IMU_FORMAT, IMU_VERSION, PHONE_STREAMS, encodeImu } from '../core/imuFile';
import { JUMPS_CALC_VERSION } from '../core/jumps';
import type { SessionTest } from '../recording/fitnessTest';
import { sessionRecord } from '../test/record.fixture';
import { newRecord, recordFor, type NewRecordContext } from './newRecord';
import { RECORD_FORMAT, RECORD_VERSION } from './record';
import type { AnalyzedGpx } from './summaryOptions';

const NOW = Date.UTC(2026, 10, 4, 9, 30, 0);
const base = sessionRecord();
const analyzed: AnalyzedGpx = { summary: base.summary, sport: 'wingfoil', title: 'Wing du matin' };

/** Horloge fixe ; les notes anciennes lues sont comptées. */
const context = (legacy: Record<string, unknown> | null = null): NewRecordContext & { reads: number } => {
  const ctx = {
    reads: 0,
    now: () => NOW,
    legacyNotes: () => {
      ctx.reads += 1;
      return legacy;
    },
  };
  return ctx;
};

// Le contenu du test guidé n'est pas lu ici : seul compte qu'il soit rangé tel quel.
const TEST = { protocol: 'fcmax' } as unknown as SessionTest;

const motionWithJumps = (jumps: boolean) => encodeImu({
  format: IMU_FORMAT, version: IMU_VERSION, startedAtMs: NOW, clock: { elapsedUs: 0, wallMs: NOW },
  setup: { placement: 'poitrine', foil: false, jumps, cadence: true }, streams: [...PHONE_STREAMS],
}, []);

describe('fiche neuve d’une session (lot 113)', () => {
  it('prend le calcul, le titre et le résumé du GPX, l’heure de l’horloge donnée, sans nom ni réglages', () => {
    expect(newRecord('a.gpx', analyzed, 'import', null, context())).toEqual({
      format: RECORD_FORMAT, version: RECORD_VERSION, gpx: 'a.gpx', sport: 'wingfoil', activityId: null, source: 'import',
      addedAt: new Date(NOW).toISOString(), title: 'Wing du matin', name: null, summary: base.summary, notes: null, analysis: null,
    });
  });

  it('reprend les notes saisies avant le dossier pour le même début de trace', () => {
    const notes = { comment: 'Belle sortie', rating: 4 };
    const record = newRecord('a.gpx', analyzed, 'enregistrement', 'wing', context({ [`ancienne|${base.summary.startMs}`]: notes, [`autre|1`]: { comment: 'x' } }));
    expect(record.activityId).toBe('wing');
    expect(record.notes?.comment).toBe('Belle sortie');
  });
});

describe('fiche d’une session qui entre dans la mémoire (lot 113)', () => {
  it('garde la fiche apportée, résumé refait et calcul du GPX, sans lire les notes anciennes', () => {
    const ctx = context();
    const apportee = { ...base, name: 'Sortie', sport: 'kite' as const };
    const record = recordFor('b.gpx', analyzed, 'import', { record: apportee }, ctx);
    expect(record).toMatchObject({ gpx: 'b.gpx', name: 'Sortie', sport: 'wingfoil', summary: base.summary });
    expect(ctx.reads).toBe(0);
  });

  it('range dans une fiche neuve le foil, les séances, les repères et le test de l’enregistrement', () => {
    const record = recordFor('c.gpx', analyzed, 'enregistrement', {
      activityId: 'wing', foil: true, intervals: [], marks: [{ timeMs: NOW, lat: null, lon: null, label: 'bouée' }], test: TEST,
    }, context());
    expect(record.activityId).toBe('wing');
    expect(record.analysis?.foil).toBe(true);
    expect(record.analysis?.savedAt).toBe(NOW);
    expect(record.intervals).toBeUndefined();
    expect(record.marks).toHaveLength(1);
    expect(record.test).toBe(TEST);
  });

  it('dit tout de suite « pas de sauts à chercher » pour une capture de la seule cadence', async () => {
    const cadence = recordFor('d.gpx', analyzed, 'enregistrement', { motion: await motionWithJumps(false) }, context());
    expect(cadence.jumps).toEqual({ version: JUMPS_CALC_VERSION, computedAt: new Date(NOW).toISOString(), jumps: [], measured: false });
    const sauts = recordFor('d.gpx', analyzed, 'enregistrement', { motion: await motionWithJumps(true) }, context());
    expect(sauts.jumps).toBeUndefined();
  });
});
