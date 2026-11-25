# 230 · Profil : une note de niveau sportif

## Tel que noté

25/11/2026 : « il faudrait d'en profil créer un moyen d'avoir un genre de note qui en fonction de ton âge des efforts que tu fais exprès te donne un niveau sportif et quelque chose de ce goût là » (lu : « dans Profil » ; « exprès » est sans doute un mot de la dictée, à confirmer)

## Aujourd'hui (vérifié le 25/11)

- Profil (`src/pages/ProfilePage.tsx`) : aucune note. Une période pour toute la page, quatre chiffres, anneau, graphe, racine et fleur (`src/library/rootGrowth.ts`, temps de sport de la semaine seulement, ni âge ni intensité).
- Statistiques › « niveau » (`src/library/statsLevel.ts`, lot 146) situe déjà les meilleurs efforts selon l'âge et le sexe, mais à pied (5 km, 10 km, VO2max estimée) et à vélo (W/kg) seulement, chiffre par chiffre, sans note d'ensemble. Rien en voile, en surf ni en muscu.
- Charge cardio d'Edwards par session et par semaine (`sessionLoad`, `src/library/stats.ts`), pour les sessions avec FC ; FC de repos (tests) et FC de nuit existent.
- Âge, sexe, poids, FC max : Réglages › Pratiquant (`src/library/athleteProfile.ts`).

## Voulu

Un chiffre lisible d'un coup d'œil dans Profil, propre à l'âge, tiré des efforts faits, avec un nom de niveau à côté et une aide « ? » qui dit d'où il vient.

**Choisi le 25/11** : un mélange (piste 4), note sur 100 faite de parts visibles : efforts des dernières semaines, régularité, performances pour l'âge quand elles existent ; vaut pour tous les sports. Rangé en Ensuite, après le n° 217 ; étude et maquette d'abord.

## Pistes, dont le mélange est retenu

1. **Performance pour l'âge** : les pourcentages de l'onglet « niveau ». Solide, mais muet en voile et en surf.
2. **Charge et régularité** : temps de sport et intensité des dernières semaines, rapportés à un repère par âge (par exemple les 150 à 300 min modérées par semaine de l'OMS, à vérifier à la source). Vaut pour tous les sports ; mesure ce qu'on fait, pas ce qu'on vaut.
3. **Forme cardiaque** : FC de repos et VO2max estimée selon l'âge (tables FRIEND déjà dans le code). Vaut quel que soit le sport, mais demande un test.
4. **Mélange** : une note sur 100, part par part, une part absente étant retirée du calcul et dite, jamais comptée zéro.

Points à trancher au plan : la période comptée (la page en a une ; une note de niveau devrait plutôt être sur une fenêtre fixe) ; ce que devient la note après un mois d'arrêt ; l'absence de ceinture ; le rapport avec la racine (pas deux choses qui disent la même). Maquette avant le code.

## Réserves

- Aucune table par âge fiable n'est connue pour la voile et le surf : la note y viendra de la charge, pas de la performance.
- Garder la note et ses parts visibles ensemble : un chiffre seul sans explication ne se vérifie pas.
