import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingFile, IncomingFilesPort } from '../../platform/incomingFile';
import type { MemoryFolder } from '../../platform/memoryFolder';
import { buildFitActivity } from '../../test/fit.fixture';
import { gpxAt, settle, trackTestTimers } from '../../test/library.fixture';
import { createFakeFolder } from '../../test/memoryFolder.fixture';

/**
 * File des fichiers reçus d'une autre application (lot 35), sur une fausse plateforme : ce que le téléphone a copié, ce que
 * la mémoire en fait, ce qui reste à retenter. La file de la fausse plateforme survit à un « lancement » (`launch`), comme
 * le dossier privé du téléphone.
 */

const files = new Map<string, string>();
const log: string[] = [];
let writeRefused = false;
let opened: 'ready' | 'unavailable' = 'ready';

const fakeFolder: MemoryFolder = createFakeFolder(files, log, {
  writeText: async (path, text) => {
    if (writeRefused) throw new Error('écriture refusée');
    files.set(path, text);
  },
});

/** File privée du téléphone : identifiant → contenu et refus. */
const queue = new Map<string, { name: string; content: Uint8Array | string | null; refusal: IncomingFile['refusal'] }>();
let listeners: (() => void)[] = [];
let removed: string[] = [];
let removeRefused = false;
let reads = 0;

const fakePort: IncomingFilesPort = {
  list: async () => [...queue.entries()].map(([id, { name, refusal }]) => ({ id, name, size: 1, refusal })),
  read: async (id) => {
    reads += 1;
    const content = queue.get(id)?.content ?? null;
    return typeof content === 'string' ? new TextEncoder().encode(content) : content;
  },
  remove: async (id) => {
    if (removeRefused) throw new Error('retrait refusé');
    removed.push(id);
    queue.delete(id);
  },
  subscribe: (listener) => {
    listeners.push(listener);
  },
};

/** Itinéraire de Komoot : une `<rte>` seule, sans heure. */
const ROUTE_ONLY_GPX = '<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><rte><name>Tour du lac</name>'
  + '<rtept lat="43.60" lon="3.80"/><rtept lat="43.61" lon="3.80"/><rtept lat="43.61" lon="3.81"/></rte></gpx>';

let nextId = 1;
const receive = (name: string, content: Uint8Array | string | null, refusal: IncomingFile['refusal'] = null): string => {
  const id = `${nextId++}__${refusal ?? 'ok'}__${name}`;
  queue.set(id, { name, content, refusal });
  return id;
};

const startOf = (minute: number): number => Date.parse(`2026-10-27T10:${String(minute).padStart(2, '0')}:00Z`);
const fitAt = (minute: number, fileType?: number): Uint8Array => buildFitActivity({
  points: [0, 10, 20].map((s, i) => ({ timeMs: startOf(minute) + s * 1000, lat: 43.6 + i * 0.0003, lon: 3.8, speedMs: 3, hr: 140 + i })),
  sessionSports: [1],
  ...(fileType === undefined ? {} : { fileType }),
});

const sessionGpx = (): string[] => [...files.keys()].filter((path) => path.startsWith('sessions/') && path.endsWith('.gpx'));

/** Un lancement de l'application : modules neufs, mémoire ouverte, file lancée. */
const launch = async ({ recording = () => false, subscribeRecording = () => undefined as unknown }: {
  recording?: () => boolean;
  subscribeRecording?: (listener: () => void) => unknown;
} = {}) => {
  vi.resetModules();
  vi.doMock('../../platform/memoryFolder', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../platform/memoryFolder')>()),
    openMemoryFolder: async () => (opened === 'ready' ? { state: 'ready', folder: fakeFolder } : { state: 'unavailable', reason: 'aucun dossier' }),
    pendingFolder: () => null,
  }));
  listeners = [];
  const library = await import('../useSessionLibrary');
  await library.openLibrary();
  await settle(library);
  const { importRouteGpx } = await import('../routeFiles');
  await library.startIncomingFiles(recording, subscribeRecording, fakePort, importRouteGpx);
  const { drainIncomingFiles } = await import('./incoming');
  const notices = () => library.readLibraryState().incomingNotices;
  return { library, notices, drain: drainIncomingFiles };
};

