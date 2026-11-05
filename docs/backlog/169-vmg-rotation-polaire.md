# 169 · Voile : VMG sur la rotation seule, courbe reliée, polaire sans les virements éclairs

Noté le 05/11, retour de l'essai 122 sur une vraie session (« la courbe est très hachurée, chaque manœuvre la coupe ») et réponses de l'utilisateur le même jour. Modèle | Réflexion : Opus | medium.

## Décisions de l'utilisateur (05/11), pour la passe doc (DECISIONS §1)

- **VMG** : seule la rotation est écartée des chiffres et de la courbe, plus la relance.
- **Courbe de VMG** : le trait relie les deux bords d'un trou qui contient une rotation ; les autres trous (arrêt, sous le seuil, trace coupée) restent coupés.
- **Polaire** (affichée, et celle du réglage du vent) : la rotation d'un virement passé moins de 3 s à moins de 30° du vent est écartée ; plus long, c'est une vraie remontée, en pumping par exemple. Empannages et relances gardés. L'estimation du vent n'en dépend pas (`prepareWindPolar`).

## Chiffres sur 5 sessions réelles de wing (191 manœuvres, 80 virements)

- Durée écartée par la VMG : avec la relance, 12 s en médiane, 33 s pour 9 sur 10, 60 s au plus ; rotation seule, 6 s, 9 s, 13 s.
- Trous de la courbe : 17 à 36 s en médiane avant, 15 à 17 s après (rotation + moyenne de 10 s) ; 72 à 100 % des coupures sont reliées selon la session, celles qui restent sont des arrêts plus longs (19 à 61 s en médiane).
- Temps de virement à moins de 30° du vent : 2 s en médiane, 4 s au plus ; 9 sur 80 atteignent 3 s (20° : 3 sur 80 ; 45° : 39 sur 80).
- Pointe de la polaire à moins de 30° du vent : 13,8 → 11,3 ; 17,4 → 17,4 ; 14,1 → 13,4 ; 13,3 → 10,3 ; 12,5 → 11,3 nd. La pointe de toute la polaire ne bouge pas. Les 17,4 nd du 21/10 restent : cause non cherchée (virement de plus de 3 s, manœuvre non classée, ou vent qui a tourné, la polaire lisant un seul vent).

## Limites

- Un arrêt collé à une rotation, sans valeur entre les deux, est relié avec elle (chute puis attente) : aucun seuil de durée ajouté, à revoir si ça gêne.
- Le ralentissement après le virage compte à nouveau dans les moyennes de VMG.
- La polaire se refait désormais quand le seuil d'activité change les manœuvres classées.
- À 1 Hz, le temps face au vent se compte en secondes entières.
