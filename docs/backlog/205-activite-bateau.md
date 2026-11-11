# 205 · « Bateau » parmi les activités de départ de la voile

## Voulu (08/11, précisé le 11/11)

Au premier lancement, la voile propose « Voile » (wingfoil) et « Bateau » (calcul `bateau`). Les installations existantes la reçoivent aussi.

## À faire

- `core/activities.ts` : une activité de départ `{ id: 'a-bateau', name: 'Bateau', base: 'bateau', color: BASE_COLOR.bateau }`, rangée après « Voile » dans `DEFAULT_ACTIVITIES` ; une entrée dans `ACTIVITY_SEEDS` à la version 10, `ACTIVITIES_VERSION` à 10, la note de version dans le commentaire d'`upgradeActivities`.
- Règle d'ajout propre à cette graine (tranchée par l'orchestrateur le 11/11, à confirmer par l'utilisateur) : elle n'est pas ajoutée si une activité porte déjà son identifiant ou calcule déjà en `bateau` (l'utilisateur a déjà son bateau) ; elle **est** ajoutée même si une autre activité de la voile s'appelle « Bateau » avec un autre calcul. Raison : sur le téléphone de l'utilisateur, « Bateau » est l'ancienne « Voile » renommée, qui calcule en wingfoil (fiche 208) ; avec la règle du nom, il ne recevrait jamais le vrai bateau. Les autres graines gardent leur règle. Garder cette exception en un seul endroit, facile à retourner.
- Pré-réglages (`settings/activityPresets.ts`), icône (`core/activityIcons.ts`, l'icône `bateau` existe) et tout test qui compte ou énumère les activités de départ.
- Ne pas toucher à `CLAUDE.md` ni à `docs/DECISIONS.md` : l'orchestrateur met à jour la liste des activités de départ.

## Tests

- Liste neuve : « Voile » puis « Bateau » en tête de la voile.
- Mise à niveau depuis la version 9 : liste sans bateau → « Bateau » ajouté ; liste avec une activité de calcul `bateau` → rien ; liste où `wingfoil` s'appelle « Bateau » → le vrai « Bateau » ajouté quand même, l'ancienne intacte ; rejouée (version 10), une « Bateau » supprimée ne revient pas.
