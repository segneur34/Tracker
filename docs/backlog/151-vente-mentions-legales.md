# 151 · Vente : mentions légales, politique de confidentialité, manifeste Android, sauvegarde

Noté le 03/11 (audit avant vente, synthèse `~/.claude/plans/audit-vente-0111/RAPPORT.md`, lignes A3, A4, A7, C15 ; détail dans `angle-V1.md` (V1-3, V1-4), `angle-T4.md` (T4-1, T4-3, T4-4, T4-5), `angle-C6.md` (C6-3, C6-6)). Modèle | Réflexion : Opus | high.

## Tel que noté

- « `react-leaflet` et `@react-leaflet/core` sont sous licence Hippocratic 2.1 (non approuvée OSI, clauses de conduite, arbitrage public) et leur notice n'est livrée nulle part ; plus largement, aucune mention de licence tierce n'existe (ni fichier, ni écran, ni `build.license` de Vite). L'APK déjà chez les testeurs ne respecte pas la clause "Notice". »
- « Rien pour publier sur Google Play : ni politique de confidentialité (exigée pour la position et pour la déclaration santé), ni écran "À propos", ni brouillon des formulaires "Sécurité des données", "Applications de santé" et "Services au premier plan". »
- « Manifeste Android difficile à justifier à la revue Play : deux services au premier plan (`specialUse`, `connectedDevice`) qui ne servent qu'aux familles retirées, un récepteur de démarrage inutilisé du greffon GPS, et la permission "ignorer l'optimisation de la batterie" que Play réserve à quelques catégories. »
- « Sauvegarde Android active sans règles : profil de santé, positions du journal et identifiant d'appareil partent dans la sauvegarde Google ; au-delà de 25 Mo (cache de tuiles) elle cesse sans bruit ; un nouveau téléphone restauré porte le même identifiant d'appareil que l'ancien, et les deux s'écrasent le même fichier de réglages. »

## Où, aujourd'hui

