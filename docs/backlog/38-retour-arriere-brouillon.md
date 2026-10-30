# 38 · Brouillon de session : le retour arrière du navigateur demande confirmation comme les autres sorties

Sonnet | high (le comportement est éprouvé par un script du banc, et l'historique du navigateur est piégeux). Brief écrit le 30/10 par l'orchestrateur d'après la ligne 38 de `docs/BACKLOG.md`, ETAT §9 « Brouillon de session » et HISTORIQUE point 178.

## La décision (déjà prise)

Dans une analyse, les changements non enregistrés (vent saisi, seuil, couleurs, notes, matériel…) restent en brouillon jusqu'à « Enregistrer la session », et quitter la page demande confirmation (`CLAUDE.md`, « Session : … Annuler, avertissement en quittant »). Aujourd'hui l'avertissement couvre les liens internes, la touche retour d'Android et la fermeture de l'onglet, mais pas le retour arrière du navigateur (bouton « précédent » de Firefox ou Chrome sur le PC, geste de retour dans le navigateur du téléphone) : il quitte sans prévenir, et le brouillon n'est retrouvé qu'en revenant sur la session. Voulu : le retour arrière demande la même confirmation ; refusée, on reste sur la page et le brouillon est intact ; acceptée, on part et le brouillon est abandonné, comme pour un lien.

## Ce qui existe

- `src/hooks/leaveGuard.ts` : `confirmLeave` (`window.confirm` sur le message courant, puis `discard`), `installLeaveGuard` (clics sur les liens internes en phase de capture, `beforeunload`), `useLeaveWarning` ; le commentaire des lignes 11-12 dit que le retour arrière passe. Branché par `src/hooks/useSessionDraft.ts:105-116` (`leaveWarning` quand `dirty && savable`).
- Retour d'Android : `src/platform/backButton.ts` (`installBackButton`, `dispatchBack(canLeave)`), relié à `confirmLeave` dans `src/main.tsx:71-73` ; la page au-dessus se rejoint par `navigate(to, { replace: true })` (`src/components/AppShell.tsx:169`), l'historique n'y sert pas. `useLibraryNavigation.ts:52` appelle `confirmLeave` avant de changer de session.
- Routeur : `react-router-dom` 7 avec `BrowserRouter` : `useBlocker` n'est pas disponible (il demande un routeur de données), et changer de routeur n'est pas dans ce lot.
- Banc : `outils/banc/session-save.mjs`, étape 8 « Brouillon gardé après un retour arrière du navigateur » (lignes 160-173 : `history.back()`, puis `history.forward()`, le brouillon est retrouvé), étape 9 « Retour à la liste accepté : brouillon abandonné » (lien, `confirm` accepté).

## À faire

1. Intercepter le retour arrière dans `leaveGuard.ts`, par l'historique, sans toucher au routeur : quand un avertissement est posé (`useLeaveWarning` reçoit un message), pousser une entrée d'historique « garde » sur la même adresse (`history.pushState({ leaveGuard: true }, '', location.href)`) ; sur `popstate`, si un avertissement est en cours : `confirmLeave()` ; refusé → repousser l'entrée garde (on reste, le routeur n'a pas changé de page puisque l'adresse est la même) ; accepté → l'avertissement est levé et le brouillon abandonné, puis `history.back()` une fois de plus pour partir vraiment. Quand l'avertissement est levé autrement (Enregistrer, Annuler, départ par un lien), retirer l'entrée garde si elle est en tête (`history.state?.leaveGuard` → `history.back()`), pour ne pas laisser un retour « à vide ». Attention aux cas : avertissement posé puis levé puis reposé (une seule entrée garde à la fois) ; `popstate` déclenché par le retrait de l'entrée garde (ne pas le prendre pour une sortie) ; `BrowserRouter` écoute aussi `popstate` et relit l'adresse (identique, donc sans effet) ; retour d'Android inchangé (il ne passe pas par `popstate`). Si une approche plus simple et aussi sûre existe, la préférer et l'expliquer.
2. Isoler la logique pure (états : garde posée ou non, popstate reçu, réponse à la confirmation → actions sur l'historique) dans une petite fonction ou classe testable sans navigateur, avec un adaptateur d'historique injecté (`pushState`, `back`, `state`), et son `leaveGuard.test.ts` (environnement node : pas de jsdom) : pose, refus, acceptation, levée propre, double pose, popstate de retrait.
3. Mettre à jour `outils/banc/session-save.mjs` : l'étape 8 devient « Retour arrière refusé : on reste, brouillon intact » (le `confirm` répond non comme pour l'avertissement déjà testé : voir comment le script fait répondre non à `confirm`, lignes voisines de « L'avertissement en quittant est refusé ») : `history.back()`, l'adresse reste `/voile/analyse`, le commentaire est toujours là, la barre dit « Non enregistré » ; puis une étape « Retour arrière accepté : brouillon abandonné » si le script peut faire répondre oui (sinon la laisser à l'étape 9 par le lien, inchangée). Le relevé « avant » de ce script échouera à la nouvelle étape : c'est attendu, le rapport le dit.
4. Corriger le commentaire de `leaveGuard.ts` (lignes 7-12) : le retour arrière est couvert.

## Garde-fous

- Règle 12 : rien de `window` hors de ce qui s'y trouve déjà (`history`, `confirm` sont acceptés ici, comme `beforeunload` l'est).
- Ne pas changer le retour d'Android ni `parentPage` ; ne pas introduire `createBrowserRouter`.
- Dans l'application Android (WebView), l'historique existe aussi : la garde ne doit pas y casser le retour (qui passe par `dispatchBack`, pas par l'historique) ; relire `backButton.ts` pour s'en assurer et le dire dans le rapport.
- Pas de `docs/`, pas de commit, pas de version.

## Preuve

- `node outils/verif.mjs --rapide` avec le nouveau test.
- `node outils/banc/passe.mjs session-save --gpx <dossier> --avant HEAD --scripts-par-cote` (il faut un GPX de voile, `outils/banc/make-gpx.mjs` en écrit un) : étape 8 nouvelle qui passe après ; étapes 1 à 7 et 9 identiques.

## Rapport attendu

FAIT / BLOQUÉ / ÉCHEC ; approche retenue et pourquoi, cas piégeux vérifiés (double pose, levée, Android), résultat du script, fichiers touchés ; à dire : s'il y a lieu d'un essai au téléphone (geste de retour dans le navigateur du téléphone, pas l'application).
