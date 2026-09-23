# Tracker : analyse de sessions sportives à partir de traces GPX

Application web 100 % client (React 19, TypeScript, Vite 8, Recharts, Leaflet). Pas de backend, pas de base de données : tout est en mémoire ou dans `localStorage`. Deux modules : voile (wingfoil, planche, kite, bateau) sur `/voile`, course à pied sur `/course`, plus une page Paramètres sur `/parametres`. Interface et code commentés en français.

L'état complet du projet, fichier par fichier, avec l'historique des décisions, est dans `docs/ETAT_DU_PROJET.md`. Le lire avant toute modification du noyau ou des analyses voile.

## Commandes

```
npm run dev          serveur de développement
npx tsc -b --force   typecheck (strict, noUnusedLocals, verbatimModuleSyntax)
npm run lint         oxlint
npx vitest run       186 tests, tous sur des fonctions pures, environnement node
npm run build        tsc -b && vite build
```

Après toute modification : typecheck, lint, tests, build, dans cet ordre. Tous doivent passer.

## Documentation : quand la mettre à jour

- `CLAUDE.md` : en fin de session seulement, et uniquement si une règle d'architecture ou une décision de l'utilisateur a changé. Il est chargé à chaque session, il doit rester court.
- `docs/ETAT_DU_PROJET.md` : une passe après chaque lot de travail que l'utilisateur a validé sur données réelles (« ça marche, on garde »), jamais entre deux modifications de code. Ne pas attendre la fin de session : sans git, ce document est la seule mémoire du projet, et le contexte d'une longue session est résumé avant la fin.
- Dans les deux cas, une passe = mettre à jour les sections touchées (inventaire, persistance, tests, dette, chantiers) et ajouter un point numéroté à l'historique §10 avec la date.

## Environnement, à connaître avant d'agir

- **Pas de dépôt git et git n'est pas installé sur la machine.** Aucun retour arrière possible autrement qu'en copiant `src/` avant un refactor risqué. Ne pas proposer `git init` sans avoir vérifié `git --version`.
- Windows 11. Le terminal de l'utilisateur est `cmd`, pas PowerShell : ne pas lui donner de commandes PowerShell à recopier. Il arrive qu'il exécute lui-même les commandes et colle la sortie.
- L'utilisateur consulte parfois un autre modèle (Gemini) pour les questions d'algorithmique. Quand une question de logique se pose, la formuler de façon autonome et complète pour qu'il puisse la transmettre.
- Il n'y a aucun fichier GPX de test dans le projet. Les tests utilisent des traces synthétiques. La validation sur données réelles se fait par l'utilisateur.

## Règles d'architecture

