# Historique des décisions et pièges rencontrés

Ce fichier est le §10 de `docs/ETAT_DU_PROJET.md`, sorti le 23 septembre 2026. Les renvois « §10, point N » du code et de la documentation désignent les points ci-dessous, dont la numérotation ne change jamais. À consulter par recherche (sujet, nom de fonction, « point N ») sur le sujet qu'on touche, avant de retenter ce qui a déjà été essayé.

Condensé le 26 septembre 2026 (point 65) : chaque point garde sa décision, son pourquoi et son piège. Le récit complet des points 1 à 64 (fichiers touchés, étapes, relevés du banc) se lit par `git show e21c0b9:docs/HISTORIQUE.md`.

**Un point nouveau tient en quelques lignes** : ce qui a été décidé, pourquoi, le piège à retenir. On n'y met ni la liste des fichiers touchés ni le récit de la livraison, que git garde.

1. Refactor initial : noyau en m/s, adaptateurs de compatibilité, seuil injecté.
2. Corrections algorithmiques validées avec Gemini : Doppler, filtrage, fenêtres temporelles, tops par distance sur temps, trigger de Schmitt, distance intégrée, unités SI, dénivelé en deux passes.
3. Bug d'écrêtage : remplacer un point suspect par la valeur précédente verrouillait le filtre à basse vitesse, et la trace entière tombait à zéro à 5 Hz. Réglé par la recherche d'un retour plausible.
4. Bug d'amorce de l'écrêtage : la référence initiale était le deuxième point. S'il était aberrant, il passait et produisait un pic à 80 nœuds au départ, qui polluait aussi la polaire de vitesse. Réglé par une amorce médiane et un plafond de vitesse par support.
5. Détection de manœuvre trop précoce : la fenêtre se déclenchait à 60° de virage, avant la fin du virage, d'où un vent local faux et des doubles comptages. Réglé en étendant la fenêtre jusqu'à la fin du virage ; le temps mort court depuis la fin.
6. Vent. La corrélation avec une polaire de référence, proposée par Gemini, n'est pas identifiable sans bords de largue. L'estimation par le cap au point le plus lent d'un virement subit le courant de plein fouet. Le score de l'angle mort d'origine se laisse piéger par un trou de couverture.
   - Solution retenue : candidats de l'angle mort départagés par la cohérence des manœuvres, puis aller-retour avec les bissectrices.
   - Le déroulement arithmétique des angles est banni au profit des statistiques circulaires : une série qui alterne 38° et 218° divergeait vers l'infini.
7. Polaire glissante : essayée pour voir les variations de vent entre deux manœuvres, elle donnait des résultats aberrants sur données réelles. Retirée à la demande de l'utilisateur (règle 7).
8. Chutes : une chute produit un cap erratique et une vitesse nulle, tout ce qu'il faut pour passer pour un virement.
   - Trois protections : cohérence du virage, départ en vol, cap stable en sortie.
   - Pour le vent, seules les manœuvres à caps stabilisés comptent.
9. Cas dégénéré du virage de 180° : la bissectrice de deux caps opposés est indéfinie. Elle est calculée dans le sens du virage.
10. Dénivelé : la moyenne centrée rabotait une demi-fenêtre à chaque bout de trace, soit 10 m perdus sur 100 m. Remplacée par un ajustement linéaire local.
11. Fuite de réglage entre modules : le support choisi en voile était repris par le module course, qui tournait en nœuds avec un seuil de 8 nœuds. Réglé par `allowedSports`, devenu `useSportSettings(family)` au point 53 (règle 9).
12. Unité de la vitesse de l'appareil : certains fichiers écrivent des km/h dans la balise `speed`. Lus en m/s, tout devenait rouge. Réglé par la détection d'unité.
13. Champs de saisie pilotés par la valeur enregistrée : impossible de taper « 12 » quand « 1 » est refusé. Tous les champs numériques passent à un brouillon local, validé à la sortie du champ (repris aux points 20 et 30).
14. Choix d'interface de l'utilisateur, repris dans `CLAUDE.md` (Décisions) :
    - section manœuvres compacte, détails dépliables ;
    - dégradé absolu pour la trace de course ;
    - graphes de course séparés ou superposés à deux axes ;
    - tout redimensionnable et mémorisé.
15. Nettoyage de la dette (21/09) :
    - fichiers et exports morts retirés, `@react-oauth/google` désinstallé ;
    - un seul gestionnaire de survol des graphes (`components/chartHover.ts`) ;
    - zéro `any` dans les pages, grâce aux types de Recharts 3 ;
    - constantes d'affichage partagées (`core/displayConfig.ts`).
16. Retours de l'utilisateur sur trace réelle (22/09) :
    - `interpolateDirection` garde la valeur la plus proche aux bords de la courbe du vent, dans la limite d'un trou de 30 min ;
    - la trace voile passe au dégradé continu de la course (`core/speedGradient.ts`).

    **Piège** : `ResizablePanel` doit relire son état et sa taille quand son `id` change, sinon il garde ceux du panneau précédent.
17. Largeur des panneaux non réglable (22/09, validé). Les panneaux sont des éléments flex. Trois causes :
    - la `width` posée par la poignée `resize` était ignorée (`flex-basis` différent de `auto`) ;
    - `flex-grow` refaisait grandir le panneau ;
    - `...style` écrasait la taille mémorisée.

    Corrigé dans `ResizablePanel` seul, dont tout futur panneau hérite :
    - le `style` passe avant la taille ;
    - au premier appui sur la poignée, le panneau est figé à sa taille courante en `flex: '0 0 auto'`, mode que garde la taille mémorisée ;
    - le retour au défaut passe par les props, sans écriture DOM.
