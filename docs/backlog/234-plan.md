# 234 · Plan (agent Plan, 25/11) et choix tranchés

Brief : `docs/backlog/234-analyses-reprises.md`. Source : Gtracker (`D:\gong tracker\Gtracker`, lecture seule), commits cités par partie.

## Contexte

Tracker n'a ni `revealTab` ni tuile qui ouvre un onglet. Les cases virements, empannages et indécis sont trois `useState` de `src/pages/SailingModule.tsx`. Le brouillon vit dans une `Map` de `src/hooks/useSessionDraft.ts` et n'est écrit nulle part ; `flushBeforeExit` (lot 232 B, `src/hooks/sessionLibrary/lifecycle.ts`) vide les fiches, les réglages et le stockage, pas les brouillons. Le pumping est fermé par défaut et seul « oui » est rangé (`src/settings/activitySettings.ts`).

Ordre : partie 2, puis 3, puis 1, puis 4. Un seul commit. La partie 5 (espaces et carte bord à bord) attend une planche montrée à l'utilisateur : elle n'est pas codée ici.

## Partie 2 · Fermer un onglet efface ce qu'il dessinait sur la carte (Gtracker e6919ae)

- `src/core/analysisTabs.ts` : `keepOpenTabEntries(entries, open)`, fonction pure.
- `src/hooks/useMapHighlight.ts` : cases cumulables `toggled(panel, key)` et `toggle(panel, key)`, élaguées pendant le rendu comme `shown`.
- `src/pages/SailingModule.tsx` : `maneuversOnMap` lit `highlight.toggled('manoeuvres', 'tack' | 'jibe' | 'undecided')` ; les trois `useState` partent ; l'interface `ManeuversOnMap` ne change pas.
- À relever dans `LandModule.tsx` et `SurfModule.tsx` : tout dessin sur la carte tenu hors de `useMapHighlight` (le sens des vagues du lot 233c dépend déjà de `open.rame`).
- Tests : `analysisTabs.test.ts`. Banc : `bench.mjs` gagne les contrôles d'e6919ae ; `onglets`, `general`, `zoom-carte` identiques.

## Partie 3 · Tuiles de sauts et de pumping dans « général », pumping coché d'office en surf (Gtracker 2322dc8, 8d6fbaa)

- `src/library/shareStats.ts` : `jumpTiles(jumps)` et `pumpingTiles(pumpSummary)`, clés `jumps`, `highestJump`, `pumpCadence`, `pumpShare` ; l'image de partage ne change pas (ne pas confondre avec `pumpingShare` de `shareExtraStats`).
- `SailingModule.tsx` : tuiles après `jibes`, avant la FC ; paires `['tacks','jibes']`, `['jumps','highestJump']`, `['pumpCadence','pumpShare']` ; `useSessionPumping` lu aussi quand « général » est ouvert et l'onglet pumping montré ; sauts par `useShownJumps`, seulement prêts.
- `SurfModule.tsx` : les deux tuiles de pumping après les vols.
- `src/settings/activityPresets.ts` : `pumping: true` sur le calcul surf ; `src/settings/activitySettings.ts` : `resolvePumping` (ce qui est rangé, sinon le pré-réglage, sinon non), seul l'écart au défaut est rangé (décocher range « non »).
- `PRESET_RESETS` : aucun effacement, `PRESETS_VERSION` inchangé (les anciens réglages ne portent que des « oui »).
- Tests : `shareStats.test.ts`, `activityPresets.test.ts`, `activitySettings.test.ts`. Banc : `pumping.mjs` et `sauts.mjs` adaptés, `prereglages.mjs` et `reglages.mjs` rejoués.

## Partie 1 · Une tuile de « général » ouvre et ferme son onglet (Gtracker bea11d1, 5a654be, fe1a855)

