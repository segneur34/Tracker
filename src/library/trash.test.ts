import { describe, expect, it } from 'vitest';
import {
  TRASH_KEEP_MS, deletesToTrash, expiredTrashEntries, trashDeleteButton, sessionDiscardText, isTrashDirName, orphanTrashDirs, parseTrashIndex, reusableRouteEntry, reusableTrashEntry,
  groupedTrashEntries, routeRestorePlan, serializeTrashIndex, sessionRestorePlan, sessionTrashEntries, trashCounts, trashDirName, trashGroupOf,
  shownTrashEntries, trashSummaryText, withoutTrashEntries, isTrashPath, rebuiltEntryRecord, rebuiltTrashEntry, type TrashEntry,
  DEPOSIT_FILE, depositAdoption, depositEntry, depositMissing, parseDeposit, returnedTrashGroups, serializeDeposit, type TrashDeposit,
} from './trash';

const NOW = Date.UTC(2026, 10, 20, 12);

const session = (dir: string, startMs: number, deletedAtMs = NOW, main = 'a.gpx'): TrashEntry => ({
  dir, kind: 'session', startMs, routeBase: null, createdAt: null, name: 'Wing · Carnon', deletedAtMs, origin: 'ordinateur', reason: 'supprimee',
  main, files: [{ name: main, size: 120 }, { name: main.replace('.gpx', '.json'), size: 30 }, { name: main.replace('.gpx', '.imu'), size: 900 }],
});

const route = (dir: string, base: string): TrashEntry => ({
  dir, kind: 'itineraire', startMs: null, routeBase: base, createdAt: '2026-11-01T10:00:00.000Z', name: 'Tour du lac', deletedAtMs: NOW,
  origin: 'ordinateur', reason: 'supprimee', main: `${base}.json`, files: [{ name: `${base}.json`, size: 40 }, { name: `${base}.gpx`, size: 400 }],
});

describe('index de la corbeille', () => {
  it('absent, illisible, d\'une version plus récente, ou relu tel qu\'écrit', () => {
    expect(parseTrashIndex(null)).toEqual({ state: 'absent', entries: [] });
    expect(parseTrashIndex('{abîmé').state).toBe('unreadable');
    expect(parseTrashIndex('{"format":"autre","version":1,"entries":[]}').state).toBe('unreadable');
    expect(parseTrashIndex('{"format":"tracker-corbeille","version":2,"entries":[]}').state).toBe('newer');
    const leftovers = { ...session(`${NOW}-100-3`, 100), kind: 'restes' as const };
    const entries = [session(`${NOW}-100`, 100), route(`${NOW}-Tour du lac`, 'Tour du lac'), { ...session(`${NOW}-100-2`, 100), origin: 'telephone' as const }, leftovers];
    expect(parseTrashIndex(serializeTrashIndex(entries))).toEqual({ state: 'ok', entries });
    // Les restes d'une session ne sont ni montrés ni comptés ; ses deux origines font une seule session.
    expect(shownTrashEntries(entries)).toEqual(entries.slice(0, 3));
    expect(trashCounts(entries)).toEqual({ sessions: 1, routes: 1 });
    expect(serializeTrashIndex([])).toContain('"format": "tracker-corbeille"');
    expect(serializeTrashIndex([])).toContain('"version": 1');
  });

  it("une origine inconnue rend l'index illisible", () => {
    const text = serializeTrashIndex([session(`${NOW}-100`, 100)]);
    expect(parseTrashIndex(text.replace('"origin": "ordinateur"', '"origin": "tablette"')).state).toBe('unreadable');
  });

  it('une seule entrée illisible rend tout l\'index illisible : rien n\'est réécrit ni purgé', () => {
    const text = serializeTrashIndex([session(`${NOW}-100`, 100)]).replace('"main": "a.gpx"', '"main": 3');
    expect(parseTrashIndex(text).state).toBe('unreadable');
    // Un sous-dossier qui n'a pas la forme de ceux de la corbeille non plus.
    expect(parseTrashIndex(serializeTrashIndex([session('1-100', 100)])).state).toBe('unreadable');
  });
});

