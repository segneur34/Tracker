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

- Q5 de l'audit : fournisseur sous contrat, tuiles servies par l'acheteur, ou plan seul sans satellite ? Par défaut : fournisseur sous contrat qui autorise le hors ligne, satellite retiré en attendant une clé.
