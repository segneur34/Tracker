# 230 · Plan (agent Plan, 26/11) et choix tranchés

Fiche : `docs/backlog/230-note-niveau-sportif.md`. Étude : `docs/backlog/230-etude.md` (efforts 50, régularité 30, forme 20, plafond à 74 sans forme mesurée, six paliers). Choix de l'utilisateur : la note plaît, présentation B de la maquette (une ligne repliée « Niveau 66 · Sportif » avec la petite échelle des paliers, qui se déplie sur les parts) ; « attention à sa place par rapport à la racine ». Q75 par son défaut : tous les efforts enregistrés comptent.

## 1. Place de la ligne par rapport à la racine

Ordre actuel de la page (`src/pages/ProfilePage.tsx`) : en-tête (photo, pseudo, `RootSlot`, carré de 88 px, 72 px sous 600 px, collé à droite) ; choix de la photo s'il est ouvert ; période (`.profile-periods`), puis `MemoryStatus`, la bande de chiffres (`.profile-figures`), la répartition (`.profile-split`) et le graphe (`.actchart`).

La racine (`src/components/ProfileRoot.tsx`, `src/core/rootPath.ts`) est un canevas en `absolute` sur toute la page, au-dessus des cadres, qui ne capte pas le toucher. Elle part du carré, descend dans la marge de droite, passe au-dessus du premier cadre de `ROOT_CARDS` puis serpente autour de chacun ; elle se reconstruit dès qu'un cadre bouge d'un pixel (`layoutKey`). La longueur d'un tour vient de `tourLength` : le haut réel du premier cadre, plus quatre hauteurs fixes (`REFERENCE_CARD_HEIGHTS = [34, 178, 318, 273]`). La bulle de la racine s'ouvre en `absolute` sous le carré, calée à droite.

Piège : un bloc hors de `ROOT_CARDS` qui se déplie au-dessus de la période fait descendre le haut du premier cadre, donc change `tourLength`, donc la longueur de la racine à chaque pliage : contraire à la décision du 27/10 (§9 : la longueur ne dépend que du niveau de la racine).

- A. Dans l'en-tête, sous le pseudo : écarté (trois éléments se disputent le haut à 360 px, le dépliage tombe dans le piège, la bulle de la racine recouvre les parts).
- **B. Premier cadre de la page, entre l'en-tête et la période, en tête de `ROOT_CARDS`** : retenu. Une hauteur fixe (la ligne repliée, mesurée à 390 px) est ajoutée en tête de `REFERENCE_CARD_HEIGHTS` ; le haut du premier cadre ne bouge plus au dépliage, la longueur reste la même ; la racine entoure la ligne comme les autres cadres ; dépliée, la ligne pousse les cadres et la racine refait son tracé, comme au changement de période. Au-dessus de la période, la ligne se lit comme hors période, ce qui est voulu (fenêtres fixes). Conséquence unique : un tour compte un cadre de plus, donc à niveau égal la racine paraît une fois un peu plus longue. Téléphone tourné et ordinateur : même place, pleine largeur de la colonne ; parts dépliées empilées au téléphone, en trois colonnes dès 600 px.
- C. Sous le graphe d'activités, hors de la racine : écarté (plus « lisible d'un coup d'œil », la queue de la racine se dessine dessus).

Le cadre est toujours rendu, à hauteur constante, pendant « Lecture de la mémoire » et sans profil (sinon la racine se reconstruirait pendant le chargement) ; sans année de naissance ni sexe, il porte l'invite vers Réglages › Pratiquant.

## 2. Calcul : `src/library/sportLevel.ts` (pur) et `sportLevel.test.ts`