18. Carte du module course invisible (22/09, validé). Elle était une section gardée par `open.carte` et mémorisée : fermée une fois, elle le restait, sans indice de la cause. **À retenir** : pas de carte derrière un `open.*` mémorisé ; elle s'affiche sans condition.
19. Trace qui ne se recolorait pas quand on changeait les bornes (22/09, validé). `Polyline` de react-leaflet ne réapplique un style que si `pathOptions` change de référence ; `color` et `weight` passés en props directes ne sont lus qu'à la création. Tous les `<Polyline>` passent donc leur style par `pathOptions` (règle 11). **À retenir** : jamais de style en props directes sur un élément dont la `key` ne change pas.
20. Bornes de la légende en `type="number"` avec flèches (22/09, validé), à la demande de l'utilisateur : plus de brouillon validé à la sortie du champ, la valeur s'applique tout de suite. Effet assumé : un ordre de bornes inversé n'est plus réordonné, il est refusé en silence. Le point 30 corrige la frappe que ce choix avait cassée.
21. Courbe du vent pauvre en points (22/09 ; tentative, puis retour en arrière).
    - `windSamplesFrom` ne retient que les manœuvres à caps stabilisés des deux côtés (`stableSegment` : au-delà d'une marge de 4 s, au moins 5 s sous 3°/s).
    - Deux assouplissements (marge à 2 s, puis durée à 3 s) ont fait **baisser** le nombre total de manœuvres. En effet, `stableSegment` sert aussi à calculer la bissectrice qui **classe** le virage : avec plus de segments stables, plus de virages passent par la bissectrice précise, et certains, limites, sortent de la tolérance et disparaissent de `stats.locations`.
    - Les valeurs d'origine sont remises.

    **Piège** : ne pas réutiliser le même `stableSegment` pour classer le virage et pour juger le vent local. Le sujet a été clos par l'autre bout, au point 24.
22. Flèches ↕ généralisées à tous les champs numériques (22/09, validé), même principe qu'au point 20. Les bornes du coureur sont posées d'après `BOUNDS` (`useRunnerProfile.ts`).
23. Estimation du vent fidèle au profil du support (22/09, validé).
    - **Piège** : `estimateWind` appelait `analyzeManeuvers` sans options. Seuil de réussite et polaire retombaient donc sur les valeurs du wingfoil, quel que soit le support (entorse à la règle 3). Sur un support lent, la polaire se trompait de bord : 176° pour un vent de 0°. Un calcul appelé sans options retombe toujours sur le défaut du wingfoil.
    - Second défaut : `bestScore` partait de −∞, et le jumeau au vent arrière n'avait pas de descripteur. La confiance affichée n'était donc pas celle de la direction retenue. D'où `selectWindCandidate` et `describeWindCandidate`.
    - Décision de l'utilisateur : une seule notion de réussite, le seuil d'activité effectif, qui recalcule le vent quand il bouge.
    - **Coût mesuré** : 28 ms pour 2 à 3 h à 1 Hz, 352 ms pour 2 h à 5 Hz, 521 ms pour 3 h à 5 Hz. Non mitigé (§11).
24. Courbe du vent nourrie par toutes les manœuvres (22/09, validé). Au lieu d'assouplir `stableSegment` (point 21), on cesse d'exiger des caps stabilisés pour la courbe.
    - Ni la détection ni la classification ne changent : aucune manœuvre ne peut disparaître.
    - `windSamplesFrom` reste, pour la seule estimation globale.
    - La symétrie du virage devient une pondération, pas un filtre.

    **Piège** : jugée contre la moyenne des mesures elles-mêmes, la symétrie dégradait le résultat (24° d'erreur, contre 21,8° sans pondération) : une série biaisée se juge alors par son propre biais. Jugée contre le vent global, troisième argument de `calculateWindStats`, l'erreur tombe à 8°.

    **À retenir** : aucune formule appliquée à une manœuvre isolée ne corrige une manœuvre asymétrique, puisque l'information manquante est justement celle qu'on cherche. C'est le passage à toutes les manœuvres qui traite ce biais, statistiquement, les asymétries changeant de signe d'une fois sur l'autre.
25. Corde entrée → sortie retirée (22/09, tranché sur trace réelle). L'utilisateur l'avait proposée comme second estimateur du vent local : la tangente au point le plus éloigné est parallèle à la corde.
    - Tracées ensemble sur le graphe du vent, corde et bissectrice étaient trop proches pour être départagées, ce que la géométrie annonçait.
    - La bissectrice reste : elle ne dépend pas des positions, alors que la corde retombait en silence sur elle sous 10 m.
    - Gardés : la courbe en bleu et les points aux manœuvres (`isManeuver`).

    **À retenir** : quand deux mesures ne se départagent pas sur données réelles, le choix n'a pas d'enjeu. Trancher sur la simplicité et la robustesse, pas continuer à chercher (règle 7).
26. Analyse rendue insensible à l'échelle de vitesse du support (22/09, validé). Une trace de planche lente ne donnait aucune manœuvre, un vent mal orienté, et un pic d'enregistrement à 18 nœuds fabriquait un virement. Une seule racine : des seuils absolus calibrés pour le wingfoil. Trois gestes :
    - **Allure de la session** (`core/sessionSpeed.ts`), neuvième décile des vitesses brutes pondéré par la durée, pour rester identique à 1 Hz et à 5 Hz. Un échantillon est plafonné à 10 s, pour qu'une coupure ne pèse pas plus que la session. C'est l'**accélération maximale**, proportionnelle à l'allure, qui tue le pic : plus sûrement qu'un plafond de vitesse, parce qu'une aberration est brève alors qu'un vrai bord rapide s'installe.
    - **Vol perdu** : `vmin < 5 nœuds` devient `conservation < 0,5`, un rapport, identique du bateau au kite. Le critère vivait à trois endroits (`maneuverAgreement`, et deux fois dans `observeTurns`), tous corrigés.
    - **Diagnostic** : les virages écartés sont comptés par motif, avec une déduplication qui ne pose **aucun temps mort**. Un virage écarté doit pouvoir être classé quelques points plus loin : c'est en l'oubliant qu'on a échoué deux fois au point 21.

    **Piège** : un test (« la polaire d'un support lent se trompe de bord ») s'est mis à échouer. Il encodait le défaut corrigé ; il a été scindé en deux. **À retenir** : un test qui échoue après une correction de fond peut décrire le bug plutôt que la vérité, mais il faut le démontrer avant de le réécrire.
27. Traces d'enregistreur économique (22/09, validé). Une trace Komoot de planche (517 points, 2 h) ne rendait que 2 manœuvres. **Méthode à retenir** : `slowEntry` et `incoherent` à zéro prouvaient que les virages n'étaient pas rejetés, mais jamais observés.
    - **Première cause** : Komoot se tait quand on ralentit. Toute la rotation d'un virement tient alors dans un seul intervalle de 15 à 25 s, plus long que la fenêtre d'observation de 12 s, qui ne contenait aucun point.
      - Correctif : quand la fenêtre est vide, lire un **pas unique**, jusqu'à `MANEUVER_MAX_STEP_S` (30 s).
      - La branche ne s'arme que sur une fenêtre vide, donc jamais sur une trace dense : la neutralité est acquise par construction.
    - **Seconde cause** : une vitesse d'entrée minimale de 4 nœuds sur une session à 4,4 nœuds d'allure.
      - Les seuils d'entrée et de polaire deviennent des fractions de l'allure (`sessionManeuverThresholds`), toujours prises en **minimum** avec le profil : la mise à l'échelle ne peut qu'abaisser.
      - Elle est appliquée **dans le hook**, jamais par défaut dans les calculs, pour que les tests restent neutres (règle 4).
      - Un virage vu en un pas a toujours une cohérence de 1 : un garde-fou de 10 m parcourus remplace la protection anti-chute.

    **À retenir** : sur cette trace, la polaire annonçait 203° avec 90 % de confiance pour un vent de nord-nord-est, et l'utilisateur corrige par « Inverser ». Sur une trace lente et peu échantillonnée, la confiance de la polaire ne vaut pas grand-chose (§11).
28. Carte non recentrée au chargement d'une trace suivante (23/09, validé). **Piège** : react-leaflet v5 n'applique la prop `center` de `MapContainer` qu'à l'instanciation. La `key` de la carte ne basculait qu'une fois (`'empty'` → `'loaded'`). Correctif : `sessionKey` (nom et instant du premier point), calculé dans `useGpxSession`, sert de `key`, ce qui force un remontage à chaque trace. Depuis le point 51, la carte se cadre sur l'emprise de la trace.
29. Seuil d'activité et bornes de couleur suggérés par l'allure de la session (23/09, validé). Un défaut fixe par support reproduisait le bug du point 27 : une session lente au seuil du wingfoil ne comptait aucune manœuvre. Règles demandées par l'utilisateur :
    - au-dessus de 12 nœuds d'allure, le défaut du profil ; en dessous, 1 nœud ;
    - le bateau est toujours à 1 nœud ;
    - borne haute de couleur = pic sur 2 s, plus 1 nœud.

    Fonctions `suggestActiveThresholdKn` et `suggestSpeedRangeMs` (`sailing/sailingConfig.ts`), appliquées seulement quand rien n'est surchargé.

    **Piège de validation** : « rien ne change à l'écran » venait d'une surcharge manuelle ancienne, toujours persistée, qui primait comme prévu. **À retenir** : quand un défaut calculé remplace un défaut fixe, une surcharge existante masque en silence le nouveau comportement, ce qui ressemble à un bug.
30. Saisie clavier cassée dans les bornes de couleur (23/09, validé). Les deux bornes se valident l'une par l'autre (min < max). Taper le premier chiffre d'un nombre à deux chiffres était refusé sans rendu. Au rendu suivant, déclenché par un simple survol, React réappliquait l'ancienne valeur, curseur en fin de champ, et le chiffre suivant produisait un nombre à trois chiffres, accepté.
    - Le raisonnement du point 20 ne vaut que pour un champ **sans contrainte croisée**.
    - Correctif : chaque champ garde un texte local et applique dès que le texte est valide.
    - Le texte se resynchronise sur la borne enregistrée **pendant le rendu**, par comparaison avec la valeur précédente gardée en état, et non dans un `useEffect` (oxlint `react/set-state-in-effect`).
31. Vent manuel non réinitialisé au chargement d'une nouvelle trace (23/09, validé) : une saisie ancienne primait en silence sur l'estimation de la trace suivante. **À retenir** : un état lié à une trace se réinitialise quand `sessionKey` change, pendant le rendu (même pattern qu'au point 30), pas à chaque recalcul. Depuis le point 43, le vent saisi vit dans la fiche de la session.
32. Carte voile réduite à 60 % de la largeur, avec une colonne d'onglets à sa droite (23/09, validé par itérations, sur un réglage choisi en direct par l'utilisateur). Disposition reprise au point 57.
33. Doublon VMG et Manœuvres en haut de page retiré (23/09, validé) : l'usage avait tranché.
34. Panneau « Résumé » retiré de la colonne de droite (23/09, validé) : il doublait le panneau global.
35. Graphiques et vent déplacés dans la colonne de droite (23/09, validé). Les identifiants de `ResizablePanel` sont gardés, pour que les tailles mémorisées restent valables : seule la position dans le DOM change.
36. Git, documentation allégée, cible mobile (23/09, plan validé).
    - **Git** : dépôt privé `segneur34/Tracker`, `core.autocrlf=false` (sinon Git pour Windows réécrit les sources en CRLF).
    - **Documentation** : `CLAUDE.md` allégé sans perdre de règle. L'historique est sorti de l'état, qui doit se lire d'une traite : environ 25 k tokens au plus par lecture. Découpage fait par un script Node en UTF-8, jamais par PowerShell, dont l'encodage avait déjà corrompu un fichier.
    - **Pourquoi Capacitor** : l'application est 100 % client. Capacitor emballe `dist/` dans une WebView Android avec React, Leaflet et Recharts tels quels, et `core/`, `sailing/`, `running/` ne bougent pas.
    - **Écartés** :
      - PWA (géolocalisation coupée écran éteint) ;
      - React Native (ni DOM, ni Leaflet, ni Recharts) ;
      - natif (réécriture complète) ;
      - Tauri mobile (arrière-plan trop pauvre) ;
      - iOS (Mac requis).
    - **Plugin** : `@capacitor-community/background-geolocation` s'arrête à Capacitor 7, d'où `@capgo/background-geolocation`.
    - **À retenir** : ce qui coûte est l'interface, pas Capacitor. Le premier geste était de vérifier un enregistrement de 2 h écran éteint.
37. Stockage regroupé dans `platform/storage.ts` (23/09, validé : « le logiciel n'a pas changé »).
    - **Mêmes clés et même JSON, octet pour octet** (testé) : rien à migrer.
    - L'interface reste **synchrone exprès** : les hooks lisent pendant le rendu, et Android charge les Preferences en mémoire au démarrage.
    - Le stockage est obtenu à chaque appel, à l'intérieur du `try`, parce qu'un navigateur aux données de site bloquées lève une erreur dès l'accès à `localStorage`.
    - Règle 12 ajoutée à `CLAUDE.md`.
38. Coquille Capacitor Android (23/09, validé sur le téléphone). L'identifiant `io.github.segneur.tracker` est choisi par l'utilisateur : le changer revient à installer une autre application. On a levé le risque d'outillage avant d'écrire l'enregistreur. **Pièges** :
    - le Java 25 d'Android Studio 2026.1 ne fait pas tourner Gradle 8.14.3, d'où Temurin 21 ;
    - HyperOS exige « Installer via USB » en plus du débogage ;
    - le shell de Claude définit `NoDefaultCurrentDirectoryInExePath=1`, et `npx cap run android` y échoue : passer par `gradlew.bat` puis `adb` ;
    - sous Git Bash, `/voile` devient un chemin Windows sans `MSYS_NO_PATHCONV=1`.

    `BrowserRouter` fonctionne dans la WebView, chargement direct des routes compris : le repli `HashRouter` est abandonné.
39. Page blanche à l'« Analyser » d'une session enregistrée (23/09, corrigé au banc). « Maximum update depth exceeded » dans Recharts, seulement avec les onglets graphiques et vent ouverts, état qui venait de l'utilisateur (`tracker.sections`). Cause : l'effet de réception de la session dépendait d'un rappel qui changeait d'identité à chaque écriture de réglage ; il rechargeait la trace en boucle. Correctif : session traitée une seule fois (`useRef` sur son identité), dernier rappel rangé à part.

    **Leçon** : demander tôt l'erreur de console et reproduire l'état persistant de l'utilisateur. Un effet qui reçoit un rappel ne doit pas en dépendre s'il n'est censé agir qu'une fois.
40. Enregistrement minimal (23/09, validé sur le téléphone, contrôle 1b). **Choix** :
    - enregistrer brut, sans autre filtre que les redélivrances ;
    - arrondi appliqué à la réception, pour que le GPX de l'arrêt et celui reconstruit depuis le journal soient identiques (testé) ;
    - journal écrit au rythme des positions et non par minuterie, que le système bride écran éteint ; effacé seulement après l'écriture du GPX ;
    - la touche retour met l'application en arrière-plan pendant un enregistrement.

    **Contrôle 1b** : 833 points en 15 min 31 s, précision médiane 1,5 m, Doppler sur chaque point, 13 min 27 s écran éteint avec un plus long trou de 4 s. Un trou de 93 s au début : les réglages de batterie d'HyperOS se font **avant** d'enregistrer.

    **Piège** : le GPX était introuvable dans la catégorie « Documents » des gestionnaires de fichiers ; passer par Stockage interne → Documents → Tracker.
41. Maquette, plan en six lots, lot 1 : DA, navigation, APK signé (23/09, validé).
    - Réponses de l'utilisateur : APK d'abord, lien web ensuite ; DA de la maquette pour l'instant, d'où un fichier unique de variables.
    - **Signature** : Android refuse une mise à jour signée d'une autre clé, sauf désinstallation, qui efface les données. D'où une clé dédiée, hors du dépôt, créée par un script qui n'affiche jamais le mot de passe.
    - **Pièges** :
      - un commentaire XML contenant `--` fait échouer `mergeReleaseResources` ;
      - Gradle ne trouve le SDK qu'avec `ANDROID_HOME` ;
      - `cmd /c gradlew.bat` échoue comme `npx cap run` ;
      - le thème Android est imposé en clair (`Theme.AppCompat.Light.NoActionBar`, `SystemBars.style: 'LIGHT'`) : en DayNight, un téléphone en mode sombre aurait des icônes sombres sur fond sombre.
    - Les couleurs de données restent en dur : Recharts et Leaflet les posent en attributs SVG.
42. Mémoire en dossier portable, lot 3a (24/09, validé sur PC avec les vraies traces). L'utilisateur veut une mémoire qu'un copier-coller de dossier suffit à sauvegarder, migrer ou passer du téléphone au PC.
    - **Choix de l'utilisateur** : sur Android, le dossier est désigné par le sélecteur (SAF), pas par « accès à tous les fichiers », qui inquiète et que le Play Store refuse ; les réglages voyagent dans le dossier.
    - **Choix d'implémentation** :
      - des fichiers plutôt qu'une base ; le GPX fait foi ;
      - **pas d'index** dans le dossier, pour que deux dossiers fusionnent par simple copie ; le cache vit hors du dossier ;
      - identité = instant du premier point ;
      - champs inconnus conservés, fiche d'une version future jamais réécrite ;
      - résumé calculé par le pipeline du module qui analysera la session, pour que la liste et l'analyse donnent les mêmes chiffres ;
      - réglages : le plus récent l'emporte ;
      - OPFS dans le navigateur, qui marche aussi dans Chrome sans fenêtre ;
      - session analysée dans l'URL (`?session=`), qu'un rechargement rouvre.
    - **Piège évité** : ouvrir une session d'un autre support réécrit le dernier support choisi, ce qui aurait rajeuni les réglages de l'appareil et fait gagner à tort la règle du plus récent. Ce choix retenu est exclu de l'empreinte qui date les réglages ; régression corrigée au point 65.
    - **Outillage** :
      - une apostrophe dans le titre d'un test Vitest entre apostrophes casse la transformation ;
      - au banc, recliquer un onglet de section le referme, l'état ouvert étant mémorisé.
43. Mémoire sur le téléphone (lot 3b) et enregistrement explicite d'une session (24/09, validés).
    - Plugin Java maison sur `DocumentsContract` (`MemoryFolderPlugin`), plutôt qu'un plugin tiers. **Piège** : un fichier créé sans type `application/octet-stream` reçoit d'Android une extension en plus.
    - « Importer un dossier » était lu comme un envoi (Chrome demande d'importer « sur ce site ») : le bouton devient « Ajouter les sessions d'un dossier ».
    - Le navigateur ne donne jamais le chemin complet d'un dossier choisi.
    - **Choix de l'utilisateur** : un bouton « Enregistrer la session » plutôt qu'un enregistrement automatique ; un seuil propre à chaque session, dans sa fiche ; changer de support efface ce seuil.
    - **Piège** : `BrowserRouter` ne sait pas bloquer une navigation. L'avertissement en quittant intercepte les liens internes, la touche retour d'Android et la fermeture de l'onglet, mais pas le retour arrière du navigateur (§9).
44. Audit et allègement (24/09, à la demande de l'utilisateur).
    - L'avancement n'est plus tenu qu'au §12 de l'état.
    - `docs/INVENTAIRE.md` devient une carte d'une ligne par fichier.
    - Code mort retiré, sans effet.

    **Méthode à retenir pour prouver qu'un changement est neutre** : texte de la page d'analyse relevé au banc sur une trace synthétique avant et après (`bench.mjs` en scénario `analyse`, `DUMP=`), puis `diff`. Il doit être identique au caractère près.
45. Fins de ligne et banc versé dans le dépôt (24/09). Trois sources en CRLF, avec des espaces en fin de ligne, piégeaient les scripts d'édition. Tout passe en LF, et `.gitattributes` fixe la règle (CRLF pour les `.bat`). Le banc entre dans `outils/banc/`.
46. Allure imposée propre à chaque session (24/09, validé). Gardée par support, elle s'appliquait en silence à toutes les sessions suivantes, même piège qu'au point 29. Elle vit désormais dans la fiche (`analysis.referenceSpeedMs`), en brouillon comme le seuil. `SUMMARY_CALC_VERSION` passe à 2 ; l'ancienne clé `referenceSpeeds` est écartée à la lecture.
47. Lot I des bugs du 24/09, fait sous Sonnet (25/09, validé, APK 0.2.3).
    - **Piège** : un double événement de clic de la WebView refermait les panneaux. `toggle` calculait `!value[key]` sur une valeur capturée au rendu. `useStoredRecord.update` accepte désormais une forme fonctionnelle.
    - `NumberField` se resynchronise sur sa valeur seulement hors focus.
    - Mise en page téléphone amorcée (carte en tête, plein écran au toucher).
    - **Décision de l'utilisateur** : bornes de couleur par famille rejetées, puisqu'une session lente y ressort presque entièrement grise.
48. Renommer une session (25/09, validé, APK 0.2.5).
    - Champ `name` de la fiche ; `title` reste le nom lu dans le GPX, et aucun fichier n'est renommé.
    - Écriture immédiate, sans brouillon.
    - Deux accès voulus par l'utilisateur : la liste et l'en-tête de l'analyse.
49. Mise en page commune des analyses (25/09, accepté, APK 0.2.6). `AnalysisMap` réunit la carte, sa légende collée dessous et le plein écran au toucher. Le patron est dans `docs/MISE_EN_PAGE.md`.
50. Pause d'enregistrement, GPX allégé, carte et statistiques en direct (24-25/09, validés sur le terrain, APK 0.2.9).
    - Pause manuelle : elle coupe la source GPS.
    - Pause automatique : la source reste active pour détecter la reprise. La décision est prise en temps de trace, jamais en nombre de points (règle 2).
    - Cap et précision retirés du GPX, que personne ne relisait.
    - Les statistiques en direct reprennent la chaîne de l'analyse, segment par segment ; rien ne franchit une pause.
    - **Piège** : la vitesse en direct lisait l'unité du profil en dur, d'où `effectiveSpeedUnit`, hors composant.
    - **Piège de banc** : à ×600, le recalcul du direct n'a jamais lieu (§9) ; vérifier les unités à ×10.
51. Lot de débogage (25/09, validé, APK 0.2.10).
    - Carte cadrée sur l'emprise de la trace.
    - Décision de l'utilisateur : **à l'arrêt, rien n'est rangé** ; « Analyser » range, « Jeter » abandonne, et le journal est gardé d'ici là.
    - Décision de l'utilisateur : les bornes de couleur sont propres à la trace, en brouillon ; celles du support se règlent dans Réglages seulement.
    - **Piège de banc** : `Page.navigate` recharge la page et vide la mémoire du navigateur sans dossier ; pour relire une session, passer par les liens de l'application.
52. Tableau des manœuvres sur téléphone (25/09, validé, APK 0.2.11) : colonnes et panneaux bornés à l'écran, un contenu large défile dans son panneau. La règle est dans `docs/MISE_EN_PAGE.md`.
53. Activités, graphe de l'accueil, pause par appui long (25/09, validé, APK 0.2.13).
    - Les supports figés cèdent la place aux activités de l'utilisateur, chacune sur un calcul de base.
    - « Voile » et « Course » portent les identifiants `wingfoil` et `running`, et une session sans activité prend l'activité de base de son calcul : les anciens réglages restent valables sans migration.
    - `useSportSettings(family)` (règle 9).
    - **Piège** : le bouton rond était un lien ; tenu longtemps, la WebView d'Android affichait l'adresse sous le doigt. Pendant un enregistrement, c'est un `<button>`.
54. Réglages d'affichage par support, unité de distance, Réglages repliables (25/09, validé, APK 0.2.15).
    - **Décision de l'utilisateur** : unité, taille du texte et pause automatique se règlent par activité, donc par support.
    - La voile reste calculée en nœuds (règle 5) ; seul l'affichage convertit (`formatKnots`).
    - Le seuil d'activité voile sert à trois choses : temps et distance actifs ; réussite d'une manœuvre ; filtre de la VMG, et par elle le vent. Séparer « en vol » et « en mouvement » serait un chantier à part, à ouvrir seulement si l'utilisateur le demande.
    - **Piège** : Réglages affichait « 8 défaut », jamais appliqué. Le champ vide dit désormais « selon l'allure ».
55. Retouches et logo (25/09, APK 0.2.16).
    - Totaux de l'accueil vers la bibliothèque filtrée.
    - Icône simplifiée dessinée par Claude (`assets/icone.svg`), déclinée par `outils/logo/icones-android.mjs`.
    - **Pièges** :
      - `@capacitor/assets` reformate le manifeste et ajoute marges et variantes : tout défait ;
      - l'explorateur ne lit un `.ico` aux petites tailles que s'il est en BMP sous 256 px ;
      - il met les icônes en cache par chemin, d'où un nouveau nom de fichier.
56. Refonte mobile, première passe (25/09, APK 0.2.17). Graphes gardés à 500 et 350 px sur ordinateur (choix de l'utilisateur). **Pièges** :
    - une ancre posée sur un élément en `display: contents` ne défile pas ;
    - une base `flex: 1 1 100%` dans une colonne ignore la hauteur et vide les graphes.
57. Refonte mobile, seconde passe ; vitesses moyennes en voile ; altitude colorée par la pente (25/09, validé, APK 0.2.21).
    - Voile : une seule barre d'onglets à droite de la carte, dans l'ordre voulu par l'utilisateur, et la feuille toujours visible (`CLAUDE.md`, Décisions).
    - Bornes de couleur saisies dans l'onglet réglages (`SpeedRangeEditor`).
    - `avgSpeedMs` et `activeAvgSpeedMs`.
    - Altitude colorée par la raideur, montée ou descente confondues, de 0 à 25 % par défaut.

    **Piège** : un `linearGradient` SVG s'étend sur la boîte de l'aire tracée, pas sur l'axe. Les positions des arrêts se calculent sur les seules lignes qui portent une altitude.
58. Bloc du vent resserré à droite de la boussole (25/09, validé, APK 0.2.22).
59. Planification d'itinéraires (25/09, validé, APK 0.2.24).
    - **Choix** : calcul par le serveur public BRouter (libre, sans clé, altitude fournie) et recherche de lieux par Photon. Ce sont les seuls appels réseau, isolés dans `planning/`.
    - **Écartés** : un moteur maison sur Overpass, les services à clé. Le hors ligne passera plus tard par l'application BRouter pour Android.
    - **Pièges** :
      - le serveur accroche un point au chemin le plus proche même à des kilomètres : au-delà de 500 m, le tronçon est en échec ;
      - les points du tracé sont espacés : la pente se mesure sur un profil rééchantillonné tous les 10 m ;
      - Leaflet garde un `dashArray` absent du nouveau style : le passer explicitement à `undefined`.
    - La mention « © OpenStreetMap », exigée, est posée sur toutes les cartes (`OsmTileLayer`).
60. Planifier depuis l'accueil, suivre une trace, supprimer un itinéraire (25/09, validé, APK 0.2.25).
    - On suit un itinéraire rangé ou une session déjà enregistrée.
    - **Pas d'alerte hors trace** : décision de l'utilisateur.
    - **Piège de banc** : `Page.navigate` coupe un enregistrement du navigateur ; naviguer par les liens de la page.
61. Distance restante sur la trace suivie (25/09, validé, APK 0.2.26). L'avancement (`followProgress`) est rejoué sur toute la trace à chaque rafraîchissement, sans état : il vaut aussi pour une session récupérée.
    - La fenêtre de recherche autour de l'avancement évite les sauts à un croisement ou sur un aller-retour.
    - **Piège** : chercher seulement dans la fenêtre ne raccrochait jamais après un raccourci. On cherche aussi hors fenêtre, près de la suite de la trace.
    - Cap : GPS en mouvement, boussole à l'arrêt. La flèche est tournée dans le DOM, pour que la boussole ne redessine pas la carte.
62. Bords en voile pendant l'enregistrement, fiche d'installation (25/09, APK 0.2.27 ; tenu pour bon sans essai sur l'eau).
    - Le vent est inconnu en direct : le cap moyen du bord remplace l'amure.
    - Un bord se ferme à 60° d'écart sur 12 s et se rouvre au cap stable ; le virage n'appartient à aucun des deux.
    - Caps moyens pondérés par la distance, parce qu'à l'arrêt le cap n'est que du bruit.
    - Fiche des testeurs : `docs/INSTALLATION.md`.
63. Planification : « Précédent », boucle en ligne droite, GPX téléchargé (26/09, APK 0.2.29 ; éprouvé au banc, tenu pour bon sans essai).
    - `parseGpxPath` lit les `trkpt`, à défaut les `rtept`, sans exiger l'heure, que les parcours téléchargés n'ont souvent pas.
    - **Choix de l'utilisateur** : la trace est gardée telle quelle entre départ et arrivée (tronçons `imported`) ; seul un point déplacé en refait les tronçons.
    - `ROUTE_VERSION` passe à 2, pour qu'une version antérieure ne réécrive pas un itinéraire importé en le recalculant par les chemins.
    - **Piège** : un bouton grisé posé sur la carte devenait translucide ; il reste opaque.
64. Activité d'une session : proposée par la trace suivie, changée en route ou depuis l'analyse, voile ↔ course comprises ; carte réduite pendant l'enregistrement (26/09, APK 0.2.29 ; éprouvé au banc, tenu pour bon sans essai).
    - **Choix de l'utilisateur** : d'une famille à l'autre, avec recalcul complet ; dans l'analyse, le choix reste dans l'onglet réglages.
    - Une ligne `activity` du journal note le changement ; une session récupérée prend la dernière.
    - `applyRecordPatch` efface en plus les bornes de couleur quand la famille change ; vent, allure et notes restent.
    - **Piège évité** : en pause automatique, passer à une activité sans pause automatique l'aurait bloquée pour de bon. L'enregistrement reprend donc.
    - **Limite acceptée** : la notification Android garde le nom du départ jusqu'à une reprise après pause manuelle.
    - Le nom du GPX ne change jamais : un `…_running.gpx` peut être une session de voile.
65. Audit, documentation condensée, régression de l'empreinte des réglages (26/09, à la demande de l'utilisateur, APK 0.2.30).
    - **Constat** : l'état redisait le code (pipeline) et l'historique (Avancement devenu un journal), avec des erreurs (version, nombre de pages, `planning/` absent, trois formules du §4). L'historique faisait 89 k caractères, surtout du récit de livraison.
    - **Décisions de l'utilisateur** :
      - l'état est resserré sur place, avec les mêmes numéros de section, puisque le code y renvoie ;
      - l'historique est condensé, avec les mêmes numéros ; le texte intégral reste dans git ;
      - un point nouveau tient en quelques lignes.
    - **Régression corrigée** : depuis les activités (point 53), ouvrir une session d'une autre activité écrit `moduleActivity`, et choisir l'activité d'enregistrement écrit `recordActivity`. Ni l'un ni l'autre n'était exclu de l'empreinte, qui n'écartait que l'ancien `sport` : les réglages de l'appareil rajeunissaient et écrasaient ceux du dossier. `settingsSignature`, pure et testée (`library/settingsFile.ts`), écarte les trois.
    - Vérifié au banc : ouvrir la session ne date plus les réglages, alors qu'un vrai réglage les date toujours ; l'ancien code reproduisait le défaut.
66. Appui long visible : grand cadran au milieu de l'écran (28/09, validé sur le téléphone, APK 0.2.31).
    - **Demande de l'utilisateur** : le doigt cache l'anneau du bouton rond, on ne voit pas où en est la pause.
    - Le cadran reprend le remplissage de l'anneau (même `--press-ms`), en rouge vers la pause, en vert vers la reprise. Il est sans pointeur, pour que le bouton garde le doigt.
    - Il n'apparaît qu'après 150 ms : un appui court, qui ouvre la page d'enregistrement, ne fait pas clignoter l'écran.
67. Cartes hors ligne (28/09, validé en mode avion sur le téléphone, APK 0.2.32).
    - **Règle d'OSM** : télécharger une zone à l'avance est interdit (au-delà de 250 tuiles). **Choix de l'utilisateur** : garder chaque tuile affichée en ligne, sans bouton ni durée limite. Un « fichier de région » vectoriel (Protomaps) a été écarté pour l'instant : nouvelle bibliothèque d'affichage, autre rendu.
    - Une tuile gardée depuis plus de 7 jours est montrée aussitôt, puis redemandée en arrière-plan si le réseau répond. Sans réseau, elle reste. Seuls le plafond (500 Mo par défaut, les plus anciennes d'abord) et « Vider » effacent.
    - Sans tuile à un zoom, on découpe et on agrandit celle d'un zoom inférieur, jusqu'à 3 crans : floue mais lisible. Le découpage passe par un canevas, pour que la case reste une `<img>` comme Leaflet l'attend.
    - Plafond dans une liste, pas dans un champ : un champ saisi chiffre à chiffre aurait effacé des tuiles à « 50 » en tapant « 500 ».
    - **Pièges** (téléphone) :
      - écrites ensemble avec `recursive`, les tuiles se disputaient la création du dossier `tuiles/`, et l'une échouait. Le dossier est créé une fois avant la première écriture ;
      - Capacitor journalise chaque lecture de fichier absent. Un index en mémoire (un seul `readdir`) évite de chercher une tuile qui n'y est pas.
    - **Piège de banc** : la vue de `/itineraires` est mémorisée, et un profil déjà servi fausse le relevé d'un essai de zoom : prendre un profil neuf. Écran du téléphone éteint, Leaflet ne zoome plus sous le banc (animations suspendues).
68. Itinéraires planifiés sur l'accueil et dans les bibliothèques, « Partir », liste complète avec tris (28/09, validé sur le téléphone, APK 0.2.34).
    - **Choix de l'utilisateur** : dans Voile et Course, « Réalisées » (les sessions) ou « Planifiées » (les itinéraires de la famille, par les mêmes onglets d'activité). La notion d'itinéraire « fait » n'existe pas.
    - **Retour de l'utilisateur** : une liste complète sur l'accueil l'aurait allongé sans fin. L'accueil en montre les 3 derniers, et sa carte mène à `/itineraires/liste` (tris, onglets d'activité).
    - **« Partir »** (choix de l'utilisateur) : il suit l'itinéraire et ouvre Enregistrer, son activité proposée, sans démarrer, pour vérifier l'activité et attendre le GPS. Grisé pendant un enregistrement, où la trace suivie ne se change pas.
    - Une seule liste (`RouteList`) sert partout. Chaque distance s'affiche dans l'unité de l'activité de son itinéraire, et non plus dans celle de l'activité choisie sur la page.
    - `?itineraire=` ouvre un itinéraire une fois la liste et la carte prêtes, puis s'efface, pour ne pas rouvrir l'itinéraire par-dessus un tracé en cours.
    - Un itinéraire sans activité connue n'appartient à aucune famille : on le trouve sur l'accueil et dans les pages Itinéraires seulement.
69. Retouches du 29/09 : graphe de l'accueil, Itinéraires centrée sur soi, gain au vent, analyses compactes (29/09, validé sur le téléphone, APK 0.2.37).
    - **Graphe, vue 30 jours** : la première barre portait toujours sa semaine. Quand la période commençait un dimanche, « S35 » et « S36 » se chevauchaient (une barre fait 10 px, un repère 20). La première barre ne garde son repère que si le premier lundi est à 4 barres ou plus. Les totaux par activité se replient d'un geste.
    - **Itinéraires** : la carte se centre sur soi à l'ouverture, seulement si l'autorisation est déjà accordée (`locationPermissionGranted`, qui ne la demande jamais). Elle ne bouge plus si la carte a été touchée, glissée ou zoomée, ou si un itinéraire a été ouvert entre-temps. Échec silencieux.
    - **Gain au vent** (demande de l'utilisateur) : ligne sous « Distance de manœuvre », sur la même portée. Intégrale de la vitesse fois le cosinus de l'écart au vent retenu, et non à la bissectrice de la manœuvre même, qui rendrait la mesure circulaire. Manœuvres réussies seulement, négatif sous le vent, le plus grand en tête du podium.
    - **Décision de l'utilisateur** : la fiche du haut n'est plus toujours visible. Synthèse et vent passent dans un premier onglet « général », ouvert par défaut, qu'on replie pour comparer tableaux et carte. La course suit, à sa demande.
    - **Sur téléphone** (choix de l'utilisateur parmi plusieurs pistes) : en-tête sur une ligne au-dessus de la carte, onglets en petites pastilles, phrase « Session enregistrée » retirée en voile. Le bouton flottant qui déplierait les onglets n'a pas été retenu.
    - **Piège** : le seuil mis à l'échelle de l'allure s'affichait « 7.999999999999999 nds » ; `showThreshold` arrondit au dixième.
70. Audit et nouvelle mesure des manœuvres (29/09, validé sur le téléphone le 30/09, APK 0.2.38).
    - **Demande de l'utilisateur** : valeurs du tableau jugées louches, gain au vent compris. L'audit (traces synthétiques bruitées et séance réelle du 18/09) montre que la détection et le classement tiennent, mais pas la mesure. Ils restent intacts (point 21) ; une mesure dédiée, `measureManeuver`, calcule après coup ce qu'affiche le tableau.
    - **Pièges de l'ancienne mesure** :
      - début en avance : la fenêtre de détection se déclenche avant le virage, et le premier pas de 2° dû au bruit y suffisait (5 s d'avance en médiane) ; distance et gain au vent intégraient l'approche ;
      - manœuvre dégénérée : sans bord stabilisé avant, la vitesse d'entrée était celle du premier point du virage. Un rider qui ralentit avant de tourner faisait un sans-faute (100 %, relance 0 s, premier des podiums) ;
      - le dernier point de la fenêtre initiale n'était jamais examiné pour le minimum, et rien n'était cherché après la rotation (un 57 % se lisait 81 %) ;
      - le cap nul du premier point de trace faisait un virement fantôme : il prend désormais celui du second.
    - **Bornes retenues** : rotation sur le cap déroulé, du départ du cap d'approche à l'arrivée au cap de sortie, à max(10°, 10 % du virage) près. Vitesse d'approche : médiane de 12 s à 2 s avant. Creux cherché jusqu'à 10 s après la rotation. Un virage vu en un seul pas reste une rotation entière.
    - **Gain au vent, définition de l'utilisateur** : chemin vers le vent au virement, sous le vent à l'empannage, le plus grand en tête pour les deux. Mesuré sur la rotation seule : jusqu'à la relance, la mesure s'inversait (une relance longue allonge le chemin) ; sur 20 s fixes, elle se dégradait dès que le vent était faux de 15°. La rotation seule reste juste avec un vent faux.
    - **Décisions de l'utilisateur** : pas de ligne « distance perdue » ; plus de podium du changement de cap aux empannages, où il dépend de l'allure de sortie choisie et tombait au hasard (leur moyenne reste).
    - Égalités départagées par la meilleure conservation, et non plus par l'ordre chronologique (fréquent à 1 Hz). Manœuvres sans relance dans la minute comptées à part, hors moyenne et podium. Heure de chaque manœuvre dans les cases du podium et sur la carte.
    - **Écart au plan** : l'estimation du vent devait suivre la nouvelle réussite (une seule notion). Sur le banc, la mesure corrigée faisait tourner le vent estimé de 90° : l'orientation repose sur les lectures de la détection, gardées à part (`windCriteria`). Fragilité notée au §11 d'ETAT, avec le 5 Hz bruité, le filtre médian et la relance après changement d'allure.
71. Énergie de la course (30/09 ; commité le 03/10 avec les points 72 à 75, à la demande de l'utilisateur).
    - **Modèle** : coût par mètre selon la pente de Minetti et al. (2002), mesuré de −45 % à +45 % et borné là. On garde la forme de la courbe, et l'économie du coureur remplace son coût sur le plat. Cette économie se saisit dans Réglages → Pratiquant, à 200 ml d'O₂/kg/km par défaut, soit la règle de 1 kcal/kg/km. La vitesse agit par la puissance, plus un terme d'air k·v².
    - k vaut 0,0065, un ordre de grandeur tiré de Pugh (1971), non confirmé (§11 d'ETAT).
    - **Repos** : Mifflin-St Jeor quand poids, taille, âge et sexe sont connus, sinon 1 MET. Il est compté sur toute la durée, pauses comprises.
    - **Choix de l'utilisateur** :
      - deux chiffres : l'énergie de course, puis la dépense totale avec le repos ;
      - un graphe de la puissance ou de l'énergie cumulée ;
      - l'énergie par zone de pente ;
      - ni allure équivalente sur le plat, ni dérive chiffrée.
    - Sans poids, les valeurs s'affichent par kilo ; sans altitude, la course compte comme plate.
72. Vélo, troisième famille (01/10, APK 0.2.40 ; commité le 03/10).
    - **Choix de l'utilisateur** : le vélo est une famille propre (`velo`, calcul `cycling`), et non un calcul rangé sous Course. Il a sa bibliothèque, son analyse, sa place dans Enregistrer et Réglages, et sa couleur.
    - **Module d'analyse commun** à la course et au vélo (`LandModule`, descripteurs dans `landModules.tsx`), plutôt qu'une copie du module course. Les identifiants mémorisés de la course (`running.*`) restent tels quels, pour ne pas perdre les tailles et les onglets déjà réglés.
    - **Énergie à vélo**, modèle physique de Martin et al. (1998) :
      - pesanteur, roulement et air, divisés par le rendement de la transmission (0,97), puis par le rendement musculaire (0,25) pour le coût ;
      - travail borné à 0 en descente (roue libre, freinage gratuit) ;
      - variation d'énergie cinétique ignorée, car le GPS dérivé deux fois n'y donne que du bruit.
    - Type et poids du vélo se règlent par activité. Contrairement à la course, la masse ne se met pas en facteur : sans poids du cycliste, on prend 75 kg, et l'interface l'affiche. Le bloc « Coureur » devient « Pratiquant », commun aux deux familles.
    - Le vélo a des tops : 1, 5 et 20 min, 1 h ; 1, 5, 10, 20 et 40 km.
    - **Piège** : l'activité « Vélo » n'entre que dans la liste du premier lancement. Une liste déjà gardée n'est pas touchée : l'utilisateur crée sa propre activité Vélo dans Réglages.
    - La barre du bas à 6 onglets de ce lot décentrait le bouton rond (point 75).
73. Planification et graphes : bloc Dénivelé, « Enregistrer », départ et arrivée, temps estimé, zoom (01/10, APK 0.2.41 ; commité le 03/10).
    - **Bloc « Dénivelé »** à part, en tête du panneau, pour regarder la courbe en même temps que la carte. Les textes passent de « Ranger » à « Enregistrer ». La clé `ranger` et l'id `planning.ranger` restent : la taille du bloc y est mémorisée.
    - **Couleurs** : départ en vert, arrivée en rouge sombre, distinct du rouge des tronçons en échec. Le repère unique d'une boucle est moitié vert, moitié rouge.
    - **Temps estimé**, en course et à vélo, selon un niveau propre à chaque activité : débutant, moyen, bon, expert ou « Personnalisé » (vitesse saisie). Rien en voile.
      - Course : km-effort, où 100 m de D+ comptent comme 1 km de plat.
      - Vélo : on calcule pente par pente, avec le modèle de résistance de l'énergie.
    - **Écart au plan** : à vélo, garder en montée la puissance qui tient la vitesse du plat donnait 3 km/h à 8 %. Chaque niveau a donc une puissance de montée en W/kg. En descente, on roule en roue libre, jamais moins vite que sur le plat, avec un plafond selon le type de vélo.
    - **Zoom des graphes** :
      - on pince à deux doigts, ou on tire une zone à la souris ; « Tout voir » ramène la vue entière ;
      - un doigt garde le survol, qui suit la carte ;
      - la zone de tracé est lue par `usePlotArea` de Recharts, jamais dans son DOM interne ;
      - dans l'analyse, les graphes de vitesse et d'altitude, qui partagent l'axe, zooment ensemble. Celui de l'énergie, en temps, ne zoome pas.
74. Types de voie en planification (01/10, APK 0.2.42 ; commité le 03/10).
    - **Demande de l'utilisateur** : choisir le type de voie (Chemin, Piste, Route, Grande route) plutôt que le moyen de transport, que l'activité donne déjà. Les règles d'accès suivent l'activité :
      - à pied, escaliers permis et sens interdits ignorés ;
      - à vélo, sens interdits respectés et passages piétons pénalisés.
    - **Aucun profil de brouter.de ne sépare ces types.** Mesure sur deux trajets : `mtb` donne 48 % de pistes et 34 % de sentiers. D'où un profil maison, envoyé au serveur, réglé par deux variables de l'adresse (`voie`, `velo`).
    - Les coûts ont été réglés sur quatre trajets autour de Montpellier. Le type choisi fait le plus souvent 55 à 98 % du trajet, pour 1,0 à 1,4 fois la longueur du plus court chemin. Il reste minoritaire là où il manque.
    - **Pièges du serveur** :
      - les variables n'acceptent que des nombres (`=1` marche, `=true` échoue) ;
      - un profil absent du serveur donne HTTP 500, corps vide : on renvoie le profil, une fois ;
      - le serveur limite le débit.

      Le profil est renvoyé une fois par lancement, sur l'id gardé : le serveur n'en a qu'un fichier par appareil.
    - **Dépendance** : brouter.de doit continuer d'accepter les profils envoyés. Sinon, le calcul s'arrête.
    - Les anciennes fiches (`foot`, `mtb`, `bike`) se relisent en Chemin, Piste et Route, sans recalcul. Changer d'activité ne recalcule pas un tronçon prêt.
75. Barre du bas en cinq cases (02/10, APK 0.2.43 ; commité le 03/10).
    - **Problème** : avec le vélo, 6 cases, et le bouton rond tombait en 4e position.
    - **Choix de l'utilisateur** : Accueil · sport favori · bouton rond · Sports · Réglages.
      - Le favori se règle dans Réglages → Barre du bas. C'est la voile par défaut, et il voyage dans `reglages.json`.
      - « Sports » déplie au-dessus de la barre le menu des trois sports. Il prend le nom et la couleur du sport ouvert quand ce n'est pas le favori.
      - La barre du haut, sur ordinateur, ne change pas.
    - Le menu est ouvert pour l'adresse où on l'a déplié : un changement de page le referme sans effet React. Un voile transparent sous la barre le ferme au toucher, sans bloquer les autres onglets.
76. Puissance de course mécanique, chiffres de la carte réduite, graphe d'énergie relié à la carte (03/10, validé sur le téléphone le 04/10, APK 0.2.45).
    - **Problème remonté** : 1 400 W en moyenne sur une course, au lieu d'environ 300. La puissance affichée était la dépense de l'organisme. Elle est désormais mécanique : la dépense multipliée par un rendement de 0,25, celui du vélo, soit environ 1 W/kg par m/s sur le plat, l'ordre des capteurs de course. Les kcal ne changent pas.
    - **Carte réduite** (demande de l'utilisateur) : jusqu'à quatre chiffres choisis par activité dans Réglages, parmi ceux qui ont un sens pour sa famille : puissance sur 15 s, pente, D+ et vitesse des 300 derniers mètres, vitesse ascensionnelle, dernier kilomètre, restant… Sans choix, ceux de la famille. Le top 2 s, sans intérêt en course, n'y est plus par défaut.
    - **Pics au départ** : la vitesse du fichier était propre. Le pic venait de l'altitude GPS, qui démarre 6 à 8 m trop bas, et du lissage sur 60 s : tronqué d'un côté au départ, il posait le maximum de la montée sur le premier point. `smoothMovingPower` rétrécit maintenant sa fenêtre des deux côtés près du départ et des arrêts. La hauteur du pic, due à l'altitude, reste : l'altitude de l'IGN la ramène de 564 à 278 W sur la course du 03/10 (lot à venir).
    - **Graphe d'énergie** : zoomable, un doigt suit la carte ; les chiffres au-dessus se replient, et l'état est mémorisé, pour voir carte et graphe ensemble sur téléphone.
    - **Écartés faute de cause constatée** : pente sur fenêtre complète, plafond de pente à vélo, limite d'accélération.
    - En direct, la puissance sur 15 s compte toute position comme en mouvement : le départ peut encore sauter, le temps que le GPS trouve son altitude.
77. Parcours et balises en voile, bips d'approche (04/10, essayé à pied et validé, APK 0.2.47).
    - **Demande de l'utilisateur** : poser des points sur la carte, puis, en navigation, entendre des bips de plus en plus rapides en approchant d'un point (200 m, 150, 130, 100…), et un bip long à 50 m qui le valide ; on passe alors au suivant. Tout est réglable, par une courbe dont on tire les points ; c'est valable pour tous les sports de voile.
    - **Choix de l'utilisateur** :
      - toutes les balises se valident, départ compris : un bip long dès le départ prouve que le son marche avant d'aller sur l'eau ;
      - bips et vibration, la vibration réglable ;
      - une courbe de base par activité dans Réglages, et une courbe propre à un parcours, rangée dans sa fiche, qui prime en navigation.
    - **Planification en voile** : sur l'eau, aucun chemin à suivre. Les tronçons passent en ligne droite, les balises sont numérotées, et le bloc « Parcours » remplace le dénivelé. Un tracé calculé par les chemins est redressé quand on passe à une activité de voile, ou à l'ouverture.
    - **Avancement** : `followProgress` s'accroche au tracé à 60 m au plus, alors qu'on tire des bords. En voile, il se compte donc par balises.
    - **Validation** : elle se juge sur le segment parcouru depuis la position précédente, pas sur la position seule. Une trace peu dense qui passe la balise entre deux points la valide quand même (règle 10), et le résultat ne dépend pas de la cadence (testé à 1 Hz et 5 Hz).
    - **Pièges** :
      - écran éteint, les minuteries de la WebView sont bridées (point 40). Le rythme des bips est donc tenu par un greffon Android, sur un fil à lui ; la couche web ne règle que l'intervalle, à chaque position reçue. Le service GPS garde le processeur éveillé ;
      - en arrière-plan, Android ne fait vibrer une application que si l'usage est déclaré : la vibration est d'usage alarme ;
      - le son passe par le flux des alarmes : il sonne téléphone en silencieux, au volume des alarmes. C'est un sinus de 2 kHz, synthétisé une fois puis rejoué ;
      - dans le GPX exporté d'une boucle, l'arrivée s'appelle « 4 », alors que la carte montre « 1 ».
