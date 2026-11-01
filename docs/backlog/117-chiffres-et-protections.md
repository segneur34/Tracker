# 117 · Petits chiffres et protections

Brief écrit le 01/11 d'après l'audit en lecture seule du même jour. Modèle | Réflexion : Sonnet | high. Trois retouches indépendantes, petites.

## À faire

1. **VMG moyenne par bord pondérée par les points** (`sailing/sailingAnalytics.ts:511-538`) : la moyenne est celle des fenêtres de 10 s, une par point de départ (`cUpStbd++`…), donc pondérée par le nombre de points et non par la durée (règle 2). Sur une trace à cadence variable, elle penche vers les passages denses. Pondérer chaque fenêtre par le pas de temps de son point de départ, pour qu'une trace à 1 Hz et la même à 5 Hz, ou à cadence irrégulière, donnent la même moyenne (test). Le chiffre change un peu sur les traces irrégulières : c'est la correction voulue ; le banc relève l'écart, le rapport le chiffre. Dans la même fonction, nommer le `windowMs * 0.8` de la l. 491 (fenêtre trop courte) dans `sailing/sailingConfig.ts` (règle 3).
2. **Réglages relus sans contrôle** (`settings/activitySettings.ts:249` `resolveThresholdOverride`, `:456` `resolveRecordingProfile`) : le seuil d'activité et la pause automatique sont lus tels quels, alors que leurs voisins sont vérifiés, et un `reglages.json` d'un autre appareil ou d'une autre version est recopié sans contrôle des valeurs (`library/settingsFile.ts:53-59`, `applySettingsValues`). Les vérifier à la lecture avec les règles de `SETTING_FIELDS` (seuil : nombre fini positif ; pause : `speedMs` et `delayS` finis positifs), sinon le pré-réglage. Scénario évité : un objet incomplet coupe la pause automatique sans le dire.
3. **Mémoire du navigateur non garantie** (`platform/memoryFolder.ts:174`) : le résultat de `navigator.storage.persist()` est ignoré. Quand il est refusé (Firefox sur PC, sans dossier), une phrase dans la carte existante de Réglages › Mémoire dit que le navigateur peut vider cette mémoire s'il manque de place, et conseille un dossier. Texte seul, pas de disposition neuve.

Tests purs (VMG à 1 Hz, 5 Hz et cadence irrégulière ; réglages abîmés) ; `npm run verif` ; banc voile avant/après (seule la VMG moyenne peut bouger).

## Ce que le lot ne fait pas

Pas de commit, pas de version, aucune décision de produit. Ne pas toucher à `wind.ts` ni `maneuvers.ts` (n° 112). Rien dans `docs/` hors ce fichier.
