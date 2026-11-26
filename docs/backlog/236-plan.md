# 236 · Plan (agent Plan, 25/11 au soir) et choix tranchés

Brief : `docs/backlog/236-planification-reprises.md`. Source : Gtracker (`D:\gong tracker\Gtracker`, lecture seule), lots 458, 459, 460, 466, 467. Planche de Gtracker pour mémoire : `D:\gong tracker\atelier\planche-458-460` (lecture seule).

## Contexte

Le lot 215 est validé (DECISIONS §8) : le nom donné d'office peut s'appuyer sur le lieu. Planifier (`src/pages/PlanningPage.tsx`, 1 329 lignes) a déjà « Exporter le GPX » et « Supprimer l'itinéraire » dans son bloc « enregistrer », et « Supprimer » dans « mes itinéraires ». Il range « Itinéraire du JJ/MM/AAAA » comme nom (`defaultName`, l. 234 et 670). En voile et en surf, les onglets sont : parcours, tracé, balises (n), enregistrer, mes itinéraires.

## La planche, à 390 × 844, avant et après

- P1. En-tête de Planifier : un « … » dans `PageHeader aside`, à droite du titre (lot 466). Variante : à droite du champ Nom (lot 458). Entrées : Partager l'image, Partager le GPX, Exporter le GPX (ordinateur seulement), Supprimer puis « Supprimer définitivement / Garder » dans le menu resté ouvert. Partages grisés avec « Enregistrez d'abord les modifications » tant que l'itinéraire n'est pas rangé ou qu'il est modifié. Le bloc garde Enregistrer, Partir, Nouvel itinéraire et le champ Nom. « Charger un GPX » reste dans le bloc tracé.
- P2. Liste Itinéraires (`RoutesPage`) et bloc « mes itinéraires » : « … » = Partager l'image, Partager le GPX, Supprimer ; l'icône Partager reste en raccourci GPX.
- P3. Image de partage (1080 × 1920, cadre des sessions). Voile et surf : balises numérotées (départ vert, arrivée rouge), une pastille « distance · cap » par bord, rose du nord, 3 chiffres (distance, balises, plus long bord). Course et vélo : tracé bleu sur le fond de carte, ronds de départ et d'arrivée, chiffres distance, D+, D−, temps estimé (si l'activité a un niveau).
- P4. Noms donnés d'office (tableau de texte) : « Boucle à Carnon-Plage le 20/11 », « Aller de Carnon-Plage à Palavas-les-Flots le 20/11 », « Boucle à Montpellier le 20/11 », « Aller de Montpellier à Sète le 20/11 », sans lieu « Boucle du 20/11 ». Variante : l'activité devant (« Course · Boucle à … »).
- P5. Bloc réuni, voile et surf seulement : « tracé et balises (n) », enregistrer, mes itinéraires, puis « balises sonores » en dernier (si l'activité a des bips). Contenu : bande des 3 chiffres ; rangée Précédent, Inverser, Boucler, Charger un GPX, Tout effacer ; une ligne par balise « 2 · 1,60 km · 65° », touchée pour la déplier sur Monter, Descendre, Retirer.
- P6. Carte, téléphone droit : 58 vh (environ 490 px) contre 45 vh (environ 380 px), 5 balises posées.

Production : P1, P2, P5, P6 par ajout dans la page servie (classes existantes `MoreMenu`, `plan-actions`, `plan-course`, `plan-stats`) ; P3 course et vélo par un prototype jetable en copie de travail (un `RouteImageShare` minimal qui passe au vrai `ShareDialog` les tronçons et les chiffres, `drawShareImage` sert tel quel) ; P3 voile et surf : image de la planche de Gtracker, en disant que le cartouche suivra celui de Tracker ; P4 en HTML.

## Le lot, une fois la planche choisie (Opus/high ; A en Sonnet)

- A. Carte 45 % : `src/pages/PlanningPage.css` l. 98, `.plan-map` de 58vh à 45vh ; l'ordinateur (l. 500) et le téléphone tourné (l. 522) ont leurs règles ; `ResizablePanel` ignore la taille mémorisée sur écran étroit. Banc : `planning.mjs`.
- B. Nom donné d'office. À créer : `src/library/routeName.ts` (`routeKind`, `routeDisplayName`, `routeFileLabel` ; dans `library/` car `planning/` ne peut pas importer `library/`), `src/hooks/routePlace.ts` (un lieu à la fois, après le rangement et à l'ouverture dans Planifier, jamais pour toute la liste), avec leurs tests. À modifier : `src/planning/routeRecord.ts` (un nom vide relu vide, aujourd'hui remplacé par « Itinéraire » l. 152 ; la fiche gagne `place`), `src/hooks/routeFiles.ts` (nom du fichier figé au premier rangement), et pour lire le nom montré : `PlanningPage.tsx`, `RoutesPage.tsx`, `src/components/RouteList.tsx`, `FollowTracePicker.tsx`, `src/hooks/useGoOnRoute.ts`, `src/planning/routeList.ts`. À réutiliser : `placeLabel` (`library/sessionName.ts`), `readSessionPlace`, `placeSearchOf`, `localPlace`, `choosePlace`, `learnedPlace`, `PLACE_DEFAULTS` (`library/sessionPlace.ts`), `fetchPlaceSearch`, `isPlaceNetworkError` (`planning/placeQuery.ts`), `PLACE_PAUSE_MS`, `isLooped`.
- C. Menu « … » et image. À créer : `src/planning/routeShareImage.ts` (pur, testé), `src/components/RouteImageShare.tsx`, `src/components/drawRouteOverlay.ts` (voile et surf). À modifier : `src/components/drawShareImage.ts` (calque `course` facultatif), `src/components/ShareDialog.tsx` (`fixedStats`, `accent`, `description`, `course`, d'après 7703cf9), `PlanningPage.tsx`, `RoutesPage.tsx`. À réutiliser : `routeTotals`, `courseLegs`, `waypointDistances`, `markLabel`, `estimateDurationFromProfile`, `shareFileOf`, `remove`, `MoreMenu`, `SessionShareEntries`.
- D. Bloc réuni en voile et en surf : `PlanningPage.tsx` (sections l. 835-845, `PLANNING_SECTION_DEFAULTS`, bloc neuf d'id `planning.trace-balises`, l'ancien devient « Balises sonores ») et `PlanningPage.css`.
- Banc avant/après : `planning.mjs` (A, B, C), `partage.mjs` (C), `balises.mjs` et `planification-verrou.mjs` (D), `nom-lieu.mjs` identique ; à relire `activite.mjs`, `reglages-aide.mjs`, `surface.mjs`, `denivele-direct.mjs`.
- Essais au téléphone : la hauteur de carte au pouce ; l'image envoyée par le menu de partage d'Android.

## Tranché (mineur)

- Seuil pour citer l'arrivée : 5 km comme les sessions (§8), pas les 2 km de Gtracker.
- Le verrou de la carte ne change pas ; le nom donné d'office n'est jamais écrit dans la fiche, comme pour les sessions.
- DECISIONS §7, « Supprimer se fait depuis Itinéraires » : déjà dépassé (Planifier a « Supprimer l'itinéraire ») ; la suppression passe dans le « … », même confirmation, sans geste tenu.

## À poser sur la planche (majeur)

1. Place du « … » : en-tête ou à côté du nom. Défaut : en-tête.
2. Image en course et à vélo : chiffres fixes ou au choix, bande de revêtement ou non. Défaut : fixes, sans revêtement.
3. L'activité devant le nom. Défaut : non.
4. Carte à 45 %. Défaut : oui.

## Non vérifié par le plan

Un réglage qui interdirait la recherche de lieu en ligne ; le format de date court « 20/11 » (`core/calendar.ts` n'a que `shortDate`) ; les leçons et aides qui citent les anciens blocs.

## Choisi par l'utilisateur le 26/11, sur la planche (https://claude.ai/artifact/7bHCMZHxbuKTcwD3KXEo6P)

- Menu « … » de Planifier : le proposé, en haut à droite du titre ; Partager l'image, Partager le GPX, Supprimer (avec la confirmation dans le menu) ; « Exporter le GPX » sur ordinateur seulement.
- Liste des itinéraires : le proposé ; « … » = Partager l'image, Partager le GPX, Supprimer ; l'icône de partage reste en raccourci vers le GPX.
- Image de partage d'un itinéraire : le proposé (chiffres fixes : distance, D+, D−, temps estimé à pied et à vélo). La bande du revêtement doit être UN CHOIX de l'utilisateur dans la fenêtre de partage (à pied et à vélo), ni toujours là ni jamais. L'image de voile et de surf lui convient (balises numérotées, une pastille « distance · cap » par bord, rose du nord, trois chiffres), au cadre et au cartouche de Tracker.
- Noms donnés d'office : le proposé, sans l'activité devant (« Boucle à Montpellier le 20/11 ») ; un nom saisi prime toujours.
- Tracé et balises réunis en voile et en surf : oui.
- Hauteur de la carte de Planifier au téléphone droit : ni 58 % ni 45 %, un entre-deux à 50 % de l'écran.
- À ne pas oublier au code (vu en fabriquant la planche) : la rangée Précédent, Inverser, Boucler, Charger un GPX, Tout effacer tient sur trois lignes à 390 px, à resserrer ; la ligne dépliée d'une balise (Monter, Descendre, Retirer) débordait.
- La planche est validée : le lot peut se coder (sous-lots A à D du plan, la carte à 50 % au lieu de 45 %).
