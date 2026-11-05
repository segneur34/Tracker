# 105 · Sauts à terre : durée de vol et hauteur qui ne concordent pas

Modèle | Réflexion : Opus | high. Lire DECISIONS §3 avant de toucher au code.

## Constat

Course du 31/10 (`D:\memoire Tracker\Tracker\sessions\2026-10-31_09-12-36_running.*`, hors dépôt) : le seul saut trouvé annonce 1,92 s de vol pour 0,88 m de haut, doutes « saturation » et « verticale » levés. 1,92 s de vol libre ferait environ 4,5 m. 0,88 m ferait environ 0,85 s.

## Voulu

- Relire ce fichier avec `outils/banc/sauts-diagnostic.mjs --tous` et trouver laquelle des deux valeurs est fausse, et pourquoi.
- Corriger le calcul dans `core/jumps.ts`, sans seuil en dur (règles 2 et 3 de `CLAUDE.md`) ; test synthétique, 1 Hz = 5 Hz.
- Rejouer les autres captures de saut du dossier (wing compris) : une correction ne doit pas perdre de vrais sauts ni en créer de faux. Donner le avant/après par session.
- Un seuil nouveau ou changé revient à l'utilisateur : le proposer avec ses chiffres, sans le poser.

## Hors lot

Faux sauts en wing : n° 27.