describe('sous-dossiers', () => {
  it('instant puis identité, sans caractère refusé, suffixé s\'il est déjà pris, sans égard à la casse', () => {
    expect(trashDirName(NOW, '1763500000000', [])).toBe(`${NOW}-1763500000000`);
    expect(trashDirName(NOW, 'Tour: du lac?', [])).toBe(`${NOW}-Tour_ du lac_`);
    expect(trashDirName(NOW, 'Lac.', [])).toBe(`${NOW}-Lac`);
    expect(trashDirName(NOW, 'Lac', [`${NOW}-LAC`, `${NOW}-lac-2`])).toBe(`${NOW}-Lac-3`);
    expect(trashDirName(NOW, '', [])).toBe(`${NOW}-sans-nom`);
  });

  it('seuls les noms à la forme exacte de la corbeille sont les siens', () => {
    for (const name of [`${NOW}-Lac`, `${NOW}-Lac-3`, `${NOW}-1763500000000`, `${NOW}-Tour_ du lac_`, trashDirName(NOW, ' Tour: du  lac. ', [])]) {
      expect(isTrashDirName(name), name).toBe(true);
    }
    for (const name of ['photos', '2024-vacances', '1-100', `${NOW}`, `${NOW}-`, `${NOW}-a  b`, `${NOW}-lac.`, `${NOW}- lac`, `${NOW}-a:b`, `1${NOW}-lac`]) {
      expect(isTrashDirName(name), name).toBe(false);
    }
  });

  it('restes : les sous-dossiers de la corbeille absents de l\'index, jamais un dossier posé à la main', () => {
    const listing = [
      { name: `${NOW}-100`, kind: 'directory' as const }, { name: `${NOW}-200`, kind: 'directory' as const },
      { name: 'photos', kind: 'directory' as const }, { name: '2024-vacances', kind: 'directory' as const },
      { name: 'corbeille.json', kind: 'file' as const },
    ];
    expect(orphanTrashDirs([session(`${NOW}-100`, 100)], listing)).toEqual([`${NOW}-200`]);
    // Un dépôt de l'ordinateur pas encore adopté n'est jamais un reste.
    expect(orphanTrashDirs([session(`${NOW}-100`, 100)], listing, [`${NOW}-200`])).toEqual([]);
  });
});

describe('purge', () => {
  it('plus de 30 jours exactement ; une date dans le futur n\'est jamais purgée', () => {
    const entries = [
      session('a', 1, NOW - TRASH_KEEP_MS), session('b', 2, NOW - TRASH_KEEP_MS - 1), session('c', 3, NOW + 86_400_000), session('d', 4, NOW),
    ];
    expect(TRASH_KEEP_MS).toBe(30 * 86_400_000);
    expect(expiredTrashEntries(entries, NOW).map((e) => e.dir)).toEqual(['b']);
    // Durée passée en paramètre : une garde d'un jour purge tout ce qui a plus d'un jour, jamais le futur.
    expect(expiredTrashEntries(entries, NOW, 86_400_000).map((e) => e.dir)).toEqual(['a', 'b']);
    expect(expiredTrashEntries(entries, NOW, 0).map((e) => e.dir)).toEqual(['a', 'b']);
    expect(withoutTrashEntries(entries, ['B', 'c']).map((e) => e.dir)).toEqual(['a', 'd']);
  });
});

