import { describe, expect, it } from 'vitest';
import { MAX_LISTED_FILE_BYTES } from '../library/reconcile';

/**
 * Ce que le code Android de l'application suppose des greffons, sans moyen de
 * le lire autrement que dans leur source : une mise à jour qui le changerait
 * casserait la sortie écran éteint sans erreur de compilation (lot 156).
 *
 * - `RecordingNotificationPlugin.java` recopie le numéro et le canal de la
 *   notification du service GPS, constantes privées du greffon.
 * - La veille du GPS (`BeeperPlugin.java`) et la capture (`MotionPlugin.java`)
 *   n'ont pas de verrou de veille : elles comptent sur celui du service GPS,
 *   sans échéance, pris au démarrage, que le chien de garde ne rend pas.
 * - `IncomingFilePlugin.java` lit l'intention de départ dans `handleOnNewIntent`, parce que `BridgeActivity` l'y passe
 *   lui-même au démarrage (lot 35).
 * - La reprise après une chute du moteur de la WebView passe par
 *   `window.Capacitor.fromNative`, qui reçoit les réponses des greffons
 *   (`adoptRunningService`), et compte sur l'appel gardé du greffon.
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

const GPS_SERVICE = packageSource(
  '@capgo/background-geolocation/android/src/main/java/com/capgo/capacitor_background_geolocation/BackgroundGeolocationService.java'
);
const MESSAGE_HANDLER = packageSource('@capacitor/android/capacitor/src/main/java/com/getcapacitor/MessageHandler.java');
const RECORDING_NOTIFICATION = appJava('RecordingNotificationPlugin.java');
const GPS_PLUGIN = packageSource(
  '@capgo/background-geolocation/android/src/main/java/com/capgo/capacitor_background_geolocation/BackgroundGeolocation.java'
);
const BRIDGE = packageSource('@capacitor/android/capacitor/src/main/java/com/getcapacitor/Bridge.java');
const BRIDGE_ACTIVITY = packageSource('@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeActivity.java');
const WEBVIEW_LISTENER = packageSource('@capacitor/android/capacitor/src/main/java/com/getcapacitor/WebViewListener.java');
const NATIVE_BRIDGE = packageSource('@capacitor/android/capacitor/src/main/assets/native-bridge.js');
const MAIN_ACTIVITY = appJava('MainActivity.java');
const RECOVERY_PLUGIN = appJava('RecoveryPlugin.java');
const INCOMING_PLUGIN = appJava('IncomingFilePlugin.java');

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

describe('notification du service GPS, recopiée du greffon', () => {
  it('même numéro', () => {
    expect(captured(RECORDING_NOTIFICATION, /\bNOTIFICATION_ID = (\d+);/))
      .toBe(captured(GPS_SERVICE, /\bNOTIFICATION_ID = (\d+);/));
  });

  it('même canal : le greffon le nomme de son paquet, pas par un texte', () => {
    expect(GPS_SERVICE).toContain('NOTIFICATION_CHANNEL_ID = BackgroundGeolocationService.class.getPackage().getName();');
    expect(captured(RECORDING_NOTIFICATION, /\bCHANNEL_ID = "([^"]+)";/))
      .toBe(captured(GPS_SERVICE, /^package ([\w.]+);/m));
  });
});

describe('verrou de veille du service GPS, seul à tenir le processeur pendant une sortie', () => {
  it('pris au démarrage du service', () => {
    expect(between(GPS_SERVICE, 'void start(', 'void updateHeaders(')).toContain('acquireWakeLock();');
  });

  it("sans échéance : il dure ce que dure le service, et le chien de garde des 60 s ne le rend pas", () => {
    expect(between(GPS_SERVICE, 'private void acquireWakeLock()', 'private void releaseWakeLock()')).toContain('wakeLock.acquire();');
    expect(between(GPS_SERVICE, 'private void restartLocationUpdates()', 'private void stopWatchdog()')).not.toContain('releaseWakeLock');
  });
});

describe('pont de Capacitor', () => {
  it('les réponses des greffons entrent dans la page par window.Capacitor.fromNative', () => {
    expect(MESSAGE_HANDLER).toContain('window.Capacitor.fromNative(');
    expect(NATIVE_BRIDGE).toContain('cap.fromNative = (result) =>');
  });

  it("seule voie, sur l'ancien pont : le nouveau passerait par un autre chemin, sans fromNative", () => {
    const config = fs.readFileSync(new URL('../../capacitor.config.ts', import.meta.url), 'utf8');
    expect(config).toContain('useLegacyBridge: true');
    expect(between(MESSAGE_HANDLER, 'sendResponseMessage(', 'private void legacySendResponseMessage')).toContain('isUsingLegacyBridge()');
  });

  it('un message dit son greffon, sa méthode, et si son appel reste gardé', () => {
    const response = between(MESSAGE_HANDLER, 'sendResponseMessage(', 'private void legacySendResponseMessage');
    expect(response).toContain('data.put("save", call.isKeptAlive());');
    expect(response).toContain('data.put("pluginId", call.getPluginId());');
    expect(response).toContain('data.put("methodName", call.getMethodName());');
    expect(GPS_PLUGIN).toContain('name = "BackgroundGeolocation"');
  });
});

describe('chute du moteur de rendu', () => {
  it("l'appel gardé du greffon survit à la recharge : `start` le garde, et une position le répond", () => {
    expect(between(GPS_PLUGIN, 'public void start(final PluginCall call)', 'private void proceedWithStart')).toContain('watchCall = call;');
    expect(between(GPS_PLUGIN, 'public void onLocation(', 'public void onGeofenceTransition(')).toContain('call.resolve(formatLocation(location));');
  });

  it("recréer l'activité arrête le service GPS : c'est pourquoi la page se recharge sur la même WebView", () => {
    expect(between(GPS_PLUGIN, 'protected void handleOnDestroy()', 'super.handleOnDestroy();')).toContain('BackgroundGeolocationService.LocalBinder::stop');
    expect(BRIDGE).toContain('private final WebView webView;');
  });

  it('le service GPS ne redémarre pas seul hors du mode natif : le voir vivant prouve le processus', () => {
    expect(GPS_SERVICE).toContain('return START_NOT_STICKY;');
  });

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

  it('le greffon de la preuve est déclaré, et nomme le service tel que le greffon GPS le déclare', () => {
    expect(MAIN_ACTIVITY).toContain('registerPlugin(RecoveryPlugin.class);');
    const named = captured(RECOVERY_PLUGIN, /\bGPS_SERVICE = "([^"]+)";/);
    expect(named).toBe(`${captured(GPS_SERVICE, /^package ([\w.]+);/m)}.BackgroundGeolocationService`);
    expect(GPS_SERVICE).toContain('class BackgroundGeolocationService extends Service');
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
