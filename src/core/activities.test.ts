import { describe, expect, it } from 'vitest';
import {
  BIKE_INTERVALS_ACTIVITY, DEFAULT_ACTIVITIES, FAMILY_SHADES, GRAVEL_ACTIVITY, RUN_INTERVALS_ACTIVITY, VTT_ACTIVITY, activitiesOfFamily,
  activityCounts, activityFamily, activityTreatment, baseActivity, findActivity, insertActivity, newActivityId, nextActivityColor,
  readActivities, recolorActivities, sessionActivity, upgradeActivities, type Activity,
} from './activities';

const moth: Activity = { id: 'a-moth', name: 'Moth à foil', base: 'wingfoil', color: '#2e7d32' };
const trail: Activity = { id: 'a-trail', name: 'Trail', base: 'running', color: '#ef6c00' };
const voile = DEFAULT_ACTIVITIES[0];

describe('readActivities', () => {
  it('rend celles du premier lancement quand la liste est absente', () => {
    expect(readActivities(undefined)).toEqual(DEFAULT_ACTIVITIES);
    expect(DEFAULT_ACTIVITIES.map((a) => a.name)).toEqual([
      'Voile', 'Course', 'Route', 'Gravel', 'VTT', 'Fractionné à pied', 'Fractionné vélo',
    ]);
    expect(DEFAULT_ACTIVITIES.slice(2, 5).every((a) => a.base === 'cycling')).toBe(true);
    expect(DEFAULT_ACTIVITIES.slice(5).map((a) => a.base)).toEqual(['run-intervals', 'bike-intervals']);
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
  const intervals = [RUN_INTERVALS_ACTIVITY.name, BIKE_INTERVALS_ACTIVITY.name];

  it('renomme « Vélo » en « Route », même identifiant, et ajoute Gravel et VTT après lui, puis le fractionné', () => {
    const upgraded = upgradeActivities([sail, run, oldCycling], 1);
    expect(upgraded).toEqual(DEFAULT_ACTIVITIES);
    expect(upgraded[2].id).toBe('cycling');
  });

  it('range Gravel et VTT après la dernière activité vélo, ou en fin de liste sans activité vélo', () => {
    const upgraded = upgradeActivities([sail, oldCycling, run, trail], 1);
    expect(upgraded.map((a) => a.name)).toEqual(['Voile', 'Route', 'Gravel', 'VTT', 'Course', 'Trail', ...intervals]);
    expect(upgradeActivities([sail, run], 1).map((a) => a.name)).toEqual(['Voile', 'Course', 'Gravel', 'VTT', ...intervals]);
  });

  it('garde un nom choisi, et n\'ajoute pas une activité vélo qui existe déjà sous ce nom ou cet identifiant', () => {
    const mine: Activity = { id: 'a-mon-gravel', name: 'gravel', base: 'cycling', color: '#00838f' };
    const upgraded = upgradeActivities([sail, { ...route, name: 'Mon vélo' }, mine, { ...VTT_ACTIVITY, name: 'Enduro' }], 1);
    expect(upgraded.map((a) => a.name)).toEqual(['Voile', 'Mon vélo', 'gravel', 'Enduro', ...intervals]);
    // Un « Gravel » de course n'empêche pas celui du vélo.
    const runningGravel: Activity = { id: 'a-x', name: 'Gravel', base: 'running', color: '#00838f' };
    expect(upgradeActivities([runningGravel], 1).map((a) => a.id)).toEqual([
      'a-x', GRAVEL_ACTIVITY.id, VTT_ACTIVITY.id, RUN_INTERVALS_ACTIVITY.id, BIKE_INTERVALS_ACTIVITY.id,
    ]);
  });

  it("une liste de la version 2 ne reçoit que le fractionné : Gravel supprimé ne revient pas, « Vélo » n'est plus renommé", () => {
    const mine: Activity = { ...route, name: 'Vélo' };
    const upgraded = upgradeActivities([sail, run, mine, VTT_ACTIVITY], 2);
    expect(upgraded.map((a) => a.name)).toEqual(['Voile', 'Course', 'Vélo', 'VTT', ...intervals]);
  });

  it("n'ajoute pas une activité de fractionné qui existe déjà sous ce nom dans sa famille", () => {
    const mine: Activity = { id: 'a-seance', name: 'fractionné à pied', base: 'bike-intervals', color: '#00838f' };
    expect(upgradeActivities([sail, mine], 2).map((a) => a.id)).toEqual(['wingfoil', 'a-seance', BIKE_INTERVALS_ACTIVITY.id]);
  });

  it('prend une couleur libre si la sienne est déjà portée', () => {
    const olive: Activity = { ...moth, color: GRAVEL_ACTIVITY.color };
    const gravel = upgradeActivities([olive], 1).find((a) => a.id === GRAVEL_ACTIVITY.id)!;
    expect(gravel.color).not.toBe(GRAVEL_ACTIVITY.color);
  });

  it('ne change plus rien une fois faite', () => {
    const once = upgradeActivities([sail, oldCycling, run, trail], 1);
    expect(upgradeActivities(once, 3)).toEqual(once);
  });
});

describe('famille et traitement', () => {
  it('range le fractionné dans sa famille, traité comme la course ou le vélo', () => {
    expect(activityFamily(RUN_INTERVALS_ACTIVITY)).toBe('fractionne');
    expect(activityFamily(BIKE_INTERVALS_ACTIVITY)).toBe('fractionne');
    expect(activityTreatment(RUN_INTERVALS_ACTIVITY)).toBe('course');
    expect(activityTreatment(BIKE_INTERVALS_ACTIVITY)).toBe('velo');
  });

  it('confond famille et traitement pour les autres calculs', () => {
    for (const a of DEFAULT_ACTIVITIES.slice(0, 5)) expect(activityTreatment(a)).toBe(activityFamily(a));
    expect(activityTreatment(moth)).toBe('voile');
  });
});

describe('insertActivity', () => {
  const [sail, run, route, gravel, vtt] = DEFAULT_ACTIVITIES;
  const names = (list: Activity[]) => list.map((a) => a.name);
  const intervals = [RUN_INTERVALS_ACTIVITY.name, BIKE_INTERVALS_ACTIVITY.name];

  it('range une activité après la dernière de sa famille', () => {
    expect(names(insertActivity(DEFAULT_ACTIVITIES, moth))).toEqual(['Voile', 'Moth à foil', 'Course', 'Route', 'Gravel', 'VTT', ...intervals]);
    expect(names(insertActivity(DEFAULT_ACTIVITIES, trail))).toEqual(['Voile', 'Course', 'Trail', 'Route', 'Gravel', 'VTT', ...intervals]);
    const tandem: Activity = { id: 'a-tandem', name: 'Tandem', base: 'cycling', color: '#ad1457' };
    expect(names(insertActivity(DEFAULT_ACTIVITIES, tandem))).toEqual(['Voile', 'Course', 'Route', 'Gravel', 'VTT', 'Tandem', ...intervals]);
    const pyramide: Activity = { id: 'a-pyramide', name: 'Pyramide', base: 'run-intervals', color: '#00838f' };
    expect(names(insertActivity(DEFAULT_ACTIVITIES, pyramide))).toEqual(['Voile', 'Course', 'Route', 'Gravel', 'VTT', ...intervals, 'Pyramide']);
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

  it('propose la première nuance libre de la famille, puis les reprend dans l\'ordre', () => {
    expect(nextActivityColor([voile], 'voile')).toBe(FAMILY_SHADES.voile[1]);
    expect(nextActivityColor([voile], 'course')).toBe(FAMILY_SHADES.course[0]);
    const six = FAMILY_SHADES.velo.map((color, i): Activity => ({ id: `v${i}`, name: `V${i}`, base: 'cycling', color }));
    expect(nextActivityColor(six, 'velo')).toBe(FAMILY_SHADES.velo[0]);
    expect(nextActivityColor([...six, { ...six[0], id: 'v6' }], 'velo')).toBe(FAMILY_SHADES.velo[1]);
  });
});

describe('recolorActivities (version 4)', () => {
  const [sail, run, route, gravel, vtt, pied, velo] = DEFAULT_ACTIVITIES;
  const old = (a: Activity, color: string): Activity => ({ ...a, color });

  it('donne à une liste d\'avant les nuances de chaque famille, dans l\'ordre de la liste', () => {
    const before = [old(sail, '#1565c0'), old(moth, '#2e7d32'), old(run, '#bf360c'), old(route, '#00695c'), old(gravel, '#9e9d24'),
      old(vtt, '#5d4037'), old(pied, '#ad1457'), old(velo, '#ef6c00')];
    expect(recolorActivities(before).map((a) => a.color)).toEqual([
      FAMILY_SHADES.voile[0], FAMILY_SHADES.voile[1], FAMILY_SHADES.course[0], FAMILY_SHADES.velo[0], FAMILY_SHADES.velo[1],
      FAMILY_SHADES.velo[2], FAMILY_SHADES.fractionne[0], FAMILY_SHADES.fractionne[1],
    ]);
  });

  it('garde une nuance déjà juste, et recolore un doublon ou la nuance d\'une autre famille', () => {
    const kept = old(moth, FAMILY_SHADES.voile[0]);
    const twin = old(sail, FAMILY_SHADES.voile[0]);
    const foreign = old(trail, FAMILY_SHADES.voile[2]);
    expect(recolorActivities([twin, kept, foreign]).map((a) => a.color)).toEqual([
      FAMILY_SHADES.voile[0], FAMILY_SHADES.voile[1], FAMILY_SHADES.course[0],
    ]);
    // Une nuance juste plus bas dans la liste reste à son activité.
    const later = old(moth, FAMILY_SHADES.voile[0]);
    expect(recolorActivities([old(sail, '#123456'), later]).map((a) => a.color)).toEqual([FAMILY_SHADES.voile[1], FAMILY_SHADES.voile[0]]);
  });

  it('ne change rien à une liste déjà juste', () => {
    expect(recolorActivities(DEFAULT_ACTIVITIES)).toEqual(DEFAULT_ACTIVITIES);
  });

  it('passe par upgradeActivities pour une liste de la version 3', () => {
    expect(upgradeActivities([old(sail, '#1565c0'), old(run, '#bf360c')], 3).map((a) => a.color)).toEqual([
      FAMILY_SHADES.voile[0], FAMILY_SHADES.course[0],
    ]);
  });
});

describe('activityCounts', () => {
  it('compte dans l’ordre donné, puis dans l’ordre d’apparition, sans les activités absentes', () => {
    const kite = baseActivity('kite');
    const counts = activityCounts([moth, null, kite, moth, voile], [voile, trail, moth]);
    expect(counts.map((c) => [c.activity.id, c.count])).toEqual([[voile.id, 1], [moth.id, 2], ['kite', 1]]);
  });
});
