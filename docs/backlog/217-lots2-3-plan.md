# 217, lots 2 et 3 · « Récupérer » puis « Synchroniser » par le câble : plan (agent Plan, 25/11 au soir) et choix tranchés

Étude : `docs/backlog/217-exe-ordinateur.md`. Lot 1 (coquille et dossier du disque) : `docs/backlog/217-lot1-plan.md`, fait et validé.

## Un portage

Gtracker (`D:\gong tracker\Gtracker`, lecture seule par `git -C "D:/gong tracker/Gtracker" show <commit>:<fichier>`) a fait les deux, par le câble et le Wi-Fi :
- Récupérer, lot 447 : 856b92f (la coquille lit le téléphone, lecture seule), a4e914a (bouton et import), 6c63628 (script `exe-recuperer.mjs`).
- Corbeille du PC, lot 448 : eebbe6a, d903a01, b45cb74. Le moteur de synchronisation en dépend.
- Synchroniser, lot 449 : 30d749a (moteur pur), 66fabac (écriture par le câble), b728c46 (exécutant), 8d40dda (réglages et FC repos), 3029d5f, df22b04, 7082e1c (compte rendu, copie de sécurité, bouton, banc) ; itinéraires b33e3b8, 4c83d32, c57d2dc ; remise à plat du lot 489 (b9ff1a9 à 9576459) ; correctifs du lot 494 (fdada5d). Plan de référence : `HEAD:docs/backlog/449-plan-synchroniser.md`.
- Porter depuis les fichiers à HEAD (44f08fe), correctifs compris, puis retirer : le Wi-Fi (`sansFil`, `ComputerLink`, `WirelessPhoneCard`), `t()` et les dictionnaires, `lieux.json` (ici les lieux sont dans les fiches), « Tout supprimer » et `resetPlan`, `gearMatch`. Renommer `GTRACKER_*` en `TRACKER_*`, `Documents/Gtracker` en `Documents/Tracker`, `.gtracker-*` en `.tracker-*`.

## Sûreté (le vrai `Documents/Tracker` du téléphone : 126 fichiers, 69 Mo, sans autre copie garantie)

- Récupérer n'a aucune commande d'écriture : la coquille n'accepte que `version`, `start-server`, `devices -l`, un listage `shell` au texte fixe et la lecture d'un fichier du dernier listage ; un test le vérifie par un faux lanceur. Jamais de `kill-server` ; un serveur adb d'une autre version est laissé tranquille (Gtracker et Android Studio partagent le poste).
- Rien ne quitte le téléphone sans copie identique sur le PC : avant chaque retrait, relecture du listage (taille et date) et de la copie du PC ; dans le doute, la copie du téléphone part d'abord dans la corbeille du PC, 30 jours.
- Une suppression sur le PC passe par la corbeille du PC (lot 448 à porter d'abord).
- Un retrait sur le téléphone est un `mv` vers `Documents/Tracker-corbeille/AAAA-MM-JJ/`, hors de la mémoire, jamais un `rm` (ajout par rapport à Gtracker).
- Copie de sécurité des deux dossiers entiers à la première synchronisation d'une paire (`bureau/copieSecurite.ts`, cc79dba).
- Référence `synchro/<id>.json` dans la mémoire du PC, réécrite session par session ; témoin `synchro/en-cours.json` pour une synchronisation coupée. Identifiant du téléphone : champ `id` de son `tracker.json`, que le téléphone ne réécrit que s'il manque.
- Première synchronisation : aucune suppression. Garde-fou au-delà de 10 sessions ou du quart d'un côté. Confirmation chiffrée (« N à copier vers le téléphone, M vers l'ordinateur, K à retirer »), bouton principal « Synchroniser sans rien supprimer ».
- Écriture sur le téléphone : toujours sous `nom.tracker-new`, taille relue, puis `mv -f` (un `.tracker-tmp` resté seul serait renommé en original par `MemoryFolderPlugin.finishInterruptedReplace` ; un `.tracker-new` resté seul est seulement effacé).
- Rien d'écrit pendant un enregistrement : `adb shell dumpsys activity services <paquet>` ; un service de premier plan du paquet bloque toute écriture.
- Plusieurs appareils branchés : refus. Les écritures visent le numéro de série du dernier listage.
- Éprouver avec le vrai téléphone sans toucher `Documents/Tracker` : en mode banc seulement (`TRACKER_BANC=1`), `TRACKER_BANC_RACINE_TELEPHONE=Tracker-essai` déplace la racine vers `/sdcard/Documents/Tracker-essai` (valeur bornée à `^Tracker-essai(-[a-z0-9]+)?$`, refusée hors du mode banc) ; le script relève l'empreinte du vrai dossier (noms, tailles, dates) avant et après et échoue si elle a bougé ; `TRACKER_BANC_TELEPHONE` (dossier local qui joue le téléphone) reste pour les coupures.

## Lot 2 · Récupérer (lecture seule ; Opus/high, script du banc Sonnet)

