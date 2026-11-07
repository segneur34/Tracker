# 35 · Montre connectée Android

Détail de l'élément 35 de `docs/BACKLOG.md` (Plus tard). Repris le 28/10 (lot 33) de la fiche 5 d'`A-FAIRE.md` (archivée dans `~/.claude/plans/archives/A-FAIRE-2810.md`), telle quelle.

### 5. Montre connectée Android · priorité 2 (proposée)
- Noté le : 22/10 (WhatsApp) · reçu le : 27/10 · état : à clarifier
- Tel que noté : « Lien avec montre connectée android possible ? »
- Où : enregistrement (capteurs), ou import des sessions.
- Aujourd'hui : seule la ceinture cardio Bluetooth est lue (§12 d'ETAT) ; une montre est citée parmi les capteurs à venir (ETAT §11, point 118) ; les GPX d'une montre s'importent déjà par le dossier mémoire.
- Voulu : un lien avec la montre, à préciser.
- Questions : quoi faire avec la montre ? → réponse (27/10) : les trois, lire sa FC à la place de la ceinture, importer ses sessions sans fichier, piloter l'enregistrement du poignet, et d'abord savoir si c'est possible. Réponse de Claude (27/10) : la FC, oui si la montre diffuse la FC en Bluetooth standard (Garmin « diffusion FC », Polar, Coros, Suunto ; pas une montre Wear OS ni un bracelet Xiaomi sans application tierce) : rien à coder, c'est la ceinture d'aujourd'hui ; l'import sans fichier dépend de la marque et passe par son compte en ligne (gros chantier, à part) ; piloter du poignet demande une application Wear OS à part (très gros chantier). Reste : quelle montre (marque et modèle) ?

### Montres connues (06/11)
- **Garmin Forerunner 255** (prêtée, réglée pour la personne qui la prête ; ses activités restent sur la montre) : FC optique au poignet, diffusable en Bluetooth standard (profil « ceinture cardio ») : Tracker la lit telle quelle (essai du 06/11), mais la diffusion s'est coupée quand la montre a lancé sa propre course. Altimètre barométrique (D+ de référence pour `useTerrainElevation`). Sessions exportables de Garmin Connect en GPX (FC, cadence, altitude dans les extensions, lues par `core/gpxParser.ts`) ou FIT ; import sans fichier = API Garmin Connect, chantier à part.
- **Suunto Ambit3** : pas de FC optique (ceinture Suunto Smart Sensor seulement), export GPX ou FIT par l'application Suunto ; calories par Firstbeat comme Garmin : pas une référence indépendante. Utile surtout pour la trace et la distance.

## Plan et choix tranchés (06/11)

Reste : « Ouvrir avec Tracker » et le lecteur FIT. L'import passe aujourd'hui par `importEntries` puis `addGpx`, GPX seulement.

**Choix : conversion en GPX à l'entrée, aucun second format.** Le FIT est converti une seule fois par `buildGpx`, puis rangé par `addGpx` : mémoire, fiche, balayage, vignettes, paquet GPX et les deux appareils ne changent pas. FC, cadence, vitesse et cap vont dans `gpxtpx`, déjà relus par `parseGpx`. Les pauses deviennent des `<trkseg>`. `buildGpx` divise `cadenceSpm` par 2 et le FIT donne des foulées ou des tours par minute : le convertisseur passe le double, avec un commentaire et un test. Règle 6 : la distance du FIT (`total_distance`) est ignorée.

### Partie A (sans APK, utile seule)
À créer :
- `src/core/fitParser.ts` et test : lecteur pur, en SI. En-tête 12 ou 14 octets, définitions, deux boutismes, temps compressé, champs développeur sautés, valeurs invalides, redéfinition d'un message local. Messages : `file_id`, `sport`, `session`, `event` (minuterie), `record` (temps, position, altitude et `enhanced_altitude`, FC, cadence et `fractional_cadence`, vitesse et `enhanced_speed`).
- `src/library/fitToGpx.ts` et test : du FIT au texte GPX, testé en aller-retour par `parseGpx`.
- `src/test/fit.fixture.ts` : fabrique un FIT en octets.
- `outils/banc/import-fit.mjs` et son entrée dans `outils/banc/SCRIPTS.md`.
À toucher : `src/hooks/sessionLibrary/importer.ts` (branche `.fit`, GPX traités avant les FIT, regex de `pickedEntry`), `src/platform/memoryFolder.ts` (`folderImportPaths`, regex de `pickFolderToImport`), `src/library/record.ts` (`isFitFileName`), `src/library/importReport.ts` (FIT qui ne sont pas des activités), `src/library/naming.ts` (`FOREIGN_TYPES` si un nom manque), `src/components/ImportButtons.tsx` (`accept=".gpx,.fit"`, libellé « Importer des GPX ou FIT »), `src/pages/SessionLibrary.tsx` (aides, lignes 702-703), `src/hooks/sessionLibrary/couches.test.ts` si la façade change.
À réutiliser : `parseGpx`, `buildGpx` (`src/recording/gpxWriter.ts`), `sessionTitle` (appelé dans `src/hooks/useRecorder.ts`), `guessSport`, `findSessionAt` (`src/hooks/sessionLibrary/memory.ts`), `canImportSessions`, `ImportEntry`, `pickFolderToImport`, `readPickedBytes`.