- `src/core/analysisTabs.ts` : `revealTab`, `isTabOpenOnScreen`, `toggleTabFromTile`, `tileTab`, `tabAnchorId`, `panelNeedsScroll`, et les tables `SAILING_TILE_TABS`, `FLIGHT_TILE_TABS`, `SURF_TILE_TABS`, `LAND_TILE_TABS`. Clés en chaînes : aucun import de `running/`, `cycling/` ni `land/` (règle 13).
- `src/hooks/useAnalysisTabs.ts` : `toggleFromGeneral(key)` et le défilement vers le panneau.
- `src/components/ui/StatTile.tsx` : en option `onToggle` et `expanded` (vrai bouton, `aria-expanded`, chevron de `components/icons.tsx`) ; `src/components/GeneralStats.tsx` : en option `tabOf`, `isOpen`, `onToggle`.
- `ResizablePanel` : ancre `an-onglet-<clé>` (prop `anchorId` s'il manque), sans changer l'`id`.
- `src/pages/analysisMobile.css` : fond à peine teinté sur la tuile reliée, par une variable de `src/theme/tokens.css`.
- Pages : `SailingModule`, `SurfModule`, `LandModule`.
- Tests : `analysisTabs.test.ts`. Banc : contrôles de Gtracker repris dans `general.mjs` et `onglets.mjs`, avec un cas course et un cas vélo.

## Partie 4 · Le brouillon survit à la fermeture de l'application (Gtracker c223e5f)

- À créer : `src/library/sessionDrafts.ts`, pur (lire, écrire, fusionner deux onglets du navigateur, `withSessionDraft`, `draftsOfMissingSessions`, chaque champ relu par les validations de `record.ts`) ; `src/hooks/sessionDraftStore.ts`, magasin sur `jsonStore` de `src/platform/storage.ts` (règle 12), écriture 1 s après la dernière saisie et aussitôt quand l'application passe en arrière-plan.
- `useSessionDraft.ts` : la `Map` devient le magasin ; rien n'est relu avant que la session soit chargée ; un GPX ouvert hors de la mémoire reste en mémoire seule.
- `lifecycle.ts` : `flushBeforeExit` vide aussi le magasin ; après la lecture complète du dossier, seuls restent les brouillons de ses sessions. `sessionRecords.ts` : une session supprimée perd son brouillon.
- Tous les champs de `SessionEdits` suivent d'office (poids du vélo, charge, notes, repères) : les quatre modules passent par `useSessionDraft`.
- Tests : `sessionDrafts.test.ts`, `sessionDraftStore.test.ts` (horloge injectée, deux onglets), aller-retour dans `sessionEdits.test.ts`, `useSessionLibrary.perte.test.ts`. Banc : `brouillon-voile.mjs` (page rechargée, le brouillon revient, « Annuler » le retire), et le même avec le poids du vélo (`charge.mjs` ou `session-save.mjs`).

## Partie 5 · Planche seulement

Carte bord à bord au téléphone droit (marge négative sur la rangée de la carte, coins carrés, Gtracker f5caadd) ; cadres plus rapprochés par deux variables neuves de `tokens.css` (6 px entre cadres, 10 px entre sections, Gtracker c39cd8c), dans `analysisMobile.css` et `ProfilePage.css`. À montrer avant/après à 390 px : analyses voile, surf, course, vélo, fractionné (« général » et un onglet) et Profil.

## Recouvrements

Aucun fichier commun avec le sous-lot 232 C. `SettingsPage.tsx` n'est pas à toucher.

## Tranché par l'orchestrateur le 25/11

L'utilisateur a demandé « tout Analyses » d'après Gtracker, où ces règles ont été réglées avec lui.
- Tuile → onglet hors voile et surf : « Meilleur(e)s » ouvre tops, Dénivelé les zones de pente, FC moyenne le cardio, Cadence la cadence, Dépense l'énergie ; distance, temps et moyenne restent de simples blocs. Une tuile n'est reliée que si son onglet est montré pour l'activité.
- Brouillon gardé : la confirmation en quittant l'analyse reste (décision « un brouillon non enregistré demande toujours confirmation ») ; à la réouverture il revient avec la barre « Non enregistré ».
- Les anciennes sessions de surf foil sans réglage propre montrent désormais le pumping si elles ont une capture (c'est l'effet demandé de « coché d'office »).
- Clé de stockage `tracker.brouillons`, délai d'écriture 1 s, tables des tuiles dans `core/analysisTabs.ts`, `MuscuModule` laissé de côté.

## À vérifier en passant

Onglets retrouvés ouverts par `outils/banc/surf.mjs` à 390 px : très probablement un artefact du script (`go()` abandonne en silence après 5 s si la page ne change pas ; l'état des onglets n'est qu'un `useState`, rangé nulle part). À confirmer en relevant les onglets juste après le `go()` de la partie téléphone.

## Partie 5 · Choisi par l'utilisateur le 26/11, sur la planche (https://claude.ai/artifact/1GVnTbubfYoS96dwkZp5S3)

Réponse : « espace entre les lignes le plus petit, du coup C ». Retenu : le réglage C de la planche (carte d'un bord à l'autre de l'écran au téléphone droit, 8 px entre deux cadres, 14 px entre deux blocs). À confirmer avant de coder : « le plus petit » désignerait plutôt le réglage B (6 et 10 px) ; la lettre donnée est C. La carte d'un bord à l'autre est commune à B et à C.

Le prototype CSS (derrière l'attribut `data-proto-espaces`) est gardé, non commité, dans la copie `.claude/worktrees/planche-234` : variables `--proto-gap-cadres` et `--proto-gap-sections` dans `tokens.css`, règles en fin de `analysisMobile.css` et dans `ProfilePage.css`. À reprendre au propre (deux vraies variables d'espace, téléphone tourné inchangé, légende et mention de la carte à 10 px du bord), avec `docs/MISE_EN_PAGE.md` à accorder à la passe de doc. Relevé sur la planche : l'espace sous la carte (8 px) n'a pas été touché ; au Profil tout se rapproche (photo, période, bandes de chiffres) ; mode nuit et téléphone tourné non regardés.

Confirmé par l'utilisateur le 26/11 : c'est le réglage **B** (carte d'un bord à l'autre de l'écran au téléphone droit, 6 px entre deux cadres, 10 px entre deux blocs), pas C. Prêt à coder.
