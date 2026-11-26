import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopPhoneBridge } from './desktopBridge';
import { PHONE_TRASH_ROOT, phoneTrashDir, phoneTrashPaths } from '../library/syncBase';
import {
  PHONE_RECORDING_MESSAGE, isPhoneRecordingError, listPhoneFiles, phoneCableAvailable, phoneCanWrite, phoneImportEntries, phoneIsRecording,
  phoneMemoryFolder, phoneState,
} from './phoneCable';

/**
 * Le téléphone branché, vu de la page : le pont est le vrai code de la coquille (`bureau/telephone.ts`), sur un
 * dossier temporaire qui joue la mémoire du téléphone (`dossierLocal`, celui du banc).
 */

// Les types de Node ne sont pas ceux de l'application : le peu qui sert est décrit à la main, et le code de la
// coquille est chargé par un chemin en variable.
interface NodeFs {
  mkdtemp(prefix: string): Promise<string>;
  mkdir(dir: string, options?: { recursive?: boolean }): Promise<unknown>;
  rm(target: string, options: { recursive: boolean; force: boolean }): Promise<void>;
  writeFile(file: string, data: string | Uint8Array): Promise<void>;
  readdir(dir: string, options: { recursive: boolean }): Promise<string[]>;
  readFile(file: string, encoding: 'utf8'): Promise<string>;
}
const fs = (await import(/* @vite-ignore */ 'node:fs/promises' as string)) as NodeFs;
const { join } = (await import(/* @vite-ignore */ 'node:path' as string)) as { join(...parts: string[]): string };
const { tmpdir } = (await import(/* @vite-ignore */ 'node:os' as string)) as { tmpdir(): string };
const { fileURLToPath } = (await import(/* @vite-ignore */ 'node:url' as string)) as { fileURLToPath(url: URL): string };

type Reponse = { ok: true; valeur: unknown } | { ok: false; code: string; message: string };
type EtatImpose = { etat: 'pret'; nom: string } | { etat: 'absent' } | { etat: 'adbIntrouvable'; dossier: string } | { etat: 'plusieurs'; nombre: number };
type Options = { etatImpose?: EtatImpose | null; coupureApres?: number | null; enregistrement?: boolean };
interface ShellPhone {
  dossierLocal(stockage: string | null, options?: Options): unknown;
  gestionnairesTelephone(dossier: unknown, dossierTemp: string): Record<string, (argument: unknown) => Promise<Reponse>>;
  MESSAGE_ENREGISTREMENT: string;
  CORBEILLE_PAGE: string;
}
const SHELL_PHONE = fileURLToPath(new URL('../../bureau/telephone.ts', import.meta.url));
const shell = (await import(/* @vite-ignore */ SHELL_PHONE)) as ShellPhone;

let tmp: string;
let stockage: string;
/** Lectures demandées à la coquille, par chemin. */
let reads: string[];

const write = async (path: string, text: string): Promise<void> => {
  const full = join(stockage, 'Documents', 'Tracker', ...path.split('/'));
  await fs.mkdir(join(full, '..'), { recursive: true });
  await fs.writeFile(full, text);
};

/** Le pont de la mémoire, réduit à ce que `isDesktopApp()` regarde. */
const memoire = { ouvrir: async () => ({ ok: true, valeur: { etat: 'aucun' } }) };

/** Le programme Windows avec un téléphone branché, joué par `stockage`. */
const plug = (options: Options = {}, ancienne = false): void => {
  const g = shell.gestionnairesTelephone(shell.dossierLocal(stockage, options), join(tmp, 'lecture'));
  const telephone = {
    etat: () => g['telephone:etat'](undefined),
    lister: () => g['telephone:lister'](undefined),
    lireOctets: (argument: { chemin: string }) => {
      reads.push(argument.chemin);
      return g['telephone:lireOctets'](argument);
    },
    // Une coquille d'avant l'écriture (lot 2) n'a que les trois canaux de lecture.
    ...(ancienne ? {} : {
      enregistrement: () => g['telephone:enregistrement'](undefined),
      ecrireOctets: (argument: unknown) => g['telephone:ecrireOctets'](argument),
      listerCorbeille: (argument: unknown) => g['telephone:listerCorbeille'](argument),
      mettreDeCote: (argument: unknown) => g['telephone:mettreDeCote'](argument),
    }),
  } as unknown as DesktopPhoneBridge;
  vi.stubGlobal('window', { trackerBureau: { version: '0.0.0', memoire, telephone } });
};

