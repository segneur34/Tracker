import { useCallback, useMemo, useState } from 'react';
import { ELEVATION_PRESETS, SPORT_PROFILES, getSportProfile } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import { SPEED_UNIT_LABEL, type SpeedUnit } from '../core/units';
import { jsonStore } from '../platform/storage';

/** Taille du texte des tableaux et synthèses, en facteur d'échelle. */
export type TextScale = 'compact' | 'normal' | 'large';

export const TEXT_SCALE_FACTOR: Record<TextScale, number> = {
  compact: 0.85,
  normal: 1,
  large: 1.25,
};

export const TEXT_SCALE_LABEL: Record<TextScale, string> = {
  compact: 'Compact',
  normal: 'Normal',
  large: 'Grand',
};

export type TerrainType = keyof typeof ELEVATION_PRESETS;

export const TERRAIN_LABEL: Record<TerrainType, string> = {
  route: 'Route / chemin roulant',
  trail: 'Trail / montagne',
};

/** Unités d'affichage proposées selon la famille de support. */
export const SAILING_UNITS: SpeedUnit[] = ['kn', 'kmh', 'ms'];
export const RUNNING_UNITS: SpeedUnit[] = ['kmh', 'ms', 'minkm'];

/**
 * Réglages de support : quel support est analysé, et avec quel seuil d'activité.
 *
 * Le seuil est volontairement modifiable : 8 nœuds ne vaut qu'en wingfoil, la
 * planche à voile, le kite et le bateau ont des valeurs différentes, et le
 * réglage fin dépend aussi du matériel et du pratiquant. Le profil ne fournit
 * qu'un point de départ, la surcharge de l'utilisateur prime et survit au
 * rechargement de la page.
 */

const STORAGE_KEY = 'tracker.sportSettings';

export interface StoredSettings {
  sport?: SportType;
  /** Surcharges du seuil d'activité, par support, dans l'unité du profil. */
  thresholds?: Partial<Record<SportType, number>>;
  /** Terrain retenu pour le dénivelé, par support. */
  terrains?: Partial<Record<SportType, TerrainType>>;
  /** Unité d'affichage des vitesses, par support. */
  speedUnits?: Partial<Record<SportType, SpeedUnit>>;
  /** Taille du texte, par support. */
  textScales?: Partial<Record<SportType, TextScale>>;
  /** Bornes du dégradé de couleur de la trace, en m/s, par support. */
  speedRanges?: Partial<Record<SportType, { minMs: number; maxMs: number }>>;
  /**
   * Allure de session imposée, en m/s, par support. Absente, elle est déduite
   * de la trace : c'est le cas courant, et la surcharge ne sert qu'aux
   * sessions que leur propre vitesse décrit mal.
   */
  referenceSpeeds?: Partial<Record<SportType, number>>;
}

export const isKnownTerrain = (value: unknown): value is TerrainType =>
  typeof value === 'string' && value in ELEVATION_PRESETS;

export const isKnownSpeedUnit = (value: unknown): value is SpeedUnit =>
  typeof value === 'string' && value in SPEED_UNIT_LABEL;

export const isKnownTextScale = (value: unknown): value is TextScale =>
  typeof value === 'string' && value in TEXT_SCALE_FACTOR;

const readStored = (): StoredSettings => jsonStore.read<StoredSettings>(STORAGE_KEY) ?? {};

const writeStored = (settings: StoredSettings): void => jsonStore.write(STORAGE_KEY, settings);

const isKnownSport = (value: unknown): value is SportType =>
  typeof value === 'string' && value in SPORT_PROFILES;

/** Réglages d'un support tels que la page Paramètres les présente. */
export interface SportSettingsView {
  sport: SportType;
  speedUnit: SpeedUnit;
  isSpeedUnitOverridden: boolean;
  activeThreshold: number;
  isThresholdOverridden: boolean;
  textScale: TextScale;
  terrain: TerrainType;
  speedRange: { minMs: number; maxMs: number } | null;
}

