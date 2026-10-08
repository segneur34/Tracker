import type { JumpProfile } from '../core/sportProfiles';

/**
 * Réglages des sauts d'une activité de voile, tels que Réglages les présente :
 * la case « Sauts » et ses sous-options. Le foil, réglage de l'activité à part
 * entière, n'en fait pas partie (`StoredSettings.foils`).
 *
 * La mesure elle-même est faite par les capteurs du téléphone pendant
 * l'enregistrement (`platform/motion.ts`), et rangée dans un fichier `.imu` à
 * côté du GPX.
 */

/** Où le téléphone est fixé : règle les seuils de détection et dit la précision à attendre. */
export type JumpPlacement = 'poitrine' | 'taille' | 'bras' | 'dos';

/** Dans l'ordre de la liste, le conseillé en tête. */
export const JUMP_PLACEMENTS: JumpPlacement[] = ['poitrine', 'taille', 'bras', 'dos'];

export const JUMP_PLACEMENT_LABEL: Record<JumpPlacement, string> = {
  poitrine: 'Poitrine (gilet, harnais haut)',
  taille: 'Taille (harnais, ceinture)',
  bras: 'Bras (brassard)',
  dos: 'Dos (sac)',
};

/** Précision à attendre, en clair, selon l'emplacement (estimation, à confirmer sur l'eau). */
export const JUMP_PLACEMENT_HINT: Record<JumpPlacement, string> = {
  poitrine: 'conseillé : le buste suit le corps',
  taille: 'bien : près du centre du corps',
  bras: 'moins précis : le bras bouge pendant le saut (±0,3 à 0,5 m de plus)',
  dos: 'moins précis si le sac ballotte',
};

export const DEFAULT_JUMP_PLACEMENT: JumpPlacement = 'poitrine';

/** Hauteur minimale réglable, en mètres. */
export const JUMP_MIN_HEIGHT_RANGE = { min: 0, max: 10 } as const;

export interface JumpSettings {
  /** Case « Sauts » : la mesure est proposée à l'enregistrement. */
  enabled: boolean;
  placement: JumpPlacement;
  /** Sauts plus bas non montrés, en mètres. */
  minHeightM: number;
}

export const isJumpPlacement = (value: unknown): value is JumpPlacement =>
  typeof value === 'string' && (JUMP_PLACEMENTS as string[]).includes(value);

const isMinHeight = (value: unknown): value is number =>
  typeof value === 'number' && isFinite(value) && value >= JUMP_MIN_HEIGHT_RANGE.min && value <= JUMP_MIN_HEIGHT_RANGE.max;

/** Réglages d'une activité qui n'en a pas : sauts non mesurés, téléphone sur la poitrine, hauteur du calcul. */
export const defaultJumpSettings = (profile: JumpProfile): JumpSettings => ({
  enabled: false,
  placement: DEFAULT_JUMP_PLACEMENT,
  minHeightM: profile.defaultMinHeightM,
});

/**
 * Réglages relus : `null` s'ils ne sont pas un objet. Un champ absent ou mal
 * formé reprend sa valeur par défaut.
 */
export const sanitizeJumpSettings = (raw: unknown, profile: JumpProfile): JumpSettings | null => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const fallback = defaultJumpSettings(profile);
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : fallback.enabled,
    placement: isJumpPlacement(value.placement) ? value.placement : fallback.placement,
    minHeightM: isMinHeight(value.minHeightM) ? value.minHeightM : fallback.minHeightM,
  };
};
