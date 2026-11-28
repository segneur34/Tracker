import { describe, expect, it } from 'vitest';

/**
 * Le manifeste Android (lot 151) : ni sauvegarde Google ni transfert d'appareil, le dossier mémoire est la seule
 * sauvegarde ; la permission de démarrage retirée. L'ancien greffon GPS (et son récepteur de démarrage) n'est plus là.
 *
 * Les services et la permission batterie restent pour l'instant (n° 171 du reste à faire) : leur retrait se décidera
 * avec le reste, pas par accident.
 */

// Les types de Node ne sont pas ceux de l'app (voir `hooks/mediaQueries.test.ts`) : le peu qui sert est décrit à la main.
interface Fs {
  readFileSync(file: URL, encoding: 'utf8'): string;
}
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;

const repoFile = (path: string): string => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

/** Commentaires XML retirés : un mot cité dans un commentaire ne prouve rien. */
const withoutComments = (xml: string): string => xml.replace(/<!--[\s\S]*?-->/g, '');
const MANIFEST = withoutComments(repoFile('android/app/src/main/AndroidManifest.xml'));
const RULES = withoutComments(repoFile('android/app/src/main/res/xml/data_extraction_rules.xml'));

/** Tous les emplacements que connaît `data-extraction-rules` (developer.android.com/identity/data/autobackup). */
const DOMAINS = ['root', 'file', 'database', 'sharedpref', 'external', 'device_root', 'device_file', 'device_database', 'device_sharedpref'];

/** Balise ouvrante qui contient `name`, attributs compris, avec son attribut `tools:node` éventuel. */
const tagWithName = (xml: string, tag: string, name: string): string | undefined =>
  xml.match(new RegExp(`<${tag}\\b[^>]*android:name="${name.replace(/\./g, '\\.')}"[^>]*>`))?.[0];

describe('manifeste Android : retraits', () => {
  it('déclare l\'espace de noms tools', () => {
    expect(MANIFEST).toContain('xmlns:tools="http://schemas.android.com/tools"');
  });

  it('retire la permission de démarrage', () => {
    expect(tagWithName(MANIFEST, 'uses-permission', 'android.permission.RECEIVE_BOOT_COMPLETED')).toContain('tools:node="remove"');
  });

  it("aucun récepteur de l'ancien greffon GPS ne revient", () => {
    expect(MANIFEST).not.toContain('com.capgo');
  });
});