beforeEach(async () => {
  tmp = await fs.mkdtemp(join(tmpdir(), 'tracker-cable-'));
  stockage = join(tmp, 'sdcard');
  await fs.mkdir(stockage, { recursive: true });
  reads = [];
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('téléphone branché par câble', () => {
  it("absent hors du programme Windows et d'une coquille qui ne lit pas le téléphone", () => {
    expect(phoneCableAvailable()).toBe(false);
    vi.stubGlobal('window', { trackerBureau: { version: '0.0.0', memoire } });
    expect(phoneCableAvailable()).toBe(false);
    vi.stubGlobal('window', { trackerBureau: { version: '0.0.0', memoire, telephone: { etat: () => null } } });
    expect(phoneCableAvailable()).toBe(false);
    plug();
    expect(phoneCableAvailable()).toBe(true);
  });

  it('état du téléphone, prêt ou imposé', async () => {
    plug();
    expect(await phoneState()).toEqual({ etat: 'pret', nom: "Téléphone d'essai" });
    plug({ etatImpose: { etat: 'adbIntrouvable', dossier: 'C:\\profil' } });
    expect(await phoneState()).toEqual({ etat: 'adbIntrouvable', dossier: 'C:\\profil' });
    plug({ etatImpose: { etat: 'plusieurs', nombre: 2 } });
    expect(await phoneState()).toEqual({ etat: 'plusieurs', nombre: 2 });
  });

  it('listage : racine et sous-dossiers listés, `null` sans dossier Documents/Tracker', async () => {
    plug();
    expect(await listPhoneFiles()).toBeNull();
    await write('sessions/a.gpx', '<gpx/>');
    await write('itineraires/b.gpx', '<gpx/>');
    await write('autre/c.gpx', '<gpx/>');
    await write('tracker.json', '{}');
    expect(await listPhoneFiles()).toEqual([{ path: 'itineraires/b.gpx', size: 6 }, { path: 'sessions/a.gpx', size: 6 }, { path: 'tracker.json', size: 2 }]);
  });

  it('lire un GPX lit aussi sa fiche et ses capteurs, rendus ensuite sans relire le téléphone', async () => {
    await write('sessions/a.gpx', '<gpx>é</gpx>');
    await write('sessions/a.json', '{"n":1}');
    await write('sessions/a.imu', 'IMU');
    plug();
    await listPhoneFiles();
    const seen: string[] = [];
    const { entries, unplugged } = phoneImportEntries(['sessions/a.gpx', 'sessions/a.json', 'sessions/a.imu'], (path) => seen.push(path));
    expect(entries.map((e) => [e.name, e.key])).toEqual([['a.gpx', 'sessions/a'], ['a.json', 'sessions/a'], ['a.imu', 'sessions/a']]);
    expect(await entries[0].readText()).toBe('<gpx>é</gpx>');
    expect(seen).toEqual(['sessions/a.gpx', 'sessions/a.json', 'sessions/a.imu']);
    expect(await entries[1].readText()).toBe('{"n":1}');
    expect(new TextDecoder().decode((await entries[2].readBytes())!)).toBe('IMU');
    expect(reads).toEqual(['sessions/a.gpx', 'sessions/a.json', 'sessions/a.imu']);
    expect(unplugged()).toBe(false);
  });

  it('débranché en route : la session en cours échoue entière, les lectures suivantes échouent sans rien demander', async () => {
    await write('sessions/a.gpx', '<gpx/>');
    await write('sessions/a.json', '{}');
    await write('sessions/b.gpx', '<gpx/>');
    plug({ coupureApres: 1 });
    await listPhoneFiles();
    const { entries, unplugged } = phoneImportEntries(['sessions/a.gpx', 'sessions/a.json', 'sessions/b.gpx']);
    await expect(entries[0].readText()).rejects.toThrow('téléphone débranché');
    expect(unplugged()).toBe(true);
    const asked = reads.length;
    await expect(entries[2].readText()).rejects.toThrow('téléphone débranché');
    expect(reads.length).toBe(asked);
  });

  it('une lecture en échec, téléphone toujours prêt : son erreur, sans débranchement', async () => {
    await write('sessions/a.gpx', '<gpx/>');
    plug();
    await listPhoneFiles();
    const { entries, unplugged } = phoneImportEntries(['sessions/z.gpx']);
    await expect(entries[0].readText()).rejects.toThrow();
    expect(unplugged()).toBe(false);
  });

  it('le téléphone joué reste intact après lectures', async () => {
    await write('sessions/a.gpx', '<gpx/>');
    await write('sessions/a.json', '{}');
    plug();
    const before = (await fs.readdir(stockage, { recursive: true })).sort();
    await listPhoneFiles();
    await phoneImportEntries(['sessions/a.gpx', 'sessions/a.json']).entries[0].readText();
    expect((await fs.readdir(stockage, { recursive: true })).sort()).toEqual(before);
  });
});

describe('le téléphone comme dossier mémoire (sorte phone)', () => {
  const NOW = new Date(2026, 10, 26, 12).getTime();
  const dir = phoneTrashDir(NOW);
  const onPhone = (relatif: string): Promise<string> => fs.readFile(join(stockage, 'Documents', ...relatif.split('/')), 'utf8');
  const allFiles = async (): Promise<string[]> => (await fs.readdir(join(stockage, 'Documents'), { recursive: true })).map((p) => p.replace(/\\/g, '/')).sort();

  it("écrire n'existe que dans une coquille qui le sait", () => {
    expect(phoneCanWrite()).toBe(false);
    plug({}, true);
    expect(phoneCableAvailable()).toBe(true);
    expect(phoneCanWrite()).toBe(false);
    expect(() => phoneMemoryFolder('Téléphone')).toThrow('trop ancien');
    plug();
    expect(phoneCanWrite()).toBe(true);
  });

  it('liste, lit et date d’après le listage, écrit par la coquille et tient le listage à jour', async () => {
    await write('sessions/a.gpx', '<gpx/>');
    await write('itineraires/t.json', '{}');
    await write('tracker.json', '{}');
    plug();
    const phone = phoneMemoryFolder('Téléphone');
    expect(phone.kind).toBe('phone');
    expect((await phone.list('')).map((e) => [e.name, e.kind]).sort()).toEqual([['itineraires', 'directory'], ['sessions', 'directory'], ['tracker.json', 'file']]);
    expect((await phone.list('sessions')).map((e) => e.name)).toEqual(['a.gpx']);
    expect(await phone.readText('sessions/a.gpx')).toBe('<gpx/>');
    expect(await phone.readText('sessions/absent.gpx')).toBeNull();
    await phone.writeText('sessions/b.json', '{"b":1}');
    expect(await onPhone('Tracker/sessions/b.json')).toBe('{"b":1}');
    expect((await phone.stat('sessions/b.json'))?.size).toBe(7);
    expect(await phone.readText('sessions/b.json')).toBe('{"b":1}');
    await phone.writeText('tracker.json', '{"id":"abcdefgh12"}');
    expect(await onPhone('Tracker/tracker.json')).toBe('{"id":"abcdefgh12"}');
    expect(await phoneIsRecording()).toBe(false);
    expect(await phone.recording()).toBe(false);
    // Rien de provisoire laissé sur le téléphone.
    expect((await allFiles()).filter((p) => /\.tracker-(new|tmp)$/.test(p))).toEqual([]);
  });

  it('n’efface jamais : remove lève et ne touche à rien', async () => {
    await write('sessions/a.gpx', '<gpx/>');
    plug();
    const phone = phoneMemoryFolder('Téléphone');
    await phone.list('');
    const before = await allFiles();
    await expect(phone.remove('sessions/a.gpx')).rejects.toThrow("Rien ne s'efface du téléphone");
    expect(await allFiles()).toEqual(before);
  });

  it('met de côté dans la corbeille du téléphone, aux noms que choisit le moteur, sans écraser', async () => {
    await write('sessions/a.gpx', '<gpx>a</gpx>');
    await write('sessions/a.json', '{"a":1}');
    plug();
    const phone = phoneMemoryFolder('Téléphone');
    await phone.list('');
    expect(dir.startsWith(`${shell.CORBEILLE_PAGE}/`)).toBe(true);
    expect(shell.CORBEILLE_PAGE).toBe(PHONE_TRASH_ROOT);
    const paths = ['sessions/a.gpx', 'sessions/a.json'];
    const targets = phoneTrashPaths(dir, paths, await phone.asideTaken(dir));
    for (const path of paths) await phone.moveAside(path, targets.get(path) as string);
    expect(await onPhone(`${dir}/sessions/a.gpx`)).toBe('<gpx>a</gpx>');
    expect(await phone.stat('sessions/a.gpx')).toBeNull();
    expect((await phone.list('sessions')).map((e) => e.name)).toEqual([]);
    // Une seconde session du même nom le même jour : le moteur choisit -2, rien n'est écrasé.
    await write('sessions/a.gpx', '<gpx>a bis</gpx>');
    await phone.list('');
    const again = phoneTrashPaths(dir, ['sessions/a.gpx'], await phone.asideTaken(dir));
    expect(again.get('sessions/a.gpx')).toBe(`${dir}/sessions/a-2.gpx`);
    await phone.moveAside('sessions/a.gpx', again.get('sessions/a.gpx') as string);
    expect(await onPhone(`${dir}/sessions/a.gpx`)).toBe('<gpx>a</gpx>');
    expect(await onPhone(`${dir}/sessions/a-2.gpx`)).toBe('<gpx>a bis</gpx>');
    // Un fichier que le dernier listage ne porte pas : rien.
    await phone.moveAside('sessions/inconnu.gpx', `${dir}/sessions/inconnu.gpx`);
    // Un chemin hors liste : refus de la coquille, sa phrase gardée.
    await write('reglages/pc.json', '{}');
    await phone.list('');
    await expect(phone.moveAside('reglages/pc.json', `${dir}/reglages/pc.json`)).rejects.toMatchObject({ code: 'PERMISSION', message: expect.stringContaining('Chemin refusé') });
  });

  it('n’écrit ni ne met de côté pendant un enregistrement, et le dit', async () => {
    await write('sessions/a.gpx', '<gpx/>');
    plug({ enregistrement: true });
    expect(PHONE_RECORDING_MESSAGE).toBe(shell.MESSAGE_ENREGISTREMENT);
    const phone = phoneMemoryFolder('Téléphone');
    expect(await phone.recording()).toBe(true);
    const before = await allFiles();
    const refused = await phone.writeText('sessions/b.json', '{}').catch((err: unknown) => err);
    expect(isPhoneRecordingError(refused)).toBe(true);
    expect((refused as Error).message).toBe(PHONE_RECORDING_MESSAGE);
    const aside = await phone.moveAside('sessions/a.gpx', `${dir}/sessions/a.gpx`).catch((err: unknown) => err);
    expect(isPhoneRecordingError(aside)).toBe(true);
    expect(await allFiles()).toEqual(before);
    expect(isPhoneRecordingError(new Error(PHONE_RECORDING_MESSAGE))).toBe(false);
  });
});

describe('erreurs du téléphone dites telles quelles', () => {
  it('un listage refusé garde la phrase de la coquille, jamais « Autorisation refusée »', async () => {
    const refus = { ok: false, code: 'UNKNOWN', message: 'Listage du téléphone incomplet : find: Permission denied' };
    const telephone = { etat: async () => ({ ok: true, valeur: { etat: 'pret', nom: 'X' } }), lister: async () => refus, lireOctets: async () => refus };
    vi.stubGlobal('window', { trackerBureau: { version: '0.0.0', memoire, telephone } });
    await expect(listPhoneFiles()).rejects.toThrow('Listage du téléphone incomplet : find: Permission denied');
  });
});
