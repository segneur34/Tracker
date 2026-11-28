import { describe, expect, it } from 'vitest';
import { MAX_LISTED_FILE_BYTES } from '../library/reconcile';
import { NATIVE_LOG_FORMAT, NATIVE_LOG_VERSION, parseNativeLog } from '../recording/nativeLog';

/**
 * Ce que le code Android de l'application suppose des greffons, sans moyen de
 * le lire autrement que dans leur source : une mise à jour qui le changerait
 * casserait la sortie écran éteint sans erreur de compilation (lot 156).
 *
 * - `RecordingService.java` porte le numéro et le canal de la notification de
 *   l'enregistrement, et `RecordingNotificationPlugin.java` les lit chez lui ;
 *   ce sont ceux du service GPS du greffon, constantes privées, encore en
 *   service : les réglages d'écran verrouillé de l'utilisateur tiennent au canal
 *   (lot 232, étape 2).
 * - Le journal des positions a deux auteurs : `FixLog.java` l'écrit au
 *   téléphone, `recording/nativeLog.ts` le relit dans la page.
 * - La veille du GPS (`BeeperPlugin.java`) et la capture (`MotionPlugin.java`)
 *   n'ont pas de verrou de veille : elles comptent sur celui du service de
 *   position (`RecordingService.java`), sans échéance, pris au départ.
 * - `IncomingFilePlugin.java` lit l'intention de départ dans `handleOnNewIntent`, parce que `BridgeActivity` l'y passe
 *   lui-même au démarrage (lot 35).
 * - Les greffons maison `Permissions`, `HeartRate`, `Gnss` et `Recording` ont deux côtés : le Java répond, `platform/` appelle,
 *   par les mêmes noms de méthodes et de réponses (lot 232).
 * - La reprise après une chute du moteur de la WebView, ou à la réouverture
 *   d'une application balayée, rejoint le service de position par son greffon
 *   (`attachDeviceLocation`) ; `RecoveryPlugin.java` ne dit plus que le service
 *   de la ceinture sans position (lot 232, étape 2).
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

const appJava = (name: string): string =>
  fs.readFileSync(new URL(`../../android/app/src/main/java/io/github/segneur/tracker/${name}`, import.meta.url), 'utf8');

const RECORDING_NOTIFICATION = appJava('RecordingNotificationPlugin.java');
const BRIDGE = packageSource('@capacitor/android/capacitor/src/main/java/com/getcapacitor/Bridge.java');
const BRIDGE_ACTIVITY = packageSource('@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeActivity.java');
const WEBVIEW_LISTENER = packageSource('@capacitor/android/capacitor/src/main/java/com/getcapacitor/WebViewListener.java');
const MAIN_ACTIVITY = appJava('MainActivity.java');
const RECOVERY_PLUGIN = appJava('RecoveryPlugin.java');
const INCOMING_PLUGIN = appJava('IncomingFilePlugin.java');
const RECORDING_SERVICE = appJava('RecordingService.java');
const RECORDING_PLUGIN = appJava('RecordingPlugin.java');
const GNSS_PLUGIN = appJava('GnssPlugin.java');
const HEART_RATE_SERVICE = appJava('HeartRateService.java');
const FIX_LOG = appJava('FixLog.java');
const FIX_LOG_TEST = fs.readFileSync(new URL('../../android/app/src/test/java/io/github/segneur/tracker/FixLogTest.java', import.meta.url), 'utf8');

/** Première capture de `pattern` dans `text` ; échoue si le source a changé de forme. */
const captured = (text: string, pattern: RegExp): string => {
  const match = pattern.exec(text);
  expect(match, `${pattern} introuvable`).not.toBeNull();
  return match![1];
};

/** Le source compris entre deux repères, le premier compris. */
const between = (text: string, from: string, to: string): string => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start);
  expect(start, `${from} introuvable`).toBeGreaterThanOrEqual(0);
  expect(end, `${to} introuvable`).toBeGreaterThan(start);
  return text.slice(start, end);
};

