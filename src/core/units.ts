/**
 * Conversions d'unités. Le noyau travaille en m/s, l'affichage se fait ici.
 */

export const MS_TO_KNOTS = 1.94384;
export const MS_TO_KMH = 3.6;

/** Pesanteur normale, en m/s² : l'unité des seuils exprimés en g. */
export const STANDARD_G = 9.80665;

/** Unité dans laquelle une vitesse est présentée à l'utilisateur. */
export type SpeedUnit = 'kn' | 'kmh' | 'ms' | 'minkm';

export const msToKnots = (ms: number): number => ms * MS_TO_KNOTS;
export const knotsToMs = (kn: number): number => kn / MS_TO_KNOTS;

export const msToKmh = (ms: number): number => ms * MS_TO_KMH;
export const kmhToMs = (kmh: number): number => kmh / MS_TO_KMH;

/** Entier sur deux chiffres, « 05 ». */
export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Minutes décimales en `m:ss`, avec le report de 60 s (5,999 donne « 6:00 »). */
export const minutesSeconds = (totalMinutes: number): string => {
  const min = Math.floor(totalMinutes);
  const sec = Math.round((totalMinutes - min) * 60);
  return sec === 60 ? `${min + 1}:00` : `${min}:${pad2(sec)}`;
};

/**
 * Écart signé, en pourcentage, d'une fraction : « +1.2 % », « −3.0 % ». Un écart
 * nul s'écrit « 0 % » ; avec `zeroSign`, il garde son signe (« +0.0 % »).
 */
export const signedPercent = (fraction: number, { decimals = 1, zeroSign = false }: { decimals?: number; zeroSign?: boolean } = {}): string => {
  const value = Math.abs(fraction * 100).toFixed(decimals);
  if (!zeroSign && Number(value) === 0) return '0 %';
  return `${zeroSign ? (fraction >= 0 ? '+' : '−') : fraction < 0 ? '−' : '+'}${value} %`;
};

/** Sous cette vitesse (m/s), une allure tend vers l'infini : `msToPace` rend `null`. */
export const PACE_MIN_SPEED_MS = 0.1;
/** Graphes des analyses à pied et à vélo : sous cette vitesse en allure, un trou plutôt qu'une valeur absurde. */
export const CHART_PACE_MIN_SPEED_MS = 0.3;
/** Même seuil dans l'analyse des répétitions du fractionné. */
export const INTERVAL_PACE_MIN_SPEED_MS = 0.3;

/**
 * Allure en minutes par kilomètre, ou par mille nautique (1 852 m) si la
 * distance de l'activité est en `nm`. Grandeur inverse de la vitesse : elle
 * tend vers l'infini à l'arrêt, d'où le `null` en dessous d'un seuil de mouvement.
 */
export const msToPace = (ms: number, distanceUnit: DistanceUnit = 'km', minSpeedMs = PACE_MIN_SPEED_MS): number | null => {
  if (ms <= minSpeedMs) return null;
  return METERS_PER_DISTANCE_UNIT[distanceUnit] / ms / 60;
};

/** Formate une allure en `m:ss`, ou `-` si la vitesse est trop faible. */
export const formatPace = (ms: number, distanceUnit: DistanceUnit = 'km'): string => {
  const pace = msToPace(ms, distanceUnit);
  if (pace === null || !isFinite(pace)) return '-';
  return minutesSeconds(pace);
};

/** Convertit une vitesse en m/s vers une unité d'affichage. */
export const toDisplaySpeed = (ms: number, unit: SpeedUnit, distanceUnit: DistanceUnit = 'km'): number => {
  switch (unit) {
    case 'kn':
      return msToKnots(ms);
    case 'kmh':
      return msToKmh(ms);
    case 'ms':
      return ms;
    case 'minkm':
      return msToPace(ms, distanceUnit) ?? 0;
  }
};

/** Convertit une vitesse saisie dans une unité d'affichage vers des m/s. */
export const fromDisplaySpeed = (value: number, unit: SpeedUnit, distanceUnit: DistanceUnit = 'km'): number => {
  switch (unit) {
    case 'kn':
      return knotsToMs(value);
    case 'kmh':
      return kmhToMs(value);
    case 'ms':
      return value;
    case 'minkm':
      return value > 0 ? METERS_PER_DISTANCE_UNIT[distanceUnit] / (value * 60) : 0;
  }
};

export const SPEED_UNIT_LABEL: Record<SpeedUnit, string> = {
  kn: 'nœuds',
  kmh: 'km/h',
  ms: 'm/s',
  minkm: 'min/km',
};

/**
 * Origine de la vitesse d'une trace, pour l'aide de l'onglet réglages : celle de
 * l'appareil (avec son unité si ce n'est pas le m/s, lue puis convertie) ou
 * dérivée des positions.
 */
export const speedSourceText = (hasDeviceSpeed: boolean, deviceSpeedUnit: SpeedUnit | null | undefined): string =>
  hasDeviceSpeed
    ? `fournie par l'appareil${deviceSpeedUnit && deviceSpeedUnit !== 'ms' ? `, lue en ${SPEED_UNIT_LABEL[deviceSpeedUnit]} et convertie` : ''}`
    : 'dérivée des positions, filtrée';

/** Libellé d'une unité de vitesse ; l'allure suit l'unité de distance (« min/km », « min/NM »). */
export const speedUnitLabel = (unit: SpeedUnit, distanceUnit: DistanceUnit = 'km'): string =>
  unit === 'minkm' ? `min/${DISTANCE_UNIT_SYMBOL[distanceUnit]}` : SPEED_UNIT_LABEL[unit];

