# 198 · Retenir plusieurs ceintures

Plan du 07/11, en lecture seule. Rien n'est codé avant la validation de la maquette et les réponses aux questions. Modèle : Sonnet/high pour la façon A ; Opus/high pour la façon B.

## Constats

- Le greffon ne tient qu'une connexion ; `connect` ferme la précédente. Android limite à 5 recherches par 30 s.
- Recherche sans filtre système, puis tri : service 0x180D, ou nom contenant hrm, heart, cardio, ou commençant par « hr ». À la connexion, 0x180D et 0x2A37 sont exigés.
- Montre en diffusion : rien ne la vise ni ne l'exclut, aucun essai de connexion consigné. Limites : la Garmin coupe sa diffusion en lançant une course, et une adresse qui change la rendrait introuvable.
- Clé `tracker.heartRateBelt` : seul `platform/heartRate.ts` la touche, hors `TRAVELLING_KEYS`, sans sauvegarde Android.
- Piège : `holdBelt` ignore quelle ceinture est demandée si la connexion est déjà tenue. Essayer B pendant que l'enregistrement tient A rendrait A sans le dire.
- La décision §6 « une par appareil » change : passe `doc` après validation.

## Façon recommandée (A) : une à la fois, la dernière choisie, changée à la main

Rien ne change dans le Java, donc aucun risque pour la reprise seule du lot 86, dont les essais 80 et 81 restent ouverts. Limite : si on porte l'autre, « introuvable » jusqu'au geste.

Écartées pour l'instant : B, une recherche pour toutes (Java modifié sans test automatique, mauvaise source si deux émettent, jusqu'à 45 s) ; C, plusieurs en parallèle ou tour à tour (réécriture du greffon, ou ne tient pas écran éteint). B reste possible plus tard sans changer la donnée.

## Donnée

- Nouvelle clé `tracker.heartRateBelts`, la liste complète. L'ancienne clé reste et garde la ceinture active : `savedBelt()` ne change ni de sens ni de signature.
- Migration : liste absente → liste d'un élément tirée de l'ancienne clé, sans rien effacer ; ancienne clé absente de la liste → ajoutée en tête.
- Oublier l'active : la suivante devient active ; ancienne clé `null` seulement si la liste est vide.
- `learnAddressType` met à jour l'entrée de même adresse, et l'ancienne clé si c'est l'active.
- `holdBelt` retient l'adresse tenue et lève une erreur si une autre est demandée alors qu'elle est tenue.
- Ni choix ni oubli pendant un enregistrement (`useRecorder.ts` relit l'active à la reprise).

## Maquette, à valider

Réglages › Capteurs :

```
Ceintures et montres  (?)
  HRM-Dual            ● utilisée au prochain départ
                      [Essayer] [Oublier]
    État              ● connectée  142 bpm
  Decathlon HR        [Utiliser] [Essayer] [Oublier]
  [Ajouter]
```

Après « Ajouter » :

```
  HRM-Dual            trouvée, proche
  Decathlon HR        pas trouvée : est-elle portée ?
  À ajouter           [Polar H10 · à portée] [Forerunner · loin]
```

Même nom : la fin de l'adresse s'ajoute. Pendant un enregistrement : « utilisée par l'enregistrement », Utiliser, Essayer (sur une autre) et Oublier grisés.

Enregistrer, avant le départ :

```
[x] Ceinture cardio
    HRM-Dual, portée et humidifiée     [Changer]   (s'il y en a 2 ou plus)
    ● introuvable pour le moment…
```

« Changer » ouvre `ui/ChoiceSheet.tsx`. Une fois lancé : tuile BPM inchangée, pas de « Changer ».

## Questions pour l'utilisateur

1. « Et appareils » : que vouliez-vous dire ? Par défaut : une montre qui diffuse son cardio, dans la même liste ; les capteurs de vélo restent à part (idée 36).
2. Autre ceinture que la dernière : la choisir d'un geste à Enregistrer, ou que l'application la trouve seule ? Par défaut : d'un geste.
3. Changer de ceinture une fois l'enregistrement lancé ? Par défaut : non.

## Fichiers

Neufs : `platform/beltList.ts` et son test (calculs purs). Touchés : `platform/heartRate.ts` et son test, `components/HeartRateBeltSettings.tsx`, `pages/RecordingPage.tsx` (`retainedBelt` devient un état), `pages/SettingsPage.tsx` (textes d'aide). Inchangés : `useRecorder.ts`, `useBeltWarmup.ts`, permissions, Java.

## Essais

Tests purs : ancienne clé seule, `null`, liste vide, clé changée par une ancienne version, ajout en double, oubli de l'active, type d'adresse, noms identiques, autre adresse refusée si tenue, même adresse sans reconnexion. Le banc ne voit pas ce bloc (« Android seulement »).

Au téléphone :
1. Installer par-dessus : la ceinture est toujours là. Montre en diffusion, « Ajouter » : apparaît-elle, « Essayer » donne-t-il le cardio ? La montre est prêtée : ne rien modifier d'autre.
2. Deux appareils : « Changer » à Enregistrer, le cardio vient du bon, une courte session dont la trace porte la FC. Attend que la ceinture égarée le 06/11 soit retrouvée, ou un second appareil.
