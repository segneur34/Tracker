# 103 · Enregistrement avec compteur : proposer d'arrêter à la fin de la séance

Demande de l'utilisateur (30/10), réponse du 31/10 : **proposer seulement**, jamais d'arrêt seul ni de délai.

Aujourd'hui : quand la séance du compteur se termine pendant un enregistrement, l'écran « Séance terminée » de la carte du compteur (`CounterView`, `src/components/IntervalCard.tsx`, vers la ligne 118) n'offre que « Fermer » ; la session tourne jusqu'à « Arrêter ». Seul le sens inverse existe (le compteur s'arrête avec la session, DECISIONS §5).

À faire :
- Sur l'écran « Séance terminée » (statut `finished` seulement, pas « Séance arrêtée »), quand un enregistrement tourne (`recording`, ni en Timer seul), ajouter un bouton « Arrêter l'enregistrement » à côté de « Fermer ». Vaut pour Muscu et timer › Enregistrer comme pour le fractionné GPS (même carte).
- Ce bouton mène au même arrêt que le bouton « Arrêter » de la page Enregistrer, avec le même geste de sécurité (tenu, comme lui, tranché par l'orchestrateur : un appui bref par mégarde ne doit pas couper une session) et le même écran « Session terminée » ensuite (enregistrer ou jeter). Réutiliser le chemin d'arrêt existant de `RecordingPage` / `useRecorder` (passer un rappel à `IntervalCard`, ou la pièce du bouton tenu si elle est partagée) ; aucune nouvelle façon d'arrêter, rien de changé aux données enregistrées.
- Sans enregistrement en cours (Timer seul), rien ne change.
- Lire DECISIONS §5 (Fractionné) et §6 (Enregistrement) avant ; y ajouter une phrase en §5 : à la fin d'une séance pendant un enregistrement, l'écran « Séance terminée » propose d'arrêter l'enregistrement (31/10, lot 103), sans arrêt automatique.
- Mettre à jour le script du banc qui couvre « Enregistrer » d'une séance (`outils/banc/timer.mjs`, étape 4 bis, ou `compteur-course.mjs`) si une séance y va jusqu'à « terminée » pendant un enregistrement ; sinon y ajouter ce contrôle si c'est simple (séance courte).

Vérification : `npm run verif` ; banc `timer`, `compteur-course`, `muscu` ; essai au téléphone (séance courte en muscu enregistrée, bouton proposé à la fin).
