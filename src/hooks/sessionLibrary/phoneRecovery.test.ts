import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describePhoneRecovery } from '../../library/phoneRecovery';
import type { MemoryFolder } from '../../platform/memoryFolder';
import { gpxAt, settle, trackTestTimers } from '../../test/library.fixture';
import { createFakeFolder } from '../../test/memoryFolder.fixture';

/**
 * « Récupérer les sessions du téléphone » : les sessions du téléphone branché entrent dans la mémoire de l'ordinateur
 * par l'import, sans doublon ; une session déjà là n'est pas relue ; un débranchement laisse entier ce qui est rangé ;
 * rien n'est jamais demandé au téléphone d'autre que son état, son listage et des lectures.
 */

const files = new Map<string, string>();
const log: string[] = [];
const byteSize = (path: string): number => new TextEncoder().encode(files.get(path) ?? '').length;
const fakeFolder: MemoryFolder = createFakeFolder(files, log, {}, byteSize);

/** Le téléphone : ses fichiers (chemin relatif à Documents/Tracker → texte), ses lectures, sa coupure. */
let phoneFiles: Map<string, string>;
let phoneReads: string[];
/** Tout ce que la page a demandé au téléphone, par nom de fonction. */
let phoneCalls: string[];
let cutAfter: number | null;
let phoneState: { etat: 'pret'; nom: string } | { etat: 'absent' } | { etat: 'plusieurs'; nombre: number } | { etat: 'adbIntrouvable'; dossier: string };

const answer = <T,>(valeur: T) => Promise.resolve({ ok: true as const, valeur });

const plugPhone = (): void => {
  const telephone = {
    etat: () => {
      phoneCalls.push('etat');
      return answer(phoneState);
    },
    lister: () => {
      phoneCalls.push('lister');
      return answer([...phoneFiles].map(([chemin, text]) => ({ chemin, taille: new TextEncoder().encode(text).length, dateMs: 0 })));
    },
    lireOctets: ({ chemin }: { chemin: string }) => {
      phoneCalls.push('lireOctets');
      phoneReads.push(chemin);
      if (cutAfter !== null && phoneReads.length > cutAfter) phoneState = { etat: 'absent' };
      if (phoneState.etat !== 'pret') return Promise.resolve({ ok: false as const, code: 'UNKNOWN', message: 'perdu' });
      return answer(new TextEncoder().encode(phoneFiles.get(chemin) ?? ''));
    },
  };
  vi.stubGlobal('window', { trackerBureau: { version: '0.0.0', memoire: { ouvrir: async () => null }, telephone } });
};

const openFresh = async () => {
  vi.resetModules();
  vi.doMock('../../platform/memoryFolder', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../platform/memoryFolder')>()),
    openMemoryFolder: async () => ({ state: 'ready', folder: fakeFolder }),
    pendingFolder: () => null,
  }));
  const library = await import('../useSessionLibrary');
  await library.openLibrary();
  await settle(library);
  const recovery = await import('./phoneRecovery');
  plugPhone();
  return { library, recovery };
};

/** Récupère, puis rend l'issue et ses phrases. */
const recover = async (recovery: typeof import('./phoneRecovery')) => {
  await recovery.recoverFromPhone();
  const step = recovery.phoneRecoveryStep();
  if (step.step !== 'over') throw new Error(`récupération non finie : ${step.step}`);
  return { outcome: step.outcome, text: describePhoneRecovery(step.outcome) };
};

const pcGpx = (): string[] => [...files.keys()].filter((p) => p.startsWith('sessions/') && p.endsWith('.gpx')).sort();

let stopTimers = () => {};
beforeEach(() => {
  files.clear();
  log.length = 0;
  phoneFiles = new Map([
    ['sessions/a.gpx', gpxAt(1)], ['sessions/a.json', '{}'],
    ['sessions/b.gpx', gpxAt(2)],
    ['sessions/c.gpx', gpxAt(3)],
    ['tracker.json', '{}'],
  ]);
  phoneReads = [];
  phoneCalls = [];
  cutAfter = null;
  phoneState = { etat: 'pret', nom: 'Xiaomi' };
  stopTimers = trackTestTimers();
});
afterEach(() => {
  stopTimers();
  vi.unstubAllGlobals();
  vi.doUnmock('../../platform/memoryFolder');
});

