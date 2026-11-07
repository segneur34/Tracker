import { describe, expect, it } from 'vitest';

/**
 * Le manifeste Android (lot 151) : ni sauvegarde Google ni transfert d'appareil, le dossier mémoire est la seule
 * sauvegarde ; le récepteur de démarrage du greffon GPS et sa permission retirés. Une mise à jour du greffon qui
 * changerait ce récepteur rendrait le retrait muet sans erreur de compilation.
 *
 * Les services et la permission batterie restent pour l'instant (n° 171 du reste à faire) : leur retrait se décidera
 * avec le reste, pas par accident.
 */

// Les types de Node ne sont pas ceux de l'app (voir `hooks/mediaQueries.test.ts`) : le peu qui sert est décrit à la main.
interface Fs {
  existsSync(file: URL): boolean;
  readFileSync(file: URL, encoding: 'utf8'): string;
}
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;

/** Source d'un fichier d'un paquet, cherché en remontant les `node_modules` comme le fait Node. */
const packageSource = (path: string): string => {
  for (let dir = new URL('./', import.meta.url); ; dir = new URL('../', dir)) {
    const file = new URL(`node_modules/${path}`, dir);
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
    if (new URL('../', dir).href === dir.href) throw new Error(`Introuvable dans node_modules : ${path}`);
  }
};
const repoFile = (path: string): string => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

/** Commentaires XML retirés : un mot cité dans un commentaire ne prouve rien. */
const withoutComments = (xml: string): string => xml.replace(/<!--[\s\S]*?-->/g, '');
const MANIFEST = withoutComments(repoFile('android/app/src/main/AndroidManifest.xml'));
const RULES = withoutComments(repoFile('android/app/src/main/res/xml/data_extraction_rules.xml'));
const PLUGIN_MANIFEST = packageSource('@capgo/background-geolocation/android/src/main/AndroidManifest.xml');

const BOOT_RECEIVER = 'com.capgo.capacitor_background_geolocation.GeofenceBootReceiver';
/** Tous les emplacements que connaît `data-extraction-rules` (developer.android.com/identity/data/autobackup). */
const DOMAINS = ['root', 'file', 'database', 'sharedpref', 'external', 'device_root', 'device_file', 'device_database', 'device_sharedpref'];

/** Balise ouvrante qui contient `name`, attributs compris, avec son attribut `tools:node` éventuel. */
const tagWithName = (xml: string, tag: string, name: string): string | undefined =>
  xml.match(new RegExp(`<${tag}\\b[^>]*android:name="${name.replace(/\./g, '\\.')}"[^>]*>`))?.[0];

describe('manifeste Android : retraits', () => {
  it('déclare l\'espace de noms tools', () => {
    expect(MANIFEST).toContain('xmlns:tools="http://schemas.android.com/tools"');
  });

  it('retire le récepteur de démarrage du greffon GPS', () => {
    expect(tagWithName(MANIFEST, 'receiver', BOOT_RECEIVER)).toContain('tools:node="remove"');
  });

  it('retire la permission de démarrage', () => {
    expect(tagWithName(MANIFEST, 'uses-permission', 'android.permission.RECEIVE_BOOT_COMPLETED')).toContain('tools:node="remove"');
  });

  it('le greffon déclare toujours ce récepteur et cette permission : le retrait vise juste', () => {
    expect(PLUGIN_MANIFEST).toContain(`android:name="${BOOT_RECEIVER}"`);
    expect(PLUGIN_MANIFEST).toContain('android:name="android.permission.RECEIVE_BOOT_COMPLETED"');
  });

  it('l\'application ne crée aucune zone de géorepérage, seule chose que ce récepteur restaure', () => {
    expect(repoFile('src/platform/location.ts')).not.toMatch(/addGeofence/);
  });
});

describe('manifeste Android : ce qui reste', () => {
  it.each(['.IntervalTimerService', '.HeartRateService'])('garde le service %s', (name) => {
    expect(tagWithName(MANIFEST, 'service', name)).toBeDefined();
  });

  it('garde la permission batterie', () => {
    const tag = tagWithName(MANIFEST, 'uses-permission', 'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS');
    expect(tag).toBeDefined();
    expect(tag).not.toContain('tools:node');
  });

  it('ne retire pas le récepteur de géorepérage du greffon', () => {
    expect(MANIFEST).not.toContain('GeofenceBroadcastReceiver');
  });
});

