import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Dossier privé des sessions en attente (A2) : un fichier n'apparaît sous son
 * nom qu'une fois écrit en entier, par un temporaire renommé.
 */

const calls: string[] = [];
let failWrite = false;

vi.mock('./runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./runtime')>()),
  isNativeApp: () => true,
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    writeFile: async ({ path }: { path: string }) => {
      calls.push(`write ${path}`);
      if (failWrite) throw new Error('disque plein');
    },
    rename: async ({ from, to }: { from: string; to: string }) => {
      calls.push(`rename ${from} -> ${to}`);
    },
    deleteFile: async ({ path }: { path: string }) => {
      calls.push(`delete ${path}`);
    },
  },
}));

beforeEach(() => {
  calls.length = 0;
  failWrite = false;
});

describe('sessions en attente sur le téléphone', () => {
  it('écrit chaque fichier sous un nom temporaire, puis le renomme', async () => {
    const { pendingFolder } = await import('./memoryFolder');
    const pending = pendingFolder()!;
    await pending.writeBytes('s.imu', new Uint8Array([1, 2]));
    await pending.writeText('s.gpx', '<gpx/>');
    expect(calls).toEqual([
      'write en-attente/s.imu.tmp',
      'rename en-attente/s.imu.tmp -> en-attente/s.imu',
      'write en-attente/s.gpx.tmp',
      'rename en-attente/s.gpx.tmp -> en-attente/s.gpx',
    ]);
  });

  it("efface le temporaire d'une écriture en échec, sans rien poser sous le nom", async () => {
    const { pendingFolder } = await import('./memoryFolder');
    failWrite = true;
    await expect(pendingFolder()!.writeText('s.gpx', '<gpx/>')).rejects.toThrow('disque plein');
    expect(calls).toEqual(['write en-attente/s.gpx.tmp', 'delete en-attente/s.gpx.tmp']);
  });
});
