/**
 * Note de niveau sportif du Profil (lot 230, étude `docs/backlog/230-etude.md`,
 * plan `230-plan.md`) : une note sur 100 faite de trois parts visibles,
 * valable pour tous les sports.
 *
 * - Efforts : minutes équivalentes modérées par semaine sur 6 semaines
 *   (intensité par les zones de FC, sinon celle du sport, Compendium 2024),
 *   comparées aux repères de l'OMS.
 * - Régularité : jours actifs par tranche de 7 jours, sur 12 semaines.
 * - Forme pour l'âge : rang parmi les gens de son âge et de son sexe, d'après
 *   les sources données (`FormeSource` : course et vélo par `statsLevel.ts`,
 *   FC de repos par `restingHrForme`).
 *
 * Une part impossible à calculer est retirée et les autres remises à
 * l'échelle ; une part à zéro parce que rien n'a été fait reste à zéro. Sans
 * forme mesurée, la note s'arrête sous les paliers qui la demandent.
 *
 * Fenêtres fixes, en jours du calendrier finissant aujourd'hui (règle 2),
 * comptées depuis la première session si elle est plus récente. Tout repère
 * vient de `LEVEL_RULES`, passé en paramètre (règle 3). Neutre : n'importe ni
 * `running/`, ni `cycling/`, ni `land/` (règle 13). Pur.
 */

import { plural } from '../core/basics';
import { DAY_MS, addDays, shortDate, startOfDay } from '../core/calendar';
import { histogramZoneTimes, type HeartRateHistogram } from '../core/heartRate';
import type { SportType } from '../core/types';
import { formatDecimal } from '../core/units';
import { rootSessionTimeS } from './profile';
import { restingHrRank, type NormSex, type RestingHrBand } from './restingHrNorms';
import type { StatSession } from './stats';

/** Classes d'intensité de l'OMS : légère (moins de 3 MET), modérée (3 à 6), vigoureuse (6 et plus). */
export type IntensityClass = 'leger' | 'modere' | 'vigoureux';

/**
 * Intensité d'un calcul sans ceinture : une classe fixe, celle de la vitesse
 * moyenne en mouvement à pied (`pied`) ou à vélo (`velo`), ou `null` : ce
 * n'est pas un effort (FC de nuit), la session n'est pas comptée.
 */
export type SportIntensity = IntensityClass | 'pied' | 'velo' | null;

/** Un palier de la note : sa borne basse, son nom, et s'il demande une forme mesurée. */
export interface LevelPalier {
  min: number;
  label: string;
  needsForme: boolean;
}

export type LevelPartId = 'efforts' | 'regularite' | 'forme';

