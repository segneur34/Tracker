import { describe, expect, it } from 'vitest';
import { NEW_SUFFIX, REPLACE_SUFFIX, cableTempName, isRemoteTemp, phoneVisibleNames } from './remoteTemps';

describe('noms provisoires du téléphone', () => {
  it('cache une création interrompue', () => {
    expect(phoneVisibleNames(['a.gpx', 'b.gpx.tracker-new'])).toEqual([{ name: 'a.gpx', actual: 'a.gpx' }]);
  });

  it('cache un remplacement interrompu à côté de son original, intact', () => {
    expect(phoneVisibleNames(['a.json.tracker-tmp', 'a.json'])).toEqual([{ name: 'a.json', actual: 'a.json' }]);
  });

  it('montre sous son nom un remplacement dont l’original était déjà retiré', () => {
    expect(phoneVisibleNames(['a.json.tracker-tmp', 'b.gpx'])).toEqual([
      { name: 'a.json', actual: 'a.json.tracker-tmp' },
      { name: 'b.gpx', actual: 'b.gpx' },
    ]);
  });

  it('compare les suffixes en casse exacte, et ne prend pas un suffixe seul pour un provisoire', () => {
    expect(phoneVisibleNames(['A.TRACKER-TMP', '.tracker-tmp', '.tracker-new'])).toEqual([
      { name: 'A.TRACKER-TMP', actual: 'A.TRACKER-TMP' },
      { name: '.tracker-tmp', actual: '.tracker-tmp' },
      { name: '.tracker-new', actual: '.tracker-new' },
    ]);
    expect(isRemoteTemp('a.tracker-new')).toBe(true);
    expect(isRemoteTemp('a.tracker-tmp')).toBe(true);
    expect(isRemoteTemp('a.tmp')).toBe(false);
    expect(isRemoteTemp('.tracker-tmp')).toBe(false);
  });

  it('le câble écrit toujours sous .tracker-new, jamais sous .tracker-tmp', () => {
    expect(cableTempName('sessions/a.gpx')).toBe(`sessions/a.gpx${NEW_SUFFIX}`);
    expect(cableTempName('sessions/a.gpx')).not.toContain(REPLACE_SUFFIX);
    // Resté seul après une coupure, il est caché par le téléphone, à côté de l'original comme sans lui.
    expect(phoneVisibleNames([cableTempName('a.gpx')])).toEqual([]);
    expect(phoneVisibleNames(['a.gpx', cableTempName('a.gpx')])).toEqual([{ name: 'a.gpx', actual: 'a.gpx' }]);
  });
});
