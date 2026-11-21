# 215 · Nom de session par le lieu : plan (agent Plan, 21/11) et choix tranchés

Complète `docs/backlog/215-nom-de-session-lieu.md` (le voulu et les réponses de l'utilisateur).

## Service

Overpass, une requête par session (`nwr(around:R)[name]` pour plage, port, baie, plan d'eau, `out tags center` ; commune par `is_in` et `admin_level=8`, celle de l'arrivée si besoin), par `fetchJson` et `OVERPASS_URL` de `planning/overpass.ts`. Overpass est déjà bloqué au banc (`outils/banc/lib/cdp.mjs`, `BLOCKED_URLS`) : les scripts sans réseau restent déterministes.

## Où vit le lieu

1. Départ et arrivée dans le résumé (`SessionSummary.start?`, `end?` `{lat, lon}`, posés par `summarizeSession`, lus par `readSummary`) ; `SUMMARY_CALC_VERSION` passe à **23** (le lot 218, codé en parallèle, prend 22 : pars de 21 dans ta copie et pose 23, chaînes figées comprises).
2. Dans la fiche : `place?: { name: string|null; to?: string; kind: 'eau'|'commune'; source: 'osm'|'user'|'appris'; version; fetchedAt }` (`name: null` = cherché, rien trouvé) ; lecteur `readSessionPlace`, `RecordPatch`, `RECORD_LIGHT_FIELDS`, `SAISIE_LABEL.place = 'lieu'` (`recordMerge.ts`).
3. Seuils dans `PLACE_DEFAULTS`, passés en paramètre (modèle : `WAY_MATCH_DEFAULTS`) : plan d'eau 1 500 m, « A → B » si départ et arrivée à plus de 5 km, lieu appris 500 m, reprise d'un lieu déjà trouvé 200 m. Plage ou commune par `sportFamily` (voile et surf : l'eau).

## Nom affiché

Calculé à la lecture, jamais rangé : `sessionDisplayName(record, activityName)` dans `library/sessionName.ts` (nom saisi, sinon « Activité · Lieu », « Lieu → Arrivée » à pied et à vélo, sinon l'activité seule, sinon `null`). Branché dans : `SessionNameEditor.tsx`, `SessionLibrary.tsx` (ligne sans nom saisi : « Activité · Lieu » à la place de l'activité, date à côté comme aujourd'hui), `library/stats.ts`, `library/shareStats.ts` et `SavedSessionShare.tsx`, `components/sessionGpxShare.ts` (`AAAA-MM-JJ Activité - Lieu.gpx`), `FollowTracePicker.tsx` (cette seule ligne d'affichage, rien d'autre dans ce fichier).

## Recherche

`hooks/sessionLibrary/placeQueue.ts`, lancée par `lifecycle.ts` à la fin du passage d'ouverture et par `addSession.ts` après chaque ajout ; la plus récente d'abord, une à la fois, au moins 1 s entre deux requêtes ; d'abord un lieu corrigé à moins de 500 m (`appris`), puis un lieu déjà trouvé à moins de 200 m (copié sans requête), sinon Overpass ; écriture par `updateSessionRecord`. Hors ligne ou erreur : la file s'arrête sans rien afficher et reprend à l'ouverture suivante, à « Mettre à jour » ou au prochain ajout ; pas de nouvelle tentative dans le même lancement. Aucune requête pour une fiche en lecture seule ni une session sans départ (muscu, tests, nuit).

## Tests purs

`sessionName.test.ts`, `sessionPlace.test.ts` (ordre plage > port > baie > plan d'eau, puis commune ; 499 m contre 501 m ; reprise à 200 m), `placeQuery.test.ts` (requête, réponse, réponse abîmée), `summary.test.ts` (départ et arrivée identiques à 1 et 5 Hz), `record.test.ts`, nom du GPX, la file avec un `fetch` simulé.

## Banc

Écart attendu : « Sans nom » devient le nom de l'activité dans les en-têtes d'analyse. `surface.mjs` compte les requêtes Overpass (compte à revoir). Script neuf `nom-lieu.mjs` (modèle `lib/tuiles.mjs`, réponse Overpass simulée puis panne), inscrit dans `SCRIPTS.md` et `scripts.mjs`.

## Tranché par défaut la nuit du 21/11, à confirmer

- Corriger le lieu passe par « Renommer », sans champ neuf à l'écran : le champ se pré-remplit du nom affiché ; un texte de la forme « <activité actuelle> · X » fait de X le lieu (source `user`, le nom reste calculé) ; tout autre texte est un nom libre ; un champ vidé rend le nom calculé (`readRenameDraft`).
- Les anciennes sessions reçoivent leur lieu elles aussi, en fond, une requête par seconde (leurs résumés se refont une fois, version 23).

## Tranché par l'orchestrateur

Un lieu corrigé vaut aussi pour les sessions passées à moins de 500 m, sauf celles corrigées à la main ; la nuit garde son nom rangé à sa création (`newRecord.ts` non touché) ; seuils non réglables dans Réglages ; image de partage sans nom saisi : titre « Activité · Lieu », sous-titre la date ; l'écran de fin d'enregistrement n'affiche pas le lieu.
