# 109 · Bibliothèque de sessions : tri au choix

Demande de l'utilisateur (31/10), maquette validée le 31/10 (réponses en clair dans la conversation) :
- Un bouton « Tris » à droite de l'onglet « planifiées » (rangée « réalisées / planifiées » de `src/pages/SessionLibrary.tsx`). Il est dépliable : replié par défaut, un appui déplie dessous le choix du tri, un nouvel appui le replie.
- Le choix déplié est un bouton glissant (`SegmentedControl`, `components/ui`) de 4 cases : « récentes » (par défaut), « distance », « durée », « v. max ». Toujours du plus grand au plus petit (les plus récentes, les plus longues…), pas de sens à inverser.
- Le choix est retenu sur l'appareil (via `src/platform/storage.ts`, jamais `localStorage` en direct ; lire DECISIONS §8 sur les réglages par appareil), le même pour toutes les familles.

Maquette :
```
[ réalisées (42) | planifiées (3) ]            [ Tris ▾ ]
( récentes | distance | durée | v. max )        ← seulement déplié
[ tous | Wing | Kite ]                          ← filtre d'activité, inchangé
- sam. 31/10  Wing   1 h 24 · 18,2 km
```

À régler en le faisant (tranché par l'orchestrateur) :
- Famille sans rangée « réalisées / planifiées » (pas de planification) : le bouton « Tris » seul, aligné à droite, à la même place au-dessus du filtre d'activité.
- Vue « planifiées » : le tri ne s'applique qu'aux sessions réalisées ; le bouton « Tris » et son choix sont cachés en vue « planifiées ».
- Clés de tri depuis le résumé de la fiche (`summary`) : date de départ (`startMs`), `distanceM`, durée (`endMs - startMs`), `maxSpeedMs` ; une session sans la valeur (muscu sans distance, résumé absent) passe en fin de liste, rangée par date. Égalité : la plus récente d'abord. La carte « À classer » garde son ordre.
- Le calcul du tri est une fonction pure dans `src/library/` avec son `*.test.ts` ; la page ne fait que l'appeler.
- Typographie et couleurs par les variables (`src/theme/tokens.css`) ; le bouton « Tris » dans le style des onglets voisins, accent de la famille ; icône depuis `components/icons.tsx` si besoin, pas d'emoji.

Vérification : tests du tri ; banc sur la bibliothèque (scripts qui l'ouvrent, à trouver dans `outils/banc/scripts.mjs`), texte identique replié, et le tri déplié change l'ordre.