describe('reprise et identité', () => {
  it('une entrée déjà faite pour les mêmes fichiers est reprise ; une autre taille, un autre GPX ou une autre origine non', () => {
    const entries = [session('1-100', 100)];
    const gpx = { name: 'a.gpx', size: 120 };
    expect(reusableTrashEntry(entries, 100, 'a.gpx', [gpx])?.dir).toBe('1-100');
    expect(reusableTrashEntry(entries, 100, 'A.GPX', [gpx, { name: 'a.json', size: 30 }, { name: 'a.imu', size: 900 }])?.dir).toBe('1-100');
    expect(reusableTrashEntry(entries, 100, 'a.gpx', [{ name: 'a.gpx', size: 121 }])).toBeNull();
    expect(reusableTrashEntry(entries, 100, 'b.gpx', [{ name: 'b.gpx', size: 120 }])).toBeNull();
    expect(reusableTrashEntry(entries, 101, 'a.gpx', [gpx])).toBeNull();
    // Fiche saisie depuis l'entrée : sa taille a changé, elle doit être gardée de nouveau.
    expect(reusableTrashEntry(entries, 100, 'a.gpx', [gpx, { name: 'a.json', size: 31 }])).toBeNull();
    expect(reusableTrashEntry(entries, 100, 'a.gpx', [gpx], 'telephone')).toBeNull();
    const routes = [route('1-lac', 'lac')];
    expect(reusableRouteEntry(routes, 'LAC', '2026-11-01T10:00:00.000Z', 40)?.dir).toBe('1-lac');
    expect(reusableRouteEntry(routes, 'lac', '2026-11-02T10:00:00.000Z', 40)).toBeNull();
    expect(sessionTrashEntries([...entries, session('2-100', 100), session('3-7', 7)], 100).map((e) => e.dir)).toEqual(['1-100', '2-100']);
  });

  it('les plus récemment supprimées d\'abord', () => {
    expect(groupedTrashEntries([session('a', 1, 10), session('b', 2, 30), session('c', 3, 20)]).map((g) => g.entry.dir)).toEqual(['b', 'c', 'a']);
  });

  it('une ligne par session : l’entrée de l’ordinateur montrée et restaurée d’abord, celles du téléphone avec elle', () => {
    const phone = (dir: string, startMs: number, deletedAtMs: number): TrashEntry => ({ ...session(dir, startMs, deletedAtMs), origin: 'telephone' });
    const leftovers = { ...session('restes-1', 1, 90), kind: 'restes' as const };
    const entries = [phone('tel-1', 1, 50), session('ord-1', 1, 20), session('ord-1-bis', 1, 40), route('r', 'r'), session('ord-2', 2, 30), leftovers, phone('tel-3', 3, 10)];
    const groups = groupedTrashEntries(entries);
    expect(groups.map((g) => [g.entry.dir, g.entries.map((e) => e.dir), g.deletedAtMs])).toEqual([
      ['r', ['r'], NOW],
      ['ord-1-bis', ['ord-1-bis', 'ord-1', 'tel-1'], 50],
      ['ord-2', ['ord-2'], 30],
      // Sans copie de l'ordinateur, celle du téléphone fait la ligne.
      ['tel-3', ['tel-3'], 10],
    ]);
    expect(trashCounts(entries)).toEqual({ sessions: 3, routes: 1 });
    expect(trashGroupOf(entries, entries[0]).entry.dir).toBe('ord-1-bis');
    // Une entrée que l'index n'a plus fait une ligne d'elle seule.
    expect(trashGroupOf([], entries[4]).entries.map((e) => e.dir)).toEqual(['ord-2']);
  });
});