let stopTimers = () => {};
beforeEach(() => {
  files.clear();
  log.length = 0;
  queue.clear();
  removed = [];
  writeRefused = false;
  removeRefused = false;
  opened = 'ready';
  reads = 0;
  stopTimers = trackTestTimers();
});
afterEach(() => {
  stopTimers();
  vi.doUnmock('../../platform/memoryFolder');
});

describe('fichiers reçus d\'une autre application', () => {
  it('file vide : une ouverture normale ne fait rien, aucun bandeau', async () => {
    const { library, notices } = await launch();
    expect(notices()).toEqual([]);
    expect(library.readLibraryState().importing).toBe(false);
    expect(library.readLibraryState().message).toBeNull();
    expect(log.filter((line) => line.startsWith('write sessions/') && line.endsWith('.gpx'))).toEqual([]);
  });

  it('un FIT reçu est rangé, sa copie retirée, et le bandeau propose de voir la session', async () => {
    const id = receive('montre.fit', fitAt(1));
    const { library, notices } = await launch();
    expect(sessionGpx()).toHaveLength(1);
    expect(removed).toEqual([id]);
    expect(notices()).toEqual([{ id, text: '« montre.fit » est rangé dans la mémoire.', file: sessionGpx()[0].replace('sessions/', ''), trouble: false }]);
    // Le bandeau dit le résultat : la carte de la mémoire ne le redit pas.
    expect(library.readLibraryState().message).toBeNull();
    library.dismissIncomingNotice(id);
    expect(notices()).toEqual([]);
  });

  it('un GPX reçu aussi', async () => {
    receive('sortie.gpx', gpxAt(2));
    const { notices } = await launch();
    expect(sessionGpx()).toHaveLength(1);
    expect(files.get(sessionGpx()[0])).toBe(gpxAt(2));
    expect(notices()[0].trouble).toBe(false);
  });

  it('session déjà présente : dit, rien de plus, copie retirée, et on peut quand même la voir', async () => {
    files.set('sessions/existante.gpx', gpxAt(1));
    const id = receive('montre.fit', fitAt(1));
    const { notices } = await launch();
    expect(sessionGpx()).toEqual(['sessions/existante.gpx']);
    expect(removed).toEqual([id]);
    expect(notices()).toEqual([{ id, text: '« montre.fit » : cette session est déjà présente.', file: 'existante.gpx', trouble: false }]);
  });

  it('FIT illisible : refus avec sa raison, copie retirée, rien de rangé', async () => {
    const id = receive('abime.fit', new Uint8Array([1, 2, 3]));
    const { library, notices } = await launch();
    expect(sessionGpx()).toEqual([]);
    expect(removed).toEqual([id]);
    expect(notices()[0].trouble).toBe(true);
    expect(notices()[0].file).toBeNull();
    expect(notices()[0].text).toMatch(/^« abime\.fit » n'a pas été rangé : ce n'est pas un fichier FIT/);
    expect(library.readLibraryState().error).toBeNull();
  });

  it('GPX sans trace : refus, copie retirée', async () => {
    const id = receive('vide.gpx', '<?xml version="1.0"?><gpx version="1.1"></gpx>');
    const { notices } = await launch();
    expect(removed).toEqual([id]);
    expect(notices()[0].text).toBe('« vide.gpx » n\'a pas été rangé : fichier illisible.');
  });

  it('FIT qui n\'est pas une activité : phrase claire, copie retirée', async () => {
    const id = receive('reglages.fit', fitAt(1, 2));
    const { notices } = await launch();
    expect(removed).toEqual([id]);
    expect(notices()[0].text).toBe("Ce fichier de montre n'est pas une activité (réglages, parcours…) : rien n'a été importé.");
  });

  it.each([
    ['format', '« photo.jpg » n\'a pas été rangé : ce n\'est ni un GPX ni un FIT.'],
    ['trop-gros', '« gros.gpx » n\'a pas été rangé : il dépasse 30 Mo.'],
    ['illisible', '« perdu.gpx » n\'a pas été rangé : Tracker n\'a pas pu le lire. Essayez de l\'ouvrir de nouveau.'],
  ] as const)('refus du téléphone (%s) : dit, sans rien lire, et retiré', async (refusal, text) => {
    const name = /« (.+) »/.exec(text)![1];
    const id = receive(name, null, refusal);
    const { notices } = await launch();
    expect(reads).toBe(0);
    expect(removed).toEqual([id]);
    expect(notices()).toEqual([{ id, text, file: null, trouble: true }]);
  });

  it('sans mémoire : refus avec la phrase existante, copie retirée, rien de lu', async () => {
    opened = 'unavailable';
    const id = receive('montre.fit', fitAt(1));
    const { notices } = await launch();
    expect(reads).toBe(0);
    expect(removed).toEqual([id]);
    expect(notices()[0].text).toContain('Désignez d\'abord le dossier mémoire (Réglages › Mémoire) pour importer des sessions.');
    expect(notices()[0].trouble).toBe(true);
  });

  it('échec d\'écriture : dit, copie gardée, pas de nouvel essai pendant ce lancement, rangée au suivant', async () => {
    writeRefused = true;
    const id = receive('montre.fit', fitAt(1));
    const first = await launch();
    expect(removed).toEqual([]);
    expect(queue.has(id)).toBe(true);
    expect(sessionGpx()).toEqual([]);
    expect(first.notices()[0].text).toBe('« montre.fit » n\'a pas pu être rangé (écriture refusée). Tracker le garde et réessaiera au prochain lancement.');
    expect(first.notices()[0].trouble).toBe(true);

    const readsBefore = reads;
    await first.drain();
    expect(reads).toBe(readsBefore);
    expect(first.notices()).toHaveLength(1);

    writeRefused = false;
    const second = await launch();
    expect(sessionGpx()).toHaveLength(1);
    expect(removed).toEqual([id]);
    expect(second.notices()[0].text).toBe('« montre.fit » est rangé dans la mémoire.');
  });

  it('lecture de la copie en échec : elle n\'est pas prise pour illisible, gardée pour le lancement suivant', async () => {
    const id = receive('montre.fit', fitAt(1));
    const read = fakePort.read;
    fakePort.read = async () => {
      throw new Error('mémoire insuffisante');
    };
    try {
      const { notices } = await launch();
      expect(queue.has(id)).toBe(true);
      expect(removed).toEqual([]);
      expect(notices()[0].text).toContain('Tracker le garde et réessaiera au prochain lancement.');
    } finally {
      fakePort.read = read;
    }
  });

  it('enregistrement en cours : rien n\'est touché ni même lu ; rangé à l\'arrêt', async () => {
    let recording = true;
    let recorderChanged = () => {};
    const id = receive('montre.fit', fitAt(1));
    const list = vi.spyOn(fakePort, 'list');
    const { notices, drain } = await launch({
      recording: () => recording,
      subscribeRecording: (listener) => {
        recorderChanged = listener;
      },
    });
    expect(list).not.toHaveBeenCalled();
    expect(reads).toBe(0);
    expect(queue.has(id)).toBe(true);
    expect(notices()).toEqual([]);

    // Un autre fichier reçu, et des positions : toujours rien.
    receive('sortie.gpx', gpxAt(2));
    listeners.forEach((listener) => listener());
    recorderChanged();
    await drain();
    expect(list).not.toHaveBeenCalled();
    expect(sessionGpx()).toEqual([]);

    recording = false;
    recorderChanged();
    await drain();
    expect(sessionGpx()).toHaveLength(2);
    expect(queue.size).toBe(0);
    expect(notices()).toHaveLength(2);
    list.mockRestore();
  });

  it('enregistrement lancé entre deux fichiers : le second attend', async () => {
    let recording = false;
    let recorderChanged = () => {};
    receive('a.fit', fitAt(1));
    const second = receive('b.fit', fitAt(2));
    const read = fakePort.read;
    fakePort.read = async (id) => {
      recording = true;
      return read(id);
    };
    try {
      const { drain } = await launch({
        recording: () => recording,
        subscribeRecording: (listener) => {
          recorderChanged = listener;
        },
      });
      expect(sessionGpx()).toHaveLength(1);
      expect(queue.has(second)).toBe(true);
      recording = false;
      fakePort.read = read;
      recorderChanged();
      await drain();
      expect(sessionGpx()).toHaveLength(2);
    } finally {
      fakePort.read = read;
    }
  });

  it('deux fichiers à la suite, le second arrivé pendant le premier : un à la fois, dans l\'ordre, chacun son bandeau', async () => {
    const order: string[] = [];
    const first = receive('a.fit', fitAt(1));
    const read = fakePort.read;
    let second: string | null = null;
    fakePort.read = async (id) => {
      order.push(id);
      if (second === null) {
        second = receive('b.gpx', gpxAt(2));
        listeners.forEach((listener) => listener());
      }
      return read(id);
    };
    try {
      const { notices } = await launch();
      expect(order).toEqual([first, second]);
      expect(sessionGpx()).toHaveLength(2);
      expect(queue.size).toBe(0);
      expect(notices().map((notice) => notice.id)).toEqual([first, second]);
    } finally {
      fakePort.read = read;
    }
  });

  it('copie reçue pendant que la page vit : l\'événement la fait ranger', async () => {
    const { notices, drain } = await launch();
    receive('a.fit', fitAt(1));
    listeners.forEach((listener) => listener());
    await drain();
    expect(sessionGpx()).toHaveLength(1);
    expect(notices()).toHaveLength(1);
  });

  it('relance alors que la copie n\'a pas pu être retirée : « déjà présente », jamais rangée deux fois', async () => {
    removeRefused = true;
    const id = receive('montre.fit', fitAt(1));
    await launch();
    expect(sessionGpx()).toHaveLength(1);
    expect(queue.has(id)).toBe(true);

    removeRefused = false;
    const second = await launch();
    expect(sessionGpx()).toHaveLength(1);
    expect(queue.has(id)).toBe(false);
    expect(second.notices()[0].text).toBe('« montre.fit » : cette session est déjà présente.');
  });

  it('un autre import en cours : la file attend sa fin, pas de rangement en même temps', async () => {
    const { library, drain } = await launch();
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const importing = library.importEntries([{
      name: 'autre.gpx',
      key: 'autre',
      readText: async () => {
        await blocked;
        return gpxAt(3);
      },
      readBytes: async () => null,
    }]);
    expect(library.readLibraryState().importing).toBe(true);
    receive('a.fit', fitAt(1));
    await drain();
    expect(reads).toBe(0);
    release();
    await importing;
    await drain();
    expect(sessionGpx()).toHaveLength(2);
    expect(queue.size).toBe(0);
  });

  it('la liste du téléphone en échec : rien ne tombe, aucun bandeau', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const list = fakePort.list;
    fakePort.list = async () => {
      throw new Error('liste illisible');
    };
    try {
      const { notices } = await launch();
      expect(notices()).toEqual([]);
      expect(warn).toHaveBeenCalled();
    } finally {
      fakePort.list = list;
      warn.mockRestore();
    }
  });

  it("un GPX d'itinéraire (route seule, sans heure) est rangé dans les itinéraires, pas en session (lot 194)", async () => {
    const id = receive('komoot.gpx', ROUTE_ONLY_GPX);
    const { notices } = await launch();
    expect(sessionGpx()).toEqual([]);
    expect(removed).toEqual([id]);
    expect([...files.keys()].filter((path) => path.startsWith('itineraires/')).sort()).toEqual(['itineraires/Tour du lac.gpx', 'itineraires/Tour du lac.json']);
    expect(notices()).toEqual([{
      id, text: '« komoot.gpx » est rangé dans les itinéraires, sous « Tour du lac ».', file: null, route: 'Tour du lac', trouble: false,
    }]);
  });

  it("itinéraire reçu sous un nom déjà pris : ni fichier ni nom doublé (lot 194)", async () => {
    files.set('itineraires/Tour du lac.json', JSON.stringify({
      format: 'tracker-itineraire', version: 3, name: 'Tour du lac', activityId: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      waypoints: [{ lat: 43, lon: 3 }, { lat: 43.01, lon: 3 }], legs: [],
    }));
    receive('komoot.gpx', ROUTE_ONLY_GPX);
    const { notices } = await launch();
    expect(files.has('itineraires/Tour du lac (2).json')).toBe(true);
    expect(JSON.parse(files.get('itineraires/Tour du lac (2).json') ?? '{}').name).toBe('Tour du lac (2)');
    expect(notices()[0].route).toBe('Tour du lac (2)');
  });

  it('dans le navigateur, la vraie plateforme est sans effet', async () => {
    const { incomingFiles } = await import('../../platform/incomingFile');
    await expect(incomingFiles.list()).resolves.toEqual([]);
    await expect(incomingFiles.read('x')).resolves.toBeNull();
    await expect(incomingFiles.remove('x')).resolves.toBeUndefined();
    expect(() => incomingFiles.subscribe(() => undefined)).not.toThrow();
  });
});
