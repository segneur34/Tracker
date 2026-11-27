# 242 · « Synchroniser » en un geste, deux corbeilles jumelles : plan (27/11)

Plan de l'agent `Plan` du 27/11, relu par l'orchestrateur. Chemins relatifs au dépôt. Source Gtracker en lecture seule : `D:\gong tracker\Gtracker`, commit `f72f238` (`git -C "D:/gong tracker/Gtracker" show f72f238:<chemin>`). Audit : `docs/backlog/239-audit-gtracker.md` et `C:\Users\segne\.claude\plans\audit-gtracker-2611\programme-pc.md` (constats P1 à P10).

## Décisions

- Ligne 242 de `docs/BACKLOG.md` : un seul clic quand rien ne se perd ; « non » garde tout des deux côtés, pour de bon ; le téléphone se met à jour seul (marqueur `synchro`) ; la saisie la plus récente gagne (`editedAt`). Les protections de Tracker restent : copie de sécurité entière, mise de côté au lieu d'effacement, relecture octet pour octet avant tout retrait, refus si le téléphone enregistre.
- Réponse de l'utilisateur à Q70 (27/11) : une session supprimée d'un côté disparaît de l'autre à la synchronisation suivante, et finit dans la corbeille.
- Décision de l'utilisateur (27/11), **deux corbeilles jumelles** : supprimer sur le téléphone met à la corbeille du téléphone ; une session supprimée d'un côté finit dans les deux corbeilles ; restaurée d'un côté, elle revient des deux côtés, sans question ; chaque corbeille se vide seule après 30 jours.
- Réponse à Q77 (27/11) : la corbeille du téléphone est visible et restaurable dans Réglages › Mémoire du téléphone.
- Tranché par l'orchestrateur (27/11) :
  - « Supprimer définitivement » et « Vider la corbeille » ne valent que pour l'appareil où on les fait ;
  - une session supprimée d'un côté mais modifiée de l'autre depuis revient des deux côtés (règle de Gtracker, `revived`) : rien ne se perd ;
  - le bouton « Synchroniser » reste dans Réglages › Mémoire ;
  - une APK à la fin du 242, pour les essais au câble, avant celle du 250 ;
  - l'ancien `Documents/Tracker-corbeille/` du téléphone n'est plus rempli et reste tel quel : le dire une fois à l'utilisateur ;
  - le dépôt déplace **le GPX d'abord** (ordre actuel de `moveAsideOnPhone`) : un retrait coupé ne laisse pas un GPX sans fiche, qui en recevrait une neuve. Le point tranché 1 de `250-plan.md` est corrigé en ce sens.

## Découpage : trois sous-lots, un commit chacun, dans cet ordre

### 242-1 · Corbeilles jumelles (Opus | high)

Ce que l'utilisateur y gagne : une session supprimée sur un appareil se retrouve dans la corbeille de l'autre, et se restaure d'un côté comme de l'autre.

- Code pur :
  - `src/library/trash.ts` : `deletesToTrash` vaut aussi pour `device` ; lecture et écriture de `depose.json` ; `depositEntry` ; règle d'adoption ; `orphanTrashDirs` saute un dépôt ; `returnedTrashGroups` ; textes « de cet appareil » ;
  - `src/library/syncBase.ts` : `PHONE_TRASH_ROOT`, `phoneTrashDir` et `phoneTrashPaths` cèdent la place à `phoneDepositPaths(dir, noms)` ;
  - `syncPlan.ts`, `syncRoutes.ts` : `moveTo` ne porte plus que l'identité ; `restored` vaut aussi pour un `newOnPhone` présent dans `base.removed`, de même pour les itinéraires.
