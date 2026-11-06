# Construire Tracker

Une page pour qui reprend le dépôt : de quoi on a besoin, comment on vérifie, comment on sort une application web ou un APK. Le détail de l'architecture est dans `CLAUDE.md` et `docs/ETAT_DU_PROJET.md`.

## Outils

- **Node 22.18 ou plus** (22.18+, 24 ou 26+) : Vitest 5 demande 22.12, et Capacitor lit `capacitor.config.ts` par le Node lui-même depuis TypeScript 7, ce que Node fait à partir de 22.18 (sous 22.12, `npx cap sync android` échoue : vu sur GitHub le 06/11) ; Node 23 et 25 sont refusés. `.nvmrc` donne la version de départ (26, celle du poste), `engines` de `package.json` la plage permise. Puis `npm ci`.
- **JDK 21** pour Android, et pas un autre : Gradle 8.14.3 (`android/gradle/wrapper/gradle-wrapper.properties`) ne tourne pas sous le Java 25 des Android Studio récents. `android/gradle/gradle-daemon-jvm.properties` (`toolchainVersion=21`) le demande au démon Gradle ; `JAVA_HOME` doit tout de même pointer vers un JDK 21 pour lancer `gradlew`.
- **SDK Android 36** (`compileSdkVersion` et `targetSdkVersion` dans `android/variables.gradle`), application installable dès Android 7 (`minSdkVersion` 24, WebView 111 au moins : `android.minWebViewVersion` de `capacitor.config.ts`, la cible de construction de Vite). Dire où est le SDK : `ANDROID_HOME`, ou `sdk.dir=…` dans `android/local.properties` (fichier de la machine, ignoré par git).

## Vérifier

```
npm run verif                     lint (sans avertissement toléré), tous les tests dans un ordre mélangé, build
node outils/verif.mjs --rapide    typecheck, lint, tests des fichiers modifiés
```

`npm run verif` vérifie aussi les renvois des documents (`outils/docs-cites.mjs`, `outils/docs-inventaire.mjs`) : un fichier cité qui n'existe plus fait échouer. La même commande tourne à chaque envoi vers `main` (`.github/workflows/verif.yml`), suivie de `npx cap sync android` puis du test JUnit du format `.imu` (`./gradlew testDebugUnitTest`). Ce test ne fait pas partie de `npm run verif` en local.

## Web

`npm run build` écrit `dist/`, à servir tel quel par n'importe quel hébergeur statique. `public/_redirects` (`/*  /index.html  200`) renvoie toute adresse vers l'application, sans quoi un rechargement sur `/voile/analyse` donne une erreur 404 ; un hébergeur qui ignore ce fichier (tout sauf Netlify et Cloudflare Pages) demande la même règle dans sa propre configuration. L'application n'a pas de serveur à elle (voir le README pour ce qu'elle appelle).

## Android

1. Clé de signature, une fois, **hors du dépôt** et sauvegardée ailleurs :
   `keytool -genkeypair -v -keystore tracker-release.jks -alias tracker -keyalg RSA -keysize 2048 -validity 10000`
2. Copier `android/keystore.properties.exemple` en `android/keystore.properties` (ignoré par git) et remplir `storeFile` (chemin du `.jks`, relatif à `android/app/` ou absolu), `storePassword`, `keyAlias`, `keyPassword`. Sans ce fichier, `assembleRelease` et `bundleRelease` refusent de sortir, et `assembleDebug` retombe sur la clé de debug du PC.
3. Construire :
   ```
   npm run build
   npx cap sync android
   cd android
   ./gradlew assembleRelease      (Windows : gradlew.bat)   APK : app/build/outputs/apk/release/Tracker-<version>.apk
   ./gradlew bundleRelease        AAB pour Google Play
   ```
   La version de l'APK vient de `package.json` (`versionName`) et en tire `versionCode` ; elle se monte avant chaque APK diffusé.

## Ce qu'un changement casse

- **`appId`** (`io.github.segneur.tracker`, dans `capacitor.config.ts` et `android/app/build.gradle`) : Android y voit une autre application, installée à côté de la première, sans ses données.
- **La clé de signature** : Android refuse la mise à jour d'une application signée par une autre clé ; il faut la désinstaller, ce qui efface les données de l'application (réglages de l'appareil ; les sessions, dans le dossier mémoire hors de l'application, restent mais il faut le désigner de nouveau). Garder le `.jks` et ses mots de passe.
- **`versionCode`** : il doit croître à chaque APK, sinon Android refuse la mise à jour.