describe('récupérer les sessions du téléphone', () => {
  it('trois sessions ajoutées ; au second clic, trois déjà présentes, sans rien relire', async () => {
    const { recovery, library } = await openFresh();
    const first = await recover(recovery);
    expect(first.text.paragraphs).toEqual(['3 sessions ajoutées.']);
    expect(pcGpx()).toHaveLength(3);
    expect(library.readLibraryState().importing).toBe(false);
    // Le téléphone range ses sessions sous les mêmes noms que l'ordinateur.
    phoneFiles = new Map(pcGpx().map((p) => [p, files.get(p)!]));
    phoneReads = [];
    const second = await recover(recovery);
    expect(second.text.paragraphs).toEqual(['0 sessions ajoutées, 3 déjà présentes.']);
    expect(phoneReads).toEqual([]);
    expect(pcGpx()).toHaveLength(3);
  });

  it('sous un autre nom, une session déjà là est reconnue par son départ : jamais doublée', async () => {
    const { recovery } = await openFresh();
    await recover(recovery);
    const again = await recover(recovery);
    expect(again.text.paragraphs).toEqual(['0 sessions ajoutées, 3 déjà présentes.']);
    expect(pcGpx()).toHaveLength(3);
  });

  it('compte la progression fichier par fichier, sur les seuls fichiers à lire', async () => {
    const { recovery } = await openFresh();
    const seen: string[] = [];
    const pending = recovery.recoverFromPhone();
    // Relevé à chaque lecture : la lecture passe par le pont, l'étape est déjà posée.
    const read = (window as unknown as { trackerBureau: { telephone: { lireOctets: (a: { chemin: string }) => Promise<unknown> } } }).trackerBureau.telephone;
    const original = read.lireOctets;
    read.lireOctets = (a) => {
      const step = recovery.phoneRecoveryStep();
      if (step.step === 'reading') seen.push(`${step.done}/${step.total}`);
      return original(a);
    };
    await pending;
    expect(recovery.phoneRecoveryStep().step).toBe('over');
    // a.gpx et sa fiche, b.gpx, c.gpx : quatre fichiers à lire, tracker.json non compté.
    expect([...phoneReads].sort()).toEqual(['sessions/a.gpx', 'sessions/a.json', 'sessions/b.gpx', 'sessions/c.gpx']);
    expect(seen).toEqual(['0/4', '1/4', '2/4', '3/4']);
  });

  it('câble tiré en route : la session lue reste entière, les suivantes échouent sans rien demander, « Réessayer »', async () => {
    cutAfter = 2;
    const { recovery } = await openFresh();
    const { outcome, text } = await recover(recovery);
    expect(outcome.kind === 'done' && outcome.unplugged).toBe(true);
    expect(pcGpx()).toHaveLength(1);
    expect(text.retry).toBe(true);
    expect(text.paragraphs[1]).toBe('1 session ajoutée.');
    // a.gpx et sa fiche lus, b.gpx demandé une fois ; c.gpx jamais.
    expect(phoneReads).toEqual(['sessions/a.gpx', 'sessions/a.json', 'sessions/b.gpx']);
    // Rebranché : seules les sessions qui manquent sont lues.
    cutAfter = null;
    phoneState = { etat: 'pret', nom: 'Xiaomi' };
    phoneReads = [];
    const again = await recover(recovery);
    expect(again.text.paragraphs).toEqual(['2 sessions ajoutées, 1 déjà présente.']);
    expect(pcGpx()).toHaveLength(3);
  });

  it('téléphone pas prêt : son état, rien de lu ni de rangé', async () => {
    phoneState = { etat: 'absent' };
    const { recovery } = await openFresh();
    expect((await recover(recovery)).outcome).toEqual({ kind: 'phone', state: 'absent' });
    phoneState = { etat: 'plusieurs', nombre: 2 };
    expect((await recover(recovery)).outcome).toEqual({ kind: 'phone', state: 'plusieurs', count: 2 });
    phoneState = { etat: 'adbIntrouvable', dossier: 'C:\\profil' };
    expect((await recover(recovery)).outcome).toEqual({ kind: 'tool-missing', folder: 'C:\\profil' });
    expect(pcGpx()).toEqual([]);
    expect(phoneReads).toEqual([]);
  });

  it('ne demande au téléphone que son état, son listage et des lectures', async () => {
    cutAfter = 1;
    const { recovery } = await openFresh();
    await recover(recovery);
    expect(new Set(phoneCalls)).toEqual(new Set(['etat', 'lister', 'lireOctets']));
  });

  it('« Fermer » efface l’issue', async () => {
    const { recovery } = await openFresh();
    await recover(recovery);
    recovery.dismissPhoneRecovery();
    expect(recovery.phoneRecoveryStep()).toEqual({ step: 'idle' });
  });
});
