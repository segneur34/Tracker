# 86 · Ceinture cardio : reprise seule au retour dans la portée

## Tel que noté (29/10, course de l'utilisateur, essai 1 raté)

Après une pause automatique, téléphone laissé à distance de la ceinture, l'application ne s'est jamais reconnectée à la ceinture. Une reprise seule, au retour dans la portée, est voulue.

## Où

`src/platform/heartRate.ts` (détenteurs `holdBelt` / `releaseBelt`, `keepBeltAlive`, état `BeltState`), `android/.../HeartRatePlugin.java` et `HeartRateService.java` (connexion GATT, service de premier plan), `src/hooks/useRecorder.ts` et la pause automatique (`src/recording/`), `src/hooks/useBeltWarmup.ts`, `src/components/BeltStatus.tsx`. À vérifier dans le code : qui lâche la ceinture (pause automatique ? perte du lien GATT ?) et si une reconnexion est seulement tentée.

## Voulu (DECISIONS §6 « Ceinture cardio »)

- Pendant tout l'enregistrement (pause automatique ou manuelle comprise), la ceinture cochée reste demandée : à chaque perte du lien, l'application retente seule, sans geste, aussi longtemps qu'il le faut, écran éteint compris (service de premier plan).
- Pendant la perte : trou dans la FC (jamais de valeur figée), état lisible (« recherche » ou équivalent existant) dans la tuile BPM.
- Au retour dans la portée, la FC revient d'elle-même en quelques secondes.
- Rien ne change hors enregistrement (Réglages › Capteurs : « Essayer » reste un geste, pas de connexion d'office).

## Contraintes

- Plateforme seulement par `src/platform/` (règle 12). Pas de seuil en dur : un délai de nouvelle tentative est une constante nommée et commentée.
- Préférer `autoConnect` / reconnexion GATT d'Android ou une boucle bornée dans le service natif, pour que ça marche écran éteint, plutôt qu'une boucle dans le JS.
- Ne pas toucher à l'écriture du GPX ni au journal, hors ce qu'il faut pour le trou.
- Test unitaire sur la partie pure (état de la ceinture, décision de retenter) si elle existe.

## Essai au téléphone

Essai 1 (déjà écrit sous le n° 26 en « Ça attend une occasion ») ; un essai court en plus dans Maintenant : ceinture portée, enregistrement lancé, s'éloigner du téléphone 1 à 2 min puis revenir → la FC revient seule.

## Vérification

`npm run verif` ; pas de banc (rien à voir dans le navigateur, la ceinture est native).

## Plan (agent Plan, 30/10) et choix tranchés par l'orchestrateur

Cause : rien ne lâche la ceinture côté JS (pause automatique ou manuelle) ; la relance dépend du seul greffon `HeartRatePlugin.java`, qui (1) abandonne pour toujours (`unsupported`) si une découverte de services échoue à la reprise, sans lire le statut ; (2) n'a que `autoConnect` comme relance, lent et capricieux pour une ceinture non appairée à adresse aléatoire ; (3) n'a aucun garde-fou si la connexion reste bloquée (découverte sans réponse, CCCD raté).

Tranché le 30/10 par l'orchestrateur (choix d'implémentation, aucun n'est de produit) :
- Relance par recherche filtrée puis ouverture directe (`locate`, `open(false)`) ; repli `open(true)` (`autoConnect`) toutes les 3 recherches sans résultat, pour une ceinture restée liée qui n'émet plus d'annonce. Pourquoi : rapide quand la ceinture revient, sans perdre le cas lié.
- `LOST_RETRY_MS` 10 s pendant les 5 premières minutes de perte, puis 30 s (batterie) ; `STALL_MS` 20 s sans aucune trame (une trame « contact faux » compte comme une trame : pas de boucle sur une ceinture retirée mais liée).
- `unsupported` réservé à une première jonction dont la découverte réussit sans service 0x180D ; une découverte en échec est une perte.
- Bluetooth éteint puis rallumé : repris dans ce lot (récepteur `ACTION_STATE_CHANGED`), c'est petit.
- Texte de la tuile pendant la perte : inchangé (« perdue, en attente de la ceinture »), décision §6 « équivalent existant ».
- Journal `TrackerHR` d'une ligne par tentative, pour qu'adb tranche si l'essai rate encore.
- Tests vitest dans `heartRate.test.ts` : `lost` ne retire pas le détenteur ni n'appelle `disconnect` ; `lost` puis une mesure → `connected` ; `latestHeartRate()` nul pendant `lost`.
