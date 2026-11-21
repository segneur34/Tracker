import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKER_FILE } from '../library/folderLayout';
import { createFakeFolder } from '../test/memoryFolder.fixture';
import { desktopBridge, type DesktopMemoryBridge } from './desktopBridge';
import { DENIED_TEXT, plainError } from './errorText';
import {
  FolderRefusedError, canChooseFolder, chooseMemoryFolder, desktopMemoryPlace, fileErrorCode, forgetChosenFolder,
  openMemoryFolder, reconnectMemoryFolder, type MemoryFolder,
} from './memoryFolder';
import { appShell, isDesktopApp } from './runtime';

/**
 * Mémoire du programme Windows : le pont est le vrai code de la coquille (`bureau/memoire.ts`), sur de vrais dossiers
 * temporaires ; seule la fenêtre de choix de Windows est remplacée (`choix`). Puis une suite de contrat commune au
 * dossier du disque et au faux dossier des autres tests.
 */

// Les types de Node ne sont pas ceux de l'application : le peu qui sert est décrit à la main, et le code de la
// coquille est chargé par un chemin en variable.
interface NodeFs {
  mkdtemp(prefix: string): Promise<string>;
  mkdir(dir: string, options?: { recursive?: boolean }): Promise<unknown>;
  rm(target: string, options: { recursive: boolean; force: boolean }): Promise<void>;
  readdir(dir: string): Promise<string[]>;
  rename(from: string, to: string): Promise<void>;
  writeFile(file: string, data: string | Uint8Array): Promise<void>;
  readFile(file: string, encoding: 'utf8'): Promise<string>;
}
const fs = (await import(/* @vite-ignore */ 'node:fs/promises' as string)) as NodeFs;
const { join } = (await import(/* @vite-ignore */ 'node:path' as string)) as { join(...parts: string[]): string };
const { tmpdir } = (await import(/* @vite-ignore */ 'node:os' as string)) as { tmpdir(): string };
const { fileURLToPath } = (await import(/* @vite-ignore */ 'node:url' as string)) as { fileURLToPath(url: URL): string };

interface ShellOptions {
  profil: string;
  documents: string;
  maison: string;
  env: Record<string, string | undefined>;
  choisirDossier: (demande: { titre: string; depart: string }) => Promise<string | null>;
  lireFichier?: (fichier: string) => Promise<Uint8Array>;
}
const SHELL_MEMORY = fileURLToPath(new URL('../../bureau/memoire.ts', import.meta.url));
const { creerMemoire } = (await import(/* @vite-ignore */ SHELL_MEMORY)) as { creerMemoire(options: ShellOptions): DesktopMemoryBridge };

let tmp: string;
let profil: string;
let maison: string;
let documents: string;
/** Réponse de la fenêtre de choix de Windows : chemin choisi, `null` si l'utilisateur renonce. */
let choix: string | null;
let demandes: { titre: string; depart: string }[];

/** Un lancement du programme : une coquille neuve sur le même profil, branchée comme pont de la page. */
const launch = (options: Partial<ShellOptions> = {}): void => {
  const memoire = creerMemoire({
    profil, documents, maison, env: {},
    choisirDossier: async (demande) => {
      demandes.push(demande);
      return choix;
    },
    ...options,
  });
  vi.stubGlobal('window', { trackerBureau: { version: '0.0.0', memoire } });
};

/** Lancement, puis « Utiliser ce dossier » : la mémoire dans `Documents/Tracker`. */
const adoptProposed = async (): Promise<MemoryFolder> => {
  launch();
  await openMemoryFolder();
  const folder = await chooseMemoryFolder('proposed');
  if (!folder) throw new Error('dossier proposé non adopté');
  return folder;
};

/** Le dossier retenu au lancement suivant. */
const nextLaunchLabel = async (): Promise<string | null> => {
  launch();
  const access = await openMemoryFolder();
  return access.state === 'ready' ? access.folder.label : null;
};