- Licences : 61 paquets de production (52 MIT/ISC/BSD, 2 Hippocratic, 1 MPL-2.0 non modifié, 2 OFL) ; `vite.config.ts` sans `build.license` ; `package.json` sans `license` ni `author` ; aucun écran « À propos » ni « Licences ». 13 fichiers importent `react-leaflet` (≈ 45 emplois : `MapContainer`, `Polyline`, `CircleMarker`, `Marker`, `Popup`, `useMap`…) ; `BaseTileLayer` et `TrackSegmentsLayer` sont déjà des couches maison sur `leaflet`.
- `AndroidManifest.xml` : `IntervalTimerService` (`specialUse`), `HeartRateService` (`connectedDevice`), `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, `allowBackup="true"` sans `dataExtractionRules` ni `fullBackupContent` ; greffon GPS : `GeofenceBootReceiver` et `RECEIVE_BOOT_COMPLETED` jamais utilisés.
- Ce qui part de l'appareil (pour la politique) : tuiles OSM et Esri (zone regardée, IP), Photon (texte et centre de la carte), BRouter, IGN, Overpass (points d'itinéraire) ; FC, profil, photo ne partent jamais ; aucune télémétrie.

## Voulu

- Écran « Licences » dans Réglages, généré au build (`build: { license: true }` de Vite, puis liste Android), avec la ligne MPL et le lien vers les sources du greffon ; `react-leaflet` remplacé par de petits composants maison sur `leaflet` (BSD-2) ; test qui refuse une dépendance de production hors liste blanche de licences.
- Politique de confidentialité (traitement local, services tiers et ce qui leur part, sauvegarde Android, contenu du GPX téléchargé), écran « À propos » (version, licences, lien), brouillons des trois formulaires Play.
- Manifeste : les deux services et leurs permissions retirés (avec le 154), `tools:node="remove"` sur le récepteur de démarrage et `RECEIVE_BOOT_COMPLETED`, demande directe de batterie remplacée par l'ouverture de la liste système (sans permission) ou justifiée par écrit.
- Sauvegarde : règles qui excluent `tracker.deviceId`, `tracker.memoryFolder`, le journal, `tuiles/` et les vignettes ; ou `allowBackup="false"` (le dossier mémoire est déjà la sauvegarde, DECISIONS §8).

## Pourquoi

Bloquant pour vendre et pour publier sur Play ; un acheteur professionnel fait l'audit de ses dépendances et de son manifeste avant d'acheter.

## Première partie, plan du 05/11

Maquette validée : https://claude.ai/artifact/95Kv4TQGgbbjo5YUQ1Smsz. Suite au n° 171 (`react-leaflet`, politique, formulaires Play, services, batterie).

**Décisions de l'utilisateur (05/11) :**
- Sauvegarde Google et transfert d'appareil coupés, en prévision du fork. Le dossier mémoire reste la seule sauvegarde.
- Texte du bloc : « Vos sessions restent sur cet appareil et dans votre dossier mémoire, sans compte. Les fonds de carte, la recherche de lieux, les itinéraires, ainsi que l'altitude et le revêtement des parcours à pied et à vélo, passent par des services en ligne. »

**Liste des licences :**
- `build: { license: { fileName: 'licences.json' } }` dans `vite.config.ts` : essayé, 38 paquets, 81 Ko, `{name, version, identifier, text}`, le JS réellement regroupé. Le nom reste à la racine : le défaut `.vite/` serait écarté de l'APK par `ignoreAssetsPattern`.
- Complément versionné `public/licences-hors-js.json`, généré à la main par `outils/licences-hors-js.mjs` : polices OFL et `@capacitor/android` (texte lu dans `node_modules`), natif tiré de `gradlew :app:dependencies --configuration releaseRuntimeClasspath` (sortie en fichier texte passée au script). Le cache Gradle n'a presque pas de POM : petite table groupe → licence, arrêt sur un groupe inconnu : `androidx.*`, `org.jetbrains.*`, `org.jspecify`, `org.apache.cordova`, guava en Apache-2.0 (texte repris de `node_modules/typescript/LICENSE`) ; `com.google.android.gms`, licence du SDK Android avec lien https://developer.android.com/studio/terms. Une ligne par famille native (« AndroidX, n composants »). Greffon GPS : notice avec le lien https://github.com/Cap-go/capacitor-background-geolocation et « non modifié ». Vérifier la licence d'`io.ionic.libs:ionfilesystem-android` (son POM ne donne qu'un lien) ; si elle n'est pas libre, le signaler.
- Chargement au dépliage de « Licences » seulement, par `fetch` de `${import.meta.env.BASE_URL}licences.json` et du complément ; rien au démarrage. En `npm run dev`, `licences.json` n'existe pas (à vérifier : repli sur `index.html`) : le parseur rend `null`, la page montre le complément et « Liste complète dans la version construite ».

**Fichiers :**
- Modifiés : `vite.config.ts`, `src/pages/SettingsPage.tsx` (clé `apropos` dans `SettingsBlock` et `SETTINGS_BLOCK_DEFAULTS`, carte après Tutoriels), `src/pages/SettingsPage.css`, `android/app/src/main/AndroidManifest.xml`.
- Créés : `src/components/AboutSettings.tsx`, `src/core/licenses.ts` et son test (`parseLicenseList`, `licenseGroup`, `refusedLicenses`, liste blanche, exceptions), `src/platform/androidManifest.test.ts`, `outils/licences-hors-js.mjs`, `public/licences-hors-js.json`, `android/app/src/main/res/xml/data_extraction_rules.xml`, `outils/banc/apropos.mjs` avec son entrée dans `outils/banc/SCRIPTS.md` et le registre `scripts.mjs`.
- À réutiliser : `PanelTitle`, `.settings-block__body`, la présentation d'`ActivityPart` (`.settings-part__toggle`, `SettingsPage.tsx:182`, à exporter ou sortir, pas à recopier), `useOpenSections` (bloc mémorisé, couvert par « Tout réduire » ; l'intérieur en `useState` local), `--font-logo`, `.settings-display__note`, `Button`, `__APP_VERSION__`, `planning/fetchJson.ts` (`fetchWithin`, `readJson`), la lecture de `nativeConstants.test.ts:21-35`.

**Manifeste :**
- `xmlns:tools` à la racine, puis `<receiver android:name="com.capgo.capacitor_background_geolocation.GeofenceBootReceiver" tools:node="remove" />` et `<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" tools:node="remove" />`. Sûr : ce récepteur ne restaure que des zones de géorepérage et l'application n'appelle jamais `addGeofence` ; `androidx.work` déclare aussi la permission, et WorkManager ne sert qu'aux zones du greffon.
- `IntervalTimerService`, `HeartRateService`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, `GeofenceBroadcastReceiver` : on n'y touche pas.
- `allowBackup="false"` et `android:dataExtractionRules="@xml/data_extraction_rules"`, qui exclut tout dans `<cloud-backup>` et `<device-transfer>` : le faux seul n'arrête pas le transfert d'appareil sous Android 12 ou plus (à vérifier à l'écriture). Les règles seules ne suffisaient pas : les Preferences tiennent dans un seul fichier.

**Tests :**
- `licenses.test.ts`, sur `package-lock.json` (paquets sans `dev` ni `devOptional`) : licence hors liste refusée, entrée sans licence refusée ; liste blanche MIT, ISC, BSD-2-Clause, BSD-3-Clause, 0BSD, MPL-2.0, OFL-1.1, Apache-2.0 ; expressions composées découpées (`victory-vendor`) ; exceptions nommées `react-leaflet` et `@react-leaflet/core` ; une exception devenue inutile fait échouer le test ; classement dans les deux groupes ; parseur sur une réponse HTML ; complément aux versions du lock et d'`android/variables.gradle` ; groupe natif hors table refusé.
- `androidManifest.test.ts` : retraits, sauvegarde et règles présents ; services et permission batterie restent ; le manifeste du greffon déclare toujours ce récepteur ; aucun `addGeofence` dans `src/platform/location.ts`.

**Banc :** `node outils/banc/passe.mjs reduire tailles reglages-aide tutoriels apropos`. `apropos.mjs` sur Vite : `fetch` remplacé avant chargement par une liste synthétique ; logo, version, paragraphe, dépliages, « Voir les N autres », texte de licence, aucun débordement à 390×844, cas sans `licences.json`. Après build : `dist/licences.json` contient `react-leaflet`, manifeste fusionné sans `RECEIVE_BOOT_COMPLETED` ni `GeofenceBootReceiver`.

**Essais au téléphone :** Réglages › À propos sur l'APK, en mode avion → la liste complète se charge, un texte de licence s'ouvre. APK mise à jour par-dessus l'ancienne, enregistrement GPS écran éteint puis redémarrage du téléphone → l'appli repart, réglages et dossier intacts.
