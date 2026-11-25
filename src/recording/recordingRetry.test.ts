import { describe, expect, it } from 'vitest';
import {
  beltRetryOffer, beltRetryUnderAlert, gpsRetryOffer, warmupRetryShown, type BeltRetryInput, type GpsRetryInput,
} from './recordingRetry';
import type { BeltState } from '../platform/heartRate';

const input = (patch: Partial<BeltRetryInput>): BeltRetryInput => ({
  active: true,
  withPositions: true,
  heartRate: { state: 'connected' },
  beltLost: false,
  beltAside: null,
  ...patch,
});

const NONE = { retry: false, stop: false, retake: false };
const RETRY_AND_STOP = { retry: true, stop: true, retake: false };
const STOP_ONLY = { retry: false, stop: true, retake: false };
const RETRY_ONLY = { retry: true, stop: false, retake: false };

describe('boutons de la ceinture pendant l’enregistrement', () => {
  it('ceinture qui mesure : rien', () => {
    expect(beltRetryOffer(input({}))).toEqual(NONE);
  });

  it.each<BeltState>(['connecting', 'searching', 'lost', 'off'])('ceinture tenue pas jointe (%s) : réessayer et arrêter de chercher', (state) => {
    expect(beltRetryOffer(input({ heartRate: { state } }))).toEqual(RETRY_AND_STOP);
  });

  it('jointe sans mesure, alerte de FC perdue : arrêter de chercher seulement, aussi sous l’alerte rouge', () => {
    expect(beltRetryOffer(input({ beltLost: true }))).toEqual(STOP_ONLY);
    expect(beltRetryUnderAlert(input({ beltLost: true }))).toBe(true);
  });

  it('appareil sans fréquence cardiaque : arrêter de chercher seulement', () => {
    expect(beltRetryOffer(input({ heartRate: { state: 'unsupported' } }))).toEqual(STOP_ONLY);
  });

  it('injoignable au départ : réessayer et arrêter de chercher, aussi sous l’alerte rouge', () => {
    const failed = input({ heartRate: null, beltAside: 'failed' });
    expect(beltRetryOffer(failed)).toEqual(RETRY_AND_STOP);
    expect(beltRetryUnderAlert(failed)).toBe(true);
  });

  it('après « Arrêter de chercher » : reprendre la ceinture, et plus rien sous l’alerte', () => {
    const stopped = input({ heartRate: null, beltAside: 'stopped' });
    expect(beltRetryOffer(stopped)).toEqual({ retry: false, stop: false, retake: true });
    expect(beltRetryUnderAlert(stopped)).toBe(false);
  });

  it('sans ceinture : rien', () => {
    expect(beltRetryOffer(input({ heartRate: null }))).toEqual(NONE);
    expect(beltRetryUnderAlert(input({ heartRate: null }))).toBe(false);
  });

  it('sans position (muscu, FC de nuit) : « Réessayer » seulement, ceinture pas jointe ; jamais d’abandon', () => {
    expect(beltRetryOffer(input({ withPositions: false, heartRate: { state: 'searching' } }))).toEqual(RETRY_ONLY);
    expect(beltRetryOffer(input({ withPositions: false, heartRate: { state: 'lost' } }))).toEqual(RETRY_ONLY);
    expect(beltRetryOffer(input({ withPositions: false, beltLost: true }))).toEqual(NONE);
    expect(beltRetryUnderAlert(input({ withPositions: false, beltLost: true }))).toBe(false);
    expect(beltRetryOffer(input({ withPositions: false, heartRate: null }))).toEqual(NONE);
  });

  it('hors enregistrement (démarrage, arrêt, repos) : rien, même ceinture perdue ou laissée', () => {
    for (const patch of [{ heartRate: { state: 'lost' as const } }, { beltAside: 'failed' as const }, { beltAside: 'stopped' as const }, { beltLost: true }]) {
      expect(beltRetryOffer(input({ ...patch, active: false }))).toEqual(NONE);
      expect(beltRetryUnderAlert(input({ ...patch, active: false }))).toBe(false);
    }
  });
});

describe('boutons du GPS pendant l’enregistrement', () => {
  const gps = (patch: Partial<GpsRetryInput>): GpsRetryInput => ({
    active: true, manualPause: false, awaitingFix: false, settling: false, gpsLost: false, locationOff: false, ...patch,
  });
  const NO_GPS = { retry: false, openSettings: false, underAlert: false, waiting: false, settling: false };

  it('positions reçues : rien', () => {
    expect(gpsRetryOffer(gps({}))).toEqual(NO_GPS);
  });

  it('aucune position depuis le départ : « Réessayer » sous la ligne d’état, avec l’attente écrite', () => {
    expect(gpsRetryOffer(gps({ awaitingFix: true }))).toEqual({ ...NO_GPS, retry: true, waiting: true });
  });

  it('GPS qui se cale (lot 232) : le calage écrit sous la ligne d’état, sans « Réessayer »', () => {
    expect(gpsRetryOffer(gps({ settling: true }))).toEqual({ ...NO_GPS, settling: true });
  });

  it('une seule ligne à la fois : l’attente, le GPS perdu et la localisation coupée priment sur le calage', () => {
    expect(gpsRetryOffer(gps({ settling: true, awaitingFix: true }))).toEqual({ ...NO_GPS, retry: true, waiting: true });
    expect(gpsRetryOffer(gps({ settling: true, gpsLost: true }))).toEqual({ ...NO_GPS, retry: true, underAlert: true });
    expect(gpsRetryOffer(gps({ settling: true, locationOff: true }))).toEqual({ ...NO_GPS, openSettings: true, underAlert: true });
  });

  it('GPS qui se cale en pause manuelle : rien d’écrit', () => {
    expect(gpsRetryOffer(gps({ settling: true, manualPause: true }))).toEqual(NO_GPS);
  });

  it('GPS perdu : « Réessayer » sous l’alerte rouge', () => {
    expect(gpsRetryOffer(gps({ gpsLost: true }))).toEqual({ ...NO_GPS, retry: true, underAlert: true });
  });

  it('localisation coupée : le réglage d’Android sous l’alerte, à la place de « Réessayer », pause manuelle comprise', () => {
    const off = { ...NO_GPS, openSettings: true, underAlert: true };
    expect(gpsRetryOffer(gps({ locationOff: true, awaitingFix: true }))).toEqual(off);
    expect(gpsRetryOffer(gps({ locationOff: true, manualPause: true }))).toEqual(off);
  });

  it('pause manuelle : pas de « Réessayer », même GPS perdu ou sans position', () => {
    expect(gpsRetryOffer(gps({ manualPause: true, gpsLost: true, awaitingFix: true })).retry).toBe(false);
  });

  it('hors enregistrement : rien', () => {
    expect(gpsRetryOffer(gps({ active: false, awaitingFix: true, settling: true, gpsLost: true, locationOff: true }))).toEqual(NO_GPS);
  });
});

describe('« Réessayer » avant le départ', () => {
  it('après un échec, ou pendant que la ceinture est cherchée ; pas une fois connectée', () => {
    expect(warmupRetryShown('off', true)).toBe(true);
    expect(warmupRetryShown('connecting', false)).toBe(true);
    expect(warmupRetryShown('searching', false)).toBe(true);
    expect(warmupRetryShown('lost', false)).toBe(true);
    expect(warmupRetryShown('connected', false)).toBe(false);
    expect(warmupRetryShown('off', false)).toBe(false);
    expect(warmupRetryShown('unsupported', false)).toBe(false);
  });
});
