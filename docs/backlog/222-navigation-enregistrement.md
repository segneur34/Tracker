# 222 · Enregistrer : navigation sur une trace suivie (trois soucis, un lot)

## (a) Rechoisir une trace pendant l'enregistrement

Tel que noté, 21/11/2026, 13:52 : « si jamais par erreur je retire la trace que j'ai planifiée en mode navigation enregistrement je n'ai pas moyen de la réafficher sans devoir arrêter la trace et en gros arrêter l'enregistrement et le relancer il faut pouvoir charger une trace depuis le moment où on est en train d'enregistrer »

Aujourd'hui (vérifié le 21/11) : « Retirer » (`clearFollowedTrace`) reste offert pendant l'enregistrement, mais `FollowTracePicker` n'est rendu que `!busy` (`src/pages/RecordingPage.tsx`, vers la ligne 1240). Voulu : un bouton « Suivre une trace » pendant l'enregistrement (itinéraire ou session), et une trace choisie en cours de route qui ne change ni l'activité ni la trace enregistrée (la proposition d'activité de `proposeActivityOf` n'a lieu qu'au repos).

## (b) Inverser le sens de la trace suivie

Tel que noté, 21/11/2026, 13:55 : « si jamais au moment où on lance la trace on la lance dans le mauvais sens là le graphique de dénivelé ne fonctionne pas du coup il faut créer une option pour pouvoir inverser le sens du parcours pendant qu'on est en train de naviguer dans la trace »

Aujourd'hui : l'inversion n'existe qu'en planification (`src/planning/route.ts`, `reverseRoute`, bouton « Inverser » de `PlanningPage`). Voulu : « Inverser » sur la ligne « Trace suivie », avant comme pendant l'enregistrement ; avancement (`splitFollowedTrace`), profil (`followedProfile`) et « reste … m D+ » recalculés depuis l'autre bout. Hors parcours de balises (voile, surf), sauf si c'est trivial.

## (c) Carte et dénivelé, chacun sa place


### Tel que noté

21/11/2026, 15:08 : « quand on affiche le graphe de la dénivelé plus la carte quand on est en train d'enregistrer en suivant une trace le graphe de la dénivelé se fait en prenant de la place sur la carte à la place d'avoir chacun leur espace et du coup la carte se retrouve toute petite donc ça aussi il faut le régler »

### Aujourd'hui (vérifié le 21/11)

Téléphone debout, enregistrement en cours, « Dénivelé » ouvert : la page passe en `rec-page--fit` (`src/pages/RecordingPage.tsx`, `useRecMapFit`) et la carte prend ce qui reste de l'écran sous les tuiles et le nom de la trace, moins le graphe : `min(45vh, max(140px, …))` (`src/pages/RecordingPage.css`, règle `.rec-page--fit .rec-map > div`). Avec les tuiles (BPM, Durée, Vitesse…) au-dessus, il ne reste souvent que le plancher de 140 px : la carte devient minuscule. C'est ce que dit la décision du 08/11.

### Contradiction

DECISIONS §6, « Graphe de dénivelé pendant le suivi d'un itinéraire » : « Téléphone debout, graphe ouvert : la carte se raccourcit pour que les deux tiennent sans défiler ». La note demande l'inverse : que la carte garde sa place.

### Voulu (choisi le 21/11)

La carte garde sa hauteur ordinaire (celle sans graphe), le graphe se pose dessous et la page défile. Le mode `rec-page--fit` et `useRecMapFit` sont à retirer ou à ramener à ce comportement ; téléphone tourné et ordinateur inchangés. Réécrire la phrase du §6 à la passe doc.

## Essai au téléphone

Une vraie navigation : rechoisir une trace retirée, l'inverser, graphe ouvert carte normale.

## Plan (agent Plan, 21/11) et choix tranchés par l'orchestrateur

Constat : la trace suivie vit dans `src/hooks/useFollowedTrace.ts` (clé `tracker.followedTrace`, relue au démarrage) ; l'avancement se rejoue dès que l'objet trace change (`useLiveRecording.ts`, `createFollowCursor`), profil et distances en cache par objet : une trace neuve ou inversée recalcule tout d'elle-même. `reverseRoute` ne sert pas (il travaille sur un `PlannedRoute`).

Fichiers : `src/recording/followedTrace.ts` (+ test), `src/recording/followedProfile.test.ts`, `src/hooks/useFollowedTrace.ts` (+ test si le stockage se simule simplement), `src/pages/RecordingPage.tsx`, `src/pages/RecordingPage.css`, banc `denivele-direct.mjs` et `trace-suivie.mjs`.

1. Pur : `reverseFollowedTrace(trace)` (points et `marks` inversés, le reste tel quel). Tests : deux inversions rendent l'origine ; `splitFollowedTrace(inversée, p)` miroir de `(origine, L - p)` ; un parcours couru à l'envers n'avance pas sur l'origine et avance jusqu'à L sur l'inversée, à 1 Hz comme à 5 Hz ; D+ de l'inversée = D- de l'origine, `remainingGainM` au départ aussi.
2. Magasin : action `reverseFollowedTrace()` qui écrit la trace inversée sans repasser par `thinFollowedTrace` (extraire de `set` une écriture brute, sinon des inversions répétées érodent le tracé). Le sens inversé survit ainsi à une reprise.
3. (b) Bouton « Inverser » sur la ligne « Trace suivie », entre « Dénivelé » et « Retirer », au repos comme en enregistrement ; masqué sur un parcours de balises (même condition que « Dénivelé », `courseMarksOf`).
4. (a) En enregistrement sans trace suivie (hors muscu, `liveHeartOnly`) : un petit bouton « Suivre une trace » ouvre le même `FollowTracePicker`, sans `onPicked` (ni activité ni trace enregistrée changées) ; `picking` remis à faux au démarrage et à l'arrêt.
5. (c) Retirer `useRecMapFit`, `rec-page--fit` et leurs règles CSS ; la carte garde sa hauteur ordinaire, le graphe dessous, la page défile ; téléphone tourné et ordinateur inchangés.
6. Banc : `denivele-direct.mjs` (les vérifications de carte raccourcie deviennent : même hauteur graphe ouvert ou fermé, graphe sous la carte, page qui défile ; ajouts « Inverser » au repos et pendant le rejeu, absent avec balises) ; `trace-suivie.mjs` (pendant le rejeu : « Retirer », « Suivre une trace », même itinéraire : activité inchangée, avancement revenu, session rangée intacte). Neutralité : `activite.mjs`, `notes.mjs`.

Tranché par l'orchestrateur (mineur) : « Inverser » masqué sur un parcours de balises ; téléphone debout, le nom de la trace garde sa propre ligne ; « Suivre une trace » en enregistrement seulement quand aucune trace n'est suivie (pour en changer : « Retirer » d'abord) ; une trace choisie en route rejoue l'avancement sur tout l'enregistrement (même coût qu'une reprise).
