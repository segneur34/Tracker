# 165 · Retouches d'analyses : « + carte » après zoom, liste des manœuvres, sauts selon l'option, appréciations en icônes, kilomètres

Brief écrit le 05/11 (paquet « Nouveautés à l'écran », plan approuvé : `~/.claude/plans/nouveaut-s-l-cran-fancy-reef.md`). Modèle | Réflexion : Opus | medium. Passe avant le 145, qui touche aussi `LandModule.tsx` et `SailingModule.tsx`. Cinq retouches indépendantes, chacune petite ; aucune décision à prendre, tout est tranché ci-dessous.

## A. Bogue : « + carte » après un zoom (bogue, en tête)

Tel que noté (05/11, 07:32) : « dans analyse graphique : si je commence à zoomer sur le graphe et que je fais "+carte", l'attendu est que le mode de lecture carte + graphe s'ouvre proprement ; mais si j'ai déjà zoomé, le bouton +carte devient le bouton "afficher" : il affiche sur la carte mais ne change pas de mode de lecture. »

Où : `src/hooks/useZoomOnMap.ts`, `show` (lignes 121-156). Le libellé ne change pas (`ZoomableChart.tsx:249` : « +carte » dès que l'écran est étroit et hors plein écran). Ce qui se passe : zoomé, dans la page du téléphone, `show` allume le tronçon puis s'arrête si la carte est entière à l'écran (`mapOnScreen()`, ligne 149 : « carte entière à l'écran, elle se cadre sur place », décision du 25/10, DECISIONS §2 « +carte »). L'utilisateur juge ce raccourci cassé : décision renversée le 05/11.

Voulu : dans la page du téléphone (`narrow && !mapExpanded`), « + carte » ouvre **toujours** le plein écran carte + graphes de l'onglet (`setCompanionPanel(target)` puis `openMap()`), zoomé ou non ; zoomé, il allume aussi le tronçon et cadre la carte dessus, comme aujourd'hui. Le raccourci « carte à l'écran, cadrage sur place » ne reste que sur ordinateur (`scrollToMap`). Le second clic à la même plage (retrait du tronçon) garde son sens dans le plein écran (bouton « Afficher »), pas dans la page du téléphone où le bouton ouvre le plein écran. Mettre à jour le commentaire de tête du hook.

Banc : `outils/banc/zoom-carte.mjs` échoue déjà sur la page course avant ce lot (n° 163, relevé au lot 144 : « général : nom et lecture au-dessus du profil », lecture rendue « Altitude 195 m, pente -5 %, 2,7 km », repère à -6 px). Dans ce lot : dire si c'est le script ou la page qui a bougé, remettre le script d'accord avec la page (sans toucher au lot 144), puis adapter l'étape 5 (« carte entière à l'écran : elle se cadre sur place » devient « elle ouvre le plein écran carte + graphes, tronçon allumé ») ; le script doit finir vert. Tu peux lancer `node outils/banc/passe.mjs zoom-carte --sans-cache` toi-même (un seul banc à la fois ; l'orchestrateur ne lance pas le banc pendant ton travail) ; mets à jour la ligne du script dans `outils/banc/SCRIPTS.md` (tableau des scripts et verdicts), rien d'autre dans `docs/`.

## B. Voile : la longue liste des manœuvres sous un bouton

Tel que noté (04/11, 23:15) : « dans les analyses de voile, détail des manœuvres, on a une longue liste des manœuvres, il faut pouvoir la cacher sous un bouton détail. »

Où : `src/pages/SailingModule.tsx` 970-981 : sous « Détails », après le tableau du podium de chaque type (virements, empannages), la liste `<ul>` de toutes les manœuvres du type (heure, réussi ou raté, Vmin, notes).

Voulu : cette liste repliée par défaut sous un bouton `Button size="s"` avec `aria-expanded`, « Tous les virements (n) ▼ » / « Replier les virements ▲ » (de même « empannages »), exactement sur le modèle de « Tous les vols (n) ▼ » de `src/components/FlightPumpingPanel.tsx:282`. Un état par type (deux `useState`, ou un `Record`), non mémorisé. Le tableau du podium et son choix « Carte » ne bougent pas ; le sélecteur « Résumé / Détails » non plus. Sans manœuvre du type, pas de bouton.

## C. Sauts : proposés seulement si l'option de l'activité est cochée

Tel que noté (04/11, 10:49) : « Proposer la mesure des sauts que si option saut cochée dans les options de l'enregistrement dans les paramètres. De base désactivé partout sauf voile et VTT. »

Où, aujourd'hui : Réglages porte déjà, par activité, une case « Mesurer les sauts » (`src/pages/SettingsPage.tsx:92-96`, résolue par `src/settings/activitySettings.ts:487` : réglage enregistré, sinon pré-réglage, sinon `defaultJumpSettings` de `src/recording/jumpSettings.ts:46`, `enabled: false`) ; le pré-réglage WING (`src/settings/activityPresets.ts:78`, wingfoil et windsurf) l'active. Enregistrer (`src/pages/RecordingPage.tsx:883`) montre la case « Mesurer les sauts » dès que le calcul a un profil de sauts, cochée d'après le réglage (`usePerActivityChoice`, ligne 661). L'onglet « sauts » des analyses est proposé dès que le calcul a un profil (`src/core/analysisTabs.ts:124`), DECISIONS §3 et §11 « Onglets choisis par activité ».

Voulu :
1. Enregistrer : la case « Mesurer les sauts » (et « Sauts et pumping ») n'est **proposée** que si la case « Mesurer les sauts » de l'activité est cochée dans Réglages ; elle est alors cochée par défaut, et l'utilisateur peut la décocher pour une séance (comme aujourd'hui). Décochée dans Réglages : rien n'est proposé ni capturé, pas même la ligne dans le récapitulatif de la notification (`RecordingPage.tsx:806`). Le pumping du surf (`treatment === 'surf'`) ne dépend pas de cette case : inchangé.
2. Analyses : l'onglet « sauts » n'est proposé (barre, Réglages › Onglets) que si l'activité a la case cochée **ou** si la session porte une capture de sauts (fiche avec `.imu` ou sauts résumés) : une session enregistrée avec des sauts garde son onglet même si l'option a été décochée depuis. Trouver la pièce qui donne les onglets d'une activité (Réglages › Onglets, `analysisTabs`, `useSportSettings`) et y passer le réglage des sauts ; ne pas changer la signature de `analysisTabs(profile)` si une surcouche suffit.
3. Défaut : coché pour les activités de **voile** (wingfoil, windsurf, kite ; le bateau n'a pas de profil de sauts) et pour le **VTT** (`'a-vtt'`, `activityPresets.ts:154`) ; décoché partout ailleurs (course, marche, route, gravel, fractionnés, surf qui n'a pas de sauts). Si le kite et le VTT n'ont pas de pré-réglage de sauts aujourd'hui, l'ajouter (poitrine, hauteur du calcul). Un pré-réglage changé efface une fois les anciens réglages qu'il couvre (`PRESET_RESETS`, CLAUDE.md « Pré-réglages ») : l'appliquer pour que les téléphones déjà réglés prennent le nouveau défaut.
4. Tests : `activityPresets.test.ts` et `activitySettings.test.ts` pour les défauts ; un test de la surcouche des onglets (activité cochée, décochée, session avec capture).