- `bureau/` : neufs `adb.ts` (adb du PATH puis `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`, `execFile` sans interpréteur, délais, listage `find -maxdepth 2 … stat -c '%f %s %Y %n'` avec repli, lecture refusée hors du dernier listage ou de taille différente, temporaires hors de la mémoire), `telephone.ts` (`etat`, `lister`, `lire` ; états `pret`, `absent`, `autorisation`, `horsLigne`, `adbIntrouvable`, `occupe`, `plusieurs`), leurs tests ; retouches `main.ts` (canaux `telephone:*`), `preload.ts`, `pont.test.ts`.
- `src/` : `platform/desktopBridge.ts` (types `telephone`) ; neufs `platform/phoneCable.ts` (`phoneImportEntries()`), `library/phoneRecovery.ts` (`choosePhoneFiles`, pur), `hooks/sessionLibrary/phoneRecovery.ts` (`importEntries(entries, { quiet: true })`), `components/PhoneRecoverButton.tsx` et son `.css` ; retouches `useSessionLibrary.ts`, `architecture.test.ts`, `components/MemoryStatus.tsx`.
- Bouton dans Réglages › Mémoire, dans le programme Windows seulement : « Récupérer les sessions du téléphone », progression, puis « 3 sessions ajoutées, 120 déjà présentes » ; une phrase et « Réessayer » par état non prêt.
- Tests : faux lanceur (arguments exacts, aucune écriture, délai, `unauthorized`, `offline`, deux appareils), analyse du listage, chemins refusés, `choosePhoneFiles`. Banc : `outils/banc/exe-recuperer.mjs` (6c63628).
- Avec le téléphone branché : un passage sur le vrai `Documents/Tracker`, sans risque (aucune écriture possible).

## Lot 3 · Synchroniser, en sous-lots (un commit chacun)

- 3a · Corbeille du PC (Opus/high, eebbe6a) : neufs `library/trash.ts`, `library/trashFolder.ts`, `hooks/sessionLibrary/trash.ts`, `trashRestore.ts`, `hooks/useTrash.ts`, `components/TrashZone.tsx` ; retouches `sessionRecords.ts`, `addSession.ts`, `hooks/routeFiles.ts`, `SessionRow.tsx`, `SessionNameEditor.tsx`, `PlanningPage.tsx`, `RoutesPage.tsx`, `MemoryStatus.tsx`, `platform/diskMemory.ts`, `memoryFolder.ts`, `bureau/disque.ts`, `memoire.ts`, `preload.ts` ; banc `memoire-disque.mjs`.
- 3b · Moteur pur (Opus/high et relecture) : `library/syncBase.ts`, `syncPlan.ts`, `syncRecordMerge.ts`, `syncExtras.ts` (`reglages/*.json` copiés, jamais adoptés ; `fc-repos.json` fondu par `mergeRestingResults`), `syncRoutes.ts` (le plus récent `updatedAt` l'emporte), `src/test/syncFolder.fixture.ts`, option de `recordMerge.ts` sans changer son défaut. GPX et `.imu` jamais réécrits, seulement copiés ; `journaux/` copiés vers le PC seulement. Même champ changé des deux côtés : conflit dit, l'ordinateur l'emporte.
- 3c · Écriture par le câble (Opus/high) : `bureau/adb.ts` (`push`, `mv`, liste fermée de chemins), `telephone.ts`, `src/library/remoteTemps.ts`, `phoneCable.ts` (sorte `phone` de `MemoryFolder`), `desktopBridge.ts`, `main.ts`, `preload.ts`, `pont.test.ts`.
- 3d · Exécutant, copie de sécurité, bouton, compte rendu (Opus/high) : `hooks/sessionLibrary/sync.ts`, `syncRouteFiles.ts`, `phoneSync.ts`, `library/syncOutcome.ts`, `syncReport.ts`, `components/PhoneSyncButton.*`, `bureau/copieSecurite.ts` ; le bouton Récupérer est alors retiré (df22b04).
- 3e · Banc (Sonnet) : `exe-synchroniser.mjs`, puis le passage sur `Tracker-essai` du téléphone réel.
- Le téléphone voit sans rien coder un fichier posé par adb, au lancement ou à « Mettre à jour » (éprouvé par Gtracker le 21/11) ; le rechargement automatique demande une APK : plus tard.
- Aucun fichier commun avec le lot 232 étape 2 ni le lot 235 ; à surveiller : `useSessionLibrary.ts`, `MemoryStatus.tsx`, `architecture.test.ts`.

## Tranché par l'orchestrateur le 25/11

- Q70 par son défaut (consigne de l'utilisateur) : une session supprimée d'un côté disparaît de l'autre.
- Portage depuis HEAD ; `.tracker-new` puis `mv -f` ; refus si plusieurs appareils ; journaux vers le PC seulement ; identifiant dans `tracker.json` ; pas de rechargement automatique dans ce lot.
- Aucune synchronisation réelle sur le vrai `Documents/Tracker` n'est lancée par Claude : tout se prouve sur `Tracker-essai` ; la première vraie synchronisation est un essai de l'utilisateur.

## À confirmer par l'utilisateur (avancé sur le défaut)

- Retrait sur le téléphone par mise de côté dans `Documents/Tracker-corbeille/<date>/`, sans purge automatique. Défaut : oui.
- Place du bouton : Réglages › Mémoire (Gtracker l'a mis dans la barre du haut). Défaut : Réglages › Mémoire.
- Corbeille du PC (30 jours, Réglages › Mémoire), où passe toute suppression faite sur le PC. Défaut : oui, sans elle pas de suppression partagée.
- Copie de sécurité de la première fois dans `Documents\Tracker-copies\`. Défaut : oui.

## Non vérifié par le plan

La sortie de `dumpsys` sur le Xiaomi ; `mv -f` qui écrase sur `/sdcard` ; les droits d'un fichier posé par `adb push`, lu puis effacé par l'application ; la commande `find` du téléphone ; l'adb partagé avec la session Gtracker ; les écarts entre les fichiers de Gtracker et le code de Tracker (fiche, `sessionRecords`, `routeFiles`).
