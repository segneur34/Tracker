# Reste à faire

Tenu par Claude ; l'utilisateur n'a jamais à l'ouvrir. `node outils/backlog.mjs` vérifie la forme et imprime le tableau de bord : aucun résumé fait à la main ne le remplace. Prochains numéros : élément 95, essai 82, question Q50.
- Une ligne par élément : `- N · [type] Titre · noté jj/mm · petit|gros · Modèle/effort · état · dépend de : … · détail : chemin` (champs sans objet omis, ordre gardé). N unique, dans la suite des lots, jamais réutilisé ; type `[bogue]`, `[idée]`, `[dette]` ou `[outil]` ; petit = un lot Sonnet ou Opus, une session ; gros = plusieurs lots, Fable, ou des données réelles ; détail dans `docs/backlog/N-titre.md` quand la ligne ne suffit pas.
- Quatre zones, un élément dans une seule : **Maintenant** (en cours ou à valider ; 3 lots avec essais au téléphone au plus, un lot validé sur lecture ne compte pas ; première ligne : l'APK installée) ; **Ensuite** (prêts, liste numérotée, l'ordre est la priorité, 7 au plus) ; **Ça attend une occasion** (sous une condition écrite en gras, hors de toute limite) ; **Plus tard** (daté, une phrase avec le résultat attendu ; proposé à l'abandon à la revue après 90 jours).
- Rangement à la mise au propre, posé en clair à l'utilisateur : un chiffre faux ou un usage cassé → tête d'Ensuite ; « vous en servirez-vous à votre prochaine sortie ? » oui → Ensuite, non → Plus tard ; petit et utile passe avant gros et utile.
- Essais au téléphone : sous-lignes de leur lot (`  - essai N : quoi → attendu`), numéros qui se suivent, jamais réutilisés ; un essai raté devient un `[bogue]` en tête d'Ensuite ; les essais de terrain vont dans « Ça attend une occasion ».
- Questions, 5 au plus : `- Qn · lot N · question · par défaut : … · posée le jj/mm` ; sans réponse après 4 semaines, Claude propose à la revue de trancher par défaut ; une question répondue disparaît (réponse dans DECISIONS ou dans l'élément).
- Fait = ligne supprimée après la passe `doc` (git et HISTORIQUE gardent la trace) ; pas d'archives ici.
- ETAT §9 et §11 gardent les limites connues (faits sur le code) ; ce fichier garde les intentions, en citant le §.

## Maintenant

APK 0.4.18 installée le 30/10 (versionCode 4018, lots 87, 88 et 86).

## Ensuite

1. 51 · [bogue] Profil › racine : il reste 2 ronds blancs au bout de la racine (un par pointe), à retirer ; décision du 27/10 « aucun rond blanc au bout des radicelles » non tenue ; piste : les bourgeons de drawBuds (--root-bud) au bout des branches en croissance, dans src/components/drawRoot.ts · noté 28/10 · petit · Sonnet/medium · à briefer
2. 94 · [outil] Rangement après les vérifications plus rapides (n° 90, validé le 29/10) : retirer l'agent verif (npm run verif suffit), l'agent lot sur node outils/verif.mjs --rapide, l'agent banc sur outils/banc/passe.mjs (gardé pour lire un diff), docs/MODELES.md et la partie « Commandes » de CLAUDE.md à jour · noté 30/10 · petit · Sonnet/medium
3. 50 · [bogue] Wing foil › onglet pumping : séparer la série de pumping du vol sur le foil, en mettant la cadence au premier plan ; une série dure peu à ton niveau (moins de 30 s) mais peut être bien plus longue avec du meilleur matériel, donc aucune durée plafond ; aujourd'hui un vol entier compte comme du pumping, copié du surf foil (§1 « Pumping foil ») · noté 28/10 · gros · Fable/high · à briefer ; 28/10 : réponse à Q31 reçue (série + vol à part, cadence d'abord) ; la mise au point des seuils attend une capture wing entière (n° 27, essai 48) · détail : docs/backlog/50-pumping-wing.md
4. 52 · [dette] Assainissement du code (audit du 28/10) : doublons, vitesse, rangement avant le gros fork ; 30 lots numérotés 53 à 82 dans l'ordre conseillé ; 53 à 57 et 59 faits et validés le 29/10 (HISTORIQUE points 194 à 198 et 200), 60 à 65 validés le 30/10 (points 201 à 206), 58 et 71 à 82 en Plus tard ; 66, 69 et 70 validés le 30/10 (points 207 à 209, codés en parallèle), 67 et 68 validés le 30/10 (points 210 et 211) ; 18 questions dans la fiche ; le 29/10 l'utilisateur a validé les réponses par défaut de Q33 à Q49, seule Q32 reste posée ici · noté 28/10 · gros · Opus/medium · fiche écrite, lots à lancer dans l'ordre · détail : docs/backlog/52-assainissement.md

## Ça attend une occasion

**L'assainissement du code (n° 52) terminé**
- 85 · [bogue] Tests guidés, autre logique (FC max, puis VMA) : l'athlète est supposé se donner à fond, la vitesse monte progressivement avec des encouragements, l'arrêt seulement sur un effondrement net et durable ; échauffement plafonné vers 150 bpm et guidé par la FC croisée avec la vitesse ; le 29/10 le test a donné 160 bpm contre 190 bpm à un test « maison » · noté 29/10 · gros · Opus/high · en attente (décision de l'utilisateur : après la refactorisation en cours) · dépend de : 88 · détail : docs/backlog/85-tests-nouvelle-logique.md
  - essai 71 : test de FC max refait avec la nouvelle logique, sur terrain plat, ceinture portée → FC max proche de ce que vous atteignez à fond, sans arrêt sur un ralentissement bref ; « Retenir cette FC max » puis les zones de FC s'affichent.

**Le nouveau test de FC max (n° 85) livré et essayé**
- 29 · [idée] Tests guidés : VMA par demi-Cooper et VAMeval (Q30 : les deux), bips de palier, protocole des zones, FC repos rangée dans les sessions sans position · noté 25/10 · gros · Opus/high · en attente ; 28/10 : le test de FC max d'abord, la VMA n'a de sens que sur terrain plat, dur et roulant ; 29/10 : même logique que le n° 85 (athlète à fond, arrêt seulement sur effondrement) · dépend de : 85, maquette si l'écran des tests change · détail : docs/backlog/29-tests-guides-vma.md

**Un moment avec le téléphone et la ceinture cardio (essais des lots 86 à 88, reportés le 30/10)**
- 86 · [bogue] Ceinture cardio : après une pause automatique, téléphone laissé à distance, l'application ne s'est jamais reconnectée à la ceinture ; une reprise seule au retour dans la portée est voulue (essai 1) · noté 29/10 · petit · Opus/high · à valider (commit « Lot 86 », version 0.4.18) ; essais reportés par l'utilisateur le 30/10 · détail : docs/backlog/86-ceinture-reconnexion.md
  - essai 80 : ceinture portée, enregistrement lancé, écran éteint ; s'éloigner du téléphone 1 à 2 min (tuile « perdue, en attente de la ceinture »), puis revenir → la FC revient seule en quelques secondes ; si non, téléphone branché, Claude lit le journal de la ceinture.
  - essai 81 : pendant un enregistrement avec la ceinture, couper puis rallumer le Bluetooth → la FC revient seule.
- 87 · [bogue] Enregistrement : (a) la zone cardiaque dépasse du cadre quand la carte est réduite (capture d'écran de l'utilisateur) ; (b) le texte du bouton « Reprendre » (haut à gauche, à côté d'« Arrêter ») se sélectionne, comme celui d'« Arrêter » avant sa correction : même correction (§6) · noté 29/10 · petit · Sonnet/medium · à valider (commit « Lot 87 », version 0.4.16) ; essais reportés par l'utilisateur le 30/10 · détail : docs/backlog/87-enregistrement-zone-reprendre.md
  - essai 78 : enregistrement avec la ceinture, carte réduite, chiffre « Zone FC » affiché → la zone tient dans son cadre ; en pause, appui long sur « Reprendre » (et sur « Pause ») → rien ne se sélectionne.
- 88 · [bogue] Bips doubles et triples (trop vite, trop lent) plus brefs : un « bip-bip » plus court et plus serré, pour le compteur, les balises et les tests ; durées dans core/beepDurations.ts, version native dans TonePlayer.java · noté 29/10 · petit · Sonnet/medium · à valider (commit « Lot 88 », version 0.4.17) ; essais reportés par l'utilisateur le 30/10 · détail : docs/backlog/88-bips-brefs.md
  - essai 79 : Tests › FC max d'exemple, attendre un « trop vite » et un « trop lent » → un bip-bip (deux, puis trois bips) net, nettement plus court et plus serré qu'avant, vibreur compris ; le compteur et les balises sonnent comme avant.

**Une sortie voile avec la ceinture cardio**
- essai 75 : onglet graphiques, glisser un doigt sur la vitesse → le curseur suit aussi sur la FC (graphe commun du lot 61 ; le reste du geste a été validé le 30/10 sans ceinture).

**Une course avec la ceinture cardio**
- essai 1 : ceinture, écran éteint : marche de 10 à 15 min, téléphone posé, pause automatique décochée ; trois ou quatre fois 2 min près du téléphone puis 1 à 2 min hors de portée ; remettre la pause automatique après → reprise seule à chaque retour ; onglet « cardio » avec un trou par sortie de portée. 29/10 : raté (aucune reconnexion après une pause automatique), à refaire après le n° 86.
- essai 77 : enregistrement à pied avec la ceinture, carte ouverte, puis pause par appui long sur le bouton rond et reprise → position et cap suivent chaque seconde, la durée tourne dans le bandeau et le bouton rond, figée pendant la pause, la FC s'affiche (lot 67, validé le 30/10 sans cet essai)
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

- 93 · [bogue] Graphes : après un clic, Recharts donne le focus au graphe et sa couche clavier active le premier point ; la souris sortie du tracé ramènerait alors le repère de la carte au premier point affiché (vu sur l'évolution des répétitions, corrigé là au lot 61 par accessibilityLayer={false}) ; à vérifier au banc sur les autres graphes · noté 29/10 · petit
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
- 46 · [idée] Planification : altitude de l'IGN pour une trace importée, à la place du D+ lissé sur 100 m (DECISIONS §7, remise à plus tard le 27/10, point 166) · noté 27/10 · petit
- 47 · [idée] Itinéraires hors ligne par l'application BRouter pour Android, à la place du serveur public (point 59) · noté 25/09 · gros
- 49 · [dette] Mesure d'une manœuvre sous bruit réaliste : cap et gain du virement le plus lent (creux vers 3,75 nd) varient de ±20° et 15 m selon la cadence ; ce sont les bornes de measureManeuver, pas la détection (relevé au lot 30) · noté 28/10 · petit
- 58 · [dette] Voile, curseur du seuil plus fluide : le vent et l'altitude ne se recalculent plus à chaque cran ; chiffres identiques ; seul dans sa session · noté 28/10 · petit · Opus/high · seul dans sa conversation (relevé du vent avant/après sur les 12 sessions réelles, comme au lot 30) : à lancer dans une conversation neuve · dépend de : 56 (levé) · détail : docs/backlog/52-assainissement.md
- 71 · [dette] Rangement des dossiers : chaque fichier à sa place, un test qui garde le sens des dépendances ; reprend aussi le reste du lot 70 (réexport de la pente dans runningAnalytics à retirer, dépendance de types entre running/energyView et cycling, moyennes glissantes à fusionner seulement si identiques au bit près) · noté 28/10 · petit · Sonnet/high · dépend de : 57 (levé), 70 · détail : docs/backlog/52-assainissement.md
- 72 · [dette] Calcul sorti des écrans : réglages, profil, résumés et couleurs de trace calculés et testés à part ; reprend aussi le reste du lot 66 (sélecteur JSON et écouteurs communs, table des champs de réglages, cartes de Réglages mémoïsées : une frappe redessine encore toutes les cartes ouvertes) · noté 28/10 · petit · Opus/medium · dépend de : 71 · détail : docs/backlog/52-assainissement.md
- 73 · [dette] Carte : trace colorée dessinée en une seule couche au lieu de 54 000 morceaux, couleurs inchangées (Q46, Q48) · noté 28/10 · petit · Opus/high · dépend de : 72 · détail : docs/backlog/52-assainissement.md
- 74 · [dette] Tuiles et vignettes : moins de requêtes de carte, plus de carte vivante par ligne de la bibliothèque · noté 28/10 · petit · Opus/high · dépend de : 73 · détail : docs/backlog/52-assainissement.md
- 75 · [outil] Tests : traces d'essai communes au lieu de 26 copies · noté 28/10 · petit · Sonnet/high · dépend de : 57 (levé) · détail : docs/backlog/52-assainissement.md
- 77 · [dette] Style : règles CSS communes, variables, choix au bouton glissant, liste d'activités de l'application dans « Suivre une trace » (Q35, Q49) · noté 28/10 · petit · Sonnet/medium · dépend de : 64 · détail : docs/backlog/52-assainissement.md
- 78 · [bogue] Formats : nombres et durées écrits de la même façon sur toutes les pages (Q32) · noté 28/10 · petit · Sonnet/medium · dépend de : Q32, 55 · détail : docs/backlog/52-assainissement.md
- 79 · [bogue] Voile, mesure des manœuvres : distance à travers un trou de trace et caps à 5 points par seconde comme le reste de l'application (Q33) · noté 28/10 · gros · Fable/high · dépend de : Q33, 58, 71 · détail : docs/backlog/52-assainissement.md
- 80 · [dette] Fiche de session : champs décrits une seule fois, fichiers deux fois plus petits (Q44) · noté 28/10 · petit · Opus/high · dépend de : 54, 55 · détail : docs/backlog/52-assainissement.md
- 81 · [bogue] Chiffres hors voile : vitesse max, sauts, surf, cadence et énergie sur les trous de trace (Q34, Q41 à Q43) · noté 28/10 · petit · Opus/high · dépend de : Q34, 57, 70 · détail : docs/backlog/52-assainissement.md
- 82 · [dette] Planification : doublons internes, profil envoyé une seule fois, revêtement aligné (Q47) · noté 28/10 · petit · Sonnet/high · dépend de : 57 (levé) · détail : docs/backlog/52-assainissement.md
- 83 · [bogue] Enregistrer et Profil : à 115 et 130 % de taille de texte, au téléphone étroit (320 à 390 px), la rangée « Famille » d'Enregistrer et « Période » de Profil défile au lieu de tenir sur la largeur (relevé de tailles.mjs le 29/10) · noté 29/10 · petit · Sonnet/medium
- 84 · [dette] Suites du lot 54 : un `.tmp` resté dans en-attente/ n'est jamais repris ni nettoyé (plantage entre l'effacement de la cible et le renommage : session perdue, cas rarissime) ; le GPX complet (sessionBundle, export et import) perd encore les champs de fiche illisibles ; un GPX de 0 octet du dossier du navigateur reste listé « illisible »  · noté 29/10 · petit · Opus/medium
- 91 · [outil] Banc : scripts à remettre d'aplomb, échecs anciens identiques avant et après la reprise du 29/10 : test-fcmax (18 : tuiles et adresse « /fractionne/seances » périmées), marche (4, application passée en version 9 avec « Muscu »), glisser (4), satellite (2), partage, reglages-aide (« textes courts »), prereglages, test-fcrepos (« courbe du test gardé affichée »), onglets (« Voile : tous montrés, tops et sauts compris ») ; library3 (expression de page cassée, rend undefined) ; brouillon-voile (contrôle « B n'affiche jamais le vent de A » intermittent des deux côtés) ; recherche-sans-reponse.mjs à finir (étapes, délais réseau de 30 et 120 s) ; idée : ouvrir un AudioContext dans connect() quand TEMPS > 1 (le premier coûte 600 ms réels, 6 s de page à ×10) · noté 29/10 · petit · Sonnet/medium · à briefer
- 92 · [outil] Banc : le passage courant est plafonné par tailles.mjs (7 min sur 8, transitions CSS relevées) ; le laisser de côté par défaut quand le lot ne touche ni mise en page ni réglages (un passage tiendrait en 2 min), et le garder par --pages ou par son nom · noté 29/10 · petit · Sonnet/medium · à briefer

## Questions

- Q29 · lot 28 · FC moyenne dans Général, bip en sortie de zone, énergie par la FC en voile et surf, splits par kilomètre : lesquels ? · par défaut : FC moyenne dans Général d'abord · posée le 28/10 · tranchée par défaut à la revue du 25/11 sans réponse
- Q32 · lot 78 · Écrire partout « 12,4 km » (virgule) et « 1 h 24 » (avec espaces), au lieu du mélange actuel (virgule dans Profil et Statistiques, point et deux décimales dans la bibliothèque et les analyses ; « 1h24 » et « 1 h 24 » sur la même page Profil) ? · par défaut : oui aux deux · posée le 28/10