export interface LevelRules {
  /** Poids des parts, avant remise à l'échelle quand une part manque. */
  weights: Record<LevelPartId, number>;
  /** Note la plus haute sans forme mesurée. */
  capWithoutForme: number;
  /** Paliers, par borne basse croissante, le premier à 0. */
  paliers: readonly LevelPalier[];
  /** Fenêtre des efforts, en jours, et sa plus courte (nouvel utilisateur). */
  effortWindowDays: number;
  effortMinDays: number;
  /** Fenêtre de la régularité, en jours, et sa plus courte. */
  regularityWindowDays: number;
  regularityMinDays: number;
  /** Jours d'une semaine : tranches de la régularité, minutes par semaine des efforts. */
  weekDays: number;
  /** Fenêtre de la forme d'après la course et le vélo, en jours. */
  formeWindowDays: number;
  /** Fenêtre du test de FC de repos, en jours. */
  restHrWindowDays: number;
  /** Minutes équivalentes modérées par minute de chaque classe (l'OMS compte une minute vigoureuse pour deux modérées). */
  intensityFactors: Record<IntensityClass, number>;
  /** Classe des secondes de chaque zone de FC : sous Z1, puis Z1 à Z5 (`histogramZoneTimes`). */
  intensityByZone: readonly IntensityClass[];
  /** Intensité de chaque calcul sans ceinture (Compendium 2024). */
  sportIntensity: Record<SportType, SportIntensity>;
  /** Classe d'une session à pied ou à vélo sans vitesse connue. */
  unknownSpeedIntensity: IntensityClass;
  /** À pied : légère sous la première borne, modérée jusqu'à la seconde, vigoureuse au-delà (m/s). */
  footSpeedBoundsMs: readonly [number, number];
  /** À vélo : vigoureuse dès cette vitesse moyenne (m/s), modérée en dessous. */
  bikeVigorousMs: number;
  /** Points des efforts, par segments droits entre ces repères (minutes équivalentes par semaine). */
  effortRefs: readonly { minutes: number; points: number }[];
  /** Au-delà de ces minutes par semaine, seules les minutes vigoureuses font monter (`Ec = min(E, ceci + V)`). */
  effortVigorousOnlyAboveMin: number;
  /** Sous cet âge, repères des efforts multipliés par `youthFactor` (l'OMS demande 60 min par jour de 5 à 17 ans). */
  youthAgeBelow: number;
  youthFactor: number;
  /** Jour actif dès ces minutes équivalentes. */
  activeDayMin: number;
  /** Jours actifs par tranche de 7 jours qui la remplissent. */
  activeDaysTarget: number;
  /** Ajouté à la FC du test avant de la situer dans les tables (mesure couchée contre assise) : 0, aucune correction. */
  restHrTableOffsetBpm: number;
  /** Puissance au seuil rapportée à la puissance maximale (VO2max du vélo). */
  ftpShareOfMax: number;
  /** Équation de l'ACSM pour le pédalage : VO2 = `perWkg` × W/kg + `restMlKgMin` (ml/kg/min). */
  acsmCycle: { perWkg: number; restMlKgMin: number };
}

/** Règles de la note, fixes (étude du 25/11, plan du 26/11). */
export const LEVEL_RULES: LevelRules = Object.freeze({
  weights: { efforts: 0.5, regularite: 0.3, forme: 0.2 },
  capWithoutForme: 74,
  paliers: [
    { min: 0, label: 'Au repos', needsForme: false },
    { min: 20, label: 'En route', needsForme: false },
    { min: 40, label: 'Actif', needsForme: false },
    { min: 60, label: 'Sportif', needsForme: false },
    { min: 75, label: 'Très sportif', needsForme: true },
    { min: 90, label: 'Athlète', needsForme: true },
  ],
  effortWindowDays: 42,
  effortMinDays: 14,
  regularityWindowDays: 84,
  regularityMinDays: 42,
  weekDays: 7,
  formeWindowDays: 365,
  restHrWindowDays: 180,
  intensityFactors: { leger: 0.5, modere: 1, vigoureux: 2 },
  intensityByZone: ['leger', 'modere', 'modere', 'vigoureux', 'vigoureux', 'vigoureux'],
  sportIntensity: {
    wingfoil: 'modere',
    windsurf: 'modere',
    kite: 'modere',
    bateau: 'leger',
    running: 'pied',
    cycling: 'velo',
    'run-intervals': 'vigoureux',
    'bike-intervals': 'vigoureux',
    // Test de FC max : un effort vigoureux (26/11).
    'run-test': 'vigoureux',
    surf: 'modere',
    muscu: 'modere',
    // FC de nuit : pas un effort (26/11).
    'night-hr': null,
  },
  unknownSpeedIntensity: 'modere',
  footSpeedBoundsMs: [1.11, 1.94],
  bikeVigorousMs: 5.28,
  effortRefs: [
    { minutes: 0, points: 0 },
    { minutes: 150, points: 50 },
    { minutes: 300, points: 75 },
    { minutes: 600, points: 100 },
  ],
  effortVigorousOnlyAboveMin: 300,
  youthAgeBelow: 18,
  youthFactor: 420 / 150,
  activeDayMin: 20,
  activeDaysTarget: 3,
  restHrTableOffsetBpm: 0,
  ftpShareOfMax: 0.75,
  acsmCycle: { perWkg: 11, restMlKgMin: 7 },
} satisfies LevelRules);

/** Unités, pas des repères : points d'une part pleine, secondes par minute. */
const FULL_POINTS = 100;
const SECONDS_PER_MIN = 60;

