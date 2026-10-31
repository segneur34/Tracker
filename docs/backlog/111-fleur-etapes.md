# 111 · Fleur du Profil en 4 étapes, par multiples de l'objectif par semaine

Modèle | Réflexion : Opus | high. Petit lot, dessin et texte ; aucune décision à prendre : la maquette est validée (31/10, https://claude.ai/artifact/BC5HYbfgXGUjpj5Vg4FW9j, variante « 4 étapes »), et Q52 est répondue.

## Décision de l'utilisateur (31/10)

Aujourd'hui la fleur de la pousse (`drawSprout`, `src/components/drawRoot.ts`) paraît en bouton à la première minute de la semaine et s'ouvre jusqu'à l'objectif (`progress` = temps / objectif, plafonné à 1), puis ne bouge plus. Désormais elle continue d'évoluer par multiples de l'objectif par semaine, en quatre étapes, épanouie au maximum à 4 fois :

| Temps de la semaine (en multiples `s` de l'objectif) | Dessin |
|---|---|
| 0 | rien (comme aujourd'hui) |
| 0 < s < 1 | bouton qui grossit (comme aujourd'hui), qui s'entrouvre sur le dernier tiers (de 0,7 à 1) pour être ouvert à 1 |
| 1 | ouverte : cinq pétales régulièrement répartis (l'état final d'aujourd'hui, à sa taille d'aujourd'hui) |
| 1 → 2 | pétales plus longs (× 1,25), cœur plus gros, rayon qui grandit |
| 2 → 3 | un second rang de cinq pétales pousse derrière, décalé d'un demi-pétale, un peu plus foncé (mélange 30 % fleur → liseré), de 0 à 100 % |
| 3 → 4 | tout grandit encore (rayon jusqu'à ≈ 1,5 × celui de 1 fois), pétales un peu plus larges, le cœur se garnit de six graines (points plus sombres, qui apparaissent de 3 à 4) |
| ≥ 4 | épanouie, figée |

Entre deux étapes, la croissance est continue (pas de saut), comme aujourd'hui entre la première minute et l'objectif. La référence exacte du dessin est le code de la maquette : fonction `drawFlower(ctx, s, k, c, v)` de `C:\Users\segne\AppData\Local\Temp\claude\c--Users-segne-tracker\ff35ed26-bbfe-4790-be2b-d5569fc2d457\scratchpad\maquette-111-fleur.html`, variante `a` (`ring2: [2, 3]`) ; la reprendre telle quelle, en TypeScript, avec les couleurs `RootColors` (`flower`, `flowerEdge`, `flowerHeart`, `sprout`) et la fonction `mix` déjà dans `drawRoot.ts`. Vérifier que les étapes restent lisibles dans le carré du Profil (88 px, `k = 1`) : la maquette les montre à 54 px.

Ce qui ne change pas : la tige, ses feuilles (`grown = max(progress, planted)` avec `progress` plafonné à 1), leur chute et leur repousse après une semaine manquée, les radicelles, la racine, l'objectif par semaine (seul réglage).

## À faire

1. `src/library/rootGrowth.ts` : `RootGrowth` gagne `goalTimes: number` (temps de la semaine / objectif, non plafonné ; `progress` reste plafonné à 1 pour la tige et les radicelles). Test dans `rootGrowth.test.ts` (existant ou à créer à côté) : 90 min sur 45 → `goalTimes` 2, `progress` 1.
2. `src/components/drawRoot.ts` : `RootFrame` gagne `bloom: number` (multiples, 0 à 4, plafonné à 4) ; `drawSprout` dessine la fleur d'après `bloom` selon le tableau, `progress` ne servant plus qu'au bouton (ou : `bloom < 1` équivaut au `progress` d'aujourd'hui). Le flétrissement (`wither`) s'applique à `bloom` comme il s'applique à `progress`.
3. `src/components/ProfileRoot.tsx` : `restFrame`, `seenFrame` et les deux animations (nouvelle période, et temps fait depuis la dernière visite) portent `bloom` comme elles portent `progress` (interpolé des minutes vues aux minutes du moment ; `LastSeen` garde `minutes`, dont `bloom` se déduit avec `goalMin`). Bulle (`RootBubble`) : la ligne « Cette semaine : 1 h 30 sur 45 min » gagne « · 2 fois l'objectif » dès 1 fois (une décimale : « 1,5 fois »), puis une ligne grise : « Fleur en bouton ; elle s'ouvre à 45 min. » / « Fleur à l'étape 2 sur 4 ; la suivante à 2 h 15. » / « Fleur épanouie : étape 4 sur 4. » (textes de la maquette, `formatDuration` de `core/units.ts`, virgule décimale). La ligne « Objectif tenu : la racine gagne une étape dimanche soir. » reste.
4. Banc : `outils/banc/racine.mjs` (lire ce qu'il relève) ; si la pousse est relevée par `data-niveau`, ajouter `canvas.dataset.fleur = bloom.toFixed(2)` dans `paint` de `ProfileRoot.tsx` et un relevé dans le script, sans casser les étapes existantes. Ne pas lancer le banc : l'orchestrateur s'en charge.
5. Pas de nouveau réglage, pas de seuil en dur hors d'une constante nommée en tête de `drawRoot.ts` (`BLOOM_STEPS = 4`, bornes du second rang et des graines).

## Vérification

`node outils/verif.mjs --rapide`. Décisions à relire : `docs/DECISIONS.md` §9 (Profil), paragraphe « Racine » ; sa mise à jour est faite à la passe doc, pas dans ce lot.

## Ne fait pas

Pas de commit, pas de version, pas de banc, pas de build, aucune décision de produit (tout est tranché ci-dessus).
