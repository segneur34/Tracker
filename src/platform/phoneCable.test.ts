import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopPhoneBridge } from './desktopBridge';
import { listPhoneFiles, phoneCableAvailable, phoneImportEntries, phoneState } from './phoneCable';

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
}
const fs = (await import(/* @vite-ignore */ 'node:fs/promises' as string)) as NodeFs;
const { join } = (await import(/* @vite-ignore */ 'node:path' as string)) as { join(...parts: string[]): string };
const { tmpdir } = (await import(/* @vite-ignore */ 'node:os' as string)) as { tmpdir(): string };
const { fileURLToPath } = (await import(/* @vite-ignore */ 'node:url' as string)) as { fileURLToPath(url: URL): string };

type Reponse = { ok: true; valeur: unknown } | { ok: false; code: string; message: string };
type EtatImpose = { etat: 'pret'; nom: string } | { etat: 'absent' } | { etat: 'adbIntrouvable'; dossier: string } | { etat: 'plusieurs'; nombre: number };
interface ShellPhone {
  dossierLocal(stockage: string | null, options?: { etatImpose?: EtatImpose | null; coupureApres?: number | null }): unknown;
  gestionnairesTelephone(dossier: unknown, dossierTemp: string): Record<string, (argument: unknown) => Promise<Reponse>>;
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
const plug = (options: { etatImpose?: EtatImpose | null; coupureApres?: number | null } = {}): void => {
  const g = shell.gestionnairesTelephone(shell.dossierLocal(stockage, options), join(tmp, 'lecture'));
  const telephone = {
    etat: () => g['telephone:etat'](undefined),
    lister: () => g['telephone:lister'](undefined),
    lireOctets: (argument: { chemin: string }) => {
      reads.push(argument.chemin);
      return g['telephone:lireOctets'](argument);
    },
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

  it('listage : racine et sessions/, `null` sans dossier Documents/Tracker', async () => {
    plug();
    expect(await listPhoneFiles()).toBeNull();
    await write('sessions/a.gpx', '<gpx/>');
    await write('itineraires/b.gpx', '<gpx/>');
    await write('tracker.json', '{}');
    expect(await listPhoneFiles()).toEqual([{ path: 'sessions/a.gpx', size: 6 }, { path: 'tracker.json', size: 2 }]);
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