/** Symbole court d'une unité de vitesse ; l'allure suit l'unité de distance (« /km », « /NM »). */
export const speedUnitSymbol = (unit: SpeedUnit, distanceUnit: DistanceUnit = 'km'): string =>
  unit === 'minkm' ? `/${DISTANCE_UNIT_SYMBOL[distanceUnit]}` : SPEED_UNIT_SYMBOL[unit];

/** Symbole court, accolé à une valeur (« 12.4 nds »). */
export const SPEED_UNIT_SYMBOL: Record<SpeedUnit, string> = {
  kn: 'nds',
  kmh: 'km/h',
  ms: 'm/s',
  minkm: '/km',
};

/** Vrai si, dans cette unité, une valeur plus grande signifie plus lent. */
export const isInverseUnit = (unit: SpeedUnit): boolean => unit === 'minkm';

/**
 * Unité de saisie d'une vitesse (bornes de couleur, seuils) : celle de
 * l'activité, sauf une allure, saisie en km/h (des minutes décimales se liraient
 * mal : « 5.30 » vaudrait 5 min 18 s).
 */
export const editSpeedUnit = (unit: SpeedUnit): SpeedUnit => (isInverseUnit(unit) ? 'kmh' : unit);

/** Formate une vitesse en m/s dans l'unité choisie, avec son symbole. */
export const formatSpeed = (ms: number | null, unit: SpeedUnit, distanceUnit: DistanceUnit = 'km'): string => {
  if (ms === null || !isFinite(ms)) return '-';
  switch (unit) {
    case 'kn':
      return `${msToKnots(ms).toFixed(1)} ${SPEED_UNIT_SYMBOL.kn}`;
    case 'kmh':
      return `${msToKmh(ms).toFixed(1)} ${SPEED_UNIT_SYMBOL.kmh}`;
    case 'ms':
      return `${ms.toFixed(2)} ${SPEED_UNIT_SYMBOL.ms}`;
    case 'minkm':
      return `${formatPace(ms, distanceUnit)} ${speedUnitSymbol(unit, distanceUnit)}`;
  }
};

/** Formate une valeur déjà exprimée dans l'unité, pour les axes de graphe. */
export const formatSpeedValue = (value: number, unit: SpeedUnit): string => {
  if (!isFinite(value)) return '-';
  if (unit === 'minkm') return minutesSeconds(value);
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

/** Distance dans l'unité, deux décimales sous 10 unités et une au-delà (bibliothèque, statistiques). */
export const formatDistanceAuto = (m: number, unit: DistanceUnit): string => formatDistance(m, unit, toDisplayDistance(m, unit) < 10 ? 2 : 1);

/** Mètres entiers, « 120 m » ; « — » sans valeur. */
export const formatMeters = (m: number | null): string => (m === null ? '—' : `${Math.round(m)} m`);

/** Distance d'approche (une balise) : en mètres sous 1 000 m, quelle que soit l'unité ; au-delà, dans l'unité. */
export const formatShortDistance = (m: number, unit: DistanceUnit): string =>
  isFinite(m) && m < 1000 ? `${Math.round(m)} m` : formatDistance(m, unit);

/** Formate une durée en millisecondes, par exemple `1h24` ou `37 min`. */
export const formatDuration = (ms: number): string => {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h${pad2(m)}` : `${m} min`;
};

/** Durée courte, en secondes : « 45 s », « 1 min 05 », puis comme `formatDuration` au-delà d'une heure. */
export const formatShortDuration = (s: number): string => {
  const total = Math.max(0, Math.round(s));
  if (total < 60) return `${total} s`;
  if (total >= 3600) return formatDuration(total * 1000);
  return `${Math.floor(total / 60)} min ${pad2(total % 60)}`;
};

/** Durée en `h:mm:ss`, pour un chronomètre. */
export const formatClock = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 3600)}:${pad2(Math.floor((total % 3600) / 60))}:${pad2(total % 60)}`;
};

/** Axe de temps d'un graphe, donné en minutes : `h:mm`, ou `h:mm:ss` hors de la minute ronde (graphe zoomé). */
export const formatClockMinutes = (minutes: number): string => formatClock(minutes * 60_000).replace(/:00$/, '');

/**
 * Secondes entières en `m:ss`, `h:mm:ss` à partir d'une heure ; `secondSuffix`
 * s'accroche aux secondes (les dixièmes d'un chronomètre).
 */
export const formatMinSecHours = (totalSeconds: number, secondSuffix = ''): string => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor(totalSeconds / 60) % 60;
  const s = `${pad2(totalSeconds % 60)}${secondSuffix}`;
  return h > 0 ? `${h}:${pad2(m)}:${s}` : `${m}:${s}`;
};

/** Joules par kilocalorie. */
export const J_PER_KCAL = 4184;

/** Durée en secondes au format `m:ss` (de 0 à 59 min), pour un décompte. */
export const formatMinSec = (s: number): string => {
  const total = Math.max(0, Math.round(s));
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
};

/** Heure locale `hh:mm:ss` d'un instant, pour désigner un moment de la session. */
export const formatTimeOfDay = (ms: number): string => {
  const date = new Date(ms);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
};

const WEEKDAYS_FR = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

/** Date et heure de départ d'une session, en heure locale : « mer. 14/10/2026 · 10:02 ». */
export const formatSessionDate = (ms: number): string => {
  const date = new Date(ms);
  return `${WEEKDAYS_FR[date.getDay()]} ${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()} · ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};
