/**
 * Racine du Profil : une série de semaines d'activité qui fait pousser une
 * racine autour des cadres de la page (`components/ProfileRoot.tsx`).
 *
 * Une semaine (du lundi au dimanche) est tenue quand son temps d'activité
 * atteint l'objectif. À sa clôture, la racine gagne une étape si elle est
 * tenue ; sinon elle recule, d'autant plus que les semaines manquées se
 * suivent (règle du 25/10 : −3, puis −6 de plus, puis retour à la graine ;
 * une semaine tenue remet le compte à zéro). La semaine en cours ne compte
 * qu'à sa fin : son temps fait pousser des radicelles et ouvre la fleur, sans
 * effet sur la racine. Le plus haut niveau atteint reste dessiné sec.
 *
 * Logique pure ; les périodes suivent l'heure de l'appareil, de minuit à minuit,
 * comptées depuis un lundi.
 */

/** Règle de la racine, fixée par l'utilisateur le 25/10. */
export interface RootRules {
  /** Durée d'une période, en jours entiers ; 7 : la semaine. */
  periodDays: number;
  /** Périodes tenues pour faire le tour de tous les cadres. */
  growthSteps: number;
  /** Recul de la 1re, 2e… période manquée d'affilée, en étapes ; au-delà, le dernier ; `Infinity` : retour à la graine. */
  losses: readonly number[];
}

/** Une étape par semaine, le tour en 26 semaines (6 mois) ; −3, −6, puis la graine. */
export const ROOT_RULES: RootRules = { periodDays: 7, growthSteps: 26, losses: [3, 6, Infinity] };

/** Objectif par semaine, en minutes : seul réglage de la racine (Réglages, « Pratiquant »). */
export const ROOT_GOAL = { defaultMin: 45, min: 15, max: 600 } as const;

/** Ce que la racine retient d'une session : son début et son temps d'activité. */
export interface RootSession {
  startMs: number;
  durationS: number;
}

export interface RootGrowth {
  /** Niveau, en étapes (une par période tenue) ; peut dépasser `growthSteps` (racine mûre). */
  level: number;
  /** Plus haut niveau atteint : au-delà de `level`, la partie sèche. */
  maxLevel: number;
  /** Étapes du tour complet. */
  growthSteps: number;
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
  /** Périodes closes manquées d'affilée, juste avant celle en cours. */
  missedInRow: number;
  /** Recul de la période en cours si elle est manquée, en étapes ; `Infinity` : retour à la graine. */
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

/** Recul de la `missed`-ième période manquée d'affilée (1 : la première). */
const lossOf = (rules: RootRules, missed: number): number =>
  rules.losses.length === 0 ? 0 : rules.losses[Math.min(missed, rules.losses.length) - 1];

/**
 * Niveau de la racine à `nowMs`, rejoué période par période depuis celle de la
 * plus vieille session. Une session compte dans la période où elle commence ;
 * celles d'après `nowMs` sont ignorées.
 */
export const rootGrowth = (sessions: readonly RootSession[], goalMin: number, nowMs: number, rules: RootRules = ROOT_RULES): RootGrowth => {
  const days = wholeDays(rules.periodDays);
  const goal = Math.max(1, goalMin);
  const growthSteps = Math.max(1, Math.round(rules.growthSteps));
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
  let missed = 0;
  let losing = false;
  for (let i = first; i < current; i++) {
    const held = (minutesOf.get(i) ?? 0) >= goal;
    losing = !held && level > 0;
    if (held) {
      missed = 0;
      level += 1;
    } else {
      missed += 1;
      level = Math.max(0, level - lossOf(rules, missed));
    }
    maxLevel = Math.max(maxLevel, level);
  }

  const minutes = minutesOf.get(current) ?? 0;
  return {
    level, maxLevel, growthSteps, fraction: level / growthSteps,
    periodIndex: current, periodStartMs: periodStart(current, days), periodEndMs: periodStart(current + 1, days),
    minutes, held: minutes >= goal, progress: Math.min(1, minutes / goal),
    missedInRow: missed, lossStep: lossOf(rules, missed + 1), losing,
  };
};

/** Niveau en clair : entier, ou une décimale pendant une animation. */
export const levelText = (level: number): string =>
  level.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
