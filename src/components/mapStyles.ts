import L from 'leaflet';

/**
 * Styles et repères communs aux cartes (données de carte, donc en dur).
 */

/**
 * Liseré blanc sous un trait d'épaisseur `weight` sur le fond satellite : la
 * trace reste lisible sur la mer, la forêt ou les toits. Une seule épaisseur
 * partout, trait + 3 (analyses, direct, planification). Un appelant le fige
 * en constante de module : react-leaflet ne réapplique un style que si l'objet
 * change (règle 11).
 */
export const haloStyle = (weight: number) => ({ color: '#ffffff', weight: weight + 3, opacity: 0.85, interactive: false }) as const;

/**
 * Cache de repères `divIcon`, un par endroit : un repère est fabriqué une fois
 * par clé et gardé d'un rendu à l'autre, et Leaflet ne le redessine que s'il
 * change.
 */
export const divIconCache = (): ((key: string, build: () => L.DivIconOptions) => L.DivIcon) => {
  const icons = new Map<string, L.DivIcon>();
  return (key, build) => {
    let icon = icons.get(key);
    if (!icon) {
      icon = L.divIcon(build());
      icons.set(key, icon);
    }
    return icon;
  };
};