/**
 * Accès à tous les supports à la fois, pour la page Paramètres. Chaque
 * modification est écrite immédiatement dans le navigateur ; les modules la
 * lisent à leur prochain affichage.
 */
export const useAllSportSettings = () => {
  const [stored, setStored] = useState<StoredSettings>(readStored);

  const persist = useCallback((next: StoredSettings) => {
    setStored(next);
    writeStored(next);
  }, []);

  const view = useCallback(
    (sport: SportType): SportSettingsView => {
      const profile = getSportProfile(sport);
      const unit = stored.speedUnits?.[sport];
      const threshold = stored.thresholds?.[sport];
      const scale = stored.textScales?.[sport];
      const terrain = stored.terrains?.[sport];
      const range = stored.speedRanges?.[sport];
      return {
        sport,
        speedUnit: isKnownSpeedUnit(unit) ? unit : profile.speedUnit,
        isSpeedUnitOverridden: isKnownSpeedUnit(unit),
        activeThreshold: threshold ?? profile.defaultActiveThreshold,
        isThresholdOverridden: threshold !== undefined,
        textScale: isKnownTextScale(scale) ? scale : 'normal',
        terrain: isKnownTerrain(terrain) ? terrain : 'route',
        speedRange: range && range.maxMs > range.minMs ? range : null,
      };
    },
    [stored]
  );

  /** Écrit ou efface (`null`) un réglage d'un support. */
  const setFor = useCallback(
    <F extends 'speedUnit' | 'activeThreshold' | 'textScale' | 'terrain' | 'speedRange'>(
      sport: SportType,
      field: F,
      value: SportSettingsView[F] | null
    ) => {
      const next: StoredSettings = { ...stored };
      const put = <T,>(map: Partial<Record<SportType, T>> | undefined, v: T | null): Partial<Record<SportType, T>> => {
        const copy = { ...map };
        if (v === null) delete copy[sport];
        else copy[sport] = v;
        return copy;
      };
      switch (field) {
        case 'speedUnit':
          if (value !== null && !isKnownSpeedUnit(value)) return;
          next.speedUnits = put(stored.speedUnits, value as SpeedUnit | null);
          break;
        case 'activeThreshold':
          if (value !== null && (typeof value !== 'number' || !isFinite(value) || value < 0)) return;
          next.thresholds = put(stored.thresholds, value as number | null);
          break;
        case 'textScale':
          if (value !== null && !isKnownTextScale(value)) return;
          next.textScales = put(stored.textScales, value as TextScale | null);
          break;
        case 'terrain':
          if (value !== null && !isKnownTerrain(value)) return;
          next.terrains = put(stored.terrains, value as TerrainType | null);
          break;
        case 'speedRange': {
          const r = value as { minMs: number; maxMs: number } | null;
          if (r !== null && !(isFinite(r.minMs) && isFinite(r.maxMs) && r.minMs >= 0 && r.maxMs > r.minMs)) return;
          next.speedRanges = put(stored.speedRanges, r);
          break;
        }
      }
      persist(next);
    },
    [persist, stored]
  );

  return { view, setFor };
};

/**
 * @param defaultSport support retenu tant que l'utilisateur n'en a pas choisi un.
 * @param allowedSports supports que ce module accepte. Le support mémorisé
 *   n'est repris que s'il en fait partie : le module course ne doit pas
 *   hériter du wingfoil choisi dans le module voile, avec ses nœuds et son
 *   seuil de vol.
 */
