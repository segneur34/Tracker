# 212 · Fin d'enregistrement = analyse

## Voulu (10/11, redemandé le 11/11)

« Changement de philosophie : fin d'enregistrement = analyse, sans avoir à passer par analyser ou jeter ; si jeter il doit y avoir, ça doit être depuis la page analyse. »
- Dès « Finir », la trace est rangée dans la mémoire : plus d'état « pas encore rangée », plus de choix « Analyser » ou « Jeter ».
- Le matériel se choisit à ce moment-là, avant l'ouverture de l'analyse.
- « Jeter » n'existe plus que dans l'analyse : appui long d'une seconde, puis confirmation.
- « Analyser sans les capteurs » devient un message à l'ouverture de l'analyse.
- Contredit DECISIONS §6 (ligne 86) et §8 (ligne 41), lot 143 : remplacés à la passe doc, pas par l'agent `lot`.

Le lot 143 protégeait trois choses, à garder : la session interrompue qu'on récupère, la séance qu'on ne perd pas (journal effacé seulement une fois le GPX écrit), la capture des capteurs (illisible : rien n'est effacé).

## Aujourd'hui (plan de l'agent Plan, 11/11)

- `stopRecording` (`hooks/useRecorder.ts`, vers 1456-1514) écrit la ligne d'arrêt, construit la session (`buildPendingSession`, vers 595-634) et pose `state.pending` : GPX en mémoire, journal et capture `.imu` dans le dossier privé. Moins de 2 points : journal effacé, `nothingToKeep`.
- « Analyser » (`pages/RecordingPage.tsx`, vers 908-933) : question du fractionné par `window.confirm` (912), `analyzePendingSession` (688) → `rangePendingSession` (652-678) : lecture de la capture, `saveRecordedSession` (`hooks/sessionLibrary/importer.ts:34`), journal et capture effacés, `state.saved` ; matériel par `writeEndGear` (671, `updateSessionRecord`), puis `openSession`.
- Capture illisible : la session reste en attente, `motionUnreadable` (659) ; « Analyser sans les capteurs » (1312) range sans la capture, qui reste sur l'appareil.
- « Continuer l'enregistrement » (1317, `continuePendingSession`, 1216) : **n'apparaît jamais après un « Finir » normal** (`canContinue: false`, 618 et 633) ; seulement pour une session interrompue récupérée dont le journal a moins de 10 minutes et sans arrêt écrit (995-997, `recording/resume.ts:41`).
- « Télécharger le GPX » (1322) envoie `pending.content` ; « Jeter » (935, 702) efface journal et capture.
- Une fois rangée : carte « Session rangée » (1334-1377), Analyser, Télécharger, Fermer.

## Étape A : rangement dès « Finir » et écran de fin

- `useRecorder.ts` : `stopRecording` enchaîne `buildPendingSession` puis `rangePendingSession`, sous `analyzing` / `ranging` comme au lot 161 (le rangement tient si l'utilisateur quitte la page).
- Capture illisible : on range sans elle, la capture reste sur l'appareil, `saved` porte `motionLeft: { path }`.
- Échec d'écriture : seul cas où `pending` survit ; carte « Rangement impossible » avec Réessayer et Télécharger le GPX, journal gardé.
- Session interrompue récupérée : sans `canContinue`, rangée d'office à la reprise, carte « récupérée et rangée » avec le matériel et « Ouvrir l'analyse », sans ouverture automatique au lancement ; avec `canContinue`, la carte reste, non rangée, avec « Continuer l'enregistrement » et « Finir » (même chemin que l'arrêt). Ne pas ranger avant de continuer : les doublons se repèrent à l'instant de départ (`addSession.ts:142-185`), la session continuée passerait pour un doublon.
- Écran de fin (`RecordingPage.tsx`) : la carte « Session rangée » devient « Session terminée » : `SessionEndGear` y passe, la question du fractionné en choix sur la carte à la place du `confirm`, `SavedSessionShare`, bouton principal « Ouvrir l'analyse » ; matériel et fractionné écrits dans la fiche par `updateSessionRecord`. Rien à demander (pas de liste de matériel, pas de fractionné) : l'analyse s'ouvre directement.
- « Télécharger le GPX » ne reste que si la session n'a pas de fichier rangé (pas de dossier mémoire, navigateur sans mémoire).
- Retiré : `handleDiscard`, `discardPendingSession`, le bouton `withoutMotion`, `MOTION_UNREADABLE_MESSAGE`, les commentaires de tête qui décrivent l'ancien chemin.
- Tests : la partie capteurs de `useRecorder.test.ts` (vers 840-940) réécrite en « rangé sans capteurs, capture gardée » ; `useRecorder.resume.test.ts` (Continuer puis Finir) ; `addSession.test.ts` ; neufs : arrêt qui range et efface le journal, échec d'écriture qui garde le journal, `motionLeft`, session de moins de 2 points.
- Banc à réécrire (clic « Analyser ») : `bench`, `library`, `activite`, `allure-session`, `compteur-course` (question du fractionné), `materiel-fin`, `fluidite` (mesure 7) ; clic « Jeter » de nettoyage : `balises`, `carte-direct`, `denivele-direct`, `rendus` (la mémoire du banc se remplit : la vider par la bibliothèque) ; à revoir : `fractionne`, `gps-perdu`, `notes`, `notification`, `partage`, `test-fcmax`, `timer`, `trace-suivie`, puis `SCRIPTS.md`.

A se livre seul : « Supprimer » de la bibliothèque reste là pour jeter.

## Étape B : « Jeter » dans l'analyse et message des capteurs (après A et après le 207)

- « Jeter » : une entrée du menu « … » de `components/SessionNameEditor.tsx`, présent dans toutes les analyses par `AnalysisShell`. Appui long par `components/ui/HoldButton.tsx` (existe : anneau sous le doigt, rappel sur appui court), `getHoldMs={() => 1000}`, couleur de danger, icône corbeille à ajouter dans `icons.tsx`.
- `components/ui/MoreMenu.tsx` (vers 45) ferme le menu sur tout clic de bouton, ce qui couperait l'appui long : exception par un attribut (`data-keep-open`).
- Confirmation par `Dialog` (`components/ui/Dialog.tsx`), puis `removeSession(file)` (`hooks/sessionLibrary/sessionRecords.ts:108`, celui de `SessionLibrary.tsx`), `draft.cancel()` avant de partir (sinon l'alerte de brouillon), retour à la bibliothèque de la famille par `navigate(..., { replace: true })`. Rien pour une fiche en lecture seule.
- Message des capteurs : `saved.motionLeft` (étape A) porté jusqu'à l'analyse par l'état de l'enregistreur ; une petite pièce passée à `alerts` d'`AnalysisShell` affiche, pour ce fichier, « Mesures des capteurs illisibles » avec « Réessayer » : `readMotionCapture`, `saveRecordedSession` (le chemin des doublons ajoute le `.imu` absent, `motionAdded`, `addSession.ts:185-195`), `removeMotionCapture`, le tout par `useRecorder` (règle 12). Le message ne vit qu'en mémoire (perdu si l'application redémarre ; la capture reste sur l'appareil).
- Banc : script neuf `jeter-analyse.mjs` sur les quatre familles (appui court sans effet, session sortie de la liste après confirmation, aucune alerte de brouillon).

## Tranché

- Par l'utilisateur (10/11 et 11/11) : le voulu ci-dessus.
- Par l'orchestrateur (11/11), d'après le plan : ouverture directe de l'analyse quand rien n'est à demander ; question du fractionné sur l'écran de fin ; « Continuer » réservé à la session interrompue, seule à rester non rangée ; session récupérée trop ancienne rangée d'office ; lot coupé en A puis B.

## Essais au téléphone prévus

- Une vraie sortie avec capteurs : Finir, matériel, analyse.
- L'application tuée en cours d'enregistrement : Continuer, puis Finir.
