# 116 · Mémoire : ne plus perdre de données

Brief écrit le 01/11 d'après l'audit en lecture seule du même jour. Modèle | Réflexion : Opus | xhigh (ordres d'écriture et relectures concurrentes). Plan par l'agent `Plan` d'abord. À faire avant le découpage de `useSessionLibrary.ts` (n° 113), qui doit rester neutre.

## Le fait

Les écritures sont sûres (fichier temporaire puis renommage, fiche plus récente en lecture seule, import défait s'il échoue). Mais quatre chemins perdent des données, et trois défauts dorment. Lignes relevées par l'audit, à revérifier ; lire avant tout la section 8 de `docs/DECISIONS.md` et ETAT §9.

## À faire

1. **Session enregistrée sans dossier accessible** (`hooks/useSessionLibrary.ts:1688-1701`, commentaire l. 1750 ; `hooks/useRecorder.ts:457`) : elle part dans `en-attente/` en GPX seul, puis le journal est effacé. Le GPX ne porte que le calcul (`library/gpxWriter.ts:83`) : activité choisie, repères « Note », séances du compteur, résultat du test et foil sont perdus, et la session prend à l'arrivée la première activité de son calcul. Garder ces données à côté du GPX en attente (une fiche en attente écrite avant lui, comme les capteurs), et les reprendre au rangement (`flushPending`).
2. **Fiche dont l'écriture a échoué jamais retentée** (l. 591, 616-624) : `unwritten` n'est vidé par personne ; `flushWrites` ne vide que les minuteurs. Après « Mettre à jour » (l. 2160) ou « Choisir un dossier » (l. 2075), l'erreur est effacée et la relecture remet la fiche du disque à la place de celle en mémoire (`keptInMemory` ne garde que les saisies faites après le début de la relecture) : nom ou notes perdus. Retenter les fiches `unwritten` à chaque `flushWrites` et avant toute relecture ; une relecture ne remplace jamais une fiche `unwritten` ; l'erreur reste tant qu'elle n'est pas écrite.
3. **Appli tuée entre le GPX et sa fiche** (l. 1728-1729, 1659-1673) : au relancement, le balayage crée une fiche neuve (source « import », sans activité ni repères) ; refaire « Analyser » depuis le journal récupéré tombe dans la branche doublon, qui ne reprend rien pour un enregistrement, puis le journal est effacé. La branche doublon d'un enregistrement complète la fiche existante (activité si elle n'en a pas, repères, séances, test, foil). Variante : `flushPending` tourne avant `completeScan` (l. 1421-1422), `scanCompletion` encore `null` : une session en attente coupée au même endroit est rangée une seconde fois sous `-2`. Ne pas ranger avant la fin du balayage.
4. **Une fiche illisible rend toute la mémoire indisponible** (l. 1087) : les fiches sont lues par `Promise.all` sans protection ; sur le téléphone, `readText` lève sur une erreur d'accès, `attach` lève, `openLibrary` passe tout en « indisponible » (l. 1510). ETAT dit que seule la lecture de `sessions/` doit le faire : une fiche en échec est traitée comme illisible (`rememberUnreadable`), les autres s'ouvrent.
5. **Défauts qui dorment**, à fermer dans le même lot :
   - cache allégé des fiches sans numéro de version (`library/record.ts:853`, `:871` ; `useSessionLibrary.ts:353-371`) : un champ ajouté à `RECORD_LIGHT_FIELDS` alors qu'il existe déjà dans des fiches serait effacé à l'écriture suivante (évité deux fois de justesse, `marks` le 14/10 et `test` le 25/10). Le cache porte l'empreinte de `RECORD_LIGHT_FIELDS` et se refait quand elle change ;
   - import d'un dossier et recopie de la mémoire du navigateur vers un dossier (l. 1831-1832, 2092) : une fiche d'une version plus récente, ou en lecture seule, est remplacée par une fiche vierge. La recopier telle quelle ;
   - l. 1656 : session déjà présente et partielle dont la relecture de la fiche échoue (`.catch(() => undefined)`) : le compte rendu dit « déjà présente » sans plus. Le dire.

Tests purs pour chaque point, sur une mémoire simulée (écriture refusée, fichier illisible, coupure entre deux écritures) ; `npm run verif` ; banc sur la bibliothèque, texte inchangé hors des cas provoqués.

## Ce que le lot ne fait pas

Pas de commit, pas de version, aucune décision de produit. Pas de découpage du fichier (n° 113). Ne pas toucher à `useRecorder.ts` au-delà de l'appel à `saveRecordedSession` (le n° 115 y travaille en même temps). Rien dans `docs/` hors ce fichier.
