import { describe, expect, it } from 'vitest';
import type { ImportReport } from './importReport';
import { choosePhoneFiles, describePhoneRecovery } from './phoneRecovery';

/** Choix des fichiers du téléphone à lire : une session déjà sur l'ordinateur n'est pas lue, tout le reste passe à l'import. */

const f = (path: string, size: number) => ({ path, size });

describe('choosePhoneFiles', () => {
  it("rien sur l'ordinateur : tout est importé, GPX, fiches et capteurs lus", () => {
    const phone = [f('sessions/a.gpx', 100), f('sessions/a.json', 20), f('sessions/a.imu', 50), f('sessions/b.gpx', 80)];
    expect(choosePhoneFiles(phone, [])).toEqual({ toImport: phone.map((x) => x.path), alreadyHere: [], toRead: 4 });
  });

  it('même GPX, même taille, sans capteurs : déjà là, fiche comprise, rien de lu', () => {
    const phone = [f('sessions/a.gpx', 100), f('sessions/a.json', 20), f('sessions/b.gpx', 80)];
    const choice = choosePhoneFiles(phone, [f('a.gpx', 100), f('a.json', 999)]);
    expect(choice).toEqual({ toImport: ['sessions/b.gpx'], alreadyHere: ['sessions/a.gpx'], toRead: 1 });
  });

  it('capteurs de même taille des deux côtés : déjà là', () => {
    const choice = choosePhoneFiles([f('sessions/a.gpx', 100), f('sessions/a.imu', 50)], [f('a.gpx', 100), f('a.imu', 50)]);
    expect(choice.alreadyHere).toEqual(['sessions/a.gpx']);
    expect(choice.toImport).toEqual([]);
    expect(choice.toRead).toBe(0);
  });

  it("capteurs absents de l'ordinateur ou de taille différente : la session passe à l'import, qui les ajoutera", () => {
    const phone = [f('sessions/a.gpx', 100), f('sessions/a.imu', 50)];
    expect(choosePhoneFiles(phone, [f('a.gpx', 100)]).toImport).toEqual(['sessions/a.gpx', 'sessions/a.imu']);
    expect(choosePhoneFiles(phone, [f('a.gpx', 100), f('a.imu', 49)]).alreadyHere).toEqual([]);
  });

  it("GPX de taille différente : importé (l'import reconnaît une session déjà rangée par son départ)", () => {
    expect(choosePhoneFiles([f('sessions/a.gpx', 101)], [f('a.gpx', 100)])).toEqual({ toImport: ['sessions/a.gpx'], alreadyHere: [], toRead: 1 });
  });

  it('noms comparés sans la casse, comme le disque de Windows', () => {
    expect(choosePhoneFiles([f('sessions/A.GPX', 100)], [f('a.gpx', 100)]).alreadyHere).toEqual(['sessions/A.GPX']);
  });

  it("une fiche ou des capteurs sans GPX ne sont pas comptés à lire ; un FIT l'est", () => {
    const choice = choosePhoneFiles([f('profil.json', 10), f('sessions/x.imu', 5), f('montre.fit', 40)], []);
    expect(choice.toImport).toEqual(['profil.json', 'sessions/x.imu', 'montre.fit']);
    expect(choice.toRead).toBe(1);
  });

  it('un GPX de la racine et un de sessions/ du même nom restent deux sessions distinctes, sans se prendre leurs fiches', () => {
    const choice = choosePhoneFiles([f('a.gpx', 100), f('sessions/a.gpx', 200), f('sessions/a.json', 20)], [f('a.gpx', 200)]);
    expect(choice.alreadyHere).toEqual(['sessions/a.gpx']);
    expect(choice.toImport).toEqual(['a.gpx']);
  });

  it('cent vingt sessions déjà là et trois neuves : seules les trois neuves sont lues', () => {
    const here = Array.from({ length: 120 }, (_, i) => f(`sessions/s${i}.gpx`, 1000 + i));
    const fresh = [f('sessions/n1.gpx', 5), f('sessions/n2.gpx', 6), f('sessions/n2.json', 7), f('sessions/n3.gpx', 8)];
    const choice = choosePhoneFiles([...here, ...fresh], here.map((x) => f(x.path.slice('sessions/'.length), x.size)));
    expect(choice.alreadyHere).toHaveLength(120);
    expect(choice.toImport).toEqual(fresh.map((x) => x.path));
    expect(choice.toRead).toBe(4);
  });
});

