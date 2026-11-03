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
