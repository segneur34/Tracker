# 159 · Tests et banc : dépendance d'ordre, corpus de GPX avant le lot 126, hooks de la voile, banc portable et à verdicts

Noté le 03/11 (audit avant vente, synthèse `~/.claude/plans/audit-vente-0111/RAPPORT.md`, lignes D4, D5, D13 ; détail dans `angle-T1.md` (T1-1 à T1-13), `angle-C4.md` (C4-9)). Modèle | Réflexion : Opus | high.

## Tel que noté

- « Les tests de la bibliothèque dépendent de leur ordre : un module simulé garde son état d'un test à l'autre ; échec reproduit avec `--sequence.shuffle --seed=3`. »
- « Le lecteur GPX n'a que 20 tests sur du XML écrit à la main, sous xmldom, et les tests de la bibliothèque le remplacent par une expression régulière : le lot 126 qui le réécrit n'a presque pas de filet. Les hooks qui assemblent les chiffres de la voile (`useSailingSession`), le brouillon, les balises, l'itinéraire et l'enregistreur (`useRecorder`, 1 100 lignes) n'ont aucun test. »
- « Le banc ne tourne que sur ce poste (Chrome en dur, `taskkill`, jonction Windows), et ≈ 30 scripts sur 72 (dont `surf.mjs`) ne rendent aucun verdict : ils ne prouvent qu'une neutralité par rapport à un commit. »

## Où, aujourd'hui

- `hooks/useSessionLibrary.memoire.test.ts:79-94` : `vi.mock('../platform/storage', importOriginal)` survit à `vi.resetModules()` ; la table `unsaved` et le cache de lecture de `storage.ts` passent d'un test à l'autre ; échec de « sans échec, un appareil neuf reprend le plus récent » après « temporaires laissés en attente » (seed 3, fichier seul ou suite complète sur un processus).
- `core/gpxParser.test.ts` (198 lignes, 35 assertions, `@xmldom/xmldom`) ; `vi.mock('../core/gpxParser')` dans `useSessionLibrary.{balayage,memoire,perte,resumes}.test.ts` ; aucun GPX au format Garmin (`ns3:`), Strava, Komoot, Waterspeed, GPX 1.0, BOM, CDATA.
- 14 hooks testés sur 62 ; `useSailingSession.ts:78-240` (seuils de session et d'activité, allure imposée, règle 4) sans test ; `useRecorder.ts` sans test (la sonde `C4-enregistreur.test.ts` montre qu'il se teste en node, source simulée).
- `outils/banc/passe.mjs:19` (`C:\Program Files\Google\Chrome\Application\chrome.exe` en dur), `:101` (`taskkill`), `:388` (jonction) ; scripts sans `check` ni `finish` : `surf`, `balises`, `bench`, `library*`, `planning`, `reglages`, `vignettes`… ; attentes réelles calées au plus juste (`perte.test.ts:143` 900 ms pour 800 ms) ; 13 `buildTrack` locaux et `buildLegSession` enfermé dans `maneuvers.test.ts`.

## Voulu

- Modules simulés reconstruits à chaque `openFresh` (`vi.doMock` dans la fonction, ou simulations sans état) ; `vitest run --sequence.shuffle` dans la vérification complète ; attentes réelles passées à `vi.useFakeTimers()` ; `settle` qui échoue avec un message s'il atteint sa borne.
- Un corpus de GPX synthétiques au format de chaque éditeur, et un test d'égalité nombre à nombre ancien contre nouveau lecteur (copie gelée) **avant** le lot 126.
- `analyzeSailingSession(track, réglages)` sortie de `useSailingSession` en fonction pure testée (sert aussi au worker du 126) ; `useMarkGuide` testé comme `useRecorder` (plateforme simulée) ; `C4-enregistreur.test.ts` promue en test du dépôt ; happy-dom avec un test « la page se monte » pour SailingModule, SurfModule, RecordingPage ; listes « général » de la voile et du surf en fonctions pures testées.
- `buildLegSession`, `wingPolar`, `gpxOf` dans `src/test/sailing.fixture.ts` ; `architecture.test.ts` étendu à la règle 12 (globales) et aux paquets `@capacitor`/`@capgo` hors de `platform/`.
- Banc : chemin de Chrome par variable (`CHROME`) avec recherche par plateforme, `process.kill` hors Windows, lien symbolique à la place de la jonction ; `check` sur les chiffres attendus par construction dans `surf.mjs`, `bench.mjs`, `balises.mjs` ; mode d'emploi court pour un nouveau venu, journal des scripts à part.

## Pourquoi

Un acheteur modifie le code en confiance seulement si la suite ne dépend pas de l'ordre, si le lecteur GPX a un filet, et si le banc tourne ailleurs que sur ce poste.