1. **Le noyau `src/core/` travaille en unités SI** : m/s, mètres, secondes ou millisecondes, caps en degrés. La conversion vers l'unité d'affichage se fait uniquement en sortie, via `core/units.ts` et le profil du support (`core/sportProfiles.ts`). Ne jamais réintroduire de nœuds dans le noyau.
2. **Toutes les fenêtres sont en secondes, jamais en nombre de points.** Une trace à 1 Hz et une trace à 5 Hz doivent donner le même résultat. Des tests le vérifient.
3. **Aucun seuil n'est codé en dur dans les fonctions de calcul.** Les seuils viennent des profils (`SPORT_PROFILES`) et sont passés en paramètre ; l'utilisateur peut les surcharger, et la surcharge est persistée. Le seuil d'activité de 8 nœuds n'est valable qu'en wingfoil.
4. **Un seuil de vitesse en voile s'accorde à l'allure de la session**, déduite de la trace (`core/sessionSpeed.ts`, neuvième décile pondéré par la durée) et surchargeable. Les valeurs des profils sont des plafonds : la mise à l'échelle ne peut qu'abaisser un seuil, jamais l'ouvrir, ce qui garantit qu'une trace rapide ne change pas. Elle est appliquée **dans les hooks**, jamais par défaut dans les fonctions de calcul, pour que les tests restent neutres. Une exigence en nœuds absolus est une valeur de wingfoil : sur une session de planche à 4,4 nœuds, elle écarte tout. Préférer partout un rapport sans dimension — c'est ainsi que se juge le vol perdu d'une manœuvre (conservation de vitesse, et non nœuds).
5. **Les analyses voile travaillent en nœuds sur `PointData`** (`src/utils/kinematics.ts`, adaptateur `trackToPointData`). C'est un héritage assumé : ne pas convertir `sailing/*` en m/s sans plan dédié.
6. **La distance est l'intégrale de la vitesse retenue** (`core/sessionStats.ts`, `segmentDistanceM`), pas la distance annoncée par le fichier GPX ni une somme de Haversine brute.
7. **Le vent, dans l'onglet vent, vient des manœuvres**, de toutes celles que la détection a classées, virements et empannages, réussis ou non. Les statistiques sont pondérées par la symétrie de chaque virage (`sailing/sailingAnalytics.ts`, `calculateWindStats`) : on ne filtre pas, on accorde moins de confiance. Les caps stabilisés ne sont plus un critère d'exclusion, seulement un indicateur de qualité — ils restent en revanche la source de l'estimation globale (`windSamplesFrom`), qui ancre tout le reste. Le vent local d'une manœuvre se lit à la **bissectrice** du virage. La « polaire glissante » a été essayée et retirée à la demande de l'utilisateur, et la corde entrée → sortie a été essayée comme second estimateur puis retirée après comparaison sur trace réelle : les deux lectures ne se départagent pas, l'écart entre elles ne pouvant venir que de l'asymétrie du virage, qu'aucune des deux ne corrige. Ne réintroduire ni l'une ni l'autre. La polaire ne sert qu'à l'estimation globale, affinée par les manœuvres (`sailing/maneuvers.ts`, `estimateWind`).
8. **Le lecteur GPX est maison** (`core/gpxParser.ts`, DOMParser). La librairie `gpxparser` a été retirée parce qu'elle n'exposait pas les extensions (vitesse Doppler, FC, cadence). Ne pas la réinstaller.
9. **Chaque module reprend uniquement les supports qu'il accepte** (`useSportSettings(defaultSport, allowedSports)`). Un bug de fuite du support wingfoil vers le module course a déjà coûté cher.
10. **Toutes les traces ne sont pas enregistrées à cadence fixe.** Une application de randonnée pose un point quand on se déplace et se tait quand on ralentit : un virage entier peut tenir dans un seul intervalle. Ne jamais supposer qu'une fenêtre de quelques secondes contient plusieurs points, ni qu'un virage se lit sur plusieurs pas.

## Carte des dossiers

```
src/core/        noyau générique : types, unités, profils, parseur GPX, kinématique, filtres, allure et cadence d'une session (sessionSpeed), cumuls, masque d'activité, dénivelé, meilleurs segments, dégradé de couleur (speedGradient), constantes d'affichage (displayConfig)
src/sailing/     extension voile : config, vent, manœuvres, VMG, stats, notes de session
src/running/     extension course : pente, zones, allures
src/hooks/       état React : ingestion GPX, session voile, réglages, notes, profil coureur, sections
src/pages/       Home, SailingModule, RunningModule, SettingsPage
src/components/  ModuleNav, SectionTabs, ResizablePanel, MapAutoResize, SpeedGradientLegend (légende + saisie des bornes), chartHover (survol graphe → carte), styles
src/utils/       kinematics.ts : adaptateur nœuds (PointData) encore utilisé par sailing/
src/types/       sailing.ts : SessionStats voile
```

## Où ajouter quoi

