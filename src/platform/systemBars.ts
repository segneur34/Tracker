import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import { isNativeApp } from './runtime';

/**
 * Icônes des barres système (heure, batterie, navigation) : claires sur un
 * fond sombre, sombres sur un fond clair. La page ne passe pas sous les barres
 * (pas de `viewport-fit=cover`) : le fond derrière elles est celui du
 * téléphone (`tracker_colors.xml`, qui suit son mode clair ou sombre), donc
 * `dark` est le mode du téléphone et non le thème de l'appli
 * (`hooks/useTheme.ts`, lot 158). Sur le téléphone, par le greffon SystemBars de
 * Capacitor, compris dans `@capacitor/core` ; dans le navigateur, rien : la
 * barre suit `<meta name="theme-color">`.
 */
export const setSystemBarsDark = (dark: boolean): void => {
  if (!isNativeApp()) return;
  SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {
    // Barres inchangées : rien ne doit gêner l'interface.
  });
};
