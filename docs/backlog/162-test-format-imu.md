# 162 · Test du format du fichier des capteurs

Modèle | Réflexion : Opus | high. Découpé le 05/11 ; la copie par flux va au n° 172.

## Voulu

Le format `.imu` a deux auteurs : `ImuWriter.java` l'écrit au téléphone, `core/imuFile.ts` le lit. Rien ne garde leur accord. Un test le garde, des deux côtés :
- un test JUnit (`android/app/src/test/`) écrit un `.imu` déterministe par `ImuWriter` ;
- ce fichier est versionné comme référence, et un test vitest le relit par `core/imuFile.ts` et vérifie en-tête, flux, instants et valeurs ;
- le test JUnit échoue si ce qu'il produit ne se relit plus comme la référence ; vitest passe sans Gradle.

Aucun changement du code de l'application. Si `ImuWriter` dépend d'Android, faire le minimum pour le tester et le signaler dans le rapport.
