# 120 · Petit ménage relevé par l'audit du 01/11

Brief écrit le 01/11 (paquet de 5 du 01/11 : 119, 120, 112, 114, 121). Modèle | Réflexion : Sonnet | medium. Résultat attendu : rien de visible, du code plus léger ; le banc avant et après doit rendre le même texte.

## À faire

1. **Bloc copié : fermeture d'un menu posé sur la page.** `components/BaseTileLayer.tsx` (effet vers les lignes 138 à 150 : `pointerdown` et `keydown` sur `document`, fermeture au clic dehors et à Échap) et `components/ui/MoreMenu.tsx` (même effet, lignes 25 à 37) font la même chose. Écrire une fois ce comportement dans un hook de `components/ui/` (par exemple `useDismiss(ref, open, onClose)`), et l'employer aux deux endroits. Même ordre des écouteurs, mêmes conditions (touche, cible dans ou hors du bloc) : rien ne change pour l'utilisateur.
2. **Bloc copié : feuille de choix d'une activité et du matériel.** `components/ActivitySelect.tsx` et `components/GearPicker.tsx` portent la même feuille (`activity-select__sheet`, `role="listbox"`, options `role="option"`, fermeture à Échap par `window.addEventListener('keydown')`, retour du focus). Mettre en commun ce qui est identique (la feuille, son ouverture et sa fermeture, la touche Échap, le rendu d'une option) dans une pièce de `components/ui/` ; chaque composant garde ce qui lui est propre (groupes par famille et couleurs des activités d'un côté, groupes de matériel de l'autre). Les classes CSS et les attributs ARIA restent les mêmes : le banc compare le texte de la page, et les scripts cliquent sur ces rôles.
3. **Flèches de vent posées deux fois en plein écran.** `pages/SailingModule.tsx`, `arrowLayers` (vers la ligne 429, rendues vers la ligne 895) : un `Marker` Leaflet tous les `ARROW_EVERY_S` (360 pour 4 h), et la carte en plein écran les reçoit une seconde fois. Lire comment la carte est rendue en plein écran (`AnalysisMap`, `docs/MISE_EN_PAGE.md`) et faire qu'elles ne soient posées qu'une fois par carte visible, sans en changer le nombre ni la position. Si les deux cartes existent vraiment en même temps (petite et plein écran), dire dans le rapport ce qu'il en est et ne rien casser.
4. **Alertes des outils de développement** (`glob` et `minimatch`, tirés par `@capacitor/cli` › `rimraf`) : ne rien faire dans ce lot, elles se lèvent à la prochaine mise à jour de Capacitor ; le dire dans le rapport.

## Vérifications

`npm run verif` ; puis le banc, lancé par l'orchestrateur : `general`, `onglets`, `materiel`, `activite`, `bench` (voile, plein écran compris si un script le fait), texte identique avant et après.

## Ce que le lot ne fait pas

Pas de commit, pas de version, aucune décision de l'utilisateur. Ne pas toucher à `sailing/` (lot 112 en parallèle), à `outils/banc/` (lot 114), ni à `pages/SessionLibrary.tsx`, `components/drawTrackPreview.ts`, `library/previewStore.ts`, `platform/previewStore.ts`, `platform/tileCache.ts` (lot 121). Si un de ces fichiers doit être touché, le dire dans le rapport au lieu de le faire. Rien dans `docs/` hors ce fichier.