- Côté page :
  - `src/library/trashFolder.ts` : `adoptDeposits`, purge et « Vider » qui ne touchent pas un dépôt en attente ;
  - `src/hooks/sessionLibrary/trash.ts` : `startTrash` adopte puis règle les sessions revenues ;
  - `src/hooks/sessionLibrary/trashRestore.ts` : exporter `completeFromTrash`, nouveau `settleReturnedTrash` ;
  - `src/hooks/sessionLibrary/sync.ts` (`moveAsideOnPhone`) et `syncRouteFiles.ts` (`:284`) ;
  - `src/platform/memoryFolder.ts` : `removeDir` pour le dossier du téléphone (refusé si le dossier n'est pas vide) ;
  - `src/platform/phoneCable.ts` (`moveAside`, `asideTaken`) et `desktopBridge.ts` ;
  - `src/components/MemoryStatus.tsx:361` : `TrashZone` aussi pour `device` (`TrashZone.tsx` inchangé) ;
  - `src/library/syncReport.ts:113` et `:298` : les phrases parlent de la corbeille du téléphone.
- Côté coquille :
  - `bureau/telephone.ts` : `cheminEcrivable` admet `corbeille/<d>/depose.json`, et ce seul nom, avec `<d>` accepté par `dossierDepotAdmis` ; `mettreDeCote` vérifie sa destination par `destinationCorbeilleAdmise` (écrite au 250-1) et refuse si `depose.json` manque dans le dossier ; `listerCorbeille` rend les noms des sous-dossiers de `corbeille/` ; `dossierLocal` du faux téléphone suit ;
  - `bureau/adb.ts` : cible du `mv` dans la racine, par `texteShell`.
- Java : rien (le SAF liste, écrit et efface déjà à toute profondeur). L'exception de la liste blanche pour le sans-fil reste au 250-3.
- À réutiliser : `trashDirName`, `isTrashDirName`, `rebuiltTrashEntry` (repli si `depose.json` est illisible), `stashInTrash`, `dropTrashEntries`, `groupedTrashEntries`, `trashGroupOf`, `completeFromTrash`, `withSyncDone`, `sameBytes`, `src/test/syncFolder.fixture.ts`.
- Venu de Gtracker : rien, sa corbeille n'existe que sur l'ordinateur. Tout est neuf, sur les pièces de Tracker.

### 242-2 · Un geste (Opus | high)

Ce que l'utilisateur y gagne : un clic, une question seulement si une perte est possible, « non » qui garde pour de bon, et le téléphone qui se met à jour seul.

- Copiés de Gtracker, sans `t()` ni sans-fil : `src/library/syncWatch.ts` et son test ; `bureau/journal.ts` et son test ; `markerTextWithSync`, `readMarkerSync` et `markerTextWithDevice` dans `syncBase.ts`.
- Fusionnés à la main :
  - `src/hooks/sessionLibrary/phoneSync.ts` (155 lignes contre 648) : étapes `searching`, `waiting` (raisons `absent`, `lost`, `busy`), `noPhone`, `computerBusy`, `firstStart`, `syncing`, `question`, `over` ; `wake()` ; relevé du câble toutes les 3 s ; reprise seule 3 fois au plus ; `resume` ; une seule reprise des éléments changés en route (`mergeSyncPasses`) ; réponses `keepAll`, `deleteBoth`, `keepHeld`, `removeHeld`. Fermer la fenêtre ne décide rien ;
  - `syncReport.ts` (`describeSync` : lignes par geste, notes, action ; `describeSyncQuestion`) ;
  - `syncOutcome.ts` : garder `drafted`, `cut`, `recordingStarted` ;
  - `PhoneSyncButton.tsx` et `.css` (variables de `tokens.css`) ;
  - `hooks/sessionLibrary/lifecycle.ts` : guet au retour au premier plan et toutes les 25 s, identifiant d'appareil écrit à l'ouverture ;
  - `sync.ts` : marqueur `synchro` posé en fin de synchronisation si le téléphone a changé (`notifyPhone`) ;
  - `bureau/main.ts` (le journal s'écrit toujours), `preload.ts`, `pont.ts` (canal `coquille:noter`), `noteJournal` dans `src/platform/desktopBridge.ts` ;
  - état prêt qui porte `ecriture`, et `phoneCanWrite` qui le lit (`phoneCable.ts:69`).
- Gardé de Tracker : refus si le téléphone enregistre, garde des brouillons, relecture octet pour octet, copie entière. `dryRun` reste dans le moteur ; l'interface ne s'en sert plus.

### 242-3 · La dernière saisie gagne, et les réglages (Opus | high)

Ce que l'utilisateur y gagne : une note changée sur le téléphone n'est plus écrasée ; un réglage n'est remplacé que sur son choix ; il choisit où va la copie de sécurité.

- B19/P5 : `editedAt` dans `record.ts` (lu et réécrit) ; `withEditTimes` et `mergedEditTimes` dans `recordMerge.ts`, d'après Gtracker ; posé par `updateSessionRecord` et `sessionEdits.ts` ; dans `syncRecordMerge.ts`, la date départage avec `FUTURE_SKEW_MS` ; sans date, l'ordinateur gagne.
- P7 : `settingsToOffer` (`settingsFile.ts`), `deviceSettings.ts`, `SettingsFiles.tsx`, avec une fenêtre au lieu de `window.confirm`.
- A24f : `isWritableSettingsFile` dans `settingsFile.ts:75`, et `hooks/restingHrFile.ts:36` ne réécrit plus un fichier d'une version plus récente.
- P3 : `bureau/copieSecurite.ts` (`copies.json`), canaux `dossierCopies`, `choisirDossierCopies`, `ouvrirCopie` ; « Choisir un autre dossier » sur l'écran `firstStart` et dans Réglages › Mémoire.

### Banc, à côté de chaque sous-lot

`outils/banc/exe-synchroniser.mjs`, sous la forme rapide du lot 250-0 (attente d'état, port 9630, ligne `SCRIPTS_EXE` déjà là). Cas neufs : un clic sans question ; dépôt dans `Documents/Tracker/corbeille/<d>/` du faux téléphone, et plus rien dans `Tracker-corbeille` ; suppression faite côté faux téléphone qui arrive dans la corbeille de l'ordinateur ; restauration sur l'ordinateur puis passage suivant ; garde-fou puis « Tout garder », sans retour de la question ; attente puis départ seul ; `journal.txt` écrit. Pour l'attente : un état du faux téléphone relu à chaque `etat()`, variable `TRACKER_BANC_TELEPHONE_ETAT_FICHIER`, lue en mode d'essai seulement. `exe-synchroniser-essai.mjs` (racine `Tracker-essai/corbeille`) : rejoué par l'orchestrateur, câble branché, avec l'accord de l'utilisateur. La corbeille du téléphone à l'écran ne se voit pas au banc (Chrome = sorte `browser`).

## Ce que le sans-fil attend du 242 (`250-plan.md`, « Ce que le sans-fil prend aux autres lots »)

1. Étapes `waiting`, `noPhone`, `firstStart` et `wake()` : 242-2 (`noPhone` n'est déclarée et montrée qu'avec un faux registre ; 250-6 la branche).
2. La fenêtre unique : 242-2.
3. Le marqueur `synchro` et `syncWatch` : 242-2.
4. `journal.ts` et `noteJournal` : 242-2 ; le 250-2 n'a plus à les apporter.
5. `phoneCanWrite` lu sur l'état prêt : 242-2.
6. L'identifiant d'appareil : 242-2.
7. En plus : l'exception `depose.json` de `cheminEcrivable` passe du 250-2 au 242-1 ; le 250-4 ne garde que le branchement du Wi-Fi.

## Les corbeilles jumelles, cas par cas

Règle commune : **un seul écrivain par index**. Chaque appareil est seul à écrire son `corbeille/corbeille.json`. Sur le téléphone, l'ordinateur n'écrit que `corbeille/<instant>-<identité>/depose.json`, puis y déplace les fichiers ; la coquille le garantit (liste fermée), un test sur le faux téléphone le vérifie.

- **Supprimée sur le téléphone** (session suivie) : dans la corbeille du téléphone (`stashInTrash`, copie puis retrait) ; à la synchronisation, le moteur la voit en `deletedOnPhone` et la copie de l'ordinateur passe dans la corbeille de l'ordinateur. Moteur inchangé ; page : `deletesToTrash`.
- **Supprimée sur l'ordinateur** : `deletedOnComputer`. La copie du téléphone entre d'abord dans la corbeille de l'ordinateur si elle n'y est pas à l'identique (`keepOf`, relue octet pour octet) ; puis `depose.json` (`{format, version, origine: 'ordinateur', kind, startMs | routeBase + createdAt, name, files[{name,size}]}`), puis le déplacement, GPX d'abord. Le téléphone adopte le dépôt : il inscrit l'entrée à son index (`deletedAtMs` à sa propre horloge), puis efface `depose.json`. Où : `sync.ts` et la coquille pour le dépôt, `trashFolder.ts` pour l'adoption.
- **Supprimée des deux côtés** : `deletedOnBoth`, la base l'oublie ; chaque appareil la garde dans sa propre corbeille.
- **Restaurée sur l'ordinateur** : `newOnComputer` et dans `base.removed` (`restored`), copiée vers le téléphone sans question ; au rechargement suivant, le téléphone règle les sessions revenues (`settleReturnedTrash`) : `completeFromTrash` complète la fiche sans rien écraser, puis retire la ligne de sa corbeille seulement si tout a été repris (`merged`) ; sinon elle attend ses 30 jours.
- **Restaurée sur le téléphone** : la ligne de base la distingue d'une suppression faite sur l'ordinateur (sans ligne et dans `base.removed` : restaurée ; avec une ligne : supprimée sur l'ordinateur après la dernière synchronisation, `deletedOnComputer`). Pas retenue (`heldBack` faux dès qu'elle est dans `removed`), donc copiée vers l'ordinateur sans question ; l'ordinateur règle ensuite sa corbeille (`settleReturnedTrash` en fin de synchronisation). Changement du moteur : seulement le drapeau `restored` pour `newOnPhone`.
- **Purgée d'un seul côté** (« Supprimer définitivement », « Vider », 30 jours) : rien ne part vers l'autre appareil ; `withSyncDone` retire la session de `removed` quand la corbeille de l'ordinateur ne l'a plus ; si l'autre côté la restaure ensuite, elle revient comme une session neuve, sans question. Limite connue : quand l'ordinateur n'a plus de trace de la suppression (corbeille de l'ordinateur purgée ou première rencontre), une session encore sur l'ordinateur mais seulement dans la corbeille du téléphone y est recopiée.
- **Itinéraires** : même mécanique (`removedRoutes`, `heldRoutes`, `stashRoute`, dépôt `<instant>-<base>`). Le jumeau d'un itinéraire revenu n'est retiré que si sa fiche est identique à l'octet ; sinon il attend ses 30 jours.
- **Coupure en route** : `depose.json` écrit avant tout déplacement, et la coquille refuse un `mettreDeCote` vers un dossier qui n'en a pas : la purge du téléphone ne prend jamais un dépôt pour un reste. Le téléphone adopte un dépôt complet, ou partiel une fois qu'aucun fichier manquant n'est plus à sa place d'origine ; tant qu'un fichier manquant est encore dans `sessions/`, il attend ; aucune horloge comparée. L'adoption se rejoue sans dommage. Les restes laissés dans `sessions/` partent à la passe suivante (`phoneLeftoversOp`), dans un nouveau dépôt.
- **Écritures du téléphone pendant une synchronisation** : relues avant écriture (`StaleError`, inchangé). « Vider » et la purge du téléphone sautent les dépôts en attente.

## Vérification

- Tests purs :
  - `trash.test.ts`, `trashFolder.test.ts` : adoption complète, partielle et en attente ; reprise sans dommage ; purge et « Vider » qui épargnent un dépôt ; `removeDir` du téléphone ;
  - `syncBase.test.ts`, `syncPlan.test.ts` : `restored` côté téléphone ;
  - `sync.test.ts` : les huit cas ci-dessus, deux coupures (après `depose.json`, après le GPX), aucune écriture de l'ordinateur dans le `corbeille.json` du téléphone ;
  - `bureau/telephone.test.ts`, `adb.test.ts` : `depose.json` seul admis ; `corbeille/corbeille.json` et `corbeille/<d>/x.gpx` refusés ; aucun écrasement ;
  - `phoneSync.test.ts`, `syncReport.test.ts`, `syncWatch.test.ts`, `journal.test.ts`, `syncRecordMerge.test.ts`, `recordMerge.test.ts`, `settingsFile.test.ts`, `copieSecurite.test.ts`.
- Essais au téléphone, APK de fin de 242, câble branché :
  1. Supprimer une session sur le téléphone et une sur l'ordinateur, puis « Synchroniser » : un clic, chacune dans les deux corbeilles, le téléphone se met à jour seul.
  2. Restaurer sur le téléphone celle supprimée sur l'ordinateur, puis synchroniser : elle revient sur l'ordinateur sans question et quitte les deux corbeilles.
  3. Changer le même champ des notes sur l'ordinateur, puis sur le téléphone : la saisie la plus récente reste des deux côtés.

## Risques (perte de données d'abord)

- « Vider » ou la purge du téléphone qui effacerait un dépôt en cours : dépôts sautés, et dépôt jamais sans `depose.json`.
- Adoption d'un dépôt à moitié rempli : règle de complétude.
- Une ancienne APK ne lit pas les dépôts : ils restent sur le téléphone, invisibles, sans rien perdre. Une ancienne APK ne date pas ses saisies : l'ordinateur gagne, comme prévu.
- Sur le téléphone, la mise à la corbeille est une copie suivie d'un retrait : la place occupée double un instant ; si la copie échoue, rien n'est retiré. Le déplacement direct (`MemoryWriter`) vient au 250-3.
- `origin` de l'index veut dire « cette mémoire » sur chaque appareil : à écrire dans l'en-tête de `trash.ts`, sans changer le format (aucune hausse de `TRASH_VERSION`, sinon une version plus ancienne trouverait la corbeille illisible).
- `settleReturnedTrash` peut réécrire une fiche : le changement repart à la synchronisation suivante, sans perte.

## Estimation du plan

242-1 : environ 22 fichiers, 1 300 lignes tests compris. 242-2 : environ 20 fichiers, le plus gros (portage d'environ 2 000 lignes de Gtracker et tests). 242-3 : environ 15 fichiers. Banc : `exe-synchroniser` de 334 à environ 750 lignes. Le plus incertain : le 242-1, tout neuf, jamais éprouvé dans Gtracker.