const report = (patch: Partial<ImportReport> = {}): ImportReport => ({
  added: [], existing: [], duplicates: 0, invalid: [], ignored: [], notActivities: [], unsaved: 0, failed: [], retryable: [],
  motionAdded: 0, motionFailed: [], recordCompleted: 0, recordNotRead: 0, ...patch,
});

describe('describePhoneRecovery', () => {
  it('chaque état du téléphone a sa phrase, sans mot technique, et propose « Réessayer »', () => {
    const states = ['absent', 'autorisation', 'horsLigne', 'occupe', 'plusieurs'] as const;
    const texts = states.map((state) => describePhoneRecovery({ kind: 'phone', state, count: 2 }));
    expect(new Set(texts.map((x) => x.paragraphs[0])).size).toBe(states.length);
    expect(texts.every((x) => x.retry && x.folder === null)).toBe(true);
    expect(texts[0].paragraphs[1]).toContain('« Débogage USB »');
    expect(texts[1].paragraphs[0]).toContain('« Autoriser »');
    expect(texts[4].paragraphs[0]).toContain('Plusieurs appareils sont branchés à l\'ordinateur (2)');
    for (const t of texts) expect(t.paragraphs.join(' ')).not.toMatch(/\badb\b|unauthorized|offline|serveur/i);
  });

  it('outil introuvable : le dossier où copier platform-tools, à part', () => {
    const text = describePhoneRecovery({ kind: 'tool-missing', folder: 'C:\\Users\\moi\\AppData\\Roaming\\Tracker' });
    expect(text.folder).toBe('C:\\Users\\moi\\AppData\\Roaming\\Tracker');
    expect(text.paragraphs.join(' ')).toContain('« platform-tools »');
    expect(text.paragraphs.join(' ')).toContain('developer.android.com/tools/releases/platform-tools');
    expect(text.retry).toBe(true);
  });

  it('compte rendu : ajoutées et déjà présentes, sans « Réessayer »', () => {
    const text = describePhoneRecovery({ kind: 'done', phone: 'Xiaomi', report: report({ added: ['a.gpx', 'b.gpx', 'c.gpx'], duplicates: 120 }), sessionsOnPhone: 123, unplugged: false });
    expect(text).toEqual({ paragraphs: ['3 sessions ajoutées, 120 déjà présentes.'], folder: null, retry: false });
  });

  it('câble tiré en route : ce qui est rangé reste, « Réessayer » proposé', () => {
    const text = describePhoneRecovery({ kind: 'done', phone: 'Xiaomi', report: report({ added: ['a.gpx'], failed: ['b.gpx : téléphone débranché'], retryable: ['b.gpx'] }), sessionsOnPhone: 2, unplugged: true });
    expect(text.retry).toBe(true);
    expect(text.paragraphs[0]).toContain('débranché pendant la récupération');
    expect(text.paragraphs[1]).toBe('1 session ajoutée.');
    expect(text.paragraphs[2]).toContain('Rebranchez-le');
  });

  it('fichiers non rangés : nommés, « Réessayer » si un nouvel essai peut réussir', () => {
    const text = describePhoneRecovery({ kind: 'done', phone: 'Xiaomi', report: report({ failed: ['b.gpx : délai'], retryable: ['b.gpx'] }), sessionsOnPhone: 1, unplugged: false });
    expect(text.paragraphs[1]).toBe('1 fichier non rangé (b.gpx : délai).');
    expect(text.retry).toBe(true);
  });

  it('rien sur le téléphone, ou pas de dossier : une phrase qui le dit', () => {
    expect(describePhoneRecovery({ kind: 'done', phone: 'Xiaomi', report: report(), sessionsOnPhone: 0, unplugged: false }).paragraphs[0]).toContain('Aucune session');
    const none = describePhoneRecovery({ kind: 'no-phone-folder', phone: 'Xiaomi' });
    expect(none.paragraphs[0]).toContain('« Documents/Tracker »');
    expect(none.retry).toBe(true);
  });
});
