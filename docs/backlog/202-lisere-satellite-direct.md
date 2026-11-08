# 202 · Carte de l'enregistrement : liseré blanc posé par-dessus la trace en passant en satellite

Noté le 07/11 (vu au banc, défaut antérieur au lot 196). Modèle | Réflexion : Sonnet | medium. Petit, commun aux deux versions : à faire avant le fork.

## Le défaut

`src/components/LiveMap.tsx` : sur le fond satellite, un liseré blanc (`HALO_STYLE`, `haloStyle(TRACK_WEIGHT)`) est dessiné sous la trace enregistrée. Les tracés du liseré (`halo && paths.map(…)`, `halo && tail && …`) et ceux de la trace (`paths.map(…)`, `tail && …`) sont tous dans le calque par défaut de Leaflet (`overlayPane`, z-index 400) : l'ordre d'empilement est l'ordre de création. Quand on passe en satellite **pendant** un enregistrement, les tracés de la trace existent déjà et le liseré, créé après, se pose par-dessus elle et la délave.

Le lot 196 a réglé le même défaut pour la trace suivie par deux calques explicites : `GUIDE_HALO_PANE` (`traceSuivieLisere`, z-index 380) et `GUIDE_PANE` (`traceSuivie`, 390), voir le commentaire au-dessus de ces constantes.

## Voulu

- Même remède : un calque `TRACK_HALO_PANE` (nom `traceLisere`, z-index entre 390 et 400, par exemple 395 : au-dessus de la trace suivie, sous `overlayPane` où reste la trace enregistrée), qui contient les tracés du liseré de la trace et de son prolongement (`tail`). La trace elle-même ne bouge pas de calque.
- Rien d'autre ne change : couleurs, épaisseurs, opacités (`haloStyle`) identiques ; ordre des autres couches identique (balises, notes, position, repère de survol restent au-dessus).
- Un test synthétique si quelque chose de pur s'y prête ; sinon le verdict au banc suffit.

## Banc

- `outils/banc/carte-direct.mjs` (ou `satellite.mjs` si c'est lui qui passe en satellite pendant le direct ; lire `outils/banc/SCRIPTS.md` pour le choisir) : ajouter un verdict « satellite activé après le départ : le liseré est dans un calque sous la trace » (par exemple : les `path` blancs sont dans `.leaflet-traceLisere-pane`, dont le z-index calculé est inférieur à celui de `.leaflet-overlay-pane`). Consigner la ligne du script dans `outils/banc/SCRIPTS.md` (même forme que les entrées voisines).
- L'orchestrateur rejoue `carte-direct`, `satellite`, `trace-suivie` avant et après.

## Vérification

`node outils/verif.mjs --rapide`. Version à augmenter par l'orchestrateur.