beforeEach(async () => {
  tmp = await fs.mkdtemp(join(tmpdir(), 'trk-page-'));
  profil = join(tmp, 'profil');
  maison = join(tmp, 'maison');
  documents = join(maison, 'Documents');
  await fs.mkdir(profil);
  await fs.mkdir(documents, { recursive: true });
  choix = null;
  demandes = [];
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('hors du programme Windows', () => {
  it('aucun pont : navigateur, sans état de dossier du disque', () => {
    expect(desktopBridge()).toBeNull();
    expect(isDesktopApp()).toBe(false);
    expect(appShell()).toBe('navigateur');
    expect(desktopMemoryPlace()).toBeNull();
  });

  it('un objet incomplet sous le nom du pont ne compte pas', () => {
    vi.stubGlobal('window', { trackerBureau: { version: '1' } });
    expect(desktopBridge()).toBeNull();
    expect(appShell()).toBe('navigateur');
  });
});

describe('mémoire du programme Windows', () => {
  it('premier lancement : le dossier proposé, rien de créé ni de retenu', async () => {
    launch();
    expect(appShell()).toBe('ordinateur');
    expect(canChooseFolder()).toBe(true);
    expect(await openMemoryFolder()).toMatchObject({ state: 'unavailable' });
    expect(desktopMemoryPlace()).toEqual({
      state: 'none', proposal: { chemin: join(documents, 'Tracker'), oneDrive: false, documentsOneDrive: false },
    });
    expect(await fs.readdir(documents)).toEqual([]);
    expect(await fs.readdir(profil)).toEqual([]);
  });

  it('Documents dans OneDrive : dossier proposé hors de OneDrive', async () => {
    launch({ env: { OneDrive: documents } });
    await openMemoryFolder();
    expect(desktopMemoryPlace()).toEqual({
      state: 'none', proposal: { chemin: join(maison, 'Tracker'), oneDrive: false, documentsOneDrive: true },
    });
  });

  it('« Utiliser ce dossier » : créé, retenu, et rouvert au lancement suivant', async () => {
    const folder = await adoptProposed();
    const memory = join(documents, 'Tracker');
    expect(folder).toMatchObject({ kind: 'disk', label: memory });
    expect(desktopMemoryPlace()).toEqual({ state: 'ready', path: memory, oneDrive: false });
    await folder.writeText(MARKER_FILE, '{}');
    expect(await fs.readdir(memory)).toEqual([MARKER_FILE]);
    expect(await fs.readdir(profil)).toContain('coquille.json');
    expect(await nextLaunchLabel()).toBe(memory);
  });

  it('dossier retenu introuvable : jamais recréé ; « Réessayer » le rouvre une fois remis', async () => {
    await adoptProposed();
    const memory = join(documents, 'Tracker');
    await fs.rename(memory, join(documents, 'Ailleurs'));
    launch();
    expect(await openMemoryFolder()).toEqual({ state: 'needs-permission', label: memory });
    expect(desktopMemoryPlace()).toEqual({ state: 'missing', path: memory });
    const retry = await reconnectMemoryFolder().catch((err: unknown) => err);
    expect(fileErrorCode(retry)).toBe('NOT_FOUND');
    expect(await fs.readdir(documents)).toEqual(['Ailleurs']);
    await fs.rename(join(documents, 'Ailleurs'), memory);
    expect(await reconnectMemoryFolder()).toMatchObject({ kind: 'disk', label: memory });
    expect(desktopMemoryPlace()).toEqual({ state: 'ready', path: memory, oneDrive: false });
  });

  it('réglage du programme illisible : rien n\'est proposé à neuf', async () => {
    await fs.writeFile(join(profil, 'coquille.json'), '{}');
    launch({ lireFichier: async () => { throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }); } });
    expect(await openMemoryFolder()).toEqual({ state: 'needs-permission', label: '' });
    expect(desktopMemoryPlace()).toMatchObject({ state: 'unreadable', path: null });
    expect(await fs.readdir(documents)).toEqual([]);
  });

  it('détail d\'un refus de la coquille : la phrase de son code, jamais son message brut', async () => {
    await fs.writeFile(join(profil, 'coquille.json'), '{}');
    launch({ lireFichier: async () => { throw Object.assign(new Error('EACCES: permission denied, open coquille.json'), { code: 'EACCES' }); } });
    await openMemoryFolder();
    expect(desktopMemoryPlace()).toEqual({ state: 'unreadable', path: null, detail: DENIED_TEXT });
    // Documents disparu : le dossier proposé ne peut pas naître, et `adopter` refuse.
    launch();
    await openMemoryFolder();
    await fs.rm(documents, { recursive: true, force: true });
    const refusal = await chooseMemoryFolder('proposed').catch((err: unknown) => err);
    expect(fileErrorCode(refusal)).toBe('NOT_FOUND');
    expect((refusal as Error).message).toBe(plainError({ code: 'NOT_FOUND' }));
  });

  it('parent désigné dans la fenêtre : la mémoire est son sous-dossier Tracker', async () => {
    launch();
    await fs.mkdir(join(documents, 'Tracker'));
    choix = documents;
    const folder = await chooseMemoryFolder();
    expect(folder?.label).toBe(join(documents, 'Tracker'));
    expect(demandes).toEqual([{ titre: 'Dossier mémoire de Tracker', depart: documents }]);
    await folder!.writeText('sessions/a.json', 'a');
    expect(await fs.readFile(join(documents, 'Tracker', 'sessions', 'a.json'), 'utf8')).toBe('a');
  });

  it('renoncement dans la fenêtre : rien ne change', async () => {
    launch();
    expect(await chooseMemoryFolder('documents')).toBeNull();
    expect(await nextLaunchLabel()).toBeNull();
  });

  it('sous-dossier d\'une mémoire refusé : le dossier d\'avant reste retenu', async () => {
    await adoptProposed();
    const sessions = join(documents, 'Tracker', 'sessions');
    await fs.mkdir(sessions);
    choix = sessions;
    await expect(chooseMemoryFolder()).rejects.toBeInstanceOf(FolderRefusedError);
    expect(await nextLaunchLabel()).toBe(join(documents, 'Tracker'));
  });

  it('octets relus à l\'identique, vue partielle comprise ; marque d\'ordre des octets retirée du texte', async () => {
    const folder = await adoptProposed();
    const whole = new Uint8Array([9, 9, 0, 1, 2, 255, 9]);
    await folder.writeBytes('sessions/a.imu', whole.subarray(2, 6));
    expect(await folder.readBytes('sessions/a.imu')).toEqual(new Uint8Array([0, 1, 2, 255]));
    expect(await folder.readBytes('sessions/b.imu')).toBeNull();
    await fs.writeFile(join(documents, 'Tracker', 'bom.json'), '﻿{"a":1}');
    expect(await folder.readText('bom.json')).toBe('{"a":1}');
  });

  it('« oublier » : plus rien de retenu, le dossier lui-même n\'est pas touché', async () => {
    const folder = await adoptProposed();
    await folder.writeText(MARKER_FILE, '{}');
    await forgetChosenFolder();
    expect(desktopMemoryPlace()).toBeNull();
    expect(await nextLaunchLabel()).toBeNull();
    expect(await fs.readdir(join(documents, 'Tracker'))).toEqual([MARKER_FILE]);
  });
});

