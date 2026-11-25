# 236 · Planification : ce qui vient de Gtracker

## Tel que noté

25/11/2026 : « vas faire un tour dans Gtracker pour regarder les modif qu'on fait dedans, et qu'on pourrais ajouter a tracker », puis, sur la liste numérotée : « tout Planification » (points 27 à 29).

Source : Gtracker (`D:\gong tracker\Gtracker`, lecture seule), lu le 25/11 au commit ddc4281 ; voir un lot : `git -C "D:/gong tracker/Gtracker" show <commit>`. Reprise à la main, jamais par copie en bloc : là-bas le code n'a plus ni course, ni vélo, ni entraînement, ses textes passent par la traduction, et l'apparence est la sienne (rien de cela ne vient).

## Ce qui vient

| Ce qui vient | Lots Gtracker |
|---|---|
| Image de partage d'un itinéraire, menu « … » dans Planifier et dans la liste | 458 (746589e, 7703cf9, b472f88), 466 (cad7c92, 71a6cf3, 9016fa6) pour le menu dans l'en-tête |
| Itinéraires nommés d'office (« Boucle à Carnon-Plage le 20/11 »), un nom saisi prime, jamais de renommage | 467 (f6097db, be777af) |
| Balises et tracé réunis en un bloc, une ligne par balise ; carte moins haute sur téléphone droit (58 → 45 %) | 460 (ce538c2, a32e9a0), 459 (7fd8a19) |

## Propre à Tracker

Gtracker n'a ni calcul d'itinéraire ni type de voie. Ici, en course et à vélo, l'image et le nom doivent convenir à un tracé calculé (distance et D+ au lieu des balises) ; la réunion « tracé » et « balises » ne vaut que pour voile et surf, course et vélo gardant tracé et points.

Le nom s'appuie sur le lieu du lot 215, donc après sa validation. « Charger un GPX » : ne pas le retirer (466 l'a fait là-bas).

## Contradictions, réponse par défaut

- DECISIONS §7, onglets « … en voile et en surf parcours et balises » : réunion en voile et en surf seulement, « parcours » devenant « Balises sonores ».
- DECISIONS §7 (11/11), « Supprimer un itinéraire se fait depuis Itinéraires » : le menu de Planifier l'offrirait aussi. Défaut : oui, à confirmer avec la planche.
- Planche avant le code (image de partage, bloc de balises).