describe('restauration', () => {
  it('session : capteurs, fiche, GPX en dernier, sous un nom libre', () => {
    const entry = session('1-100', 100, NOW, '2026-11-20_10-00-00_wing.gpx');
    expect(sessionRestorePlan(entry, ['autre.gpx'])).toEqual({
      gpx: '2026-11-20_10-00-00_wing.gpx',
      copies: [
        { from: 'corbeille/1-100/2026-11-20_10-00-00_wing.imu', to: 'sessions/2026-11-20_10-00-00_wing.imu' },
        { from: 'corbeille/1-100/2026-11-20_10-00-00_wing.json', to: 'sessions/2026-11-20_10-00-00_wing.json' },
        { from: 'corbeille/1-100/2026-11-20_10-00-00_wing.gpx', to: 'sessions/2026-11-20_10-00-00_wing.gpx' },
      ],
    });
    // Une fiche restée seule sous ce nom le rend pris : le GPX revient sous un autre.
    const taken = sessionRestorePlan(entry, ['2026-11-20_10-00-00_wing.json']);
    expect(taken.gpx).toBe('2026-11-20_10-00-00_wing-2.gpx');
    expect(taken.copies.map((c) => c.to)).toEqual([
      'sessions/2026-11-20_10-00-00_wing-2.imu', 'sessions/2026-11-20_10-00-00_wing-2.json', 'sessions/2026-11-20_10-00-00_wing-2.gpx',
    ]);
  });

  it('seule la session de l\'entrée revient, pas une copie en double rangée avec elle ; capteurs absents : sautés', () => {
    const entry: TrashEntry = { ...session('1-100', 100), files: [{ name: 'a.gpx', size: 1 }, { name: 'a.json', size: 1 }, { name: 'a-2.gpx', size: 1 }] };
    expect(sessionRestorePlan(entry, []).copies.map((c) => c.to)).toEqual(['sessions/a.json', 'sessions/a.gpx']);
  });

  it('itinéraire : GPX puis fiche, sous une base libre', () => {
    expect(routeRestorePlan(route('1-lac', 'lac'), ['lac.json', 'lac.gpx'])).toEqual({
      base: 'lac-2',
      copies: [
        { from: 'corbeille/1-lac/lac.gpx', to: 'itineraires/lac-2.gpx' },
        { from: 'corbeille/1-lac/lac.json', to: 'itineraires/lac-2.json' },
      ],
    });
  });
});

describe('confirmations', () => {
  it('la corbeille n\'est promise que pour le dossier du disque et celui du téléphone, en écriture ; navigateur : suppression définitive', () => {
    expect(deletesToTrash('disk', false)).toBe(true);
    expect(deletesToTrash('device', false)).toBe(true);
    for (const [kind, readOnly] of [['browser', false], ['disk', true], ['device', true], ['picked', false], ['phone', false], [null, false]] as const) {
      expect(deletesToTrash(kind, readOnly), `${kind} ${readOnly}`).toBe(false);
    }
    // Navigateur, dossier choisi : les textes d'aujourd'hui, mot pour mot.
    for (const kind of ['browser', 'picked'] as const) {
      const toTrash = deletesToTrash(kind, false);
      for (const text of ['Confirmer', 'Supprimer', 'Supprimer définitivement', 'Jeter définitivement']) {
        expect(trashDeleteButton(toTrash, text)).toBe(text);
      }
      const today = 'Son fichier, sa fiche et ses mesures de capteurs seront supprimés de la mémoire, sans retour possible.';
      expect(sessionDiscardText(toTrash, today)).toBe(today);
    }
    expect(trashDeleteButton(true, 'Supprimer')).toBe('Mettre à la corbeille (30 jours)');
    expect(sessionDiscardText(true, 'x')).toContain('corbeille de cet appareil');
    expect(sessionDiscardText(true, 'x')).toContain('30 jours');
  });
});

describe('ligne de Réglages › Mémoire', () => {
  it('rien pour une corbeille vide ; sessions, itinéraires, ou les deux', () => {
    expect(trashSummaryText({ sessions: 0, routes: 0 })).toBeNull();
    expect(trashSummaryText({ sessions: 1, routes: 0 })).toBe('Corbeille : 1 session, gardée 30 jours');
    expect(trashSummaryText({ sessions: 4, routes: 0 })).toBe('Corbeille : 4 sessions, gardées 30 jours');
    expect(trashSummaryText({ sessions: 0, routes: 2 })).toBe('Corbeille : 2 itinéraires, gardés 30 jours');
    expect(trashSummaryText({ sessions: 3, routes: 1 })).toBe('Corbeille : 3 sessions et 1 itinéraire, gardés 30 jours');
    expect(trashCounts([session('a', 1), session('b', 2), route('c', 'c')])).toEqual({ sessions: 2, routes: 1 });
  });
});

