# Reste à faire

Tenu par Claude ; l'utilisateur n'a jamais à l'ouvrir. `node outils/backlog.mjs` vérifie la forme et imprime le tableau de bord : aucun résumé fait à la main ne le remplace. Prochains numéros : élément 112, essai 97, question Q53.
- Une ligne par élément : `- N · [type] Titre · noté jj/mm · petit|gros · Modèle/effort · état · dépend de : … · détail : chemin` (champs sans objet omis, ordre gardé). N unique, dans la suite des lots, jamais réutilisé ; type `[bogue]`, `[idée]`, `[dette]` ou `[outil]` ; petit = un lot Sonnet ou Opus, une session ; gros = plusieurs lots, Fable, ou des données réelles ; détail dans `docs/backlog/N-titre.md` quand la ligne ne suffit pas.
- Quatre zones, un élément dans une seule : **Maintenant** (en cours ou à valider ; 3 lots avec essais au téléphone au plus, un lot validé sur lecture ne compte pas ; première ligne : l'APK installée) ; **Ensuite** (prêts, liste numérotée, l'ordre est la priorité, 7 au plus) ; **Ça attend une occasion** (sous une condition écrite en gras, hors de toute limite) ; **Plus tard** (daté, une phrase avec le résultat attendu ; proposé à l'abandon à la revue après 90 jours).
- Rangement à la mise au propre, posé en clair à l'utilisateur : un chiffre faux ou un usage cassé → tête d'Ensuite ; « vous en servirez-vous à votre prochaine sortie ? » oui → Ensuite, non → Plus tard ; petit et utile passe avant gros et utile.
- Essais au téléphone : sous-lignes de leur lot (`  - essai N : quoi → attendu`), numéros qui se suivent, jamais réutilisés ; un essai raté devient un `[bogue]` en tête d'Ensuite ; les essais de terrain vont dans « Ça attend une occasion ».
- Questions, 5 au plus : `- Qn · lot N · question · par défaut : … · posée le jj/mm` ; sans réponse après 4 semaines, Claude propose à la revue de trancher par défaut ; une question répondue disparaît (réponse dans DECISIONS ou dans l'élément).
- Fait = ligne supprimée après la passe `doc` (git et HISTORIQUE gardent la trace) ; pas d'archives ici.
- ETAT §9 et §11 gardent les limites connues (faits sur le code) ; ce fichier garde les intentions, en citant le §.

## Maintenant

APK 0.4.54 installée le 31/10 (versionCode 4054 ; lot 50 suite : cartes du pumping au téléphone, « vols » et « pumping » en deux onglets ; elle porte aussi le lot 111 de la 0.4.52, le lot 104 de la 0.4.50 et le lot 50 de la 0.4.47, à valider dessus ; les lots 86 et 88, dans « Ça attend une occasion », y sont depuis la 0.4.35).
- 50 · [bogue] Foil (wing d'abord, puis surf foil et tout support à foil) › onglet pumping : séparer la série de pumping du vol sur le foil, en mettant la cadence au premier plan ; un vol sans cadence de coups ne compte pas comme pumping (rappelé « important » le 31/10, portée étendue à tous les supports à foil) ; une série dure peu à ton niveau (moins de 30 s) mais peut être bien plus longue avec du meilleur matériel, donc aucune durée plafond ; aujourd'hui un vol entier compte comme du pumping, copié du surf foil (§1 « Pumping foil ») · noté 28/10 · gros · Opus/xhigh · à valider (commit « Lot 50 », 0.4.47 ; 31/10 : mené sur Opus extra-high, sans Fable, choix de l'utilisateur ; 31/10 : cartes des séries chevauchées au téléphone, corrigées (« Lot 50, suite », 0.4.53) ; 31/10 : à la demande de l'utilisateur, « vols » et « pumping » en deux onglets, en voile comme en surf foil (« vols » sur foil, même sans capteurs ; « pumping » avec la capture), 0.4.54, DECISIONS §1 et §4 à mettre à jour à la passe doc) ; maquette validée le 31/10 (https://claude.ai/artifact/6obNsyMC7YGUVTemHt3GWd) ; 31/10 : « important » redit, règle étendue à tous les supports à foil, surf foil compris (la décision « par vol » de DECISIONS §1 et §4 est à réviser) ; 28/10 : réponse à Q31 reçue (série + vol à part, cadence d'abord) ; la mise au point des seuils attend une capture wing entière (n° 27, essai 48) · détail : docs/backlog/50-pumping-wing.md
  - essai 94 : la sortie wing du 01/11, Pumping coché, « Mesurer le pumping » coché, téléphone sur la poitrine, puis les onglets « pumping » et « vols » de son analyse (APK 0.4.54) → des séries là où vous avez pompé, aucune sur les bords tenus sans pomper ; cadence proche de votre rythme ; les vols dans leur propre onglet ; les deux tableaux lisibles en cartes au doigt ; « Voir » montre une seule surbrillance ; GPX et .imu copiés sur le PC pour le réglage des seuils (n° 27).
- 104 · [bogue] Enregistrement : la carte du direct reste figée en course à pied (essai 77 du 31/10, lot 67) ; la trace enregistrée est correcte (1948 points, deux trous de position de 26 s et 15 s), le défaut est à l'affichage du direct ; à préciser avec l'utilisateur : figée dès le départ ou après un moment / un écran rallumé, carte ouverte ou réduite · noté 31/10 · petit · Opus/high · à valider (commit « Lot 104 », 0.4.48) ; 31/10 : Q51 répondue, la carte s'est figée pendant une pause manuelle avec l'utilisateur qui continuait d'avancer ; cause : la pause manuelle coupait le GPS (point 50) ; décision de l'utilisateur : le GPS reste allumé en pause manuelle, la carte suit, rien n'est compté (DECISIONS §6 à mettre à jour à la passe doc) · détail : docs/backlog/104-carte-direct-figee.md
  - essai 95 : pendant une course, une pause manuelle d'environ 30 s en continuant d'avancer, puis la reprise (APK 0.4.54) → la flèche suit et tourne pendant la pause, sans trace dessinée, distance et durée figées ; aucun trait droit à la reprise, ni sur le direct ni dans l'analyse ; la notification « en pause » reste figée puis repart.
- 111 · [idée] Profil › racine › fleur : elle évolue trop peu au fil de la semaine, alors que les radicelles poussent à vue ; lui donner 3 ou 4 étapes visibles selon le temps fait dans la semaine (aujourd'hui : absente, bouton dès la première minute, ouverte à l'objectif ; DECISIONS §9 « Racine », ProfileRoot.tsx) · noté 31/10 · petit · Opus/high · à valider (commit « Lot 111 », 0.4.52 ; banc racine : fleur relevée à 0, 0,33, 0,67, 1, 2, 3 et 4 fois, bulle « n fois l'objectif » et étape de la fleur ; DECISIONS §9 « Racine » à mettre à jour à la passe doc) ; maquette validée le 31/10, 4 étapes (https://claude.ai/artifact/BC5HYbfgXGUjpj5Vg4FW9j) ; 31/10 : Q52 répondue, étapes calées sur des multiples de l'objectif par semaine : bouton dès la première minute, puis 1 fois, 2 fois, 3 fois et 4 fois l'objectif (épanouie au maximum à 4 fois ; le nombre exact de dessins entre 1 et 4 se règle à la maquette) · détail : docs/backlog/111-fleur-etapes.md
  - essai 96 : le Profil du téléphone après la sortie wing du 01/11 (APK 0.4.54) → la fleur tient dans le carré à droite du pseudo sans être coupée en haut, ouverte dès 45 min et plus garnie à 1 h 30 ; la bulle dit « n fois l'objectif » et l'étape de la fleur.


## Ensuite


## Ça attend une occasion

**Un vrai test de FC max avec la ceinture, sur terrain plat (lot 85, APK 0.4.50)**
- essai 71 : test de FC max refait avec la nouvelle logique (APK 0.4.50), sur terrain plat, ceinture portée → l'échauffement ne pousse plus à ralentir quand vous ralentissez déjà ; la rampe ne s'arrête plus sur un virage ou une côte, seulement quand vous lâchez franchement ; FC max proche de ce que vous atteignez à fond, sans arrêt sur un ralentissement bref ; « Retenir cette FC max » puis les zones de FC s'affichent.

**Le nouveau test de FC max (n° 85) livré et essayé**
- 29 · [idée] Tests guidés : VMA par demi-Cooper et VAMeval (Q30 : les deux), bips de palier, protocole des zones, FC repos rangée dans les sessions sans position · noté 25/10 · gros · Opus/high · en attente ; 28/10 : le test de FC max d'abord, la VMA n'a de sens que sur terrain plat, dur et roulant ; 29/10 : même logique que le n° 85 (athlète à fond, arrêt seulement sur effondrement) · dépend de : 85, maquette si l'écran des tests change · détail : docs/backlog/29-tests-guides-vma.md

**Un moment avec le téléphone et la ceinture cardio (essais des lots 86 et 88, reportés le 30/10)**
- 86 · [bogue] Ceinture cardio : après une pause automatique, téléphone laissé à distance, l'application ne s'est jamais reconnectée à la ceinture ; une reprise seule au retour dans la portée est voulue (essai 1) · noté 29/10 · petit · Opus/high · à valider (commit « Lot 86 », version 0.4.18) ; essais reportés par l'utilisateur le 30/10 · détail : docs/backlog/86-ceinture-reconnexion.md
  - essai 80 : ceinture portée, enregistrement lancé, écran éteint ; s'éloigner du téléphone 1 à 2 min (tuile « perdue, en attente de la ceinture »), puis revenir → la FC revient seule en quelques secondes ; si non, téléphone branché, Claude lit le journal de la ceinture. 31/10 : un seul éloignement, de 20 s en fin de course (arrêté) : la FC est revenue seule (trace du 31/10), trop bref pour conclure ; tuile « perdue » non vue ; à refaire 1 à 2 min.
  - essai 81 : pendant un enregistrement avec la ceinture, couper puis rallumer le Bluetooth → la FC revient seule.
- 88 · [bogue] Bips doubles et triples (trop vite, trop lent) plus brefs : un « bip-bip » plus court et plus serré, pour le compteur, les balises et les tests ; durées dans core/beepDurations.ts, version native dans TonePlayer.java · noté 29/10 · petit · Sonnet/medium · à valider (commit « Lot 88 », version 0.4.17) ; essais reportés par l'utilisateur le 30/10 · détail : docs/backlog/88-bips-brefs.md
  - essai 79 : Tests › FC max d'exemple, attendre un « trop vite » et un « trop lent » → un bip-bip (deux, puis trois bips) net, nettement plus court et plus serré qu'avant, vibreur compris ; le compteur et les balises sonnent comme avant.

**Une sortie voile avec la ceinture cardio**
- essai 75 : onglet graphiques, glisser un doigt sur la vitesse → le curseur suit aussi sur la FC (graphe commun du lot 61 ; le reste du geste a été validé le 30/10 sans ceinture).

**Une course avec la ceinture cardio**
- essai 1 : ceinture, écran éteint : marche de 10 à 15 min, téléphone posé, pause automatique décochée ; trois ou quatre fois 2 min près du téléphone puis 1 à 2 min hors de portée ; remettre la pause automatique après → reprise seule à chaque retour ; onglet « cardio » avec un trou par sortie de portée. 29/10 : raté (aucune reconnexion après une pause automatique), à refaire après le n° 86. 31/10 : pas trouvé comment désactiver la pause automatique (Réglages › Course › Enregistrement › Pause automatique, « sous » à 0 km/h) ; à refaire.
- essai 86 : lot 28 (validé le 30/10 sur lecture), course avec la ceinture, zone visée Z2 choisie sur Enregistrer (la rangée n'apparaît que ceinture connectée), sortir de la zone par le haut puis par le bas et y rester → deux bips brefs au-dessus, trois en dessous, le premier environ 10 s après la sortie, le deuxième 40 s plus tard, puis un par minute trois fois, puis silence ; un bip court au retour dans la zone ; rien en pause ni ceinture décollée ; tuile « BPM · visée Z2 ». 31/10 : pas fait, la rangée n'a pas été trouvée (elle exige la ceinture déjà connectée et des zones de FC définies : Profil ou test de FC max) ; à refaire.
- 26 · [idée] Cadence à pied : relecture des .imu des courses des 21, 24 et 25/10, seuils réglés, keepCapture à false, unité devinée confirmée sur une marche en pas par minute (§11 « Course », point 124) · noté 17/10 · gros · Fable/high · à briefer · dépend de : fichiers .imu à copier du téléphone sur le PC

**Une sortie surf**
- essai 46 : surf, une vraie session → vagues, temps sur la vague et rame crédibles ; seuils jamais validés : vague 9 km/h, attente, vol 10 km/h, vague en foil 18 km/h, retour au pic jusqu'à la première attente ; pumping : seuils de `PUMP_DETECTION` à régler sur un premier vol réel, `liftoffCalmG` à 0,08 g contre 0,03 à 0,05 g de rugosité à l'arrêt sur l'eau (décollage peut-être trouvé trop tôt) (§11 « Surf »).

**Une sortie wing capturée entière, Pumping coché**
- 27 · [idée] Pumping en wing : seuils de SAILING_PUMP_DETECTION (copie de ceux du surf) réglés, faux coups en série autour des sauts écartés, faux sauts en wing (ex-fiche 16, point 186) · noté 28/10 · gros · Fable/high · à briefer · dépend de : une session de wing capturée entière, Pumping coché ; à traiter avec le n° 50
  - essai 48 : wingfoil avec des sauts, en notant à part les vrais sauts → sert à régler les faux sauts en wing.

**Une sortie VTT ou course avec des sauts**
- essai 64 : sauts à terre : une sortie VTT ou une course avec quelques sauts, notés à part → les sauts sont trouvés et la foulée ne passe pas pour un saut ; seuils réglés sur le wingfoil (§11 « Sauts à terre », point 96). 31/10 : course de 34 min, un seul saut trouvé, 4 s après la note 1 ; aucun faux saut sur la foulée (bon) ; mais doutes « saturation » et « verticale » et vol de 1,92 s pour 0,88 m (incohérent) : n° 105 ; la note 2 (1441 s) n'a donné aucun saut, à demander ce que c'était ; essai gardé pour un vrai VTT.

**Une session de planche, de kite ou de bateau**
- essai 65 : seuils par support : une vraie session de planche, de kite ou de bateau, et sur une planche rapide un enregistrement dense → manœuvres, vitesses et temps en mouvement crédibles ; dire ce qui paraît faux (§11 « Valider les seuils par support »).

**Quelques vraies semaines**
- essai 47 : racine du Profil sur quelques vraies semaines → recul, fleur et feuilles tombées qui suivent la semaine (§11 « Racine du Profil »).

## Plus tard

- 110 · [idée] Bibliothèque de sessions : réfléchir à un mode de recherche (par nom, notes, date, lieu, matériel, fourchette de distance ou de durée…) ; commencer par dire ce que l'utilisateur cherche le plus souvent, après le tri du n° 109 · noté 31/10 · gros · Fable/medium · dépend de : 109
- 105 · [dette] Sauts à terre : sur la course du 31/10, le seul saut trouvé a un vol de 1,92 s pour 0,88 m de haut (incohérent : 1,92 s de vol libre ≈ 4,5 m) et les doutes « saturation » et « verticale » ; la durée de vol est sans doute surestimée ; relire le .imu de la course (2026-10-31_09-12-36_running) avec `outils/banc/sauts-diagnostic.mjs --tous` et recaler les seuils pour que le vol et la hauteur concordent (§3 « Sauts », §11 « Sauts à terre ») · noté 31/10 · petit · Opus/high
- 34 · [idée] Mode daltonien (ex-fiche 4) : des couleurs de familles, de traces et de graphes lisibles par un daltonien ; voulu « plus tard », reste à dire quel daltonisme et pour qui (§11 « Mode daltonien », point 90) · noté 08/10 · gros
- 35 · [idée] Montre connectée Android (ex-fiche 5) : lire sa FC, importer ses sessions, piloter du poignet ; reste à dire quelle montre · noté 22/10 · gros · détail : docs/backlog/35-montre-connectee.md
- 36 · [idée] Autres capteurs Bluetooth (ex-fiche 17) : puissance, cadence et vitesse à vélo lues comme la ceinture ; dort tant que l'utilisateur n'a pas de capteur (point 118) · noté 16/10 · gros
- 39 · [idée] Les deux énergies (course, k de l'air 0,0065 ; vélo, Crr par revêtement) comparées à une montre ou à Strava ; demande une sortie avec une montre (§11 « Énergie », points 71, 72, 88) · noté 03/10 · petit
- 40 · [idée] Surf : virages mesurés par le gyroscope (case « Mesurer les virages », élagage du .imu autour des vagues, rotation autour de la verticale) ; plan dans ~/.claude/plans/on-vas-reprendre-et-snug-stonebraker.md (§11 « Surf », point 110) · noté 10/10 · gros
- 41 · [idée] Appréciations sans emoji : icônes de components/icons.tsx à la place des RATINGS de sailing/sessionNotes.ts, si l'utilisateur le veut (§11 « Relecture du 15/10 », point 114) · noté 15/10 · petit
- 47 · [idée] Itinéraires hors ligne par l'application BRouter pour Android, à la place du serveur public (point 59) · noté 25/09 · gros
- 96 · [idée] Énergie par la FC en voile et en surf (ex-n° 28) : commencer par une recherche documentaire poussée (Keytel et autres formules, leur validité sur l'eau) avant tout code ; dort tant qu'aucune ceinture n'est portée sur l'eau · noté 30/10 · gros
- 97 · [idée] Splits par kilomètre en course et à vélo (ex-n° 28) : priorité minimale, jugé peu important par l'utilisateur le 30/10 · noté 30/10 · petit

## Questions


