import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACTIVITIES, activitiesOfFamily, baseActivity, findActivity, newActivityId, nextActivityColor, readActivities,
  sessionActivity, type Activity,
} from './activities';

const moth: Activity = { id: 'a-moth', name: 'Moth à foil', base: 'wingfoil', color: '#2e7d32' };
const trail: Activity = { id: 'a-trail', name: 'Trail', base: 'running', color: '#ef6c00' };
const voile = DEFAULT_ACTIVITIES[0];

describe('readActivities', () => {
  it('rend celles du premier lancement quand la liste est absente', () => {
    expect(readActivities(undefined)).toEqual(DEFAULT_ACTIVITIES);
    expect(DEFAULT_ACTIVITIES.map((a) => a.name)).toEqual(['Voile', 'Course']);
  });

  it('garde une liste vide, écarte les entrées abîmées et les doublons', () => {
    expect(readActivities([])).toEqual([]);
    const list = readActivities([
      moth,
      { ...moth, name: 'Doublon' },
      { id: 'x', name: '  ', base: 'kite' },
      { id: 'y', name: 'Inconnu', base: 'parapente' },
      { id: 'z', name: ' Kite ', base: 'kite', color: 'rouge' },
    ]);
    expect(list).toEqual([moth, { id: 'z', name: 'Kite', base: 'kite', color: baseActivity('kite').color }]);
  });
});

describe('sessionActivity', () => {
  const activities = [voile, moth, trail];

  it("prend l'activité désignée par la fiche", () => {
    expect(sessionActivity(activities, 'a-moth', 'wingfoil')).toBe(moth);
  });

  it("une activité supprimée laisse la session sous le nom de son calcul", () => {
    expect(sessionActivity(activities, 'a-supprimee', 'wingfoil')).toEqual(baseActivity('wingfoil'));
  });

  it("une fiche sans activité va à l'activité de même identifiant que son calcul, sinon à la première de ce calcul", () => {
    expect(sessionActivity(activities, null, 'wingfoil')).toBe(voile);
    expect(sessionActivity([moth, trail], undefined, 'running')).toBe(trail);
    expect(sessionActivity(activities, null, 'kite')).toEqual(baseActivity('kite'));
  });

  it('rend null pour une session à classer', () => {
    expect(sessionActivity(activities, 'a-moth', null)).toBeNull();
  });

  it("n'accepte pas une activité d'un autre calcul", () => {
    expect(sessionActivity(activities, 'a-trail', 'wingfoil')).toEqual(baseActivity('wingfoil'));
  });
});

describe('findActivity et activitiesOfFamily', () => {
  it("retrouve une activité, ou l'activité de base d'un calcul", () => {
    expect(findActivity([moth], 'a-moth')).toBe(moth);
    expect(findActivity([moth], 'bateau')).toEqual(baseActivity('bateau'));
    expect(findActivity([moth], 'a-inconnue')).toBeNull();
    expect(findActivity([moth], null)).toBeNull();
  });

  it('range par famille', () => {
    expect(activitiesOfFamily([voile, moth, trail], 'voile')).toEqual([voile, moth]);
    expect(activitiesOfFamily([voile, moth, trail], 'course')).toEqual([trail]);
  });
});

describe('newActivityId et nextActivityColor', () => {
  it('tire un identifiant unique du nom, jamais celui d\'un calcul', () => {
    expect(newActivityId('Moth à foil', [])).toBe('a-moth-a-foil');
    expect(newActivityId('Moth à foil', [{ ...moth, id: 'a-moth-a-foil' }])).toBe('a-moth-a-foil-2');
    expect(newActivityId('Kite', [])).toBe('a-kite');
    expect(newActivityId('10 000 m', [])).toBe('a-10-000-m');
    expect(newActivityId('!!!', [])).toBe('a-activite');
  });

  it('propose une couleur libre', () => {
    expect(nextActivityColor([voile])).not.toBe(voile.color);
  });
});