/** Noms des parts, dans l'ordre d'affichage. */
export const LEVEL_PART_LABEL: Record<LevelPartId, string> = {
  efforts: 'Efforts',
  regularite: 'Régularité',
  forme: 'Forme pour l\'âge',
};

const PART_ORDER: readonly LevelPartId[] = ['efforts', 'regularite', 'forme'];

/** Une source de la forme pour l'âge, en points de 0 à 100 (son rang parmi les gens de son âge et de son sexe). */
export interface FormeSource {
  kind: 'course' | 'velo' | 'coeur';
  points: number;
  /** Date de la mesure. */
  atMs: number;
  /** Session d'où elle vient, `null` pour un test hors session (FC de repos). */
  file: string | null;
  /** Preuve en clair : « 5 km en 20 min 00, VO2max estimée 50, mieux que 65 % des hommes de 20 à 29 ans ». */
  text: string;
}

/** Session non comptée : test de FC de repos ou de nuit, déjà marqués par l'appelant (`excluded`) ou par leur calcul. */
export type LevelExclusion = 'fc-repos' | 'fc-nuit';

/** Ce que la note lit d'une session. */
export interface LevelSession {
  file: string;
  startMs: number;
  /** Temps compté, en secondes : celui de la racine (`rootSessionTimeS`). */
  timeS: number;
  sport: SportType;
  /** Vitesse moyenne en mouvement, en m/s, `null` sans elle. */
  speedMs: number | null;
  /** FC du résumé, `null` sans ceinture. */
  hr: { coveredS: number; histogram: HeartRateHistogram } | null;
  /** Bornes basses des zones 1 à 5 de l'activité de la session (`zonesFor`), `null` sans zones. */
  zoneBounds: readonly number[] | null;
  excluded: LevelExclusion | null;
}

/**
 * Session de la note d'après celle des statistiques : temps de la racine, vitesse
 * moyenne en mouvement (distance et temps en mouvement), FC du résumé. `sport` :
 * le calcul de son activité ; `zoneBounds` : les zones de son activité (`zonesFor`).
 */
export const levelSessionOf = (
  stat: StatSession,
  sport: SportType,
  zoneBounds: readonly number[] | null,
  excluded: LevelExclusion | null = null
): LevelSession => ({
  file: stat.file,
  startMs: stat.startMs,
  timeS: rootSessionTimeS(stat),
  sport,
  speedMs: stat.movingDistanceM !== null && stat.movingTimeS !== null && stat.movingTimeS > 0 ? stat.movingDistanceM / stat.movingTimeS : null,
  hr: stat.heartRate ? { coveredS: stat.heartRate.coveredS, histogram: stat.heartRate.histogram } : null,
  zoneBounds,
  excluded,
});

export interface LevelPart {
  id: LevelPartId;
  /** De 0 à 100, non arrondi ; `null` : part impossible à calculer, retirée de la note. */
  points: number | null;
  /** Poids effectif, remis à l'échelle sur les parts présentes ; 0 pour une part absente. */
  weight: number;
  /** Phrase de preuve, `null` pour une part absente. */
  proof: string | null;
  /** Ce qui donnerait une part absente, `null` pour une part présente. */
  missingHint: string | null;
}

export interface SportLevel {
  /** Note de 0 à 100, arrondie, plafonnée sans forme ; `null` sans aucune part. */
  note: number | null;
  /** Note avant le plafond. */
  uncapped: number | null;
  palier: LevelPalier | null;
  /** Vrai quand le plafond sans forme a abaissé la note. */
  capped: boolean;
  parts: LevelPart[];
  /** Sessions de la fenêtre de la régularité qui ne comptent pas, et pourquoi. */
  uncounted: { file: string; startMs: number; reason: LevelExclusion }[];
}

/** Classe d'une session sans FC : celle du calcul, à pied et à vélo selon sa vitesse moyenne en mouvement. */
export const sportIntensityClass = (session: Pick<LevelSession, 'sport' | 'speedMs'>, rules: LevelRules = LEVEL_RULES): IntensityClass | null => {
  const rule = rules.sportIntensity[session.sport];
  if (rule !== 'pied' && rule !== 'velo') return rule;
  const speed = session.speedMs;
  if (speed === null || !Number.isFinite(speed)) return rules.unknownSpeedIntensity;
  if (rule === 'velo') return speed >= rules.bikeVigorousMs ? 'vigoureux' : 'modere';
  const [light, vigorous] = rules.footSpeedBoundsMs;
  return speed < light ? 'leger' : speed < vigorous ? 'modere' : 'vigoureux';
};

