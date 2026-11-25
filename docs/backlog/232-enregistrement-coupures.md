# 232 · Enregistrement : les défauts corrigés dans Gtracker

## Tel que noté

25/11/2026 : « vas faire un tour dans Gtracker pour regarder les modif qu'on fait dedans, et qu'on pourrais ajouter a tracker », puis, sur la liste numérotée : « tout Enregistrement : défauts corrigés là-bas, pas ici » (points 1 à 7).

Source : Gtracker (`D:\gong tracker\Gtracker`, lecture seule), lu le 25/11 au commit ddc4281 ; voir un lot : `git -C "D:/gong tracker/Gtracker" show <commit>`. Reprise à la main, jamais par copie en bloc : là-bas le code n'a plus ni course, ni vélo, ni entraînement, ses textes passent par la traduction, et l'apparence est la sienne (rien de cela ne vient).

## Étape 1 : petits filets (Opus/high)

| Ce qui vient | Lots Gtracker | Aujourd'hui dans Tracker (vérifié le 25/11) |
|---|---|---|
| Après une coupure, « Continuer » reprend la ceinture du départ ; une ceinture qui ne revient pas s'annonce | 360 (4f49f04), 361 B (bc3b613) | « Continuer » (`continuePendingSession`, `src/hooks/useRecorder.ts`) relit le seul réglage de l'activité (`effectiveHeartRate`) |
| Après une coupure, la capture des capteurs reprend dans le même fichier ; calculs morceau par morceau, sans franchir la coupure | 361 A1 (f467894), A2 (bc3b613) | message `CAPTURE_NOT_RESUMED` : « la mesure ne reprend pas ». Ici la cadence à pied est concernée aussi |
| Calage du GPS au départ : la trace commence à 10 m près ou après 10 s ; cercle d'incertitude, « le GPS se cale (± N m) » | 417 (3a45f2b, 7cb00f8) | absent |
| Filets : caractère invisible retiré à l'écriture du GPX, journal relu avec un bloc en double, journal mis de côté repris ou rendu (sous-dossier « journaux »), session illisible jamais effacée, taille du texte changée en route, abonnés protégés | 396 (633d005, 3773a23) | `escapeXmlText` garde ces caractères, que le lecteur GPX refuse ensuite ; manifeste sans `fontScale`. Le garde-fou de 35 s de la ceinture existe déjà (`OPEN_GUARD_MS`) : à comparer |
| « Enregistrement interrompu à … » à l'ouverture de l'analyse ; saisies écrites avant de quitter (retour Android, croix du programme Windows) | 496 (56589ea) | absent. La part « arrêt seul sans bouger » va avec l'étape 2 |
| « Reprendre la ceinture », « Réessayer » et « Activer la localisation » pour le GPS, alerte si la batterie est restreinte, lien « Réglages » au bon bloc | 387 (ff74719, 3f69121), 408 (65018fd), 419 (63337be), 420, 433 (e4cd2ba), 518 (6007067), 530 (3260e7a) | « Arrêter de chercher » existe, le reste non |

## Étape 2 : service de position à nous (gros, Opus/high)

Lots 403 (42eedae, fe0ec2a, 7d9b050, b86a304, c974a5f) et 415 (33263c2) : l'enregistrement continue application balayée hors des « récentes », rattrapage à la réouverture, GPS repris quand la localisation est rallumée. **D'abord un essai sur Tracker** : que fait-il aujourd'hui une fois balayé ? (non vérifié ; le greffon `@capgo/background-geolocation` a un mode qui continue.)

Limites laissées là-bas (éléments 411, 412 et 380 de son reste à faire) : trou de FC et de capteurs application fermée ; cas « ceinture éteinte puis Continuer » jamais joué.

Propre à Tracker, sans modèle là-bas : `HeartRateService`, `IntervalTimerService`, muscu et nuit sans position, compteur d'intervalles, zone cardio visée. Tout cela doit survivre au changement de service.

## Contradictions, réponse par défaut

- DECISIONS §6 : « Positions par `@capgo/background-geolocation` ; repli sur Capawesome ». Défaut : le service maison le remplace, à réécrire à la passe doc.
- Ligne « Démarrage automatique » de la carte des autorisations. Défaut : comme Gtracker (Xiaomi seulement, état lu si possible).