Dans `library/`, à côté de `rootGrowth` et `statsLevel` (il lit des sessions résumées, pas une trace).
- Entrées : `LevelSession[]` (`startMs`, `timeS`, `family`, `treatment`, `sport`, vitesse moyenne en mouvement en m/s ou `null`, `hr: { coveredS, histogram } | null`, `zoneBounds | null`, `excluded` pour les tests de FC de repos et de nuit) ; `ageYears | null` ; `forme: FormeSource[]`, chacune `{ kind: 'course' | 'velo' | 'coeur', points 0-100, atMs, text }` ; `nowMs` ; `rules = LEVEL_RULES`.
- Sortie : `{ note, palier, capped, parts: [{ id, points | null, weight, proof, missingHint }], uncounted }` (sessions non comptées et pourquoi).
- `LEVEL_RULES`, un seul objet gelé sur le modèle de `ROOT_RULES` : poids 0,5 / 0,3 / 0,2, plafond 74, paliers [20, 40, 60, 75, 90] avec leurs noms et `needsForme` ; fenêtres en jours (efforts 42, au moins 14 ; régularité 84, au moins 42, tranches de 7 ; forme 365 ; cœur 180) ; `INTENSITY_FACTORS`, `INTENSITY_BY_ZONE`, `SPORT_INTENSITY`, `FOOT_SPEED_BOUNDS_MS` [1,11 ; 1,94], `BIKE_VIGOROUS_MS` 5,28 ; `EFFORT_REFS` (0/150/300/600 vers 0/50/75/100) et facteur des moins de 18 ans 420/150 ; jour actif dès 20 min, cible de 3 jours ; `REST_HR_TABLE_OFFSET_BPM` 0, `FTP_SHARE_OF_MAX` 0,75. Aucun nombre dans le corps des fonctions (règle 3). Fenêtres en temps, depuis la première session si elle est plus récente (règle 2).
- Tests : les six sportifs de l'étude (§6) depuis des sessions fabriquées, parts recalculées à la main (coureur E=270 → 70 ; wing 180 min modérées → 55 ; marcheuse Ec=min(420, 300) → 75, régularité 100 ; vélo 480 vigoureuses → 90, régularité 33 ; débutante 30 / 50 ; notes 78 / 59 / 74 (84 sans plafond) / 72 / 38 / 45) ; la table d'arrêt (§3) ; une part absente retirée et non mise à zéro (poids remis à l'échelle 62,5 / 37,5) ; plafond, moins de 18 ans, FC par zones contre intensité du sport, test de repos non compté, fenêtre courte d'un nouvel utilisateur.

## 3. Données

`StatSession` (`src/library/stats.ts`) porte déjà tout : `movingTimeS`, `waterTimeS`, `movingDistanceM`, `heartRate.histogram` et `coveredS`, `bests` (`d5kmS`, `d10kmS`, `p20minW`, `powerRiderKg`), `family`, `treatment`, `activityId`. Rien à ajouter au résumé, `SUMMARY_CALC_VERSION` ne bouge pas. FC de repos par `hooks/useRestingHrResults.ts` (`tracker.restingHr`). Seule manque la table NHANES de FC de repos par âge et sexe : `src/library/restingHrNorms.ts`, pur, valeurs dans `docs/backlog/230-fc-repos-nhanes.md` (relevées à la source le 26/11). Coût à l'ouverture : un passage sur les sessions de 365 jours dans un `useMemo`, négligeable.

## 4. Étapes

Étape A, calcul (neutre, rien à l'écran) :
1. `rootSessionTimeS` passe de `src/hooks/useProfileRoot.ts` à `src/library/profile.ts` (le hook le réimporte, son test suit).
2. `zonesFor` sort de `src/pages/StatisticsPage.tsx` (fonction locale) vers le module de `runnerHeartRateZones` : Statistiques et Profil la partagent.
3. Règle 13 : `formeForAge(sessions, profile, nowMs, rules)` dans `src/library/statsLevel.ts` (déjà dans `LAND_FILES`) ; il réemploie `runningLevel`, `cyclingLevel`, `bestOf`, `vo2maxPercentile`, ajoute la VO2max du vélo (ACSM) et rend des `FormeSource`. `sportLevel.ts` n'importe ni `running/` ni `cycling/`. La source cœur vient de `restingHrNorms.ts`, neutre. Rien n'est ajouté à `LAND_FILES` ni à `SEAM`.
4. `sportLevel.ts`, `restingHrNorms.ts` et leurs tests.

Étape B, écran :
1. `src/hooks/useSportLevel.ts` (assemble `useVisibleStatSessions`, `useRunnerProfile`, les résultats de FC de repos, `zonesFor`, `formeForAge`).
2. `src/components/SportLevelLine.tsx` et son CSS (`.profile-level`, variables de `tokens.css`) : repliée, chiffre, palier et échelle des six paliers ; dépliée, une barre par part, le poids effectif, la phrase de preuve, l'invite d'une part absente, la phrase du plafond ; pliage par `useOpenSections('profil', …)`, chevron `IconChevronRight` comme `.profile-fold` ; aide « ? » au texte de l'étude (§7).
3. `ProfilePage.tsx` : le cadre sous l'en-tête, `'.profile-level'` en tête de `ROOT_CARDS`.
4. `src/core/rootPath.ts` : la hauteur repliée mesurée au banc en tête de `REFERENCE_CARD_HEIGHTS`.

Banc : `racine-periodes.mjs` étendu (`data-longueur` identique ligne repliée et dépliée, aux cinq périodes), `racine.mjs`, `profil.mjs` ; `niveau.mjs` neuf (coureur et marcheuse synthétiques, note et palier relevés, dépliage, aucun débordement aux trois tailles, captures pour la planche), décrit dans `SCRIPTS.md`.

## Tranché par l'orchestrateur le 26/11

- Code sur Opus/high (la conception, faite par l'étude sur Fable, est finie).
- Emplacement B. L'étape A se code tout de suite. L'étape B se code dans une copie et sert de planche (captures avec la vraie racine, 390 × 844, 844 × 390, 1400 × 1000, repliée et dépliée, racine courte et longue) : elle n'est rapatriée sur main qu'après le oui de l'utilisateur sur la planche.
- Pliage retenu sur l'appareil, replié au départ. Ouvrir la bulle de la racine ne replie pas la note (elle la recouvre, comme aujourd'hui les cadres).
- Test de FC de repos et FC de nuit : non comptés ; test de FC max : compté comme un effort vigoureux.
- Sessions cachées et « à classer » écartées, comme dans Statistiques.

## À confirmer par l'utilisateur, sur la planche

1. La place de la ligne (premier cadre, entre l'en-tête et la période, la racine passant autour).
2. L'allongement de la racine, une seule fois, à niveau égal (un cadre de plus par tour). Défaut : accepté ; sinon `tourLength` ignore le cadre du niveau.
