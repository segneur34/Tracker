# 156 · Natif Android et Google Play : chute du moteur de rendu, verrous de veille, notification du greffon, AAB, gros fichiers

Noté le 03/11 (audit avant vente, synthèse `~/.claude/plans/audit-vente-0111/RAPPORT.md`, lignes C10, C14, C16, D14 ; détail dans `angle-C6.md` (C6-1, C6-2, C6-4, C6-5, C6-9, C6-10), `angle-C4.md` (C4-2), `angle-T4.md` (T4-2)). Modèle | Réflexion : Opus | high. Essais au téléphone à prévoir (version de débogage).

## Tel que noté

- « Si le moteur de rendu de la WebView tombe, tout le processus est tué, enregistrement compris, sans alerte (aucun écouteur `onRenderProcessGone`) ; et une relance de la page en cours d'enregistrement arrête le GPS et range ce qu'il y avait, rien ne reprend la sortie. »
- « Deux verrous de veille de l'application tenus pendant toute une sortie de 2 à 4 h, en plus de celui du greffon GPS : Google Play les compte depuis mars 2026 ("verrous excessifs") et peut sortir l'appli des recommandations. »
- « Numéro et canal de la notification du greffon GPS recopiés à la main sans test ; `assembleRelease` sans `keystore.properties` produit un APK non signé sous un nom ordinaire, et rien ne produit l'AAB qu'exige Play ; aucun test Java, le test instrumenté du gabarit échoue. »
- « Un GPX très gros (plusieurs dizaines de Mo) ou une grosse capture passe d'un bloc en base64 par le pont : plantage possible à chaque lancement tant que le fichier est dans `sessions/`. »

## Où, aujourd'hui

- `MainActivity.java` : aucun `WebViewListener` ; `BridgeWebViewClient.onRenderProcessGone` de Capacitor rend `false` sans écouteur, Android tue alors le processus. `main.tsx` + `useRecorder.recoverInterruptedRecording` : à la relance, le service GPS « orphelin » est arrêté et la session rangée en attente.
- `BeeperPlugin.java:93-101,220-227` (« Tracker:veille-gps », repris à chaque position), `MotionPlugin.java:298-306` (« tracker:capteurs », 8 h) ; le service de position du greffon tient déjà le processeur.
- `RecordingNotificationPlugin.java:37-39` recopie `28351` et `com.capgo.capacitor_background_geolocation`, constantes privées du greffon.
- `android/app/build.gradle` : `release` signé seulement si `keystore.properties` existe, sinon APK non signé renommé `Tracker-<version>.apk` ; `bundleRelease` jamais documenté ; `ExampleInstrumentedTest` attend `com.getcapacitor.app`.
- `MemoryFolderPlugin.java` `readText` / `readBase64` : fichier entier, plusieurs copies, `OutOfMemoryError` non rattrapée ; aucune limite de taille côté page ; `folderLayout.ts` invite à déposer un GPX dans `sessions/`, lu au lancement suivant.

## Voulu

- Un `WebViewListener` dans `MainActivity` qui rend `true` sur `onRenderProcessGone`, consigne la cause et recharge la page ; à la reprise d'un journal dont la dernière ligne a moins de quelques minutes, proposer « Continuer l'enregistrement » (même journal, segment neuf) au lieu de couper. Essai : `chrome://crash` dans la WebView en débogage pendant un enregistrement.
- Retirer les verrous redondants (échéance du GPS muet par `AlarmManager.setExactAndAllowWhileIdle`) ; relevé par `adb shell dumpsys power` pendant un enregistrement.
- Un test vitest qui lit le source Java du greffon dans `node_modules` et compare les deux constantes à celles de `RecordingNotificationPlugin.java`.
- `release` sans clé → `GradleException` explicite ; `bundleRelease` documenté ; gabarits de test Java supprimés, un test JUnit qui écrit un `.imu` relu par vitest.
- Au listage, écarter tout fichier au-delà d'un plafond (30 Mo par exemple) avec un avertissement dans la bibliothèque ; rattraper `OutOfMemoryError` dans `readText` / `readBase64` ; à terme, copie de la capture vers le dossier mémoire côté Java, par flux.

## Pourquoi

C'est la fonction première au téléphone, et ce que la revue Play et Android vitals regardent.

## Réponses de l'utilisateur (04/11)

- Verrous de veille : retirés maintenant, en connaissance de cause ; un essai écran éteint d'au moins 2 h est requis (levée ponctuelle de la consigne « ne pas réclamer le test de 2 h »).
- Reprise après chute du moteur : seule, sans rien demander, si le service GPS est encore vivant (même journal, segment neuf) ; appli tuée et rouverte moins de 10 min après la dernière ligne du journal : proposition « Continuer l'enregistrement » ; au-delà, comportement actuel.
- Plafond de 30 Mo (orchestrateur) : GPX et fiches lus au lancement seulement, jamais les `.imu`, lus à la demande (plus gros fichiers réels : GPX 2,6 Mo, `.imu` 15,4 Mo).
- Reporté en Plus tard : test JUnit de `.imu`, copie de la capture par flux.

## Partie A, commit du 04/11

- Retrait des verrous confirmé à la lecture de la source du greffon : son verrou est sans échéance et tenu tant que le service tourne, pause comprise, le minuteur « GPS perdu » n'est armé qu'après une position. Reste à prouver au téléphone en veille profonde (`dumpsys deviceidle force-idle`) et par l'essai 108. Limite : Play compte encore le verrou du greffon, le gain y reste partiel.
- Cas mineur gardé : localisation coupée au départ, capture sans service ni verrou ; aucune position n'existe alors.
- Java de tous les lots du paquet compilé par `assembleDebug` le 04/11.

## Sonde du 04/11, sur le téléphone (0.4.62 plus l'écouteur seul, fausses positions injectées, retirées ensuite)

- `bridge.reload()` depuis `onRenderProcessGone` remet bien la page, malgré ce qu'annonce la documentation d'Android : écran allumé en 0,2 s, écran éteint en moins d'une seconde, même processus.
- Service GPS au premier plan et verrou survivent à la chute. 13 positions en 15 s reçues par `window.Capacitor.fromNative` dans la page rechargée, `save` et `success` vrais, même `callbackId` ; `stop` propre ensuite.
- `onPageLoaded` peut arriver deux fois pour une seule recharge : à prendre en compte.
- Un service lancé téléphone verrouillé reste « inactive » pour le GPS : à ne jamais relancer écran éteint, comme le plan le dit.
