import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import { isNativeApp } from './runtime';

/**
 * Icônes des barres système (heure, batterie, navigation) : claires sur le
 * thème sombre, sombres sur le clair (`hooks/useTheme.ts`). Le fond derrière
 * elles est celui de la page, qui passe sous les barres (marges en
 * `--safe-area-inset-*`). Sur le téléphone, par le greffon SystemBars de
 * Capacitor, compris dans `@capacitor/core` ; dans le navigateur, rien : la
 * barre suit `<meta name="theme-color">`.
 */
export const setSystemBarsDark = (dark: boolean): void => {
  if (!isNativeApp()) return;
  SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {
    // Barres inchangées : rien ne doit gêner l'interface.
  });
};
