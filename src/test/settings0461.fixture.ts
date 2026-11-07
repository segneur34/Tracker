import type { Activity } from '../core/activities';
import type { StoredSettings } from '../settings/activitySettings';

/** Fichier de test seulement : le code de l'application ne l'importe pas. */

/**
 * Réglages d'un appareil de la version 0.4.61 (commit 5469959, liste d'activités en version 9, pré-réglages en
 * version 3) tenu à la main par un pratiquant de voile et de surf : les activités à terre supprimées, leurs familles
 * cachées, quatre activités réglées une à une. Toutes les valeurs sont volontairement à l'écart des pré-réglages,
 * pour qu'un effacement se voie. Sert à la garde du lot 187 (fiche 154, risque 1) : les montées de version ne
 * doivent rien y changer, hors ce qui est écrit dans le test.
 */

export const WING_0461: Activity = { id: 'wingfoil', name: 'Voile', base: 'wingfoil', color: '#004aad' };
export const KITE_0461: Activity = { id: 'a-kite', name: 'Kite', base: 'kite', color: '#2f6fd1' };
export const SURF_0461: Activity = { id: 'surf', name: 'Surf', base: 'surf', color: '#5c6b73' };
export const SURF_FOIL_0461: Activity = { id: 'a-surf-foil', name: 'Surf foil', base: 'surf', color: '#8a9ba5' };

export const ACTIVITIES_0461: Activity[] = [WING_0461, KITE_0461, SURF_0461, SURF_FOIL_0461];

/** Les réglages, tels que `tracker.sportSettings` les gardait ; `presetsVersion` à 3. */
export const settings0461 = (): StoredSettings => ({
  sport: 'kite',
  moduleActivity: { voile: 'a-kite', surf: 'a-surf-foil' },
  recordActivity: 'wingfoil',
  activities: ACTIVITIES_0461.map((a) => ({ ...a })),
  activitiesVersion: 9,
  presetsVersion: 3,
  hiddenFamilies: ['course', 'velo', 'fractionne'],
  thresholds: { wingfoil: 9, 'a-kite': 7, surf: 0, 'a-surf-foil': 2 },
  speedUnits: { wingfoil: 'kn', 'a-kite': 'kmh', surf: 'kmh', 'a-surf-foil': 'kn' },
  distanceUnits: { wingfoil: 'nm', 'a-kite': 'km' },
  speedRanges: { wingfoil: { minMs: 4.1, maxMs: 12.3 }, 'a-kite': { minMs: 5, maxMs: 15 }, surf: { minMs: 1, maxMs: 7 } },
  autoPause: { wingfoil: { speedMs: 0.5, delayS: 45 }, 'a-kite': { speedMs: 0.3, delayS: 90 } },
  liveFields: { wingfoil: ['speed', 'average', 'recentTopLong', 'legAverage'], 'a-kite': ['speed', 'heading'], surf: ['speed', 'distance', 'duration'] },
  notificationFields: { wingfoil: ['speed', 'distance'], 'a-surf-foil': ['duration'] },
  markGuide: {
    wingfoil: { curve: [{ distanceM: 40, intervalMs: 200 }, { distanceM: 120, intervalMs: 800 }], vibrate: false },
    surf: { curve: [{ distanceM: 30, intervalMs: 300 }], vibrate: true },
  },
  foils: { wingfoil: true, 'a-kite': false, surf: false, 'a-surf-foil': true },
  pumping: { wingfoil: true, 'a-surf-foil': true },
  turns: { surf: false, 'a-surf-foil': true },
  jumps: { wingfoil: { enabled: true, placement: 'taille', minHeightM: 0.4 }, 'a-kite': { enabled: false, placement: 'dos', minHeightM: 1.2 } },
  heartRate: { wingfoil: true, 'a-kite': true },
  hrOffsets: { wingfoil: -6, surf: -3 },
  tabs: { wingfoil: { sauts: true, pumping: false }, 'a-kite': { vmg: false }, surf: { rame: false }, 'a-surf-foil': { pumping: true } },
  gearGroups: {
    wingfoil: [{ id: 'g1', name: 'Ailes', items: [{ id: 'i1', name: '5 m²' }, { id: 'i2', name: '4 m²' }] }],
    'a-surf-foil': [{ id: 'g2', name: 'Foils', items: [{ id: 'i3', name: '1 200 cm²' }] }],
  },
  longPressMs: 1500,
  stopHoldMs: 0,
  beepSound: 'grave',
});
