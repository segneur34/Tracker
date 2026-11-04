import { describe, expect, it } from 'vitest';
import { getSportProfile } from '../core/sportProfiles';
import { resolveSailingThresholds } from '../sailing/sailingConfig';
import { sessionRecord } from '../test/record.fixture';
import { sailingActivityThresholds } from './useSailingSession';

/**
 * Le calcul pur de `useSailingSession` qui reste au hook : le seuil de
 * l'appareil et celui de l'activité que la fiche porte (Q57), avant
 * `resolveSailingThresholds`. Le reste de la chaîne est testé hors React,
 * dans `sailing/sailingSession.test.ts`.
 */

const overridden = { isThresholdOverridden: true, activeThresholdKn: 11, foil: false };
const notOverridden = { isThresholdOverridden: false, activeThresholdKn: 8, foil: false };

describe('sailingActivityThresholds', () => {
  it('sans fiche : le seuil réglé sur l’appareil, ou aucun', () => {
    expect(sailingActivityThresholds(null, overridden)).toEqual({ deviceThresholdKn: 11, activityThresholdKn: 11 });
    // Le seuil d'un appareil sans réglage n'est que le défaut du profil : il ne compte pas, la suggestion le remplace.
    expect(sailingActivityThresholds(null, notOverridden)).toEqual({ deviceThresholdKn: null, activityThresholdKn: null });
  });

  it('fiche sans seuil porté : celui de l’appareil', () => {
    expect(sailingActivityThresholds(sessionRecord({ sport: 'wingfoil' }), overridden)).toEqual({ deviceThresholdKn: 11, activityThresholdKn: 11 });
  });

  it('fiche qui porte le seuil de son activité : il prime sur l’appareil, qui reste rendu pour la comparaison', () => {
    const record = sessionRecord({ sport: 'wingfoil' }, { activitySettings: { threshold: 7 } });
    expect(sailingActivityThresholds(record, overridden)).toEqual({ deviceThresholdKn: 11, activityThresholdKn: 7 });
    expect(sailingActivityThresholds(record, notOverridden)).toEqual({ deviceThresholdKn: null, activityThresholdKn: 7 });
  });

  it('fiche qui porte « aucun seuil » : ni celui de l’appareil, ni un autre', () => {
    const record = sessionRecord({ sport: 'wingfoil' }, { activitySettings: { threshold: null } });
    expect(sailingActivityThresholds(record, overridden)).toEqual({ deviceThresholdKn: 11, activityThresholdKn: null });
  });

  it('enchaîné à `resolveSailingThresholds` : session, puis fiche, puis appareil, puis suggestion', () => {
    const profile = getSportProfile('wingfoil');
    const referenceKn = 16;
    const carried = sessionRecord({ sport: 'wingfoil' }, { activitySettings: { threshold: 7 } });
    const resolve = (record: typeof carried | null, device: typeof overridden, sessionKn: number | null) =>
      resolveSailingThresholds(profile, sailingActivityThresholds(record, device).activityThresholdKn, sessionKn, referenceKn).activeKn;
    expect(resolve(carried, overridden, 6)).toBe(6);
    expect(resolve(carried, overridden, null)).toBe(7);
    expect(resolve(null, overridden, null)).toBe(11);
    expect(resolve(null, notOverridden, null)).toBe(profile.defaultActiveThreshold);
  });
});