- Un support à voile : une entrée dans `SPORT_PROFILES` et dans `SAILING_SPORTS` (`core/sportProfiles.ts`).
- Un réglage utilisateur : `StoredSettings` dans `hooks/useSportSettings.ts`, puis `useAllSportSettings` et `pages/SettingsPage.tsx`.
- Une section dans un module : `RUNNING_SECTIONS` / `RUNNING_SECTION_DEFAULTS` dans `pages/RunningModule.tsx`, ou `SAILING_SECTIONS` / `SAILING_SECTION_DEFAULTS` dans `pages/SailingModule.tsx` (onglets du haut), et un bloc `{open.cle && ...}` dans le rendu. Envelopper le bloc dans `ResizablePanel` avec un `id` unique. En voile, la colonne à droite de la carte a son propre groupe, même mécanisme : `SAILING_CARTE_PANELS` / `SAILING_CARTE_PANEL_DEFAULTS`, `useOpenSections('sailing-carte', ...)`.
- Un graphe relié à la carte : chaque ligne de données porte l'`index` du point de trace, et `onMouseMove` passe par `hoveredTrackIndex` (`components/chartHover.ts`). Pas de `any` dans les pages.
- Une métrique de manœuvre : `ManeuverLocation` dans `sailing/maneuvers.ts`, puis `MANEUVER_METRICS` et `summarizeManeuvers` dans `sailing/sailingAnalytics.ts`.
- Un calcul pur : dans `core/`, `sailing/` ou `running/`, avec un fichier `*.test.ts` à côté, sur une trace synthétique.

## Décisions prises par l'utilisateur, à respecter

- Couleur de la trace, dans les deux modules : échelle absolue, dégradé continu (`core/speedGradient.ts`), gris sous la borne basse, rouge à la borne haute, bornes réglables par support dans la légende (`SpeedGradientLegend`). Course : 4 à 15 km/h. Voile : 8 à 28 nœuds par défaut si la trace est trop courte pour mesurer un pic. Pas d'échelle relative à la moyenne, pas de paliers.
- En voile, le seuil d'activité et les bornes de couleur ne sont plus des constantes fixes par support mais suggérés à partir de l'allure de la session (`sailing/sailingConfig.ts`, `suggestActiveThresholdKn`/`suggestSpeedRangeMs`) : allure > 12 nœuds → défaut du profil (sauf le bateau, toujours 1 nœud) ; allure ≤ 12 nœuds → 1 nœud ; borne haute de couleur = pic de vitesse sur une fenêtre glissante de 2 s + 1 nœud. La surcharge manuelle de l'utilisateur, persistée, prime toujours sur la suggestion.
- Courbe du vent : elle couvre toute la session, en gardant la valeur la plus proche avant la première et après la dernière manœuvre, et s'interrompt au-delà de 30 minutes sans manœuvre. Elle passe par **toutes** les manœuvres, sans exception : n'en retenir qu'une sur cinq, faute de caps stabilisés, a été jugé inacceptable sur trace réelle.
- L'estimation du vent utilise le seuil d'activité **effectif**, surcharge de l'utilisateur comprise, et non le seul défaut du profil : une seule notion de « réussite » dans toute l'application. Contrepartie acceptée, bouger le curseur de seuil recalcule le vent.
- Mode « superposés » des graphes course : deux axes (vitesse à gauche, altitude à droite), demandé explicitement malgré la difficulté de lecture.
- Section manœuvres du module voile : petit tableau par défaut, détails dépliés par un bouton.
- Les blocs, tableaux, graphes et cartes doivent être redimensionnables (`ResizablePanel`), taille mémorisée.
- Module voile : carte à 60 % de large, redimensionnable en largeur comme tout le reste. À sa droite, une colonne avec ses propres onglets ouvrables/fermables — manœuvres, VMG, graphiques, vent, dans cet ordre, tous fermés par défaut — qui peuvent se placer côte à côte selon la taille disponible (comme en haut de page). Ces quatre onglets ont été déplacés hors des onglets du haut, réduits à global/matos/tops : ne pas les y remettre ni les dupliquer sans redemander (un doublon volontaire a été essayé puis retiré, jugé inutile à l'usage).