Comportements :
- Sport : le numéro FIT devient un nom écrit dans `<type>`, lu par `guessSport`. Pas de question à l'import. Inconnu, `generic` ou multisport aux sports différents : session à classer (§8). Multisport : une seule session.
- FIT sans aucune position (tapis, salle) : refusé avec un message clair.
- Points sans position dans une trace GPS : écartés, comme dans un GPX.
- Doublons : `findSessionAt` compare le début de trace ; un même FIT réimporté, ou son GPX Garmin, compte « déjà présente », rien n'est écrasé. La session de Tracker et celle de la montre pour une même sortie restent deux sessions.
- Illisible : `failed` avec nom et raison, rien n'est écrit, les autres continuent. FIT coupé ou somme de contrôle fausse : on garde les points lus jusqu'à la coupure, refus seulement s'il n'y en a aucun.
- FIT qui n'est pas une activité (`file_id` de type différent de 4) : ignoré en silence dans un dossier, phrase claire s'il est seul.
- Sans mémoire ou en lecture seule : refus avec la phrase existante.
- Pas de ZIP. Dépose d'un `.fit` à la main dans `sessions/` non gérée : le balayage reste GPX.

**Question Q64, réponse de l'utilisateur le 07/11, conforme au défaut** : le `.fit` d'origine n'est pas gardé, le GPX seul (§8). Le code n'y fait rien de plus.
**Question Q65, réponse de l'utilisateur le 07/11 : un dossier complet doit pouvoir s'importer, ce que « Tout importer » fait** : dès qu'un dossier contient plus d'un FIT activité, confirmation « N activités de montre dans ce dossier, tout importer ? » dans l'application (écran dessiné, pas `confirm()` natif si un patron existe), et l'aide conseille de copier d'abord ses seuls fichiers dans un dossier du PC ou de les choisir un par un. Refus = rien importé. Pas d'écran de sélection. Raison : la montre est prêtée, les activités de la personne qui la prête ne doivent pas entrer par mégarde.

Vérification de A :
- Tests purs sur FIT fabriqué : unités, semi-cercles, époque 1989, deux boutismes, temps compressé, champs développeur, valeurs invalides, redéfinition d'un message local ; pause en deux `<trkseg>`, cadence aller-retour, fichier coupé, signature fausse, fichier vide, type non activité ; même résultat à 1 Hz et à intervalles variables ; `importEntries` : doublon FIT/GPX, sans dossier, illisible parmi des bons, confirmation du dossier.
- Lecture du vrai FIT, hors dépôt : `D:\memoire Tracker\2026-11-06-16-57-11.fit` attendu 5 256 points à 1 Hz, de 15:57:11Z à 17:24:46Z, distance montre 4,695 km sur 15:57:11Z à 16:29:30Z. Ces chiffres viennent du lecteur de diagnostic séparé `outils/banc/distance-diagnostic.mjs`. Rien de ce fichier n'entre dans le dépôt, ni positions ni fichier.
- Les numéros du profil FIT sont à confronter au vrai fichier et au profil officiel, pas de mémoire seule.
- Banc `import-fit.mjs` : import par `setFileInputFiles` d'un FIT fabriqué, chiffres et FC à l'écran, réimport « déjà présente », faux FIT avec message.

### Partie B
« Ouvrir avec Tracker » et « Partager vers Tracker » : `IncomingFilePlugin.java` copie tout de suite dans une file privée (le droit de lecture meurt avec l'activité), plafond de 30 Mo, signature vérifiée ; `src/platform/incomingFile.ts`, `src/hooks/sessionLibrary/incoming.ts`, bandeau `IncomingFileNotice`. Rien pendant un enregistrement, rangé après l'arrêt. Copie retirée après verdict, gardée sur un échec d'écriture et retentée au lancement suivant ; refus définitif sinon. `file://` refusé. Filtres `VIEW` et `SEND`, sans `BROWSABLE`, pas de `SEND_MULTIPLE`, pas de ZIP.
