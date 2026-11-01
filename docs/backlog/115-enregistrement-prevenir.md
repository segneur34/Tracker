# 115 · Enregistrement : prévenir quand le GPS, la ceinture ou les capteurs ratent

Brief écrit le 01/11 d'après l'audit en lecture seule du même jour. Modèle | Réflexion : Opus | high. Touche l'enregistrement et le code natif : plan par l'agent `Plan` d'abord.

## Le fait

L'enregistreur est solide sur ses commandes (verrou départ, pause, reprise, arrêt ; journal par ajout ; reprise au lancement), mais il se tait quand quelque chose rate en route. Lignes relevées par l'audit, à revérifier :

- **GPS perdu jamais signalé** : `hooks/useRecorder.ts:264` et `platform/location.ts:153-179`. Seule une erreur du greffon GPS remonte (`onSourceError`), et le greffon n'en émet aucune quand la localisation est coupée ou que le GPS se tait (relance muette toutes les 60 s côté natif). Rien ne compare l'heure de la dernière position reçue à l'heure courante. La notification garde la distance figée, le chronomètre d'Android tourne : l'utilisateur découvre le trou à l'arrêt.
- **Ceinture cochée mais jamais trouvée** : `HeartRatePlugin.java:665-668`. Une ceinture jamais jointe depuis `connect` est recherchée toutes les 10 s (`RELOCATE_PAUSE_MS`) pendant toute la session, recherche Bluetooth en mode gourmand comprise. Seule une ceinture perdue après jonction voit ses essais s'espacer (`LOST_RETRY_MS` 10 s, puis `LOST_RETRY_SLOW_MS` 30 s passé `LOST_FAST_MS`).
- **Bips d'approche d'une balise** : `hooks/useMarkGuide.ts:68-77`. Le rythme est tenu par `BeeperPlugin.java` entre deux positions : si le GPS se tait, les bips continuent au dernier rythme, sur une distance périmée. Les commentaires l. 26-27 et 155 disent encore « GPS coupé en pause manuelle », faux depuis le lot 104.
- **Erreurs avalées** : `useRecorder.ts:728`, `:747`, `:760`, un échec de la pause ou de la reprise de la capture des capteurs est ignoré (plus de sauts ni de cadence jusqu'à l'arrêt, sans message) ; `hooks/recordingNotification.ts:117`, notifications refusées (Android 13 et plus) : rien ne le dit pendant l'enregistrement.
- **Journal** : `useRecorder.ts:269-281`, le tampon est vidé avant l'écriture ; une écriture qui échoue perd ses lignes, sans nouvel essai. Ne compte qu'après un plantage (le GPX est construit depuis la mémoire), mais laisse un journal troué.

## Décisions de l'utilisateur (01/11)

- **GPS perdu** : alerte rouge déjà présente sur la page Enregistrer (`ui-alert--danger`, `state.error`, effacée à la position suivante comme `sourceError`), « GPS perdu » dans la notification, et un **son spécifique**, distinct de tous les sons existants (zone cardio, balises, compteur, tests). **Rare** : seulement après **au moins 1 min** sans position, et **pas souvent** : un seul signal par perte, aucun rappel ; une nouvelle alerte seulement si le GPS est revenu un moment (2 min par défaut) puis s'est de nouveau tu 1 min. Tout s'efface seul au retour du GPS.
- **Ceinture jamais trouvée** : espacer les recherches comme pour une ceinture perdue (rapprochées les premières minutes, puis toutes les 30 s passé 5 min). Elle se connecte encore si l'utilisateur la met en route.

## À faire

1. **GPS perdu** : délai (60 s) et réarmement (120 s) dans `RecordingProfile` (`core/sportProfiles.ts`, règle 3), lus comme les autres champs ; pas de détection en pause manuelle, ni sans GPS (muscu, `heartOnly`). La détection doit marcher **écran éteint**, où les minuteurs du WebView ralentissent (lot 104) : piste, un minuteur natif repoussé à chaque position (par `BeeperPlugin` ou le greffon de la notification), qui joue le son et récrit la notification s'il échoit ; à trancher au plan. `distanceFilterM` vaut 0 partout : un filtre de distance rendrait l'immobilité muette, à prendre en compte si un profil en prend un. Son neuf dans `core/beepDurations.ts` et `TonePlayer.java`, motif nettement différent des bips brefs (n° 88).
2. **Ceinture** : dans `HeartRatePlugin.java`, la branche « jamais jointe » de `dropped()` suit le même espacement que la ceinture perdue, compté depuis `connect` ; l'état « searching » reste montré.
3. **Balises** : le guidage se tait pendant une perte du GPS (même détection) et reprend à la position suivante ; corriger les commentaires périmés de `useMarkGuide.ts`.
4. **Erreurs avalées** : un échec de pause ou de reprise de la capture passe par `state.error` (« Capteurs : reprise impossible, sauts et cadence arrêtés ») ; notifications refusées pendant un enregistrement : une phrase dans la même alerte, une fois. Pas de disposition neuve : l'alerte existante suffit, pas de maquette.
5. **Journal** : des lignes dont l'écriture échoue sont remises en tête du tampon et repartent à l'écriture suivante.

Tests purs sur la détection (perte à 59 s et 61 s, un seul signal, réarmement, pause manuelle, trace à 1 Hz et 5 Hz pareilles) et sur le journal ; `npm run verif` ; banc sur la page Enregistrer (rejeu avec un trou de 90 s : l'alerte apparaît puis s'efface).

## Essais au téléphone à prévoir

- Couper la localisation 1 min 30 en cours d'enregistrement, écran éteint, puis la rallumer → le son « GPS perdu » une seule fois après 1 min, distinct des autres ; notification « GPS perdu » ; tout s'efface au retour.
- Case « Ceinture cardio » cochée, ceinture laissée à la maison, 10 min d'enregistrement → aucune gêne ; le journal de la ceinture montre des recherches espacées après 5 min.
- Pendant un enregistrement, balayer l'appli hors des applications récentes, attendre 1 min, la rouvrir → savoir si l'enregistrement a continué. D'après l'audit, le greffon GPS arrête son service quand l'appli est fermée (`BackgroundGeolocation.java:1032`) et la session ne revient qu'au relancement : si c'est confirmé, nouveau `[bogue]` en tête d'Ensuite (au moins le dire, au mieux continuer).

## Ce que le lot ne fait pas

Pas de commit, pas de version, aucune décision de produit au-delà de celles ci-dessus. Ne pas toucher au greffon GPS tiers. Rien dans `docs/` hors ce fichier.