describe('manifeste Android : sauvegarde', () => {
  it('coupe la sauvegarde et pointe vers les règles', () => {
    expect(MANIFEST).toContain('android:allowBackup="false"');
    expect(MANIFEST).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
    expect(MANIFEST).not.toContain('android:allowBackup="true"');
  });

  it.each(['cloud-backup', 'device-transfer'])('%s : tout est exclu, rien n\'est inclus', (section) => {
    const body = RULES.match(new RegExp(`<${section}>([\\s\\S]*?)</${section}>`))?.[1];
    expect(body, section).toBeDefined();
    expect(body).not.toContain('<include');
    for (const domain of DOMAINS) expect(body, domain).toContain(`<exclude domain="${domain}" path="." />`);
  });
});

describe('manifeste Android : fichiers reçus d\'une autre application (lot 35)', () => {
  const activity = MANIFEST.match(/<activity\b[\s\S]*?<\/activity>/)?.[0] ?? '';
  const filters = [...activity.matchAll(/<intent-filter>([\s\S]*?)<\/intent-filter>/g)].map((m) => m[1]);
  const allWithAction = (action: string): string[] => filters.filter((f) => f.includes(`android.intent.action.${action}"`));
  const withAction = (action: string): string => allWithAction(action)[0] ?? '';
  /** Le filtre VIEW du « Ouvrir avec » par l'extension : le seul qui porte le type générique. */
  const extensionFilter = allWithAction('VIEW').find((f) => f.includes('android:mimeType="*/*"')) ?? '';
  const TYPES = ['application/gpx+xml', 'application/vnd.ant.fit', 'application/fit', 'application/octet-stream', 'text/xml', 'application/xml'];

  it('l\'activité reste seule de sa tâche, et le lanceur ne change pas : une ouverture normale reste la même', () => {
    expect(activity).toContain('android:launchMode="singleTask"');
    expect(withAction('MAIN')).toContain('android.intent.category.LAUNCHER');
  });

  it.each(['VIEW', 'SEND'])('%s : les six types, proposé sans lien depuis une page web', (action) => {
    const filter = withAction(action);
    for (const type of TYPES) expect(filter, type).toContain(`android:mimeType="${type}"`);
    expect(filter).toContain('android.intent.category.DEFAULT');
    expect(filter).not.toContain('BROWSABLE');
    expect(filter, 'json').not.toContain('json');
  });

  it('VIEW : application/gpx en plus, pour un gestionnaire qui nomme ainsi le GPX', () => {
    expect(withAction('VIEW')).toContain('android:mimeType="application/gpx"');
  });

  it('un seul filtre VIEW à type générique, borné à l’extension .gpx (Tracker ne se propose pas pour tout)', () => {
    const generic = allWithAction('VIEW').filter((f) => f.includes('*/*'));
    expect(generic).toHaveLength(1);
    expect(extensionFilter).toContain('android:mimeType="*/*"');
    const patterns = [...extensionFilter.matchAll(/android:pathPattern="([^"]*)"/g)].map((m) => m[1]);
    expect(patterns.sort()).toEqual(['.*\\\\.GPX', '.*\\\\.gpx']);
    expect(extensionFilter).toContain('android:host="*"');
    expect(extensionFilter).toContain('android:scheme="content"');
    expect(extensionFilter).not.toContain('android:scheme="file"');
    expect(extensionFilter).toContain('android.intent.category.DEFAULT');
    expect(extensionFilter).not.toContain('BROWSABLE');
    expect(extensionFilter, 'json').not.toMatch(/json/i);
  });

  it('aucun filtre SEND ni autre filtre à type générique : le partage reste borné par ses types', () => {
    expect(allWithAction('SEND')).toHaveLength(1);
    expect(withAction('SEND')).not.toContain('*/*');
    expect(withAction('SEND')).not.toContain('pathPattern');
  });

  it('VIEW en content:// seulement, SEND sans schéma : une intention SEND n\'a pas d\'adresse, un schéma l\'exclurait', () => {
    expect(withAction('VIEW')).toContain('android:scheme="content"');
    expect(withAction('SEND')).not.toContain('android:scheme');
  });

  it('aucune permission de stockage : le droit de lecture vient de l\'intention', () => {
    expect(MANIFEST).not.toMatch(/READ_EXTERNAL_STORAGE|READ_MEDIA|MANAGE_EXTERNAL_STORAGE/);
  });
});
