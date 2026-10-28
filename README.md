# Tilāwa — révision du Coran  (v1)

Application web installable sur iPhone. Elle écoute ta récitation (riwāya Ḥafṣ ʿan ʿĀṣim) et signale les mots erronés, oubliés ou sautés. Tout est analysé sur le téléphone, hors ligne après le premier téléchargement.

## Modes
- **Révision** : le texte est affiché ; chaque mot se colore au fil de la récitation.
- **Ḥifẓ** : le texte est masqué et se révèle au fur et à mesure. Bouton « Indice » pour révéler le mot suivant.

## Couleurs
- Vert : correct
- Rouge : mot erroné (touche-le pour voir ce que l'app a entendu)
- Orange : mot oublié ou sauté
- Vert souligné : erreur corrigée en répétant
- Violet : révélé avec un indice
- Trait doré : prochain mot attendu

Si l'app se perd, touche le mot où tu reprends, puis « Reprendre ici ».

## Mise en ligne gratuite (GitHub Pages)
1. Crée un compte sur github.com.
2. « + » › New repository › nom `tilawa`, **Public** › Create repository.
3. Lien « uploading an existing file » › sélectionne tous les fichiers de ce dossier › Commit changes.
4. Settings › Pages › Source « Deploy from a branch », branche `main`, dossier `/ (root)` › Save.
5. Après 1 à 2 minutes : `https://TON-PSEUDO.github.io/tilawa/`.
6. Ouvre ce lien dans Safari › Partager › « Sur l'écran d'accueil ».

## Fichiers
| Fichier | Rôle |
|---|---|
| index.html, styles.css | Interface |
| app.js | Logique : écoute, découpage par pauses, modes, bilan |
| align.js | Comparaison mot à mot avec le texte attendu |
| asr-worker.js | Modèle vocal Coran (whisper-base fine-tuné par Tarteel, ONNX) |
| recorder-worklet.js | Capture du micro |
| sw.js, manifest.json | Fonctionnement hors ligne, installation |
| quran.json | Texte uthmani, Ḥafṣ (source : Noble Qur'an Encyclopedia, via quran-json) |

## Limites de la v1
- Détecte les erreurs de **mots** (mot faux, oublié, saut, ajout). Pas encore les ḥarakāt ni le tajwīd.
- Le modèle a été entraîné sur des récitations correctes : il peut parfois « corriger » une petite erreur sans la signaler.
- v2 prévue : durée des madd.