/** Ce que la bibliothèque attend de tout dossier mémoire, du disque comme du faux dossier des tests. */
const contract = (name: string, make: () => Promise<MemoryFolder>) =>
  describe(`contrat du dossier mémoire : ${name}`, () => {
    it('écrit, remplace, relit, liste, mesure et efface un fichier texte', async () => {
      const f = await make();
      expect(await f.readText('sessions/a.json')).toBeNull();
      expect(await f.stat('sessions/a.json')).toBeNull();
      expect(await f.list('sessions')).toEqual([]);
      await f.writeText('sessions/a.json', '{"a":1}');
      await f.writeText('sessions/a.json', '{"a":22}');
      expect(await f.readText('sessions/a.json')).toBe('{"a":22}');
      expect((await f.list('sessions')).map((e) => [e.name, e.kind, e.size])).toEqual([['a.json', 'file', 8]]);
      const stat = await f.stat('sessions/a.json');
      expect(stat?.size).toBe(8);
      expect(typeof stat?.mtimeMs).toBe('number');
      await f.remove('sessions/a.json');
      await f.remove('sessions/a.json');
      expect(await f.readText('sessions/a.json')).toBeNull();
      expect(await f.list('sessions')).toEqual([]);
      expect(await f.list('itineraires')).toEqual([]);
    });
  });

contract('dossier du disque (programme Windows)', adoptProposed);
contract('faux dossier des tests', async () => {
  const files = new Map<string, string>();
  return createFakeFolder(files, [], {}, (path) => files.get(path)!.length);
});
