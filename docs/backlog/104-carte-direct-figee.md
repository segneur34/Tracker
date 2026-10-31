# 104 · Enregistrement : la carte du direct reste figée en course à pied

Brief écrit le 31/10 par l'orchestrateur (`/chaine`). Modèle | Réflexion : Opus | high. Petit lot, seul dans sa session (il touche à l'enregistrement).

## Le fait

Essai 77 du 31/10 (lot 67 « ne redessiner que les chiffres », validé le 30/10) : pendant une course à pied de 34 min, la carte du direct de la page Enregistrer est restée figée. La trace enregistrée est correcte (1948 points, deux trous de position de 26 s et 15 s) : le défaut est à l'affichage du direct, pas à l'enregistrement. L'utilisateur n'a pas encore dit si la carte était figée dès le départ ou après un moment / un écran rallumé, ni si elle était ouverte ou réduite (Q51, sans réponse) : par défaut, reproduire les deux états au banc, en commençant par la reprise après un écran éteint, puisque la trace porte deux trous de position.

## Ce qu'on sait du code (lecture du 31/10, à vérifier)

- `RecordingMap` (`pages/RecordingPage.tsx`, vers la ligne 410) se redessine à chaque position par `useRecorderSelector((s) => s.stats)` et à chaque calcul du direct par `useLiveRecording()` ; la position vient de `getLastFix()` (`hooks/useRecorder.ts`), la trace de `live.segments` (`hooks/useLiveRecording.ts`, recalcul au plus toutes les 2 s quand une page lit, 5 s sinon).
- `LiveMap` (`components/LiveMap.tsx`) : tracés mémorisés par segment dans un `WeakMap` sur la première position du segment (`segmentPath`) ; le dernier segment n'est prolongé que de ses nouveaux points ; `FollowPosition` recentre par `panTo` tant que l'utilisateur n'a pas déplacé la carte à la main ; `MapAutoResize` suit la taille du conteneur.
- Une pause automatique (immobilité, réglable par activité ; en course, « sous 0 km/h » chez l'utilisateur) ouvre un nouveau segment à la reprise (`keepPoint`, `pendingBreak`). Pendant la pause automatique, les positions continuent d'être reçues (`receiveFix` les accepte en `isAutoPause`).
- Écran éteint sur Android : le WebView ralentit ses minuteurs ; l'enregistrement, lui, continue par le plugin natif. À la reprise, le direct doit rattraper. Rien ne gère explicitement `visibilitychange` dans la carte ni dans `useLiveRecording`.
- Point 210 d'HISTORIQUE (lot 67) : « la carte doit rester abonnée à chaque position » ; un sélecteur doit rendre une primitive ou une référence d'état existante.

Pistes à éprouver, sans en exclure d'autres : la mémoire des tracés de `segmentPath` qui rend le même tableau quand la longueur ne change pas (un segment refait à même longueur mais autre contenu, ou un segment dont la première position se retrouve dans deux segments) ; `useLiveRecording.request()` qui laisse un minuteur en place ou ne recalcule plus (`computedFor`, `timer`) après un passage en arrière-plan ; `FollowPosition` dont l'effet ne repart pas ; `MapAutoResize` ou Leaflet après un conteneur caché (carte réduite puis rouverte : `LiveMap` est-il remonté ou non ?) ; la clé de `LiveMap` (`'direct'`).

## À faire

1. **Reproduire au banc** d'abord, sans toucher au code : un script `outils/banc/carte-direct.mjs <port> <dossier de travail>`, sur le modèle de `rendus.mjs` (rejeu d'une course à 1 Hz, `lib/cdp.mjs`, `TEMPS=10` possible). Le rejeu porte deux trous de position (26 s puis 15 s, comme la trace réelle) et une immobilité assez longue pour déclencher la pause automatique de la course ; pendant chaque trou, la page est cachée (`document.hidden` / `visibilitychange` forcés par CDP : `Emulation` ou `Page.setWebLifecycleState`), pour imiter l'écran éteint. Deux passages : carte ouverte, puis carte réduite et rouverte. Le script relève, toutes les quelques secondes de page, la position de la flèche (centre de la carte, `map.getCenter()` par le conteneur Leaflet) et le nombre de points du dernier tracé ; il dit **figé** si la position ne bouge plus alors que les positions arrivent (texte de la page : distance qui monte). Relever aussi les erreurs de console.
2. Si le banc reproduit : corriger la cause, au plus près (une pièce, pas une refonte) ; respecter le point 210 (pas de redessin de toute la page, rendus mesurés par `rendus.mjs` inchangés à quelques unités près) et la règle 12 (plateforme via `src/platform/`).
3. Si le banc ne reproduit rien : le dire dans le rapport, avec les états éprouvés, et proposer ce que l'utilisateur devra regarder au téléphone (deux ou trois gestes au plus) ; ne pas « corriger » à l'aveugle.
4. Tests : un test pur sur la pièce corrigée (par exemple `segmentPath` sortie de `LiveMap.tsx` dans `recording/livePath.ts` si c'est elle, testée sur des segments synthétiques : prolongement, segment fermé, segment refait à même longueur) ; `npm run verif` ; `node outils/banc/passe.mjs` sur `rendus.mjs` et le nouveau script.

## Ce que le lot ne fait pas

Pas de commit, pas de version, aucune décision de produit. Ne pas changer le rythme de 2 s du direct ni la forme des segments sans le dire dans le rapport. Rien dans `docs/` hors ce fichier.

## Rapport attendu

FAIT / BLOQUÉ / ÉCHEC ; ce que le banc a montré (figé ou non, dans quel état, à quel moment du rejeu) ; la cause et la correction en trois lignes ; les essais au téléphone qu'il juge nécessaires (ce que le banc ne peut pas voir).

## Réponse à Q51 (31/10) et décision

L'utilisateur : « quand j'ai fait pause, j'ai continué à avancer, et la carte était figée ; je n'ai pas fait attention aux chiffres mais je ne pense pas qu'ils avançaient ; quand j'ai fait reprendre, ça a fait un trait droit vers ma nouvelle position et à ce moment le triangle qui représente ma direction s'est remis à bouger » (autour de la note 2 de la course, après le saut de la note 1). Les deux trous de 26 s et 15 s sont donc vraisemblablement ses deux pauses manuelles.

Cause : en pause manuelle, `receiveFix` ne garde pas les positions (seulement `lastReceivedFix`), et la carte lit `getLastFix()`, la dernière position gardée : flèche et carte restent sur le point de la pause, par construction. Ni frottement (H1) ni trou (H2).

Décision tranchée par l'orchestrateur (comportement attendu par l'utilisateur, pas de nouveau réglage) :
- en pause manuelle, la flèche de position suit la position réellement reçue (`lastReceivedFix`, cap compris), la carte la recentre comme d'habitude ; aucune trace n'est dessinée pendant la pause (rien n'est enregistré) ;
- à la reprise, la trace repart de la nouvelle position dans un nouveau segment ; aucun trait droit entre le point de la pause et le point de reprise, ni passager (le trait `lastFix → position` de `LiveMap` ne doit pas joindre deux segments différents), ni durable ;
- les chiffres restent figés en pause manuelle (DECISIONS §6 : durée figée) ; la pause automatique ne change pas (les positions y sont déjà gardées).
- H1 (suivi coupé par un glissé) n'est pas corrigée dans ce lot : « Recentrer » reste le seul retour, l'utilisateur ne l'a pas vécue.

Au banc : le scénario principal devient une pause manuelle (appui tenu 2 s sur le bouton rond) pendant laquelle le rejeu continue d'avancer, puis la reprise ; le script relève la flèche pendant la pause (elle doit bouger) et l'absence de trait droit après la reprise. Les trous de position et la page cachée restent un second scénario, plus léger.

## Ce que le banc a montré et décision finale (31/10)

Le banc `carte-direct` reproduit la flèche figée pendant la pause manuelle, avant comme après la première correction : ce n'est pas un défaut d'affichage, **la pause manuelle coupe le GPS** depuis le 24/09 (HISTORIQUE point 50), aucune position n'arrive. Les trous de position et la page cachée (H2) ne figent rien ; le trait droit vu au téléphone vient vraisemblablement de la première position après la relance du GPS à la reprise, prise près de l'ancien point.

Décision de l'utilisateur (31/10, réponse A) : **pendant une pause manuelle, le GPS reste allumé**, comme pendant la pause automatique ; la flèche suit le coureur, rien n'est enregistré ni compté (distance et durée figées, DECISIONS §6), la trace repart à la reprise dans un nouveau segment. Coût accepté : la batterie du GPS pendant les pauses. Conséquence : plus de première position périmée à la reprise, donc plus de trait durable ; le trait passager de la carte (`liveTail`) est fermé de toute façon.