/** Minutes équivalentes modérées d'une session, et leur partie vigoureuse. */
export interface SessionEffort {
  equivalentMin: number;
  vigorousMin: number;
}

/**
 * Effort d'une session, `null` si elle n'est pas un effort. Avec FC et zones,
 * les secondes couvertes sont rangées par zone, ramenées au temps compté si
 * elles le dépassent (arrêts compris dans la FC) ; le reste du temps compté
 * prend l'intensité du sport.
 */
export const sessionEffort = (session: LevelSession, rules: LevelRules = LEVEL_RULES): SessionEffort | null => {
  if (session.excluded !== null) return null;
  const sportClass = sportIntensityClass(session, rules);
  if (sportClass === null) return null;
  const countedS = Math.max(0, session.timeS);
  const effort: SessionEffort = { equivalentMin: 0, vigorousMin: 0 };
  const add = (seconds: number, cls: IntensityClass) => {
    const min = (seconds / SECONDS_PER_MIN) * rules.intensityFactors[cls];
    effort.equivalentMin += min;
    if (cls === 'vigoureux') effort.vigorousMin += min;
  };
  let restS = countedS;
  if (session.hr && session.zoneBounds) {
    const zones = histogramZoneTimes(session.hr.histogram, session.zoneBounds);
    const heardS = zones.reduce((n, s) => n + s, 0);
    const scale = heardS > countedS ? countedS / heardS : 1;
    const lastClass = rules.intensityByZone[rules.intensityByZone.length - 1];
    zones.forEach((s, k) => add(s * scale, rules.intensityByZone[k] ?? lastClass));
    restS = Math.max(0, countedS - heardS * scale);
  }
  add(restS, sportClass);
  return effort;
};

/** Jours du calendrier entre deux minuits locaux (changement d'heure compris). */
const daysBetween = (fromDayMs: number, toDayMs: number): number => Math.round((toDayMs - fromDayMs) / DAY_MS);

/**
 * Jours d'une fenêtre finissant aujourd'hui (aujourd'hui compris) : `maxDays`,
 * ramenés aux jours depuis la première session si elle est plus récente, sans
 * descendre sous `minDays`.
 */
export const windowDays = (firstStartMs: number | null, nowMs: number, maxDays: number, minDays: number): number => {
  if (firstStartMs === null) return maxDays;
  const since = daysBetween(startOfDay(firstStartMs), startOfDay(nowMs)) + 1;
  return Math.min(maxDays, Math.max(minDays, since));
};

/** Points des efforts : segments droits entre les repères (multipliés par `factor`), le dernier au-delà. */
const effortPoints = (minutes: number, refs: LevelRules['effortRefs'], factor: number): number => {
  const first = refs[0];
  if (minutes <= first.minutes * factor) return first.points;
  for (let k = 1; k < refs.length; k++) {
    const lo = refs[k - 1];
    const hi = refs[k];
    if (minutes <= hi.minutes * factor) return lo.points + ((minutes - lo.minutes * factor) / ((hi.minutes - lo.minutes) * factor)) * (hi.points - lo.points);
  }
  return refs[refs.length - 1].points;
};

/** Nombre décimal sans « ,0 » final : « 3 », « 2,3 ». */
const shortDecimal = (value: number): string => formatDecimal(value, 1).replace(/,0$/, '');

/** Durée d'une fenêtre en clair : « 6 semaines », sinon en jours. */
const windowText = (days: number, weekDays: number): string =>
  days % weekDays === 0 ? plural(days / weekDays, 'semaine') : plural(days, 'jour');

const NO_SESSION_HINT = 'Pas encore de session : enregistre ou importe une sortie.';
const FORME_HINT = 'Pas encore mesurée. Cours un 5 km ou fais un test de FC de repos.';

