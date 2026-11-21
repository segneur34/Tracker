# 228 · Enregistrer en muscu : pouvoir replier les compteurs

## Tel que noté

18/11/2026, 12:06 : « TRACKEUR dans le mode muscu il faut pouvoir réduire les compteurs pour les cachets » (lu « pour les cacher »)

## Aujourd'hui (vérifié le 21/11)

Pendant un enregistrement de muscu (`src/pages/RecordingPage.tsx`, `liveHeartOnly`), la page montre les tuiles de chiffres (BPM, Durée…) et la carte du compteur ou du chrono (`src/components/IntervalCard.tsx`), sans moyen de les replier ; la carte du direct a « Réduire la carte », pas la muscu.

## Voulu (choisi le 21/11)

Les deux : les tuiles de chiffres et la carte du compteur ou du chrono, chacune repliable d'un geste et rouverte d'un geste, choix gardé sur l'appareil comme « Réduire la carte » (`RECORDING_SECTION_DEFAULTS`). Les alertes (FC perdue, bornes) restent visibles repliées.
