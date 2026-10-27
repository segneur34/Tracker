/**
 * Valeur d'une variable de `tokens.css` dans la palette claire, quel que soit
 * le thème posé sur la page : lue sur un élément `.theme-light`, qui la
 * reprend (`tokens.css`). Pour ce qui reste clair en thème sombre : l'image
 * de partage (décision du 28/10).
 */
export const lightToken = (name: string, fallback: string): string => {
  if (typeof document === 'undefined') return fallback;
  const probe = document.createElement('span');
  probe.className = 'theme-light';
  probe.hidden = true;
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).getPropertyValue(name).trim();
  probe.remove();
  return value || fallback;
};
