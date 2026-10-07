import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACTIVITIES, GRAVEL_ACTIVITY, VTT_ACTIVITY, activitiesOfFamily, activityCounts, baseActivity, findActivity, insertActivity, newActivityId,
  nextActivityColor, readActivities, sessionActivity, upgradeActivities, type Activity,
} from './activities';

const moth: Activity = { id: 'a-moth', name: 'Moth à foil', base: 'wingfoil', color: '#2e7d32' };
const trail: Activity = { id: 'a-trail', name: 'Trail', base: 'running', color: '#ef6c00' };
const voile = DEFAULT_ACTIVITIES[0];

describe('readActivities', () => {
  it('rend celles du premier lancement quand la liste est absente', () => {
    expect(readActivities(undefined)).toEqual(DEFAULT_ACTIVITIES);
    expect(DEFAULT_ACTIVITIES.map((a) => a.name)).toEqual(['Voile', 'Course', 'Route', 'Gravel', 'VTT']);
    expect(DEFAULT_ACTIVITIES.slice(2).every((a) => a.base === 'cycling')).toBe(true);
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

describe('upgradeActivities', () => {
  const [sail, run, route] = DEFAULT_ACTIVITIES;
  const oldCycling: Activity = { ...route, name: 'Vélo' };

  it('renomme « Vélo » en « Route », même identifiant, et ajoute Gravel et VTT après lui', () => {
    const upgraded = upgradeActivities([sail, run, oldCycling]);
    expect(upgraded).toEqual(DEFAULT_ACTIVITIES);
    expect(upgraded[2].id).toBe('cycling');
  });

  it('range Gravel et VTT après la dernière activité vélo, ou en fin de liste sans activité vélo', () => {
    const upgraded = upgradeActivities([sail, oldCycling, run, trail]);
    expect(upgraded.map((a) => a.name)).toEqual(['Voile', 'Route', 'Gravel', 'VTT', 'Course', 'Trail']);
    expect(upgradeActivities([sail, run]).map((a) => a.name)).toEqual(['Voile', 'Course', 'Gravel', 'VTT']);
  });

  it('garde un nom choisi, et n\'ajoute pas une activité vélo qui existe déjà sous ce nom ou cet identifiant', () => {
    const mine: Activity = { id: 'a-mon-gravel', name: 'gravel', base: 'cycling', color: '#00838f' };
    const upgraded = upgradeActivities([sail, { ...route, name: 'Mon vélo' }, mine, { ...VTT_ACTIVITY, name: 'Enduro' }]);
    expect(upgraded.map((a) => a.name)).toEqual(['Voile', 'Mon vélo', 'gravel', 'Enduro']);
    // Un « Gravel » de course n'empêche pas celui du vélo.
    const runningGravel: Activity = { id: 'a-x', name: 'Gravel', base: 'running', color: '#00838f' };
    expect(upgradeActivities([runningGravel]).map((a) => a.id)).toEqual(['a-x', GRAVEL_ACTIVITY.id, VTT_ACTIVITY.id]);
  });

  it('prend une couleur libre si la sienne est déjà portée', () => {
    const olive: Activity = { ...moth, color: GRAVEL_ACTIVITY.color };
    const gravel = upgradeActivities([olive]).find((a) => a.id === GRAVEL_ACTIVITY.id)!;
    expect(gravel.color).not.toBe(GRAVEL_ACTIVITY.color);
  });

  it('ne change plus rien une fois faite', () => {
    const once = upgradeActivities([sail, oldCycling, run, trail]);
    expect(upgradeActivities(once)).toEqual(once);
  });
});

describe('insertActivity', () => {
  const [sail, run, route, gravel, vtt] = DEFAULT_ACTIVITIES;
  const names = (list: Activity[]) => list.map((a) => a.name);

  it('range une activité après la dernière de sa famille', () => {
    expect(names(insertActivity(DEFAULT_ACTIVITIES, moth))).toEqual(['Voile', 'Moth à foil', 'Course', 'Route', 'Gravel', 'VTT']);
    expect(names(insertActivity(DEFAULT_ACTIVITIES, trail))).toEqual(['Voile', 'Course', 'Trail', 'Route', 'Gravel', 'VTT']);
    const tandem: Activity = { id: 'a-tandem', name: 'Tandem', base: 'cycling', color: '#ad1457' };
    expect(names(insertActivity(DEFAULT_ACTIVITIES, tandem))).toEqual(['Voile', 'Course', 'Route', 'Gravel', 'VTT', 'Tandem']);
  });

  it('sans activité de sa famille, la place avant les familles qui la suivent', () => {
    expect(names(insertActivity([route, gravel, vtt], trail))).toEqual(['Trail', 'Route', 'Gravel', 'VTT']);
    expect(names(insertActivity([run, route], sail))).toEqual(['Voile', 'Course', 'Route']);
    expect(names(insertActivity([sail], vtt))).toEqual(['Voile', 'VTT']);
    expect(names(insertActivity([], moth))).toEqual(['Moth à foil']);
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

  it('range le vélo dans sa propre famille, ni en course ni en voile', () => {
    const gravel: Activity = { id: 'a-gravel', name: 'Gravel', base: 'cycling', color: '#00695c' };
    expect(activitiesOfFamily([voile, trail, gravel], 'velo')).toEqual([gravel]);
    expect(activitiesOfFamily([voile, trail, gravel], 'course')).toEqual([trail]);
    expect(sessionActivity([voile, trail, gravel], null, 'cycling')).toBe(gravel);
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

describe('activityCounts', () => {
  it('compte dans l’ordre donné, puis dans l’ordre d’apparition, sans les activités absentes', () => {
    const kite = baseActivity('kite');
    const counts = activityCounts([moth, null, kite, moth, voile], [voile, trail, moth]);
    expect(counts.map((c) => [c.activity.id, c.count])).toEqual([[voile.id, 1], [moth.id, 2], ['kite', 1]]);
  });
});
