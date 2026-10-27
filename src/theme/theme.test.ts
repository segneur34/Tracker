import { describe, expect, it } from 'vitest';
import { THEME_CHOICES, THEME_DEFAULT, THEME_STORAGE_KEY, parseThemeSettings, resolveTheme, sameAppliedTheme } from './theme';

describe('thème', () => {
  it('départ : Auto, sans Économe, sous la clé de l\'appareil', () => {
    expect(THEME_DEFAULT).toEqual({ choice: 'auto', eco: false });
    expect(THEME_STORAGE_KEY).toBe('tracker.theme');
    expect(parseThemeSettings(null)).toEqual(THEME_DEFAULT);
    expect(THEME_CHOICES.map((c) => c.label)).toEqual(['Clair', 'Sombre', 'Auto']);
  });

  it('une valeur abîmée retombe champ par champ sur le défaut', () => {
    expect(parseThemeSettings('sombre')).toEqual(THEME_DEFAULT);
    expect(parseThemeSettings({ choice: 'noir', eco: 'oui' })).toEqual(THEME_DEFAULT);
    expect(parseThemeSettings({ choice: 'sombre' })).toEqual({ choice: 'sombre', eco: false });
    expect(parseThemeSettings({ eco: true })).toEqual({ choice: 'auto', eco: true });
  });

  it('Auto suit le système, Clair et Sombre non', () => {
    expect(resolveTheme({ choice: 'auto', eco: false }, true)).toEqual({ theme: 'dark', eco: false });
    expect(resolveTheme({ choice: 'auto', eco: false }, false)).toEqual({ theme: 'light', eco: false });
    expect(resolveTheme({ choice: 'clair', eco: false }, true)).toEqual({ theme: 'light', eco: false });
    expect(resolveTheme({ choice: 'sombre', eco: false }, false)).toEqual({ theme: 'dark', eco: false });
  });

  it('Économe prime : sombre quel que soit le choix et le système', () => {
    for (const choice of ['clair', 'sombre', 'auto'] as const) {
      for (const systemDark of [false, true]) {
        expect(resolveTheme({ choice, eco: true }, systemDark)).toEqual({ theme: 'dark', eco: true });
      }
    }
  });

  it('égalité de deux thèmes posés', () => {
    expect(sameAppliedTheme({ theme: 'dark', eco: true }, { theme: 'dark', eco: true })).toBe(true);
    expect(sameAppliedTheme({ theme: 'dark', eco: true }, { theme: 'dark', eco: false })).toBe(false);
  });
});
