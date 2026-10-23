/**
 * Racine du Profil : une série de périodes d'activité qui fait pousser une
 * racine autour des cadres de la page (`components/ProfileRoot.tsx`).
 *
 * Une période (une journée, une semaine…) est tenue quand son temps d'activité
 * atteint l'objectif. À sa clôture, la racine gagne une étape si elle est
 * tenue ; sinon elle recule, d'autant que le tour complet se perd en
 * `lossPeriods` périodes manquées (jamais sous la graine). La période en cours
 * ne compte qu'à sa fin : son temps fait pousser des radicelles, sans effet sur
 * la racine. Le plus haut niveau atteint reste dessiné sec.
 *
 * Logique pure ; les périodes suivent l'heure de l'appareil, de minuit à minuit,
 * comptées depuis un lundi : à 7 jours, ce sont les semaines du lundi au dimanche.
 */

/** Réglages de la racine (Réglages, « Pratiquant »). */
export interface RootSettings {
  /** Temps d'activité qui fait tenir une période, en minutes. */
  goalMin: number;
  /** Durée d'une période, en jours entiers ; 7 : la semaine. */
  periodDays: number;
  /** Périodes tenues pour faire le tour de tous les cadres. */
  growthPeriods: number;
  /** Périodes manquées pour perdre un tour complet. */
  lossPeriods: number;
}

/**
 * Valeurs d'essai du 22/10, pour voir la racine vivre en quelques jours : le
 * tour en 15 jours tenus, perdu en 30 jours manqués, 15 min par jour. Les
 * valeurs de la maquette, à la semaine, seraient 7 jours, 26 périodes et 6,5.
 */
export const ROOT_DEFAULTS: RootSettings = { goalMin: 15, periodDays: 1, growthPeriods: 15, lossPeriods: 30 };

/** Ce que la racine retient d'une session : son début et son temps d'activité. */
export interface RootSession {
  startMs: number;
  durationS: number;
}

export interface RootGrowth {
  /** Niveau, en étapes (une par période tenue) ; peut dépasser `growthPeriods` (racine mûre). */
  level: number;
  /** Plus haut niveau atteint : au-delà de `level`, la partie sèche. */
  maxLevel: number;
  /** Niveau rapporté au tour complet (1 : tous les cadres entourés). */
  fraction: number;
  /** Numéro de la période en cours (`periodIndex`). */
  periodIndex: number;
  periodStartMs: number;
  periodEndMs: number;
  /** Temps d'activité de la période en cours, en minutes. */
  minutes: number;
  /** La période en cours est déjà tenue. */
  held: boolean;
  /** Part de l'objectif faite dans la période en cours, de 0 à 1. */
  progress: number;
  /** Recul d'une période manquée, en étapes. */
  lossStep: number;
  /** La dernière période close a été manquée alors que la racine avait de quoi perdre : on est en train de la tuer. */
  losing: boolean;
}

/** Lundi 1er janvier 2024 : origine des périodes. */
const ORIGIN_UTC = Date.UTC(2024, 0, 1);
const DAY_MS = 86_400_000;

/** Numéro du jour local de `ms` depuis l'origine (les changements d'heure n'y font rien). */
const localDay = (ms: number): number => {
  const d = new Date(ms);
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - ORIGIN_UTC) / DAY_MS);
};

/** Durée d'une période ramenée à un nombre entier de jours, au moins un. */
const wholeDays = (periodDays: number): number => Math.max(1, Math.round(periodDays));

/** Numéro de la période qui contient `ms`. */
export const periodIndex = (ms: number, periodDays: number): number => Math.floor(localDay(ms) / wholeDays(periodDays));

/** Début de la période `index`, à minuit, heure de l'appareil. */
export const periodStart = (index: number, periodDays: number): number => new Date(2024, 0, 1 + index * wholeDays(periodDays)).getTime();

/**
 * Niveau de la racine à `nowMs`, rejoué période par période depuis celle de la
 * plus vieille session. Une session compte dans la période où elle commence ;
 * celles d'après `nowMs` sont ignorées.
 */
export const rootGrowth = (sessions: readonly RootSession[], settings: RootSettings, nowMs: number): RootGrowth => {
  const days = wholeDays(settings.periodDays);
  const goal = Math.max(1, settings.goalMin);
  const growth = Math.max(1, settings.growthPeriods);
  const lossStep = growth / Math.max(1, settings.lossPeriods);
  const current = periodIndex(nowMs, days);

  const minutesOf = new Map<number, number>();
  let first = current;
  for (const s of sessions) {
    if (s.startMs > nowMs || !(s.durationS > 0)) continue;
    const i = periodIndex(s.startMs, days);
    minutesOf.set(i, (minutesOf.get(i) ?? 0) + s.durationS / 60);
    first = Math.min(first, i);
  }

  let level = 0;
  let maxLevel = 0;
  let losing = false;
  for (let i = first; i < current; i++) {
    const held = (minutesOf.get(i) ?? 0) >= goal;
    losing = !held && level > 0;
    level = held ? level + 1 : Math.max(0, level - lossStep);
    // Les reculs fractionnaires s'accumulent : un arrondi fin évite un 2,9999 affiché 2,9.
    level = Math.round(level * 1e6) / 1e6;
    maxLevel = Math.max(maxLevel, level);
  }

  const minutes = minutesOf.get(current) ?? 0;
  return {
    level, maxLevel, fraction: level / growth,
    periodIndex: current, periodStartMs: periodStart(current, days), periodEndMs: periodStart(current + 1, days),
    minutes, held: minutes >= goal, progress: Math.min(1, minutes / goal), lossStep, losing,
  };
};

/** Niveau en clair : entier, ou une décimale quand un recul l'a rendu fractionnaire. */
export const levelText = (level: number): string =>
  level.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
