/**
 * Conversions d'unités. Le noyau travaille en m/s, l'affichage se fait ici.
 */

export const MS_TO_KNOTS = 1.94384;
export const MS_TO_KMH = 3.6;

/** Unité dans laquelle une vitesse est présentée à l'utilisateur. */
export type SpeedUnit = 'kn' | 'kmh' | 'ms' | 'minkm';

export const msToKnots = (ms: number): number => ms * MS_TO_KNOTS;
export const knotsToMs = (kn: number): number => kn / MS_TO_KNOTS;

export const msToKmh = (ms: number): number => ms * MS_TO_KMH;
export const kmhToMs = (kmh: number): number => kmh / MS_TO_KMH;

/**
 * Allure en minutes par kilomètre. Grandeur inverse de la vitesse : elle tend
 * vers l'infini à l'arrêt, d'où le `null` en dessous d'un seuil de mouvement.
 */
export const msToPacePerKm = (ms: number, minSpeedMs = 0.1): number | null => {
  if (ms <= minSpeedMs) return null;
  return 1000 / ms / 60;
};

/** Formate une allure en `m:ss`, ou `-` si la vitesse est trop faible. */
export const formatPace = (ms: number): string => {
  const pace = msToPacePerKm(ms);
  if (pace === null || !isFinite(pace)) return '-';
  const min = Math.floor(pace);
  const sec = Math.round((pace - min) * 60);
  return sec === 60 ? `${min + 1}:00` : `${min}:${sec.toString().padStart(2, '0')}`;
};

/** Convertit une vitesse en m/s vers une unité d'affichage. */
export const toDisplaySpeed = (ms: number, unit: SpeedUnit): number => {
  switch (unit) {
    case 'kn':
      return msToKnots(ms);
    case 'kmh':
      return msToKmh(ms);
    case 'ms':
      return ms;
    case 'minkm':
      return msToPacePerKm(ms) ?? 0;
  }
};

/** Convertit une vitesse saisie dans une unité d'affichage vers des m/s. */
export const fromDisplaySpeed = (value: number, unit: SpeedUnit): number => {
  switch (unit) {
    case 'kn':
      return knotsToMs(value);
    case 'kmh':
      return kmhToMs(value);
    case 'ms':
      return value;
    case 'minkm':
      return value > 0 ? 1000 / (value * 60) : 0;
  }
};

export const SPEED_UNIT_LABEL: Record<SpeedUnit, string> = {
  kn: 'nœuds',
  kmh: 'km/h',
  ms: 'm/s',
  minkm: 'min/km',
};

/** Symbole court, accolé à une valeur (« 12.4 nds »). */
export const SPEED_UNIT_SYMBOL: Record<SpeedUnit, string> = {
  kn: 'nds',
  kmh: 'km/h',
  ms: 'm/s',
  minkm: '/km',
};

/** Vrai si, dans cette unité, une valeur plus grande signifie plus lent. */
export const isInverseUnit = (unit: SpeedUnit): boolean => unit === 'minkm';

/** Formate une vitesse en m/s dans l'unité choisie, avec son symbole. */
export const formatSpeed = (ms: number | null, unit: SpeedUnit): string => {
  if (ms === null || !isFinite(ms)) return '-';
  switch (unit) {
    case 'kn':
      return `${msToKnots(ms).toFixed(1)} nds`;
    case 'kmh':
      return `${msToKmh(ms).toFixed(1)} km/h`;
    case 'ms':
      return `${ms.toFixed(2)} m/s`;
    case 'minkm':
      return `${formatPace(ms)} /km`;
  }
};

/** Formate une valeur déjà exprimée dans l'unité, pour les axes de graphe. */
export const formatSpeedValue = (value: number, unit: SpeedUnit): string => {
  if (!isFinite(value)) return '-';
  if (unit === 'minkm') {
    const min = Math.floor(value);
    const sec = Math.round((value - min) * 60);
    return sec === 60 ? `${min + 1}:00` : `${min}:${sec.toString().padStart(2, '0')}`;
  }
  return unit === 'ms' ? value.toFixed(2) : value.toFixed(1);
};

/**
 * Vitesse en nœuds convertie dans une unité d'affichage. Le module voile
 * calcule en nœuds (règle 5) : il ne convertit qu'en sortie.
 */
export const knotsToDisplay = (kn: number, unit: SpeedUnit): number => toDisplaySpeed(knotsToMs(kn), unit);

/**
 * Valeur en nœuds, nombre ou texte déjà arrondi (tops, VMG), formatée dans
 * l'unité, sans symbole. Un texte qui n'est pas un nombre (« - ») est rendu
 * tel quel. En nœuds, le texte reçu est rendu inchangé.
 */
export const formatKnots = (kn: number | string, unit: SpeedUnit): string => {
  const value = typeof kn === 'number' ? kn : parseFloat(kn);
  if (!isFinite(value)) return String(kn);
  if (unit === 'kn') return typeof kn === 'string' ? kn : value.toFixed(1);
  return formatSpeedValue(knotsToDisplay(value, unit), unit);
};

/** Unité dans laquelle une distance est présentée : kilomètres ou milles nautiques. */
export type DistanceUnit = 'km' | 'nm';

export const DISTANCE_UNIT_LABEL: Record<DistanceUnit, string> = {
  km: 'kilomètres',
  nm: 'milles nautiques',
};

export const DISTANCE_UNIT_SYMBOL: Record<DistanceUnit, string> = {
  km: 'km',
  nm: 'NM',
};

/** Longueur d'une unité de distance, en mètres. */
export const METERS_PER_DISTANCE_UNIT: Record<DistanceUnit, number> = {
  km: 1000,
  nm: 1852,
};

/** Convertit une distance en mètres vers une unité d'affichage. */
export const toDisplayDistance = (m: number, unit: DistanceUnit): number => m / METERS_PER_DISTANCE_UNIT[unit];

/** Formate une distance en mètres dans l'unité choisie, avec son symbole. */
export const formatDistance = (m: number, unit: DistanceUnit, decimals = 2): string =>
  isFinite(m) ? `${toDisplayDistance(m, unit).toFixed(decimals)} ${DISTANCE_UNIT_SYMBOL[unit]}` : '-';

/** Formate une durée en millisecondes, par exemple `1h24` ou `37 min`. */
export const formatDuration = (ms: number): string => {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m} min`;
};

/** Durée en `h:mm:ss`, pour un chronomètre. */
export const formatClock = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
};