export const useSportSettings = (defaultSport: SportType, allowedSports: SportType[] = [defaultSport]) => {
  const [stored, setStored] = useState<StoredSettings>(readStored);

  const sport =
    isKnownSport(stored.sport) && allowedSports.includes(stored.sport) ? stored.sport : defaultSport;
  const profile = useMemo(() => getSportProfile(sport), [sport]);

  const activeThreshold = stored.thresholds?.[sport] ?? profile.defaultActiveThreshold;
  const isThresholdOverridden = stored.thresholds?.[sport] !== undefined;

  const persist = useCallback((next: StoredSettings) => {
    setStored(next);
    writeStored(next);
  }, []);

  const setSport = useCallback(
    (next: SportType) => {
      if (!isKnownSport(next) || !allowedSports.includes(next)) return;
      persist({ ...stored, sport: next });
    },
    [persist, stored, allowedSports]
  );

  const setActiveThreshold = useCallback(
    (value: number) => {
      if (!isFinite(value) || value < 0) return;
      persist({ ...stored, thresholds: { ...stored.thresholds, [sport]: value } });
    },
    [persist, sport, stored]
  );

  /** Revient au défaut du support courant. */
  const resetActiveThreshold = useCallback(() => {
    const thresholds = { ...stored.thresholds };
    delete thresholds[sport];
    persist({ ...stored, thresholds });
  }, [persist, sport, stored]);

  const storedTerrain = stored.terrains?.[sport];
  const terrain: TerrainType = isKnownTerrain(storedTerrain) ? storedTerrain : 'route';
  const elevationProfile = ELEVATION_PRESETS[terrain];

  const setTerrain = useCallback(
    (next: TerrainType) => {
      if (!isKnownTerrain(next)) return;
      persist({ ...stored, terrains: { ...stored.terrains, [sport]: next } });
    },
    [persist, sport, stored]
  );

  const storedUnit = stored.speedUnits?.[sport];
  const speedUnit: SpeedUnit = isKnownSpeedUnit(storedUnit) ? storedUnit : profile.speedUnit;
  const setSpeedUnit = useCallback(
    (next: SpeedUnit) => {
      if (!isKnownSpeedUnit(next)) return;
      persist({ ...stored, speedUnits: { ...stored.speedUnits, [sport]: next } });
    },
    [persist, sport, stored]
  );

  const storedScale = stored.textScales?.[sport];
  const textScale: TextScale = isKnownTextScale(storedScale) ? storedScale : 'normal';
  const setTextScale = useCallback(
    (next: TextScale) => {
      if (!isKnownTextScale(next)) return;
      persist({ ...stored, textScales: { ...stored.textScales, [sport]: next } });
    },
    [persist, sport, stored]
  );

  const storedRange = stored.speedRanges?.[sport];
  const speedRange =
    storedRange && isFinite(storedRange.minMs) && isFinite(storedRange.maxMs) && storedRange.maxMs > storedRange.minMs
      ? storedRange
      : null;
  const setSpeedRange = useCallback(
    (next: { minMs: number; maxMs: number } | null) => {
      const speedRanges = { ...stored.speedRanges };
      if (next === null) delete speedRanges[sport];
      else if (isFinite(next.minMs) && isFinite(next.maxMs) && next.minMs >= 0 && next.maxMs > next.minMs) speedRanges[sport] = next;
      else return;
      persist({ ...stored, speedRanges });
    },
    [persist, sport, stored]
  );

  const storedReference = stored.referenceSpeeds?.[sport];
  /** Allure imposée par l'utilisateur, en m/s, ou `null` si elle est déduite de la trace. */
  const referenceSpeed =
    storedReference !== undefined && isFinite(storedReference) && storedReference > 0
      ? storedReference
      : null;
  const setReferenceSpeed = useCallback(
    (next: number | null) => {
      const referenceSpeeds = { ...stored.referenceSpeeds };
      if (next === null) delete referenceSpeeds[sport];
      else if (isFinite(next) && next > 0) referenceSpeeds[sport] = next;
      else return;
      persist({ ...stored, referenceSpeeds });
    },
    [persist, sport, stored]
  );

  return {
    sport,
    setSport,
    profile,
    activeThreshold,
    setActiveThreshold,
    resetActiveThreshold,
    isThresholdOverridden,
    terrain,
    setTerrain,
    elevationProfile,
    speedUnit,
    setSpeedUnit,
    textScale,
    setTextScale,
    /** Bornes du dégradé choisies par l'utilisateur, ou `null` pour le défaut du module. */
    speedRange,
    setSpeedRange,
    /** Allure de session imposée, en m/s, ou `null` si elle est déduite de la trace. */
    referenceSpeed,
    setReferenceSpeed,
  };
};
