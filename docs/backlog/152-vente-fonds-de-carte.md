# 152 · Vente : fonds de carte sous licence (tuiles OSM hors ligne, satellite Esri sans clé)

Noté le 03/11 (audit avant vente, synthèse `~/.claude/plans/audit-vente-0111/RAPPORT.md`, lignes A1, A2 ; détail dans `angle-V1.md` (V1-1, V1-2, table « Services tiers »)). Modèle | Réflexion : Fable | high (décision d'architecture et de produit).

## Tel que noté

- « Les tuiles OpenStreetMap sont gardées sans limite de durée et affichées hors ligne (500 Mo par défaut, jusqu'à 5 Go), alors que la règle d'OSM, lue à la source, dit "Offline use is not permitted" ; les requêtes partent sans nom d'appli. OSM peut couper sans préavis toutes les installations d'un coup. »
- « Le satellite Esri est appelé sans clé ni compte, l'attribution est incomplète ("Powered by Esri", "GIS User Community" manquent), et ses tuiles sont gardées hors ligne alors que la couche "n'est pas prévue pour l'export". »

## Où, aujourd'hui (vérifié au commit 312d13c)

- `core/mapBase.ts` : `tile.openstreetmap.org` et `server.arcgisonline.com/.../World_Imagery` ; attribution Esri « Imagerie © Esri, Vantor, Earthstar Geographics ».
- `platform/mapTiles.ts` `resolveTile` : une tuile gardée est rendue même périmée, hors ligne compris ; `fetch(url, { credentials: 'omit' })` avec l'agent de la WebView et `Referer https://localhost/` ; rafraîchissement à 7 jours sans requête conditionnelle.
- `platform/tileCache.ts` : 500 Mo par défaut, 100 Mo à 5 Go (Réglages › Cartes hors ligne) ; `capacitor.config.ts` sans `appendUserAgent`.
- Règle d'OSM (operations.osmfoundation.org/policies/tiles, lue le 01/11/2026) : agent propre et stable nommant l'appli, pas d'usage hors ligne, pas de téléchargement en masse, accès retirable à tout moment pour un usage commercial. Esri : licence d'usage (clé d'API ou identité ArcGIS), « Powered by Esri », `exportTilesAllowed: false`. DECISIONS §8 et HISTORIQUE point 285 n'avaient retenu que l'interdiction du téléchargement à l'avance.

## Voulu

- Tout de suite, petit : `appendUserAgent` (« Tracker/<version> (+contact) ») dans `capacitor.config.ts` ; libellé complet d'Esri avec « Powered by Esri » sur toutes les cartes, vignettes et image de partage ; adresse des tuiles réglable sans nouvelle version.
- Pour la vente, gros (Q5 dans la fiche) : un fournisseur de tuiles sous contrat qui autorise le cache hors ligne, ou des tuiles servies par l'acheteur (vectorielles, type Protomaps, envisagé puis écarté au point 285) ; satellite par un compte ArcGIS Location Platform (2 millions de tuiles par mois offertes, puis payant, à revérifier) ou retiré. Un drapeau `offlineAllowed` par fond, testé : aucune tuile gardée n'est rendue hors ligne pour un fond qui l'interdit.

## Pourquoi

Les deux fonds de carte sont le cœur visuel de la voile et du surf ; une coupure par OSM ou Esri toucherait toutes les installations d'un coup.

## Questions

- Q5 de l'audit : fournisseur sous contrat, tuiles servies par l'acheteur, ou plan seul sans satellite ? Par défaut : fournisseur sous contrat qui autorise le hors ligne, satellite retiré en attendant une clé. **Après le fork**, sur la copie vendue.

## Réponse du 07/11 : la partie « tout de suite » devient le n° 188, avant le fork

- Contact de l'agent envoyé à OpenStreetMap : la page GitHub publique de l'utilisateur, `https://github.com/segneur34` ; **jamais son adresse e-mail**. Forme : `Tracker/<version> (+https://github.com/segneur34)`, version lue de `package.json` dans `capacitor.config.ts` (`android.appendUserAgent`), avec un test qui vérifie la forme. L'acheteur mettra son propre contact après le fork.
- Libellé d'Esri : « Imagerie © Esri, Vantor, Earthstar Geographics, GIS User Community · Powered by Esri », dans `core/mapBase.ts`, lu par les cartes, les vignettes de la bibliothèque et l'image de partage (vérifier que les trois lisent le même champ `attribution` ; sinon les y brancher). Seule différence visible du lot : pas de maquette (texte légal sur la ligne d'attribution, tranché par l'orchestrateur).
- Adresse des tuiles réglable sans nouvelle version : un champ texte par fond (plan, satellite) dans Réglages › Cartes hors ligne, vide = adresse d'origine, réglage par appareil (`platform/storage.ts`), lu là où `mapBase` donne l'adresse ; aucune autre disposition changée. Une adresse changée n'invalide pas les tuiles gardées (elles restent rangées par fond, pas par adresse).
- Le reste (fournisseur sous contrat, drapeau `offlineAllowed`, satellite par compte ArcGIS) attend le fork.

Fait le 07/11 (lot 188, à valider) : l'adresse est choisie en un seul endroit (`tileTemplate` de `core/mapBase.ts`), le réglage rangé par appareil dans `platform/tileCache.ts` (clé `tracker.tileUrls`), le téléchargeur la relit à chaque demande ; les tuiles restent rangées par fond, donc une adresse changée ne perd rien. Tranché par l'orchestrateur : une adresse sans `{z}`, `{x}`, `{y}` ou sans `http(s)://` est refusée (l'adresse d'origine sert, petite note sous le champ), sinon la même image serait gardée sous toutes les cases. Les vignettes lisent désormais le crédit du plan dans `mapBase` au lieu d'un texte en dur (même texte). Limite connue : une tuile que le serveur a dite absente n'est plus redemandée avant le rechargement de la page, même après un changement d'adresse. Relecture du 07/11 : une adresse à repère répété ou à repère inconnu (`{s}`, `{r}`) est refusée elle aussi, sinon il resterait en clair dans l'adresse demandée ; le script `satellite.mjs` du banc reconnaît la nouvelle mention.