describe("import d'un dossier", () => {
  it("un fichier d'un sous-dossier de la corbeille n'est pas importé ; un dossier « corbeille » quelconque l'est", () => {
    expect(isTrashPath('Tracker/corbeille/1795647914477-1791010800000/a.gpx')).toBe(true);
    expect(isTrashPath('corbeille/1795647914477-Lac/Lac.gpx')).toBe(true);
    expect(isTrashPath(['Tracker', 'Corbeille', '1795647914477-Lac', 'Lac.gpx'].join(String.fromCharCode(92)))).toBe(true);
    for (const path of ['Tracker/sessions/a.gpx', 'a.gpx', '', 'Tracker/corbeille/vacances/a.gpx', 'Tracker/corbeille/a.gpx', 'corbeille/1795647914477-Lac']) {
      expect(isTrashPath(path), path).toBe(false);
    }
  });
});

describe('index disparu', () => {
  const DIR = '1795647914477-1791010800000';
  it("session : identité en chiffres et GPX ; le GPX qui a sa fiche fait l'entrée, date tirée du nom du sous-dossier", () => {
    const files = [{ name: 'b-2.gpx', size: 3 }, { name: 'b.gpx', size: 5 }, { name: 'b.json', size: 7 }, { name: 'b.imu', size: 9 }];
    expect(rebuiltEntryRecord(DIR, files)).toBe('b.json');
    expect(rebuiltTrashEntry(DIR, files, 'Sortie du matin')).toEqual({
      dir: DIR, kind: 'session', startMs: 1791010800000, routeBase: null, createdAt: null, name: 'Sortie du matin',
      deletedAtMs: 1795647914477, origin: 'ordinateur', reason: 'supprimee', main: 'b.gpx', files,
    });
    expect(rebuiltTrashEntry(DIR, [{ name: 'c.gpx', size: 1 }], null)?.name).toBe('c');
    // Refaite, l'entrée se relit telle quelle dans l'index.
    const entry = rebuiltTrashEntry(DIR, files, null)!;
    expect(parseTrashIndex(serializeTrashIndex([entry])).entries).toEqual([entry]);
  });

  it('itinéraire : la fiche <identité>.json ; restes sinon ; rien pour un sous-dossier vide ou étranger', () => {
    const route = rebuiltTrashEntry('1795647914477-Tour du lac', [{ name: 'Tour du lac.gpx', size: 4 }, { name: 'Tour du lac.json', size: 2 }], null);
    expect(route).toMatchObject({ kind: 'itineraire', routeBase: 'Tour du lac', main: 'Tour du lac.json', name: 'Tour du lac', startMs: null });
    expect(rebuiltEntryRecord('1795647914477-Tour du lac', route!.files)).toBe('Tour du lac.json');
    const leftovers = rebuiltTrashEntry(DIR, [{ name: 'b.json', size: 7 }], null);
    expect(leftovers).toMatchObject({ kind: 'restes', startMs: 1791010800000 });
    expect(shownTrashEntries([leftovers!])).toEqual([]);
    expect(rebuiltEntryRecord(DIR, [{ name: 'b.json', size: 7 }])).toBeNull();
    expect(rebuiltTrashEntry(DIR, [], null)).toBeNull();
    expect(rebuiltTrashEntry('2024-vacances', [{ name: 'a.gpx', size: 1 }], null)).toBeNull();
  });
});

