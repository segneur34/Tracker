/**
 * Boussole du téléphone : le cap vers lequel pointe le haut de l'écran, en
 * degrés depuis le nord, sens horaire. Lue sur l'événement
 * `deviceorientationabsolute`, que la WebView Android fournit sans plugin ;
 * absent (ordinateur), rien n'est appelé. Seul point d'accès autorisé à
 * l'orientation de l'appareil (règle 12).
 */

/** Intervalle minimal entre deux caps transmis, en millisecondes. */
const MIN_INTERVAL_MS = 200;

/** Écoute la boussole ; rend la fonction qui arrête l'écoute. */
export const watchCompassHeading = (onHeading: (headingDeg: number) => void): (() => void) => {
  if (typeof window === 'undefined' || !('ondeviceorientationabsolute' in window)) return () => {};
  let lastMs = 0;
  const handler = (event: DeviceOrientationEvent) => {
    if (event.alpha === null) return;
    const now = Date.now();
    if (now - lastMs < MIN_INTERVAL_MS) return;
    lastMs = now;
    // `alpha` tourne dans le sens trigonométrique depuis le nord ; l'écran peut être tourné.
    const screenAngle = window.screen.orientation?.angle ?? 0;
    onHeading((((360 - event.alpha + screenAngle) % 360) + 360) % 360);
  };
  window.addEventListener('deviceorientationabsolute', handler);
  return () => window.removeEventListener('deviceorientationabsolute', handler);
};
