# 158 · Navigation et écrans : messages en anglais, Statistiques et Profil sans mémoire, filtre perdu, itinéraires relus, barres d'Android, pluriels

Noté le 03/11 (audit avant vente, synthèse `~/.claude/plans/audit-vente-0111/RAPPORT.md`, lignes C5 à C9, C11, C12, C13 ; détail dans `angle-T7.md` (T7-1, T7-3, T7-4, T7-5, T7-8), `angle-C7b.md` (C7b-1, C7b-2, C7b-6), `angle-C8.md` (C8-1, C8-2), `angle-C4.md` (C4-4, C4-5), `angle-T2.md` (T2-5), `angle-C5.md` (C5-12)). Modèle | Réflexion : Sonnet | medium (high pour les barres d'Android).

## Tel que noté

- « Messages techniques en anglais à l'écran : "User denied location permission" au premier refus du GPS, et ≈ 45 endroits qui recollent le texte brut d'une exception Java ou JS ("Lecture impossible : Missing file for primary…"). » (élargit le n° 122, rangé dans le 143)
- « Statistiques et Profil : "Aucune session" quand le dossier mémoire est inaccessible, sans en donner la raison ; le Profil affiche toujours des km et une tuile "Dénivelé" quelle que soit l'unité réglée. »
- « Bibliothèque : le filtre d'activité et la place dans la liste sont perdus à chaque retour d'une analyse. »
- « Itinéraires relus en entier (listage + une lecture par fiche) à chaque montage de chaque page, avec "(0)" affiché un instant. »
- « Barres d'Android : leur fond suit le mode du téléphone, leurs icônes suivent le thème de l'appli (sans `viewport-fit=cover`, la page ne passe jamais sous les barres) : appli en "Sombre" sur un téléphone clair = icônes blanches sur fond crème. »
- « Le retour d'Android ne ferme ni le menu "…", ni le menu des fonds de carte, ni les surcouches de Planifier. »
- « "1 manœuvres" sur chaque vignette voile, "1.23 m" (point décimal) dans les sauts, "sur 1 sessions" dans le Profil. »
- « Pause manuelle : la durée figée rattrape d'un coup toute la pause à la reprise ; et l'alerte dit "le GPS est coupé", faux depuis le lot 104. »

## Où, aujourd'hui (vérifié au commit 312d13c)

- `platform/location.ts:176,214` (`error.message` du greffon transmis tel quel) ; `core/basics.ts:109` `errorMessage` (67 appels) ; greffons Java qui ajoutent `e.getMessage()`.
- `pages/StatisticsPage.tsx:536-554`, `pages/ProfilePage.tsx:170-225` (`toDisplayDistance(…, 'km')`, tuile Dénivelé toujours là ; Statistiques suit `effectiveDistanceUnit` et `isLandFamily`).
- `pages/SessionLibrary.tsx:568` (`useState` depuis l'adresse), `components/AnalysisShell.tsx:74` (`libraryPath(family)` sans activité), `core/parentPage.ts:91` ; aucun `scrollRestoration`.
- `hooks/useRouteLibrary.ts:52-79` (un `listRoutes` et un `readText` par fiche dans chaque instance : accueil, bibliothèque, Planifier, Itinéraires, `FollowTracePicker`).
- `index.html` sans `viewport-fit=cover` ; `platform/systemBars.ts` (`setSystemBarsDark(theme === 'dark')`) ; `res/values/tracker_colors.xml` `#F6F5F2` (ancien crème, `--bg` vaut `#eaeff3`), `values-night` `#12161B`.
- `components/ui/MoreMenu.tsx` et `hooks/useDismiss.ts` `useCloseOnOutsideOrEscape` (sans `pushBackLayer`) ; `BaseTileLayer.tsx:139` ; `PlanningPage.tsx:942-980`.
- `pages/SessionLibrary.tsx:104`, `components/JumpsPanel.tsx:125,127`, `pages/ProfilePage.tsx:224`, `pages/SailingModule.tsx:918,1118`.
- `recording/session.ts:173-174` (`recordingDurationMs` = dernier − premier) ; `pages/RecordingPage.tsx:1033`.

## Voulu

- Codes connus traduits dès `platform/` (`NOT_AUTHORIZED` → « Localisation refusée : Réglages › Autorisations », avec un bouton) ; un traducteur d'erreurs de plateforme (codes Capacitor, `DOMException.name`, `QuotaExceededError`) ; côté Java, `e.getMessage()` dans le journal, pas à l'écran ; codes d'erreur (`NOT_FOUND`, `PERMISSION`, `NO_SPACE`) rendus par le greffon du dossier.
- `MemoryStatus compact` en tête de Statistiques et du Profil ; Profil dans l'unité de l'activité la plus pratiquée, tuile « Dénivelé » remplacée par un chiffre propre à l'eau quand aucune session n'a d'altitude.
- Filtre d'activité dans l'adresse (`?activite=`), porté par `libraryPath` et `parentPage` ; défilement retenu par famille et rendu au montage ; analyse ouverte en haut.
- Magasin partagé des itinéraires (`createStore`), chargé une fois par ouverture de la mémoire, relu après `save`/`remove` ; nombre masqué tant qu'il n'est pas lu.
- Barres d'Android : icônes réglées sur le mode du téléphone, ou `viewport-fit=cover` et `--safe-area-inset-top` pris en compte ; `tracker_colors.xml` sur `#EAEFF3` avec un test qui le compare à `--bg`.
- `pushBackLayer` dans `useCloseOnOutsideOrEscape` tant que `open`, et pour les surcouches de Planifier.
- `plural()` et `formatDecimal()` partout (CLAUDE.md, formats d'affichage).
- Pause manuelle : durée qui soustrait les pauses manuelles (ou tourne comme en pause auto : à trancher), alerte « En pause : rien n'est compté ; le GPS reste allumé pour la carte ».

## Pourquoi

Ce sont les écrans que l'acheteur et ses clients voient en premier : vignettes, premier refus du GPS, changement de thème, retour d'une analyse.

## Tranché le 04/11 (orchestrateur, d'après DECISIONS)

- Pause manuelle : la durée reste figée partout (DECISIONS §6, 27/10) ; on corrige le rattrapage d'un coup à la reprise, l'option « tourne comme en pause auto » est écartée.
- Tuile « Dénivelé » du Profil retirée quand aucune session n'a d'altitude, sans chiffre nouveau (pas de maquette).
- Partage du paquet : `MemoryFolderPlugin.java` n'est pas de ce lot (148 et 156) ; `BeeperPlugin` et `MotionPlugin` non plus (156). Ici : `HeartRatePlugin`, `DownloadsPlugin`, `ShareFilePlugin`.

## Commit du 04/11

- Barres d'Android : icônes réglées sur le mode du téléphone, puisque le fond le suit ; `viewport-fit=cover` écarté (il déplacerait toute la mise en page). Essai 103.
- `errorText.ts` est l'unique lecteur de code d'erreur ; le greffon du dossier garde « phrase : détail » dans son rejet, le détail n'arrive plus à l'écran.
- Profil au téléphone sans tuile Dénivelé : la troisième case prend toute la largeur. Bouton « Autorisations » du refus GPS non fait : le texte dit où aller.
- Reste : `RecordingPage.tsx:753` (rejeu) et les ≈ 60 `errorMessage` de `useRecorder` et `useSessionLibrary`, dont le texte est traduit à la source par la plateforme.
- Banc : `planning` non joué (manuel) ; `sauts` : virgules voulues, script accordé. Java relu, compilé à l'APK.
