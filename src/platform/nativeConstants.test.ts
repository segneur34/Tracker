import { describe, expect, it } from 'vitest';

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
 * - La reprise après une chute du moteur de la WebView passera par
 *   `window.Capacitor.fromNative`, qui reçoit les réponses des greffons.
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
  });
});