/**
 * La note. `ageYears` : âge du pratiquant (repères des moins de 18 ans), `null`
 * s'il est inconnu (repères des adultes). `forme` : sources déjà prises dans
 * leurs fenêtres (`formeForAge`, `restingHrForme`).
 */
export const sportLevel = (
  sessions: readonly LevelSession[],
  ageYears: number | null,
  forme: readonly FormeSource[],
  nowMs: number,
  rules: LevelRules = LEVEL_RULES
): SportLevel => {
  const today = startOfDay(nowMs);

  // Sessions passées, comptées ou non ; la première d'entre elles ouvre les fenêtres.
  const past = sessions.filter((s) => s.startMs <= nowMs);
  const counted: { session: LevelSession; effort: SessionEffort }[] = [];
  const skipped: SportLevel['uncounted'] = [];
  let first: number | null = null;
  for (const session of past) {
    first = first === null ? session.startMs : Math.min(first, session.startMs);
    const effort = sessionEffort(session, rules);
    if (effort) counted.push({ session, effort });
    // Seul calcul sans intensité : la FC de nuit.
    else skipped.push({ file: session.file, startMs: session.startMs, reason: session.excluded ?? 'fc-nuit' });
  }
  const anyCounted = counted.length > 0;
  const regularityDays = windowDays(first, nowMs, rules.regularityWindowDays, rules.regularityMinDays);
  const regularityFromMs = addDays(today, 1 - regularityDays);
  const uncounted = skipped.filter((u) => u.startMs >= regularityFromMs);

  // Efforts.
  let efforts: Omit<LevelPart, 'weight'>;
  if (!anyCounted) {
    efforts = { id: 'efforts', points: null, proof: null, missingHint: NO_SESSION_HINT };
  } else {
    const days = windowDays(first, nowMs, rules.effortWindowDays, rules.effortMinDays);
    const fromMs = addDays(today, 1 - days);
    let equivalent = 0;
    let vigorous = 0;
    for (const { session, effort } of counted) {
      if (session.startMs < fromMs) continue;
      equivalent += effort.equivalentMin;
      vigorous += effort.vigorousMin;
    }
    const weeks = days / rules.weekDays;
    const perWeek = equivalent / weeks;
    const vigorousPerWeek = vigorous / weeks;
    const youth = ageYears !== null && ageYears < rules.youthAgeBelow ? rules.youthFactor : 1;
    const kept = Math.min(perWeek, rules.effortVigorousOnlyAboveMin * youth + vigorousPerWeek);
    const minutes = formatDecimal(perWeek, 0);
    const proof = `${minutes} min d'effort par semaine${Math.round(vigorousPerWeek) > 0 ? `, dont ${formatDecimal(vigorousPerWeek, 0)} vigoureuses` : ''}, sur ${windowText(days, rules.weekDays)}`;
    efforts = { id: 'efforts', points: effortPoints(kept, rules.effortRefs, youth), proof, missingHint: null };
  }

  // Régularité.
  let regularite: Omit<LevelPart, 'weight'>;
  if (!anyCounted) {
    regularite = { id: 'regularite', points: null, proof: null, missingHint: NO_SESSION_HINT };
  } else {
    const slices = Math.ceil(regularityDays / rules.weekDays);
    const minutesByDay = new Map<number, number>();
    for (const { session, effort } of counted) {
      const ago = daysBetween(startOfDay(session.startMs), today);
      if (ago >= slices * rules.weekDays) continue;
      minutesByDay.set(ago, (minutesByDay.get(ago) ?? 0) + effort.equivalentMin);
    }
    const activeBySlice = new Array<number>(slices).fill(0);
    for (const [ago, min] of minutesByDay) if (min >= rules.activeDayMin) activeBySlice[Math.floor(ago / rules.weekDays)] += 1;
    const filled = activeBySlice.reduce((n, active) => n + Math.min(1, active / rules.activeDaysTarget), 0);
    const activeDays = activeBySlice.reduce((n, active) => n + active, 0) / slices;
    const proof = `${shortDecimal(activeDays)} jour${activeDays >= 2 ? 's' : ''} actif${activeDays >= 2 ? 's' : ''} par semaine en moyenne, sur ${plural(slices, 'semaine')}`;
    regularite = { id: 'regularite', points: (filled / slices) * FULL_POINTS, proof, missingHint: null };
  }

  // Forme pour l'âge : moyenne des sources présentes.
  const formePart: Omit<LevelPart, 'weight'> = forme.length === 0
    ? { id: 'forme', points: null, proof: null, missingHint: FORME_HINT }
    : {
      id: 'forme',
      points: forme.reduce((n, f) => n + f.points, 0) / forme.length,
      proof: forme.map((f) => f.text).join(' · '),
      missingHint: null,
    };

  const byId: Record<LevelPartId, Omit<LevelPart, 'weight'>> = { efforts, regularite, forme: formePart };
  const present = PART_ORDER.filter((id) => byId[id].points !== null);
  const totalWeight = present.reduce((n, id) => n + rules.weights[id], 0);
  const parts: LevelPart[] = PART_ORDER.map((id) => ({
    ...byId[id],
    weight: byId[id].points !== null && totalWeight > 0 ? rules.weights[id] / totalWeight : 0,
  }));
  if (present.length === 0 || totalWeight <= 0) return { note: null, uncapped: null, palier: null, capped: false, parts, uncounted };

  const uncapped = Math.round(present.reduce((n, id) => n + rules.weights[id] * byId[id].points!, 0) / totalWeight);
  const hasForme = formePart.points !== null;
  const capped = !hasForme && uncapped > rules.capWithoutForme;
  const note = capped ? rules.capWithoutForme : uncapped;
  const palier = rules.paliers.reduce<LevelPalier | null>((best, p) => (note >= p.min && (hasForme || !p.needsForme) ? p : best), null);
  return { note, uncapped, palier, capped, parts, uncounted };
};