## D. Appréciations sans emoji (n° 41)

Noté le 15/10 (§11 « Relecture du 15/10 », point 114), voulu le 05/11. Où : `src/library/notes.ts:84-90` (`RATINGS`, cinq niveaux avec emoji), affichées par `src/components/SessionNotesPanel.tsx:141-152` seulement.

Voulu : cinq icônes de `src/components/icons.tsx` (visages stylisés, trait de l'échelle existante des icônes, du plus triste au plus content ; couleur par `currentColor`), à la place des emoji ; `RATINGS` garde `value` et `label`, le champ `emoji` est remplacé par un nom d'icône (ou une clé), sans emoji nulle part (CLAUDE.md : « icônes dans `components/icons.tsx`, pas d'emoji »). Le choix se fait toujours au tap sur l'icône, l'icône choisie en couleur de la famille, les autres grisées, libellé sous l'icône ou au survol comme aujourd'hui. Fiches inchangées (`rating` reste 1 à 5). Grep sur `emoji` et `RATINGS` pour les autres lecteurs (bibliothèque, image de partage) : aucun emoji ne doit rester.

## E. Splits par kilomètre, course et vélo (n° 97)

Noté le 30/10 (ex-n° 28). Décision du 05/11 : dans l'onglet « tops » (`TopsPanel`, partagé, famille À pied et Vélo seulement, pas la voile ni le surf), un repli « Par kilomètre » sur le modèle des replis de graphes (`ChartFold`) ou du bouton « Tous les … (n) », fermé par défaut.

Voulu :
- Calcul pur neuf `src/running/kilometerSplits.ts` : découpe de la trace en tranches de 1 km de distance retenue (règle 6 : `segmentDistanceM`, en m), la dernière partielle marquée ; par tranche : rang, distance (m), durée (s), vitesse moyenne (m/s), D+ (m) et D- (m) si altitude, FC moyenne si FC. Entrée : la trace cinématique (`PointData` ou la structure que `LandModule` tient), unité SI (règle 1) ; fenêtre en distance, jamais en nombre de points (règle 2 : test 1 Hz et 5 Hz égaux). Pauses : les tranches suivent le temps total (le temps en mouvement en colonne de plus si la pièce est déjà là, sinon pas). Test synthétique `kilometerSplits.test.ts` (trace en ligne droite à vitesse connue : tranches exactes ; dernière partielle ; 1 Hz = 5 Hz ; sans altitude ni FC).
- Affichage dans `TopsPanel` (course et vélo) : tableau « km · temps · allure ou vitesse (unité de l'activité, allure en min/km là où la vitesse s'affiche en allure) · D+ · FC », formats de `core/units.ts` (virgule décimale, durées espacées) ; la dernière tranche partielle affichée avec sa distance (« 0,6 km »). Milles : si l'activité est en milles nautiques, tranches d'un mille (libellé « Par mille »), l'unité de distance de l'activité fait foi. Pas de surbrillance sur la carte dans ce lot (à noter dans le rapport si c'est facile par `useMapHighlight`, ne pas le faire).
- Mise en page : `docs/MISE_EN_PAGE.md` (panneau, titre, téléphone : tableau qui défile horizontalement dans `an-man-scroll` ou équivalent).

## Ne pas toucher

- Barre d'onglets, « général » / « avancé », flèches de sens, image de partage, graphe cardio, Entraînement : lot 145, qui passe après.
- `docs/` hors `outils/banc/SCRIPTS.md` (ligne du script `zoom-carte`).

## Vérification

- `node outils/verif.mjs --rapide` après chaque partie ; tout vert avant de rendre.
- Banc, par l'orchestrateur après toi : `zoom-carte` (vert, verdicts), `general`, `brouillon-voile`, `sauts`, `notes`, `onglets`, `reglages`, `prereglages` : textes attendus changés là où ce lot change l'écran (bouton « Tous les virements (n) », case des sauts absente en course, icônes à la place des emoji, repli « Par kilomètre »), identiques ailleurs. Dis dans ton rapport quels textes doivent changer et où.
- À valider sur le téléphone (3 au plus, à proposer dans le rapport) : zoomer un graphe puis « + carte » ; Enregistrer en course sans case « Mesurer les sauts », en wing et en VTT avec ; le reste se prouve au banc.
