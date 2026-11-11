# 207 · Partager la trace en GPX, à côté de l'image

## Voulu (08/11, tranché le 11/11 par l'utilisateur)

« Il faut pouvoir partager la trace en GPX ET l'image, ce sont deux options différentes. » Le menu « … » d'une session propose donc deux entrées distinctes :
- « Partager l'image » : ce que fait « Partager » aujourd'hui (`ShareDialog`, image carrée), renommé ;
- « Partager la trace (GPX) » : ouvre le partage d'Android (WhatsApp, messages, courriel…) avec le fichier GPX de la session.

« Télécharger la session » reste tel quel.

## Où

- Menu « … » de l'analyse : `components/SessionNameEditor.tsx` ; menu « … » d'une session rangée : `components/SavedSessionShare.tsx` (les deux reçoivent les deux entrées, par une pièce commune plutôt qu'une copie).
- L'envoi d'un fichier existe : `shareFile` (`platform/share.ts`), employé par `pages/RoutesPage.tsx` pour le GPX d'un itinéraire (lot 194) et par `ShareDialog` pour l'image. Le réemployer ; rien d'autre que `src/platform/` ne parle au partage natif (règle 12).
- Le GPX envoyé est celui que « Télécharger la session » dépose (même contenu, même nom de fichier).
- Dans le navigateur, suivre ce que fait déjà le partage d'un itinéraire quand le partage de fichier n'existe pas (repli ou entrée absente) ; ne rien inventer.

## Tests et banc

- Test pur sur ce qui est testable (nom du fichier, choix du repli). Le banc `notes` ou `bench` lit le menu « … » : le libellé « Partager » y devient « Partager l'image », mettre le script à jour s'il le cherche.
- Essai au téléphone (posé par l'orchestrateur) : partager la trace vers WhatsApp.
