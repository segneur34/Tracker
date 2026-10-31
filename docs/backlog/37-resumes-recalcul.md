# Lot 37 · Résumés de la liste recalculés quand le seuil d'une activité ou l'allure imposée change

Ligne 37 du reste à faire (ETAT §9 « Résumés de la liste »). Décision de l'utilisateur du 31/10 : **recalcul automatique**, en arrière-plan, avec un compteur « n sessions à mettre à jour » dans la liste ; pas de pastille « périmé », pas de bouton.

Modèle | Réflexion : agent `lot` sur Opus high (choix de l'utilisateur du 31/10) ; plan par l'agent `Plan` ; relecture obligatoire. Touche aux fiches : jamais en parallèle d'un autre lot ; se lance après le lot 44.

À lire avant : `docs/DECISIONS.md` §8 (Mémoire et fichiers) et §11 (Réglages), `docs/ETAT_DU_PROJET.md` §9 (persistance, « Résumés de la liste », « Fiche réécrite à l'ouverture »), `docs/HISTORIQUE.md` sur `SUMMARY_CALC_VERSION` et le rafraîchissement des fiches. Règles 3, 9, 12 de `CLAUDE.md`.

## Constat

Les résumés (`summary` de la fiche, `library/summary.ts`, `summarizeSession`) sont calculés à l'entrée de la session dans la mémoire. Ils sont recalculés seulement quand le support, l'activité ou le seuil propre de la session changent, ou quand `SUMMARY_CALC_VERSION` augmente (`record.ts`, vers la ligne 799). Changer dans Réglages le seuil d'une activité (vitesse d'activité, qui sert aux sessions sans seuil propre) ou changer l'allure imposée d'une session ne recalcule rien, et rien ne le signale : distance active, temps actif et chiffres dérivés de la liste, de l'accueil et de Statistiques restent faux.

## Voulu

1. **Déclencheur** : quand un réglage d'activité qui entre dans le résumé change (le seuil d'activité d'abord ; recenser avec `SummaryOptions` les autres réglages lus par `summarizeSession` et les traiter de la même manière), les sessions de cette activité **sans seuil propre** deviennent à recalculer ; quand l'allure imposée d'une session est enregistrée (« Enregistrer la session »), cette session seule devient à recalculer si le résumé en dépend. Mécanisme à choisir dans le plan : marque sur la fiche (`summary` daté des options qui l'ont produit, ou empreinte des options) plutôt qu'une liste en mémoire, pour survivre à la fermeture de l'application ; la comparaison des options doit rester bon marché (pas de relecture GPX pour savoir si c'est périmé).
2. **Recalcul en arrière-plan** : relecture du GPX par `src/platform/` (jamais `Filesystem` ni autre API en direct, règle 12), `summarizeSession` avec les options courantes, écriture de la fiche par le chemin existant (`updateSessionRecord` ou celui qu'emploie déjà le rafraîchissement par `SUMMARY_CALC_VERSION` : réutiliser ce mécanisme, ne pas en écrire un second). Une session à la fois, sans bloquer l'interface ; interrompu proprement si l'on quitte l'application ; reprend au lancement suivant tant qu'il reste des fiches marquées.
3. **Compteur** : dans la bibliothèque (liste des sessions), une courte ligne « n sessions à mettre à jour » tant que n > 0, puis disparaît ; typographie et couleurs par les variables de `tokens.css`, pas d'emoji ; aucune autre nouvelle page ni réglage. Sur l'accueil et dans Statistiques, rien de plus que les chiffres qui se mettent à jour au fil du recalcul.
4. **Neutralité** : une session dont le résumé est à jour n'est jamais relue ; au lancement sans changement de réglages, rien ne se recalcule (le banc le prouve : texte identique, aucune écriture de fiche).

## Tests

- Fonctions pures dans `library/` : la marque de péremption (options changées → à recalculer ; options identiques → rien ; session avec seuil propre → rien quand le seuil de l'activité change ; allure imposée changée → cette session seule).
- Test de l'ordre et de l'arrêt du recalcul si la file est une fonction pure (sinon, dire pourquoi).

## Vérification

- `npm run verif`.
- Banc : scripts de la bibliothèque et des réglages (`library*.mjs`, `reglages*.mjs` ; `library.mjs` exige `--captures`) : texte identique avant et après sans changement de seuil ; avec un changement de seuil dans Réglages, le compteur apparaît puis disparaît et les distances de la liste changent. Relever les chiffres dans le rapport.

## Ce que le lot ne fait pas

Pas de commit, pas de version, aucune décision de l'utilisateur ; ne change ni les formules des résumés ni `SUMMARY_CALC_VERSION` (le lot 44 peut l'avoir augmenté juste avant : composer avec) ; ne touche pas aux pages d'analyse.

## Questions tranchées par l'orchestrateur (31/10)

- Q1 : au premier lancement après le lot, toutes les fiches sans empreinte sont refaites une fois, sans hausse de version ; cumulé avec la hausse du lot 44 dans la même APK. Oui : une seule passe, et l'empreinte posée évite toute passe suivante.
- Q2 : Profil et Statistiques gardent « Fiches en cours de calcul : chiffres provisoires » pendant une passe. Oui, comportement déjà en place à chaque hausse de version.
- Q3 : « Mettre à jour » reste grisé pendant une passe. Oui, comme aujourd'hui.
- Q4 : le foil d'une activité de voile reste hors de l'empreinte, il ne change pas le résumé. Oui.

## Plan d'exécution (agent Plan, Opus, 31/10)

Contexte. Un résumé n'est refait que dans deux cas : un changement fait sur la fiche (`applyRecordPatch` ou `completeRecord` lancent `resummarize`), ou une version de calcul dépassée (`isSummaryStale`, record.ts vers 798, ajoute une tâche `refresh` dans `scan`, traitée par `completeScan`/`runJob`). Les réglages de l'activité (`activitySummarySettings`, useSessionLibrary.ts vers 497) sont lus au calcul, jamais comparés après coup. L'allure imposée relance déjà `resummarize` (`analysisChanged`, record.ts vers 1015), mais sans être attendu : fermée entre l'écriture de la fiche et la fin du calcul, l'application garde l'ancien résumé sans marque.

Réglages d'activité lus par le résumé (`summaryOptions`, summaryOptions.ts vers 34) : `thresholdOverride` (`effectiveThresholdOverride`) et `foil` (`effectiveFoil`, surf seulement : `defaultActiveThresholdOf` ne le lit que si `profile.surf`). Activité supprimée et pré-réglage effacé (`PRESET_RESETS`) sont couverts par la même marque.

Marque : une empreinte `summary.optionsKey` (texte) des réglages effectifs qui ont produit le résumé : `JSON.stringify([activeThreshold ?? null, referenceSpeedOverrideMs ?? null, surf ? foil ?? null : null, waveThreshold ?? null])`. Calculée depuis la fiche allégée (sport, activité, `analysis`) et les réglages, sans relire le GPX. Exclut `terrainElevation` et `test`, déjà couverts par `applyRecordPatch`. Pas de hausse de `SUMMARY_CALC_VERSION` : une fiche sans empreinte (sport connu avec positions) compte « à recalculer ».

Fichiers et fonctions :
1. `src/library/summaryOptions.ts` : `summaryOptionsKey(sport, options)`, pure ; `isSummaryOutdated(record, activity: ActivitySummarySettings)` = `isSummaryStale(record) || summary.optionsKey !== summaryOptionsKey(...)`, faux pour `sport === null` et pour `!hasPositions(sport)` (muscu : `summarizeHeartRateSession`, sans options, sinon recalcul sans fin) ; `analyzeGpx` pose `optionsKey` sur le résumé (cas avec positions seulement ; pas dans `summarizeSession`, pour garder ses tests et éviter un import circulaire) ; `withSummary` la reprend par la copie du résumé.
2. `src/library/record.ts` : `SessionSummary.optionsKey?: string` (commentaire en français) ; `readSummary` le garde s'il est un texte, l'efface sinon.
3. `src/hooks/useSessionLibrary.ts` : `scan`/`keep` (vers 1045) remplacent `isSummaryStale(record)` par `isSummaryOutdated(record, activitySummarySettings(record.activityId)(record.sport))` ; `runJob` refait le test de péremption avant de lire le GPX (vers 1105) et rend `'done'` sans lecture si à jour ; `queueOutdatedRefresh()` : attend `scanCompletion` si en cours, puis `jobs = all.filter(écrivable, isSummaryOutdated, absente de refreshFailed)` en tâches `refresh` dans l'ordre de `all`, puis `completeScan(folder, generation, jobs)`, réévalué une fois à la fin ; `refreshFailed`, ensemble vidé à chaque `attach`/`detach`, rempli quand `runJob` rend `'unreadable'` ou ne pose pas de résumé ; arrêt par `generation` ; déclencheur : dans `startLibraryUi`, `subscribeStoredSettings` lance un délai `SETTINGS_REFRESH_DELAY_MS` (environ 1,5 s, la saisie écrit à chaque touche), ignoré pendant `applyingSettings`, puis `queueOutdatedRefresh()` ; `updateSessionRecord`/`resummarize` inchangés ; compteur : `LibraryState.toUpdate: number` (tâches `refresh` restantes), publié au rythme de `scanning` dans `runCompleteScan`, remis à 0 à la fin, à l'arrêt, dans `attach` et `detach` ; `scanning` reçoit `creating` (tâches `create`).
4. `src/components/MemoryStatus.tsx` : `attention` et « Lecture des traces sans fiche » ne comptent que `creating`.
5. `src/pages/SessionLibrary.tsx` : `toUpdate` par `useLibraryFields`, puis `{toUpdate > 0 && <p className="ui-hint ui-hint--m">{plural(toUpdate, 'session')} à mettre à jour</p>}` (`plural` de core/basics.ts) sous `<MemoryStatus compact />`.

Ordre : empreinte et lecture avec tests ; `scan`/`runJob` ; file et abonnement ; compteur et MemoryStatus ; `npm run verif` puis banc.

Tests (`summaryOptions.test.ts`, `record.test.ts`) : seuil d'activité changé → périmée ; mêmes réglages → rien ; seuil propre à la session → rien quand celui de l'activité change ; allure imposée changée → cette session seule ; foil changé → périmée en surf, pas en voile ni à pied ; muscu et sport inconnu → jamais ; fiche sans empreinte → périmée ; idempotence par calcul (surf foil compris, 1 et 5 Hz) : `analyzeGpx` puis `isSummaryOutdated` → faux ; `readSummary` garde un texte, efface un nombre. `useSessionLibrary.test.ts` (faux MemoryFolder en place) : au lancement sans changement, aucun `readText` de GPX ; après un seuil changé, seules les sessions de l'activité sans seuil propre sont relues et réécrites ; une trace illisible n'est tentée qu'une fois. Sélection des tâches pure : `outdatedRefreshFiles(sessions, isOutdated, failed)`, testée pour l'ordre et le filtrage.

Inchangé : formules du résumé, `SUMMARY_CALC_VERSION`, `resummarize`, pages d'analyse ; aucune relecture ni écriture quand aucune empreinte ne diffère (dès le deuxième lancement) ; Profil et Statistiques gardent « Fiches en cours de calcul ».

Banc : `library.mjs --captures`, `library2.mjs`, `library3.mjs`, `reglages*.mjs` (`reglages.mjs` déjà cassé, ETAT §8 : réparer ou contourner). « Avant » sur l'ancien code, « après » au deuxième lancement du nouveau (le premier refait les fiches sans empreinte) : texte identique, aucune écriture. Puis un seuil changé dans Réglages : le compteur apparaît puis disparaît, les distances actives changent ; relever les chiffres.

Essai au téléphone (un seul) : changer le seuil de Course, fermer l'application pendant le recalcul, la rouvrir → le compteur repart et finit.
