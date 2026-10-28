# Reste à faire

Tenu par Claude ; l'utilisateur n'a jamais à l'ouvrir. `node outils/backlog.mjs` vérifie la forme et imprime le tableau de bord : aucun résumé fait à la main ne le remplace. Prochains numéros : élément 52, essai 68, question Q31.
- Une ligne par élément : `- N · [type] Titre · noté jj/mm · petit|gros · Modèle/effort · état · dépend de : … · détail : chemin` (champs sans objet omis, ordre gardé). N unique, dans la suite des lots, jamais réutilisé ; type `[bogue]`, `[idée]`, `[dette]` ou `[outil]` ; petit = un lot Sonnet ou Opus, une session ; gros = plusieurs lots, Fable, ou des données réelles ; détail dans `docs/backlog/N-titre.md` quand la ligne ne suffit pas.
- Quatre zones, un élément dans une seule : **Maintenant** (en cours ou à valider ; 3 lots avec essais au téléphone au plus, un lot validé sur lecture ne compte pas ; première ligne : l'APK installée) ; **Ensuite** (prêts, liste numérotée, l'ordre est la priorité, 7 au plus) ; **Ça attend une occasion** (sous une condition écrite en gras, hors de toute limite) ; **Plus tard** (daté, une phrase avec le résultat attendu ; proposé à l'abandon à la revue après 90 jours).
- Rangement à la mise au propre, posé en clair à l'utilisateur : un chiffre faux ou un usage cassé → tête d'Ensuite ; « vous en servirez-vous à votre prochaine sortie ? » oui → Ensuite, non → Plus tard ; petit et utile passe avant gros et utile.
- Essais au téléphone : sous-lignes de leur lot (`  - essai N : quoi → attendu`), numéros qui se suivent, jamais réutilisés ; un essai raté devient un `[bogue]` en tête d'Ensuite ; les essais de terrain vont dans « Ça attend une occasion ».
- Questions, 5 au plus : `- Qn · lot N · question · par défaut : … · posée le jj/mm` ; sans réponse après 4 semaines, Claude propose à la revue de trancher par défaut ; une question répondue disparaît (réponse dans DECISIONS ou dans l'élément).
- Fait = ligne supprimée après la passe `doc` (git et HISTORIQUE gardent la trace) ; pas d'archives ici.
- ETAT §9 et §11 gardent les limites connues (faits sur le code) ; ce fichier garde les intentions, en citant le §.

## Maintenant

APK 0.3.97 installée le 28/10 (versionCode 3097).
- 30 · [dette] Noyau voile : détection une seule fois puis classement par candidat de vent (observeTurns fusionné), confiance du vent rabattue sur couverture polaire maigre, bruit indépendant rééprouvé à 5 Hz · noté 26/09 · gros · Fable/xhigh · à valider (commit a0b565b, version 0.3.98) ; vérif complète, relecture et banc propres, diagnostic identique sur 12 sessions réelles hors la confiance de deux traces clairsemées · détail : docs/backlog/30-noyau-voile.md
  - essai 67 : sur le PC (Firefox) ou le téléphone, ouvrir la session de planche du 21/09 (Komoot, un point toutes les 14 s) → « Vent inconnu », vent à saisir, au lieu de 207° annoncé fiable ; puis la wing du 26/10 → vent 332° et 35 manœuvres, comme avant.

## Ensuite

1. 51 · [bogue] Profil › racine : il reste 2 ronds blancs au bout de la racine (un par pointe), à retirer ; décision du 27/10 « aucun rond blanc au bout des radicelles » non tenue ; piste : les bourgeons de drawBuds (--root-bud) au bout des branches en croissance, dans src/components/drawRoot.ts · noté 28/10 · petit · Sonnet/medium · à briefer
2. 50 · [bogue] Wing foil › onglet pumping : séparer la série de pumping du vol sur le foil, en mettant la cadence au premier plan ; une série dure peu à ton niveau (moins de 30 s) mais peut être bien plus longue avec du meilleur matériel, donc aucune durée plafond ; aujourd'hui un vol entier compte comme du pumping, copié du surf foil (§1 « Pumping foil ») · noté 28/10 · gros · Fable/high · à briefer ; 28/10 : réponse à Q31 reçue (série + vol à part, cadence d'abord) ; la mise au point des seuils attend une capture wing entière (n° 27, essai 48) · détail : docs/backlog/50-pumping-wing.md

## Ça attend une occasion

**Le test de FC max essayé (essai 2)**
- 29 · [idée] Tests guidés : VMA par demi-Cooper et VAMeval (Q30 : les deux), bips de palier, protocole des zones, FC repos rangée dans les sessions sans position · noté 25/10 · gros · Opus/high · en attente ; 28/10 : le test de FC max d'abord, la VMA n'a de sens que sur terrain plat, dur et roulant · dépend de : maquette si l'écran des tests change · détail : docs/backlog/29-tests-guides-vma.md

**Une course avec la ceinture cardio**
- essai 1 : ceinture, écran éteint : marche de 10 à 15 min, téléphone posé, pause automatique décochée ; trois ou quatre fois 2 min près du téléphone puis 1 à 2 min hors de portée ; remettre la pause automatique après → reprise seule à chaque retour ; onglet « cardio » avec un trou par sortie de portée.
- essai 2 : test de FC max : Entraînement › Tests › FC max › Lancer, ceinture portée, sur terrain plat → échauffement guidé, rampe avec bips, onglet « test » avec FC max ; « Retenir cette FC max » ; débloque les zones de FC.
- 26 · [idée] Cadence à pied : relecture des .imu des courses des 21, 24 et 25/10, seuils réglés, keepCapture à false, unité devinée confirmée sur une marche en pas par minute (§11 « Course », point 124) · noté 17/10 · gros · Fable/high · à briefer · dépend de : fichiers .imu à copier du téléphone sur le PC
  - essai 4 : cadence : une vraie course, téléphone dans la poche ; données en main (courses du 21, 24 et 25/10 avec .imu sur le téléphone), Claude les relit → environ 160 à 180 pas/min.

**Une sortie surf**
- essai 46 : surf, une vraie session → vagues, temps sur la vague et rame crédibles ; seuils jamais validés : vague 9 km/h, attente, vol 10 km/h, vague en foil 18 km/h, retour au pic jusqu'à la première attente ; pumping : seuils de `PUMP_DETECTION` à régler sur un premier vol réel, `liftoffCalmG` à 0,08 g contre 0,03 à 0,05 g de rugosité à l'arrêt sur l'eau (décollage peut-être trouvé trop tôt) (§11 « Surf »).

**Une sortie wing capturée entière, Pumping coché**
- 27 · [idée] Pumping en wing : seuils de SAILING_PUMP_DETECTION (copie de ceux du surf) réglés, faux coups en série autour des sauts écartés, faux sauts en wing (ex-fiche 16, point 186) · noté 28/10 · gros · Fable/high · à briefer · dépend de : une session de wing capturée entière, Pumping coché ; à traiter avec le n° 50
  - essai 48 : wingfoil avec des sauts, en notant à part les vrais sauts → sert à régler les faux sauts en wing.

**Une sortie VTT ou course avec des sauts**
- essai 64 : sauts à terre : une sortie VTT ou une course avec quelques sauts, notés à part → les sauts sont trouvés et la foulée ne passe pas pour un saut ; seuils réglés sur le wingfoil (§11 « Sauts à terre », point 96).

**Une session de planche, de kite ou de bateau**
- essai 65 : seuils par support : une vraie session de planche, de kite ou de bateau, et sur une planche rapide un enregistrement dense → manœuvres, vitesses et temps en mouvement crédibles ; dire ce qui paraît faux (§11 « Valider les seuils par support »).

**Quelques vraies semaines**
- essai 47 : racine du Profil sur quelques vraies semaines → recul, fleur et feuilles tombées qui suivent la semaine (§11 « Racine du Profil »).

**Une réponse de vous**
- 28 · [idée] Cardio : FC moyenne dans Général, bip en sortie de zone, énergie par la FC en voile et surf, splits par kilomètre ; zones communes gardées (Q28) · noté 16/10 · gros · Opus/high · en attente · dépend de : Q29

## Plus tard

- 34 · [idée] Mode daltonien (ex-fiche 4) : des couleurs de familles, de traces et de graphes lisibles par un daltonien ; voulu « plus tard », reste à dire quel daltonisme et pour qui (§11 « Mode daltonien », point 90) · noté 08/10 · gros
- 35 · [idée] Montre connectée Android (ex-fiche 5) : lire sa FC, importer ses sessions, piloter du poignet ; reste à dire quelle montre · noté 22/10 · gros · détail : docs/backlog/35-montre-connectee.md
- 36 · [idée] Autres capteurs Bluetooth (ex-fiche 17) : puissance, cadence et vitesse à vélo lues comme la ceinture ; dort tant que l'utilisateur n'a pas de capteur (point 118) · noté 16/10 · gros
- 37 · [dette] Résumés de la liste recalculés, ou signalés périmés, quand le seuil d'une activité ou l'allure imposée change (§9 « Résumés de la liste ») · noté 26/09 · petit
- 38 · [dette] Brouillon de session : le retour arrière du navigateur intercepté comme les autres sorties (§9 « Brouillon de session ») · noté 24/09 · petit
- 39 · [idée] Les deux énergies (course, k de l'air 0,0065 ; vélo, Crr par revêtement) comparées à une montre ou à Strava ; demande une sortie avec une montre (§11 « Énergie », points 71, 72, 88) · noté 03/10 · petit
- 40 · [idée] Surf : virages mesurés par le gyroscope (case « Mesurer les virages », élagage du .imu autour des vagues, rotation autour de la verticale) ; plan dans ~/.claude/plans/on-vas-reprendre-et-snug-stonebraker.md (§11 « Surf », point 110) · noté 10/10 · gros
- 41 · [idée] Appréciations sans emoji : icônes de components/icons.tsx à la place des RATINGS de sailing/sessionNotes.ts, si l'utilisateur le veut (§11 « Relecture du 15/10 », point 114) · noté 15/10 · petit
- 42 · [dette] Types de voie : la différence entre vélo et pied dite simplement (proposé : types permis à vélo montrés à demi cochés), non tranché (§11 « Types de voie », point 80) · noté 05/10 · petit
- 43 · [dette] Virage vu en un seul pas : choisir entre la perte de vitesse, le déplacement latéral, ou afficher que le fichier ne le dit pas ; à valider avec le souvenir de l'utilisateur (§11 « Nommer un virage vu en un seul pas », point 27) · noté 22/09 · gros
- 44 · [dette] Creux d'une manœuvre lu sur la vitesse non filtrée : le filtre médian de 3 s remonte les creux en V et surestime la conservation de 0,05 à 0,1 ; décision à part (§11 « Manœuvres ») · noté 30/09 · petit
- 45 · [outil] Tests et banc en sortie résumée dans la conversation principale, comme le fait déjà l'agent verif (mémoire « Optimisation des tokens », docs/MODELES.md « Autres leviers ») · noté 24/10 · petit
- 46 · [idée] Planification : altitude de l'IGN pour une trace importée, à la place du D+ lissé sur 100 m (DECISIONS §7, remise à plus tard le 27/10, point 166) · noté 27/10 · petit
- 47 · [idée] Itinéraires hors ligne par l'application BRouter pour Android, à la place du serveur public (point 59) · noté 25/09 · gros
- 49 · [dette] Mesure d'une manœuvre sous bruit réaliste : cap et gain du virement le plus lent (creux vers 3,75 nd) varient de ±20° et 15 m selon la cadence ; ce sont les bornes de measureManeuver, pas la détection (relevé au lot 30) · noté 28/10 · petit

## Questions

- Q29 · lot 28 · FC moyenne dans Général, bip en sortie de zone, énergie par la FC en voile et surf, splits par kilomètre : lesquels ? · par défaut : FC moyenne dans Général d'abord · posée le 28/10 · tranchée par défaut à la revue du 25/11 sans réponse