/** Une FC de repos mesurée par le test (`StoredRestingResult` : `startedAtMs`, `lowestBpm`). */
export interface RestingHrMeasure {
  atMs: number;
  bpm: number;
}

const SEX_WORD: Record<NormSex, string> = { h: 'hommes', f: 'femmes' };

/** Tranche d'âge en clair : « de 20 à 39 ans », « de 80 ans et plus ». */
const bandText = (band: RestingHrBand): string =>
  band.toAge === Infinity ? `de ${band.fromAge} ans et plus` : band.fromAge === band.toAge ? `de ${plural(band.fromAge, 'an')}` : `de ${band.fromAge} à ${band.toAge} ans`;

/**
 * Source « cœur » de la forme : le dernier test de FC de repos de la fenêtre,
 * points = 100 moins son rang dans les tables NHANES (une FC basse est bonne).
 * Âge du pratiquant l'année du test ; `null` sans test dans la fenêtre.
 */
export const restingHrForme = (
  tests: readonly RestingHrMeasure[],
  sex: NormSex,
  birthYear: number,
  nowMs: number,
  rules: LevelRules = LEVEL_RULES
): FormeSource | null => {
  const fromMs = addDays(startOfDay(nowMs), 1 - rules.restHrWindowDays);
  const last = tests
    .filter((t) => t.atMs >= fromMs && t.atMs <= nowMs && Number.isFinite(t.bpm))
    .reduce<RestingHrMeasure | null>((best, t) => (best === null || t.atMs > best.atMs ? t : best), null);
  if (!last) return null;
  const age = new Date(last.atMs).getFullYear() - birthYear;
  const standing = restingHrRank(sex, age, last.bpm, rules.restHrTableOffsetBpm);
  const who = `des ${SEX_WORD[sex]} ${bandText(standing.band)}`;
  const place = standing.kind === 'below'
    ? `parmi les ${shortDecimal(standing.percentile)} % les plus basses ${who}`
    : standing.kind === 'above'
      ? `parmi les ${shortDecimal(FULL_POINTS - standing.percentile)} % les plus hautes ${who}`
      : `plus basse que celle de ${formatDecimal(FULL_POINTS - standing.percentile, 0)} % ${who}`;
  return {
    kind: 'coeur',
    points: FULL_POINTS - standing.percentile,
    atMs: last.atMs,
    file: null,
    text: `FC de repos ${formatDecimal(last.bpm, 0)} le ${shortDate(last.atMs)}, ${place}`,
  };
};