describe("manifeste Android : service de l'enregistrement (lot 232, étape 2)", () => {
  const service = tagWithName(MANIFEST, 'service', '.RecordingService') ?? '';

  it('déclaré chez nous, fermé aux autres applications, de type position', () => {
    expect(service).toContain('android:exported="false"');
    expect(service).toContain('android:foregroundServiceType="location"');
  });

  it("balayer l'application hors des applications récentes ne l'arrête pas", () => {
    expect(service).toContain('android:stopWithTask="false"');
  });

  it('la classe déclarée existe, est un service, et Android ne la relance jamais seul', () => {
    const java = repoFile('android/app/src/main/java/io/github/segneur/tracker/RecordingService.java');
    expect(java).toContain('public class RecordingService extends Service');
    expect(java).toContain('return START_NOT_STICKY;');
    expect(java).not.toMatch(/return START_(STICKY|REDELIVER_INTENT);/);
  });

  it.each(['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION', 'WAKE_LOCK', 'POST_NOTIFICATIONS'])(
    "déclare %s sans compter sur le manifeste d'un greffon",
    (name) => {
      const tag = tagWithName(MANIFEST, 'uses-permission', `android.permission.${name}`);
      expect(tag).toBeDefined();
      expect(tag).not.toContain('tools:node');
    },
  );

  it('exige le GPS, comme le greffon de position d\'avant', () => {
    expect(tagWithName(MANIFEST, 'uses-feature', 'android.hardware.location.gps')).toBeDefined();
  });

  it("ne demande jamais la position « toujours » : le service ne démarre que depuis l'application visible", () => {
    expect(MANIFEST).not.toContain('ACCESS_BACKGROUND_LOCATION');
  });

  it('les services propres à Tracker gardent leur type : muscu sur la ceinture, compteur à part', () => {
    expect(tagWithName(MANIFEST, 'service', '.HeartRateService')).toContain('android:foregroundServiceType="connectedDevice"');
    expect(tagWithName(MANIFEST, 'service', '.IntervalTimerService')).toContain('android:foregroundServiceType="specialUse"');
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

  it('déclare la permission des commandes du GPS, normale et sans demande : « Réessayer » recharge ses données d\'aide (lot 232)', () => {
    const tag = tagWithName(MANIFEST, 'uses-permission', 'android.permission.ACCESS_LOCATION_EXTRA_COMMANDS');
    expect(tag).toBeDefined();
    expect(tag).not.toContain('tools:node');
  });

  it("changer la taille ou la graisse du texte du téléphone ne recrée pas l'activité (enregistrement en cours, lot 232)", () => {
    const changes = tagWithName(MANIFEST, 'activity', '.MainActivity')?.match(/android:configChanges="([^"]*)"/)?.[1].split('|') ?? [];
    expect(changes).toEqual(expect.arrayContaining(['fontScale', 'fontWeightAdjustment', 'orientation', 'screenSize', 'uiMode', 'density']));
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

describe('manifeste Android : liaison sans fil avec le programme Windows (lot 250-3)', () => {
  const PLUGIN = repoFile('android/app/src/main/java/io/github/segneur/tracker/ComputerLinkPlugin.java');
  /** Cible de l'application (`targetSdkVersion`), lue où Gradle la prend. */
  const TARGET_SDK = Number(repoFile('android/variables.gradle').match(/\btargetSdkVersion\s*=\s*(\d+)/)?.[1]);

  it('lit l’état des réseaux, sans compter sur le manifeste d’un greffon', () => {
    const tag = tagWithName(MANIFEST, 'uses-permission', 'android.permission.ACCESS_NETWORK_STATE');
    expect(tag).toBeDefined();
    expect(tag).not.toContain('tools:node');
  });

  it('accès au réseau local déclaré seulement à partir de la cible 37, comme le demande la documentation d’Android', () => {
    expect(Number.isFinite(TARGET_SDK)).toBe(true);
    const tag = tagWithName(MANIFEST, 'uses-permission', 'android.permission.ACCESS_LOCAL_NETWORK');
    if (TARGET_SDK < 37) expect(tag).toBeUndefined();
    else expect(tag).toBeDefined();
  });

  it('accès au réseau local demandé seulement quand le téléphone et la cible de l’application atteignent 37', () => {
    expect(PLUGIN).toContain('LOCAL_NETWORK_SDK = 37;');
    const needs = PLUGIN.match(/private boolean needsLocalNetworkPermission\(\) \{([\s\S]*?)\n {4}\}/)?.[1] ?? '';
    expect(needs).toMatch(/Build\.VERSION\.SDK_INT >= LOCAL_NETWORK_SDK/);
    expect(needs).toMatch(/getApplicationInfo\(\)\.targetSdkVersion >= LOCAL_NETWORK_SDK/);
    expect(needs).toMatch(/getPermissionState\(LOCAL_NETWORK\)/);
  });

  it('aucun trafic en clair autorisé', () => {
    expect(MANIFEST).not.toContain('usesCleartextTraffic="true"');
    expect(MANIFEST).not.toContain('networkSecurityConfig');
  });

  it("ni service ni tâche de fond : la liaison se ferme quand l'application quitte l'écran", () => {
    expect(PLUGIN).not.toMatch(/startService|startForegroundService|WorkManager|JobScheduler|AlarmManager/);
    expect(PLUGIN).toMatch(/protected void handleOnStop\(\) \{[\s\S]*?stopAll\(\);/);
  });
});
