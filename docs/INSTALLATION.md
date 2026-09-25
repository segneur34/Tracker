# Installer Tracker sur un téléphone Android

Tracker enregistre vos sessions de voile et de course avec le GPS du téléphone, puis les analyse. L'application n'est pas sur le Play Store : elle s'installe à partir d'un fichier (un « APK ») que vous recevez par un lien. Comptez cinq minutes.

Il faut un téléphone Android 7 ou plus récent. Il n'y a pas de version iPhone.

## 1. Télécharger et installer

1. Ouvrez sur le téléphone le lien que vous avez reçu, puis téléchargez le fichier qui se termine par `.apk`.
2. Touchez le fichier téléchargé (dans la notification de téléchargement, ou dans l'application Fichiers, dossier « Téléchargements »).
3. Android vous demande d'autoriser cette source d'installation, en général le navigateur ou l'application Fichiers. Touchez **Paramètres**, activez **Autoriser depuis cette source**, puis revenez en arrière.
4. Touchez **Installer**.
5. Play Protect peut afficher un avertissement du type « Application non vérifiée » ou « Application bloquée ». Il le fait pour toute application installée en dehors du Play Store. Touchez **Plus de détails**, puis **Installer quand même**.

L'icône Tracker apparaît avec les autres applications.

## 2. Choisir le dossier de vos sessions

Tracker range vos sessions dans un dossier ordinaire du téléphone. Chaque session y est un fichier GPX accompagné d'une petite fiche. Vous pouvez copier ce dossier sur un ordinateur pour le sauvegarder, ou pour retrouver vos sessions sur un autre appareil.

1. Au premier lancement, l'accueil propose **Choisir le dossier**.
2. Dans la fenêtre d'Android qui s'ouvre, allez dans **Documents**. Créez-y un dossier **Tracker** s'il n'existe pas, puis entrez dedans.
3. Touchez **Utiliser ce dossier**, puis **Autoriser**.

Tracker ne demande jamais l'accès à tous vos fichiers : il ne voit que ce dossier.

## 3. Régler le téléphone avant la première sortie

Ces réglages évitent que le téléphone coupe le GPS quand l'écran s'éteint. **Sans eux, la trace s'interrompt au bout de quelques minutes.**

**Au premier enregistrement**, Tracker demande deux autorisations :

- **Position** : choisissez **Lorsque vous utilisez l'appli**, et laissez **Position exacte** activée. Avec la position approximative, la trace est inutilisable.
- **Notifications** : choisissez **Autoriser**. Pendant l'enregistrement, une notification reste affichée. C'est elle qui permet à Tracker de continuer à enregistrer écran éteint.

**Batterie**. Ouvrez Paramètres, puis Applications, puis Tracker, puis Batterie (ou « Économiseur de batterie »), et choisissez **Aucune restriction** (ou « Non restreinte »).

**Sur les téléphones Xiaomi, Redmi et POCO**, dans la même page Paramètres, puis Applications, puis Tracker : activez aussi **Démarrage automatique**.

**Sur les téléphones Samsung** : ouvrez Paramètres, puis Batterie, puis « Limites d'utilisation en arrière-plan ». Vérifiez que Tracker n'est pas dans les applications « en veille » ou « en veille prolongée ».

Les libellés changent un peu d'une marque à l'autre. En cas de doute, cherchez « batterie » dans les paramètres de l'application Tracker.

## 4. Premier essai

Avant une vraie sortie, faites un essai de dix minutes à pied, écran éteint, téléphone en poche :

1. Touchez le bouton rond, choisissez l'activité, puis **Démarrer**.
2. Éteignez l'écran et marchez dix minutes.
3. Rallumez l'écran, touchez **Arrêter**, puis **Analyser**.

Si la trace présente de longues lignes droites qui coupent les virages, le téléphone a coupé le GPS. Reprenez l'étape 3.

## Mettre à jour

Quand vous recevez une nouvelle version, installez-la **par-dessus** l'ancienne, de la même façon qu'à l'étape 1. Ne désinstallez pas l'ancienne version : vos réglages et vos autorisations sont conservés.

## Si vous devez désinstaller

La désinstallation efface les autorisations, les réglages de batterie et le choix du dossier. **Vos sessions, elles, restent** dans le dossier Documents/Tracker.

Après une réinstallation, refaites les étapes 2 et 3 : désignez le même dossier Documents/Tracker, et Tracker retrouve vos sessions.

## Retrouver ou sauvegarder vos sessions

- **Sur le téléphone** : dans l'application Fichiers, passez par **Stockage interne**, puis **Documents**, puis **Tracker**. La catégorie « Documents » de certains gestionnaires de fichiers ne montre pas ce dossier.
- **Sur un ordinateur** : branchez le téléphone par câble USB, choisissez « Transfert de fichiers » sur le téléphone, puis copiez le dossier Documents/Tracker. Cette copie est votre sauvegarde.

## En cas de problème

| Symptôme | Que faire |
| --- | --- |
| « Application non installée » | Une version signée autrement est déjà installée. Désinstallez-la, puis installez la nouvelle (voir « Si vous devez désinstaller »). |
| La trace s'arrête ou saute quand l'écran est éteint | Refaites l'étape 3 : batterie sans restriction, démarrage automatique sur Xiaomi. |
| Aucune position ne s'affiche | Vérifiez que la localisation du téléphone est activée et que Tracker a la position exacte. Mettez-vous à ciel ouvert : le premier point peut prendre une minute. |
| Tracker demande de choisir à nouveau le dossier | Désignez le même dossier, Documents/Tracker. Rien n'est perdu. |

Pour tout autre souci, envoyez une capture d'écran et décrivez ce que vous faisiez.
