import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTIVITIES, readActivities, type Activity } from './activities';
import { ACTIVITY_ICON_IDS, ACTIVITY_ICON_LABEL, activityIcon, guessActivityIcon, isActivityIconId } from './activityIcons';

const moth: Activity = { id: 'a-moth', name: 'Moth à foil', base: 'wingfoil', color: '#2e7d32' };

describe('icônes des activités', () => {
  it('chaque icône a son libellé', () => {
    expect(ACTIVITY_ICON_IDS).toHaveLength(16);
    expect(ACTIVITY_ICON_IDS.every((id) => ACTIVITY_ICON_LABEL[id].length > 0)).toBe(true);
    expect(isActivityIconId('kayak')).toBe(true);
    expect(isActivityIconId('pétanque')).toBe(false);
    expect(isActivityIconId(3)).toBe(false);
  });

  it('donne la sienne à chaque activité de départ', () => {
    expect(DEFAULT_ACTIVITIES.map(activityIcon)).toEqual([
      'wingfoil', 'course', 'marche', 'route', 'gravel', 'vtt', 'surf', 'surf-foil', 'fractionne-pied', 'fractionne-velo',
    ]);
  });

  it('garde à la Marche de départ son icône quand elle est renommée', () => {
    const marche = DEFAULT_ACTIVITIES.find((a) => a.id === 'a-marche')!;
    expect(activityIcon({ ...marche, name: 'Sortie du dimanche' })).toBe('marche');
  });

  it('devine du nom, du plus précis au plus large', () => {

    expect(guessActivityIcon('Paddle foil', 'surf')).toBe('paddle-foil');
    expect(guessActivityIcon('SUP', 'surf')).toBe('paddle');
    expect(guessActivityIcon('Super session', 'surf')).toBe('surf');
    expect(guessActivityIcon('Kayak de mer', 'surf')).toBe('kayak');
    expect(guessActivityIcon('Randonnée', 'running')).toBe('marche');
    expect(guessActivityIcon('Marche nordique', 'running')).toBe('marche');
    expect(guessActivityIcon('Gravel long', 'cycling')).toBe('gravel');
    expect(guessActivityIcon('Kitefoil', 'wingfoil')).toBe('kite');
    expect(guessActivityIcon('Dériveur', 'wingfoil')).toBe('bateau');
    expect(guessActivityIcon('Wing', 'kite')).toBe('wingfoil');
    expect(guessActivityIcon('Foil', 'surf')).toBe('surf-foil');
    expect(guessActivityIcon(moth.name, moth.base)).toBe('bateau');
  });

  it('se replie sur le calcul quand le nom ne dit rien', () => {
    expect(guessActivityIcon('Trail', 'running')).toBe('course');
    expect(guessActivityIcon('Sortie', 'windsurf')).toBe('planche');
    expect(guessActivityIcon('Foil', 'wingfoil')).toBe('wingfoil');
    expect(guessActivityIcon('10 000 m', 'run-intervals')).toBe('fractionne-pied');
  });

  it('le choix de Réglages prime, et se relit', () => {
    const chosen = { ...moth, icon: 'planche' as const };
    expect(activityIcon(chosen)).toBe('planche');
    const [kept, ignored] = readActivities([chosen, { ...moth, id: 'a-autre', icon: 'pétanque' }]);
    expect(kept).toEqual(chosen);
    expect('icon' in ignored).toBe(false);
  });
});