describe("notification de l'enregistrement : un seul propriétaire, notre service, aux valeurs héritées de l'ancien greffon", () => {
  it("numéro et canal gardés : les réglages d'écran verrouillé des téléphones tiennent au canal déjà créé", () => {
    expect(captured(RECORDING_SERVICE, /int NOTIFICATION_ID = (\d+);/)).toBe('28351');
    expect(captured(RECORDING_SERVICE, /String CHANNEL_ID = "([^"]+)";/)).toBe('com.capgo.capacitor_background_geolocation');
  });

  it('le greffon qui la récrit lit les deux chez le service, sans les recopier', () => {
    expect(RECORDING_NOTIFICATION).toContain('NOTIFICATION_ID = RecordingService.NOTIFICATION_ID;');
    expect(RECORDING_NOTIFICATION).toContain('CHANNEL_ID = RecordingService.CHANNEL_ID;');
    expect(RECORDING_NOTIFICATION).not.toMatch(/\b(NOTIFICATION_ID = \d|CHANNEL_ID = ")/);
  });

  it('la ceinture sans position (muscu, nuit) prend le même numéro et le même canal : jamais deux notifications', () => {
    expect(HEART_RATE_SERVICE).toContain('startForeground(RecordingNotificationPlugin.NOTIFICATION_ID,');
    expect(HEART_RATE_SERVICE).toContain('RecordingNotificationPlugin.CHANNEL_ID');
  });

  it("la notification laissée par la garde a son propre numéro : elle survit à l'arrêt du service", () => {
    expect(captured(RECORDING_SERVICE, /\bSTOPPED_NOTIFICATION_ID = (\d+);/)).not.toBe(captured(RECORDING_SERVICE, /\bNOTIFICATION_ID = (\d+);/));
  });

  it('le nom du canal est une ressource du téléphone, déclarée', () => {
    const name = captured(between(RECORDING_SERVICE, 'static void ensureChannel(', 'static void cancelStoppedNotification('), /R\.string\.(\w+)/);
    const strings = fs.readFileSync(new URL('../../android/app/src/main/res/values/strings.xml', import.meta.url), 'utf8');
    expect(strings).toContain(`<string name="${name}">`);
  });
});

/** Méthodes que la page appellera sur le greffon `Recording` (`platform/location.ts`, lot 232 E3), et ses événements. */
const RECORDING_METHODS = ['start', 'stop', 'state', 'setPaused', 'readLog', 'clearLog', 'currentPosition', 'checkPermissions', 'requestPermissions'];
const RECORDING_EVENTS = ['fix', 'error', 'locationEnabled'];

describe("service de l'enregistrement (lot 232, étape 2)", () => {
  it('le greffon est déclaré, sous son nom', () => {
    expect(MAIN_ACTIVITY).toContain('registerPlugin(RecordingPlugin.class);');
    expect(RECORDING_PLUGIN).toMatch(/@CapacitorPlugin\(\s*name = "Recording",/);
  });

  it.each(RECORDING_METHODS)('le greffon porte la méthode %s', (method) => {
    expect(RECORDING_PLUGIN).toMatch(new RegExp(String.raw`@PluginMethod\s+public void ${method}\(PluginCall call\)`));
  });

  it('ses événements portent les noms que la page écoutera', () => {
    const events = [...RECORDING_PLUGIN.matchAll(/\bEVENT_\w+ = "(\w+)";/g)].map((m) => m[1]).sort();
    expect(events).toEqual([...RECORDING_EVENTS].sort());
  });

  it("verrou de veille pris au départ, sans échéance, rendu à l'arrêt", () => {
    expect(between(RECORDING_SERVICE, 'private void begin(Settings next)', 'private void end()')).toContain('acquireWakeLock();');
    expect(between(RECORDING_SERVICE, 'private void acquireWakeLock()', 'private void releaseWakeLock()')).toContain('wakeLock.acquire();');
    expect(between(RECORDING_SERVICE, 'private void end()', 'private void onLocation(')).toContain('releaseWakeLock();');
  });

  it('chaque position va au journal avant la page', () => {
    const received = between(RECORDING_SERVICE, 'private void onLocation(', 'private boolean pause(');
    expect(received.indexOf('append(line, now);')).toBeGreaterThanOrEqual(0);
    expect(received.indexOf('append(line, now);')).toBeLessThan(received.indexOf('target.onFix(fix);'));
  });

  it('ni texte ni seuil de la page en dur : rien que la page ne donne au départ', () => {
    const names = [
      'session', 'intervalMs', 'distanceFilterM', 'title', 'text', 'closedText', 'gpsLostTitle', 'stoppedTitle', 'stoppedText',
      'gpsLostDelayS', 'gpsLostRearmS', 'guardStillRadiusM', 'guardStillDelayS', 'guardMaxClosedS', 'guardMovingSpeedMs', 'guardMovingHoldS',
    ];
    const launch = between(RECORDING_PLUGIN, 'private void launch(PluginCall call)', 'public void stop(PluginCall call)');
    for (const name of names) expect(launch, name).toContain(`"${name}"`);
  });

  it("le journal est dans le dossier privé que ni la sauvegarde ni le transfert n'emportent", () => {
    expect(between(RECORDING_SERVICE, 'static File logFile(', 'static Snapshot snapshot()')).toContain('context.getNoBackupFilesDir()');
  });

  it('« Réessayer » du GPS refait aussi l\'inscription du service, sans effet tant qu\'il ne tourne pas', () => {
    expect(between(GNSS_PLUGIN, 'public void refreshAssistance(PluginCall call)', 'private boolean extraCommand(')).toContain('RecordingService.retryGps();');
    expect(between(RECORDING_SERVICE, 'static void retryGps()', 'static void setPage(')).toContain('if (service != null)');
  });
});

/** Un texte tel que le source Java l'écrit entre guillemets. */
const javaLiteral = (text: string): string => `"${text.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;

describe('journal des positions : ce que le Java écrit, la page le relit', () => {
  it('même nom de format et même version que ceux que la page relit (`recording/nativeLog.ts`)', () => {
    expect(captured(FIX_LOG, /\bFORMAT = "([^"]+)";/)).toBe(NATIVE_LOG_FORMAT);
    expect(captured(FIX_LOG, /\bVERSION = (\d+);/)).toBe(String(NATIVE_LOG_VERSION));
  });

  it("raisons d'arrêt par la garde", () => {
    expect(captured(FIX_LOG, /\bSTOP_STILL = "([^"]+)";/)).toBe('still');
    expect(captured(FIX_LOG, /\bSTOP_TIMEOUT = "([^"]+)";/)).toBe('timeout');
  });

  // Chaque ligne ci-dessous est attendue telle quelle par `FixLogTest.java`, qui la compare à ce que `FixLog` écrit.
  const HEADER = '{"format":"tracker-positions","version":1,"session":1794819600000}\n';
  const LINES = [
    '[1794819601000,48.123456789,-4.5,3.9,12.25,5.14,271.5]\n',
    '[1000,48.0,-4.0,null,null,null,null]\n',
    '[1,1.0E-5,0.0,1.0E10,-0.0,1.0E-4,0.0]\n',
    '["pause",1794819700000]\n',
    '["resume",1794819760000]\n',
    '\n["start",1794819800000]\n',
    '["stop",1794819900000,"still"]\n',
    '["stop",1794819900000,"timeout"]\n',
  ];

  it('les lignes que la page relit sont bien celles que le test Java attend de FixLog', () => {
    for (const line of [HEADER, ...LINES]) expect(FIX_LOG_TEST, line).toContain(javaLiteral(line));
  });

  it('la page relit chacune : en-tête, positions brutes, valeurs absentes, exposants, ordres, relance, arrêt', () => {
    const log = parseNativeLog(HEADER + LINES.join(''));
    expect(log?.session).toBe(1794819600000);
    expect(log?.entries).toEqual([
      { kind: 'fix', fix: { timeMs: 1794819601000, lat: 48.123456789, lon: -4.5, accuracyM: 3.9, altitudeM: 12.25, speedMs: 5.14, bearingDeg: 271.5 } },
      { kind: 'fix', fix: { timeMs: 1000, lat: 48, lon: -4, accuracyM: undefined, altitudeM: undefined, speedMs: undefined, bearingDeg: undefined } },
      { kind: 'fix', fix: { timeMs: 1, lat: 1e-5, lon: 0, accuracyM: 1e10, altitudeM: -0, speedMs: 1e-4, bearingDeg: 0 } },
      { kind: 'pause', atMs: 1794819700000 },
      { kind: 'resume', atMs: 1794819760000 },
      { kind: 'start', atMs: 1794819800000 },
      { kind: 'stop', atMs: 1794819900000, reason: 'still' },
      { kind: 'stop', atMs: 1794819900000, reason: 'timeout' },
    ]);
  });
});

describe('chute du moteur de rendu', () => {
  it("écouteur posé sur les signatures de Capacitor, avant le démarrage du pont", () => {
    expect(BRIDGE).toContain('public Builder addWebViewListener(WebViewListener webViewListener)');
    expect(BRIDGE).toContain('public void reload()');
    expect(BRIDGE_ACTIVITY).toContain('protected final Bridge.Builder bridgeBuilder');
    expect(BRIDGE_ACTIVITY).toContain('protected Bridge bridge;');
    expect(WEBVIEW_LISTENER).toContain('public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail)');
    expect(WEBVIEW_LISTENER).toContain('public void onPageLoaded(WebView webView)');
    expect(MAIN_ACTIVITY.indexOf('bridgeBuilder.addWebViewListener(')).toBeGreaterThanOrEqual(0);
    expect(MAIN_ACTIVITY.indexOf('bridgeBuilder.addWebViewListener(')).toBeLessThan(MAIN_ACTIVITY.indexOf('super.onCreate(savedInstanceState);'));
  });

  it('le greffon de la preuve est déclaré, et ne lit plus que le service de la ceinture sans position', () => {
    expect(MAIN_ACTIVITY).toContain('registerPlugin(RecoveryPlugin.class);');
    expect(RECOVERY_PLUGIN).toContain('HeartRateService.class.getName()');
    expect(RECOVERY_PLUGIN).not.toMatch(/GPS_SERVICE|capacitor_background_geolocation/);
    expect(RECOVERY_PLUGIN).toContain('ret.put("belt", belt);');
    expect(RECOVERY_PLUGIN).not.toContain('ret.put("gps"');
  });

  it("onPageLoaded ne fait que retirer l'échéance, deux appels ne comptent pas deux fois", () => {
    const loaded = between(MAIN_ACTIVITY, 'public void onPageLoaded(WebView webView)', 'super.onCreate(savedInstanceState);');
    expect(loaded).toContain('main.removeCallbacks(pageLoadMissed);');
    expect(loaded).not.toContain('RENDER_RELOADS');
  });
});

describe('fichiers reçus d\'une autre application (lot 35)', () => {
  it('Capacitor passe l\'intention de départ à onNewIntent, une fois le pont créé, et relaie vers les greffons', () => {
    const load = between(BRIDGE_ACTIVITY, 'protected void load()', 'public void registerPlugin(');
    expect(load.indexOf('this.onNewIntent(getIntent());')).toBeGreaterThan(load.indexOf('bridge = bridgeBuilder'));
    expect(between(BRIDGE, 'public void onNewIntent(Intent intent)', 'public void onConfigurationChanged')).toContain('plugin.getInstance().handleOnNewIntent(intent);');
  });

  it('le greffon est déclaré, et oublie l\'intention d\'une activité restaurée avant que le pont la lise', () => {
    expect(MAIN_ACTIVITY).toContain('registerPlugin(IncomingFilePlugin.class);');
    expect(MAIN_ACTIVITY.indexOf('IncomingFilePlugin.forgetReplayedFile(this, savedInstanceState);')).toBeGreaterThanOrEqual(0);
    expect(MAIN_ACTIVITY.indexOf('IncomingFilePlugin.forgetReplayedFile(this, savedInstanceState);')).toBeLessThan(MAIN_ACTIVITY.indexOf('super.onCreate(savedInstanceState);'));
  });

  it('même plafond qu\'au listage de la mémoire', () => {
    expect(captured(INCOMING_PLUGIN, /\bMAX_BYTES = (\d+L \* 1024 \* 1024);/)).toBe(`${MAX_LISTED_FILE_BYTES / (1024 * 1024)}L * 1024 * 1024`);
  });

  it('les motifs de refus sont ceux que la page connaît', () => {
    expect(captured(INCOMING_PLUGIN, /\bREFUSED_FORMAT = "([^"]+)";/)).toBe('format');
    expect(captured(INCOMING_PLUGIN, /\bREFUSED_TOO_LARGE = "([^"]+)";/)).toBe('trop-gros');
    expect(captured(INCOMING_PLUGIN, /\bREFUSED_UNREADABLE = "([^"]+)";/)).toBe('illisible');
  });

  it('un partage sans fichier a le refus « ni GPX ni FIT » : rien à rouvrir ; une intention mal formée reste « illisible »', () => {
    expect(between(INCOMING_PLUGIN, 'protected void handleOnNewIntent(Intent intent)', 'private static File directory'))
      .toContain('carriesNoFile(intent) ? REFUSED_FORMAT : REFUSED_UNREADABLE');
    expect(between(INCOMING_PLUGIN, 'private static boolean carriesNoFile', 'protected void handleOnNewIntent'))
      .toMatch(/addressIn\(intent\) == null;[\s\S]*catch \(RuntimeException e\)[\s\S]*return false;/);
  });

  it('la copie ne passe ni par le fil de l\'interface ni par celui des greffons : une tâche à elle, gardée contre une chute', () => {
    const entry = between(INCOMING_PLUGIN, 'protected void handleOnNewIntent(Intent intent)', 'private static File directory');
    expect(entry).toContain('runOnWorker(() -> {');
    expect(entry.indexOf('receive(context, uri, refusalWithoutFile);')).toBeGreaterThan(entry.indexOf('runOnWorker(() -> {'));
    expect(between(INCOMING_PLUGIN, 'private static void runOnWorker', 'public void load()')).toContain('catch (Exception | OutOfMemoryError e)');
  });
});

/** Méthodes du greffon appelées par la page (`<objet>.<méthode>(`), sans les écouteurs, communs à tous les greffons. */
const calledMethods = (source: string, object: string): string[] =>
  [...new Set([...source.matchAll(new RegExp(String.raw`\b${object}\.(\w+)\(`, 'g'))].map((m) => m[1]))]
    .filter((name) => name !== 'addListener' && name !== 'removeAllListeners')
    .sort();

/** Motif d'une méthode de greffon `name` dans le source Java. */
const pluginMethod = (name: string): RegExp => new RegExp(String.raw`@PluginMethod\s+public void ${name}\(PluginCall call\)`);

describe('greffons maison : ce que la page appelle, le Java le porte (lot 232)', () => {
  const platformSource = (name: string): string => fs.readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

  it.each([
    ['Permissions', 'PermissionsPlugin.java', 'permissions.ts', 'plugin'],
    ['HeartRate', 'HeartRatePlugin.java', 'heartRate.ts', 'plugin'],
    ['Gnss', 'GnssPlugin.java', 'location.ts', 'gnss'],
    ['Recording', 'RecordingPlugin.java', 'location.ts', 'recording'],
  ])('greffon %s : déclaré sous son nom, chaque méthode appelée existe', (name, javaFile, tsFile, object) => {
    const java = appJava(javaFile);
    const ts = platformSource(tsFile);
    expect(MAIN_ACTIVITY).toContain(`registerPlugin(${javaFile.replace('.java', '')}.class);`);
    expect(java).toContain(`@CapacitorPlugin(`);
    expect(java).toMatch(new RegExp(`name = "${name}"`));
    expect(ts).toMatch(new RegExp(String.raw`registerPlugin<\w+>\('${name}'\)`));
    const called = calledMethods(ts, object);
    expect(called.length).toBeGreaterThan(0);
    for (const method of called) expect(java, method).toMatch(pluginMethod(method));
  });

  it('les boutons de secours et les autorisations sont bien appelés : le contrôle ci-dessus les couvre', () => {
    expect(calledMethods(platformSource('permissions.ts'), 'plugin')).toEqual(expect.arrayContaining(['deviceBrand', 'openLocationSettings']));
    expect(calledMethods(platformSource('heartRate.ts'), 'plugin')).toContain('retryNow');
    expect(calledMethods(platformSource('location.ts'), 'gnss')).toContain('refreshAssistance');
    expect(calledMethods(platformSource('location.ts'), 'recording')).toEqual([...RECORDING_METHODS].sort());
  });

  it('les réponses sont lues sous les noms que le Java écrit', () => {
    const permissions = appJava('PermissionsPlugin.java');
    for (const key of ['manufacturer', 'brand', 'unrestricted']) expect(permissions, key).toContain(`ret.put("${key}"`);
    expect(appJava('HeartRatePlugin.java')).toContain('ret.put("seen"');
    expect(appJava('GnssPlugin.java')).toContain('ret.put("sent"');
    for (const key of ['running', 'session', 'paused', 'text']) expect(RECORDING_PLUGIN, key).toContain(`ret.put("${key}"`);
    for (const key of ['timeMs', 'lat', 'lon', 'accuracyM', 'altitudeM', 'speedMs', 'bearingDeg', 'code', 'message']) {
      expect(RECORDING_PLUGIN, key).toContain(`data.put("${key}"`);
    }
  });

  it("« Réessayer » de la ceinture : au moins 6 s entre deux recherches, limite d'Android (5 par 30 s)", () => {
    expect(Number(captured(appJava('HeartRatePlugin.java'), /\bRETRY_GAP_MS = (\d+);/))).toBeGreaterThanOrEqual(6000);
  });

  it("« Réessayer » du GPS ne demande jamais d'effacer les données d'aide", () => {
    expect(appJava('GnssPlugin.java')).not.toMatch(/"delete_aiding_data"/);
  });
});

/** Méthodes du greffon de la liaison sans fil : l'appairage en quatre étapes, menées par la page (lot 250-4). */
const COMPUTER_LINK_METHODS = ['connect', 'forget', 'pairConfirm', 'pairFinish', 'pairOffer', 'pairSearch', 'status'];

/**
 * La liaison sans fil a deux côtés écrits dans deux langages : `bureau/trames.ts`, `appairage.ts`, `sonde.ts` et
 * `telephone.ts` côté PC, `ComputerLinkProtocol.java` et ses voisins côté téléphone (lot 250-3). Leurs jeux d'essai
 * communs (`bureau/sansFil.vecteurs.json`, relus par `ComputerLinkProtocolTest.java`) éprouvent les octets et les
 * règles de chemins ; ici, les constantes et les listes fermées que les jeux d'essai ne couvrent pas, relues dans les
 * deux sources.
 */
describe('liaison sans fil : mêmes constantes au PC et au téléphone (lot 250-3)', () => {
  const PROTOCOL = appJava('ComputerLinkProtocol.java');
  const PLUGIN = appJava('ComputerLinkPlugin.java');
  const COMMANDS = appJava('ComputerLinkCommands.java');
  const bureau = (name: string): string => fs.readFileSync(new URL(`../../bureau/${name}`, import.meta.url), 'utf8');
  const TRAMES = bureau('trames.ts');
  const APPAIRAGE = bureau('appairage.ts');
  const SONDE = bureau('sonde.ts');
  const DISQUE = bureau('disque.ts');
  const SPAKE2 = bureau('spake2.ts');
  const TELEPHONE = bureau('telephone.ts');
  /** Un entier écrit `48_247` ou `48247`. */
  const int = (text: string): number => Number(text.replace(/_/g, ''));
  const tsConst = (source: string, name: string): number => int(captured(source, new RegExp(`\\bexport const ${name} = ([\\d_]+)\\b`)));
  const javaConst = (name: string): number => int(captured(PROTOCOL, new RegExp(`\\bstatic final (?:int|long) ${name} = ([\\d_]+)L?;`)));
  const javaString = (source: string, name: string): string => captured(source, new RegExp(`\\bstatic final String ${name} = "([^"]+)";`));

  it('version du protocole, ports, taille de bloc, identifiant, noms et messages', () => {
    expect(javaConst('PROTOCOL_VERSION')).toBe(tsConst(TRAMES, 'PROTOCOLE_SANS_FIL'));
    expect(javaConst('PORT')).toBe(tsConst(TRAMES, 'PORT_SANS_FIL'));
    expect(javaConst('PROBE_PORT')).toBe(tsConst(SONDE, 'PORT_SONDE'));
    // Jamais ceux de Gtracker : les deux programmes cohabitent sur un même PC.
    expect(javaConst('PORT')).not.toBe(48217);
    expect(javaConst('PROBE_PORT')).not.toBe(48218);
    expect(javaConst('BLOCK_SIZE')).toBe(tsConst(TRAMES, 'TAILLE_BLOC'));
    expect(javaConst('PREFIX_SIZE')).toBe(tsConst(TRAMES, 'TAILLE_PREFIXE'));
    expect(javaConst('ID_MAX')).toBe(tsConst(TRAMES, 'ID_MAX'));
    expect(javaConst('NAME_MAX')).toBe(tsConst(TRAMES, 'NOM_MAX'));
    expect(javaConst('MESSAGE_MAX')).toBe(tsConst(TRAMES, 'MESSAGE_MAX'));
    expect(javaConst('CODE_DIGITS')).toBe(tsConst(APPAIRAGE, 'CHIFFRES_CODE'));
  });

  it("limites des trames : celles d'une liaison reconnue et celles de l'accueil", () => {
    const limits = (source: string, name: string): string[] =>
      captured(source, new RegExp(`\\b${name}\\b[^=]*= (?:Object\\.freeze\\(\\{ enTete: |new Limits\\()([^)}]+)`)).split(/,\s*(?:corps:\s*)?/).map((v) => v.trim());
    const ts = limits(TRAMES, 'LIMITES');
    const java = limits(PROTOCOL, 'LIMITS');
    expect(int(java[0])).toBe(int(ts[0]));
    expect(java[1]).toBe('BLOCK_SIZE');
    expect(ts[1]).toBe('TAILLE_BLOC');
    expect(limits(PROTOCOL, 'WELCOME_LIMITS').map(int)).toEqual(limits(TRAMES, 'LIMITES_ACCUEIL').map(int));
  });

  it("tailles des messages de l'appairage et suffixes des écritures en cours", () => {
    expect(javaConst('PART_SIZE')).toBe(tsConst(SPAKE2, 'TAILLE_PART'));
    expect(javaConst('CONFIRMATION_SIZE')).toBe(tsConst(SPAKE2, 'TAILLE_CONFIRMATION'));
    expect(javaConst('FINGERPRINT_SIZE')).toBe(tsConst(SPAKE2, 'TAILLE_EMPREINTE_SPAKE2'));
    const memory = appJava('MemoryTree.java');
    for (const source of [PROTOCOL, memory]) {
      expect(javaString(source, 'TEMP_SUFFIX')).toBe(captured(DISQUE, /\bSUFFIXE_REMPLACEMENT = '([^']+)'/));
      expect(javaString(source, 'NEW_SUFFIX')).toBe(captured(DISQUE, /\bSUFFIXE_NEUF = '([^']+)'/));
    }
  });

  it("même capacité d'écriture, annoncée par le téléphone et lue par le PC", () => {
    expect(javaString(PROTOCOL, 'CAPABILITY_WRITE')).toBe(captured(TRAMES, /\bexport const CAPACITE_ECRITURE = '([^']+)'/));
    expect(javaString(PROTOCOL, 'CAPABILITY_SPAKE2')).toBe(captured(TRAMES, /\bexport const CAPACITE_SPAKE2 = '([^']+)'/));
    expect(captured(PROTOCOL, /\bCAPABILITIES = [^;]*Arrays\.asList\(([^)]*)\)/).trim()).toBe('CAPABILITY_WRITE');
    expect(captured(TRAMES, /\bexport const CAPACITES = \[([^\]]*)\]/).trim()).toBe('CAPACITE_ECRITURE');
  });

  it('découverte : signature, octet de version et étiquette de la trace, les mêmes des deux côtés', () => {
    const bytes = (text: string): number[] => text.split(',').map((b) => Number(b.trim()));
    const java = bytes(captured(PROTOCOL, /\bPROBE_SIGNATURE = \{([^}]*)\}/));
    expect(java).toEqual(bytes(captured(SONDE, /\bexport const SIGNATURE_SONDE = Uint8Array\.from\(\[([^\]]*)\]\)/)));
    expect(String.fromCharCode(...java)).toBe('TRKR');
    expect(javaConst('PROBE_VERSION_2')).toBe(tsConst(SONDE, 'VERSION_SONDE_V2'));
    expect(javaString(PROTOCOL, 'PROBE_LABEL')).toBe(captured(SONDE, /\bexport const ETIQUETTE_SONDE = '([^']+)'/));
    expect(javaConst('PROBE_NONCE_SIZE')).toBe(tsConst(SONDE, 'TAILLE_NONCE_SONDE'));
    expect(javaConst('COMPUTER_ID_SIZE')).toBe(tsConst(SONDE, 'TAILLE_IDENTIFIANT_PC'));
  });

  it('mêmes listes fermées des deux côtés : dossiers listés, écritures, retraits, corbeille du téléphone', () => {
    /** Valeurs d'une liste dont chaque élément est un texte ou le nom d'une constante texte du même source. */
    const values = (items: string, constant: (name: string) => string): string[] =>
      items.split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
        const literal = /^["']([^"']*)["']$/.exec(item);
        return literal ? literal[1] : constant(item);
      });
    const javaList = (name: string): string[] =>
      values(captured(PROTOCOL, new RegExp(`\\b${name} = [^;]*Arrays\\.asList\\(([^)]*)\\)`)), (n) => javaString(PROTOCOL, n));
    const tsList = (name: string): string[] =>
      values(captured(TELEPHONE, new RegExp(`\\bexport const ${name}: readonly string\\[\\] = \\[([^\\]]*)\\]`)), (n) => captured(TELEPHONE, new RegExp(`\\bexport const ${n} = '([^']+)'`)));
    expect(javaList('LISTED_DIRS')).toEqual(tsList('DOSSIERS_LISTES'));
    expect(javaList('WRITABLE_DIRS')).toEqual(tsList('DOSSIERS_ECRIVABLES'));
    expect(javaList('WRITABLE_ROOT_FILES')).toEqual(tsList('FICHIERS_RACINE_ECRIVABLES'));
    expect(javaList('REMOVABLE_DIRS')).toEqual(tsList('DOSSIERS_RETIRABLES'));
    expect(javaList('LISTED_DIRS')).toContain('journaux');
    expect(javaList('WRITABLE_ROOT_FILES')).not.toContain('lieux.json');
    expect(javaString(PROTOCOL, 'TRASH_DIR')).toBe(captured(TELEPHONE, /\bexport const DEPOT_TELEPHONE = '([^']+)'/));
    expect(javaString(PROTOCOL, 'DEPOSIT_FILE')).toBe(captured(TELEPHONE, /\bexport const FICHIER_DEPOT = '([^']+)'/));
    expect(javaConst('WRITE_PATH_MAX')).toBe(int(captured(TELEPHONE, /\bconst LONGUEUR_MAX = ([\d_]+)\b/)));
    expect(javaConst('RAW_PATH_MAX')).toBe(tsConst(TELEPHONE, 'LONGUEUR_MAX_BRUT'));
    expect(javaConst('DEPOSIT_IDENTITY_MAX')).toBe(int(captured(TELEPHONE, /\bconst IDENTITE_DEPOT_MAX = ([\d_]+)\b/)));
  });

  it("aucune commande d'effacement : le téléphone ne connaît pas `effacer`", () => {
    expect(PROTOCOL).not.toMatch(/case "effacer"/);
    expect(COMMANDS).not.toMatch(/case "effacer"|eraseFile/);
    for (const type of ['listerTout', 'deplacer', 'listerCorbeille']) {
      expect(PROTOCOL, type).toContain(`case "${type}":`);
      expect(COMMANDS, type).toContain(`case "${type}":`);
    }
  });

  it('pendant un service de premier plan, le refus est la phrase que la page reconnaît, et la garde lit les trois services du câble', () => {
    expect(javaString(COMMANDS, 'RECORDING_REFUSAL')).toBe(captured(TELEPHONE, /\bexport const MESSAGE_ENREGISTREMENT = "([^"]+)"/));
    const busy = between(appJava('ForegroundWork.java'), 'static boolean busy()', '}');
    const services = [...busy.matchAll(/\b(\w+Service)\./g)].map((m) => m[1]);
    const cable = [...captured(TELEPHONE, /\bexport const SERVICES_APPLICATION = \[([^\]]*)\]/).matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(services).toEqual(cable);
    expect(PLUGIN).toContain('ForegroundWork::busy');
  });

  it('le test Java relit les jeux d’essai du PC dans le dépôt, sans copie', () => {
    const test = fs.readFileSync(new URL('../../android/app/src/test/java/io/github/segneur/tracker/ComputerLinkProtocolTest.java', import.meta.url), 'utf8');
    expect(test).toContain('"bureau/sansFil.vecteurs.json"');
    expect(fs.existsSync(new URL('../../bureau/sansFil.vecteurs.json', import.meta.url))).toBe(true);
  });

  it('le greffon est déclaré sous son nom, et son événement porte le nom attendu', () => {
    expect(MAIN_ACTIVITY).toContain('registerPlugin(ComputerLinkPlugin.class);');
    expect(PLUGIN).toMatch(/@CapacitorPlugin\(\s*name = "ComputerLink",/);
    expect(javaString(PLUGIN, 'EVENT_STATUS')).toBe('status');
    expect(javaString(PLUGIN, 'PREFS')).toBe('tracker.ordinateur');
    for (const name of COMPUTER_LINK_METHODS) expect(PLUGIN, name).toMatch(pluginMethod(name));
  });

  it('le jeton et l’empreinte gardée ne partent jamais vers la page', () => {
    const status = between(PLUGIN, 'private JSObject statusObject()', 'private void notifyStatus()');
    expect(status).not.toMatch(/KEY_TOKEN, null|KEY_FINGERPRINT|"jeton"|"empreinte"|"token"/);
    const puts = [...PLUGIN.matchAll(/\bret\.put\(([^;]*)\);/g)].map((m) => m[1]);
    expect(puts.length).toBeGreaterThan(0);
    for (const put of puts) expect(put).not.toMatch(/token|jeton|KEY_FINGERPRINT|computerId/i);
  });
});
