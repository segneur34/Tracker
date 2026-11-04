import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Grosse capture (lot 156) : au-delà du plafond, le fichier du dossier privé
 * n'est pas lu du tout, et l'erreur le distingue d'un fichier absent.
 */

const fake = vi.hoisted(() => ({
  size: 0 as number | null,
  statFails: false,
  reads: [] as string[],
}));

vi.mock('./runtime', () => ({ isNativeApp: () => true }));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    stat: async () => {
      if (fake.statFails) throw new Error('stockage indisponible');
      if (fake.size === null) throw new Error('File does not exist');
      return { size: fake.size };
    },
    readFile: async ({ path }: { path: string }) => {
      fake.reads.push(path);
      if (fake.size === null) throw new Error('File does not exist');
      return { data: 'AQI=' };
    },
  },
}));

beforeEach(() => {
  fake.size = 0;
  fake.statFails = false;
  fake.reads = [];
});

describe('readPrivateBytes : plafond de lecture', () => {
  it('au-delà du plafond : TOO_LARGE, sans rien lire', async () => {
    const { MAX_PRIVATE_READ_BYTES, readPrivateBytes } = await import('./memoryFolder');
    fake.size = MAX_PRIVATE_READ_BYTES + 1;
    await expect(readPrivateBytes('capteurs/1.imu')).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect(fake.reads).toEqual([]);
  });

  it('au plafond : lu', async () => {
    const { MAX_PRIVATE_READ_BYTES, readPrivateBytes } = await import('./memoryFolder');
    fake.size = MAX_PRIVATE_READ_BYTES;
    expect(await readPrivateBytes('capteurs/1.imu')).toEqual(new Uint8Array([1, 2]));
    expect(fake.reads).toEqual(['capteurs/1.imu']);
  });

  it('fichier absent : `null`, pas une erreur', async () => {
    const { readPrivateBytes } = await import('./memoryFolder');
    fake.size = null;
    expect(await readPrivateBytes('capteurs/1.imu')).toBeNull();
  });

  it('taille inconnue : la lecture tranche', async () => {
    const { readPrivateBytes } = await import('./memoryFolder');
    fake.statFails = true;
    expect(await readPrivateBytes('capteurs/1.imu')).toEqual(new Uint8Array([1, 2]));
  });

  it('vaut aussi pour les capteurs des sessions en attente', async () => {
    const { MAX_PRIVATE_READ_BYTES, pendingFolder } = await import('./memoryFolder');
    fake.size = MAX_PRIVATE_READ_BYTES + 1;
    await expect(pendingFolder()!.readBytes('s.imu')).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect(fake.reads).toEqual([]);
  });
});