describe('dépôts de l’ordinateur dans la corbeille du téléphone', () => {
  const deposit: TrashDeposit = {
    origin: 'ordinateur', kind: 'session', startMs: 100, routeBase: null, createdAt: null, name: 'Wing · Carnon',
    files: [{ name: 'a.gpx', size: 120 }, { name: 'a.json', size: 30 }, { name: 'a.imu', size: 900 }],
  };

  it('depose.json se relit tel qu’écrit ; illisible, d’un autre format ou d’une version plus récente : rien', () => {
    expect(DEPOSIT_FILE).toBe('depose.json');
    expect(parseDeposit(serializeDeposit(deposit))).toEqual(deposit);
    const route: TrashDeposit = { ...deposit, kind: 'itineraire', startMs: null, routeBase: 'Tour', createdAt: '2026-11-01T10:00:00.000Z', files: [{ name: 'Tour.json', size: 40 }] };
    expect(parseDeposit(serializeDeposit(route))).toEqual(route);
    expect(serializeDeposit(deposit)).toContain('"origine": "ordinateur"');
    for (const text of [null, '{abîmé', '{"format":"autre","version":1}', serializeDeposit(deposit).replace('"version": 1', '"version": 2'),
      serializeDeposit(deposit).replace('"origine": "ordinateur"', '"origine": "telephone"'), serializeDeposit(deposit).replace('"kind": "session"', '"kind": "photo"')]) {
      expect(parseDeposit(text), String(text)).toBeNull();
    }
  });

  it('adoption : complet tout de suite ; partiel seulement quand aucun fichier manquant n’est plus à sa place ; aucune horloge', () => {
    expect(depositAdoption(deposit, ['a.gpx', 'a.json', 'a.imu'], [])).toBe('adopt');
    expect(depositMissing(deposit, ['A.GPX', 'a.json'])).toEqual(['a.imu']);
    // GPX arrivé, la fiche encore dans sessions/ : il attend.
    expect(depositAdoption(deposit, ['a.gpx'], ['a.json'])).toBe('wait');
    // Partie ailleurs (un dépôt neuf de la passe suivante) : adopté tel quel.
    expect(depositAdoption(deposit, ['a.gpx'], [])).toBe('adopt');
    // Rien d'arrivé, tout encore en place : il attend ; rien d'arrivé et plus rien en place : adopté (vide).
    expect(depositAdoption(deposit, [], ['a.gpx', 'a.json', 'a.imu'])).toBe('wait');
    expect(depositAdoption(deposit, [], [])).toBe('adopt');
  });

  it('entrée adoptée : à l’horloge de l’appareil, origine « cette mémoire » ; restes sans GPX ; rien sans fichier', () => {
    const files = [{ name: 'a.gpx', size: 120 }, { name: 'a.json', size: 30 }];
    expect(depositEntry(`${NOW}-100`, deposit, files, NOW + 5)).toEqual({
      dir: `${NOW}-100`, kind: 'session', startMs: 100, routeBase: null, createdAt: null, name: 'Wing · Carnon', deletedAtMs: NOW + 5,
      origin: 'ordinateur', reason: 'supprimee', main: 'a.gpx', files,
    });
    expect(depositEntry(`${NOW}-100`, deposit, [{ name: 'a.json', size: 30 }], NOW)).toMatchObject({ kind: 'restes', startMs: 100, main: 'a.json' });
    expect(depositEntry(`${NOW}-100`, deposit, [], NOW)).toBeNull();
    const route: TrashDeposit = { ...deposit, kind: 'itineraire', startMs: null, routeBase: 'Tour', createdAt: '2026-11-01T10:00:00.000Z', files: [{ name: 'Tour.gpx', size: 400 }, { name: 'Tour.json', size: 40 }] };
    expect(depositEntry(`${NOW}-Tour`, route, [{ name: 'Tour.gpx', size: 400 }, { name: 'Tour.json', size: 40 }], NOW))
      .toMatchObject({ kind: 'itineraire', routeBase: 'Tour', createdAt: '2026-11-01T10:00:00.000Z', main: 'Tour.json' });
    expect(depositEntry(`${NOW}-Tour`, route, [{ name: 'Tour.gpx', size: 400 }], NOW)).toMatchObject({ kind: 'restes', main: 'Tour.gpx' });
  });

  it('lignes revenues : seulement les sessions de nouveau dans la mémoire, jamais un itinéraire ni des restes', () => {
    const entries = [session(`${NOW}-100`, 100), session(`${NOW}-200`, 200), route(`${NOW}-Tour`, 'Tour'), { ...session(`${NOW}-300`, 300), kind: 'restes' as const }];
    expect(returnedTrashGroups(entries, new Set([100, 300])).map((g) => g.entry.dir)).toEqual([`${NOW}-100`]);
    expect(returnedTrashGroups(entries, new Set())).toEqual([]);
  });
});
